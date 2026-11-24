// Shared SVG drawing for commit graphs: transit-style lines, commit stations, branch and tag labels.
// Layout (where each node sits) is decided by live.ts or static.ts; this file only draws.
// Colours are CSS variables (--l0 … --l5 and their --lN-on text colours) so both themes restyle the graph.

export const LINE_COUNT = 6;

const wrapLine = (i: number) => ((i % LINE_COUNT) + LINE_COUNT) % LINE_COUNT;
const stroke = (i: number) => `var(--l${wrapLine(i)})`;
const onLine = (i: number) => `var(--l${wrapLine(i)}-on)`;

export const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

export interface GraphNode {
  id: string;
  x: number;
  y: number;
  /** Line colour index. */
  line: number;
  faded: boolean;
  /** HEAD is here: drawn filled. */
  head: boolean;
  /** Short label under the node. */
  label?: string;
  /** Tooltip text. */
  title?: string;
  /** Pop-in animation, with an optional delay in ms. */
  pop?: boolean;
  delay?: number;
}

export interface GraphEdge {
  from: GraphNode;
  to: GraphNode;
  line: number;
  /** True for a merge's second parent: the bend sits next to the child instead of the parent. */
  mergeIn: boolean;
}

/** branch: a filled label in the line colour. remote: a dashed outline (origin/main). tag: a luggage-tag shape. head: a detached HEAD. */
export type PillKind = 'branch' | 'remote' | 'tag' | 'head';

export interface Pill {
  /** Stable identity across redraws (e.g. "b:main"), so a label can slide when its branch moves. */
  key: string;
  text: string;
  kind: PillKind;
  line: number;
}

export interface GraphModel {
  width: number;
  height: number;
  /** Horizontal distance between columns; used for the length of each bend. */
  dx: number;
  radius: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Pills stacked above a node, first one closest to it. */
  pills: { at: GraphNode; items: Pill[] }[];
}

export const PILL_ROW = 28;

function edgePath(e: GraphEdge, dx: number): string {
  const a = e.from;
  const b = e.to;
  if (a.y === b.y) return `M${a.x} ${a.y}L${b.x} ${b.y}`;
  if (!e.mergeIn) return `M${a.x} ${a.y}C${a.x + dx * 0.5} ${a.y} ${a.x + dx * 0.5} ${b.y} ${a.x + dx} ${b.y}L${b.x} ${b.y}`;
  return `M${a.x} ${a.y}L${b.x - dx} ${a.y}C${b.x - dx * 0.5} ${a.y} ${b.x - dx * 0.5} ${b.y} ${b.x} ${b.y}`;
}

const pillWidth = (p: Pill) => p.text.length * 7.4 + (p.kind === 'tag' ? 30 : 22);

function pillShape(p: Pill, x: number, y: number, w: number): string {
  const l = x - w / 2;
  const r = x + w / 2;
  const text = (fill: string, dx = 0) =>
    `<text x="${x + dx}" y="${y + 4.5}" text-anchor="middle" font-size="13" font-weight="700" style="fill:${fill}">${esc(p.text)}</text>`;
  switch (p.kind) {
    case 'remote':
      return `<rect x="${l + 1}" y="${y - 11}" width="${w - 2}" height="22" rx="11" stroke-width="2" stroke-dasharray="5 3" style="fill:var(--sheet);stroke:${stroke(p.line)}"/>${text('var(--ink)')}`;
    case 'tag':
      return `<path d="M${l} ${y}L${l + 10} ${y - 12}H${r - 4}Q${r} ${y - 12} ${r} ${y - 8}V${y + 8}Q${r} ${y + 12} ${r - 4} ${y + 12}H${l + 10}Z" style="fill:var(--ink)"/><circle cx="${l + 10}" cy="${y}" r="2.5" style="fill:var(--sheet)"/>${text('var(--sheet)', 5)}`;
    case 'head':
      return `<rect x="${l}" y="${y - 12}" width="${w}" height="24" rx="12" style="fill:var(--ink)"/>${text('var(--sheet)')}`;
    default:
      return `<rect x="${l}" y="${y - 12}" width="${w}" height="24" rx="12" style="fill:${stroke(p.line)}"/>${text(onLine(p.line))}`;
  }
}

