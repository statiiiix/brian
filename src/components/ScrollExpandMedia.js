import { useEffect, useRef, useState } from 'react';
import { motion, useScroll, useTransform, useReducedMotion } from 'framer-motion';
import './ScrollExpandMedia.css';

/* Material Symbols: volume-up (play sound) and volume-off (mute). */
const VolumeUpIcon = (props) => (
  <svg viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true" {...props}>
    <path d="M200-360v-240h160l200-200v640L360-360H200Zm440 40v-322q45 21 72.5 65t27.5 97q0 53-27.5 96T640-320ZM480-606l-86 86H280v80h114l86 86v-252ZM380-480Z" />
  </svg>
);

const VolumeOffIcon = (props) => (
  <svg viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true" {...props}>
    <path d="M792-56 671-177q-25 16-53 27.5T560-131v-82q14-5 27.5-10t25.5-12L480-368v208L280-360H120v-240h128L56-792l56-56 736 736-56 56Zm-8-232-58-58q17-31 25.5-65t8.5-70q0-94-55-168T560-749v-82q124 28 202 125.5T840-481q0 53-14.5 102T784-288ZM650-422l-90-90v-130q47 22 73.5 66t26.5 96q0 15-2.5 29.5T650-422ZM480-592 376-696l104-104v208Zm-80 238v-94l-72-72H200v80h114l86 86Zm-36-130Z" />
  </svg>
);

/**
 * Scroll-driven media expansion hero.
 *
 * The stage sticks for one extra viewport of real page scroll while the media
 * grows from a card to full-bleed and the title halves slide apart. Because
 * the growth is bound to actual scroll position (sticky track + useScroll),
 * one continuous gesture expands the film and carries on into the page —
 * no wheel hijacking, no pinned scroll, no double-scroll wall.
 * Respects prefers-reduced-motion with a static, expanded fallback.
 */
export default function ScrollExpandMedia({
  mediaType = 'video',
  mediaSrc,
  posterSrc,
  title = '',
  date,
  scrollToExpand,
  children,
}) {
  const reduce = useReducedMotion();
  const videoRef = useRef(null);
  const trackRef = useRef(null);
  const [muted, setMuted] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [viewport, setViewport] = useState({
    w: typeof window !== 'undefined' ? window.innerWidth : 1440,
    h: typeof window !== 'undefined' ? window.innerHeight : 900,
  });

  useEffect(() => {
    const check = () => {
      setIsMobile(window.innerWidth < 768);
      setViewport({ w: window.innerWidth, h: window.innerHeight });
    };
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Real page scroll across the track drives everything.
  const { scrollYProgress } = useScroll({
    target: trackRef,
    offset: ['start start', 'end end'],
  });

  // Finish the expansion slightly before the stage un-sticks, so the film is
  // visually full just as the page starts to carry you into the content.
  const progress = useTransform(scrollYProgress, [0, 0.85], [0, 1]);

  const startWidth = 340;
  const startHeight = 420;
  const maxWidth = Math.min(startWidth + (isMobile ? 640 : 1140), viewport.w * 0.95);
  const maxHeight = Math.min(startHeight + (isMobile ? 220 : 400), viewport.h * 0.85);

  const mediaWidth = useTransform(progress, [0, 1], [startWidth, maxWidth]);
  const mediaHeight = useTransform(progress, [0, 1], [startHeight, maxHeight]);
  const wordShift = viewport.w * (isMobile ? 1.4 : 1.3);
  const wordLeft = useTransform(progress, [0, 1], [0, -wordShift]);
  const wordRight = useTransform(progress, [0, 1], [0, wordShift]);
  const bgFade = useTransform(progress, [0, 1], [1, 0.65]);
  const cueFade = useTransform(progress, [0.55, 0.85], [1, 0]);

  const toggleSound = () => {
    const v = videoRef.current;
    const next = !muted;
    setMuted(next);
    if (v) {
      v.muted = next;
      if (!next) {
        const p = v.play();
        if (p && p.catch) p.catch(() => {});
      }
    }
  };

  return (
    <div className="sem">
      <div
        className="sem-track"
        ref={trackRef}
        style={reduce ? { height: 'auto' } : undefined}
      >
        <section
          className="sem-stage"
          style={reduce ? { position: 'relative' } : undefined}
        >
          {/* Warm paper backdrop, fades slightly as media takes over */}
          <motion.div
            className="sem-bg"
            aria-hidden="true"
            style={reduce ? undefined : { opacity: bgFade }}
          />

          <div className="sem-viewport">
            <motion.div
              className="sem-media"
              style={
                reduce
                  ? { width: maxWidth, height: maxHeight }
                  : { width: mediaWidth, height: mediaHeight }
              }
            >
              {mediaType === 'video' ? (
                <video
                  ref={videoRef}
                  className="sem-media-el"
                  src={mediaSrc}
                  poster={posterSrc}
                  autoPlay
                  muted={muted}
                  loop
                  playsInline
                  preload="auto"
                  controls={false}
                  disablePictureInPicture
                />
              ) : (
                <img className="sem-media-el" src={mediaSrc} alt={title} />
              )}
              <div className="sem-media-ring" aria-hidden="true" />

              <div className="sem-media-meta">
                {date && <p className="sem-date">{date}</p>}
                {scrollToExpand && !reduce && (
                  <motion.p className="sem-scrollcue" style={{ opacity: cueFade }}>
                    <span className="sem-scrollcue-dot" aria-hidden="true" />
                    {scrollToExpand}
                  </motion.p>
                )}
              </div>
            </motion.div>

            {title && !reduce && (
              <div className="sem-title" aria-hidden="true">
                <motion.h2 className="sem-title-word" style={{ x: wordLeft }}>
                  {title.split(' ')[0]}
                </motion.h2>
                <motion.h2
                  className="sem-title-word sem-title-accent"
                  style={{ x: wordRight }}
                >
                  {title.split(' ').slice(1).join(' ')}
                </motion.h2>
              </div>
            )}

            {mediaType === 'video' && (
              <button
                type="button"
                className="sem-sound"
                onClick={toggleSound}
                aria-pressed={!muted}
                aria-label={muted ? 'Unmute video' : 'Mute video'}
              >
                {muted ? (
                  <VolumeOffIcon className="sem-sound-icon" />
                ) : (
                  <VolumeUpIcon className="sem-sound-icon" />
                )}
              </button>
            )}
          </div>
        </section>
      </div>

      <section className="sem-content">{children}</section>
    </div>
  );
}
