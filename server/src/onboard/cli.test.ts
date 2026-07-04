import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

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
  it("--dry-run detects platforms but writes nothing", async () => {
    const home = await cursorHome("ob-");
    const { code, stdout } = await run(["--dry-run"], home);
    expect(code).toBe(0);
    expect(stdout.toLowerCase()).toContain("cursor");
    const m = JSON.parse(await readFile(path.join(home, ".cursor", "mcp.json"), "utf8"));
    expect(m.mcpServers.brian).toBeUndefined(); // nothing written
  });

  it("--yes applies, and a later --status reports wired", async () => {
    const home = await cursorHome("ob-");
    const applied = await run(["--yes", "--only", "cursor"], home);
    expect(applied.code).toBe(0);
    const m = JSON.parse(await readFile(path.join(home, ".cursor", "mcp.json"), "utf8"));
    expect(m.mcpServers.brian).toBeTruthy();
    const status = await run(["--status", "--only", "cursor"], home);
    expect(status.stdout).toMatch(/cursor.*wired/i);
  });

  it("exits 1 and reports the refusal when a detected config is unparseable", async () => {
    const home = await cursorHome("ob-", "{broken");
    const { code, stdout } = await run(["--yes", "--only", "cursor"], home);
    expect(code).toBe(1);
    expect(stdout.toLowerCase()).toContain("unparseable");
  });

  it("--status shows a table with all platforms and detection state", async () => {
    const home = await cursorHome("ob-");
    const { code, stdout } = await run(["--status"], home);
    expect(code).toBe(0);
    expect(stdout).toMatch(/Claude Code/);
    expect(stdout).toMatch(/Cursor/);
    expect(stdout.toLowerCase()).toContain("detected");
  });

  it("--only with an unknown platform detects nothing (exit 0)", async () => {
    const home = await cursorHome("ob-");
    const { code, stdout } = await run(["--yes", "--only", "nope"], home);
    expect(code).toBe(0);
    expect(stdout.toLowerCase()).toContain("no supported");
  });

  it("--url without --token errors with exit 2", async () => {
    const home = await cursorHome("ob-");
    const { code, stderr } = await run(["--yes", "--url", "https://x.example.com"], home);
    expect(code).toBe(2);
    expect(stderr.toLowerCase()).toContain("token");
  });
});
