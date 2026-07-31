import { useEffect, useRef } from 'react';
import { Icon, msym } from '../../components/Icon';
import { isVoiceSupported, MAX_SECONDS, useVoiceCapture } from '../useVoiceCapture';

const BARS = 18;

function clock(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Live input level, drawn straight to the DOM. Sixty state updates a second
// would re-render the capture form for something purely decorative.
function LevelMeter({ analyserRef, active }) {
  const barsRef = useRef([]);

  useEffect(() => {
    if (!active) return undefined;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    let frame;

    const draw = () => {
      const analyser = analyserRef.current;
      if (analyser) {
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        const step = Math.floor(data.length / BARS) || 1;
        barsRef.current.forEach((bar, i) => {
          if (!bar) return;
          const level = data[i * step] / 255;
          bar.style.transform = `scaleY(${Math.max(0.12, level)})`;
        });
      }
      frame = requestAnimationFrame(draw);
    };

    // With reduced motion the meter holds a steady resting state: the timer and
    // the label already carry the "recording" message.
    if (reduced) {
      barsRef.current.forEach((bar) => { if (bar) bar.style.transform = 'scaleY(0.3)'; });
    } else {
      frame = requestAnimationFrame(draw);
    }
    return () => cancelAnimationFrame(frame);
  }, [active, analyserRef]);

  return (
    <span className="voice-meter" aria-hidden="true">
      {Array.from({ length: BARS }, (_, i) => (
        <span
          key={i}
          className="voice-meter-bar"
          ref={(el) => { barsRef.current[i] = el; }}
        />
      ))}
    </span>
  );
}

/**
 * Talk instead of type. Sits beside the capture box and appends what it hears.
 */
export default function VoiceRecorder({ onTranscript, disabled }) {
  const { state, error, seconds, start, stop, cancel, analyserRef, clearError } =
    useVoiceCapture(onTranscript);

  if (!isVoiceSupported()) return null;

  const busy = state === 'requesting' || state === 'transcribing';
  const nearLimit = MAX_SECONDS - seconds <= 30;

  return (
    <div className={`voice voice--${state}`}>
      {state === 'recording' ? (
        <>
          <button
            type="button"
            className="voice-btn voice-btn--stop"
            onClick={stop}
            aria-label="Stop recording and transcribe"
          >
            <Icon path={msym.stop} size={20} />
            <span>Stop</span>
          </button>
          <LevelMeter analyserRef={analyserRef} active />
          <span className={`voice-time dash-mono${nearLimit ? ' is-warning' : ''}`}>
            {clock(seconds)}
          </span>
          <button type="button" className="voice-cancel" onClick={cancel}>
            Cancel
          </button>
        </>
      ) : (
        <button
          type="button"
          className="voice-btn"
          onClick={start}
          disabled={disabled || busy}
          aria-label={busy ? undefined : 'Record a voice note'}
        >
          {state === 'transcribing' ? (
            <>
              <span className="voice-spinner" aria-hidden="true" />
              <span>Transcribing…</span>
            </>
          ) : state === 'requesting' ? (
            <>
              <span className="voice-spinner" aria-hidden="true" />
              <span>Waiting for mic…</span>
            </>
          ) : (
            <>
              <Icon path={msym.mic} size={20} />
              <span>Speak instead</span>
            </>
          )}
        </button>
      )}

      {/* Status changes are announced without stealing focus. */}
      <span className="sr-only" role="status" aria-live="polite">
        {state === 'recording' ? `Recording, ${clock(seconds)}` : ''}
        {state === 'transcribing' ? 'Transcribing your recording' : ''}
      </span>

      {error && (
        <span className="voice-error" role="alert">
          {error}
          <button type="button" className="voice-error-dismiss" onClick={clearError}>
            Dismiss
          </button>
        </span>
      )}
    </div>
  );
}
