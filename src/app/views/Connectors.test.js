import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Connectors from './Connectors';
import { api } from '../api';

jest.mock('../api', () => ({ api: jest.fn() }));

beforeEach(() => {
  api.mockImplementation((path) => {
    if (path === '/api/connectors' || path.startsWith('/api/evidence')) return Promise.resolve([]);
    if (path === '/api/connectors/notion/start') {
      return Promise.reject(new Error('Notion authorization is not configured on this Brian deployment yet'));
    }
    return Promise.reject(new Error(`unexpected API call: ${path}`));
  });
});

afterEach(() => jest.clearAllMocks());

test('every catalog source has an authorization action and opens the permission flow', async () => {
  render(<MemoryRouter><Connectors /></MemoryRouter>);

  await waitFor(() => expect(api).toHaveBeenCalledWith('/api/connectors'));
  expect(screen.getAllByRole('button', { name: 'Authorize', exact: true })).toHaveLength(17);

  const notionCard = screen.getByRole('heading', { level: 4, name: 'Notion' }).closest('article');
  fireEvent.click(within(notionCard).getByRole('button', { name: 'Authorize' }));

  expect(screen.getByRole('dialog', { name: 'Authorize Notion' })).toBeInTheDocument();
  expect(screen.getByText('Pages shared with Brian')).toBeInTheDocument();
  expect(screen.getByText(/Select the pages and teamspaces/i)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Continue to Notion' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Notion authorization is not configured');
});
