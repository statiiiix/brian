#!/usr/bin/env node
// Controlled destructive probe. It registers exactly one disposable public
// OAuth client and always attempts provider-side deletion before reporting
// success. It never prints registration responses or OAuth client identifiers.
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_RESOURCE = "https://api.brianthebrain.app/mcp";
const CALLBACK = "http://127.0.0.1:49152/callback";

function protectedResourceMetadataUrl(resourceUrl) {
  const url = new URL(resourceUrl);
  return `${url.origin}/.well-known/oauth-protected-resource/${url.pathname.replace(/^\/+/, "")}`;
}

function authorizationServerMetadataUrl(issuer) {
  const url = new URL(issuer);
  const issuerPath = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
  return new URL(`/.well-known/oauth-authorization-server${issuerPath}`, url.origin).toString();
}

async function fetchJson(fetchFn, url, category, init = undefined) {
  let response;
  try {
    response = await fetchFn(url, { redirect: "error", ...init });
  } catch {
    throw new Error(`DCR probe ${category} failed`);
  }
  if (!response.ok) throw new Error(`DCR probe ${category} failed`);
  try {
    return await response.json();
  } catch {
    throw new Error(`DCR probe ${category} failed`);
  }
}

function createProbeAdmin(supabaseUrl, secretKey) {
  const supabase = createClient(supabaseUrl, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return {
    async listClients() {
      const clients = [];
      let page = 1;
      for (;;) {
        const response = await supabase.auth.admin.oauth.listClients({ page, perPage: 100 })
          .catch(() => { throw new Error("DCR probe verification failed"); });
        if (response.error) throw new Error("DCR probe verification failed");
        for (const row of response.data.clients) {
          if (typeof row.client_id === "string") clients.push({ clientId: row.client_id });
        }
        const nextPage = response.data.nextPage ?? null;
        if (nextPage === null) break;
        if (!Number.isInteger(nextPage) || nextPage <= page) {
          throw new Error("DCR probe verification failed");
        }
        page = nextPage;
      }
      return clients;
    },
    async deleteClient(clientId) {
      const response = await supabase.auth.admin.oauth.deleteClient(clientId)
        .catch(() => { throw new Error("DCR probe cleanup failed"); });
      if (response.error) throw new Error("DCR probe cleanup failed");
    },
  };
}

export async function runDcrRegistrationProbe({
  resourceUrl = DEFAULT_RESOURCE,
  fetchFn = globalThis.fetch,
  admin: injectedAdmin,
  secretKey = "",
  runId = randomUUID(),
}) {
  const metadata = await fetchJson(
    fetchFn,
    protectedResourceMetadataUrl(resourceUrl),
    "discovery",
    { headers: { accept: "application/json" } },
  );
  if (metadata?.resource !== resourceUrl
    || !Array.isArray(metadata.authorization_servers)
    || typeof metadata.authorization_servers[0] !== "string") {
    throw new Error("DCR probe discovery failed");
  }
  const issuer = metadata.authorization_servers[0];
  const discovery = await fetchJson(
    fetchFn,
    authorizationServerMetadataUrl(issuer),
    "discovery",
    { headers: { accept: "application/json" } },
  );
  if (discovery?.issuer !== issuer || typeof discovery.registration_endpoint !== "string") {
    throw new Error("DCR probe discovery failed");
  }
  let registrationEndpoint;
  try {
    registrationEndpoint = new URL(discovery.registration_endpoint);
  } catch {
    throw new Error("DCR probe discovery failed");
  }
  if (registrationEndpoint.protocol !== "https:") throw new Error("DCR probe discovery failed");

  const registration = await fetchJson(
    fetchFn,
    registrationEndpoint,
    "registration",
    {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Brian controlled DCR probe",
        redirect_uris: [CALLBACK],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
    },
  );
  const clientId = typeof registration?.client_id === "string" ? registration.client_id : "";
  if (!clientId || clientId.length > 512) throw new Error("DCR probe registration failed");
  const admin = injectedAdmin ?? createProbeAdmin(new URL(issuer).origin, secretKey);
  let verificationError = null;
  let cleanupError = null;
  try {
    const listed = await admin.listClients().catch(() => {
      throw new Error("DCR probe verification failed");
    });
    if (!listed.some((client) => client.clientId === clientId)) {
      throw new Error("DCR probe verification failed");
    }
  } catch {
    verificationError = new Error("DCR probe verification failed");
  } finally {
    try {
      await admin.deleteClient(clientId);
    } catch {
      cleanupError = new Error("DCR probe cleanup failed");
    }
  }
  if (cleanupError) throw cleanupError;
  if (verificationError) throw verificationError;
  return { registration: "proven", cleanup: "deleted", runId };
}

function usage() {
  return "Usage: npm run smoke:dcr-registration -- --yes";
}

const direct = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (direct) {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${usage()}\n`);
  } else if (argv.length !== 1 || argv[0] !== "--yes" || !process.env.SUPABASE_SECRET_KEY) {
    process.stderr.write("DCR registration probe requires --yes and SUPABASE_SECRET_KEY.\n");
    process.exitCode = 2;
  } else {
    runDcrRegistrationProbe({
      resourceUrl: process.env.MCP_SMOKE_RESOURCE || DEFAULT_RESOURCE,
      secretKey: process.env.SUPABASE_SECRET_KEY,
    })
      .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
      .catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.message : "DCR registration probe failed"}\n`);
        process.exitCode = 1;
      });
  }
}
