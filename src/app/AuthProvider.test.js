import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthProvider';
import { supabase } from '../lib/supabase';
import { api } from './api';

jest.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
      onAuthStateChange: jest.fn(),
      signOut: jest.fn(),
    },
  },
}));

jest.mock('./api', () => ({ api: jest.fn().mockResolvedValue({}) }));

function Probe() {
  const { loading, session } = useAuth();
  return <p>{loading ? 'Loading session' : session ? 'Signed in' : 'Signed out'}</p>;
}

function LogoutProbe() {
  const { signOut } = useAuth();
  return <button type="button" onClick={signOut}>Log out</button>;
}

test('holds protected routing in a loading state until the initial session resolves', async () => {
  let resolveSession;
  supabase.auth.getSession.mockReturnValue(new Promise((resolve) => { resolveSession = resolve; }));
  supabase.auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });

  render(<AuthProvider><Probe /></AuthProvider>);
  expect(screen.getByText('Loading session')).toBeInTheDocument();

  await act(async () => {
    resolveSession({ data: { session: null }, error: null });
  });
  expect(screen.getByText('Signed out')).toBeInTheDocument();
});

test('deactivates delegated agent grants before globally signing out', async () => {
  supabase.auth.getSession.mockResolvedValue({
    data: { session: { user: { id: 'user-1' } } },
    error: null,
  });
  supabase.auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });
  supabase.auth.signOut.mockResolvedValue({ error: null });

  render(<AuthProvider><LogoutProbe /></AuthProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Log out' }));

  await waitFor(() => expect(api).toHaveBeenCalledWith(
    '/api/agent-connections/deactivate-for-logout',
    { method: 'POST', redirectOnUnauthorized: false },
  ));
  const deactivateCallIndex = api.mock.calls.findIndex(
    ([path]) => path === '/api/agent-connections/deactivate-for-logout',
  );
  expect(api.mock.invocationCallOrder[deactivateCallIndex]).toBeLessThan(
    supabase.auth.signOut.mock.invocationCallOrder[0],
  );
  expect(supabase.auth.signOut).toHaveBeenCalledWith();
});
