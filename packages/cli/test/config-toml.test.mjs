import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { applyChanges } from "../src/config/files.mjs";
import {
  DESIRED_SECTION,
  inspectTomlConfig,
  planTomlConnect,
  planTomlDisconnect,
  safeTomlInspection,
} from "../src/config/toml.mjs";
import { CANONICAL_MCP_URL } from "../src/constants.mjs";
import { temporaryHome } from "./helpers.mjs";

test("Codex TOML connect appends the native OAuth resource shape and preserves unrelated content", async () => {
  const home = await temporaryHome("brian-toml-");
  const file = path.join(home, "config.toml");
  await writeFile(file, 'model = "gpt-5"\n\n[mcp_servers.other]\ncommand = "other"\n');
  const plan = planTomlConnect(file);
  assert.equal(plan.errors.length, 0);
  applyChanges(plan.changes);
  const text = await readFile(file, "utf8");
  assert.match(text, /model = "gpt-5"/);
  assert.match(text, /\[mcp_servers\.other\]/);
  assert.match(text, new RegExp(`url = "${CANONICAL_MCP_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  assert.match(text, /oauth_resource =/);
  assert.equal(/bearer|authorization/i.test(text), false);
});

test("Codex TOML connect is byte-idempotent", async () => {
  const home = await temporaryHome("brian-toml-");
  const file = path.join(home, "config.toml");
  await writeFile(file, DESIRED_SECTION);
  const inspection = inspectTomlConfig(file);
  assert.equal(inspection.brianState, "connected");
  assert.equal(planTomlConnect(file).changes.length, 0);
});

test("Codex TOML upgrade removes legacy endpoint and credential sections but preserves tool policy", async () => {
  const home = await temporaryHome("brian-toml-");
  const file = path.join(home, "config.toml");
  const secret = "toml-secret-must-not-leak";
  await writeFile(file, `model = "gpt-5"\n\n[mcp_servers.brian]\nurl = "https://project.supabase.co/functions/v1/brian/mcp"\nbearer_token_env_var = "BRIAN_API_TOKEN"\n\n[mcp_servers.brian.http_headers]\nAuthorization = "Bearer ${secret}"\n\n[mcp_servers.brian.tools.find_context]\napproval_mode = "approve"\n\n[mcp_servers.other]\ncommand = "other"\n`);
  const plan = planTomlConnect(file);
  assert.equal(plan.inspection.brianState, "legacy");
  assert.equal(JSON.stringify(safeTomlInspection(plan.inspection)).includes(secret), false);
  const result = applyChanges(plan.changes);
  const text = await readFile(file, "utf8");
  assert.equal(text.includes(secret), false);
  assert.equal(text.includes("supabase.co"), false);
  assert.equal(text.includes("bearer_token_env_var"), false);
  assert.match(text, /\[mcp_servers\.brian\.tools\.find_context\]/);
  assert.match(text, /\[mcp_servers\.other\]/);
  assert.ok(result.applied[0].backup);
  assert.equal((await readFile(result.applied[0].backup, "utf8")).includes(secret), true);
});

test("Codex TOML refuses malformed headers, unterminated strings, and duplicate parent sections", async () => {
  const home = await temporaryHome("brian-toml-");
  const cases = [
    "[mcp_servers.brian\nurl = \"x\"\n",
    'model = "unterminated\n',
    `${DESIRED_SECTION}\n${DESIRED_SECTION}`,
  ];
  for (let index = 0; index < cases.length; index++) {
    const file = path.join(home, `bad-${index}.toml`);
    await writeFile(file, cases[index]);
    const plan = planTomlConnect(file);
    assert.equal(plan.errors.length, 1);
    assert.equal(plan.changes.length, 0);
    assert.equal(await readFile(file, "utf8"), cases[index]);
  }
});

test("Codex TOML disconnect removes all Brian sections and preserves unrelated sections", async () => {
  const home = await temporaryHome("brian-toml-");
  const file = path.join(home, "config.toml");
  await writeFile(file, `model = "gpt-5"\n\n${DESIRED_SECTION}\n[mcp_servers.brian.tools.capture]\napproval_mode = "prompt"\n\n[mcp_servers.other]\ncommand = "other"\n`);
  const plan = planTomlDisconnect(file);
  assert.equal(plan.errors.length, 0);
  applyChanges(plan.changes);
  const text = await readFile(file, "utf8");
  assert.equal(text.includes("mcp_servers.brian"), false);
  assert.match(text, /model = "gpt-5"/);
  assert.match(text, /\[mcp_servers\.other\]/);
});
