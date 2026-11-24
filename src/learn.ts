// Trainer page: route of levels, lesson, terminal and live commit graph.
import './styles.css';
import './trainer.css';
import { drawRepo, type DrawOptions } from './graph/live';
import { esc } from './graph/render';
import { GOAL_COUNT, GROUPS, LEVELS, SANDBOX_INDEX } from './levels';
import { hashFor, nextLevel, readProgress, saveProgress } from './progress';
import { Repo, type Line } from './sim';
import { initTheme } from './theme';

initTheme();

function el<T extends HTMLElement | SVGElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing element: ${selector}`);
  return found;
}

const out = el<HTMLDivElement>('#out');
const graphWrap = el<HTMLDivElement>('#gw');
const svg = el<SVGSVGElement>('#g');
const input = el<HTMLInputElement>('#cmd');
const lesson = el<HTMLElement>('#lesson');
const levelNav = el<HTMLOListElement>('#lv');
const origin = el<HTMLElement>('#origin');

const repo = new Repo();
let level = 0;
let solved = false;
let showHint = false;
/** One-shot flags so a re-render plays its animation only at the moment it happens. */
let celebrate = false;
let revealHint = false;
let done = new Set<number>();
let seen = new Set<string>();
const commandHistory: string[] = [];
let historyPos = 0;

// ---- hash routing: #level-1 … #level-16, #sandbox --------------------------------

function levelFromHash(): number | null {
  if (location.hash === '#sandbox') return SANDBOX_INDEX;
  const m = /^#level-(\d+)$/.exec(location.hash);
  const n = m ? Number(m[1]) : NaN;
  return n >= 1 && n <= GOAL_COUNT ? n - 1 : null;
}

// ---- terminal ----------------------------------------------------------------------

function print(lines: Line[]): void {
  for (const { text, kind } of lines) {
    const div = document.createElement('div');
    div.className = kind;
    div.textContent = text;
    out.appendChild(div);
  }
  out.scrollTop = out.scrollHeight;
}

// ---- rendering ---------------------------------------------------------------------

const groupClass = (i: number) => (LEVELS[i].group < 0 ? 'gs' : `g${LEVELS[i].group}`);

/** The route strip is built once; later updates only change classes, so keyboard focus survives. */
function buildLevels(): void {
  levelNav.innerHTML = LEVELS.map((l, i) => {
    const edge = [l.group !== LEVELS[i - 1]?.group ? 'first' : '', l.group !== LEVELS[i + 1]?.group ? 'last' : ''].join(' ');
    return `<li class="stop ${groupClass(i)} ${edge}${l.check ? '' : ' sb'}"><button data-i="${i}">${l.check ? i + 1 : 'Sandbox'}</button></li>`;
  }).join('');
  el('#pt').textContent = String(GOAL_COUNT);
}

function updateLevels(): void {
  for (const b of levelNav.querySelectorAll<HTMLButtonElement>('button[data-i]')) {
    const i = Number(b.dataset.i);
    const l = LEVELS[i];
    const label = l.check ? `Level ${i + 1}: ${l.title}${done.has(i) ? ', done' : ''}` : 'Sandbox';
    b.parentElement?.classList.toggle('done', done.has(i));
    b.setAttribute('aria-label', label);
    b.title = label;
    if (i === level) b.setAttribute('aria-current', 'step');
    else b.removeAttribute('aria-current');
  }
  el('#pc').textContent = String(done.size);
}

function renderLesson(): void {
  const l = LEVELS[level];
  const sandbox = !l.check;
  lesson.className = `lesson ${groupClass(level)}`;
  const where = sandbox ? 'Free play' : `${GROUPS[l.group]}, level ${level + 1} of ${GOAL_COUNT}`;
  const buttons = [
    sandbox ? '' : `<button id="hb" aria-expanded="${showHint}">${showHint ? 'Hide hint' : 'Show hint'}</button>`,
    '<button id="ub">Undo</button>',
    '<button id="rb">Restart</button>',
    sandbox ? '' : `<button id="nb" class="primary"${solved ? '' : ' disabled'}>Next level</button>`,
  ].join('');
  lesson.innerHTML = `<div class="lhead"><span class="bullet" aria-hidden="true">${sandbox ? 'S' : level + 1}</span><div><p class="where">${where}</p><h1>${esc(l.title)}</h1></div></div>
