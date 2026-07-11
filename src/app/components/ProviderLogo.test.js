import { render, screen } from '@testing-library/react';
import ProviderLogo from './ProviderLogo';

test.each([
  ['google', 'Google Workspace'],
  ['sharepoint', 'SharePoint'],
  ['onedrive', 'OneDrive'],
  ['salesforce', 'Salesforce'],
  ['slack', 'Slack'],
  ['microsoft_teams', 'Microsoft Teams'],
])('%s renders a bundled SVG logo', (provider, label) => {
  const { container } = render(<ProviderLogo provider={provider} label={label} />);
  expect(screen.getByRole('img', { name: `${label} logo` })).toBeInTheDocument();
  expect(container.querySelector('svg path')).toHaveAttribute('d');
  expect(container.querySelector('img')).not.toBeInTheDocument();
});

test('Gong uses the bundled official SVG asset', () => {
  const { container } = render(<ProviderLogo provider="gong" label="Gong" />);
  const image = container.querySelector('img');
  expect(image).toHaveAttribute('src', expect.stringContaining('gong.svg'));
  expect(image?.src).not.toContain('cdn.simpleicons.org');
});
