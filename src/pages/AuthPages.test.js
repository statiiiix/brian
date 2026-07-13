import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Login from './Login';
import Signup from './Signup';
import ForgotPassword from './ForgotPassword';
import ResetPassword from './ResetPassword';
import OAuthConsent from './OAuthConsent';
import InvitationAccept from './InvitationAccept';
import { useAuth } from '../app/auth';
import { api } from '../app/api';
import { supabase } from '../lib/supabase';

jest.mock('../app/auth', () => ({ useAuth: jest.fn() }));
jest.mock('../app/api', () => ({ api: jest.fn() }));
jest.mock('../lib/supabase', () => ({
  BRIAN_MCP_URL: 'https://api.brianthebrain.app/mcp',
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      oauth: {
        getAuthorizationDetails: jest.fn(),
        approveAuthorization: jest.fn(),
        denyAuthorization: jest.fn(),
      },
      signInWithPassword: jest.fn(),
      resend: jest.fn(),
      signUp: jest.fn(),
      resetPasswordForEmail: jest.fn(),
      updateUser: jest.fn(),
    },
  },
}));

beforeEach(() => {
  useAuth.mockReturnValue({
    session: null,
    loading: false,
    profile: null,
    profileLoading: false,
    profileError: '',
  });
  jest.clearAllMocks();
  supabase.auth.signUp.mockResolvedValue({
    data: { session: null, user: { identities: [{}] } },
    error: null,
  });
  api.mockImplementation(async (path) => (
    path === '/api/public/config'
      ? { publicSignup: true }
      : path === '/api/public/invitations/validate'
        ? { valid: true }
        : undefined
  ));
});

test('login preserves an OAuth continuation in recovery and signup links', () => {
  render(<MemoryRouter initialEntries={['/login?authorization_id=auth-123']}><Login /></MemoryRouter>);
  const signup = new URL(screen.getByRole('link', { name: /create an account/i }).href);
  const forgot = new URL(screen.getByRole('link', { name: /forgot password/i }).href);
  expect(signup.searchParams.get('returnTo')).toBe('/oauth/consent?authorization_id=auth-123');
  expect(forgot.searchParams.get('returnTo')).toBe('/oauth/consent?authorization_id=auth-123');
});

test('signup collects only human and new-company provisioning fields', async () => {
  render(<MemoryRouter initialEntries={['/signup']}><Signup /></MemoryRouter>);
  expect(await screen.findByLabelText('Full name')).toBeInTheDocument();
  expect(screen.getByLabelText('Company name')).toBeInTheDocument();
  expect(screen.getByLabelText('Work email')).toBeInTheDocument();
  expect(screen.getByLabelText(/I agree to Brian/i)).toBeInTheDocument();
  expect(screen.queryByLabelText(/tenant|role/i)).not.toBeInTheDocument();
});

test('self-service signup fails closed when the public release flag is off', async () => {
  api.mockResolvedValue({ publicSignup: false });
  render(<MemoryRouter initialEntries={['/signup']}><Signup /></MemoryRouter>);
  expect(await screen.findByRole('heading', { name: /public signup is not open yet/i })).toBeInTheDocument();
  expect(screen.queryByLabelText('Company name')).not.toBeInTheDocument();
  expect(supabase.auth.signUp).not.toHaveBeenCalled();
});

test('invited signup defers company selection and never sends the raw invitation token as metadata', async () => {
  const token = 'invitation-token-abcdefghijklmnopqrstuvwxyz';
  const returnTo = `/invite/${token}`;
  render(<MemoryRouter initialEntries={[`/signup?returnTo=${encodeURIComponent(returnTo)}`]}><Signup /></MemoryRouter>);

  expect(screen.queryByLabelText('Company name')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Invited Person' } });
  fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'invitee@example.test' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'safe-password-123' } });
  fireEvent.click(screen.getByLabelText(/I agree to Brian/i));
  fireEvent.click(screen.getByRole('button', { name: /create account & join/i }));

  await waitFor(() => expect(supabase.auth.signUp).toHaveBeenCalled());
  const request = supabase.auth.signUp.mock.calls[0][0];
  expect(request.options.data).toEqual({
    full_name: 'Invited Person',
    brian_invitation_signup: true,
  });
  expect(JSON.stringify(request.options.data)).not.toContain(token);
});