// ---- motion ------------------------------------------------------------------------
// Each svg remembers where things were at its last draw. With `motion`, the next draw animates
// from there: labels slide to their new commit, the whole map glides when it recentres, commits
// that drop off every branch fade, and HEAD pulses where it lands. New lines draw in (CSS .draw)
// and their station pops in just after (CSS .pop).

interface Point {
  x: number;
  y: number;
}

interface Snapshot {
  anchor: (Point & { id: string }) | null;
  nodes: Map<string, Point & { faded: boolean; head: boolean }>;
  pills: Map<string, Point>;
  leaders: Map<string, number>;
}

const memory = new WeakMap<SVGSVGElement, Snapshot>();
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const SLIDE = { duration: 480, easing: 'cubic-bezier(.3,.7,.2,1)' };
/** How long after a new line starts drawing its station pops in. */
const STATION_AFTER_LINE = 170;

function slide(el: Element, dx: number, dy: number): void {
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
  el.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'translate(0px,0px)' }], SLIDE);
}

function fadeBetween(el: Element, from: number, to: number): void {
  el.animate([{ opacity: from }, { opacity: to }], { duration: 650, easing: 'ease-out' });
}

export interface RenderOptions {
  /** Animate the change since this svg's previous draw. Leave off for resizes and fresh starts. */
  motion?: boolean;
}

