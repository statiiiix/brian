import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Capture from './Capture';
import { api } from '../api';
import { supabase } from '../../lib/supabase';

jest.mock('../api', () => ({ api: jest.fn() }));
jest.mock('../../lib/supabase', () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));

const SKILL_INPUT = { name: 'Refund Escalation', trigger: 'refund request over $250' };

function proposal(route) {
  return { kind: 'skill', confidence: 0.9, input: SKILL_INPUT, auto: true, route };
}

const ASK_ROUTE = {
  kind: 'ask',
  candidates: [
    { id: 'skill-1', name: 'Refund Flow', trigger: 'refund request', status: 'active', distance: 0.3 },
    { id: 'skill-2', name: 'Order Lookup', trigger: 'order status', status: 'draft', distance: 0.42 },
  ],
};

function mockCapture(proposals, committed = []) {
  api.mockImplementation((path) => {
    if (path === '/api/capture/propose') return Promise.resolve({ proposals });
    if (path === '/api/capture/commit') return Promise.resolve({ items: committed });
    return Promise.reject(new Error(`unexpected API call: ${path}`));
  });
}

async function captureText() {
  render(<MemoryRouter><Capture /></MemoryRouter>);
  await userEvent.type(screen.getByLabelText('Knowledge to capture'), 'refunds over $250 escalate');
  await userEvent.click(screen.getByRole('button', { name: 'Capture' }));
}

afterEach(() => jest.clearAllMocks());

test('files without asking when nothing is ambiguous', async () => {
  mockCapture(
    [proposal({ kind: 'create' })],
    [{ kind: 'skill', action: 'created_active', id: 'skill-9', confidence: 0.9 }],
  );
  await captureText();

  await waitFor(() => expect(screen.getByText('Filed 1 item')).toBeInTheDocument());
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(api).toHaveBeenCalledWith('/api/capture/commit', expect.objectContaining({
    body: expect.objectContaining({ choices: {} }),
  }));
});

test('asks which skill an ambiguous capture belongs to, and files the answer for review', async () => {
  mockCapture(
    [proposal(ASK_ROUTE)],
    [{ kind: 'skill', action: 'proposed_draft', id: 'draft-1', confidence: 0.9 }],
  );
  await captureText();

  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent('No confident match for this skill');
  // Both plausible targets are offered, with the nearest first.
  expect(screen.getByRole('radio', { name: /Refund Flow/ })).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: /Order Lookup/ })).toBeInTheDocument();

  await userEvent.click(screen.getByRole('radio', { name: /Refund Flow/ }));
  await userEvent.click(screen.getByRole('button', { name: 'File it' }));

  await waitFor(() => expect(api).toHaveBeenCalledWith('/api/capture/commit', expect.objectContaining({
    body: expect.objectContaining({
      choices: { 0: { action: 'merge', targetId: 'skill-1', review: true } },
    }),
  })));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

