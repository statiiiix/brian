import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const CANONICAL_MCP_URL = "https://api.brianthebrain.app/mcp";

const script = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../scripts/onboard/onboard.mjs",
);

function run(args: string[], home: string) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    execFile(
      process.execPath,
      [script, ...args],
      { env: { ...process.env, HOME: home } },
      (err, stdout, stderr) => {
        const code = (err as { code?: number } | null)?.code;
        if (err && code === undefined) return reject(err);
        resolve({ code: code ?? 0, stdout, stderr });
      },
    );
  });
}

async function cursorHome(prefix: string, mcp = '{"mcpServers":{}}') {
  const home = await mkdtemp(path.join(tmpdir(), prefix));
  await mkdir(path.join(home, ".cursor"));
  await writeFile(path.join(home, ".cursor", "mcp.json"), mcp);
  return home;
}

describe("onboard CLI", () => {
  it("legacy --dry-run shorthand delegates to the public CLI without writing", async () => {
    const home = await cursorHome("ob-");
    const { code, stdout, stderr } = await run(["--dry-run"], home);
    expect(code).toBe(0);
    expect(stdout.toLowerCase()).toContain("cursor");
    expect(stderr).toContain("compatibility alias");
    const m = JSON.parse(await readFile(path.join(home, ".cursor", "mcp.json"), "utf8"));
    expect(m.mcpServers.brian).toBeUndefined(); // nothing written
  });

  it("legacy --yes applies the canonical OAuth URL, and --status reports connected", async () => {
    const home = await cursorHome("ob-");
    const applied = await run(["--yes", "--only", "cursor"], home);
    expect(applied.code).toBe(0);
    const m = JSON.parse(await readFile(path.join(home, ".cursor", "mcp.json"), "utf8"));
    expect(m.mcpServers.brian).toEqual({ type: "http", url: CANONICAL_MCP_URL });
    expect(m.mcpServers.brian.headers).toBeUndefined();
    const status = await run(["--status", "--only", "cursor"], home);
    expect(status.stdout).toMatch(/cursor[\s\S]*connected/i);
  });

  it("exits 1 and reports the refusal when a detected config is malformed", async () => {
    const home = await cursorHome("ob-", "{broken");
    const { code, stdout } = await run(["--yes", "--only", "cursor"], home);
    expect(code).toBe(1);
    expect(stdout.toLowerCase()).toContain("malformed json");
  });

  it("--status preserves the legacy shorthand and inspects all public platforms", async () => {
    const home = await cursorHome("ob-");
    const { code, stdout } = await run(["--status"], home);
    expect(code).toBe(0);
    expect(stdout).toMatch(/Claude Code/);
    expect(stdout).toMatch(/Cursor/);
    expect(stdout.toLowerCase()).toContain("detected");
  });

  it("uses the public CLI's strict client-name validation", async () => {
    const home = await cursorHome("ob-");
    const { code, stderr } = await run(["--yes", "--only", "nope"], home);
    expect(code).toBe(2);
    expect(stderr).toContain("unknown client name");
  });

  it("retires remote static-token flags before delegation and never echoes the secret", async () => {
    const home = await cursorHome("ob-");
    const secret = "legacy-secret-must-not-leak";
    const { code, stdout, stderr } = await run([
      "--yes",
      "--url",
      "https://x.example.com",
      "--token",
      secret,
    ], home);
    expect(code).toBe(2);
    expect(stderr).toContain("hosted OAuth flow");
    expect(`${stdout}${stderr}`).not.toContain(secret);
    const m = JSON.parse(await readFile(path.join(home, ".cursor", "mcp.json"), "utf8"));
    expect(m.mcpServers.brian).toBeUndefined();
  });

  it("passes explicit public CLI commands through and keeps JSON stdout parseable", async () => {
    const home = await cursorHome("ob-");
    const { code, stdout, stderr } = await run(["status", "--only", "cursor", "--json"], home);
    expect(code).toBe(0);
    expect(stderr).toContain("compatibility alias");
    const result = JSON.parse(stdout);
    expect(result.command).toBe("status");
    expect(result.canonicalMcpUrl).toBe(CANONICAL_MCP_URL);
  });
});
