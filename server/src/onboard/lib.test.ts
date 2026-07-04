import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  readJsonFile,
  deepMerge,
  backupFile,
  writeJsonFile,
  upsertMarkerBlock,
  hasMarkerBlock,
  tomlHasSection,
  appendTomlSection,
  mcpEntry,
  CONTRACT,
  mergeMcpServer,
  wireMarkerFile,
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

describe("onboard lib — marker blocks & TOML", () => {
  it("upsertMarkerBlock appends once, is idempotent, and replaces the body in place", () => {
    const a = upsertMarkerBlock("# rules\n", "CONTRACT v1");
    expect(a.changed).toBe(true);
    expect(hasMarkerBlock(a.text)).toBe(true);
    expect(a.text.startsWith("# rules")).toBe(true); // pre-existing content kept above

    const b = upsertMarkerBlock(a.text, "CONTRACT v1"); // identical body -> no change
    expect(b.changed).toBe(false);
    expect(b.text).toBe(a.text);

    const c = upsertMarkerBlock(a.text, "CONTRACT v2"); // new body -> replace in place
    expect(c.changed).toBe(true);
    expect(c.text).toContain("CONTRACT v2");
    expect(c.text).not.toContain("CONTRACT v1");
    expect(c.text.match(/>>> brian >>>/g)).toHaveLength(1); // still exactly one block
  });

  it("upsertMarkerBlock seeds an empty string with just the block", () => {
    const a = upsertMarkerBlock("", "HELLO");
    expect(a.changed).toBe(true);
    expect(hasMarkerBlock(a.text)).toBe(true);
    expect(a.text).toContain("HELLO");
  });

  it("tomlHasSection + appendTomlSection are line-scan based and preserve content", () => {
    const base = '[mcp_servers.other]\ncommand = "x"\n';
    expect(tomlHasSection(base, "mcp_servers.brian")).toBe(false);
    expect(tomlHasSection(base, "mcp_servers.other")).toBe(true);

    const out = appendTomlSection(base, '[mcp_servers.brian]\ncommand = "npm"\n');
    expect(tomlHasSection(out, "mcp_servers.brian")).toBe(true);
    expect(out).toContain("[mcp_servers.other]"); // preserved
    expect(out).toContain('command = "x"');
  });

  it("tomlHasSection ignores commented-out sections", () => {
    const base = '# [mcp_servers.brian]\nmodel = "gpt-5"\n';
    expect(tomlHasSection(base, "mcp_servers.brian")).toBe(false);
  });
});

describe("onboard lib — mcp entries & contract", () => {
  it("mcpEntry builds a stdio entry locally and an http entry when url is given", () => {
    expect(mcpEntry({ serverPath: "/abs/server" })).toEqual({
      command: "npm",
      args: ["--prefix", "/abs/server", "run", "mcp"],
    });
    expect(mcpEntry({ serverPath: "/abs/server", url: "https://b.example.com/", token: "T" })).toEqual({
      type: "http",
      url: "https://b.example.com/mcp",
      headers: { Authorization: "Bearer T" },
    });
  });

  it("CONTRACT names the required Brian tools", () => {
    for (const t of ["find_skill", "find_context", "log_execution", "capture"]) {
      expect(CONTRACT).toContain(t);
    }
  });
});

describe("onboard lib — shared wiring helpers", () => {
  it("mergeMcpServer wires, is idempotent, preserves siblings, refuses unparseable", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "brian-mrg-"));
    const f = path.join(dir, "cfg.json");

    // fresh file
    const a = mergeMcpServer(f, { command: "npm" });
    expect(a.status).toBe("wired");
    expect(JSON.parse(await readFile(f, "utf8")).mcpServers.brian).toEqual({ command: "npm" });

    // already wired -> no change
    const b = mergeMcpServer(f, { command: "changed" });
    expect(b.status).toBe("already");
    expect(JSON.parse(await readFile(f, "utf8")).mcpServers.brian).toEqual({ command: "npm" });

    // preserves other servers
    await writeFile(f, JSON.stringify({ mcpServers: { other: { command: "x" } } }));
    mergeMcpServer(f, { command: "npm" });
    const after = JSON.parse(await readFile(f, "utf8"));
    expect(after.mcpServers.other).toEqual({ command: "x" });
    expect(after.mcpServers.brian).toEqual({ command: "npm" });

    // refuses unparseable
    await writeFile(f, "{broken");
    expect(mergeMcpServer(f, { command: "npm" }).status).toBe("unparseable");
    expect(await readFile(f, "utf8")).toBe("{broken");
  });

  it("wireMarkerFile creates the file with the contract, then is idempotent", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "brian-mrk-"));
    const f = path.join(dir, "AGENTS.md");
    const a = wireMarkerFile(f, CONTRACT);
    expect(a.status).toBe("wired");
    const body = await readFile(f, "utf8");
    expect(body).toContain(">>> brian >>>");
    expect(body).toContain("find_skill");
    expect(wireMarkerFile(f, CONTRACT).status).toBe("already");
  });
});
