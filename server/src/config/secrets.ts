// Runtime secrets: env first, then the owner-only app_config table (008) for
// legacy/local owner-mode compatibility. Production must connect as brian_app,
// which intentionally cannot read app_config, so its secrets come from the
// deployment environment. The database provisioning trigger can still read
// non-secret operational flags in app_config through its narrow definer.
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