export function renderGraph(svg: SVGSVGElement, m: GraphModel, o: RenderOptions = {}): void {
  const R = m.radius;
  const width = R < 17 ? 5 : 6;
  const prev = memory.get(svg);
  const motion = !!o.motion && !!prev && !reducedMotion.matches;
  const hasParent = new Set(m.edges.map((e) => e.to.id));
  const popAt = (n: GraphNode) => (n.delay ?? 0) + (hasParent.has(n.id) ? STATION_AFTER_LINE : 0);
  const delayStyle = (ms: number) => (ms ? `animation-delay:${Math.round(ms)}ms` : '');

  const edges = m.edges
    .map((e) => {
      const faded = e.to.faded ? ' opacity="0.3" stroke-dasharray="1 10"' : '';
      const draw = e.to.pop && !e.to.faded;
      const extra = draw ? ` class="draw" pathLength="1"` : '';
      const delay = draw && e.to.delay ? `;${delayStyle(e.to.delay)}` : '';
      return `<path data-e="${esc(e.to.id)}" d="${edgePath(e, m.dx)}" fill="none" stroke-width="${width}" stroke-linecap="round" style="stroke:${stroke(e.line)}${delay}"${faded}${extra}/>`;
    })
    .join('');

  const nodes = m.nodes
    .map((n) => {
      const anim = n.pop ? ` class="pop" style="${delayStyle(popAt(n))}"` : '';
      const title = n.title ? `<title>${esc(n.title)}</title>` : '';
      const label = n.label ? `<text class="m" x="${n.x}" y="${n.y + R + 20}" text-anchor="middle" font-size="13">${esc(n.label)}</text>` : '';
      const fill = n.head ? stroke(n.line) : 'var(--sheet)';
      const ink = n.head ? onLine(n.line) : 'var(--ink)';
      return `<g data-n="${esc(n.id)}" opacity="${n.faded ? 0.3 : 1}"${anim}>${title}<circle cx="${n.x}" cy="${n.y}" r="${R}" stroke-width="5" style="fill:${fill};stroke:${stroke(n.line)}"/><text x="${n.x}" y="${n.y + 4.5}" text-anchor="middle" font-size="13" font-weight="800" style="fill:${ink}">${esc(n.id)}</text>${label}</g>`;
    })
    .join('');

  // Stack pills above their node; if one would overlap a pill already placed (e.g. on the
  // neighbouring commit), lift it another row. A thin leader runs from the highest pill down to
  // its station, so a lifted label still points at the right commit.
  const placed: { left: number; right: number; y: number }[] = [];
  const leaders: string[] = [];
  const pillAt = new Map<string, Point>();
  const leaderTop = new Map<string, number>();
  const pills = m.pills
    .flatMap(({ at, items }) => {
      let row = 0;
      let top = at.y;
      const shapes = items.map((p) => {
        const w = pillWidth(p);
        const x = Math.min(Math.max(at.x, w / 2 + 4), m.width - w / 2 - 4);
        const left = x - w / 2;
        const right = x + w / 2;
        let y = at.y - R - 20 - row * PILL_ROW;
        while (placed.some((q) => q.y === y && left < q.right + 6 && right > q.left - 6)) y -= PILL_ROW;
        row = (at.y - R - 20 - y) / PILL_ROW + 1;
        top = Math.min(top, y);
        placed.push({ left, right, y });
        pillAt.set(p.key, { x, y });
        // When animating a change, only labels that did not exist before pop in (existing ones slide);
        // on a fresh draw, labels appear with their station.
        const appears = motion ? !prev?.pills.has(p.key) : at.pop;
        const anim = appears ? ` class="pop" style="${delayStyle(at.pop ? popAt(at) + 140 : 0)}"` : '';
        return `<g data-p="${esc(p.key)}"${anim}>${pillShape(p, x, y, w)}</g>`;
      });
      leaderTop.set(at.id, top);
      const fade = at.pop ? ` class="fade" style="${delayStyle(popAt(at) + 140)}"` : '';
      leaders.push(`<path data-l="${esc(at.id)}" d="M${at.x} ${top}V${at.y - R}" stroke-width="2" opacity="${at.faded ? 0.2 : 0.5}" style="stroke:var(--ink)"${fade}/>`);
      return shapes;
    })
    .join('');

  svg.setAttribute('width', String(m.width));
  svg.setAttribute('height', String(m.height));
  svg.setAttribute('viewBox', `0 0 ${m.width} ${m.height}`);
  svg.innerHTML = `<g class="world">${edges}${nodes}${leaders.join('')}${pills}</g>`;

  const byId = new Map(m.nodes.map((n) => [n.id, n]));
  const anchorNode = (prev?.anchor && byId.get(prev.anchor.id)) || m.nodes[0];
  memory.set(svg, {
    anchor: anchorNode ? { id: anchorNode.id, x: anchorNode.x, y: anchorNode.y } : null,
    nodes: new Map(m.nodes.map((n) => [n.id, { x: n.x, y: n.y, faded: n.faded, head: n.head }])),
    pills: pillAt,
    leaders: leaderTop,
  });
  if (!motion || !prev) return;

  // The whole map glides by however far the anchor commit moved (e.g. recentring after a commit)...
  const was = prev.anchor;
  const now = was ? byId.get(was.id) : undefined;
  const sx = was && now ? was.x - now.x : 0;
  const sy = was && now ? was.y - now.y : 0;
  const world = svg.querySelector('.world');
  if (world) slide(world, sx, sy);

  // ...and anything that moved relative to the map slides on top of that.
  for (const el of svg.querySelectorAll<SVGGElement>('[data-n]')) {
    const n = byId.get(el.dataset.n ?? '');
    const before = n && prev.nodes.get(n.id);
    if (!n || !before) continue;
    slide(el, before.x - n.x - sx, before.y - n.y - sy);
    if (before.faded !== n.faded) fadeBetween(el, before.faded ? 0.3 : 1, n.faded ? 0.3 : 1);
    const circle = el.querySelector('circle');
    if (n.head && !before.head && circle) {
      circle.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.22)' }, { transform: 'scale(1)' }], { duration: 420, easing: 'ease-out' });
    }
  }
  for (const el of svg.querySelectorAll<SVGPathElement>('[data-e]')) {
    const n = byId.get(el.dataset.e ?? '');
    const before = n && prev.nodes.get(n.id);
    if (n && before && before.faded !== n.faded) fadeBetween(el, before.faded ? 0.3 : 1, n.faded ? 0.3 : 1);
  }
  for (const el of svg.querySelectorAll<SVGGElement>('[data-p]')) {
    const key = el.dataset.p ?? '';
    const before = prev.pills.get(key);
    const after = pillAt.get(key);
    if (before && after) slide(el, before.x - after.x - sx, before.y - after.y - sy);
  }
  // Leaders whose labels moved reappear once the labels have arrived.
  for (const el of svg.querySelectorAll<SVGPathElement>('[data-l]')) {
    const id = el.dataset.l ?? '';
    if (!prev.nodes.has(id) || prev.leaders.get(id) === leaderTop.get(id)) continue;
    el.animate([{ opacity: 0 }, { opacity: 0 }, { opacity: Number(el.getAttribute('opacity')) }], { duration: SLIDE.duration + 160, easing: 'ease-out' });
  }
}
