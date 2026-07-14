import assert from "node:assert/strict";
import test from "node:test";
import { runDcrRegistrationProbe } from "./probe-dcr-registration.mjs";

const resourceUrl = "https://api.example.test/mcp";
const supabaseUrl = "https://project.supabase.co";
const issuer = "https://project.supabase.co/auth/v1";
const discoveryUrl = "https://project.supabase.co/.well-known/oauth-authorization-server/auth/v1";
const registrationEndpoint = "https://project.supabase.co/auth/v1/oauth/clients/register";

function responseJson(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function successfulFetch(clientId = "registered-client-secret-id") {
  const calls = [];
  const fetchFn = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url) === "https://api.example.test/.well-known/oauth-protected-resource/mcp") {
      return responseJson({ resource: resourceUrl, authorization_servers: [issuer] });
    }
    if (String(url) === discoveryUrl) {
      return responseJson({ issuer, registration_endpoint: registrationEndpoint });
    }
    if (String(url) === registrationEndpoint) {
      return responseJson({
        client_id: clientId,
        client_secret: "registration-secret-must-not-leak",
        redirect_uris: ["http://127.0.0.1:49152/callback?code=must-not-leak"],
      }, 201);
    }
    return new Response("not found", { status: 404 });
  };
  return { fetchFn, calls };
}

test("controlled DCR probe registers, verifies, cleans up, and returns only categorical evidence", async () => {
  const { fetchFn, calls } = successfulFetch();
  const deleted = [];
  const result = await runDcrRegistrationProbe({
    resourceUrl,
    supabaseUrl,
    fetchFn,
    admin: {
      listClients: async () => [{
        clientId: "registered-client-secret-id",
        registrationType: "dynamic",
        createdAt: new Date(),
      }],
      deleteClient: async (clientId) => { deleted.push(clientId); },
    },
    runId: "safe-run-id",
  });
  assert.deepEqual(result, { registration: "proven", cleanup: "deleted", runId: "safe-run-id" });
  assert.deepEqual(deleted, ["registered-client-secret-id"]);
  const registration = calls.find((call) => call.url === registrationEndpoint);
  const payload = JSON.parse(registration.init.body);
  assert.equal(registration.init.method, "POST");
  assert.deepEqual(payload.redirect_uris, ["http://127.0.0.1:49152/callback"]);
  assert.equal(payload.token_endpoint_auth_method, "none");
  const json = JSON.stringify(result);
  for (const forbidden of [
    "registered-client-secret-id",
    "registration-secret-must-not-leak",
    "must-not-leak",
  ]) assert.equal(json.includes(forbidden), false);
});

test("registration failure is fixed and does not attempt cleanup without a client ID", async () => {
  const deleted = [];
  const fetchFn = async (url) => {
    if (String(url).includes("oauth-protected-resource")) {
      return responseJson({ resource: resourceUrl, authorization_servers: [issuer] });
    }
    if (String(url) === discoveryUrl) {
      return responseJson({ issuer, registration_endpoint: registrationEndpoint });
    }
    return new Response("provider registration secret", { status: 429 });
  };
  await assert.rejects(runDcrRegistrationProbe({
    resourceUrl,
    supabaseUrl,
    fetchFn,
    admin: {
      listClients: async () => [],
      deleteClient: async (clientId) => { deleted.push(clientId); },
    },
    runId: "safe-run-id",
  }), /^Error: DCR probe registration failed$/);
  assert.deepEqual(deleted, []);
});

test("verification failure still deletes the registered client", async () => {
  const { fetchFn } = successfulFetch();
  const deleted = [];
  await assert.rejects(runDcrRegistrationProbe({
    resourceUrl,
    supabaseUrl,
    fetchFn,
    admin: {
      listClients: async () => [],
      deleteClient: async (clientId) => { deleted.push(clientId); },
    },
    runId: "safe-run-id",
  }), /^Error: DCR probe verification failed$/);
  assert.deepEqual(deleted, ["registered-client-secret-id"]);
});

