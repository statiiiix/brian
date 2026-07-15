#!/usr/bin/env node
// Controlled destructive probe. It registers exactly one disposable public
// OAuth client and always attempts provider-side deletion before reporting
// success. It never prints registration responses or OAuth client identifiers.
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

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

function trustedSupabaseEndpoints(supabaseUrl) {
  let url;
  try {
    url = new URL(supabaseUrl);
  } catch {
    throw new Error("DCR probe configuration failed");
  }
  if (url.protocol !== "https:"
    || url.username
    || url.password
    || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname)
    || (url.pathname !== "/" && url.pathname !== "")
    || url.search
    || url.hash) {
    throw new Error("DCR probe configuration failed");
  }
  return {
    supabaseUrl: url.origin,
    issuer: `${url.origin}/auth/v1`,
    registrationEndpoint: `${url.origin}/auth/v1/oauth/clients/register`,
  };
}

async function fetchJson(fetchFn, url, category, init = undefined) {
  let response;
  try {
    response = await fetchFn(url, { redirect: "error", ...init });
  } catch {
    const error = new Error(`DCR probe ${category} failed`);
    if (category === "registration") error.ambiguousRegistration = true;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(`DCR probe ${category} failed`);
    if (category === "registration" && response.status >= 500) {
      error.ambiguousRegistration = true;
    }
    throw error;
  }
  try {
    return await response.json();
  } catch {
    const error = new Error(`DCR probe ${category} failed`);
    if (category === "registration") error.ambiguousRegistration = true;
    throw error;
  }
}

function createProbeAdmin(supabaseUrl, secretKey, fetchFn = globalThis.fetch) {
  if (typeof secretKey !== "string" || !secretKey) {
    throw new Error("DCR probe configuration failed");
  }
  const endpoint = `${supabaseUrl}/auth/v1/admin/oauth/clients`;
  const request = async (url, category, init = {}) => {
    let response;
    try {
      response = await fetchFn(url, {
        redirect: "error",
        ...init,
        headers: {
          accept: "application/json",
          apikey: secretKey,
          ...init.headers,
        },
      });
    } catch {
      throw new Error(`DCR probe ${category} failed`);
    }
    if (!response.ok) throw new Error(`DCR probe ${category} failed`);
    return response;
  };
  return {
    async listClients() {
      const clients = [];
      const perPage = 100;
      for (let page = 1; page <= 1000; page += 1) {
        const url = new URL(endpoint);
        url.searchParams.set("page", String(page));
        url.searchParams.set("per_page", String(perPage));
        const response = await request(url, "verification");
        let body;
        try {
          body = await response.json();
        } catch {
          throw new Error("DCR probe verification failed");
        }
        if (!body || typeof body !== "object" || Array.isArray(body)) {
          throw new Error("DCR probe verification failed");
        }
        const rows = body.clients === undefined ? [] : body.clients;
        if (!Array.isArray(rows)) throw new Error("DCR probe verification failed");
        for (const row of rows) {
          if (typeof row.client_id === "string") {
            clients.push({
              clientId: row.client_id,
              ...(typeof row.client_name === "string" ? { clientName: row.client_name } : {}),
            });
          }
        }
        const total = Number.parseInt(response.headers.get("x-total-count") ?? "", 10);
        if (Number.isInteger(total) && total >= 0 && clients.length >= total) return clients;
        if (rows.length < perPage) return clients;
      }
      throw new Error("DCR probe verification failed");
    },
    async deleteClient(clientId) {
      await request(`${endpoint}/${encodeURIComponent(clientId)}`, "cleanup", { method: "DELETE" });
    },
  };
}

async function findMarkerMatches(admin, clientName, waitFn) {
  let matches = [];
  for (const delayMs of [0, 100, 400, 1000]) {
    if (delayMs > 0) await waitFn(delayMs);
    try {
      matches = (await admin.listClients()).filter((client) => client.clientName === clientName);
    } catch {
      throw new Error("DCR probe cleanup failed");
    }
    if (matches.length > 0) return matches;
  }
  throw new Error("DCR probe cleanup failed");
}

