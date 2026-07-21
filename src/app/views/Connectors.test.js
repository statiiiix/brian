import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Connectors from './Connectors';
import { api } from '../api';
import { clearCache } from '../queryCache';

jest.mock('../api', () => ({ api: jest.fn() }));

const PROVIDER_IDS = [
  'google', 'slack', 'notion', 'confluence', 'sharepoint', 'onedrive', 'jira', 'linear',
  'github', 'asana', 'clickup', 'zendesk', 'intercom', 'hubspot', 'salesforce', 'gong',
  'microsoft_teams', 'outlook', 'zoom',
];
const CONFIGURED_PROVIDERS = Object.fromEntries(PROVIDER_IDS.map((id) => [id, { configured: true }]));

beforeEach(() => {
  // The view caches responses across mounts; each test needs a cold start.
  clearCache();
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
      return Promise.resolve({ ...CONFIGURED_PROVIDERS, salesforce: { configured: false, verified: false } });
    }
    return Promise.reject(new Error(`unexpected API call: ${path}`));
  });
  render(<MemoryRouter><Connectors /></MemoryRouter>);

  const salesforceCard = screen.getByRole('heading', { level: 4, name: 'Salesforce' }).closest('article');
  await screen.findByRole('button', { name: 'Authorize HubSpot' });
  expect(within(salesforceCard).getByRole('button', { name: 'Setup required' })).toBeDisabled();
  expect(api).not.toHaveBeenCalledWith('/api/connectors/salesforce/start');
});

