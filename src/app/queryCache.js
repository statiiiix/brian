// In-memory cache for GET responses so navigating between pages paints
// instantly from the last known data while a fresh copy loads in the
// background. Deliberately not persisted — it must not outlive the session or
// leak across accounts.

const store = new Map(); // key -> { data, ts }
const inflight = new Map(); // key -> Promise
const listeners = new Map(); // key -> Set<fn>

export const DEFAULT_STALE_TIME = 20_000;

export function readCache(key) {
  const entry = store.get(key);
  return entry ? entry.data : undefined;
}

export function writeCache(key, data) {
  store.set(key, { data, ts: Date.now() });
  const subs = listeners.get(key);
  if (subs) for (const fn of subs) fn(data);
  return data;
}

export function subscribe(key, fn) {
  let subs = listeners.get(key);
  if (!subs) {
    subs = new Set();
    listeners.set(key, subs);
  }
  subs.add(fn);
  return () => {
    subs.delete(fn);
    if (subs.size === 0) listeners.delete(key);
  };
}

// Every entry whose key starts with the prefix is dropped, so a mutation on
// /api/skills/:id/approve clears /api/skills, /api/skills?status=draft, etc.
export function invalidateCache(prefix) {
  if (!prefix) return;
  for (const key of [...store.keys()]) {
    if (key.startsWith(prefix)) store.delete(key);
  }
  for (const key of [...inflight.keys()]) {
    if (key.startsWith(prefix)) inflight.delete(key);
  }
}

export function clearCache() {
  store.clear();
  inflight.clear();
}

// Resolves '/api/skills/123/approve?x=1' to '/api/skills' so mutations can
// invalidate their whole resource without every call site listing keys.
export function resourceKey(path) {
  const parts = String(path).split('?')[0].split('/').filter(Boolean);
  if (parts.length === 0) return '';
  return `/${parts.slice(0, 2).join('/')}`;
}

export function fetchQuery(key, fetcher, { staleTime = DEFAULT_STALE_TIME, force = false } = {}) {
  const entry = store.get(key);
  if (!force && entry && Date.now() - entry.ts < staleTime) {
    return Promise.resolve(entry.data);
  }
  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = Promise.resolve()
    .then(fetcher)
    .then((data) => writeCache(key, data))
    .finally(() => {
      if (inflight.get(key) === promise) inflight.delete(key);
    });
  inflight.set(key, promise);
  return promise;
}
