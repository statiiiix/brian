#!/usr/bin/env node
// Compatibility entry point for the original `npm run onboard` command.
//
// The public CLI owns client detection, safety checks, backups, and config
// mutation. Keep this file deliberately small so the internal command cannot
// drift into a second onboarding implementation.
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { main as runPublicCli } from "../../../packages/cli/src/index.mjs";
import { EXIT } from "../../../packages/cli/src/constants.mjs";

const PUBLIC_COMMANDS = new Set(["signup", "connect", "status", "doctor", "disconnect"]);
const PASSTHROUGH_OPTIONS = new Set(["--help", "-h", "--version"]);

export const DEPRECATION_NOTICE =
  "Notice: npm run onboard is a compatibility alias for @brianthebrain/cli. " +
  "Prefer `npx @brianthebrain/cli connect`.\n";

const STATIC_CREDENTIAL_ERROR =
  "Legacy remote onboarding has been retired because it writes a static bearer credential. " +
  "Use the hosted OAuth flow with `npx @brianthebrain/cli connect`.\n";

function isStaticCredentialOption(argument) {
  return argument === "--url" || argument.startsWith("--url=") ||
    argument === "--token" || argument.startsWith("--token=");
}

/**
 * Translate the original flag-only interface to the public CLI command shape.
 * This intentionally inspects option names only; values following --token are
 * never included in errors or forwarded to another parser.
 */
export function translateLegacyArgs(argv) {
  if (argv.some(isStaticCredentialOption)) {
    return { error: STATIC_CREDENTIAL_ERROR, args: null };
  }

  if (PUBLIC_COMMANDS.has(argv[0]) || PASSTHROUGH_OPTIONS.has(argv[0])) {
    return { error: null, args: [...argv] };
  }

  if (argv.includes("--status")) {
    return {
      error: null,
      args: ["status", ...argv.filter((argument) => argument !== "--status")],
    };
  }

  return { error: null, args: ["connect", ...argv] };
}

export async function main(argv = process.argv.slice(2), overrides = {}) {
  const stderr = overrides.stderr ?? process.stderr;
  stderr.write(DEPRECATION_NOTICE);

  const translated = translateLegacyArgs(argv);
  if (translated.error) {
    stderr.write(translated.error);
    return EXIT.USAGE;
  }

  return runPublicCli(translated.args, overrides);
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
