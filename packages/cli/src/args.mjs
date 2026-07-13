import { PLATFORM_NAMES } from "./constants.mjs";

export const HELP = `Brian CLI — connect local AI clients to Brian's hosted MCP service.

Usage:
  brian signup [--dry-run] [--json]
  brian connect [--only <clients>] [--dry-run] [--yes] [--json]
  brian status [--only <clients>] [--json]
  brian doctor [--only <clients>] [--json]
  brian disconnect [--only <clients>] [--dry-run] [--yes] [--json]

Clients: ${PLATFORM_NAMES.join(", ")}

Options:
  --only <a,b>  limit the command to named clients
  --dry-run     show planned changes without writing or opening a browser
  --yes, -y     apply file changes without interactive confirmation
  --json        emit machine-readable JSON; mutations also require --yes
  --help, -h    show help
  --version     show the CLI version

The public CLI always uses https://api.brianthebrain.app/mcp and never accepts
or writes a static bearer token.`;

const COMMANDS = new Set(["signup", "connect", "status", "doctor", "disconnect"]);

function parseOnly(value) {
  if (!value || value.startsWith("--")) return { error: "--only requires a comma-separated client list" };
  const names = [...new Set(value.split(",").map((name) => name.trim()).filter(Boolean))];
  if (!names.length) return { error: "--only requires a comma-separated client list" };
  const unknown = names.find((name) => !PLATFORM_NAMES.includes(name));
  if (unknown) return { error: `unknown client name: ${unknown}` };
  return { value: names };
}

export function parseArgs(argv) {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") return { help: true, options: {} };
  if (argv[0] === "--version") return { version: true, options: {} };

  const command = argv[0];
  if (!COMMANDS.has(command)) return { error: "unknown or missing command" };
  const options = { only: null, dryRun: false, yes: false, json: false };
  for (let index = 1; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") return { help: true, command, options };
    if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--yes" || argument === "-y") options.yes = true;
    else if (argument === "--json") options.json = true;
    else if (argument === "--only") {
      if (options.only) return { error: "--only may be supplied only once", options };
      const parsed = parseOnly(argv[++index]);
      if (parsed.error) return { error: parsed.error, options };
      options.only = parsed.value;
    } else if (argument.startsWith("--only=")) {
      if (options.only) return { error: "--only may be supplied only once", options };
      const parsed = parseOnly(argument.slice("--only=".length));
      if (parsed.error) return { error: parsed.error, options };
      options.only = parsed.value;
    } else if (argument.startsWith("-")) {
      return { error: `unknown option: ${argument}`, options };
    } else {
      return { error: "unexpected positional argument", options };
    }
  }

  if ((command === "status" || command === "doctor") && (options.dryRun || options.yes)) {
    return { error: `${command} does not modify files and does not accept --dry-run or --yes`, options };
  }
  if (command === "signup" && (options.only || options.yes)) {
    return { error: "signup accepts only --dry-run and --json", options };
  }
  return { command, options };
}
