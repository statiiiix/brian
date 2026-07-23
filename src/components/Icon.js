// A string `path` is a Google Material Symbols name (font loaded in index.html);
// JSX `path` renders the legacy inline-SVG set below (still used by the landing
// sections and for brand marks that Material Symbols doesn't cover).
export const Icon = ({ path, size = 22 }) =>
  typeof path === 'string' ? (
    <span
      className="material-symbols-rounded"
      aria-hidden="true"
      style={{
        fontSize: size,
        width: size,
        height: size,
        lineHeight: 1,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        userSelect: 'none',
        fontVariationSettings: "'FILL' 0, 'wght' 500, 'GRAD' 0, 'opsz' 24",
      }}
    >
      {path}
    </span>
  ) : (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {path}
    </svg>
  );

// Material Symbols names used by the dashboard + login (Google icons).
export const msym = {
  bolt: 'bolt',
  home: 'home',
  build: 'auto_awesome',
  skills: 'menu_book',
  review: 'verified_user',
  interviews: 'forum',
  capture: 'center_focus_strong',
  connectors: 'hub',
  executions: 'receipt_long',
  agents: 'smart_toy',
  settings: 'settings',
  logout: 'logout',
  back: 'arrow_back',
  sun: 'light_mode',
  moon: 'dark_mode',
  check: 'check',
  clear: 'task_alt',
  send: 'send',
  upload: 'upload_file',
};

export const icons = {
  shield: (
    <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z M9.5 12l2 2 3.5-4" />
  ),
  capture: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M5 8V6a1.5 1.5 0 0 1 1.5-1.5H8 M16 4.5h1.5A1.5 1.5 0 0 1 19 6v2 M19 16v2a1.5 1.5 0 0 1-1.5 1.5H16 M8 19.5H6.5A1.5 1.5 0 0 1 5 18v-2" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4.2-4.2" />
    </>
  ),
  rules: (
    <>
      <path d="M6 3.5h12a1 1 0 0 1 1 1V19a1.5 1.5 0 0 1-1.5 1.5H6.5A1.5 1.5 0 0 1 5 19V4.5a1 1 0 0 1 1-1z" />
      <path d="M9 8h6 M9 12h6 M9 16h3.5" />
    </>
  ),
  escalate: (
    <>
      <path d="M12 19V6.5" />
      <path d="M6.5 12L12 6.5 17.5 12" />
      <path d="M5 21h14" />
    </>
  ),
  log: (
    <>
      <path d="M8 3.5h8l3 3V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1.5-1.5z" />
      <path d="M9 11h6 M9 15h6 M9 7.5h3" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 12a8 8 0 1 1-2.3-5.6" />
      <path d="M20 3.5V8h-4.5" />
    </>
  ),
  review: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20c.6-3.2 2.9-5 5.5-5s4.9 1.8 5.5 5" />
      <path d="M15.5 9.5l1.8 1.8 3.2-3.8" />
    </>
  ),
  versions: (
    <>
      <circle cx="6" cy="6" r="2.2" />
      <circle cx="6" cy="18" r="2.2" />
      <circle cx="18" cy="12" r="2.2" />
      <path d="M6 8.2v7.6 M8 6.6c4 .8 7.5 2.4 8 3.4 M8 17.4c4-.8 7.5-2.4 8-3.4" />
    </>
  ),
  bolt: <path d="M13 2.5L5 13.5h6l-1 8 8-11h-6l1-8z" />,
  plus: <path d="M12 5v14 M5 12h14" />,
  arrowLeft: <path d="M19 12H5 M11 18l-6-6 6-6" />,
  check: <path d="M4.5 12.5l5 5L19.5 7" />,
  send: <path d="M20.5 3.5L10 14 M20.5 3.5L14 20.5l-4-6.5-6.5-4 17-6.5z" />,
  logout: (
    <>
      <path d="M14 4H6.5A1.5 1.5 0 0 0 5 5.5v13A1.5 1.5 0 0 0 6.5 20H14" />
      <path d="M10 12h10.5 M17 8.5l3.5 3.5-3.5 3.5" />
    </>
  ),
  inbox: (
    <>
      <path d="M4 13.5l2.2-8A1.5 1.5 0 0 1 7.65 4.5h8.7a1.5 1.5 0 0 1 1.45 1l2.2 8" />
      <path d="M4 13.5h4.5l1.5 2.5h4l1.5-2.5H20V18a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18v-4.5z" />
    </>
  ),
  spark: (
    <path d="M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8L12 17.5l-1.8-5.2L5 10.5l5.2-1.8L12 3.5z M18.5 15.5l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9.9-2.6" />
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  slack: (
    <>
      <rect x="9.2" y="2.8" width="3.2" height="7.4" rx="1.6" />
      <rect x="13.8" y="9.2" width="7.4" height="3.2" rx="1.6" />
      <rect x="11.6" y="13.8" width="3.2" height="7.4" rx="1.6" />
      <rect x="2.8" y="11.6" width="7.4" height="3.2" rx="1.6" />
    </>
  ),
  gmail: (
    <>
      <rect x="3.2" y="6" width="17.6" height="12.5" rx="1.6" />
      <path d="M4 7l8 6.2L20 7" />
    </>
  ),
  ticket: (
    <>
      <path d="M4 8.2A1.6 1.6 0 0 1 5.6 6.6h12.8A1.6 1.6 0 0 1 20 8.2v1.8a1.9 1.9 0 0 0 0 3.6v1.8a1.6 1.6 0 0 1-1.6 1.6H5.6A1.6 1.6 0 0 1 4 15.4v-1.8a1.9 1.9 0 0 0 0-3.6V8.2z" />
      <path d="M14 6.6v10.8" strokeDasharray="2.4 2.4" />
    </>
  ),
  docs: (
    <>
      <path d="M6.5 3.8h8l3.5 3.5v12A1.2 1.2 0 0 1 16.8 20.5H6.5a1.2 1.2 0 0 1-1.2-1.2V5A1.2 1.2 0 0 1 6.5 3.8z" />
      <path d="M14.5 3.8v3.5H18" />
      <path d="M8.2 11.5h7.2 M8.2 14.8h7.2 M8.2 18h4.2" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="6" rx="7" ry="2.6" />
      <path d="M5 6v12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6" />
      <path d="M5 12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6" />
    </>
  ),
  cursorMark: <path d="M5 3l5.6 15.4L13 12.2l6.4-2.6L5 3z" />,
};
