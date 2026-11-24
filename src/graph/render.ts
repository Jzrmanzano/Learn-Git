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

export function renderGraph(svg: SVGSVGElement, m: GraphModel): void {
  const R = m.radius;
  const width = R < 17 ? 5 : 6;

  const edges = m.edges
    .map((e) => {
      const faded = e.to.faded ? ' opacity="0.3" stroke-dasharray="1 10"' : '';
      return `<path d="${edgePath(e, m.dx)}" fill="none" stroke-width="${width}" stroke-linecap="round" style="stroke:${stroke(e.line)}"${faded}/>`;
    })
    .join('');

  const nodes = m.nodes
    .map((n) => {
      const anim = n.pop ? ` class="pop"${n.delay ? ` style="animation-delay:${n.delay}ms"` : ''}` : '';
      const title = n.title ? `<title>${esc(n.title)}</title>` : '';
      const label = n.label ? `<text class="m" x="${n.x}" y="${n.y + R + 20}" text-anchor="middle" font-size="13">${esc(n.label)}</text>` : '';
      const fill = n.head ? stroke(n.line) : 'var(--sheet)';
      const ink = n.head ? onLine(n.line) : 'var(--ink)';
      return `<g opacity="${n.faded ? 0.3 : 1}"${anim}>${title}<circle cx="${n.x}" cy="${n.y}" r="${R}" stroke-width="5" style="fill:${fill};stroke:${stroke(n.line)}"/><text x="${n.x}" y="${n.y + 4.5}" text-anchor="middle" font-size="13" font-weight="800" style="fill:${ink}">${esc(n.id)}</text>${label}</g>`;
    })
    .join('');

  // Stack pills above their node; if one would overlap a pill already placed (e.g. on the
  // neighbouring commit), lift it another row. A thin leader runs from the highest pill down to
  // its station, so a lifted label still points at the right commit.
  const placed: { left: number; right: number; y: number }[] = [];
  const leaders: string[] = [];
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
        return pillShape(p, x, y, w);
      });
      leaders.push(`<path d="M${at.x} ${top}V${at.y - R}" stroke-width="2" opacity="${at.faded ? 0.2 : 0.5}" style="stroke:var(--ink)"/>`);
      return shapes;
    })
    .join('');

  svg.setAttribute('width', String(m.width));
  svg.setAttribute('height', String(m.height));
  svg.setAttribute('viewBox', `0 0 ${m.width} ${m.height}`);
  svg.innerHTML = edges + nodes + leaders.join('') + pills;
}
