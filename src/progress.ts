// Per-browser progress, shared by the trainer and the landing page. Failures are ignored.
import { LEVELS, SANDBOX_INDEX } from './levels';

const KEY = 'learngit.v1';
/** Saves from before the sixteen-level route have no version; in them the sandbox was index 10. */
const OLD_SANDBOX = 10;

export interface Progress {
  done: Set<number>;
  level: number | null;
}

export function readProgress(): Progress {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as { v?: number; done?: unknown; level?: unknown };
    const done = new Set(
      (Array.isArray(raw.done) ? (raw.done as unknown[]) : []).filter(
        (i): i is number => Number.isInteger(i) && (i as number) >= 0 && (i as number) < LEVELS.length && !!LEVELS[i as number].check,
      ),
    );
    let level = typeof raw.level === 'number' && Number.isInteger(raw.level) ? raw.level : null;
    if (raw.v === undefined && level === OLD_SANDBOX) level = SANDBOX_INDEX;
    if (level !== null && (level < 0 || level >= LEVELS.length)) level = null;
    return { done, level };
  } catch {
    return { done: new Set(), level: null };
  }
}

export function saveProgress(done: Set<number>, level: number): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: 2, done: [...done], level }));
  } catch {
    /* storage unavailable: progress just won't persist */
  }
}

/** First level with a goal that is not done yet, or the sandbox when everything is. */
export function nextLevel(done: Set<number>): number {
  const i = LEVELS.findIndex((l, n) => l.check && !done.has(n));
  return i < 0 ? SANDBOX_INDEX : i;
}

export const hashFor = (i: number): string => (LEVELS[i].check ? `#level-${i + 1}` : '#sandbox');
