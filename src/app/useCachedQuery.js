import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { DEFAULT_STALE_TIME, fetchQuery, readCache, subscribe, writeCache } from './queryCache';

/**
 * Stale-while-revalidate read of an API endpoint.
 *
 * `data` starts as whatever is cached (so a revisited page renders with no
 * skeleton) and updates when the background refetch lands. Pass `key` as the
 * request path for the common case; pass a custom `fetcher` when a view needs
 * to combine several endpoints, and keep the key prefixed with the resource
 * path (e.g. '/api/skills#review-queue') so mutations invalidate it too.
 */
export function useCachedQuery(key, fetcher, options = {}) {
  const { enabled = true, staleTime = DEFAULT_STALE_TIME } = options;
  const active = Boolean(key) && enabled;

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const [data, setData] = useState(() => (active ? readCache(key) ?? null : null));
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const dataRef = useRef(data);
  dataRef.current = data;

  const load = useCallback(
    async ({ force = false } = {}) => {
      if (!active) return null;
      setRefreshing(true);
      try {
        const next = await fetchQuery(key, () => (fetcherRef.current ? fetcherRef.current() : api(key)), {
          staleTime,
          force,
        });
        setError('');
        return next;
      } catch (e) {
        setError(e.message || 'Something went wrong.');
        return null;
      } finally {
        setRefreshing(false);
      }
    },
    [key, active, staleTime]
  );

  useEffect(() => {
    if (!active) {
      setData(null);
      return undefined;
    }
    setData(readCache(key) ?? null);
    const unsubscribe = subscribe(key, setData);
    load();
    return unsubscribe;
  }, [key, active, load]);

  // Local updates (optimistic edits, list filtering) write through to the
  // cache so other mounted views on the same key stay in sync. A preceding
  // mutation may have already invalidated the entry, so fall back to what this
  // component is currently rendering rather than to null.
  const update = useCallback(
    (valueOrFn) => {
      if (!active) return;
      const current = readCache(key) ?? dataRef.current ?? null;
      writeCache(key, typeof valueOrFn === 'function' ? valueOrFn(current) : valueOrFn);
    },
    [key, active]
  );

  return {
    data,
    error,
    setError,
    refreshing,
    setData: update,
    // `refresh` always hits the network; `revalidate` respects staleTime and is
    // the right choice for cheap "we might be stale now" triggers.
    refresh: useCallback(() => load({ force: true }), [load]),
    revalidate: load,
  };
}