test('fake or email-mismatched invitations are rejected before creating an Auth user', async () => {
  api.mockImplementation(async (path) => (
    path === '/api/public/invitations/validate' ? { valid: false } : { publicSignup: false }
  ));
  const token = 'fake-invitation-token-abcdefghijklmnopqrstuvwxyz';
  render(<MemoryRouter initialEntries={[`/signup?returnTo=${encodeURIComponent(`/invite/${token}`)}`]}><Signup /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Blocked Person' } });
  fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'wrong@example.test' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'safe-password-123' } });
  fireEvent.click(screen.getByLabelText(/I agree to Brian/i));
  fireEvent.click(screen.getByRole('button', { name: /create account & join/i }));

  expect(await screen.findByRole('heading', { name: 'Invitation unavailable' })).toBeInTheDocument();
  expect(supabase.auth.signUp).not.toHaveBeenCalled();
  expect(api).toHaveBeenCalledWith('/api/public/invitations/validate', {
    method: 'POST',
    body: { email: 'wrong@example.test', token },
    redirectOnUnauthorized: false,
  });
});

test('signup provisioning failure has a safe idempotent retry state', async () => {
  supabase.auth.signUp.mockResolvedValue({
    data: { session: null, user: null },
    error: new Error('Database error saving new user: sensitive provider detail'),
  });
  render(<MemoryRouter initialEntries={['/signup']}><Signup /></MemoryRouter>);
  fireEvent.change(await screen.findByLabelText('Full name'), { target: { value: 'Retry Person' } });
  fireEvent.change(screen.getByLabelText('Company name'), { target: { value: 'Retry Company' } });
  fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'retry@example.test' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'safe-password-123' } });
  fireEvent.click(screen.getByLabelText(/I agree to Brian/i));
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

  expect(await screen.findByRole('heading', { name: 'Company setup was not completed' })).toBeInTheDocument();
  expect(screen.queryByText(/sensitive provider detail/i)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry signup' }));
  expect(screen.getByLabelText('Company name')).toHaveValue('Retry Company');
});

