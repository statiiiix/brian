import type {CSSProperties, ReactNode} from 'react';
import {Easing, interpolate, useCurrentFrame} from 'remotion';

export const C = {
  ink: '#201b15',
  paper: '#f7f3ea',
  paperBright: '#fffdf8',
  paperMuted: '#eee8dc',
  accent: '#d1521a',
  accentBright: '#f16f2b',
  accentSoft: '#f8e3d8',
  green: '#1c9460',
  greenSoft: '#dff1e8',
  red: '#c84438',
  redSoft: '#f7dfdc',
  blue: '#4f6bdc',
  blueSoft: '#e3e8fb',
  muted: '#7d7468',
  border: 'rgba(32,27,21,.13)',
  dark: '#13110e',
  darkRaised: '#1d1a16',
  darkBorder: 'rgba(255,255,255,.11)',
};

export const FONT = 'Arial, Helvetica, sans-serif';
export const MONO = 'Menlo, Monaco, Consolas, monospace';
export const EASE = Easing.bezier(0.16, 1, 0.3, 1);

export const reveal = (frame: number, start: number, duration = 18) => ({
  opacity: interpolate(frame, [start, start + duration], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: EASE,
  }),
  translate: `0 ${interpolate(frame, [start, start + duration], [24, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: EASE,
  })}px`,
});

export const sceneOpacity = (frame: number, start: number, end: number, fade = 20) =>
  interpolate(frame, [start, start + fade, end - fade, end], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

export const paperShadow = '0 34px 90px rgba(0,0,0,.35), 0 2px 0 rgba(255,255,255,.6) inset';

export const Window = ({title, right, children, style}: {title: string; right?: ReactNode; children: ReactNode; style?: CSSProperties}) => (
  <div style={{background: C.paperBright, border: `1px solid ${C.border}`, borderRadius: 24, overflow: 'hidden', boxShadow: paperShadow, display: 'flex', flexDirection: 'column', ...style}}>
    <div style={{height: 64, flex: '0 0 64px', display: 'flex', alignItems: 'center', gap: 11, padding: '0 24px', borderBottom: `1px solid ${C.border}`, background: C.paperMuted}}>
      <span style={{width: 12, height: 12, borderRadius: 99, background: '#e76b58'}} />
      <span style={{width: 12, height: 12, borderRadius: 99, background: '#e4b64e'}} />
      <span style={{width: 12, height: 12, borderRadius: 99, background: '#5ba969'}} />
      <span style={{marginLeft: 8, fontFamily: MONO, fontSize: 17, color: C.muted}}>{title}</span>
      <span style={{marginLeft: 'auto'}}>{right}</span>
    </div>
    <div style={{flex: 1, minHeight: 0}}>{children}</div>
  </div>
);

export const BrianMark = ({size = 44, dark = false}: {size?: number; dark?: boolean}) => (
  <div style={{width: size, height: size, borderRadius: size * 0.3, display: 'grid', placeItems: 'center', color: dark ? C.ink : '#fff8f2', background: dark ? C.accentSoft : `linear-gradient(145deg, ${C.accentBright}, ${C.accent})`, boxShadow: dark ? 'none' : '0 12px 28px rgba(209,82,26,.3)', fontFamily: FONT, fontWeight: 800, fontSize: size * 0.48}}>B</div>
);

export const Pill = ({children, tone = 'neutral'}: {children: ReactNode; tone?: 'neutral' | 'green' | 'orange' | 'blue' | 'red'}) => {
  const styles = {
    neutral: {background: 'rgba(32,27,21,.07)', color: C.muted},
    green: {background: C.greenSoft, color: C.green},
    orange: {background: C.accentSoft, color: C.accent},
    blue: {background: C.blueSoft, color: C.blue},
    red: {background: C.redSoft, color: C.red},
  }[tone];
  return <span style={{...styles, display: 'inline-flex', alignItems: 'center', gap: 7, borderRadius: 999, padding: '7px 12px', fontFamily: MONO, fontSize: 15, fontWeight: 700, letterSpacing: '.01em'}}>{children}</span>;
};

export const Check = ({size = 18, color = 'currentColor'}: {size?: number; color?: string}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="m5 12.5 4.4 4.4L19.5 7" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const SourceIcon = ({type, size = 44}: {type: 'slack' | 'gmail' | 'ticket' | 'docs' | 'database'; size?: number}) => {
  const config = {
    slack: {bg: '#f5e7ee', fg: '#a82761', text: '#'},
    gmail: {bg: '#f9e7e4', fg: '#d64b3e', text: 'M'},
    ticket: {bg: '#e6effb', fg: '#3268b8', text: 'T'},
    docs: {bg: '#e6edfb', fg: '#3367d6', text: 'D'},
    database: {bg: '#e4f2ea', fg: '#267b51', text: 'DB'},
  }[type];
  return <span style={{width: size, height: size, flex: `0 0 ${size}px`, borderRadius: size * .28, background: config.bg, color: config.fg, display: 'grid', placeItems: 'center', fontFamily: FONT, fontWeight: 800, fontSize: type === 'database' ? size * .27 : size * .45}}>{config.text}</span>;
};

export const Cursor = ({x, y, click = 0}: {x: number; y: number; click?: number}) => (
  <div style={{position: 'absolute', left: x, top: y, width: 30, height: 38, zIndex: 50, scale: 1 - click * .16, filter: 'drop-shadow(0 4px 4px rgba(0,0,0,.25))'}}>
    {click > 0 && <span style={{position: 'absolute', left: -10, top: -10, width: 30, height: 30, borderRadius: 99, border: `3px solid ${C.accent}`, opacity: 1 - click, scale: .5 + click}} />}
    <svg viewBox="0 0 28 36" width="28" height="36"><path d="M3 2.5v26l6.5-6.5 4.3 10.2 4.5-2-4.3-9.8h9L3 2.5Z" fill="#fff" stroke={C.ink} strokeWidth="2" strokeLinejoin="round" /></svg>
  </div>
);

export const FilmBackground = ({children}: {children: ReactNode}) => {
  const frame = useCurrentFrame();
  return (
    <div style={{position: 'absolute', inset: 0, overflow: 'hidden', background: C.dark, fontFamily: FONT, color: C.ink}}>
      <div style={{position: 'absolute', width: 850, height: 850, borderRadius: 999, left: -250, top: -360, background: 'radial-gradient(circle, rgba(209,82,26,.28), rgba(209,82,26,0) 68%)', opacity: .8 + Math.sin(frame / 45) * .08}} />
      <div style={{position: 'absolute', width: 900, height: 900, borderRadius: 999, right: -330, bottom: -500, background: 'radial-gradient(circle, rgba(245,166,35,.16), rgba(245,166,35,0) 67%)'}} />
      <div style={{position: 'absolute', inset: 0, opacity: .16, backgroundImage: 'linear-gradient(rgba(255,255,255,.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.08) 1px, transparent 1px)', backgroundSize: '54px 54px'}} />
      {children}
    </div>
  );
};

export const TopBrand = ({label}: {label: string}) => (
  <div style={{position: 'absolute', left: 70, top: 42, right: 70, display: 'flex', alignItems: 'center', color: '#fff', zIndex: 10}}>
    <BrianMark size={42} />
    <span style={{marginLeft: 14, fontSize: 22, fontWeight: 750, letterSpacing: '-.03em'}}>Brian</span>
    <span style={{marginLeft: 'auto', fontFamily: MONO, fontSize: 15, color: 'rgba(255,255,255,.54)', letterSpacing: '.08em', textTransform: 'uppercase'}}>{label}</span>
  </div>
);
