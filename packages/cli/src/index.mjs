#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as processStdin, stdout as processStdout, stderr as processStderr } from "node:process";
import { HELP, parseArgs } from "./args.mjs";
import { EXIT, PACKAGE_VERSION } from "./constants.mjs";
import { runConnect, runDisconnect, runStatus } from "./commands/clients.mjs";
import { runDoctor } from "./commands/doctor.mjs";
import { runSignup } from "./commands/signup.mjs";
import { renderHuman, renderJson, renderMutationPlan } from "./output.mjs";
import { createRuntime } from "./runtime.mjs";

function write(stream, value) {
  stream.write(value);
}

async function interactiveConfirm(preview, io) {
  write(io.stdout, renderMutationPlan(preview));
  if (!io.stdin.isTTY) return false;
  const readline = createInterface({ input: io.stdin, output: io.stdout });
  try {
    const answer = await readline.question("Proceed? [y/N] ");
    return /^y(?:es)?$/i.test(answer.trim());
  } finally {
    readline.close();
  }
}

export async function main(argv = process.argv.slice(2), overrides = {}) {
  const io = {
    stdin: overrides.stdin ?? processStdin,
    stdout: overrides.stdout ?? processStdout,
    stderr: overrides.stderr ?? processStderr,
  };
  const parsed = parseArgs(argv);
  const wantsJson = argv.includes("--json") || Boolean(parsed.options?.json);

  if (parsed.error) {
    const error = { command: "usage", status: "error", error: parsed.error, exitCode: EXIT.USAGE };
    if (wantsJson) write(io.stdout, renderJson(error));
    else write(io.stderr, `Error: ${parsed.error}\n\n${HELP}\n`);
    return EXIT.USAGE;
  }
  if (parsed.help) {
    write(io.stdout, `${HELP}\n`);
    return EXIT.OK;
  }
  if (parsed.version) {
    write(io.stdout, `${PACKAGE_VERSION}\n`);
    return EXIT.OK;
  }

  const runtime = createRuntime(overrides);
  if (!runtime.confirm) runtime.confirm = (preview) => interactiveConfirm(preview, io);
  const options = parsed.options;
  let outcome;
  try {
    if (parsed.command === "signup") outcome = await runSignup(options, runtime);
    else if (parsed.command === "connect") outcome = await runConnect(options, runtime);
    else if (parsed.command === "status") outcome = runStatus(options, runtime);
    else if (parsed.command === "doctor") outcome = await runDoctor(options, runtime);
    else outcome = await runDisconnect(options, runtime);
  } catch {
    outcome = {
      code: EXIT.FAILED,
      result: { command: parsed.command, status: "failed", error: "unexpected failure; no credentials were logged" },
    };
  }

  write(io.stdout, wantsJson ? renderJson(outcome.result) : renderHuman(outcome.result));
  return outcome.code;
}

let direct = false;
if (process.argv[1]) {
  try {
    direct = realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    direct = path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
  }
}
if (direct) {
  main().then((code) => {
    process.exitCode = code;
  });
}
