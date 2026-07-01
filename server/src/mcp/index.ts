import { loadServerEnv } from "../env.js";
loadServerEnv();

// Dynamic imports so env is loaded before any module reads process.env at import time.
const { StdioServerTransport } = await import(
  "@modelcontextprotocol/sdk/server/stdio.js"
);
const { buildMcpServer } = await import("./server.js");

const server = buildMcpServer();
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Brian MCP server running on stdio");
