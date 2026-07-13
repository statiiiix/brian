import assert from "node:assert/strict";
import { chmod, mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { CANONICAL_MCP_URL } from "../src/constants.mjs";
import { cliPath, readJson, runCli, temporaryHome, writeJson } from "./helpers.mjs";

function exec(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, (error, stdout, stderr) => {
      if (error) return reject(error);
      resolve({ stdout, stderr });
    });
  });
}

test("CLI connect/status/idempotency/disconnect round trip is JSON-safe", async () => {
  const home = await temporaryHome("brian-cli-");
  const cursorDir = path.join(home, ".cursor");
  await mkdir(cursorDir, { recursive: true });
  await writeJson(path.join(cursorDir, "mcp.json"), { keep: 1, mcpServers: { other: { command: "x" } } });
  await writeFile(path.join(cursorDir, "AGENTS.md"), "# User rules\n");

  const connected = await runCli(["connect", "--only", "cursor", "--yes", "--json"], home);
  assert.equal(connected.code, 0, connected.stderr);
  assert.equal(JSON.parse(connected.stdout).status, "applied");
  const config = await readJson(path.join(cursorDir, "mcp.json"));
  assert.equal(config.mcpServers.brian.url, CANONICAL_MCP_URL);
  assert.equal("headers" in config.mcpServers.brian, false);

  const namesBefore = await readdir(cursorDir);
  const second = await runCli(["connect", "--only=cursor", "--yes", "--json"], home);
  assert.equal(second.code, 0);
  assert.equal(JSON.parse(second.stdout).status, "unchanged");
  assert.deepEqual(await readdir(cursorDir), namesBefore);

  const status = await runCli(["status", "--only", "cursor", "--json"], home);
  assert.equal(status.code, 0);
  assert.equal(JSON.parse(status.stdout).clients[0].config.brianState, "connected");
  assert.deepEqual(JSON.parse(status.stdout).lastHealthCheck, {
    schemaVersion: 1,
    status: "unknown",
    checkedAt: null,
    resource: CANONICAL_MCP_URL,
  });

  const disconnected = await runCli(["disconnect", "--only", "cursor", "--yes", "--json"], home);
  assert.equal(disconnected.code, 0);
  const after = await readJson(path.join(cursorDir, "mcp.json"));
  assert.equal(after.keep, 1);
  assert.deepEqual(after.mcpServers.other, { command: "x" });
  assert.equal(after.mcpServers.brian, undefined);
  assert.match(await readFile(path.join(cursorDir, "AGENTS.md"), "utf8"), /# User rules/);
});

test("CLI dry-run and JSON confirmation requirement never write", async () => {
  const home = await temporaryHome("brian-cli-");
  const file = path.join(home, ".cursor", "mcp.json");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, '{}\n');
  const dry = await runCli(["connect", "--only", "cursor", "--dry-run", "--json"], home);
  assert.equal(dry.code, 0);
  assert.equal(JSON.parse(dry.stdout).status, "dry-run");
  assert.equal(await readFile(file, "utf8"), '{}\n');

  const confirmation = await runCli(["connect", "--only", "cursor", "--json"], home);
  assert.equal(confirmation.code, 4);
  assert.equal(JSON.parse(confirmation.stdout).status, "confirmation-required");
  assert.equal(await readFile(file, "utf8"), '{}\n');
});

test("CLI refuses malformed and read-only files with stable failure code", async () => {
  const malformedHome = await temporaryHome("brian-cli-");
  const malformed = path.join(malformedHome, ".cursor", "mcp.json");
  await mkdir(path.dirname(malformed), { recursive: true });
  await writeFile(malformed, "{broken");
  const bad = await runCli(["connect", "--only", "cursor", "--yes", "--json"], malformedHome);
  assert.equal(bad.code, 1);
  assert.equal(JSON.parse(bad.stdout).status, "blocked");
  assert.equal(await readFile(malformed, "utf8"), "{broken");

  const readonlyHome = await temporaryHome("brian-cli-");
  const readonly = path.join(readonlyHome, ".cursor", "mcp.json");
  await mkdir(path.dirname(readonly), { recursive: true });
  await writeFile(readonly, '{}\n');
  await chmod(readonly, 0o444);
  const denied = await runCli(["connect", "--only", "cursor", "--yes", "--json"], readonlyHome);
  assert.equal(denied.code, 1);
  assert.equal(await readFile(readonly, "utf8"), '{}\n');
  await chmod(readonly, 0o600);
});

test("CLI never accepts or echoes a token option", async () => {
  const home = await temporaryHome("brian-cli-");
  const secret = "cli-secret-must-not-leak";
  const result = await runCli(["connect", "--token", secret, "--json"], home);
  assert.equal(result.code, 2);
  assert.equal(`${result.stdout}${result.stderr}`.includes(secret), false);
  assert.match(result.stdout, /unknown option/);
});

test("CLI returns no-client exit code and exposes help/version", async () => {
  const home = await temporaryHome("brian-cli-empty-");
  const none = await runCli(["connect", "--only", "cursor", "--yes", "--json"], home);
  assert.equal(none.code, 3);
  const help = await runCli(["--help"], home);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /Brian CLI/);
  const version = await runCli(["--version"], home);
  assert.equal(version.stdout.trim(), "0.1.0");
});

test("CLI runs when invoked through an installed-bin style symlink", async () => {
  const home = await temporaryHome("brian-cli-bin-");
  const bin = path.join(home, "brian");
  await symlink(cliPath, bin);
  const result = await exec(bin, ["--version"]);
  assert.equal(result.stdout.trim(), "0.1.0");
  assert.equal(result.stderr, "");
});
