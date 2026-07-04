import { describe, it, expect, vi } from "vitest";

vi.mock("../db/embed.js", () => ({
  EMBED_DIM: 1536,
  embed: vi.fn(async () => Array.from({ length: 1536 }, () => 0.01)),
}));

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildMcpServer } from "./server.js";
import { BRIAN_INSTRUCTIONS } from "./instructions.js";

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
});
