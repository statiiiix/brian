import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/embed.js", () => ({
  EMBED_DIM: 1536,
  embed: vi.fn(async () => Array.from({ length: 1536 }, () => 0.01)),
}));

// The gate's persistence layer. Stateless MCP means session state lives in the
// database; these fakes stand in for it so the enforcement path can be tested
// without one.
const session: {
  governing: unknown[];
  facts: Record<string, unknown>;
  decisions: { tool: string; decision: string }[];
} = { governing: [], facts: {}, decisions: [] };

vi.mock("../policy/repo.js", () => ({
  parsePolicyColumn: (v: unknown) => v ?? { constraints: [], advisory: [], compiled_at: null },
  sessionKey: () => "test-session",
  recordConsultation: vi.fn(async () => {}),
  recordFact: vi.fn(async (subject: string, value: unknown) => { session.facts[subject] = value; }),
  loadGoverningPolicies: vi.fn(async () => session.governing),
  loadFacts: vi.fn(async () => session.facts),
  recordDecision: vi.fn(async (r: { tool: string; decision: { decision: string } }) => {
    session.decisions.push({ tool: r.tool, decision: r.decision.decision });
  }),
  setSkillPolicy: vi.fn(async () => {}),
  listPendingPolicySkills: vi.fn(async () => []),
  pruneSessionState: vi.fn(async () => 0),
  SESSION_TTL_MINUTES: 60,
}));

vi.mock("../identity/repo.js", () => ({
  markFirstMcpCall: vi.fn(async () => {}),
  writeAuditEvent: vi.fn(async () => {}),
}));

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildMcpServer } from "./server.js";
import { BRIAN_INSTRUCTIONS } from "./instructions.js";
import type { McpPrincipal } from "../auth/principal.js";