<p class="story">${esc(l.story)}</p>
<div class="goal${solved ? ' met' : ''}${celebrate ? ' celebrate' : ''}"><h2>${sandbox ? 'Free play' : 'Goal'}</h2><p>${esc(l.goal)}</p>${sandbox ? '' : `<p class="st">${solved ? 'Done. Nice work.' : 'Not done yet'}</p>`}</div>
<div class="row">${buttons}</div>
${showHint && l.hint ? `<p class="hint${revealHint ? ' reveal' : ''}"><span class="sr">Hint: </span>${esc(l.hint)}</p>` : ''}`;
  celebrate = false;
  revealHint = false;
}

function renderOrigin(): void {
  const v = repo.remoteView();
  origin.hidden = !v;
  if (!v) return;
  const branches = v.branches.length ? v.branches.map(([b, id]) => `<code>${esc(b)}</code> at ${esc(id)}`).join(', ') : 'no branches yet';
  const unseen = v.unseen ? ` <strong>${v.unseen} new commit${v.unseen === 1 ? '' : 's'} you have not fetched.</strong>` : '';
  origin.innerHTML = `<b>On ${esc(v.name)} right now:</b> ${branches}.${unseen}`;
}

function describeGraph(): void {
  const where = repo.currentBranch ? `on ${repo.currentBranch} at ${repo.headId}` : `detached at ${repo.headId}`;
  const branches = Object.entries(repo.state.branches)
    .map(([name, id]) => `${name} at ${id}`)
    .join(', ');
  svg.setAttribute('aria-label', `Commit graph. HEAD is ${where}. Branches: ${branches}.`);
}

function refresh(draw: DrawOptions = {}): void {
  updateLevels();
  renderLesson();
  renderOrigin();
  el('#pr').textContent = `(${repo.currentBranch ?? `HEAD ${repo.headId}`}) $`;
  drawRepo(graphWrap, svg, repo, seen, draw);
  describeGraph();
}

function load(i: number): void {
  level = Math.max(0, Math.min(LEVELS.length - 1, Math.trunc(i)));
  repo.load(LEVELS[level].setup);
  solved = false;
  showHint = false;
  seen = new Set();
  out.innerHTML = '';
  print([{ text: 'Type help to list commands. Up arrow recalls earlier ones.', kind: 'note' }]);
  saveProgress(done, level);
  // The level's starting history builds up commit by commit.
  refresh({ stagger: 55 });
  window.history.replaceState(null, '', hashFor(level));
  levelNav.querySelector(`[data-i="${level}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function checkGoal(): void {
  const l = LEVELS[level];
  if (!l.check || solved || !l.check(repo)) return;
  solved = true;
  celebrate = true;
  done.add(level);
  saveProgress(done, level);
  const stop = levelNav.querySelector(`[data-i="${level}"]`)?.parentElement;
  stop?.classList.add('just-done');
  stop?.addEventListener('animationend', () => stop.classList.remove('just-done'), { once: true });
  const last = level === GOAL_COUNT - 1;
  print([
    {
      text: last ? 'Goal complete. That was the last level. The sandbox is open for free play.' : 'Goal complete. Press Next level when you are ready.',
      kind: 'ok',
    },
  ]);
}

function run(command: string): void {
  print([{ text: command, kind: 'cmd' }]);
  if (command === 'clear') {
    out.innerHTML = '';
    return;
  }
  print(repo.exec(command));
  checkGoal();
  refresh({ motion: true });
}

// ---- events ------------------------------------------------------------------------

el<HTMLFormElement>('#f').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const value = input.value.trim();
  input.value = '';
  if (!value) return;
  commandHistory.push(value);
  historyPos = commandHistory.length;
  run(value);
});

input.addEventListener('keydown', (ev) => {
  if (ev.key === 'ArrowUp' && historyPos > 0) {
    historyPos--;
    input.value = commandHistory[historyPos];
    ev.preventDefault();
  } else if (ev.key === 'ArrowDown') {
    historyPos = Math.min(commandHistory.length, historyPos + 1);
    input.value = commandHistory[historyPos] ?? '';
    ev.preventDefault();
  }
});

el('.term').addEventListener('click', () => {
  if (!String(getSelection() ?? '')) input.focus({ preventScroll: true });
});

lesson.addEventListener('click', (ev) => {
  const id = (ev.target as HTMLElement).closest('button')?.id;
  if (id === 'hb') {
    showHint = !showHint;
    revealHint = showHint;
    renderLesson();
    document.getElementById('hb')?.focus();
  } else if (id === 'ub') {
    run('undo');
    document.getElementById('ub')?.focus();
  } else if (id === 'rb') {
    load(level);
    document.getElementById('rb')?.focus();
  } else if (id === 'nb') {
    load(level + 1);
    input.focus({ preventScroll: true });
  }
});

levelNav.addEventListener('click', (ev) => {
  const button = (ev.target as HTMLElement).closest<HTMLButtonElement>('button[data-i]');
  if (button) load(Number(button.dataset.i));
});

window.addEventListener('hashchange', () => {
  const i = levelFromHash();
  if (i !== null && i !== level) load(i);
});

// Redraw to fit when the graph area really changes size: not on the observer's first call (which
// would cut short the opening animation), and not when a scrollbar comes or goes (outer size).
const sizeOf = () => `${graphWrap.offsetWidth}x${graphWrap.offsetHeight}`;
let drawnSize = sizeOf();
new ResizeObserver(() => {
  if (sizeOf() === drawnSize) return;
  drawnSize = sizeOf();
  requestAnimationFrame(() => drawRepo(graphWrap, svg, repo, seen));
}).observe(graphWrap);

// ---- start: link > saved level > first unfinished level ----------------------------

const saved = readProgress();
done = saved.done;
buildLevels();
load(levelFromHash() ?? saved.level ?? nextLevel(done));
