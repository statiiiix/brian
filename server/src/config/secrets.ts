// Runtime secrets: env first, then the owner-only app_config table (008).
// Exists so the Supabase Edge deployment is self-sufficient — the platform
// provides SUPABASE_DB_URL, and every other credential (OpenAI key, static
// bearer, JWT secret) lives in app_config, readable only by the postgres
// owner (RLS enabled, no policies). No dashboard secret management needed.
import { pool } from "../db/pool.js";

let cache: Record<string, string> | null = null;

export async function secret(key: string): Promise<string | undefined> {
  const env = process.env[key];
  if (env) return env;
  if (!cache) {
    try {
      const { rows } = await pool.query("select key, value from app_config");
      cache = Object.fromEntries((rows as { key: string; value: string }[]).map((r) => [r.key, r.value]));
    } catch {
      cache = {}; // table absent (fresh install) -> env-only behavior
    }
  }
  return cache[key];
}

export function resetSecretCache(): void {
  cache = null;
}
