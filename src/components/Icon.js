export const Icon = ({ path, size = 22 }) => (
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
};
