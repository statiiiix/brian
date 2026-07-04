import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as claudeCode from "../../scripts/onboard/adapters/claudeCode.mjs";
import * as desktop from "../../scripts/onboard/adapters/claudeDesktop.mjs";

const OPTS = { serverPath: "/abs/server" };
const env = (home: string) => ({ home, platform: "darwin", serverPath: "/abs/server" });
const tmpHome = (prefix: string) => mkdtemp(path.join(tmpdir(), prefix));

describe("adapter: claude-code", () => {
  it("detects ~/.claude and plans mcp + hooks files", async () => {
    const home = await tmpHome("cc-");
    await mkdir(path.join(home, ".claude"));
    expect(claudeCode.detect(env(home)).detected).toBe(true);
    const files = claudeCode.plan(env(home), OPTS).map((p) => p.file);
    expect(files).toContain(path.join(home, ".claude.json"));
    expect(files).toContain(path.join(home, ".claude", "settings.json"));
  });

  it("is not detected without ~/.claude", async () => {
    const home = await tmpHome("cc-");
    expect(claudeCode.detect(env(home)).detected).toBe(false);
  });

  it("apply wires the mcp entry and hooks, reports wired/wired, is idempotent", async () => {
    const home = await tmpHome("cc-");
    await mkdir(path.join(home, ".claude"));
    const res = await claudeCode.apply(env(home), OPTS);
    expect(res.skipped).toHaveLength(0);
    const cj = JSON.parse(await readFile(path.join(home, ".claude.json"), "utf8"));
    expect(cj.mcpServers.brian).toEqual({ command: "npm", args: ["--prefix", "/abs/server", "run", "mcp"] });
    const st = JSON.parse(await readFile(path.join(home, ".claude", "settings.json"), "utf8"));
    expect(st.hooks.SessionStart[0].hooks[0].command).toContain("brian-hook.mjs");
    expect(claudeCode.status(env(home))).toEqual({ mcp: "wired", alwaysOn: "wired" });

    const again = await claudeCode.apply(env(home), OPTS);
    expect(again.applied.every((a) => /already/.test(a.action))).toBe(true);
  });

  it("preserves existing ~/.claude.json keys when wiring", async () => {
    const home = await tmpHome("cc-");
    await mkdir(path.join(home, ".claude"));
    await writeFile(
      path.join(home, ".claude.json"),
      JSON.stringify({ numStartups: 5, mcpServers: { other: { command: "x" } } }),
    );
    await claudeCode.apply(env(home), OPTS);
    const cj = JSON.parse(await readFile(path.join(home, ".claude.json"), "utf8"));
    expect(cj.numStartups).toBe(5);
    expect(cj.mcpServers.other).toEqual({ command: "x" });
    expect(cj.mcpServers.brian).toBeTruthy();
  });

  it("refuses to modify an unparseable ~/.claude.json (hooks still wired)", async () => {
    const home = await tmpHome("cc-");
    await mkdir(path.join(home, ".claude"));
    await writeFile(path.join(home, ".claude.json"), "{broken");
    const res = await claudeCode.apply(env(home), OPTS);
    expect(res.skipped.some((s) => /unparseable/i.test(s.reason))).toBe(true);
    expect(await readFile(path.join(home, ".claude.json"), "utf8")).toBe("{broken");
    // the hook layer is independent and should still be applied
    expect(res.applied.some((a) => /hook/i.test(a.action))).toBe(true);
  });
});

const cdir = (home: string) => path.join(home, "Library", "Application Support", "Claude");

describe("adapter: claude-desktop", () => {
  it("merges brian into existing claude_desktop_config.json, preserving keys", async () => {
    const home = await tmpHome("cd-");
    await mkdir(cdir(home), { recursive: true });
    await writeFile(
      path.join(cdir(home), "claude_desktop_config.json"),
      JSON.stringify({ mcpServers: { other: { command: "x" } }, preferences: { a: 1 } }),
    );
    const res = await desktop.apply(env(home), OPTS);
    expect(res.skipped).toHaveLength(0);
    const c = JSON.parse(await readFile(path.join(cdir(home), "claude_desktop_config.json"), "utf8"));
    expect(c.mcpServers.other).toEqual({ command: "x" }); // preserved
    expect(c.preferences).toEqual({ a: 1 }); // preserved
    expect(c.mcpServers.brian).toBeTruthy();
    expect(desktop.status(env(home))).toEqual({ mcp: "wired", alwaysOn: "unsupported" });
  });

  it("creates claude_desktop_config.json when only the Claude dir exists", async () => {
    const home = await tmpHome("cd-");
    await mkdir(cdir(home), { recursive: true });
    await desktop.apply(env(home), OPTS);
    const c = JSON.parse(await readFile(path.join(cdir(home), "claude_desktop_config.json"), "utf8"));
    expect(c.mcpServers.brian).toBeTruthy();
  });

  it("is not detected without the Claude support dir", async () => {
    const home = await tmpHome("cd-");
    expect(desktop.detect(env(home)).detected).toBe(false);
  });
});
