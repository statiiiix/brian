#!/usr/bin/env node
// Live, credential-redacting MCP OAuth smoke check. It never prints response
// bodies, bearer values, JWT claims, authorization codes, or callback URLs.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const resource = (process.env.MCP_SMOKE_RESOURCE || "https://api.brianthebrain.app/mcp").replace(/\/$/, "");
const origin = new URL(resource).origin;
const resourcePath = new URL(resource).pathname.replace(/^\//, "");
const pathMetadata = `${origin}/.well-known/oauth-protected-resource/${resourcePath}`;
const rootMetadata = `${origin}/.well-known/oauth-protected-resource`;
const token = process.env.MCP_SMOKE_ACCESS_TOKEN || "";
const expectRevoked = /^(1|true|yes)$/i.test(process.env.MCP_SMOKE_EXPECT_REVOKED || "");
const findSkillQuery = process.env.MCP_SMOKE_FIND_SKILL_QUERY || "";
const expectedFindText = process.env.MCP_SMOKE_EXPECT_TEXT || "";

async function json(url) {
  const response = await fetch(url, { headers: { accept: "application/json" }, redirect: "error" });
  assert.equal(
    response.ok,
    true,
    `discovery request failed for ${new URL(url).pathname} (${response.status})`,
  );
  return response.json();
}

function discoveryCandidates(issuer) {
  const url = new URL(issuer);
  const path = url.pathname.replace(/^\/+|\/+$/g, "");
  return path ? [
    `${url.origin}/.well-known/oauth-authorization-server/${path}`,
    `${url.origin}/.well-known/openid-configuration/${path}`,
    `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`,
  ] : [
    `${url.origin}/.well-known/oauth-authorization-server`,
    `${url.origin}/.well-known/openid-configuration`,
  ];
}

function decodePayload(jwt) {
  const part = jwt.split(".")[1];
  if (!part) throw new Error("smoke token is not a JWT");
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

async function mcp(payload, bearer = "", sessionId = "") {
  return fetch(resource, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2025-11-25",
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify(payload),
    redirect: "error",
  });
}

async function mcpMessage(response) {
  const body = await response.text();
  try {
    if (response.headers.get("content-type")?.includes("text/event-stream")) {
      const data = body.split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .find(Boolean);
      if (!data) throw new Error("missing MCP event data");
      return JSON.parse(data);
    }
    return JSON.parse(body);
  } catch {
    throw new Error("MCP returned an unreadable protocol response");
  }
}

const pathDoc = await json(pathMetadata);
const rootDoc = await json(rootMetadata);
for (const doc of [pathDoc, rootDoc]) {
  assert.equal(doc.resource, resource, "protected resource is not canonical");
  assert.equal(Array.isArray(doc.authorization_servers), true, "authorization_servers missing");
  assert.equal(doc.authorization_servers.length > 0, true, "authorization server missing");
}

let authorizationMetadata = null;
for (const candidate of discoveryCandidates(pathDoc.authorization_servers[0])) {
  try {
    authorizationMetadata = await json(candidate);
    break;
  } catch {
    // MCP discovery deliberately tries the RFC-defined candidates in order.
  }
}
assert.ok(authorizationMetadata, "authorization-server discovery failed");
assert.ok(authorizationMetadata.authorization_endpoint, "authorization endpoint missing");
assert.ok(authorizationMetadata.token_endpoint, "token endpoint missing");
assert.ok(authorizationMetadata.code_challenge_methods_supported?.includes("S256"), "PKCE S256 missing");

// Exercise the authorization route with a deliberately non-authoritative
// synthetic request. A provider may reject the unknown client with 4xx; that
// still proves the advertised endpoint is routed. Redirects are never followed
// and the synthetic state/challenge are never printed.
const authorizationEndpoint = new URL(authorizationMetadata.authorization_endpoint);
assert.equal(authorizationEndpoint.protocol, "https:", "authorization endpoint is not HTTPS");
const verifier = "brian-public-smoke-pkce-verifier-0000000000000000";
const challenge = createHash("sha256").update(verifier).digest("base64url");
authorizationEndpoint.search = new URLSearchParams({
  response_type: "code",
  client_id: process.env.MCP_SMOKE_CLIENT_ID || "brian-public-smoke-unregistered",
  redirect_uri: "http://127.0.0.1:49152/callback",
  scope: "email",
  state: "brian-public-smoke-state",
  code_challenge: challenge,
  code_challenge_method: "S256",
  resource,
}).toString();
const authorizationReachability = await fetch(authorizationEndpoint, {
  headers: { accept: "text/html, application/json" },
  redirect: "manual",
});
assert.ok(
  authorizationReachability.status >= 200
    && authorizationReachability.status < 500
    && authorizationReachability.status !== 404,
  `authorization endpoint is not reachable (${authorizationReachability.status})`,
);

const unauthenticated = await mcp({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "brian-smoke", version: "1" } },
});
assert.equal(unauthenticated.status, 401, "unauthenticated MCP did not challenge");
assert.match(unauthenticated.headers.get("www-authenticate") || "", /resource_metadata=/, "resource challenge missing");

