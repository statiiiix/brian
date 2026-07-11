import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Connectors from './Connectors';
import { api } from '../api';

jest.mock('../api', () => ({ api: jest.fn() }));

const PROVIDER_IDS = [
  'google', 'slack', 'notion', 'confluence', 'sharepoint', 'onedrive', 'jira', 'linear',
  'github', 'asana', 'clickup', 'zendesk', 'intercom', 'hubspot', 'salesforce', 'gong',
  'microsoft_teams', 'outlook', 'zoom',
];
const CONFIGURED_PROVIDERS = Object.fromEntries(PROVIDER_IDS.map((id) => [id, { configured: true }]));

beforeEach(() => {
  api.mockImplementation((path) => {
    if (path === '/api/connectors' || path.startsWith('/api/evidence')) return Promise.resolve([]);
    if (path === '/api/connectors/providers') return Promise.resolve(CONFIGURED_PROVIDERS);
    return Promise.reject(new Error(`unexpected API call: ${path}`));
  });
});

afterEach(() => jest.clearAllMocks());

test('every configured source offers authorization', async () => {
  render(<MemoryRouter><Connectors /></MemoryRouter>);

  await waitFor(() => expect(api).toHaveBeenCalledWith('/api/connectors'));
  await waitFor(() => expect(api).toHaveBeenCalledWith('/api/connectors/providers'));
  expect(await screen.findByRole('button', { name: 'Authorize Google Workspace' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Authorize Slack' })).toBeInTheDocument();

  const notionCard = screen.getByRole('heading', { level: 4, name: 'Notion' }).closest('article');
  expect(within(notionCard).getByRole('button', { name: 'Authorize Notion' })).toBeInTheDocument();
  expect(within(notionCard).getByText('Ready to connect')).toBeInTheDocument();
});

test('an unconfigured provider is shown as a Brian setup task and cannot fail on click', async () => {
  api.mockImplementation((path) => {
    if (path === '/api/connectors' || path.startsWith('/api/evidence')) return Promise.resolve([]);
    if (path === '/api/connectors/providers') {
      return Promise.resolve({ ...CONFIGURED_PROVIDERS, salesforce: { configured: false } });
    }
    return Promise.reject(new Error(`unexpected API call: ${path}`));
  });
  render(<MemoryRouter><Connectors /></MemoryRouter>);

  const salesforceCard = screen.getByRole('heading', { level: 4, name: 'Salesforce' }).closest('article');
  await waitFor(() => expect(within(salesforceCard).getByRole('button', { name: 'Setup required' })).toBeDisabled());
  expect(api).not.toHaveBeenCalledWith('/api/connectors/salesforce/start');
});

test('catalog authorization explains permissions before calling the backend', async () => {
  render(<MemoryRouter><Connectors /></MemoryRouter>);
  await waitFor(() => expect(api).toHaveBeenCalledWith('/api/connectors'));

  fireEvent.click(await screen.findByRole('button', { name: 'Authorize Notion' }));
  expect(screen.getByRole('dialog', { name: 'Authorize Notion' })).toBeInTheDocument();
  expect(screen.getByText('Pages shared with Brian')).toBeInTheDocument();
  expect(api).not.toHaveBeenCalledWith('/api/connectors/notion/start');

  api.mockRejectedValueOnce(new Error('Notion OAuth is not configured'));
  fireEvent.click(screen.getByRole('button', { name: 'Continue to Notion' }));
  await waitFor(() => expect(api).toHaveBeenCalledWith('/api/connectors/notion/start'));
  expect(await screen.findByText('Notion OAuth is not configured')).toBeInTheDocument();
});

test('Zendesk requires and sends the tenant subdomain', async () => {
  render(<MemoryRouter><Connectors /></MemoryRouter>);
  await waitFor(() => expect(api).toHaveBeenCalledWith('/api/connectors'));

  fireEvent.click(await screen.findByRole('button', { name: 'Authorize Zendesk' }));
  const continueButton = screen.getByRole('button', { name: 'Continue to Zendesk' });
  expect(continueButton).toBeDisabled();
  fireEvent.change(screen.getByPlaceholderText('acme'), { target: { value: 'northwind' } });
  expect(continueButton).toBeEnabled();

  api.mockRejectedValueOnce(new Error('Zendesk OAuth is not configured'));
  fireEvent.click(continueButton);
  await waitFor(() => expect(api).toHaveBeenCalledWith('/api/connectors/zendesk/start?workspace=northwind'));
});