async function deleteMarkerMatches(admin, matches) {
  if (matches.some((match) => !match.clientId)) {
    throw new Error("DCR probe cleanup failed");
  }
  try {
    for (const match of matches) await admin.deleteClient(match.clientId);
  } catch {
    throw new Error("DCR probe cleanup failed");
  }
}

export async function runDcrRegistrationProbe({
  resourceUrl = DEFAULT_RESOURCE,
  supabaseUrl,
  fetchFn = globalThis.fetch,
  admin: injectedAdmin,
  adminFactory = createProbeAdmin,
  secretKey = "",
  runId = randomUUID(),
  waitFn = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}) {
  const trusted = trustedSupabaseEndpoints(supabaseUrl);
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
  if (issuer !== trusted.issuer) throw new Error("DCR probe discovery failed");
  const discovery = await fetchJson(
    fetchFn,
    authorizationServerMetadataUrl(issuer),
    "discovery",
    { headers: { accept: "application/json" } },
  );
  if (discovery?.issuer !== trusted.issuer
    || discovery.registration_endpoint !== trusted.registrationEndpoint) {
    throw new Error("DCR probe discovery failed");
  }
  let registrationEndpoint;
  try {
    registrationEndpoint = new URL(discovery.registration_endpoint);
  } catch {
    throw new Error("DCR probe discovery failed");
  }
  if (registrationEndpoint.protocol !== "https:") throw new Error("DCR probe discovery failed");

  let admin;
  try {
    admin = injectedAdmin ?? adminFactory(trusted.supabaseUrl, secretKey, fetchFn);
  } catch {
    throw new Error("DCR probe configuration failed");
  }
  try {
    await admin.listClients();
  } catch {
    throw new Error("DCR probe configuration failed");
  }
  const clientName = `Brian controlled DCR probe ${runId}`;

  let registration;
  try {
    registration = await fetchJson(
      fetchFn,
      registrationEndpoint,
      "registration",
      {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({
          client_name: clientName,
          redirect_uris: [CALLBACK],
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
        }),
      },
    );
  } catch (error) {
    if (!error?.ambiguousRegistration) {
      throw new Error("DCR probe registration failed");
    }
    const matches = await findMarkerMatches(admin, clientName, waitFn);
    await deleteMarkerMatches(admin, matches);
    throw new Error("DCR probe registration failed");
  }
  let clientId = typeof registration?.client_id === "string" ? registration.client_id : "";
  let listed;
  if (!clientId) {
    const matches = await findMarkerMatches(admin, clientName, waitFn);
    if (matches.length !== 1 || !matches[0].clientId) {
      await deleteMarkerMatches(admin, matches);
      throw new Error("DCR probe cleanup failed");
    }
    clientId = matches[0].clientId;
    listed = matches;
  }
  let verificationError = null;
  let cleanupError = null;
  try {
    listed ??= await admin.listClients().catch(() => {
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
  } else if (argv.length !== 1
    || argv[0] !== "--yes"
    || !process.env.SUPABASE_URL
    || !process.env.SUPABASE_SECRET_KEY) {
    process.stderr.write("DCR registration probe requires --yes, SUPABASE_URL, and SUPABASE_SECRET_KEY.\n");
    process.exitCode = 2;
  } else {
    runDcrRegistrationProbe({
      resourceUrl: process.env.MCP_SMOKE_RESOURCE || DEFAULT_RESOURCE,
      supabaseUrl: process.env.SUPABASE_URL,
      secretKey: process.env.SUPABASE_SECRET_KEY,
    })
      .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
      .catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.message : "DCR registration probe failed"}\n`);
        process.exitCode = 1;
      });
  }
}
