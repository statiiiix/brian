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
    'How it works',
    'Pricing',
    'FAQ',
  ].forEach((kicker) => {
    expect(screen.getAllByText(kicker).length).toBeGreaterThan(0);
  });
});

test('/app redirects to login when logged out', () => {
  localStorage.clear();
  window.history.pushState({}, '', '/app');
  render(<App />);
  expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
});
