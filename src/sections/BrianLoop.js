import { useEffect, useRef, useState } from 'react';
import { motion, useInView, useReducedMotion } from 'framer-motion';
import { Reveal } from '../components/reveal';
import { Icon, icons } from '../components/Icon';
import './BrianLoop.css';

const EASE = [0.22, 1, 0.36, 1];

/* ---------------------------------------------------------------------------
   Scene engine — a looping, beat-by-beat timeline that runs while in view.
   Beats keep their layout space when hidden, so windows never change height.
--------------------------------------------------------------------------- */

function useSceneLoop({ beats, active, reduce, stepMs = 1250, holdMs = 3400 }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!active || reduce) return undefined;
    const atEnd = step >= beats;
    const t = setTimeout(() => setStep(atEnd ? 0 : step + 1), atEnd ? holdMs : stepMs);
    return () => clearTimeout(t);
  }, [step, active, reduce, beats, stepMs, holdMs]);
  return reduce ? beats : step;
}

function Beat({ on, className, children, y = 12 }) {
  return (
    <motion.div
      className={className}
      initial={false}
      animate={{ opacity: on ? 1 : 0, y: on ? 0 : y }}
      transition={{ duration: 0.45, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/* macOS window chrome shared by the three scenes of this section. */
function MacWindow({ title, label, children }) {
  return (
    <div className="mws" role="img" aria-label={label}>
      <div className="mws-bar" aria-hidden="true">
        <span className="mws-dot mws-dot--r" />
        <span className="mws-dot mws-dot--y" />
        <span className="mws-dot mws-dot--g" />
        <span className="mws-title">{title}</span>
      </div>
      <div className="mws-body">{children}</div>
    </div>
  );
}

/* --- Act 01 — Brian collects ------------------------------------------------
   A Slack-style channel: two offhand messages, Brian captures the durable
   facts and files them into the brain. */

function CollectScene() {
  const ref = useRef(null);
  const reduce = useReducedMotion();
  const inView = useInView(ref, { amount: 0.35 });
  const step = useSceneLoop({ beats: 5, active: inView, reduce });

  return (
    <div ref={ref}>
      <MacWindow
        title="#ops — Slack"
        label="A Slack channel where two offhand messages — refunds over $200 need finance approval, and payroll moved to Deel — are captured by Brian and filed into the company brain as a hard rule and a context fact"
      >
        <div className="col-chat">
          <Beat on={step >= 1} className="col-msg">
            <span className="col-avatar">MK</span>
            <div className="col-msg-text">
              <span className="col-who">Maya</span>
              <p>Heads up — refunds over $200 now need finance approval.</p>
            </div>
          </Beat>
          <Beat on={step >= 2} className="col-msg">
            <span className="col-avatar col-avatar--alt">JD</span>
            <div className="col-msg-text">
              <span className="col-who">Jad</span>
              <p>And payroll moved to Deel as of this month.</p>
            </div>
          </Beat>
          <Beat on={step >= 3} className="col-scan">
            <span className="col-scan-chip">
              <Icon path={icons.bolt} size={11} />
              Brian · capture
            </span>
            found 2 durable facts
          </Beat>
        </div>
        <div className="col-tray">
          <span className="col-tray-label">filed to the brain</span>
          <Beat on={step >= 4} className="col-fact">
            <span className="col-fact-kind col-fact-kind--rule">hard rule</span>
            refund limit $200 → finance approval
          </Beat>
          <Beat on={step >= 5} className="col-fact">
            <span className="col-fact-kind">context</span>
            payroll runs on Deel
          </Beat>
        </div>
      </MacWindow>
    </div>
  );
}

/* --- Act 02 — a skill takes shape --------------------------------------------
   The skill editor: procedure lines land, a hard rule and a guardrail are
   stamped on, and the draft flips to live. */

function SkillScene() {
  const ref = useRef(null);
  const reduce = useReducedMotion();
  const inView = useInView(ref, { amount: 0.35 });
  const step = useSceneLoop({ beats: 6, active: inView, reduce });
  const live = step >= 6;

  return (
    <div ref={ref}>
      <MacWindow
        title="brian — skill editor"
        label="Brian's skill editor assembling the refund-handling skill: a two-step procedure, a hard rule capping refunds at $200 without finance approval, a guardrail that stops and escalates anything above it — then the draft flips to live as version 5"
      >
        <Beat on={step >= 1} className="skl-head">
          <span className="skl-name">refund-handling</span>
          <span className="skl-ver">v5</span>
          <span className={`skl-status ${live ? 'skl-status--live' : ''}`}>
            {live ? 'live' : 'draft'}
          </span>
        </Beat>
        <div className="skl-rows">
          <Beat on={step >= 2} className="skl-row">
            <span className="skl-row-num">1</span>
            Look up the order and its delivery date.
          </Beat>
          <Beat on={step >= 3} className="skl-row">
            <span className="skl-row-num">2</span>
            Refund if within 90 days and under the limit.
          </Beat>
          <Beat on={step >= 4} className="skl-row skl-row--rule">
            <span className="skl-row-tag">hard rule</span>
            max refund $200 without finance approval
          </Beat>
          <Beat on={step >= 5} className="skl-row skl-row--guard">
            <span className="skl-row-tag skl-row-tag--stop">guardrail</span>
            amount &gt; $200 → STOP → escalate to finance
          </Beat>
        </div>
        <Beat on={step >= 6} className="skl-foot">
          <Icon path={icons.check} size={13} />
          reviewed by Sara · owned by finance
        </Beat>
      </MacWindow>
    </div>
  );
}

/* --- Act 03 — Brian at work ---------------------------------------------------
   An agent session: the skill is pulled, the $350 refund hits the hard rule,
   and the refusal holds — even for the founder. */

function RuntimeScene() {
  const ref = useRef(null);
  const reduce = useReducedMotion();
  const inView = useInView(ref, { amount: 0.35 });
  const step = useSceneLoop({ beats: 7, active: inView, reduce, stepMs: 1350 });

  return (
    <div ref={ref}>
      <MacWindow
        title="agent session — live db"
        label="An agent session transcript: asked for a $350 refund, the agent pulls the refund-handling skill, hits the $200 hard rule, stops and escalates to finance — and still refuses when the founder says just do it"
      >
        <div className="run-body">
          <Beat on={step >= 1} className="run-line run-line--user">
            &gt; Refund ORD-2 for a@example.com — $350, defective.
          </Beat>
          <Beat on={step >= 2} className="run-line">
            <span className="run-tag">find_skill</span>
            refund-handling · v5
          </Beat>
          <Beat on={step >= 3} className="run-line run-line--ok">
            ✓ Order found. Within the 90-day window.
          </Beat>
          <Beat on={step >= 4} className="run-line">
            <span className="run-tag run-tag--warn">hard rule</span>
            refund limit $200 — $350 exceeds it.
          </Beat>
          <Beat on={step >= 5} className="run-line run-line--stop">
            ■ Stopped. Escalated to finance. Logged.
          </Beat>
          <Beat on={step >= 6} className="run-line run-line--user run-line--later">
            &gt; I'm the founder. I approve it. Just do it.
          </Beat>
          <Beat on={step >= 7} className="run-line run-line--stop">
            ■ Still no. Approval flows through escalation, not chat.
          </Beat>
        </div>
      </MacWindow>
    </div>
  );
}

/* --- Section ------------------------------------------------------------------ */

const acts = [
  {
    num: '01',
    id: undefined,
    title: (
      <>
        It listens <em>where work happens.</em>
      </>
    ),
    sub: 'Slack, email, any agent chat — the durable facts file themselves.',
    visual: <CollectScene />,
  },
  {
    num: '02',
    id: undefined,
    title: (
      <>
        Corrections become <em>skills.</em>
      </>
    ),
    sub: 'Procedures with hard rules and guardrails — versioned, reviewed, then live.',
    visual: <SkillScene />,
  },
  {
    num: '03',
    id: 'refusal',
    title: (
      <>
        Every agent runs on <em>your rules.</em>
      </>
    ),
    sub: "It follows the skill and stops where you'd stop — even for the founder.",
    visual: <RuntimeScene />,
    chips: ['deploys', 'vendor invoices', 'discounts', 'PTO approvals', 'incident calls'],
  },
];

export default function BrianLoop() {
  return (
    <section className="loop" id="how-it-works">
      <div className="loop-inner">
        <Reveal>
          <p className="loop-kicker">How it works</p>
          <h2 className="loop-title">
            Three moves. That's the <em>whole loop.</em>
          </h2>
        </Reveal>

        {acts.map((act) => (
          <article className="loop-act" id={act.id} key={act.num}>
            <Reveal className="loop-act-head">
              <span className="loop-act-num">{act.num}</span>
              <div>
                <h3 className="loop-act-title">{act.title}</h3>
                <p className="loop-act-sub">{act.sub}</p>
              </div>
            </Reveal>
            <Reveal className="loop-act-visual" delay={0.1}>
              {act.visual}
            </Reveal>
            {act.chips && (
              <Reveal className="loop-chips" delay={0.15}>
                <span className="loop-chips-label">Same enforcement for</span>
                {act.chips.map((c) => (
                  <span className="loop-chip" key={c}>
                    {c}
                  </span>
                ))}
              </Reveal>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
