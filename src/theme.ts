// Light / dark theme toggle. With no saved choice the site follows the system setting.
// An inline script in each page's <head> applies a saved choice before first paint.
const KEY = 'learngit.theme';
type Theme = 'light' | 'dark';

const system = matchMedia('(prefers-color-scheme: dark)');
const root = document.documentElement;

function saved(): Theme | null {
  try {
    const t = localStorage.getItem(KEY);
    return t === 'light' || t === 'dark' ? t : null;
  } catch {
    return null;
  }
}

const current = (): Theme => saved() ?? (system.matches ? 'dark' : 'light');

function sync(): void {
  const dark = current() === 'dark';
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-theme-toggle]')) {
    b.setAttribute('aria-pressed', String(dark));
  }
}

export function initTheme(): void {
  const t = saved();
  if (t) root.dataset.theme = t;
  sync();
  system.addEventListener('change', sync);
  document.addEventListener('click', (ev) => {
    if (!(ev.target as Element).closest('[data-theme-toggle]')) return;
    const next: Theme = current() === 'dark' ? 'light' : 'dark';
    const apply = () => {
      root.dataset.theme = next;
      try {
        localStorage.setItem(KEY, next);
      } catch {
        /* storage unavailable: the choice lasts for this page only */
      }
      sync();
    };
    // Crossfade between themes where the browser supports view transitions.
    if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(apply);
    else apply();
  });
}
