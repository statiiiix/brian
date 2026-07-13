import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AppLayout from './AppLayout';
import { api } from './api';
import { useAuth } from './auth';

jest.mock('./api', () => ({ api: jest.fn() }));
jest.mock('./auth', () => ({ useAuth: jest.fn() }));

beforeEach(() => {
  api.mockResolvedValue([]);
  useAuth.mockReturnValue({
    user: { id: 'user-1', email: 'owner@example.com' },
    profile: {
      user: { id: 'user-1', email: 'owner@example.com' },
      currentTenant: { id: 'tenant-1', name: 'Northwind Labs' },
      currentMembership: { tenant_id: 'tenant-1', role: 'owner' },
    },
    profileError: '',
    signOut: jest.fn(),
  });
});

afterEach(() => jest.clearAllMocks());

test('links to Privacy from Settings and marks the route active', async () => {
  render(
    <MemoryRouter initialEntries={['/app/settings/privacy']}>
      <Routes>
        <Route path="/app" element={<AppLayout />}>
          <Route path="settings/privacy" element={<h1>Privacy route</h1>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );

  const privacyLink = screen.getByRole('link', { name: 'Privacy' });
  expect(privacyLink).toHaveAttribute('href', '/app/settings/privacy');
  expect(privacyLink).toHaveClass('is-active');
  expect(screen.getByRole('heading', { name: 'Privacy route' })).toBeInTheDocument();
  await waitFor(() => expect(api).toHaveBeenCalledWith('/api/skills?status=draft'));
});
