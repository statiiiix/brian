import assert from "node:assert/strict";
import test from "node:test";
import {
  claudeCodeLoginPlan,
  claudeDesktopLoginPlan,
  codexLoginPlan,
  cursorLoginPlan,
} from "../src/login/native.mjs";

test("Codex login uses one fixed executable and argument array", () => {
  assert.deepEqual(codexLoginPlan(), {
    kind: "command",
    executable: "codex",
    args: ["mcp", "login", "brian"],
    retryCommand: "codex mcp login brian",
    instruction: "Authenticate Brian now in Codex.",
  });
  assert.deepEqual(codexLoginPlan({ commandInfo: () => ({ installed: false, version: null }) }), {
    kind: "unavailable",
    executable: null,
    args: [],
    retryCommand: null,
    instruction: "Install or upgrade Codex before authenticating Brian.",
  });
});

test("Claude login is callable only when the exact subcommand is detected", () => {
  const calls = [];
  const supported = claudeCodeLoginPlan({
    commandSupports(executable, args) {
      calls.push({ executable, args });
      return true;
    },
  });
  assert.deepEqual(calls, [{ executable: "claude", args: ["mcp", "login", "--help"] }]);
  assert.deepEqual(supported, {
    kind: "command",
    executable: "claude",
    args: ["mcp", "login", "brian"],
    retryCommand: "claude mcp login brian",
    instruction: "Authenticate Brian now in Claude Code.",
  });

  assert.deepEqual(claudeCodeLoginPlan({ commandSupports: () => false }), {
    kind: "unavailable",
    executable: null,
    args: [],
    retryCommand: null,
    instruction: "Upgrade Claude Code or run the Brian connection from Claude's MCP settings.",
  });
});

test("desktop clients return fixed manual UI instructions", () => {
  assert.deepEqual(cursorLoginPlan(), {
    kind: "manual",
    executable: null,
    args: [],
    retryCommand: null,
    instruction: "Restart Cursor, open MCP settings, select Brian, and choose Connect.",
  });
  assert.deepEqual(claudeDesktopLoginPlan(), {
    kind: "manual",
    executable: null,
    args: [],
    retryCommand: null,
    instruction: "Restart Claude Desktop, open Brian in Connectors, and choose Connect.",
  });
});

test("login plans cannot interpolate untrusted client or configuration values", () => {
  const serialized = JSON.stringify([
    codexLoginPlan({ clientName: "$(touch bad)", url: "https://evil.example" }),
    claudeCodeLoginPlan({
      clientName: "`touch bad`",
      commandSupports: () => true,
    }),
  ]);
  assert.equal(serialized.includes("touch bad"), false);
  assert.equal(serialized.includes("evil.example"), false);
});
