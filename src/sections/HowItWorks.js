import { useRef, useState } from 'react';
import {
  motion,
  AnimatePresence,
  useScroll,
  useTransform,
  useMotionValueEvent,
  useReducedMotion,
} from 'framer-motion';
import { Icon, icons } from '../components/Icon';
import './HowItWorks.css';

const EASE = [0.22, 1, 0.36, 1];

const steps = [
  {
    icon: icons.capture,
    step: '01',
    title: 'Capture',
    body: 'Every correction, from any session, files itself. The brain stays current.',
  },
  {
    icon: icons.search,
    step: '02',
    title: 'Retrieve',
    body: 'The agent pulls the right skill by meaning — semantic search over your own Postgres.',
  },
  {
    icon: icons.rules,
    step: '03',
    title: 'Execute',
    body: 'It follows the procedure step by step. Hard rules are baked in — it cannot talk its way past them.',
  },
  {
    icon: icons.escalate,
    step: '04',
    title: 'Escalate',
    body: 'Hit a guardrail and it stops, hands off to a named human, and writes the run to the log.',
  },
];

/* Static fallback for reduced-motion. */
function StaticSteps() {
  return (
    <div className="hiw-static">
      {steps.map((s) => (
        <div className="hiw-static-step" key={s.step}>
          <span className="hiw-node-icon">
            <Icon path={s.icon} size={20} />
          </span>
          <span className="step-num">{s.step}</span>
          <h3>{s.title}</h3>
          <p>{s.body}</p>
        </div>
      ))}
    </div>
  );
}

export default function HowItWorks() {
  const ref = useRef(null);
  const reduce = useReducedMotion();
  const [active, setActive] = useState(0);

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start start', 'end end'],
  });
  const lineWidth = useTransform(scrollYProgress, [0.08, 0.92], ['0%', '100%']);

  useMotionValueEvent(scrollYProgress, 'change', (v) => {
    const i = Math.min(steps.length - 1, Math.max(0, Math.floor(v * steps.length)));
    setActive(i);
  });

  if (reduce) {
    return (
      <section className="section hiw-flat" id="how-it-works">
        <div className="section-inner">
          <p className="kicker">How it works</p>
          <h2 className="section-title">
            One loop, from tacit knowledge to{' '}
            <span className="gradient-text">safe execution.</span>
          </h2>
          <StaticSteps />
        </div>
      </section>
    );
  }

  return (
    <section className="hiw" id="how-it-works" ref={ref}>
      <div className="hiw-sticky">
        <div className="hiw-inner">
          <motion.p
            className="kicker"
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, ease: EASE }}
          >
            How it works
          </motion.p>
          <motion.h2
            className="section-title hiw-title"
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7, ease: EASE }}
          >
            One loop, from tacit knowledge to{' '}
            <span className="gradient-text">safe execution.</span>
          </motion.h2>

          {/* Pipeline */}
          <div className="hiw-pipeline" role="presentation">
            <div className="hiw-rail" aria-hidden="true">
              <motion.div className="hiw-rail-fill" style={{ width: lineWidth }} />
            </div>
            <div className="hiw-nodes">
              {steps.map((s, i) => {
                const state = i < active ? 'done' : i === active ? 'on' : 'off';
                return (
                  <div className={`hiw-node hiw-node--${state}`} key={s.step}>
                    <span className="hiw-node-icon">
                      <Icon path={s.icon} size={20} />
                    </span>
                    <span className="hiw-node-label">{s.title}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Stage — the active step's line crossfades in */}
          <div className="hiw-stage">
            <AnimatePresence mode="wait">
              <motion.div
                className="hiw-stage-card"
                key={active}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.4, ease: EASE }}
              >
                <span className="hiw-stage-num">{steps[active].step}</span>
                <h3 className="hiw-stage-title">{steps[active].title}</h3>
                <p className="hiw-stage-body">{steps[active].body}</p>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}
