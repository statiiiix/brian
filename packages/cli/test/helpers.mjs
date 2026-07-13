import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const cliPath = fileURLToPath(new URL("../src/index.mjs", import.meta.url));

export async function temporaryHome(prefix = "brian cli home ") {
  return mkdtemp(path.join(tmpdir(), prefix));
}

export async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

export async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

export function runCli(args, home, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [cliPath, ...args],
      { env: { ...process.env, HOME: home, ...extraEnv } },
      (error, stdout, stderr) => {
        const code = error?.code;
        if (error && typeof code !== "number") return reject(error);
        resolve({ code: code ?? 0, stdout, stderr });
      },
    );
  });
}
