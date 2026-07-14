import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { runConnect, runDisconnect } from "../src/commands/clients.mjs";
import { CANONICAL_MCP_URL } from "../src/constants.mjs";
import { claudeDesktopConfigPath, claudeDesktopDirectory } from "../src/platforms/claudeDesktop.mjs";
import { claudeCode } from "../src/platforms/claudeCode.mjs";
import { claudeDesktop } from "../src/platforms/claudeDesktop.mjs";
import { codex } from "../src/platforms/codex.mjs";
import { cursor } from "../src/platforms/cursor.mjs";
import { createRuntime } from "../src/runtime.mjs";
import { temporaryHome, writeJson } from "./helpers.mjs";

function fixtureRuntime(home, overrides = {}) {
  return createRuntime({
    home,
    platform: "darwin",
    arch: "arm64",
    env: { HOME: home, PATH: "" },
    commandInfo: () => ({ installed: false, version: null }),
    ...overrides,
  });
}

test("all four adapters connect hermetically with exact URL-only config", async () => {
  const home = await temporaryHome();
  await mkdir(path.join(home, ".claude"), { recursive: true });
  await mkdir(path.join(home, ".cursor"), { recursive: true });
  await mkdir(path.join(home, ".codex"), { recursive: true });
  await mkdir(path.join(home, "Library", "Application Support", "Claude"), { recursive: true });
  const runtime = fixtureRuntime(home);
  const outcome = await runConnect({ only: null, dryRun: false, yes: true, json: true }, runtime);
  assert.equal(outcome.code, 0);
  assert.equal(outcome.result.status, "applied");

  const jsonFiles = [
    path.join(home, ".claude.json"),
    path.join(home, ".cursor", "mcp.json"),
    path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json"),
  ];
  for (const file of jsonFiles) {
    const document = JSON.parse(await readFile(file, "utf8"));
    assert.equal(document.mcpServers.brian.url, CANONICAL_MCP_URL);
    assert.equal("headers" in document.mcpServers.brian, false);
  }
  const codex = await readFile(path.join(home, ".codex", "config.toml"), "utf8");
  assert.match(codex, /oauth_resource/);
  assert.equal(/bearer|authorization/i.test(codex), false);
});

test("platform paths are architecture-neutral and Windows APPDATA is injectable", async () => {
  const home = await temporaryHome("brian-platform-");
  const arm = fixtureRuntime(home, { arch: "arm64" });
  const intel = fixtureRuntime(home, { arch: "x64" });
  assert.equal(claudeDesktopDirectory(arm), claudeDesktopDirectory(intel));

  const windows = fixtureRuntime(home, {
    platform: "win32",
    env: { HOME: home, APPDATA: path.join(home, "Roaming Data"), PATH: "" },
  });
  assert.equal(claudeDesktopDirectory(windows), path.join(home, "Roaming Data", "Claude"));
  assert.equal(claudeDesktopConfigPath(windows), path.join(home, "Roaming Data", "Claude", "claude_desktop_config.json"));
});

test("every platform exposes its fixed post-configuration login plan", async () => {
  const home = await temporaryHome("brian-login-plan-");
  const runtime = fixtureRuntime(home, { commandSupports: () => true });
  assert.deepEqual(codex.loginPlan(runtime).args, ["mcp", "login", "brian"]);
  assert.deepEqual(claudeCode.loginPlan(runtime).args, ["mcp", "login", "brian"]);
  assert.equal(cursor.loginPlan(runtime).kind, "manual");
  assert.equal(claudeDesktop.loginPlan(runtime).kind, "manual");
});

test("multi-client preflight failure prevents every planned write", async () => {
  const home = await temporaryHome("brian-platform-");
  await mkdir(path.join(home, ".cursor"), { recursive: true });
  await mkdir(path.join(home, ".codex"), { recursive: true });
  await writeFile(path.join(home, ".codex", "config.toml"), "[broken\n");
  const outcome = await runConnect({ only: ["cursor", "codex"], dryRun: false, yes: true, json: true }, fixtureRuntime(home));
  assert.equal(outcome.code, 1);
  assert.equal(outcome.result.status, "blocked");
  await assert.rejects(readFile(path.join(home, ".cursor", "mcp.json"), "utf8"));
});

test("disconnect preserves unrelated JSON and marker content", async () => {
  const home = await temporaryHome("brian-platform-");
  const cursorDir = path.join(home, ".cursor");
  await mkdir(cursorDir, { recursive: true });
  await writeJson(path.join(cursorDir, "mcp.json"), {
    keep: "yes",
    mcpServers: { other: { command: "x" }, brian: { type: "http", url: CANONICAL_MCP_URL } },
  });
  await writeFile(path.join(cursorDir, "AGENTS.md"), "# My rules\n\n# >>> brian >>>\nold\n# <<< brian <<<\n");
  const outcome = await runDisconnect({ only: ["cursor"], dryRun: false, yes: true, json: true }, fixtureRuntime(home));
  assert.equal(outcome.code, 0);
  const config = JSON.parse(await readFile(path.join(cursorDir, "mcp.json"), "utf8"));
  assert.equal(config.keep, "yes");
  assert.deepEqual(config.mcpServers.other, { command: "x" });
  assert.equal(config.mcpServers.brian, undefined);
  const agents = await readFile(path.join(cursorDir, "AGENTS.md"), "utf8");
  assert.match(agents, /# My rules/);
  assert.equal(agents.includes(">>> brian >>>"), false);
});
