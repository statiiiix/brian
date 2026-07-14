import assert from "node:assert/strict";
import { lstat, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { runDoctor } from "../src/commands/doctor.mjs";
import { runStatus } from "../src/commands/clients.mjs";
import { CANONICAL_MCP_URL } from "../src/constants.mjs";
import { authorizationServerMetadataUrl, runNetworkDoctor } from "../src/doctor/network.mjs";
import { createRuntime } from "../src/runtime.mjs";
import { temporaryHome, writeJson } from "./helpers.mjs";

function goodFetch(resource, issuer, calls) {
  const metadataUrl = "http://resource.test/.well-known/oauth-protected-resource/mcp";
  const rootUrl = "http://resource.test/.well-known/oauth-protected-resource";
  const publicConfigUrl = "http://resource.test/api/public/config";
  const discoveryUrl = authorizationServerMetadataUrl(issuer);
  return async (url, init = {}) => {
    calls.push({ url, init });
    assert.equal(Object.keys(init.headers ?? {}).some((key) => key.toLowerCase() === "authorization"), false);
    if (url === metadataUrl || url === rootUrl) {
      return new Response(JSON.stringify({ resource, authorization_servers: [issuer] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url === discoveryUrl) {
      return new Response(JSON.stringify({
        issuer,
        authorization_endpoint: "http://auth.test/authorize",
        token_endpoint: "http://auth.test/token",
        registration_endpoint: "http://auth.test/oauth/clients/register",
        code_challenge_methods_supported: ["S256"],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url === publicConfigUrl) {
      return new Response(JSON.stringify({
        publicSignup: false,
        mcpOAuth: true,
        mcpOAuthApprovals: true,
        mcpDcr: true,
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url === resource) {
      return new Response('{"access_token":"body-secret-must-not-leak"}', {
        status: 401,
        headers: { "www-authenticate": `Bearer resource_metadata="${metadataUrl}"` },
      });
    }
    return new Response("not found", { status: 404 });
  };
}

test("network doctor validates metadata, discovery, and exact 401 challenge without auth headers", async () => {
  const resource = "http://resource.test/mcp";
  const issuer = "http://auth.test/issuer";
  const calls = [];
  const checks = await runNetworkDoctor({
    resourceUrl: resource,
    fetchFn: goodFetch(resource, issuer, calls),
    allowHttp: true,
    timeoutMs: 1000,
  });
  assert.equal(checks.length, 6);
  assert.equal(checks.every((item) => item.status === "pass"), true);
  assert.equal(JSON.stringify(checks).includes("body-secret-must-not-leak"), false);
  assert.equal(calls.length, 5);
});

test("network doctor fails when authorization discovery does not advertise DCR", async () => {
  const resource = "http://resource.test/mcp";
  const issuer = "http://auth.test/issuer";
  const discoveryUrl = authorizationServerMetadataUrl(issuer);
  const base = goodFetch(resource, issuer, []);
  const fetchFn = async (url, init) => {
    if (url === discoveryUrl) {
      return new Response(JSON.stringify({
        issuer,
        authorization_endpoint: "http://auth.test/authorize",
        token_endpoint: "http://auth.test/token",
        code_challenge_methods_supported: ["S256"],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return base(url, init);
  };

  const checks = await runNetworkDoctor({ resourceUrl: resource, fetchFn, allowHttp: true });
  assert.equal(checks.find((item) => item.name === "dynamic-client-registration-advertised").status, "fail");
});

test("network doctor warns when Brian's public marker pauses new registrations", async () => {
  const resource = "http://resource.test/mcp";
  const issuer = "http://auth.test/issuer";
  const base = goodFetch(resource, issuer, []);
  const fetchFn = async (url, init) => {
    if (url === "http://resource.test/api/public/config") {
      return new Response(JSON.stringify({
        publicSignup: false,
        mcpOAuth: true,
        mcpOAuthApprovals: true,
        mcpDcr: false,
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return base(url, init);
  };

  const checks = await runNetworkDoctor({ resourceUrl: resource, fetchFn, allowHttp: true });
  assert.equal(checks.find((item) => item.name === "brian-oauth-availability").status, "warn");
});

test("network doctor fails closed on wrong challenge metadata", async () => {
  const resource = "http://resource.test/mcp";
  const issuer = "http://auth.test/issuer";
  const base = goodFetch(resource, issuer, []);
  const fetchFn = async (url, init) => {
    if (url === resource) {
      return new Response("", {
        status: 401,
        headers: { "www-authenticate": 'Bearer resource_metadata="http://evil.test/metadata"' },
      });
    }
    return base(url, init);
  };
  const checks = await runNetworkDoctor({ resourceUrl: resource, fetchFn, allowHttp: true });
  assert.equal(checks.find((item) => item.name === "mcp-unauthenticated-challenge").status, "fail");
});

test("full doctor reports legacy static config without exposing its value", async () => {
  const home = await temporaryHome("brian-doctor-");
  const cursorDir = path.join(home, ".cursor");
  const secret = "doctor-secret-must-not-leak";
  await mkdir(cursorDir, { recursive: true });
  await writeJson(path.join(cursorDir, "mcp.json"), {
    mcpServers: {
      brian: {
        type: "http",
        url: "https://project.supabase.co/functions/v1/brian/mcp",
        headers: { Authorization: `Bearer ${secret}` },
      },
    },
  });
  const resource = "http://resource.test/mcp";
  const issuer = "http://auth.test/issuer";
  const runtime = createRuntime({
    home,
    platform: "linux",
    env: { HOME: home, PATH: "", DISPLAY: ":1" },
    commandInfo: () => ({ installed: false, version: null }),
    fetch: goodFetch(resource, issuer, []),
  });
  const outcome = await runDoctor(
    { only: ["cursor"], resourceUrl: resource, allowHttp: true, timeoutMs: 1000 },
    runtime,
  );
  assert.equal(outcome.code, 1);
  assert.equal(JSON.stringify(outcome.result).includes(secret), false);
  assert.equal(outcome.result.checks.some((item) => item.name === "cursor:static-credential"), true);
});

test("doctor records a private identity-free health result for status", async () => {
  const home = await temporaryHome("brian-health-");
  const cursorDir = path.join(home, ".cursor");
  await mkdir(cursorDir, { recursive: true });
  await writeJson(path.join(cursorDir, "mcp.json"), {
    mcpServers: { brian: { type: "http", url: CANONICAL_MCP_URL } },
  });
  const resource = "http://resource.test/mcp?identity=must-not-persist";
  const issuer = "http://auth.test/issuer";
  const checkedAt = new Date("2026-07-13T08:00:00.000Z");
  const runtime = createRuntime({
    home,
    platform: "linux",
    env: { HOME: home, PATH: "", DISPLAY: ":1" },
    commandInfo: () => ({ installed: false, version: null }),
    fetch: goodFetch(resource, issuer, []),
    now: () => checkedAt,
  });

  const doctor = await runDoctor({
    only: ["cursor"],
    resourceUrl: resource,
    allowHttp: true,
    timeoutMs: 1000,
  }, runtime);
  assert.equal(doctor.result.status, "healthy");
  assert.deepEqual(doctor.result.oauthEvidence, {
    registration: "advertised",
    localClient: "ready",
  });
  assert.equal(doctor.result.checks.some((item) =>
    item.name === "cursor:native-login" && item.status === "pass"), true);
  assert.equal(JSON.stringify(doctor.result).includes("proven"), false);

  const file = path.join(home, ".brian", "health.json");
  const contents = await readFile(file, "utf8");
  assert.equal(contents.includes("identity="), false);
  assert.equal((await lstat(file)).mode & 0o777, 0o600);
  assert.deepEqual(runStatus({ only: ["cursor"] }, runtime).result.lastHealthCheck, {
    schemaVersion: 1,
    status: "healthy",
    checkedAt: checkedAt.toISOString(),
    resource: "http://resource.test/mcp",
  });
});

test("doctor does not treat a native login command as completed OAuth compatibility evidence", async () => {
  const home = await temporaryHome("brian-native-unverified-");
  await mkdir(path.join(home, ".claude"), { recursive: true });
  await writeJson(path.join(home, ".claude.json"), {
    mcpServers: { brian: { type: "http", url: CANONICAL_MCP_URL } },
  });
  const resource = "http://resource.test/mcp";
  const issuer = "http://auth.test/issuer";
  const runtime = createRuntime({
    home,
    platform: "linux",
    env: { HOME: home, PATH: "", DISPLAY: ":1" },
    commandInfo: () => ({ installed: true, version: "Claude Code 2.1.198" }),
    commandSupports: () => false,
    fetch: goodFetch(resource, issuer, []),
  });

  const outcome = await runDoctor({
    only: ["claude-code"],
    resourceUrl: resource,
    allowHttp: true,
    timeoutMs: 1000,
  }, runtime);
  assert.equal(outcome.result.clients[0].oauthCapability, "native-command-surface-unverified");
  assert.equal(outcome.result.checks.some((item) =>
    item.name === "claude-code:oauth-compatibility" && item.status === "warn"), true);
  const readiness = outcome.result.checks.find((item) => item.name === "claude-code:native-login");
  assert.equal(readiness.status, "warn");
  assert.equal(readiness.detail,
    "Upgrade Claude Code or run the Brian connection from Claude's MCP settings.");
  assert.deepEqual(outcome.result.oauthEvidence, {
    registration: "advertised",
    localClient: "not-ready",
  });
  assert.equal(JSON.stringify(outcome.result).includes("proven"), false);
});