test('an invalid invitation continuation fails safely for an authenticated user', async () => {
  useAuth.mockReturnValue({
    session: { user: { id: 'u1' } },
    loading: false,
    refreshProfile: jest.fn(),
  });
  api.mockRejectedValue(new Error('invalid, expired, or already-used invitation'));
  render(
    <MemoryRouter initialEntries={['/invite/invitation-token-abcdefghijklmnopqrstuvwxyz']}>
      <Routes><Route path="/invite/:token" element={<InvitationAccept />} /></Routes>
    </MemoryRouter>
  );
  expect(await screen.findByRole('heading', { name: 'Invitation unavailable' })).toBeInTheDocument();
  expect(screen.getByText(/invalid, expired, or already-used invitation/i)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Return to Brian' })).toHaveAttribute('href', '/app');
});

test('recovery pages render safe email and new-password forms', () => {
  const { unmount } = render(<MemoryRouter><ForgotPassword /></MemoryRouter>);
  expect(screen.getByLabelText('Email')).toBeInTheDocument();
  unmount();

  useAuth.mockReturnValue({ session: { user: { id: 'u1' } }, loading: false });
  render(<MemoryRouter><ResetPassword /></MemoryRouter>);
  expect(screen.getByLabelText('New password')).toBeEnabled();
  expect(screen.getByLabelText('Confirm new password')).toBeEnabled();
});

test('consent shows verified client details, one company, and plain-language permissions', async () => {
  useAuth.mockReturnValue({
    session: { user: { id: 'u1' } },
    loading: false,
    profileLoading: false,
    profileError: '',
    profile: {
      memberships: [{ tenant_id: 't1', role: 'owner', status: 'active', tenant: { id: 't1', name: 'Acme' } }],
      featureFlags: { MCP_OAUTH_ENABLED: true, MCP_OAUTH_APPROVALS_ENABLED: true },
    },
  });
  supabase.auth.oauth.getAuthorizationDetails.mockResolvedValue({
    data: {
      authorization_id: 'auth-123',
      redirect_uri: 'http://127.0.0.1:49152/callback',
      scope: 'openid',
      client: { id: 'client-1', name: 'Claude Code', uri: 'https://claude.ai' },
    },
    error: null,
  });

  render(<MemoryRouter initialEntries={['/oauth/consent?authorization_id=auth-123']}><OAuthConsent /></MemoryRouter>);
  expect(await screen.findByRole('heading', { name: 'Connect Claude Code?' })).toBeInTheDocument();
  expect(screen.getByText('Acme')).toBeInTheDocument();
  expect(screen.getByText('Read approved skills')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Approve connection' })).toBeEnabled());
});

test('denial records the verified request without preparing an agent grant', async () => {
  useAuth.mockReturnValue({
    session: { user: { id: 'u1' } },
    loading: false,
    profileLoading: false,
    profileError: '',
    profile: {
      memberships: [{ tenant_id: 't1', role: 'owner', status: 'active', tenant: { id: 't1', name: 'Acme' } }],
      featureFlags: { MCP_OAUTH_ENABLED: true, MCP_OAUTH_APPROVALS_ENABLED: true },
    },
  });
  supabase.auth.oauth.getAuthorizationDetails.mockResolvedValue({
    data: {
      authorization_id: 'auth-123',
      redirect_uri: 'http://127.0.0.1:49152/callback',
      scope: 'email',
      client: { id: 'client-1', name: 'Claude Code', uri: 'https://claude.ai' },
    },
    error: null,
  });
  api.mockResolvedValue({ recorded: true });
  supabase.auth.oauth.denyAuthorization.mockResolvedValue({
    data: null,
    error: new Error('provider denial failed'),
  });

  render(<MemoryRouter initialEntries={['/oauth/consent?authorization_id=auth-123']}><OAuthConsent /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'Deny' }));

  await waitFor(() => expect(api).toHaveBeenCalledWith('/api/oauth/authorizations/deny', {
    method: 'POST',
    body: { authorizationId: 'auth-123', tenantId: 't1' },
  }));
  await waitFor(() => expect(supabase.auth.oauth.denyAuthorization).toHaveBeenCalledWith(
    'auth-123',
    { skipBrowserRedirect: true },
  ));
  expect(api.mock.calls.some(([path]) => path === '/api/oauth/grants/prepare')).toBe(false);
  expect(api.mock.invocationCallOrder[0])
    .toBeLessThan(supabase.auth.oauth.denyAuthorization.mock.invocationCallOrder[0]);
});

test('consent approvals fail closed when the approvals flag is absent', async () => {
  useAuth.mockReturnValue({
    session: { user: { id: 'u1' } },
    loading: false,
    profileLoading: false,
    profileError: '',
    profile: {
      memberships: [{ tenant_id: 't1', role: 'owner', status: 'active', tenant: { id: 't1', name: 'Acme' } }],
      featureFlags: { MCP_OAUTH_ENABLED: true },
    },
  });
  supabase.auth.oauth.getAuthorizationDetails.mockResolvedValue({
    data: {
      authorization_id: 'auth-flag',
      redirect_uri: 'http://127.0.0.1:49152/callback',
      scope: 'email',
      client: { id: 'client-1', name: 'Claude Code', uri: 'https://claude.ai' },
    },
    error: null,
  });

  render(<MemoryRouter initialEntries={['/oauth/consent?authorization_id=auth-flag']}><OAuthConsent /></MemoryRouter>);
  expect(await screen.findByRole('button', { name: 'Approve connection' })).toBeDisabled();
  expect(screen.getByText('New agent connections are temporarily paused.')).toBeInTheDocument();
});

test('expired OAuth continuation gives a safe restart instruction', async () => {
  useAuth.mockReturnValue({
    session: { user: { id: 'u1' } },
    loading: false,
    profileLoading: false,
    profileError: '',
    profile: { memberships: [], featureFlags: {} },
  });
  supabase.auth.oauth.getAuthorizationDetails.mockResolvedValue({
    data: null,
    error: new Error('provider diagnostic must not be shown'),
  });
  render(<MemoryRouter initialEntries={['/oauth/consent?authorization_id=expired-123']}><OAuthConsent /></MemoryRouter>);
  expect(await screen.findByText(/Return to your agent and click Connect again/i)).toBeInTheDocument();
  expect(screen.queryByText(/provider diagnostic/i)).not.toBeInTheDocument();
});
