import {
  DEFAULT_AGENT_PERMISSIONS,
  permissionDetails,
  permissionsForAuthorization,
} from './permissions';

test('standard OAuth identity scopes map to Brian safe defaults', () => {
  expect(permissionsForAuthorization({ scope: 'openid email profile' })).toEqual(DEFAULT_AGENT_PERMISSIONS);
});

test('verified Brian OAuth scopes are allowlisted and deduplicated', () => {
  expect(permissionsForAuthorization({
    scope: 'email skills:read actions:execute unknown:scope skills:read',
  })).toEqual(['skills:read', 'actions:execute']);
});

test('permission copy plainly marks high-risk actions', () => {
  expect(permissionDetails(['actions:execute'])).toEqual([
    expect.objectContaining({ id: 'actions:execute', highRisk: true, title: 'Act through connected tools' }),
  ]);
});
