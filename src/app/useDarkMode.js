import { useCallback, useEffect, useLayoutEffect, useState } from 'react';

// Ported from the "sokoon" project's ThemeContext: light default, remembers a
// manual choice in localStorage, otherwise follows the OS preference. The theme
// is applied as data-theme="dark" on <html> only while the dashboard is mounted,
// so marketing and auth pages stay light (sokoon gated dark mode the same way,
// by path — here the mount lifecycle does it).
const STORAGE_KEY = 'theme';

function getInitialTheme() {
  if (typeof window === 'undefined') return 'light';
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function useDarkMode() {
  const [theme, setTheme] = useState(getInitialTheme);

  // Apply before paint to avoid a flash of the wrong theme, and revert on
  // unmount so pages outside the dashboard render in light.
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') root.setAttribute('data-theme', 'dark');
    else root.removeAttribute('data-theme');
    return () => root.removeAttribute('data-theme');
  }, [theme]);

  // Track OS changes until the user makes an explicit choice.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event) => {
      if (!window.localStorage.getItem(STORAGE_KEY)) {
        setTheme(event.matches ? 'dark' : 'light');
      }
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'light' ? 'dark' : 'light';
      window.localStorage.setItem(STORAGE_KEY, next);
      return next;
    });
  }, []);

  return { theme, toggleTheme };
}
