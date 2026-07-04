import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
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
 * Adapted for Create React App (plain JS + CSS, <video> instead of next/image)
 * and themed to the warm-editorial palette.
 *
 * While the media is not fully expanded, vertical scroll is captured and used
 * to grow the media from a card to full-bleed; the title's two halves slide
 * apart. Once fully expanded, normal page scroll resumes and `children` fade in.
 * Respects prefers-reduced-motion with a static, non-hijacking fallback.
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
  const [muted, setMuted] = useState(true);
  const [progress, setProgress] = useState(0);
  const [showContent, setShowContent] = useState(false);
  const [fullyExpanded, setFullyExpanded] = useState(false);
  const [touchStartY, setTouchStartY] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const [heroInView, setHeroInView] = useState(true);
  const [viewport, setViewport] = useState({
    w: typeof window !== 'undefined' ? window.innerWidth : 1440,
    h: typeof window !== 'undefined' ? window.innerHeight : 900,
  });
  const rafRef = useRef(null);
  const pendingProgressRef = useRef(null);

  useEffect(() => {
    const check = () => {
      setIsMobile(window.innerWidth < 768);
      setViewport({ w: window.innerWidth, h: window.innerHeight });
    };
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Keep the pinned sound control on screen only while the hero is in view.
  useEffect(() => {
    const onScroll = () => setHeroInView(window.scrollY < window.innerHeight * 0.6);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (reduce) {
      // No scroll-jacking: present everything expanded and readable.
      setProgress(1);
      setShowContent(true);
      setFullyExpanded(true);
      return;
    }

    const clamp = (v) => Math.min(Math.max(v, 0), 1);
    const applyProgress = (next) => {
      // Batch same-frame updates through rAF so bursts of high-frequency
      // trackpad wheel events collapse into one state update per frame
      // instead of one per raw event (this is what made the motion feel janky).
      pendingProgressRef.current = next;
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const value = pendingProgressRef.current;
        pendingProgressRef.current = null;
        setProgress(value);
        if (value >= 1) {
          setFullyExpanded(true);
          setShowContent(true);
        } else if (value < 0.75) {
          setShowContent(false);
        }
      });
    };

    // Base every delta on the not-yet-committed value (if a frame is still
    // pending) rather than the last-rendered `progress`, so a burst of wheel
    // events inside one animation frame accumulates instead of clobbering
    // itself down to just the final event's delta.
    const currentProgress = () => pendingProgressRef.current ?? progress;

    const onWheel = (e) => {
      if (fullyExpanded && e.deltaY < 0 && window.scrollY <= 5) {
        setFullyExpanded(false);
        e.preventDefault();
      } else if (!fullyExpanded) {
        e.preventDefault();
        applyProgress(clamp(currentProgress() + e.deltaY * 0.0009));
      }
    };

    const onTouchStart = (e) => setTouchStartY(e.touches[0].clientY);

    const onTouchMove = (e) => {
      if (!touchStartY) return;
      const touchY = e.touches[0].clientY;
      const deltaY = touchStartY - touchY;
      if (fullyExpanded && deltaY < -20 && window.scrollY <= 5) {
        setFullyExpanded(false);
        e.preventDefault();
      } else if (!fullyExpanded) {
        e.preventDefault();
        const factor = deltaY < 0 ? 0.008 : 0.005;
        applyProgress(clamp(currentProgress() + deltaY * factor));
        setTouchStartY(touchY);
      }
    };

    const onTouchEnd = () => setTouchStartY(0);

    const onScroll = () => {
      if (!fullyExpanded) window.scrollTo(0, 0);
    };

    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('scroll', onScroll);
    window.addEventListener('touchstart', onTouchStart, { passive: false });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd);
    return () => {
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [progress, fullyExpanded, touchStartY, reduce]);

  // The card animates from a fixed start size up to the CSS max-width/max-height
  // clamp (95vw / 85vh). Sizing the target off actual viewport dimensions
  // (instead of a fixed overshoot the CSS then clips) makes progress === 1 land
  // exactly on the visually-maxed-out frame — no dead zone where scrolling
  // keeps advancing progress after the video already looks fully expanded.
  const startWidth = 340;
  const startHeight = 420;
  const maxWidth = Math.min(startWidth + (isMobile ? 640 : 1140), viewport.w * 0.95);
  const maxHeight = Math.min(startHeight + (isMobile ? 220 : 400), viewport.h * 0.85);
  const mediaWidth = startWidth + progress * (maxWidth - startWidth);
  const mediaHeight = startHeight + progress * (maxHeight - startHeight);
  const textTranslateX = progress * (isMobile ? 140 : 130);

  const firstWord = title ? title.split(' ')[0] : '';
  const restOfTitle = title ? title.split(' ').slice(1).join(' ') : '';

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
      <section className="sem-stage">
        {/* Warm paper backdrop, fades slightly as media takes over */}
        <motion.div
          className="sem-bg"
          aria-hidden="true"
          animate={{ opacity: 1 - progress * 0.35 }}
          transition={{ duration: 0.1 }}
        />

        <div className="sem-viewport">
          <div
            className="sem-media"
            style={{
              width: `${mediaWidth}px`,
              height: `${mediaHeight}px`,
            }}
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
              {date && (
                <p
                  className="sem-date"
                  style={{ transform: `translateX(-${textTranslateX}vw)` }}
                >
                  {date}
                </p>
              )}
              {scrollToExpand && !fullyExpanded && (
                <p
                  className="sem-scrollcue"
                  style={{ transform: `translateX(${textTranslateX}vw)` }}
                >
                  <span className="sem-scrollcue-dot" aria-hidden="true" />
                  {scrollToExpand}
                </p>
              )}
            </div>
          </div>

          {title && (
            <div className="sem-title" aria-hidden={fullyExpanded}>
              <h2
                className="sem-title-word"
                style={{ transform: `translateX(-${textTranslateX}vw)` }}
              >
                {firstWord}
              </h2>
              <h2
                className="sem-title-word sem-title-accent"
                style={{ transform: `translateX(${textTranslateX}vw)` }}
              >
                {restOfTitle}
              </h2>
            </div>
          )}

          {mediaType === 'video' && (
            <button
              type="button"
              className={`sem-sound${heroInView ? '' : ' sem-sound--hidden'}`}
              onClick={toggleSound}
              aria-pressed={!muted}
              aria-hidden={!heroInView}
              tabIndex={heroInView ? 0 : -1}
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

      <motion.section
        className="sem-content"
        initial={false}
        animate={{ opacity: showContent ? 1 : 0, y: showContent ? 0 : 24 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        style={{ pointerEvents: showContent ? 'auto' : 'none' }}
      >
        {children}
      </motion.section>
    </div>
  );
}
