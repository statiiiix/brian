import {
  CANONICAL_MCP_URL,
  PACKAGE_VERSION,
  protectedResourceMetadataUrl,
  rootProtectedResourceMetadataUrl,
} from "../constants.mjs";

function check(name, ok, detail) {
  return { name, status: ok ? "pass" : "fail", detail };
}

function validEndpoint(value, allowHttp) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (allowHttp && url.protocol === "http:");
  } catch {
    return false;
  }
}

function validateProtectedMetadata(metadata, resourceUrl, allowHttp) {
  if (!metadata || typeof metadata !== "object") return "metadata is not an object";
  if (metadata.resource !== resourceUrl) return "resource does not exactly match the canonical MCP URL";
  if (!Array.isArray(metadata.authorization_servers) || metadata.authorization_servers.length === 0) {
    return "authorization_servers is missing";
  }
  if (!metadata.authorization_servers.every((url) => validEndpoint(url, allowHttp))) {
    return "authorization_servers contains an invalid URL";
  }
  return null;
}

export function authorizationServerMetadataUrl(issuer) {
  const url = new URL(issuer);
  const issuerPath = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
  return new URL(`/.well-known/oauth-authorization-server${issuerPath}`, url.origin).toString();
}

async function fetchJson(fetchFn, url, timeoutMs) {
  const response = await fetchFn(url, {
    method: "GET",
    headers: { accept: "application/json" },
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) return { response, error: `HTTP ${response.status}` };
  try {
    return { response, value: await response.json() };
  } catch {
    return { response, error: "response was not JSON" };
  }
}

export async function runNetworkDoctor({
  fetchFn = globalThis.fetch,
  resourceUrl = CANONICAL_MCP_URL,
  timeoutMs = 5000,
  allowHttp = false,
} = {}) {
  const checks = [];
  const metadataUrl = protectedResourceMetadataUrl(resourceUrl);
  const rootMetadataUrl = rootProtectedResourceMetadataUrl(resourceUrl);
  let metadata = null;

  try {
    const result = await fetchJson(fetchFn, metadataUrl, timeoutMs);
    if (result.error) checks.push(check("protected-resource-metadata", false, result.error));
    else {
      const validation = validateProtectedMetadata(result.value, resourceUrl, allowHttp);
      checks.push(check("protected-resource-metadata", !validation, validation ?? "path metadata is valid"));
      if (!validation) metadata = result.value;
    }
  } catch {
    checks.push(check("protected-resource-metadata", false, "request failed"));
  }

  try {
    const result = await fetchJson(fetchFn, rootMetadataUrl, timeoutMs);
    if (result.error) checks.push(check("root-protected-resource-metadata", false, result.error));
    else {
      const validation = validateProtectedMetadata(result.value, resourceUrl, allowHttp);
      checks.push(check("root-protected-resource-metadata", !validation, validation ?? "root metadata is valid"));
    }
  } catch {
    checks.push(check("root-protected-resource-metadata", false, "request failed"));
  }

  if (!metadata) {
    checks.push(check("authorization-server-discovery", false, "protected-resource metadata was unavailable"));
  } else {
    const issuer = metadata.authorization_servers[0];
    const discoveryUrl = authorizationServerMetadataUrl(issuer);
    try {
      const result = await fetchJson(fetchFn, discoveryUrl, timeoutMs);
      if (result.error) checks.push(check("authorization-server-discovery", false, result.error));
      else {
        const document = result.value;
        const endpointsValid =
          document &&
          typeof document === "object" &&
          document.issuer === issuer &&
          validEndpoint(document.authorization_endpoint, allowHttp) &&
          validEndpoint(document.token_endpoint, allowHttp) &&
          Array.isArray(document.code_challenge_methods_supported) &&
          document.code_challenge_methods_supported.includes("S256");
        checks.push(check(
          "authorization-server-discovery",
          Boolean(endpointsValid),
          endpointsValid ? "authorization server advertises authorization code + PKCE S256" : "discovery document is incomplete or issuer mismatched",
        ));
      }
    } catch {
      checks.push(check("authorization-server-discovery", false, "request failed"));
    }
  }

  try {
    const response = await fetchFn(resourceUrl, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": "2025-11-25",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "brian-cli-doctor", version: PACKAGE_VERSION },
        },
      }),
    });
    const header = response.headers.get("www-authenticate") ?? "";
    const metadataMatch = header.match(/resource_metadata\s*=\s*"([^"]+)"/i);
    const valid = response.status === 401 && /^\s*Bearer\b/i.test(header) && metadataMatch?.[1] === metadataUrl;
    checks.push(check(
      "mcp-unauthenticated-challenge",
      Boolean(valid),
      valid ? "401 challenge points to protected-resource metadata" : "expected a Bearer 401 challenge with exact resource_metadata",
    ));
  } catch {
    checks.push(check("mcp-unauthenticated-challenge", false, "request failed"));
  }

  return checks;
}
