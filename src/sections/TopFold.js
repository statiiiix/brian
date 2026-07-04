import ScrollExpandMedia from '../components/ScrollExpandMedia';
import ProductMock from '../components/ProductMock';
import { Reveal } from '../components/reveal';
import './TopFold.css';

const VIDEO_SRC = process.env.PUBLIC_URL + '/Brianmov.webm';

export default function TopFold() {
  return (
    <header className="hero" id="top">
      <ScrollExpandMedia
        mediaType="video"
        mediaSrc={VIDEO_SRC}
        title="Company Brain"
      >
        <div className="hero-reveal">
          <Reveal as="h1" className="hero-title" delay={0.05}>
            Give every AI agent your company's{' '}
            <em className="hero-title-accent">brain.</em>
          </Reveal>

          <Reveal as="p" className="hero-sub" delay={0.12}>
            Every procedure, limit, and escalation line — in one place, so any
            agent acts with your judgment, not its own guess. Support, finance,
            ops, on-call.
          </Reveal>

          <Reveal className="hero-ctas" delay={0.18}>
            <a href="#cta" className="btn btn--primary">
              Get a demo
            </a>
            <a href="#how-it-works" className="btn btn--ghost">
              See how it works
            </a>
          </Reveal>

          <Reveal className="hero-mock" delay={0.24}>
            <ProductMock />
          </Reveal>
        </div>
      </ScrollExpandMedia>
    </header>
  );
}
