import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import PrivacySettings from './PrivacySettings';
import { api } from '../api';
import { useAuth } from '../auth';

jest.mock('../api', () => ({ api: jest.fn() }));
jest.mock('../auth', () => ({ useAuth: jest.fn() }));

const memberProfile = {
  user: { id: 'user-1', email: 'member@example.com' },
  currentTenant: { id: 'tenant-1', name: 'Northwind Labs' },
  currentMembership: { tenant_id: 'tenant-1', role: 'member' },
};

const ownerProfile = {
  ...memberProfile,
  currentMembership: { tenant_id: 'tenant-1', role: 'owner' },
};

beforeEach(() => {
  useAuth.mockReturnValue({ profile: memberProfile });
  api.mockImplementation((path, options) => {
    if (path === '/api/privacy/deletion-requests' && !options) return Promise.resolve({ requests: [] });
    return Promise.reject(new Error(`unexpected API call: ${path}`));
  });
});

afterEach(() => jest.clearAllMocks());

test('explains the grace and revocation policy while limiting company deletion to owners', async () => {
  render(<PrivacySettings />);

  expect(await screen.findByRole('button', { name: 'Request account deletion' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Request company deletion' })).not.toBeInTheDocument();
  expect(screen.getByText('Only a current company owner can request company deletion.')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '30-day default grace period' })).toBeInTheDocument();
  expect(screen.getByText(/cancel before its scheduled time while it is pending/i)).toBeInTheDocument();
  expect(screen.getByText(/cancellation does not restore credentials or connections/i)).toBeInTheDocument();
  expect(screen.getByText(/Account requests revoke that user’s local agent connections/i)).toHaveTextContent('they do not erase connector credentials shared by the company');
  expect(screen.getByText(/provider-side revocation or erasure may still require operator completion/i)).toBeInTheDocument();
  expect(api).toHaveBeenCalledWith('/api/privacy/deletion-requests');
});

test('requires the exact account phrase and displays the pending scheduled date', async () => {
  api.mockImplementation((path, options) => {
    if (path === '/api/privacy/deletion-requests' && !options) return Promise.resolve({ requests: [] });
    if (path === '/api/privacy/deletion-requests' && options?.method === 'POST') {
      return Promise.resolve({
        request: {
          id: 'request-account',
          scope: 'account',
          status: 'pending',
          scheduled_for: '2026-08-12T12:00:00.000Z',
        },
      });
    }
    return Promise.reject(new Error(`unexpected API call: ${path}`));
  });
  render(<PrivacySettings />);

  fireEvent.click(await screen.findByRole('button', { name: 'Request account deletion' }));
  const dialog = screen.getByRole('dialog', { name: 'Confirm account deletion' });
  expect(within(dialog).getByText(/immediately revokes your local agent connections and Brian legacy agent credentials/i)).toHaveTextContent('Shared company connector credentials are not erased by an account request');

  const confirmation = within(dialog).getByRole('textbox', { name: /DELETE MY ACCOUNT/ });
  const submit = within(dialog).getByRole('button', { name: 'Schedule account deletion' });
  fireEvent.change(confirmation, { target: { value: 'delete my account' } });
  expect(submit).toBeDisabled();
  fireEvent.change(confirmation, { target: { value: 'DELETE MY ACCOUNT' } });
  expect(submit).toBeEnabled();
  fireEvent.click(submit);

  await waitFor(() => expect(api).toHaveBeenCalledWith('/api/privacy/deletion-requests', {
    method: 'POST',
    body: { scope: 'account' },
  }));
  expect(await screen.findByText('Pending deletion')).toBeInTheDocument();
  expect(screen.getByText(/account deletion scheduled/i)).toBeInTheDocument();
  expect(screen.getByText(/legacy agent credentials attributed to your account have been revoked/i)).toBeInTheDocument();
  expect(screen.getByText(/Scheduled for/)).toHaveTextContent('2026');
});

test('requires the exact current company name for an owner', async () => {
  useAuth.mockReturnValue({ profile: ownerProfile });
  api.mockImplementation((path, options) => {
    if (path === '/api/privacy/deletion-requests' && !options) return Promise.resolve({ requests: [] });
    if (path === '/api/privacy/deletion-requests' && options?.method === 'POST') {
      return Promise.resolve({ request: { id: 'request-company', scope: 'company', status: 'pending' } });
    }
    return Promise.reject(new Error(`unexpected API call: ${path}`));
  });
  render(<PrivacySettings />);

  fireEvent.click(await screen.findByRole('button', { name: 'Request company deletion' }));
  const dialog = screen.getByRole('dialog', { name: 'Confirm company deletion' });
  const confirmation = within(dialog).getByRole('textbox', { name: /Northwind Labs/ });
  const submit = within(dialog).getByRole('button', { name: 'Schedule company deletion' });

  fireEvent.change(confirmation, { target: { value: 'northwind labs' } });
  expect(submit).toBeDisabled();
  fireEvent.change(confirmation, { target: { value: 'Northwind Labs' } });
  fireEvent.click(submit);

  await waitFor(() => expect(api).toHaveBeenCalledWith('/api/privacy/deletion-requests', {
    method: 'POST',
    body: { scope: 'company' },
  }));
  expect(await screen.findByText(/stored connector credentials and sync cursors have been erased/i)).toBeInTheDocument();
});

test('cancels a pending request without promising revoked access will return', async () => {
  const request = {
    id: 'request-account',
    scope: 'account',
    status: 'pending',
    scheduled_for: '2026-08-12T12:00:00.000Z',
  };
  api.mockImplementation((path, options) => {
    if (path === '/api/privacy/deletion-requests' && !options) return Promise.resolve({ requests: [request] });
    if (path === '/api/privacy/deletion-requests/request-account' && options?.method === 'DELETE') {
      return Promise.resolve({ request: { ...request, status: 'cancelled' } });
    }
    return Promise.reject(new Error(`unexpected API call: ${path}`));
  });
  render(<PrivacySettings />);

  fireEvent.click(await screen.findByRole('button', { name: 'Cancel deletion request' }));

  await waitFor(() => expect(api).toHaveBeenCalledWith('/api/privacy/deletion-requests/request-account', { method: 'DELETE' }));
  expect(await screen.findByText(/Previously revoked credentials and connections were not restored/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Request account deletion' })).toBeInTheDocument();
});

test('stops offering cancellation when a pending request has crossed its scheduled cutoff', async () => {
  api.mockResolvedValueOnce({
    requests: [{
      id: 'request-overdue',
      scope: 'account',
      status: 'pending',
      scheduled_for: '2020-01-01T00:00:00.000Z',
    }],
  });
  render(<PrivacySettings />);

  expect(await screen.findByText(/scheduled time has passed/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Cancel deletion request' })).not.toBeInTheDocument();
});

test('keeps deletion controls unavailable when pending requests cannot be verified', async () => {
  api.mockRejectedValueOnce(new Error('Privacy service unavailable'));
  render(<PrivacySettings />);

  expect(await screen.findByRole('alert')).toHaveTextContent('Privacy service unavailable');
  expect(screen.queryByRole('button', { name: 'Request account deletion' })).not.toBeInTheDocument();
  expect(screen.getByText(/controls stay unavailable until Brian can verify/i)).toBeInTheDocument();

  api.mockResolvedValueOnce({ requests: [] });
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByRole('button', { name: 'Request account deletion' })).toBeInTheDocument();
});