test('a configured but unverified catalog provider remains available for its verification sync', async () => {
  api.mockImplementation((path) => {
    if (path === '/api/connectors') {
      return Promise.resolve([{ type: 'notion', status: 'connected', selection_ready: true, settings: { selected_page_ids: ['page-1'], selected_data_source_ids: [] }, last_synced_at: null }]);
    }
    if (path.startsWith('/api/evidence')) return Promise.resolve([]);
    if (path === '/api/connectors/providers') {
      return Promise.resolve({ ...CONFIGURED_PROVIDERS, notion: { configured: true, verified: false } });
    }
    return Promise.reject(new Error(`unexpected API call: ${path}`));
  });
  render(<MemoryRouter><Connectors /></MemoryRouter>);

  const notionCard = screen.getByRole('heading', { level: 4, name: 'Notion' }).closest('article');
  expect(await within(notionCard).findByText('Configured · unverified')).toBeInTheDocument();
  expect(within(notionCard).getByText(/production data access has not been verified/i)).toBeInTheDocument();
  expect(within(notionCard).getByRole('button', { name: 'Sync focused source' })).toBeDisabled();
  expect(within(notionCard).queryByRole('button', { name: 'Verification required' })).not.toBeInTheDocument();
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

test('a connected catalog source syncs with the learning goal', async () => {
  api.mockImplementation((path, opts) => {
    if (path === '/api/connectors') {
      return Promise.resolve([{ type: 'notion', status: 'connected', selection_ready: true, settings: { selected_page_ids: ['page-1'], selected_data_source_ids: [] }, last_synced_at: '2026-07-17T10:00:00Z' }]);
    }
    if (path.startsWith('/api/evidence')) return Promise.resolve([]);
    if (path === '/api/connectors/providers') return Promise.resolve(CONFIGURED_PROVIDERS);
    if (path === '/api/connectors/notion/sync') {
      expect(opts.body.focus).toBe('Approval workflow rules');
      return Promise.resolve({ fetched: 12, kept: 5, evidence: 3, drafts: 1 });
    }
    return Promise.reject(new Error(`unexpected API call: ${path}`));
  });
  render(<MemoryRouter><Connectors /></MemoryRouter>);

  const notionCard = (await screen.findByRole('heading', { level: 4, name: 'Notion' })).closest('article');
  const syncButton = await within(notionCard).findByRole('button', { name: /Sync focused source/ });
  expect(syncButton).toBeDisabled(); // no learning goal yet

  fireEvent.change(screen.getByLabelText('Learning goal'), { target: { value: 'Approval workflow rules' } });
  expect(syncButton).toBeEnabled();
  fireEvent.click(syncButton);

  await waitFor(() => expect(api).toHaveBeenCalledWith('/api/connectors/notion/sync', expect.anything()));
  expect(await within(notionCard).findByText(/Fetched 12 · kept 5 · evidence 3 · drafts 1/)).toBeInTheDocument();
  expect(screen.getByText(/1 draft created/)).toBeInTheDocument();
});

test('a connected Notion source without a selection requires choosing pages before sync', async () => {
  api.mockImplementation((path) => {
    if (path === '/api/connectors') return Promise.resolve([{
      type: 'notion', status: 'connected', selection_ready: false,
      settings: { selected_page_ids: [], selected_data_source_ids: [] },
    }]);
    if (path.startsWith('/api/evidence')) return Promise.resolve([]);
    if (path === '/api/connectors/providers') return Promise.resolve(CONFIGURED_PROVIDERS);
    return Promise.reject(new Error(`unexpected API call: ${path}`));
  });
  render(<MemoryRouter><Connectors /></MemoryRouter>);

  const notionCard = (await screen.findByRole('heading', { level: 4, name: 'Notion' })).closest('article');
  expect(await within(notionCard).findByRole('button', { name: 'Choose Notion pages' })).toBeInTheDocument();
  expect(within(notionCard).queryByRole('button', { name: 'Sync focused source' })).not.toBeInTheDocument();
  expect(api).not.toHaveBeenCalledWith('/api/connectors/notion/boundaries');
});

test('opening the Notion picker loads boundaries once in separate preselected groups', async () => {
  api.mockImplementation((path) => {
    if (path === '/api/connectors') return Promise.resolve([{
      type: 'notion', status: 'connected', selection_ready: false,
      settings: { selected_page_ids: ['page-1'], selected_data_source_ids: ['source-1'] },
    }]);
    if (path.startsWith('/api/evidence')) return Promise.resolve([]);
    if (path === '/api/connectors/providers') return Promise.resolve(CONFIGURED_PROVIDERS);
    if (path === '/api/connectors/notion/boundaries') return Promise.resolve({
      boundaries: [
        { id: 'page-1', kind: 'page', title: 'Engineering handbook', permalink: 'https://www.notion.so/engineering-handbook' },
        { id: 'source-1', kind: 'data_source', title: 'Customer playbooks', permalink: 'https://www.notion.so/customer-playbooks' },
      ],
      truncated: false,
    });
    return Promise.reject(new Error(`unexpected API call: ${path}`));
  });
  render(<MemoryRouter><Connectors /></MemoryRouter>);

  fireEvent.click(await screen.findByRole('button', { name: 'Choose Notion pages' }));
  const picker = await screen.findByRole('dialog', { name: 'Choose Notion pages' });
  await waitFor(() => expect(api).toHaveBeenCalledTimes(4));
  expect(within(picker).getByRole('group', { name: 'Pages' })).toBeInTheDocument();
  expect(within(picker).getByRole('group', { name: 'Data sources' })).toBeInTheDocument();
  expect(within(picker).getByRole('checkbox', { name: 'Engineering handbook' })).toBeChecked();
  expect(within(picker).getByRole('checkbox', { name: 'Customer playbooks' })).toBeChecked();
  expect(within(picker).getByRole('link', { name: 'Open Engineering handbook in Notion' })).toHaveAttribute('href', 'https://www.notion.so/engineering-handbook');
});

test('the Notion picker requires a selection and saves exactly both selection arrays', async () => {
  api.mockImplementation((path, options) => {
    if (path === '/api/connectors') return Promise.resolve([{
      type: 'notion', status: 'connected', selection_ready: false,
      settings: { selected_page_ids: [], selected_data_source_ids: [] },
    }]);
    if (path.startsWith('/api/evidence')) return Promise.resolve([]);
    if (path === '/api/connectors/providers') return Promise.resolve(CONFIGURED_PROVIDERS);
    if (path === '/api/connectors/notion/boundaries') return Promise.resolve({
      boundaries: [
        { id: 'page-1', kind: 'page', title: 'Engineering handbook', permalink: 'https://www.notion.so/engineering-handbook' },
        { id: 'source-1', kind: 'data_source', title: 'Customer playbooks', permalink: 'https://www.notion.so/customer-playbooks' },
      ],
      truncated: false,
    });
    if (path === '/api/connectors/notion/settings') {
      expect(options).toEqual({ method: 'PUT', body: { selected_page_ids: ['page-1'], selected_data_source_ids: ['source-1'] } });
      return Promise.resolve({});
    }
    return Promise.reject(new Error(`unexpected API call: ${path}`));
  });
  render(<MemoryRouter><Connectors /></MemoryRouter>);

  fireEvent.click(await screen.findByRole('button', { name: 'Choose Notion pages' }));
  const picker = await screen.findByRole('dialog', { name: 'Choose Notion pages' });
  expect(within(picker).getByRole('button', { name: 'Save selection' })).toBeDisabled();
  fireEvent.click(await within(picker).findByRole('checkbox', { name: 'Engineering handbook' }));
  fireEvent.click(within(picker).getByRole('checkbox', { name: 'Customer playbooks' }));
  fireEvent.click(within(picker).getByRole('button', { name: 'Save selection' }));
  await waitFor(() => expect(api).toHaveBeenCalledWith('/api/connectors/notion/settings', {
    method: 'PUT', body: { selected_page_ids: ['page-1'], selected_data_source_ids: ['source-1'] },
  }));
});

test('saving a Notion selection reloads rows, closes the picker, and enables focused sync when a goal is present', async () => {
  let connectorReads = 0;
  let evidenceReads = 0;
  api.mockImplementation((path) => {
    if (path === '/api/connectors') {
      connectorReads += 1;
      return Promise.resolve([{
        type: 'notion', status: 'connected', selection_ready: connectorReads > 1,
        settings: { selected_page_ids: ['page-1'], selected_data_source_ids: [] },
      }]);
    }
    if (path.startsWith('/api/evidence')) {
      evidenceReads += 1;
      return evidenceReads === 1 ? Promise.resolve([]) : Promise.reject(new Error('evidence refresh failed'));
    }
    if (path === '/api/connectors/providers') return Promise.resolve(CONFIGURED_PROVIDERS);
    if (path === '/api/connectors/notion/boundaries') return Promise.resolve({
      boundaries: [{ id: 'page-1', kind: 'page', title: 'Engineering handbook', permalink: 'https://www.notion.so/engineering-handbook' }],
      truncated: false,
    });
    if (path === '/api/connectors/notion/settings') return Promise.resolve({});
    return Promise.reject(new Error(`unexpected API call: ${path}`));
  });
  render(<MemoryRouter><Connectors /></MemoryRouter>);

  fireEvent.change(screen.getByLabelText('Learning goal'), { target: { value: 'Approval workflow rules' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Choose Notion pages' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Save selection' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Choose Notion pages' })).not.toBeInTheDocument());
  const notionCard = screen.getByRole('heading', { level: 4, name: 'Notion' }).closest('article');
  const syncButton = within(notionCard).getByRole('button', { name: 'Sync focused source' });
  expect(syncButton).toHaveFocus();
  expect(syncButton).toBeEnabled();
});

test('a saved Notion selection stays open when connector rows cannot refresh', async () => {
  let connectorReads = 0;
  api.mockImplementation((path) => {
    if (path === '/api/connectors') {
      connectorReads += 1;
      return connectorReads === 1 ? Promise.resolve([{
        type: 'notion', status: 'connected', selection_ready: false,
        settings: { selected_page_ids: ['page-1'], selected_data_source_ids: [] },
      }]) : Promise.reject(new Error('connector refresh failed'));
    }
    if (path.startsWith('/api/evidence')) return Promise.resolve([]);
    if (path === '/api/connectors/providers') return Promise.resolve(CONFIGURED_PROVIDERS);
    if (path === '/api/connectors/notion/boundaries') return Promise.resolve({
      boundaries: [{ id: 'page-1', kind: 'page', title: 'Engineering handbook', permalink: 'https://www.notion.so/engineering-handbook' }],
      truncated: false,
    });
    if (path === '/api/connectors/notion/settings') return Promise.resolve({});
    return Promise.reject(new Error(`unexpected API call: ${path}`));
  });
  render(<MemoryRouter><Connectors /></MemoryRouter>);

  fireEvent.click(await screen.findByRole('button', { name: 'Choose Notion pages' }));
  const picker = await screen.findByRole('dialog', { name: 'Choose Notion pages' });
  fireEvent.click(await within(picker).findByRole('button', { name: 'Save selection' }));
  expect(await within(picker).findByRole('alert')).toHaveTextContent('We could not refresh your connected sources. Please try again.');
  expect(within(picker).getByRole('checkbox', { name: 'Engineering handbook' })).toBeChecked();
  expect(screen.queryByText(/Notion selection saved/i)).not.toBeInTheDocument();
});

test('the Notion picker traps focus, hides background controls, and restores its opener', async () => {
  api.mockImplementation((path) => {
    if (path === '/api/connectors') return Promise.resolve([{
      type: 'notion', status: 'connected', selection_ready: false,
      settings: { selected_page_ids: [], selected_data_source_ids: [] },
    }]);
    if (path.startsWith('/api/evidence')) return Promise.resolve([]);
    if (path === '/api/connectors/providers') return Promise.resolve(CONFIGURED_PROVIDERS);
    if (path === '/api/connectors/notion/boundaries') return Promise.resolve({ boundaries: [], truncated: false });
    return Promise.reject(new Error(`unexpected API call: ${path}`));
  });
  render(<MemoryRouter><Connectors /></MemoryRouter>);

  const opener = await screen.findByRole('button', { name: 'Choose Notion pages' });
  fireEvent.click(opener);
  const picker = await screen.findByRole('dialog', { name: 'Choose Notion pages' });
  const close = within(picker).getByRole('button', { name: 'Close Notion page selection' });
  const cancel = within(picker).getByRole('button', { name: 'Cancel' });
  expect(close).toHaveFocus();
  expect(screen.queryByRole('button', { name: 'Choose Notion pages' })).not.toBeInTheDocument();
  fireEvent.keyDown(picker, { key: 'Tab', shiftKey: true });
  expect(cancel).toHaveFocus();
  fireEvent.keyDown(picker, { key: 'Tab' });
  expect(close).toHaveFocus();
  fireEvent.click(cancel);
  await waitFor(() => expect(opener).toHaveFocus());
});

test('the Notion picker hides and restores app-shell siblings outside its portal', async () => {
  const shellLogout = document.createElement('button');
  shellLogout.textContent = 'Shell logout';
  shellLogout.setAttribute('aria-hidden', 'false');
  document.body.append(shellLogout);
  api.mockImplementation((path) => {
    if (path === '/api/connectors') return Promise.resolve([{
      type: 'notion', status: 'connected', selection_ready: false,
      settings: { selected_page_ids: [], selected_data_source_ids: [] },
    }]);
    if (path.startsWith('/api/evidence')) return Promise.resolve([]);
    if (path === '/api/connectors/providers') return Promise.resolve(CONFIGURED_PROVIDERS);
    if (path === '/api/connectors/notion/boundaries') return Promise.resolve({ boundaries: [], truncated: false });
    return Promise.reject(new Error(`unexpected API call: ${path}`));
  });
  render(<MemoryRouter><Connectors /></MemoryRouter>);

  fireEvent.click(await screen.findByRole('button', { name: 'Choose Notion pages' }));
  const picker = await screen.findByRole('dialog', { name: 'Choose Notion pages' });
  expect(shellLogout).toHaveAttribute('aria-hidden', 'true');
  expect(shellLogout).toHaveAttribute('inert');
  expect(shellLogout).not.toHaveFocus();
  fireEvent.click(within(picker).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(shellLogout).toHaveAttribute('aria-hidden', 'false'));
  expect(shellLogout).not.toHaveAttribute('inert');
  shellLogout.remove();
});

test('a successful row refresh clears only the refresh error and preserves a callback error', async () => {
  let connectorReads = 0;
  api.mockImplementation((path) => {
    if (path === '/api/connectors') {
      connectorReads += 1;
      if (connectorReads === 2) return Promise.reject(new Error('refresh failed'));
      return Promise.resolve([{
        type: 'notion', status: 'connected', selection_ready: connectorReads > 2,
        settings: { selected_page_ids: ['page-1'], selected_data_source_ids: [] },
      }]);
    }
    if (path.startsWith('/api/evidence')) return Promise.resolve([]);
    if (path === '/api/connectors/providers') return Promise.resolve(CONFIGURED_PROVIDERS);
    if (path === '/api/connectors/notion/boundaries') return Promise.resolve({
      boundaries: [{ id: 'page-1', kind: 'page', title: 'Engineering handbook', permalink: 'https://www.notion.so/engineering-handbook' }],
      truncated: false,
    });
    if (path === '/api/connectors/notion/settings') return Promise.resolve({});
    return Promise.reject(new Error(`unexpected API call: ${path}`));
  });
  render(<MemoryRouter initialEntries={['/app/sources?error=oauth_failed']}><Connectors /></MemoryRouter>);

  fireEvent.click(await screen.findByRole('button', { name: 'Choose Notion pages' }));
  const picker = await screen.findByRole('dialog', { name: 'Choose Notion pages' });
  fireEvent.click(await within(picker).findByRole('button', { name: 'Save selection' }));
  expect(await screen.findByText('We could not refresh connected sources. Please try again.')).toBeInTheDocument();
  expect(screen.getByText('oauth failed')).toBeInTheDocument();
  fireEvent.click(within(picker).getByRole('button', { name: 'Save selection' }));
  await waitFor(() => expect(screen.queryByText('We could not refresh connected sources. Please try again.')).not.toBeInTheDocument());
  expect(screen.getByText('oauth failed')).toBeInTheDocument();
});

test('the Notion picker cannot be dismissed by Escape or backdrop while busy', async () => {
  let resolveBoundaries;
  const pendingBoundaries = new Promise((resolve) => { resolveBoundaries = resolve; });
  api.mockImplementation((path) => {
    if (path === '/api/connectors') return Promise.resolve([{
      type: 'notion', status: 'connected', selection_ready: false,
      settings: { selected_page_ids: [], selected_data_source_ids: [] },
    }]);
    if (path.startsWith('/api/evidence')) return Promise.resolve([]);
    if (path === '/api/connectors/providers') return Promise.resolve(CONFIGURED_PROVIDERS);
    if (path === '/api/connectors/notion/boundaries') return pendingBoundaries;
    return Promise.reject(new Error(`unexpected API call: ${path}`));
  });
  render(<MemoryRouter><Connectors /></MemoryRouter>);

  fireEvent.click(await screen.findByRole('button', { name: 'Choose Notion pages' }));
  const picker = await screen.findByRole('dialog', { name: 'Choose Notion pages' });
  fireEvent.keyDown(window, { key: 'Escape' });
  fireEvent.mouseDown(picker.parentElement);
  expect(screen.getByRole('dialog', { name: 'Choose Notion pages' })).toBeInTheDocument();
  expect(within(picker).getByRole('button', { name: 'Close Notion page selection' })).toBeDisabled();
  resolveBoundaries({ boundaries: [], truncated: false });
  await waitFor(() => expect(within(picker).getByRole('button', { name: 'Close Notion page selection' })).toBeEnabled());
});

test('the Notion picker rejects non-Notion boundary links', async () => {
  api.mockImplementation((path) => {
    if (path === '/api/connectors') return Promise.resolve([{
      type: 'notion', status: 'connected', selection_ready: false,
      settings: { selected_page_ids: [], selected_data_source_ids: [] },
    }]);
    if (path.startsWith('/api/evidence')) return Promise.resolve([]);
    if (path === '/api/connectors/providers') return Promise.resolve(CONFIGURED_PROVIDERS);
    if (path === '/api/connectors/notion/boundaries') return Promise.resolve({
      boundaries: [{ id: 'page-1', kind: 'page', title: 'Engineering handbook', permalink: 'https://example.com/notion' }],
      truncated: false,
    });
    return Promise.reject(new Error(`unexpected API call: ${path}`));
  });
  render(<MemoryRouter><Connectors /></MemoryRouter>);

  fireEvent.click(await screen.findByRole('button', { name: 'Choose Notion pages' }));
  const picker = await screen.findByRole('dialog', { name: 'Choose Notion pages' });
  expect(await within(picker).findByRole('checkbox', { name: 'Engineering handbook' })).toBeInTheDocument();
  expect(within(picker).queryByRole('link', { name: 'Open Engineering handbook in Notion' })).not.toBeInTheDocument();
});

test('a connected Notion source can still disconnect before selecting pages', async () => {
  api.mockImplementation((path, options) => {
    if (path === '/api/connectors') return Promise.resolve([{
      type: 'notion', status: 'connected', selection_ready: false,
      settings: { selected_page_ids: [], selected_data_source_ids: [] },
    }]);
    if (path.startsWith('/api/evidence')) return Promise.resolve([]);
    if (path === '/api/connectors/providers') return Promise.resolve(CONFIGURED_PROVIDERS);
    if (path === '/api/connectors/notion/disable') {
      expect(options).toEqual({ method: 'POST' });
      return Promise.resolve({});
    }
    return Promise.reject(new Error(`unexpected API call: ${path}`));
  });
  render(<MemoryRouter><Connectors /></MemoryRouter>);

  const notionCard = (await screen.findByRole('heading', { level: 4, name: 'Notion' })).closest('article');
  fireEvent.click(await within(notionCard).findByRole('button', { name: 'Disconnect' }));
  await waitFor(() => expect(api).toHaveBeenCalledWith('/api/connectors/notion/disable', { method: 'POST' }));
});

test('Notion discovery and save failures use a safe error and retain the current choice', async () => {
  let boundariesAttempt = 0;
  api.mockImplementation((path) => {
    if (path === '/api/connectors') return Promise.resolve([{
      type: 'notion', status: 'connected', selection_ready: false,
      settings: { selected_page_ids: ['page-1'], selected_data_source_ids: [] },
    }]);
    if (path.startsWith('/api/evidence')) return Promise.resolve([]);
    if (path === '/api/connectors/providers') return Promise.resolve(CONFIGURED_PROVIDERS);
    if (path === '/api/connectors/notion/boundaries') {
      boundariesAttempt += 1;
      if (boundariesAttempt === 1) return Promise.reject(new Error('provider token leaked'));
      return Promise.resolve({
        boundaries: [{ id: 'page-1', kind: 'page', title: 'Engineering handbook', permalink: 'https://www.notion.so/engineering-handbook' }],
        truncated: false,
      });
    }
    if (path === '/api/connectors/notion/settings') return Promise.reject(new Error('provider token leaked'));
    return Promise.reject(new Error(`unexpected API call: ${path}`));
  });
  render(<MemoryRouter><Connectors /></MemoryRouter>);

  fireEvent.click(await screen.findByRole('button', { name: 'Choose Notion pages' }));
  const picker = await screen.findByRole('dialog', { name: 'Choose Notion pages' });
  expect(await within(picker).findByRole('alert')).toHaveTextContent('We could not load Notion pages. Please try again.');
  fireEvent.click(within(picker).getByRole('button', { name: 'Try again' }));
  const choice = await within(picker).findByRole('checkbox', { name: 'Engineering handbook' });
  expect(choice).toBeChecked();
  fireEvent.click(within(picker).getByRole('button', { name: 'Save selection' }));
  expect(await within(picker).findByRole('alert')).toHaveTextContent('We could not save your Notion selection. Please try again.');
  expect(choice).toBeChecked();
});

test('the Notion picker warns when the discovery list is incomplete', async () => {
  api.mockImplementation((path) => {
    if (path === '/api/connectors') return Promise.resolve([{
      type: 'notion', status: 'connected', selection_ready: false,
      settings: { selected_page_ids: [], selected_data_source_ids: [] },
    }]);
    if (path.startsWith('/api/evidence')) return Promise.resolve([]);
    if (path === '/api/connectors/providers') return Promise.resolve(CONFIGURED_PROVIDERS);
    if (path === '/api/connectors/notion/boundaries') return Promise.resolve({ boundaries: [], truncated: true });
    return Promise.reject(new Error(`unexpected API call: ${path}`));
  });
  render(<MemoryRouter><Connectors /></MemoryRouter>);

  fireEvent.click(await screen.findByRole('button', { name: 'Choose Notion pages' }));
  expect(await screen.findByText(/only the first bounded set is shown/i)).toBeInTheDocument();
  expect(screen.getByText(/narrow what you share in Notion and try again/i)).toBeInTheDocument();
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

test('a fresh Notion connect auto-opens the picker and hands off to a grounded interview', async () => {
  api.mockImplementation((path) => {
    if (path === '/api/connectors') return Promise.resolve([{
      type: 'notion', status: 'connected', selection_ready: false,
      settings: { selected_page_ids: [], selected_data_source_ids: [] },
    }]);
    if (path.startsWith('/api/evidence')) return Promise.resolve([]);
    if (path === '/api/connectors/providers') return Promise.resolve(CONFIGURED_PROVIDERS);
    if (path === '/api/connectors/notion/boundaries') {
      return Promise.resolve({
        boundaries: [{ id: 'page-1', kind: 'page', title: 'Refund Runbook', permalink: 'https://notion.so/page-1' }],
        truncated: false,
      });
    }
    if (path === '/api/connectors/notion/settings') return Promise.resolve({});
    if (path === '/api/interviews') return Promise.resolve({ id: 'iv-1' });
    return Promise.reject(new Error(`unexpected API call: ${path}`));
  });
  render(<MemoryRouter initialEntries={['/app/connectors?connected=notion']}><Connectors /></MemoryRouter>);

  // The picker opens without any click after the OAuth redirect.
  const picker = await screen.findByRole('dialog', { name: 'Choose Notion pages' });
  fireEvent.click(await within(picker).findByRole('checkbox', { name: 'Refund Runbook' }));
  fireEvent.click(within(picker).getByRole('button', { name: 'Save selection' }));

  await waitFor(() => expect(api).toHaveBeenCalledWith('/api/connectors/notion/settings', {
    method: 'PUT', body: { selected_page_ids: ['page-1'], selected_data_source_ids: [] },
  }));
  await waitFor(() => expect(api).toHaveBeenCalledWith('/api/interviews', {
    method: 'POST', body: { source: { connector: 'notion' } },
  }));
});

test('a manual selection save does not start an interview', async () => {
  api.mockImplementation((path) => {
    if (path === '/api/connectors') return Promise.resolve([{
      type: 'notion', status: 'connected', selection_ready: false,
      settings: { selected_page_ids: [], selected_data_source_ids: [] },
    }]);
    if (path.startsWith('/api/evidence')) return Promise.resolve([]);
    if (path === '/api/connectors/providers') return Promise.resolve(CONFIGURED_PROVIDERS);
    if (path === '/api/connectors/notion/boundaries') {
      return Promise.resolve({
        boundaries: [{ id: 'page-1', kind: 'page', title: 'Refund Runbook', permalink: 'https://notion.so/page-1' }],
        truncated: false,
      });
    }
    if (path === '/api/connectors/notion/settings') return Promise.resolve({});
    return Promise.reject(new Error(`unexpected API call: ${path}`));
  });
  render(<MemoryRouter><Connectors /></MemoryRouter>);

  fireEvent.click(await screen.findByRole('button', { name: 'Choose Notion pages' }));
  const picker = await screen.findByRole('dialog', { name: 'Choose Notion pages' });
  fireEvent.click(await within(picker).findByRole('checkbox', { name: 'Refund Runbook' }));
  fireEvent.click(within(picker).getByRole('button', { name: 'Save selection' }));

  await waitFor(() => expect(api).toHaveBeenCalledWith('/api/connectors/notion/settings', expect.anything()));
  await screen.findByText(/Notion selection saved/);
  expect(api).not.toHaveBeenCalledWith('/api/interviews', expect.anything());
});