test("cleanup failure overrides success and remains redacted", async () => {
  const { fetchFn } = successfulFetch();
  const error = await runDcrRegistrationProbe({
    resourceUrl,
    supabaseUrl,
    fetchFn,
    admin: {
      listClients: async () => [{
        clientId: "registered-client-secret-id",
        registrationType: "dynamic",
        createdAt: new Date(),
      }],
      deleteClient: async () => { throw new Error("cleanup provider secret"); },
    },
    runId: "safe-run-id",
  }).catch((caught) => caught);
  assert.equal(String(error), "Error: DCR probe cleanup failed");
  assert.equal(String(error).includes("cleanup provider secret"), false);
});

test("rejects discovery that does not match the trusted Supabase URL before registration", async () => {
  const calls = [];
  const maliciousIssuer = "https://attacker.example/auth/v1";
  const fetchFn = async (url) => {
    calls.push(String(url));
    if (String(url).includes("oauth-protected-resource")) {
      return responseJson({ resource: resourceUrl, authorization_servers: [maliciousIssuer] });
    }
    throw new Error("must not follow an untrusted issuer");
  };

  await assert.rejects(runDcrRegistrationProbe({
    resourceUrl,
    supabaseUrl,
    secretKey: "must-not-leak",
    fetchFn,
    runId: "safe-run-id",
  }), /^Error: DCR probe discovery failed$/);

  assert.deepEqual(calls, ["https://api.example.test/.well-known/oauth-protected-resource/mcp"]);
});

test("cleanup is attempted for every non-empty returned client ID", async () => {
  const longClientId = "x".repeat(513);
  const { fetchFn } = successfulFetch(longClientId);
  const deleted = [];

  await assert.rejects(runDcrRegistrationProbe({
    resourceUrl,
    supabaseUrl,
    fetchFn,
    admin: {
      listClients: async () => [],
      deleteClient: async (clientId) => { deleted.push(clientId); },
    },
    runId: "safe-run-id",
  }), /^Error: DCR probe verification failed$/);

  assert.deepEqual(deleted, [longClientId]);
});

test("recovers a missing client ID by the unique run marker and deletes it", async () => {
  const recoveredClientId = "recovered-client-id";
  const runId = "safe-run-id";
  const { fetchFn: baseFetch } = successfulFetch();
  const fetchFn = async (url, init) => {
    if (String(url) === registrationEndpoint) return responseJson({ client_name: `Brian controlled DCR probe ${runId}` }, 201);
    return baseFetch(url, init);
  };
  const deleted = [];

  const result = await runDcrRegistrationProbe({
    resourceUrl,
    supabaseUrl,
    fetchFn,
    admin: {
      listClients: async () => [{
        clientId: recoveredClientId,
        clientName: `Brian controlled DCR probe ${runId}`,
      }],
      deleteClient: async (clientId) => { deleted.push(clientId); },
    },
    runId,
  });

  assert.deepEqual(result, { registration: "proven", cleanup: "deleted", runId });
  assert.deepEqual(deleted, [recoveredClientId]);
});

test("initializes the trusted Admin client before creating a registration", async () => {
  const { fetchFn, calls } = successfulFetch();

  await assert.rejects(runDcrRegistrationProbe({
    resourceUrl,
    supabaseUrl,
    secretKey: "must-not-leak",
    fetchFn,
    adminFactory: () => { throw new Error("provider secret"); },
    runId: "safe-run-id",
  }), /^Error: DCR probe configuration failed$/);

  assert.equal(calls.some((call) => call.url === registrationEndpoint), false);
});

test("proves the Admin credential works before creating a registration", async () => {
  const { fetchFn, calls } = successfulFetch();

  await assert.rejects(runDcrRegistrationProbe({
    resourceUrl,
    supabaseUrl,
    fetchFn,
    admin: {
      listClients: async () => { throw new Error("provider secret"); },
      deleteClient: async () => undefined,
    },
    runId: "safe-run-id",
  }), /^Error: DCR probe configuration failed$/);

  assert.equal(calls.some((call) => call.url === registrationEndpoint), false);
});