describe("mcp server always-on surface", () => {
  it("declares instructions that mandate find_skill before acting", async () => {
    const server = buildMcpServer();
    const client = new Client({ name: "test", version: "0.0.0" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);

    const instructions = client.getInstructions();
    expect(instructions).toBe(BRIAN_INSTRUCTIONS);
    expect(instructions).toContain("find_skill");
    expect(instructions).toContain("find_context");
    expect(instructions).toContain("log_execution");
    expect(instructions).toMatch(/before/i);

    const tools = await client.listTools();
    const find = tools.tools.find((t) => t.name === "find_skill");
    expect(find?.description).toMatch(/ALWAYS/);
    expect(find?.description).toMatch(/before/i);
    const ctx = tools.tools.find((t) => t.name === "find_context");
    expect(ctx?.description).toMatch(/every task/i);

    await client.close();
    await server.close();
  });

  it("exposes only tools allowed by the current grant", async () => {
    const principal: McpPrincipal = {
      kind: "mcp",
      tenantId: "20000000-0000-0000-0000-000000000002",
      userId: "10000000-0000-0000-0000-000000000001",
      clientId: "test-client",
      connectionId: "30000000-0000-0000-0000-000000000003",
      role: "expert",
      permissions: ["skills:read", "context:read", "executions:write"],
    };
    const server = buildMcpServer(principal);
    const client = new Client({ name: "test", version: "0.0.0" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);

    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).toContain("find_skill");
    expect(names).toContain("find_context");
    expect(names).toContain("log_execution");
    expect(names).not.toContain("capture");
    expect(names).not.toContain("send_email");
    expect(names).not.toContain("issue_refund");

    await client.close();
    await server.close();
  });
});

// --- Server-side enforcement (goal 4.1) ---------------------------------
// The claim these tests defend: a refund over the company's limit is refused by
// Brian, not by the model's goodwill. Nothing here consults an LLM.
const REFUND_SKILL = {
  skill_id: "11111111-1111-1111-1111-111111111111",
  skill_name: "Refund Handling",
  escalation_target: "finance@acme.com",
  policy: {
    compiled_at: "2026-07-24T00:00:00Z",
    pending: false,
    advisory: [],
    constraints: [{
      id: "c1",
      source_rule: "Never refund more than $200 without approval.",
      tools: ["issue_refund"],
      check: { kind: "max", field: "args.amount", value: 200 },
      message: "Refunds over $200 need approval.",
    }],
  },
};

async function connectServer() {
  const server = buildMcpServer();
  const client = new Client({ name: "test", version: "0.0.0" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  return { server, client, close: async () => { await client.close(); await server.close(); } };
}

function textOf(result: unknown): string {
  const content = (result as { content: { type: string; text?: string }[] }).content;
  return content.map((c) => c.text ?? "").join("\n");
}

describe("policy enforcement at the tool boundary", () => {
  beforeEach(() => {
    session.governing = [REFUND_SKILL];
    session.facts = {};
    session.decisions = [];
  });

  it("allows a refund inside the company's limit", async () => {
    const { client, close } = await connectServer();
    const result = await client.callTool({
      name: "issue_refund", arguments: { order_id: "ORD-1", amount: 40 },
    });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain('"refunded":true');
    expect(session.decisions).toContainEqual({ tool: "issue_refund", decision: "allow" });
    await close();
  });

  it("refuses a refund over the limit and never reaches the business tool", async () => {
    const { client, close } = await connectServer();
    const result = await client.callTool({
      name: "issue_refund", arguments: { order_id: "ORD-2", amount: 350 },
    });
    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toContain("POLICY_DENIED");
    expect(text).toContain("Never refund more than $200");
    expect(text).toContain("finance@acme.com");
    // The refusal must not be reversible by anything said in the conversation.
    expect(text).toMatch(/do not retry/i);
    expect(text).not.toContain('"refunded":true');
    expect(session.decisions).toContainEqual({ tool: "issue_refund", decision: "deny" });
    await close();
  });

  it("refuses irreversible actions when no skill has been consulted", async () => {
    session.governing = [];
    const { client, close } = await connectServer();
    const result = await client.callTool({
      name: "issue_refund", arguments: { order_id: "ORD-1", amount: 10 },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("No company skill was consulted");
    await close();
  });

  it("refuses under a skill whose rules were edited but not recompiled", async () => {
    session.governing = [{
      ...REFUND_SKILL,
      policy: { ...REFUND_SKILL.policy, pending: true, constraints: [] },
    }];
    const { client, close } = await connectServer();
    const result = await client.callTool({
      name: "issue_refund", arguments: { order_id: "ORD-1", amount: 10 },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/not been recompiled/i);
    await close();
  });

  it("lets safe lookups through and remembers what they established", async () => {
    const { client, close } = await connectServer();
    const result = await client.callTool({
      name: "get_order", arguments: { order_id: "ORD-2" },
    });
    expect(result.isError).toBeFalsy();
    expect(session.facts.order).toMatchObject({ id: "ORD-2", amount: 350 });
    await close();
  });

  it("checks a time-window rule against the order the agent looked up", async () => {
    session.governing = [{
      ...REFUND_SKILL,
      policy: {
        ...REFUND_SKILL.policy,
        constraints: [{
          id: "c2",
          source_rule: "No refunds on orders older than 90 days.",
          tools: ["issue_refund"],
          check: { kind: "max_age_days", field: "facts.order.placed_at", value: 90 },
          message: "Outside the refund window.",
        }],
      },
    }];
    const { client, close } = await connectServer();

    // Without the lookup the rule is unverifiable, so the action is refused.
    const blind = await client.callTool({
      name: "issue_refund", arguments: { order_id: "ORD-3", amount: 10 },
    });
    expect(blind.isError).toBe(true);
    expect(textOf(blind)).toMatch(/could not verify/i);

    // After the lookup it can be checked — ORD-3 is inside the window.
    await client.callTool({ name: "get_order", arguments: { order_id: "ORD-3" } });
    session.facts.order = { ...(session.facts.order as object), placed_at: new Date().toISOString() };
    const seeing = await client.callTool({
      name: "issue_refund", arguments: { order_id: "ORD-3", amount: 10 },
    });
    expect(seeing.isError).toBeFalsy();
    await close();
  });
});
