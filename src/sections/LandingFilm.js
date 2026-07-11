import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { Reveal } from '../components/reveal';
import './LandingFilm.css';

export default function LandingFilm({
  id,
  number,
  kicker,
  title,
  lede,
  src,
  type = 'video/mp4',
  poster,
  label,
  beats,
  dark = false,
  orange = false,
  showControl = true,
}) {
  const videoRef = useRef(null);
  const reduceMotion = useReducedMotion();
  const [playing, setPlaying] = useState(!reduceMotion);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (reduceMotion) {
      video.pause();
      setPlaying(false);
    }
  }, [reduceMotion]);

  function togglePlayback() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      const playAttempt = video.play();
      if (playAttempt && typeof playAttempt.then === 'function') {
        playAttempt.then(() => setPlaying(true)).catch(() => setPlaying(false));
      }
    } else {
      video.pause();
      setPlaying(false);
    }
  }

  return (
    <section
      className={`landing-film${dark ? ' landing-film--dark' : ''}${orange ? ' landing-film--orange' : ''}`}
      id={id}
    >
      <div className="landing-film-inner">
        <Reveal className="landing-film-head">
          <div>
            {(number || kicker) && (
              <p className="landing-film-kicker">
                {number && <span>{number}</span>}
                {kicker}
              </p>
            )}
            <h2 className="landing-film-title">{title}</h2>
          </div>
          <p className="landing-film-lede">{lede}</p>
        </Reveal>

        <Reveal className="landing-film-stage" delay={0.1}>
          <video
            ref={videoRef}
            className="landing-film-video"
            autoPlay={!reduceMotion}
            muted
            loop
            playsInline
            preload="metadata"
            poster={poster}
            aria-label={label}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
          >
            <source src={src} type={type} />
          </video>
          {showControl && (
            <button
              type="button"
              className="landing-film-control"
              onClick={togglePlayback}
              aria-label={playing ? 'Pause product film' : 'Play product film'}
            >
              <span aria-hidden="true">{playing ? 'Ⅱ' : '▶'}</span>
              {playing ? 'Pause' : 'Play'}
            </button>
          )}
        </Reveal>

        <Reveal className="landing-film-beats" delay={0.16}>
          {beats.map((beat, index) => (
            <div className="landing-film-beat" key={beat.title}>
              <span className="landing-film-beat-num">0{index + 1}</span>
              <div>
                <h3>{beat.title}</h3>
                <p>{beat.body}</p>
              </div>
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  );
}
