import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const script = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../scripts/hooks/install.mjs"
);
const hookScript = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../scripts/hooks/brian-hook.mjs"
);

function run(args: string[]) {
  return new Promise<{ code: number | string; stdout: string; stderr: string }>((resolve, reject) => {
    execFile(process.execPath, [script, ...args], (err, stdout, stderr) => {
      if (err && err.code === undefined) return reject(err);
      resolve({ code: (err?.code as number | string | undefined) ?? 0, stdout, stderr });
    });
  });
}

describe("hooks installer", () => {
  it("adds both hooks idempotently, preserving other keys", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "brian-install-"));
    const settings = path.join(dir, "settings.json");
    await writeFile(settings, JSON.stringify({
      model: "opus",
      hooks: { Stop: [{ hooks: [{ type: "command", command: "echo hi" }] }] },
    }));

    const first = await run(["--settings", settings]);
    expect(first.code).toBe(0);
    const after = JSON.parse(await readFile(settings, "utf8"));
    expect(after.model).toBe("opus");
    expect(after.hooks.Stop).toHaveLength(1);
    for (const evt of ["SessionStart", "UserPromptSubmit"]) {
      const cmds = after.hooks[evt].flatMap(
        (g: { hooks: { command: string }[] }) => g.hooks.map((h) => h.command)
      );
      expect(cmds).toContain(`node "${hookScript}"`);
    }

    const second = await run(["--settings", settings]);
    expect(second.code).toBe(0);
    expect(JSON.parse(await readFile(settings, "utf8"))).toEqual(after);
  });

  it("creates the file (and parent dir) when missing", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "brian-install-"));
    const settings = path.join(dir, ".claude", "settings.json");
    const res = await run(["--settings", settings]);
    expect(res.code).toBe(0);
    const after = JSON.parse(await readFile(settings, "utf8"));
    expect(after.hooks.SessionStart).toHaveLength(1);
    expect(after.hooks.UserPromptSubmit).toHaveLength(1);
  });

  it("refuses to touch an unparseable settings file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "brian-install-"));
    const settings = path.join(dir, "settings.json");
    await writeFile(settings, "{not json");
    const res = await run(["--settings", settings]);
    expect(res.code).toBe(1);
    expect(await readFile(settings, "utf8")).toBe("{not json");
  });
});
