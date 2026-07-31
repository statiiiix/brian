import { useCallback, useEffect, useRef, useState } from 'react';

// Where a capture goes when the brain is unsure. Vector search always returns a
// nearest skill; the band where it is too far to merge and too close to be new
// is the one place a person has to decide, so it is the only thing this dialog
// asks about. Everything else in the capture is already on its way.

function similarity(distance) {
  return Math.max(0, Math.round((1 - distance) * 100));
}

export default function CaptureDecisionModal({ decisions, onResolve, onDismiss }) {
  const [step, setStep] = useState(0);
  const [choices, setChoices] = useState({});
  const dialogRef = useRef(null);
  const previouslyFocused = useRef(null);

  const current = decisions[step];
  const selected = choices[current?.index] ?? 'create';

  const choose = useCallback((value) => {
    setChoices((prev) => ({ ...prev, [current.index]: value }));
  }, [current]);

  function next() {
    if (step + 1 < decisions.length) {
      setStep(step + 1);
      return;
    }
    onResolve(
      decisions.reduce((acc, d) => {
        const value = choices[d.index] ?? 'create';
        acc[d.index] = value === 'create'
          ? { action: 'create' }
          // A person picking a target is routing the knowledge, not approving
          // the wording — the merge still goes through review.
          : { action: 'merge', targetId: value, review: true };
        return acc;
      }, {}),
    );
  }

  // Focus moves into the dialog and comes back where it started, and Tab stays
  // inside while it is open.
  useEffect(() => {
    previouslyFocused.current = document.activeElement;
    dialogRef.current?.querySelector('button, [href], input')?.focus();
    return () => previouslyFocused.current?.focus?.();
  }, []);

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        onDismiss();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), [href]',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onDismiss]);

  if (!current) return null;

  return (
    <div className="capture-modal-backdrop" onMouseDown={(e) => {
      if (e.target === e.currentTarget) onDismiss();
    }}>
      <div
        className="capture-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="capture-modal-title"
        ref={dialogRef}
      >
        <header className="capture-modal-head">
          <h2 className="capture-modal-title" id="capture-modal-title">
            No confident match for this skill
          </h2>
          {decisions.length > 1 && (
            <span className="capture-modal-step dash-mono">{step + 1} of {decisions.length}</span>
          )}
        </header>

        <p className="capture-modal-lead">
          Brian found skills that look related but not close enough to update on its own.
          Is this a revision of one of them, or something new?
        </p>

        <div className="capture-modal-subject">
          <span className="capture-kind capture-kind--skill">skill</span>
          <div>
            <p className="capture-modal-subject-name">{current.proposal.input.name}</p>
            <p className="capture-modal-subject-trigger">{current.proposal.input.trigger}</p>
          </div>
        </div>

        <fieldset className="capture-modal-options">
          <legend className="capture-modal-legend">Where should this go?</legend>

          {current.candidates.map((candidate) => (
            <label
              key={candidate.id}
              className={`capture-modal-option${selected === candidate.id ? ' is-selected' : ''}`}
            >
              <input
                type="radio"
                name={`capture-decision-${current.index}`}
                checked={selected === candidate.id}
                onChange={() => choose(candidate.id)}
              />
              <span className="capture-modal-option-body">
                <span className="capture-modal-option-name">
                  Update <strong>{candidate.name}</strong>
                  {candidate.status !== 'active' && (
                    <span className="capture-modal-status">{candidate.status}</span>
                  )}
                </span>
                <span className="capture-modal-option-trigger">{candidate.trigger}</span>
              </span>
              <span className="capture-modal-match" title="Similarity to the captured text">
                <span className="capture-conf-track" aria-hidden="true">
                  <span
                    className="capture-conf-fill"
                    style={{ width: `${similarity(candidate.distance)}%` }}
                  />
                </span>
                <span className="dash-mono">{similarity(candidate.distance)}%</span>
              </span>
            </label>
          ))}

          <label className={`capture-modal-option${selected === 'create' ? ' is-selected' : ''}`}>
            <input
              type="radio"
              name={`capture-decision-${current.index}`}
              checked={selected === 'create'}
              onChange={() => choose('create')}
            />
            <span className="capture-modal-option-body">
              <span className="capture-modal-option-name">Create it as a new skill</span>
              <span className="capture-modal-option-trigger">
                None of these describe the same process.
              </span>
            </span>
          </label>
        </fieldset>

        <footer className="capture-modal-foot">
          <span className="capture-hint">
            {selected === 'create'
              ? 'Filed on its own — a draft unless it is confident and reversible.'
              : 'Filed as a proposed update, waiting in review.'}
          </span>
          <div className="capture-modal-actions">
            {step > 0 && (
              <button type="button" className="dash-btn" onClick={() => setStep(step - 1)}>
                Back
              </button>
            )}
            <button type="button" className="dash-btn" onClick={onDismiss}>
              Decide later
            </button>
            <button type="button" className="dash-btn dash-btn--primary" onClick={next}>
              {step + 1 < decisions.length ? 'Next' : 'File it'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
