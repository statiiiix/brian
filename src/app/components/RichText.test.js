import { render, screen, waitFor } from '@testing-library/react';
import RichText from './RichText';

test('renders the light markdown Brian writes', () => {
  const { container } = render(
    <RichText text={'## Refund window\n\nRefund **fast** when the customer is *clearly* right.\n\n- under `$200` is automatic\n- over $200 goes to the lead'} />,
  );

  expect(screen.getByRole('heading', { name: 'Refund window' })).toBeInTheDocument();
  expect(container.querySelector('strong')).toHaveTextContent('fast');
  expect(container.querySelector('em')).toHaveTextContent('clearly');
  expect(container.querySelector('code')).toHaveTextContent('$200');
  expect(container.querySelectorAll('ul li')).toHaveLength(2);
});

test('keeps numbered steps and paragraph breaks apart', () => {
  const { container } = render(
    <RichText text={'First thought.\nSecond line.\n\n1. look up the order\n2. refund it'} />,
  );

  expect(container.querySelectorAll('p')).toHaveLength(1);
  expect(container.querySelectorAll('br')).toHaveLength(1);
  expect(container.querySelectorAll('ol li')).toHaveLength(2);
});

// Interview text is model output grounded in Notion pages and uploaded files,
// so it must never reach the DOM as markup.
test('renders markup in a message as text, not HTML', () => {
  const { container } = render(
    <RichText text={'<img src=x onerror="alert(1)"> and <b>bold</b>'} />,
  );

  expect(container.querySelector('img')).toBeNull();
  expect(container.querySelector('b')).toBeNull();
  expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
});

test('only links http and https targets', () => {
  const { container } = render(
    <RichText text={'[safe](https://example.com/a) [unsafe](javascript:alert(1))'} />,
  );

  const links = container.querySelectorAll('a');
  expect(links).toHaveLength(1);
  expect(links[0]).toHaveAttribute('href', 'https://example.com/a');
  expect(container.textContent).toContain('[unsafe](javascript:alert(1))');
});

test('shows history immediately and reveals a new message to completion', async () => {
  const { container, rerender } = render(<RichText text="Already answered." />);
  expect(container.textContent).toBe('Already answered.');

  const onReveal = jest.fn();
  rerender(<RichText text="A brand new question?" reveal onReveal={onReveal} />);
  await waitFor(() => expect(container.textContent).toBe('A brand new question?'));
  expect(onReveal).toHaveBeenCalled();
});
