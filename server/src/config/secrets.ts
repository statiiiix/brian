// Runtime secrets: env first, then the owner-only app_config table (008).
// Exists so the Supabase Edge deployment is self-sufficient — the platform
// provides SUPABASE_DB_URL, and every other credential (OpenAI key, static
// bearer, JWT secret) lives in app_config, readable only by the postgres
// owner (RLS enabled, no policies). No dashboard secret management needed.
import { pool } from "../db/pool.js";

let cache: Record<string, string> | null = null;
let cachePromise: Promise<Record<string, string>> | null = null;

function loadSecrets(): Promise<Record<string, string>> {
  if (cache) return Promise.resolve(cache);
  if (!cachePromise) {
    cachePromise = pool.query("select key, value from app_config")
      .then(({ rows }) => Object.fromEntries(
        (rows as { key: string; value: string }[]).map((r) => [r.key, r.value]),
      ))
      .catch(() => ({}))
      .then((loaded) => {
        cache = loaded;
        return loaded;
      });
  }
  return cachePromise;
}

export async function secret(key: string): Promise<string | undefined> {
  const env = process.env[key];
  if (env) return env;
  return (await loadSecrets())[key];
}

export function resetSecretCache(): void {
  cache = null;
  cachePromise = null;
}
