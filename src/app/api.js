import { supabase } from '../lib/supabase';
import { safeReturnTo, withReturnTo } from '../lib/returnTo';

let refreshPromise = null;

export class ApiError extends Error {
  constructor(message, status, data = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = data.code;
    this.data = data;
  }
}

async function currentAccessToken() {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) return null;

  const expiresSoon = data.session.expires_at && data.session.expires_at * 1000 < Date.now() + 60_000;
  if (!expiresSoon) return data.session.access_token;

  if (!refreshPromise) {
    refreshPromise = supabase.auth.refreshSession().finally(() => {
      refreshPromise = null;
    });
  }
  const { data: refreshed, error: refreshError } = await refreshPromise;
  if (refreshError) return null;
  return refreshed.session?.access_token ?? null;
}

export async function api(path, {
  method = 'GET',
  body,
  headers,
  signal,
  redirectOnUnauthorized = true,
} = {}) {
  const accessToken = await currentAccessToken();
  const res = await fetch(path, {
    method,
    signal,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  const data = res.status === 204 ? null : await res.json().catch(() => ({}));

  if (res.status === 401 && redirectOnUnauthorized) {
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    const here = safeReturnTo(`${window.location.pathname}${window.location.search}`);
    window.location.assign(withReturnTo('/login', here));
  }

  if (!res.ok) {
    throw new ApiError(data?.error || `request failed (${res.status})`, res.status, data || {});
  }
  return data;
}
