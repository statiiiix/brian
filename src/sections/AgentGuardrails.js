import { useRef, useState } from 'react';
import { motion, useMotionValueEvent, useReducedMotion, useScroll } from 'framer-motion';
import './AgentGuardrails.css';

const outcomes = [
  'hallucinate',
  'ignore your rules',
  'guess at context',
  'repeat old mistakes',
  'act without approval',
  'forget what it learned',
];

export default function AgentGuardrails() {
  const sectionRef = useRef(null);
  const reduceMotion = useReducedMotion();
  const [activeIndex, setActiveIndex] = useState(0);
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start start', 'end end'],
  });

  useMotionValueEvent(scrollYProgress, 'change', (progress) => {
    if (reduceMotion) return;

    const nextIndex = Math.min(
      outcomes.length - 1,
      Math.floor(progress * outcomes.length)
    );

    setActiveIndex((currentIndex) =>
      currentIndex === nextIndex ? currentIndex : nextIndex
    );
  });

  const activeOutcome = outcomes[reduceMotion ? 0 : activeIndex];

  return (
    <section className="guardrails" id="agent-guardrails" ref={sectionRef}>
      <div className="guardrails-sticky">
        <div className="guardrails-glow" aria-hidden="true" />

        <div className="guardrails-copy">
          <p className="guardrails-kicker">Why Brian</p>
          <h2
            className="guardrails-title"
            aria-label={`With Brian, your AI agent will no longer ${activeOutcome}`}
          >
            <span>With Brian, your AI agent</span>
            <span>will no longer</span>
            <span className="guardrails-word-wrap" aria-hidden="true">
              <motion.span
                className="guardrails-word"
                key={activeOutcome}
                initial={reduceMotion ? false : { opacity: 0, y: 42, filter: 'blur(10px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                exit={{ opacity: 0, y: -42, filter: 'blur(10px)' }}
                transition={{ duration: 0.48, ease: [0.22, 1, 0.36, 1] }}
              >
                {activeOutcome}.
              </motion.span>
            </span>
          </h2>

        </div>

        <div className="guardrails-progress" aria-hidden="true">
          <span className="guardrails-count">
            {String((reduceMotion ? 0 : activeIndex) + 1).padStart(2, '0')}
            <i>/</i>
            {String(outcomes.length).padStart(2, '0')}
          </span>
          <div className="guardrails-dots">
            {outcomes.map((outcome, index) => (
              <span
                className={`guardrails-dot ${index === activeIndex ? 'guardrails-dot--active' : ''}`}
                key={outcome}
              />
            ))}
          </div>
        </div>

        <ul className="guardrails-sr-list">
          {outcomes.map((outcome) => (
            <li key={outcome}>{outcome}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
