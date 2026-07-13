export const DEFAULT_AUTH_RETURN_TO = '/app';

function containsControlOrBackslash(value) {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return character === '\\' || code < 32 || code === 127;
  });
}

export function safeReturnTo(value, fallback = DEFAULT_AUTH_RETURN_TO) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) {
    return fallback;
  }
  if (!value.startsWith('/') || value.startsWith('//') || containsControlOrBackslash(value)) {
    return fallback;
  }

  try {
    const base = new URL('https://brianthebrain.app');
    const parsed = new URL(value, base);
    if (parsed.origin !== base.origin) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export function authorizationReturnTo(authorizationId) {
  if (typeof authorizationId !== 'string' || authorizationId.length === 0 || authorizationId.length > 512) {
    return null;
  }
  if (/[^A-Za-z0-9._~-]/.test(authorizationId)) return null;
  return `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`;
}

export function authReturnToFromSearch(search, fallback = DEFAULT_AUTH_RETURN_TO) {
  const params = new URLSearchParams(search || '');
  const explicit = params.get('returnTo');
  if (explicit) return safeReturnTo(explicit, fallback);
  return authorizationReturnTo(params.get('authorization_id')) || fallback;
}

export function withReturnTo(path, returnTo) {
  const params = new URLSearchParams();
  params.set('returnTo', safeReturnTo(returnTo));
  return `${path}?${params.toString()}`;
}

export function authCallbackUrl(returnTo, origin = window.location.origin) {
  const url = new URL('/auth/callback', origin);
  url.searchParams.set('returnTo', safeReturnTo(returnTo));
  return url.toString();
}
