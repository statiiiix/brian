import { act, render, screen } from '@testing-library/react';
import App from './App';
import { supabase } from './lib/supabase';

jest.mock('./lib/supabase', () => ({
  BRIAN_MCP_URL: 'https://api.brianthebrain.app/mcp',
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getSession: jest.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
      refreshSession: jest.fn(),
      signOut: jest.fn().mockResolvedValue({ error: null }),
    },
  },
}));

beforeAll(() => {
  // jsdom lacks IntersectionObserver and matchMedia used by the landing page.
  window.IntersectionObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  };
  window.matchMedia = () => ({
    matches: false,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  });
});

beforeEach(() => {
  supabase.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
  supabase.auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });
  supabase.auth.signOut.mockResolvedValue({ error: null });
});

test('renders the hero headline at /', async () => {
  window.history.pushState({}, '', '/');
  render(<App />);
  await act(async () => {});
  expect(
    screen.getByRole('heading', { level: 1, name: /company.*judgment/i })
  ).toBeInTheDocument();
});

test('renders all main landing sections', async () => {
  window.history.pushState({}, '', '/');
  render(<App />);
  await act(async () => {});
  // Some section kickers also appear as nav/footer links, hence getAllByText.
  [
    'Why Brian',
    'Pricing',
    'FAQ',
  ].forEach((kicker) => {
    expect(screen.getAllByText(kicker).length).toBeGreaterThan(0);
  });
  expect(
    screen.getByRole('heading', { level: 2, name: /Brian learns how your company actually operates/i })
  ).toBeInTheDocument();
  expect(
    screen.getByRole('heading', { level: 2, name: /Your agent should know the job.*wherever the work moves/i })
  ).toBeInTheDocument();
  expect(
    screen.getByRole('heading', { level: 2, name: /With Brian, your AI agent will no longer hallucinate/i })
  ).toBeInTheDocument();
  expect(
    screen.getByRole('heading', { level: 2, name: /Brian is coming soon/i })
  ).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Name' })).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Email' })).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Company' })).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: /Join the waitlist/i })
  ).toBeInTheDocument();
  expect(screen.queryByText('How it works')).not.toBeInTheDocument();
});

test('/app redirects to login when logged out', async () => {
  localStorage.clear();
  window.history.pushState({}, '', '/app');
  render(<App />);
  expect(screen.getByText(/restoring your secure session/i)).toBeInTheDocument();
  expect(await screen.findByLabelText(/email/i)).toBeInTheDocument();
});
