// Landing page: the live demo repository in the hero, and progress marks on the route of levels.
import { drawRepo, type DrawOptions } from './graph/live';
import { LEVELS } from './levels';
import { hashFor, nextLevel, readProgress } from './progress';
import { enableCompletion, enablePicking, formatOptions } from './prompt';
import { Repo, type Line } from './sim';
import { initTheme } from './theme';

initTheme();

// ---- live demo -------------------------------------------------------------------

const DEMO_SETUP = [
  'git commit -m "Homepage"',
  'git switch -c feature',
  'git commit -m "Search box"',
  'git commit -m "Style results"',
  'git switch main',
  'git commit -m "Fix footer"',
  'git merge feature',
  'git remote add origin https://example.com/team/site.git',
  'git push -u origin main',
  'git switch -c dark-mode',
  'git commit -m "Dark mode"',
  'git commit -m "Dark nav"',
  'git switch main',
  'git commit -m "Release 1.0"',
  'git tag v1.0',
];

const graph = document.querySelector<HTMLDivElement>('#dg');
const svg = document.querySelector<SVGSVGElement>('#dsvg');
const form = document.querySelector<HTMLFormElement>('#df');
const input = document.querySelector<HTMLInputElement>('#dcmd');
const prompt = document.querySelector<HTMLElement>('#dpr');
const out = document.querySelector<HTMLElement>('#dout');
const tryRow = document.querySelector<HTMLElement>('#try');

if (graph && svg && form && input && prompt && out && tryRow) {
  const repo = new Repo();
  repo.load(DEMO_SETUP);
  const seen = new Set<string>();
  let drawnSize = '';

  // Click a commit or label to type its name; Tab completes, listing the matches when there are several.
  enablePicking(svg, input);
  enableCompletion(input, repo, (options) => {
    out.replaceChildren(document.createTextNode(formatOptions(options)));
    out.classList.remove('err');
  });

  // The page's one orchestrated moment: on first draw the demo's history builds up along its lines.
  // After that, commands animate what changed, and resizes just refit.
  const draw = (o: DrawOptions = {}) => {
    drawnSize = `${graph.offsetWidth}x${graph.offsetHeight}`;
    drawRepo(graph, svg, repo, seen, o);
    prompt.textContent = `(${repo.currentBranch ?? `HEAD ${repo.headId}`}) $`;
  };

  // Show the explanation (or error) for the last command; plain output only when there is nothing else.
  const show = (command: string, lines: Line[]) => {
    const said = lines.filter((l) => l.kind !== 'out');
    const plain = lines.filter((l) => l.kind === 'out');
    const text = said.length
      ? said.map((l) => l.text).join(' ')
      : plain
          .slice(0, 3)
          .map((l) => l.text)
          .join('\n') + (plain.length > 3 ? '\n…' : '');
    const cmd = document.createElement('span');
    cmd.className = 'dcmd';
    cmd.textContent = `$ ${command}`;
    out.replaceChildren(cmd, document.createTextNode(text || 'Done.'));
    out.classList.toggle('err', lines.some((l) => l.kind === 'err'));
  };

  const run = (command: string) => {
    if (command === 'clear') return out.replaceChildren();
    show(command, repo.exec(command));
    draw({ motion: true });
  };

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const value = input.value.trim();
    input.value = '';
    if (value) run(value);
  });
  tryRow.addEventListener('click', (ev) => {
    const b = (ev.target as HTMLElement).closest('button');
    if (b?.textContent) run(b.textContent);
  });

  let first = true;
  new ResizeObserver(() => {
    if (!first && `${graph.offsetWidth}x${graph.offsetHeight}` === drawnSize) return;
    // Decide now, not inside the frame callback: by then `first` is already false, which used to
    // skip the staggered opening and draw every line at once.
    const options: DrawOptions = first ? { stagger: 90 } : {};
    first = false;
    requestAnimationFrame(() => draw(options));
  }).observe(graph);
}

// ---- progress on the route ------------------------------------------------------

const { done } = readProgress();
if (done.size) {
  for (const a of document.querySelectorAll<HTMLAnchorElement>('.line a[href*="#level-"]')) {
    const i = Number(a.hash.slice('#level-'.length)) - 1;
    if (!done.has(i)) continue;
    a.parentElement?.classList.add('done');
    a.querySelector('b')?.insertAdjacentHTML('beforeend', '<span class="sr"> (done)</span>');
  }
  const next = nextLevel(done);
  const href = `learn.html${hashFor(next)}`;
  document.querySelector(`.line a[href="${href}"]`)?.parentElement?.classList.add('next');
  const label = LEVELS[next].check ? `Continue with level ${next + 1}` : 'Open the sandbox';
  for (const a of document.querySelectorAll<HTMLAnchorElement>('a[data-continue]')) {
    a.href = href;
    a.textContent = a.dataset.continue === 'nav' ? 'Continue' : label;
  }
}
