import {
  authReturnToFromSearch,
  authorizationReturnTo,
  safeReturnTo,
  withReturnTo,
} from './returnTo';

test('safeReturnTo preserves Brian-owned relative paths', () => {
  expect(safeReturnTo('/app/settings/agents?from=oauth#connection')).toBe('/app/settings/agents?from=oauth#connection');
});

test.each([
  'https://evil.example/callback',
  '//evil.example/callback',
  '/\\evil.example/callback',
  'javascript:alert(1)',
  '',
])('safeReturnTo rejects unsafe continuation %p', (value) => {
  expect(safeReturnTo(value)).toBe('/app');
});

test('OAuth authorization IDs become opaque consent continuations', () => {
  expect(authorizationReturnTo('auth_123-ABC')).toBe('/oauth/consent?authorization_id=auth_123-ABC');
  expect(authorizationReturnTo('bad/id')).toBeNull();
  expect(authReturnToFromSearch('?authorization_id=auth_123-ABC')).toBe('/oauth/consent?authorization_id=auth_123-ABC');
});

test('explicit safe returnTo wins and is encoded in auth links', () => {
  expect(authReturnToFromSearch('?returnTo=%2Fonboarding')).toBe('/onboarding');
  const login = new URL(withReturnTo('/login', '/oauth/consent?authorization_id=abc'), 'https://brianthebrain.app');
  expect(login.searchParams.get('returnTo')).toBe('/oauth/consent?authorization_id=abc');
});
