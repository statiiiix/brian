import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  readJsonFile,
  deepMerge,
  backupFile,
  writeJsonFile,
} from "../../scripts/onboard/lib.mjs";

describe("onboard lib — json/backup", () => {
  it("deepMerge preserves siblings and merges nested objects", () => {
    const out = deepMerge({ a: 1, mcpServers: { x: 1 } }, { mcpServers: { brian: { c: "npm" } } });
    expect(out).toEqual({ a: 1, mcpServers: { x: 1, brian: { c: "npm" } } });
  });

  it("deepMerge does not mutate the base object", () => {
    const base = { mcpServers: { x: 1 } };
    deepMerge(base, { mcpServers: { brian: 2 } });
    expect(base).toEqual({ mcpServers: { x: 1 } });
  });

  it("readJsonFile reports missing vs unparseable vs ok", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "brian-lib-"));
    expect(readJsonFile(path.join(dir, "no.json"))).toEqual({ ok: false, reason: "missing" });
    const bad = path.join(dir, "bad.json");
    await writeFile(bad, "{nope");
    expect(readJsonFile(bad)).toEqual({ ok: false, reason: "unparseable" });
    const good = path.join(dir, "good.json");
    await writeFile(good, JSON.stringify({ a: 1 }));
    expect(readJsonFile(good)).toEqual({ ok: true, value: { a: 1 } });
  });

  it("writeJsonFile backs up an existing file once, then writes merged content", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "brian-lib-"));
    const f = path.join(dir, "c.json");
    await writeFile(f, JSON.stringify({ keep: 1 }));
    writeJsonFile(f, deepMerge({ keep: 1 }, { brian: true }));
    const names = await readdir(dir);
    expect(names.some((n) => n.startsWith("c.json.bak-brian-"))).toBe(true);
    expect(JSON.parse(await readFile(f, "utf8"))).toEqual({ keep: 1, brian: true });
  });

  it("writeJsonFile creates parent dirs and skips backup for a new file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "brian-lib-"));
    const f = path.join(dir, "nested", "d.json");
    expect(backupFile(f)).toBe(null); // absent file -> nothing to back up
    writeJsonFile(f, { fresh: true });
    expect(JSON.parse(await readFile(f, "utf8"))).toEqual({ fresh: true });
    const names = await readdir(path.join(dir, "nested"));
    expect(names.filter((n) => n.includes(".bak-brian-"))).toHaveLength(0);
  });
});
