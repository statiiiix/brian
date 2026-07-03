import { render, screen } from '@testing-library/react';
import App from './App';

beforeAll(() => {
  // jsdom lacks IntersectionObserver and matchMedia used by the landing page.
  window.IntersectionObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  };
  window.matchMedia =
    window.matchMedia ||
    (() => ({ matches: false, addListener: () => {}, removeListener: () => {} }));
});

test('renders the hero headline', () => {
  render(<App />);
  expect(
    screen.getByRole('heading', { level: 1, name: /agents that follow/i })
  ).toBeInTheDocument();
});

test('renders all main landing sections', () => {
  render(<App />);
  // Some section kickers also appear as nav/footer links, hence getAllByText.
  [
    'The problem',
    'How it works',
    'The refusal',
    'Under the hood',
    'What you get',
    "Why we're building this",
    'Pricing',
    'FAQ',
  ].forEach((kicker) => {
    expect(screen.getAllByText(kicker).length).toBeGreaterThan(0);
  });
});
