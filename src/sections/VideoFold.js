import ScrollExpandMedia from '../components/ScrollExpandMedia';
import { Reveal } from '../components/reveal';
import './VideoFold.css';

const VIDEO_SRC = process.env.PUBLIC_URL + '/Brianmov.webm';

/**
 * Hero — the scroll-expansion film: scrolling grows the video from a card to
 * full-bleed, then the (deliberately short) pitch fades in beneath it.
 */
export default function VideoFold() {
  return (
    <header className="vfold" id="top">
      <ScrollExpandMedia
        mediaType="video"
        mediaSrc={VIDEO_SRC}
        title="Company Brain"
      >
        <div className="vfold-inner">
          <Reveal as="p" className="vfold-kicker" delay={0.05}>
            Introducing Brian
          </Reveal>
          <Reveal as="h1" className="vfold-title" delay={0.1}>
            Give every AI agent your company's <em>judgment.</em>
          </Reveal>
          <Reveal as="p" className="vfold-sub" delay={0.18}>
            Brian is a company brain that turns hard-won decisions into reviewed
            procedures, guardrails, and escalation paths — so AI agents know when
            to act and when to stop.
          </Reveal>
          <Reveal className="vfold-ctas" delay={0.26}>
            <a href="#cta" className="vfold-btn vfold-btn--primary">
              Build a governed workflow
            </a>
            <a href="#agent-guardrails" className="vfold-btn vfold-btn--ghost">
              See why Brian
            </a>
          </Reveal>
        </div>
      </ScrollExpandMedia>
    </header>
  );
}
