import path from "node:path";
import { fileURLToPath } from "node:url";

// Default: server/.env, resolved relative to this file (NOT process.cwd(),
// because Claude Desktop launches MCP servers from "/"). Works from both
// src/ (tsx) and dist/ (compiled): ../.env of either is the server root.
const DEFAULT_ENV_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.env"
);

export function loadServerEnv(envPath: string = DEFAULT_ENV_PATH): void {
  try {
    process.loadEnvFile(envPath); // built-in; never overrides existing vars
  } catch {
    // no .env file — rely on the exported environment
  }
}
