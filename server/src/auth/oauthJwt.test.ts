import { beforeAll, describe, expect, it } from "vitest";
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from "jose";
import { MCP_RESOURCE } from "./constants.js";
import {
  verifyMcpOAuthToken,
  verifyMcpOAuthTokenDetailed,
  type McpOAuthJwtConfig,
} from "./oauthJwt.js";

const USER = "10000000-0000-0000-0000-000000000001";
const TENANT = "20000000-0000-0000-0000-000000000002";
const CONNECTION = "30000000-0000-0000-0000-000000000003";
const ISSUER = "https://project.supabase.co/auth/v1";

describe("MCP OAuth JWT validation", () => {
  let privateKey: CryptoKey;
  let publicJwk: JWK;

  beforeAll(async () => {
    const pair = await generateKeyPair("ES256", { extractable: true });
    privateKey = pair.privateKey;
    publicJwk = { ...(await exportJWK(pair.publicKey)), kid: "test-key", use: "sig", alg: "ES256" };
  });

  const config = (): McpOAuthJwtConfig => ({ issuer: ISSUER, jwks: { keys: [publicJwk] } });
  const sign = async (overrides: Record<string, unknown> = {}) => {
    const claims = {
      aud: MCP_RESOURCE,
      client_id: "codex-client",
      tenant_id: TENANT,
      brian_connection_id: CONNECTION,
      brian_role: "admin",
      brian_permissions: ["skills:read", "context:read", "executions:write"],
      brian_resource: MCP_RESOURCE,
      brian_token_type: "mcp",
      ...overrides,
    };
    return new SignJWT(claims)
      .setProtectedHeader({ alg: "ES256", kid: "test-key" })
      .setIssuer(ISSUER)
      .setSubject(USER)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
  };

  it("accepts a signature-valid, exact-resource MCP token", async () => {
    expect(await verifyMcpOAuthToken(await sign(), config())).toEqual({
      userId: USER,
      tenantId: TENANT,
      clientId: "codex-client",
      connectionId: CONNECTION,
      role: "admin",
      permissions: ["skills:read", "context:read", "executions:write"],
    });
  });

  it("rejects wrong or multi-valued audiences", async () => {
    const wrongAudience = await sign({ aud: "authenticated" });
    expect(await verifyMcpOAuthToken(wrongAudience, config())).toBeNull();
    expect(await verifyMcpOAuthTokenDetailed(wrongAudience, config())).toEqual({
      claims: null,
      failure: "wrong_audience",
    });
    expect(await verifyMcpOAuthToken(await sign({ aud: [MCP_RESOURCE, "other"] }), config())).toBeNull();
  });

  it("rejects missing server-controlled type/resource/client/grant claims", async () => {
    for (const patch of [
      { brian_token_type: "dashboard" },
      { brian_resource: "https://attacker.example/mcp" },
      { client_id: "" },
      { brian_connection_id: "not-a-uuid" },
      { tenant_id: undefined },
      { brian_permissions: [] },
      { brian_permissions: ["skills:read", "unknown:permission"] },
      { brian_permissions: ["skills:read", "skills:read"] },
      { brian_role: "superadmin" },
    ]) {
      expect(await verifyMcpOAuthToken(await sign(patch), config())).toBeNull();
    }
  });

  it("rejects wrong issuer and expired tokens", async () => {
    const wrongIssuer = await new SignJWT({
      aud: MCP_RESOURCE,
      client_id: "c",
      tenant_id: TENANT,
      brian_connection_id: CONNECTION,
      brian_role: "admin",
      brian_permissions: ["skills:read"],
      brian_resource: MCP_RESOURCE,
      brian_token_type: "mcp",
    })
      .setProtectedHeader({ alg: "ES256", kid: "test-key" })
      .setIssuer("https://wrong.example/auth/v1")
      .setSubject(USER)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    expect(await verifyMcpOAuthToken(wrongIssuer, config())).toBeNull();
    expect(await verifyMcpOAuthTokenDetailed(wrongIssuer, config())).toEqual({
      claims: null,
      failure: "wrong_issuer",
    });

    const expired = await new SignJWT({
      aud: MCP_RESOURCE,
      client_id: "c",
      tenant_id: TENANT,
      brian_connection_id: CONNECTION,
      brian_role: "admin",
      brian_permissions: ["skills:read"],
      brian_resource: MCP_RESOURCE,
      brian_token_type: "mcp",
    })
      .setProtectedHeader({ alg: "ES256", kid: "test-key" })
      .setIssuer(ISSUER)
      .setSubject(USER)
      .setIssuedAt(1)
      .setExpirationTime(2)
      .sign(privateKey);
    expect(await verifyMcpOAuthToken(expired, config())).toBeNull();
    expect(await verifyMcpOAuthTokenDetailed(expired, config())).toEqual({
      claims: null,
      failure: "expired",
    });
  });

  it("rejects an unexpectedly long-lived access token", async () => {
    const longLived = await new SignJWT({
      aud: MCP_RESOURCE,
      client_id: "c",
      tenant_id: TENANT,
      brian_connection_id: CONNECTION,
      brian_role: "admin",
      brian_permissions: ["skills:read"],
      brian_resource: MCP_RESOURCE,
      brian_token_type: "mcp",
    })
      .setProtectedHeader({ alg: "ES256", kid: "test-key" })
      .setIssuer(ISSUER)
      .setSubject(USER)
      .setIssuedAt()
      .setExpirationTime("2h")
      .sign(privateKey);
    expect(await verifyMcpOAuthToken(longLived, config())).toBeNull();
    expect(await verifyMcpOAuthTokenDetailed(longLived, config())).toEqual({
      claims: null,
      failure: "invalid_lifetime",
    });
    expect(await verifyMcpOAuthToken(longLived, {
      ...config(), maxTokenLifetimeSeconds: 7_200,
    })).not.toBeNull();
  });

  it("rejects wrong keys, not-yet-valid tokens, and future issued-at claims", async () => {
    const otherPair = await generateKeyPair("ES256", { extractable: true });
    const wrongKey = await new SignJWT({
      aud: MCP_RESOURCE,
      client_id: "c",
      tenant_id: TENANT,
      brian_connection_id: CONNECTION,
      brian_role: "admin",
      brian_permissions: ["skills:read"],
      brian_resource: MCP_RESOURCE,
      brian_token_type: "mcp",
    })
      .setProtectedHeader({ alg: "ES256", kid: "test-key" })
      .setIssuer(ISSUER)
      .setSubject(USER)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(otherPair.privateKey);
    expect(await verifyMcpOAuthToken(wrongKey, config())).toBeNull();
    expect(await verifyMcpOAuthTokenDetailed(wrongKey, config())).toEqual({
      claims: null,
      failure: "signature_or_key",
    });

    const notYetValid = await new SignJWT({
      aud: MCP_RESOURCE,
      client_id: "c",
      tenant_id: TENANT,
      brian_connection_id: CONNECTION,
      brian_role: "admin",
      brian_permissions: ["skills:read"],
      brian_resource: MCP_RESOURCE,
      brian_token_type: "mcp",
    })
      .setProtectedHeader({ alg: "ES256", kid: "test-key" })
      .setIssuer(ISSUER)
      .setSubject(USER)
      .setIssuedAt()
      .setNotBefore("5m")
      .setExpirationTime("10m")
      .sign(privateKey);
    expect(await verifyMcpOAuthToken(notYetValid, config())).toBeNull();
    expect(await verifyMcpOAuthTokenDetailed(notYetValid, config())).toEqual({
      claims: null,
      failure: "not_yet_valid",
    });

    const futureIssuedAt = await new SignJWT({
      aud: MCP_RESOURCE,
      client_id: "c",
      tenant_id: TENANT,
      brian_connection_id: CONNECTION,
      brian_role: "admin",
      brian_permissions: ["skills:read"],
      brian_resource: MCP_RESOURCE,
      brian_token_type: "mcp",
    })
      .setProtectedHeader({ alg: "ES256", kid: "test-key" })
      .setIssuer(ISSUER)
      .setSubject(USER)
      .setIssuedAt(Math.floor(Date.now() / 1000) + 300)
      .setExpirationTime(Math.floor(Date.now() / 1000) + 600)
      .sign(privateKey);
    expect(await verifyMcpOAuthToken(futureIssuedAt, config())).toBeNull();
    expect(await verifyMcpOAuthTokenDetailed(futureIssuedAt, config())).toEqual({
      claims: null,
      failure: "not_yet_valid",
    });
  });

  it("classifies server-controlled claim failures without returning claim material", async () => {
    expect(await verifyMcpOAuthTokenDetailed(
      await sign({ brian_token_type: "dashboard" }),
      config(),
    )).toEqual({ claims: null, failure: "invalid_resource_or_type" });
    expect(await verifyMcpOAuthTokenDetailed(
      await sign({ tenant_id: "not-a-uuid" }),
      config(),
    )).toEqual({ claims: null, failure: "malformed_claims" });
  });
});
