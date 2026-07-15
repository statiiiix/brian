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
import { renderHuman } from "../src/output.mjs";
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

test("file-configured adapters connect hermetically with exact URL-only config", async () => {
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

test("Claude Desktop connect removes the invalid local HTTP entry and preserves unrelated settings", async () => {
  const home = await temporaryHome("brian-claude-desktop-migration-");
  const directory = path.join(home, "Library", "Application Support", "Claude");
  const configPath = path.join(directory, "claude_desktop_config.json");
  await mkdir(directory, { recursive: true });
  await writeJson(configPath, {
    keep: "yes",
    mcpServers: {
      other: { command: "other-server" },
      brian: { type: "http", url: CANONICAL_MCP_URL },
    },
  });

  const outcome = await runConnect(
    { only: ["claude-desktop"], dryRun: false, yes: true, json: true },
    fixtureRuntime(home),
  );

  assert.equal(outcome.code, 0);
  assert.equal(outcome.result.status, "applied");
  assert.equal(outcome.result.clients[0].restartRequired, false);
  assert.match(outcome.result.clients[0].nextStep, /Customize.*Connectors.*Add custom connector/i);
  assert.match(outcome.result.clients[0].nextStep, new RegExp(CANONICAL_MCP_URL.replaceAll("/", "\\/")));
  const config = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(config.keep, "yes");
  assert.deepEqual(config.mcpServers.other, { command: "other-server" });
  assert.equal(config.mcpServers.brian, undefined);
});

test("fresh Claude Desktop connect never writes a remote server into the local-server config", async () => {
  const home = await temporaryHome("brian-claude-desktop-clean-");
  const directory = path.join(home, "Library", "Application Support", "Claude");
  const configPath = path.join(directory, "claude_desktop_config.json");
  await mkdir(directory, { recursive: true });

  const outcome = await runConnect(
    { only: ["claude-desktop"], dryRun: false, yes: true, json: true },
    fixtureRuntime(home),
  );

  assert.equal(outcome.code, 0);
  assert.equal(outcome.result.status, "unchanged");
  assert.equal(outcome.result.changes.length, 0);
  assert.equal(outcome.result.authentication[0].authentication, "manual");
  assert.match(outcome.result.authentication[0].instruction, /claude\.ai\/customize\/connectors/);
  await assert.rejects(readFile(configPath, "utf8"));
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

test("every installed platform exposes its fixed post-configuration login plan", async () => {
  const home = await temporaryHome("brian-login-plan-");
  const runtime = fixtureRuntime(home, {
    commandInfo: () => ({ installed: true, version: "test" }),
    commandSupports: () => true,
  });
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

test("Codex connect blocks a conflicting project-level local Brian server", async () => {
  const home = await temporaryHome("brian-project-collision-home-");
  const project = await temporaryHome("brian-project-collision-workspace-");
  await mkdir(path.join(home, ".codex"), { recursive: true });
  await mkdir(path.join(project, ".codex"), { recursive: true });
  await writeFile(
    path.join(project, ".codex", "config.toml"),
    '[mcp_servers.brian]\ncommand = "npm"\nargs = ["run", "mcp"]\n',
  );

  const outcome = await runConnect(
    { only: ["codex"], dryRun: false, yes: true, json: true },
    fixtureRuntime(home, { cwd: project }),
  );

  assert.equal(outcome.code, 1);
  assert.equal(outcome.result.status, "blocked");
  assert.match(outcome.result.errors[0].reason, /project-level Codex config defines Brian as a local server/);
  await assert.rejects(readFile(path.join(home, ".codex", "config.toml"), "utf8"));
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

test("connect writes every config before invoking a confirmed native login", async () => {
  const home = await temporaryHome("brian-login-after-write-");
  await mkdir(path.join(home, ".codex"), { recursive: true });
  let configuredBeforeLogin = false;
  const calls = [];
  const runtime = fixtureRuntime(home, {
    commandInfo: () => ({ installed: true, version: "test" }),
    isInteractive: true,
    confirmLogin: async () => true,
    runInteractiveCommand: async (executable, args) => {
      configuredBeforeLogin = (await readFile(path.join(home, ".codex", "config.toml"), "utf8"))
        .includes(CANONICAL_MCP_URL);
      calls.push({ executable, args });
      return { status: "succeeded", exitCode: 0 };
    },
  });

  const outcome = await runConnect({
    only: ["codex"], dryRun: false, yes: true, json: false, noLogin: false,
  }, runtime);
  assert.equal(configuredBeforeLogin, true);
  assert.deepEqual(calls, [{ executable: "codex", args: ["mcp", "login", "brian"] }]);
  assert.deepEqual(outcome.result.authentication, [{
    client: "codex",
    configured: true,
    authentication: "authenticated",
    retryCommand: "codex mcp login brian",
    instruction: "Authenticate Brian now in Codex.",
  }]);
  assert.match(renderHuman(outcome.result), /^Configuration installed\n/);
});

test("multiple native logins run sequentially in stable platform order", async () => {
  const home = await temporaryHome("brian-login-order-");
  await mkdir(path.join(home, ".claude"), { recursive: true });
  await mkdir(path.join(home, ".codex"), { recursive: true });
  const calls = [];
  let active = 0;
  let maxActive = 0;
  const runtime = fixtureRuntime(home, {
    commandInfo: () => ({ installed: true, version: "test" }),
    isInteractive: true,
    commandSupports: () => true,
    confirmLogin: async () => true,
    runInteractiveCommand: async (executable, args) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      calls.push([executable, ...args]);
      await Promise.resolve();
      active -= 1;
      return { status: "succeeded", exitCode: 0 };
    },
  });

  await runConnect({
    only: ["codex", "claude-code"], dryRun: false, yes: true, json: false, noLogin: false,
  }, runtime);
  assert.deepEqual(calls, [
    ["claude", "mcp", "login", "brian"],
    ["codex", "mcp", "login", "brian"],
  ]);
  assert.equal(maxActive, 1);
});

test("JSON, dry-run, non-TTY, and --no-login never invoke native login", async () => {
  const cases = [
    { json: true, dryRun: false, noLogin: false, isInteractive: true },
    { json: false, dryRun: true, noLogin: false, isInteractive: true },
    { json: false, dryRun: false, noLogin: false, isInteractive: false },
    { json: false, dryRun: false, noLogin: true, isInteractive: true },
  ];
  for (const [index, item] of cases.entries()) {
    const home = await temporaryHome(`brian-login-suppressed-${index}-`);
    await mkdir(path.join(home, ".codex"), { recursive: true });
    let calls = 0;
    const runtime = fixtureRuntime(home, {
      isInteractive: item.isInteractive,
      confirmLogin: async () => true,
      runInteractiveCommand: async () => {
        calls += 1;
        return { status: "succeeded", exitCode: 0 };
      },
    });
    await runConnect({ only: ["codex"], yes: true, ...item }, runtime);
    assert.equal(calls, 0);
  }
});

test("native login failure preserves configuration and returns a safe retry", async () => {
  const home = await temporaryHome("brian-login-failure-");
  await mkdir(path.join(home, ".codex"), { recursive: true });
  const runtime = fixtureRuntime(home, {
    commandInfo: () => ({ installed: true, version: "test" }),
    isInteractive: true,
    confirmLogin: async () => true,
    runInteractiveCommand: async () => ({ status: "failed", exitCode: 7, stderr: "token-secret" }),
  });
  const outcome = await runConnect({
    only: ["codex"], dryRun: false, yes: true, json: false, noLogin: false,
  }, runtime);
  assert.equal(outcome.code, 1);
  assert.equal(outcome.result.status, "authentication-failed");
  assert.match(await readFile(path.join(home, ".codex", "config.toml"), "utf8"), /brianthebrain/);
  assert.deepEqual(outcome.result.authentication, [{
    client: "codex",
    configured: true,
    authentication: "failed",
    retryCommand: "codex mcp login brian",
    instruction: "Authenticate Brian now in Codex.",
    exitCode: 7,
  }]);
  assert.equal(JSON.stringify(outcome.result).includes("token-secret"), false);
});

test("an unchanged config can still authenticate and manual clients stay explicit", async () => {
  const home = await temporaryHome("brian-login-unchanged-");
  await mkdir(path.join(home, ".codex"), { recursive: true });
  await mkdir(path.join(home, ".cursor"), { recursive: true });
  await runConnect({
    only: ["codex", "cursor"], dryRun: false, yes: true, json: true, noLogin: false,
  }, fixtureRuntime(home));
  let calls = 0;
  const outcome = await runConnect({
    only: ["codex", "cursor"], dryRun: false, yes: true, json: false, noLogin: false,
  }, fixtureRuntime(home, {
    commandInfo: () => ({ installed: true, version: "test" }),
    isInteractive: true,
    confirmLogin: async () => true,
    runInteractiveCommand: async () => {
      calls += 1;
      return { status: "succeeded", exitCode: 0 };
    },
  }));
  assert.equal(calls, 1);
  assert.equal(outcome.result.configurationStatus, "unchanged");
  assert.deepEqual(outcome.result.authentication.map((item) => item.authentication), ["manual", "authenticated"]);
});