test('creating a new skill is the default when no target is picked', async () => {
  mockCapture(
    [proposal(ASK_ROUTE)],
    [{ kind: 'skill', action: 'created_active', id: 'skill-9', confidence: 0.9 }],
  );
  await captureText();

  await screen.findByRole('dialog');
  await userEvent.click(screen.getByRole('button', { name: 'File it' }));

  await waitFor(() => expect(api).toHaveBeenCalledWith('/api/capture/commit', expect.objectContaining({
    body: expect.objectContaining({ choices: { 0: { action: 'create' } } }),
  })));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

test('walking away still files the capture the way it always did', async () => {
  mockCapture(
    [proposal(ASK_ROUTE)],
    [{ kind: 'skill', action: 'created_draft', id: 'draft-2', confidence: 0.9 }],
  );
  await captureText();

  await screen.findByRole('dialog');
  await userEvent.click(screen.getByRole('button', { name: 'Decide later' }));

  await waitFor(() => expect(api).toHaveBeenCalledWith('/api/capture/commit', expect.objectContaining({
    body: expect.objectContaining({ choices: {} }),
  })));
  await waitFor(() => expect(screen.getByText('Filed 1 item')).toBeInTheDocument());
});

test('steps through every ambiguous skill before filing', async () => {
  mockCapture(
    [
      { kind: 'context', confidence: 0.9, input: { content: 'c', summary: 's', tags: [] }, route: { kind: 'create' } },
      proposal(ASK_ROUTE),
      proposal(ASK_ROUTE),
    ],
    [],
  );
  await captureText();

  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent('1 of 2');
  await userEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(dialog).toHaveTextContent('2 of 2');

  await userEvent.click(screen.getByRole('radio', { name: /Order Lookup/ }));
  await userEvent.click(screen.getByRole('button', { name: 'File it' }));

  // Context (index 0) is never asked about; the two skills keep their indexes.
  await waitFor(() => expect(api).toHaveBeenCalledWith('/api/capture/commit', expect.objectContaining({
    body: expect.objectContaining({
      choices: {
        1: { action: 'create' },
        2: { action: 'merge', targetId: 'skill-2', review: true },
      },
    }),
  })));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

describe('speaking instead of typing', () => {
  let recorder;

  class FakeMediaRecorder {
    static isTypeSupported() { return true; }

    constructor(stream, options) {
      this.stream = stream;
      this.mimeType = options?.mimeType;
      recorder = this;
    }

    start() { this.state = 'recording'; }

    stop() {
      this.state = 'inactive';
      this.ondataavailable?.({ data: new Blob(['audio'], { type: 'audio/webm' }) });
      this.onstop?.();
    }
  }

  beforeEach(() => {
    window.MediaRecorder = FakeMediaRecorder;
    navigator.mediaDevices = {
      getUserMedia: jest.fn().mockResolvedValue({ getTracks: () => [{ stop: jest.fn() }] }),
    };
    mockCapture([proposal({ kind: 'create' })], []);
  });

  afterEach(() => {
    delete window.MediaRecorder;
    delete navigator.mediaDevices;
  });

  test('drops the transcript into the capture box instead of filing it', async () => {
    supabase.functions.invoke.mockResolvedValue({
      data: { text: 'Refunds over $250 need a manager.' },
      error: null,
    });
    render(<MemoryRouter><Capture /></MemoryRouter>);

    await userEvent.click(screen.getByRole('button', { name: 'Record a voice note' }));
    await screen.findByRole('button', { name: 'Stop recording and transcribe' });
    await userEvent.click(screen.getByRole('button', { name: 'Stop recording and transcribe' }));

    await waitFor(() => expect(screen.getByLabelText('Knowledge to capture'))
      .toHaveValue('Refunds over $250 need a manager.'));
    // Speech never files anything on its own — the user still presses Capture.
    expect(api).not.toHaveBeenCalledWith('/api/capture/propose', expect.anything());
  });

  test('appends to what is already typed rather than replacing it', async () => {
    supabase.functions.invoke.mockResolvedValue({ data: { text: 'And log it.' }, error: null });
    render(<MemoryRouter><Capture /></MemoryRouter>);

    await userEvent.type(screen.getByLabelText('Knowledge to capture'), 'Refund policy.');
    await userEvent.click(screen.getByRole('button', { name: 'Record a voice note' }));
    await screen.findByRole('button', { name: 'Stop recording and transcribe' });
    await userEvent.click(screen.getByRole('button', { name: 'Stop recording and transcribe' }));

    await waitFor(() => expect(screen.getByLabelText('Knowledge to capture'))
      .toHaveValue('Refund policy. And log it.'));
  });

  test('cancelling a recording transcribes nothing', async () => {
    render(<MemoryRouter><Capture /></MemoryRouter>);

    await userEvent.click(screen.getByRole('button', { name: 'Record a voice note' }));
    await screen.findByRole('button', { name: 'Stop recording and transcribe' });
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Record a voice note' })).toBeInTheDocument());
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Knowledge to capture')).toHaveValue('');
  });

  test('surfaces a blocked microphone with a way to recover', async () => {
    const denied = new Error('denied');
    denied.name = 'NotAllowedError';
    navigator.mediaDevices.getUserMedia.mockRejectedValue(denied);
    render(<MemoryRouter><Capture /></MemoryRouter>);

    await userEvent.click(screen.getByRole('button', { name: 'Record a voice note' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Microphone access was blocked');
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('reports what the transcription service said went wrong', async () => {
    supabase.functions.invoke.mockResolvedValue({
      data: null,
      error: { message: 'non-2xx', context: { json: async () => ({ error: 'recording is too long — keep it under 20 MB' }) } },
    });
    render(<MemoryRouter><Capture /></MemoryRouter>);

    await userEvent.click(screen.getByRole('button', { name: 'Record a voice note' }));
    await screen.findByRole('button', { name: 'Stop recording and transcribe' });
    await userEvent.click(screen.getByRole('button', { name: 'Stop recording and transcribe' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('recording is too long');
  });
});
