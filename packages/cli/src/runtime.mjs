import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

function executableCandidates(name, env, platform) {
  const directories = String(env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const extensions = platform === "win32"
    ? String(env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean)
    : [""];
  return directories.flatMap((directory) => extensions.map((extension) => path.join(directory, `${name}${extension}`)));
}

export function defaultCommandInfo(name, context = {}) {
  const env = context.env ?? process.env;
  const platform = context.platform ?? process.platform;
  const executable = executableCandidates(name, env, platform).find(existsSync);
  if (!executable) return { installed: false, version: null };

  let version = null;
  try {
    const output = execFileSync(executable, ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 2000,
      env,
    });
    version = output.split(/\r?\n/, 1)[0].replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 120) || null;
  } catch {
    // Presence is useful even when a version probe is unsupported.
  }
  return { installed: true, version };
}

export function defaultCommandSupports(executable, args, context = {}) {
  try {
    execFileSync(executable, args, {
      stdio: "ignore",
      timeout: 2000,
      env: context.env ?? process.env,
    });
    return true;
  } catch {
    return false;
  }
}

export function interactiveCommandOptions(env = process.env) {
  return {
    stdio: "inherit",
    shell: false,
    env,
  };
}

export function defaultRunInteractiveCommand(executable, args, context = {}) {
  const result = spawnSync(executable, args, interactiveCommandOptions(context.env ?? process.env));
  const exitCode = Number.isInteger(result.status) ? result.status : null;
  return {
    status: exitCode === 0 ? "succeeded" : "failed",
    exitCode,
  };
}

export function createRuntime(overrides = {}) {
  const env = overrides.env ?? process.env;
  const platform = overrides.platform ?? process.platform;
  const runtime = {
    home: overrides.home ?? env.HOME ?? homedir(),
    cwd: overrides.cwd ?? process.cwd(),
    env,
    platform,
    arch: overrides.arch ?? process.arch,
    fetch: overrides.fetch ?? globalThis.fetch,
    now: overrides.now ?? (() => new Date()),
    openBrowser: overrides.openBrowser,
    confirm: overrides.confirm,
    confirmLogin: overrides.confirmLogin,
    isInteractive: overrides.isInteractive ?? Boolean(overrides.stdin?.isTTY ?? process.stdin.isTTY),
  };
  runtime.commandInfo = overrides.commandInfo ?? ((name) => defaultCommandInfo(name, runtime));
  runtime.commandSupports = overrides.commandSupports
    ?? ((executable, args) => defaultCommandSupports(executable, args, runtime));
  runtime.runInteractiveCommand = overrides.runInteractiveCommand
    ?? ((executable, args) => defaultRunInteractiveCommand(executable, args, runtime));
  return runtime;
}
