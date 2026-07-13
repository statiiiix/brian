import assert from "node:assert/strict";
import { chmod, lstat, mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { applyChanges, preflightChanges } from "../src/config/files.mjs";
import {
  desiredHttpEntry,
  inspectJsonConfig,
  planJsonConnect,
  planJsonDisconnect,
  safeJsonInspection,
} from "../src/config/json.mjs";
import { CANONICAL_MCP_URL } from "../src/constants.mjs";
import { temporaryHome, writeJson } from "./helpers.mjs";

test("JSON connect creates canonical URL-only config in a path with spaces", async () => {
  const home = await temporaryHome();
  const file = path.join(home, "Client Config", "mcp.json");
  const plan = planJsonConnect(file);
  assert.equal(plan.errors.length, 0);
  assert.equal(preflightChanges(plan.changes).length, 0);
  const result = applyChanges(plan.changes);
  assert.equal(result.errors.length, 0);
  const document = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual(document.mcpServers.brian, desiredHttpEntry());
  assert.equal(JSON.stringify(document).includes("Authorization"), false);
  assert.equal(document.mcpServers.brian.url, CANONICAL_MCP_URL);
});

test("JSON connect preserves unrelated keys, backs up legacy secrets, and redacts inspection", async () => {
  const home = await temporaryHome("brian-json-");
  const file = path.join(home, ".cursor", "mcp.json");
  const secret = "legacy-secret-must-not-leak";
  await writeJson(file, {
    preferences: { theme: "dark" },
    mcpServers: {
      other: { command: "other-server" },
      brian: {
        type: "http",
        url: "https://project.supabase.co/functions/v1/brian/mcp",
        headers: { Authorization: `Bearer ${secret}` },
      },
    },
  });
  const plan = planJsonConnect(file);
  assert.equal(plan.inspection.brianState, "legacy");
  assert.equal(JSON.stringify(safeJsonInspection(plan.inspection)).includes(secret), false);
  const now = () => new Date("2026-07-12T12:34:56.789Z");
  const result = applyChanges(plan.changes, { now });
  assert.equal(result.errors.length, 0);
  assert.ok(result.applied[0].backup);
  const upgraded = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual(upgraded.preferences, { theme: "dark" });
  assert.deepEqual(upgraded.mcpServers.other, { command: "other-server" });
  assert.deepEqual(upgraded.mcpServers.brian, desiredHttpEntry());
  assert.equal(JSON.stringify(upgraded).includes(secret), false);
  assert.equal((await readFile(result.applied[0].backup, "utf8")).includes(secret), true);
  assert.equal((await lstat(result.applied[0].backup)).mode & 0o777, 0o600);
});

test("JSON connect is idempotent and creates no second backup", async () => {
  const home = await temporaryHome("brian-json-");
  const file = path.join(home, ".cursor", "mcp.json");
  await mkdir(path.dirname(file), { recursive: true });
  const first = planJsonConnect(file);
  applyChanges(first.changes);
  const before = await readFile(file, "utf8");
  const second = planJsonConnect(file);
  assert.equal(second.changes.length, 0);
  assert.equal(await readFile(file, "utf8"), before);
  assert.equal((await readdir(path.dirname(file))).filter((name) => name.includes(".bak-brian-")).length, 0);
});

test("JSON connect refuses malformed, scalar, duplicate, and symlink configurations", async () => {
  const home = await temporaryHome("brian-json-");
  const malformed = path.join(home, "malformed.json");
  const scalar = path.join(home, "scalar.json");
  const duplicate = path.join(home, "duplicate.json");
  const target = path.join(home, "target.json");
  const link = path.join(home, "link.json");
  await writeFile(malformed, "{broken");
  await writeFile(scalar, '[]\n');
  await writeFile(duplicate, '{"mcpServers":{"brian":{},"brian":{}}}\n');
  await writeFile(target, '{}\n');
  await symlink(target, link);
  for (const file of [malformed, scalar, duplicate, link]) {
    const plan = planJsonConnect(file);
    assert.equal(plan.errors.length, 1, file);
    assert.equal(plan.changes.length, 0, file);
  }
  assert.equal(await readFile(malformed, "utf8"), "{broken");
});

test("preflight refuses a read-only JSON config and performs no write", async () => {
  const home = await temporaryHome("brian-json-");
  const file = path.join(home, "readonly.json");
  await writeFile(file, '{}\n');
  await chmod(file, 0o444);
  const plan = planJsonConnect(file);
  const failures = preflightChanges(plan.changes);
  assert.equal(failures.length, 1);
  assert.match(failures[0].reason, /read-only/);
  const result = applyChanges(plan.changes);
  assert.equal(result.applied.length, 0);
  assert.equal(await readFile(file, "utf8"), '{}\n');
  await chmod(file, 0o600);
});

test("JSON disconnect removes only Brian and preserves unrelated configuration", async () => {
  const home = await temporaryHome("brian-json-");
  const file = path.join(home, "mcp.json");
  await writeJson(file, {
    keep: true,
    mcpServers: { other: { url: "https://example.test/mcp" }, brian: desiredHttpEntry() },
  });
  const plan = planJsonDisconnect(file);
  applyChanges(plan.changes);
  const document = JSON.parse(await readFile(file, "utf8"));
  assert.equal(document.keep, true);
  assert.deepEqual(document.mcpServers.other, { url: "https://example.test/mcp" });
  assert.equal(document.mcpServers.brian, undefined);
  assert.equal(inspectJsonConfig(file).brianState, "missing");
});
