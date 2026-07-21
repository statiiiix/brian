import { useEffect, useRef, useState } from 'react';
import './RichText.css';

// Renders the light markdown Brian writes — headers, bold, italic, inline code,
// lists, links, and blank-line spacing — as React elements.
//
// Interview text is model output grounded in Notion pages and uploaded files,
// so it is never trusted as HTML: this builds elements directly rather than
// setting innerHTML, and link hrefs are restricted to http(s). A message that
// contains markup or a javascript: URL renders as text instead of executing.

const INLINE = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(\*\*|__)(?=\S)([\s\S]*?\S)\3|(\*|_)(?=\S)([^*_\n]*?\S)\5|`([^`\n]+)`/g;

function inline(text, keyPrefix) {
  const nodes = [];
  let last = 0;
  let match;
  INLINE.lastIndex = 0;
  while ((match = INLINE.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const key = `${keyPrefix}-${match.index}`;
    if (match[1]) {
      nodes.push(
        <a key={key} href={match[2]} target="_blank" rel="noreferrer noopener">{match[1]}</a>,
      );
    } else if (match[3]) {
      nodes.push(<strong key={key}>{match[4]}</strong>);
    } else if (match[5]) {
      nodes.push(<em key={key}>{match[6]}</em>);
    } else {
      nodes.push(<code key={key}>{match[7]}</code>);
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

// A single newline inside a paragraph stays a line break: people write answers
// that way and expect to see them back.
function paragraph(lines, key) {
  const nodes = [];
  lines.forEach((line, i) => {
    if (i > 0) nodes.push(<br key={`br-${i}`} />);
    nodes.push(...inline(line, `${key}-${i}`));
  });
  return <p key={key}>{nodes}</p>;
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

export function renderMarkdown(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let paragraphLines = [];
  let list = null;

  const flushParagraph = () => {
    if (paragraphLines.length > 0) {
      blocks.push(paragraph(paragraphLines, `p-${blocks.length}`));
      paragraphLines = [];
    }
  };
  const flushList = () => {
    if (!list) return;
    const Tag = list.ordered ? 'ol' : 'ul';
    blocks.push(
      <Tag key={`l-${blocks.length}`}>
        {list.items.map((item, i) => <li key={i}>{inline(item, `li-${blocks.length}-${i}`)}</li>)}
      </Tag>,
    );
    list = null;
  };

  for (const line of lines) {
    const heading = HEADING.exec(line);
    const bullet = BULLET.exec(line);
    const numbered = !bullet && NUMBERED.exec(line);

    if (heading) {
      flushParagraph();
      flushList();
      // Chat bubbles sit under the page h1, and headings here organize a
      // message rather than the document, so they start small.
      const Tag = `h${Math.min(heading[1].length + 2, 6)}`;
      blocks.push(<Tag key={`h-${blocks.length}`}>{inline(heading[2], `h-${blocks.length}`)}</Tag>);
    } else if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      const item = (bullet || numbered)[1];
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push(item);
    } else if (line.trim() === '') {
      flushParagraph();
      flushList();
    } else {
      flushList();
      paragraphLines.push(line);
    }
  }
  flushParagraph();
  flushList();
  return blocks;
}

const CHARS_PER_SECOND = 700;

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Reveals text the way it was written rather than dropping a finished wall of
// prose into the thread. The server answers in one shot, so this is a paced
// reveal of text we already hold, not a token stream.
export function useRevealedText(text, active, onTick) {
  const [revealed, setRevealed] = useState(active ? '' : text);
  const tickRef = useRef(onTick);
  tickRef.current = onTick;

  useEffect(() => {
    if (!active || prefersReducedMotion() || typeof requestAnimationFrame !== 'function') {
      setRevealed(text);
      return undefined;
    }
    let frame = 0;
    let start = null;
    const step = (now) => {
      if (start === null) start = now;
      const count = Math.ceil(((now - start) / 1000) * CHARS_PER_SECOND);
      setRevealed(text.slice(0, count));
      if (tickRef.current) tickRef.current();
      if (count < text.length) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [text, active]);

  return revealed;
}

export default function RichText({ text, className = '', reveal = false, onReveal }) {
  const shown = useRevealedText(String(text ?? ''), reveal, onReveal);
  return <div className={`rtx ${className}`.trim()}>{renderMarkdown(shown)}</div>;
}
