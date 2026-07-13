import { act, render, screen } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthProvider';
import { supabase } from '../lib/supabase';

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
