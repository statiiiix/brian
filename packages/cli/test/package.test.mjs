import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PACKAGE_VERSION } from "../src/constants.mjs";

test("package manifest is public, ESM, Node 22+, zero-dependency, and exposes brian bin", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(manifest.name, "@brianthebrain/cli");
  assert.equal(PACKAGE_VERSION, manifest.version);
  assert.equal(manifest.type, "module");
  assert.equal(manifest.bin.brian, "./src/index.mjs");
  assert.equal(manifest.engines.node, ">=22");
  assert.equal(manifest.publishConfig.access, "public");
  assert.equal(manifest.private, undefined);
  assert.equal(manifest.dependencies, undefined);
  assert.deepEqual(manifest.files, ["src/", "README.md"]);
});
