import { render, screen } from '@testing-library/react';
import App from './App';

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

test('renders the hero headline at /', () => {
  window.history.pushState({}, '', '/');
  render(<App />);
  expect(
    screen.getByRole('heading', { level: 1, name: /company.*judgment/i })
  ).toBeInTheDocument();
});

test('renders all main landing sections', () => {
  window.history.pushState({}, '', '/');
  render(<App />);
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

test('/app redirects to login when logged out', () => {
  localStorage.clear();
  window.history.pushState({}, '', '/app');
  render(<App />);
  expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
});
