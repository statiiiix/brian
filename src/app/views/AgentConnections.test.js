import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AgentConnections from './AgentConnections';
import { api } from '../api';
import { useAuth } from '../auth';
import { clearCache } from '../queryCache';

jest.mock('../api', () => ({ api: jest.fn() }));
jest.mock('../auth', () => ({ useAuth: jest.fn() }));

beforeEach(() => {
  clearCache();
  useAuth.mockReturnValue({
    profile: {
      user: { id: 'user-1', email: 'owner@example.com' },
      currentTenant: { id: 'tenant-1', name: 'Sokoon' },
      currentMembership: { tenant_id: 'tenant-1', role: 'owner' },
      featureFlags: { agentConnectionsUi: true },
    },
  });
  api.mockResolvedValue({
    connections: [{
      id: 'connection-1',
      userId: 'user-1',
      oauthClientId: 'codex-client',
      clientName: 'Codex',
      permissions: ['skills:read'],
      status: 'inactive',
      inactiveReason: 'user_logout',
      approvedAt: '2026-07-29T21:57:58.000Z',
    }],
  });
});

afterEach(() => jest.clearAllMocks());

test('explains that logout made an agent inactive and reauthentication is required', async () => {
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AgentConnections />
    </MemoryRouter>
  );

  expect(await screen.findByText('Inactive')).toBeInTheDocument();
  expect(screen.getByText(
    'Inactive because the approving user logged out of Brian. Reauthenticate from the agent to reconnect.',
  )).toBeInTheDocument();
});
