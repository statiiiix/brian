import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

// Recording a voice note and turning it into text. The transcription itself
// happens in the `transcribe` edge function — the OpenAI key never reaches the
// browser.

// OpenAI accepts webm, mp4, m4a, wav, mp3, mpeg and mpga. Chrome and Firefox
// give us Opus in a webm container; Safari only offers mp4.
const FORMATS = [
  { mimeType: 'audio/webm;codecs=opus', extension: 'webm' },
  { mimeType: 'audio/webm', extension: 'webm' },
  { mimeType: 'audio/mp4', extension: 'mp4' },
];

// A capture is a thought, not a meeting. The cap keeps the upload well inside
// the function's 20 MB limit and bounds what a stuck tab can cost.
export const MAX_SECONDS = 300;

export function isVoiceSupported() {
  return typeof window !== 'undefined'
    && typeof window.MediaRecorder !== 'undefined'
    && Boolean(navigator.mediaDevices?.getUserMedia);
}

function pickFormat() {
  return FORMATS.find((f) => window.MediaRecorder.isTypeSupported?.(f.mimeType)) ?? FORMATS[0];
}

function messageFor(err) {
  if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') {
    return 'Microphone access was blocked. Allow it in your browser, then try again.';
  }
  if (err?.name === 'NotFoundError') return 'No microphone found.';
  return err?.message || 'Recording failed.';
}

/**
 * @param onTranscript called with the transcribed text once it comes back.
 * @returns state: 'idle' | 'requesting' | 'recording' | 'transcribing'
 */
export function useVoiceCapture(onTranscript) {
  const [state, setState] = useState('idle');
  const [error, setError] = useState('');
  const [seconds, setSeconds] = useState(0);

  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const analyserRef = useRef(null);
  const audioContextRef = useRef(null);
  const tickRef = useRef(null);
  const cancelledRef = useRef(false);
  const onTranscriptRef = useRef(onTranscript);

  useEffect(() => { onTranscriptRef.current = onTranscript; }, [onTranscript]);

  const teardown = useCallback(() => {
    clearInterval(tickRef.current);
    tickRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    analyserRef.current = null;
    audioContextRef.current?.close().catch(() => {});
    audioContextRef.current = null;
    recorderRef.current = null;
  }, []);

  // A recording left running after the view unmounts would hold the microphone
  // open with nothing listening for the result.
  useEffect(() => () => {
    cancelledRef.current = true;
    try { recorderRef.current?.stop(); } catch { /* already stopped */ }
    teardown();
  }, [teardown]);

  const transcribe = useCallback(async (blob, extension) => {
    setState('transcribing');
    try {
      const form = new FormData();
      form.append('file', blob, `capture.${extension}`);
      const { data, error: fnError } = await supabase.functions.invoke('transcribe', { body: form });
      if (fnError) {
        // The function's own message is more useful than "non-2xx status".
        const detail = await fnError.context?.json?.().catch(() => null);
        throw new Error(detail?.error || fnError.message);
      }
      const text = data?.text?.trim();
      if (!text) throw new Error('Nothing was said in that recording.');
      onTranscriptRef.current?.(text);
      setState('idle');
    } catch (err) {
      setError(err.message || 'Could not transcribe that recording.');
      setState('idle');
    }
  }, []);

  const start = useCallback(async () => {
    if (state !== 'idle') return;
    setError('');
    setSeconds(0);
    cancelledRef.current = false;
    setState('requesting');

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch (err) {
      setError(messageFor(err));
      setState('idle');
      return;
    }

    const format = pickFormat();
    let recorder;
    try {
      recorder = new window.MediaRecorder(stream, { mimeType: format.mimeType });
    } catch {
      // Some browsers reject the explicit mimeType but record fine on default.
      recorder = new window.MediaRecorder(stream);
    }

    streamRef.current = stream;
    recorderRef.current = recorder;
    chunksRef.current = [];

    // Drives the level meter. Kept off React state: it updates every frame.
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const context = new AudioCtx();
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.75;
      context.createMediaStreamSource(stream).connect(analyser);
      audioContextRef.current = context;
      analyserRef.current = analyser;
    } catch {
      // Metering is decoration; recording continues without it.
    }

    recorder.ondataavailable = (e) => {
      if (e.data?.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const chunks = chunksRef.current;
      chunksRef.current = [];
      teardown();
      if (cancelledRef.current) {
        setState('idle');
        return;
      }
      const blob = new Blob(chunks, { type: recorder.mimeType || format.mimeType });
      if (blob.size === 0) {
        setError('That recording came out empty.');
        setState('idle');
        return;
      }
      transcribe(blob, format.extension);
    };

    recorder.start();
    setState('recording');

    tickRef.current = setInterval(() => {
      setSeconds((s) => {
        const next = s + 1;
        if (next >= MAX_SECONDS) {
          try { recorder.stop(); } catch { /* already stopped */ }
        }
        return next;
      });
    }, 1000);
  }, [state, teardown, transcribe]);

  const stop = useCallback(() => {
    if (state !== 'recording') return;
    cancelledRef.current = false;
    try { recorderRef.current?.stop(); } catch { /* already stopped */ }
  }, [state]);

  const cancel = useCallback(() => {
    if (state !== 'recording') return;
    cancelledRef.current = true;
    try { recorderRef.current?.stop(); } catch { /* already stopped */ }
  }, [state]);

  return { state, error, seconds, start, stop, cancel, analyserRef, clearError: () => setError('') };
}
