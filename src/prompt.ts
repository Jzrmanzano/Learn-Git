// Command-line helpers shared by the trainer and the landing page demo:
//  - clicking a commit or label in the graph types its name at the cursor
//  - Tab completes the word being typed (see complete.ts)
import { complete } from './complete';
import type { Repo } from './sim';

/** Puts text at the cursor, with a space either side where needed, and leaves the cursor after it. */
export function insertAtCursor(input: HTMLInputElement, text: string): void {
  const { value } = input;
  const start = input.selectionStart ?? value.length;
  const end = input.selectionEnd ?? value.length;
  const before = value.slice(0, start);
  const after = value.slice(end);
  const head = `${before}${before && !/\s$/.test(before) ? ' ' : ''}${text}${after.startsWith(' ') ? '' : ' '}`;
  input.value = head + after;
  input.focus({ preventScroll: true });
  input.setSelectionRange(head.length, head.length);
}

/** Makes the graph's commits and labels type their names into the input, by click or keyboard. */
export function enablePicking(svg: SVGSVGElement, input: HTMLInputElement): void {
  const pickOf = (ev: Event) => (ev.target as Element).closest<SVGElement>('[data-pick]');
  svg.addEventListener('click', (ev) => {
    const el = pickOf(ev);
    if (el?.dataset.pick) insertAtCursor(input, el.dataset.pick);
  });
  svg.addEventListener('keydown', (ev) => {
    const el = pickOf(ev);
    if (!el?.dataset.pick) return;
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      insertAtCursor(input, el.dataset.pick);
      return;
    }
    // Arrow keys move between commits and labels; only the one you are on stays in the Tab order.
    const step = ({ ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 } as Record<string, number>)[ev.key];
    if (!step) return;
    ev.preventDefault();
    const all = [...svg.querySelectorAll<SVGElement>('[data-pick]')];
    const next = all[(all.indexOf(el) + step + all.length) % all.length];
    for (const x of all) x.setAttribute('tabindex', x === next ? '0' : '-1');
    next.focus();
  });
}

/**
 * Tab completes the word at the cursor. With an empty command line Tab is left alone, so keyboard
 * users can always move on from the input. `showOptions` lists the matches when there are several.
 */
export function enableCompletion(input: HTMLInputElement, repo: Repo, showOptions: (options: string[]) => void): void {
  input.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Tab' || ev.shiftKey || ev.altKey || ev.ctrlKey || ev.metaKey || !input.value.trim()) return;
    ev.preventDefault();
    const result = complete(input.value, input.selectionStart ?? input.value.length, repo);
    if (!result) return;
    input.value = result.value;
    input.setSelectionRange(result.caret, result.caret);
    if (result.options.length) showOptions(result.options);
  });
}

/** Matches laid out as one line, cut short if there are many. */
export function formatOptions(options: string[], max = 24): string {
  const shown = options.slice(0, max).join('   ');
  return options.length > max ? `${shown}   … ${options.length - max} more` : shown;
}