if (!token) {
  process.stdout.write("MCP OAuth public discovery smoke passed (authenticated checks skipped: MCP_SMOKE_ACCESS_TOKEN unset).\n");
  process.exit(0);
}

const claims = decodePayload(token);
assert.equal(claims.aud, resource, "smoke token audience is not the canonical resource");
assert.equal(claims.brian_resource, resource, "smoke token resource claim is invalid");
assert.equal(claims.brian_token_type, "mcp", "smoke token is not an MCP credential");
assert.ok(claims.tenant_id && claims.client_id && claims.brian_connection_id, "smoke token lacks Brian principal claims");

const authenticated = await mcp({
  jsonrpc: "2.0",
  id: 2,
  method: "initialize",
  params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "brian-smoke", version: "1" } },
}, token);

if (expectRevoked) {
  assert.ok([401, 403].includes(authenticated.status), "revoked connection still reached MCP");
  process.stdout.write("MCP OAuth revocation smoke passed.\n");
} else {
  assert.equal(authenticated.ok, true, `authenticated MCP initialize failed (${authenticated.status})`);
  const initialized = await mcpMessage(authenticated);
  assert.ok(initialized?.result, "MCP initialize returned no result");
  const sessionId = authenticated.headers.get("mcp-session-id") || "";

  const listed = await mcp({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} }, token, sessionId);
  assert.equal(listed.ok, true, `authenticated MCP tools/list failed (${listed.status})`);
  const listMessage = await mcpMessage(listed);
  const toolNames = listMessage?.result?.tools?.map((tool) => tool.name);
  assert.ok(Array.isArray(toolNames), "MCP tools/list returned no tools");
  const permissions = Array.isArray(claims.brian_permissions) ? claims.brian_permissions : [];
  const expectedTools = {
    "skills:read": ["find_skill", "get_skill"],
    "context:read": ["find_context"],
    "knowledge:write": ["capture"],
    "executions:write": ["log_execution"],
    "actions:execute": ["get_order", "issue_refund", "create_email_draft", "send_email"],
  };
  for (const [permission, names] of Object.entries(expectedTools)) {
    for (const name of names) {
      assert.equal(
        toolNames.includes(name),
        permissions.includes(permission),
        `tool filtering does not match ${permission}`,
      );
    }
  }

  if (findSkillQuery) {
    assert.ok(permissions.includes("skills:read"), "smoke token cannot call find_skill");
    const called = await mcp({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "find_skill", arguments: { query: findSkillQuery } },
    }, token, sessionId);
    assert.equal(called.ok, true, `authenticated MCP find_skill failed (${called.status})`);
    const callMessage = await mcpMessage(called);
    assert.ok(callMessage?.result && !callMessage.error, "find_skill returned a protocol error");
    if (expectedFindText) {
      const text = callMessage.result.content?.map((item) => item.text || "").join("\n") || "";
      assert.ok(text.includes(expectedFindText), "find_skill did not return the expected synthetic result");
    }
  }

  process.stdout.write("MCP OAuth discovery, token binding, initialize, and permission-filtered tools/list smoke passed.\n");
}
