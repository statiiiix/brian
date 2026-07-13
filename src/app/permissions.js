export const AGENT_PERMISSION_DEFINITIONS = {
  'skills:read': {
    title: 'Read approved skills',
    description: 'Find and read the active procedures your company has approved for agents.',
  },
  'context:read': {
    title: 'Read company context',
    description: 'Retrieve relevant company facts and decisions stored in Brian.',
  },
  'executions:write': {
    title: 'Log execution outcomes',
    description: 'Record what the agent did and whether the governed task completed or escalated.',
  },
  'knowledge:write': {
    title: 'Capture knowledge',
    description: 'Submit new observations and corrections for your company brain.',
  },
  'actions:execute': {
    title: 'Act through connected tools',
    description: 'Use approved business-tool actions, subject to Brian’s guardrails and human-review rules.',
    highRisk: true,
  },
};

export const DEFAULT_AGENT_PERMISSIONS = [
  'skills:read',
  'context:read',
  'executions:write',
];

export function permissionsForAuthorization(details = {}) {
  const scopes = typeof details.scope === 'string' ? details.scope.split(/\s+/) : [];
  const requested = scopes.filter((permission) =>
    Object.prototype.hasOwnProperty.call(AGENT_PERMISSION_DEFINITIONS, permission)
  );
  return requested.length > 0 ? [...new Set(requested)] : [...DEFAULT_AGENT_PERMISSIONS];
}

export function permissionDetails(permissions) {
  return permissions
    .filter((permission) => AGENT_PERMISSION_DEFINITIONS[permission])
    .map((permission) => ({
      id: permission,
      ...AGENT_PERMISSION_DEFINITIONS[permission],
    }));
}
