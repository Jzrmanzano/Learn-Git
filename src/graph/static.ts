// Fixed illustration graphs (cheat sheet), fitted to their box and redrawn on resize.
import { renderGraph, type GraphNode, type PillKind } from './render';

export interface StaticCommit {
  id: string;
  col: number;
  lane: number;
  parents?: string[];
  label?: string;
  faded?: boolean;
  /** Line colour index; defaults to the lane. */
  colour?: number;
}

export interface StaticBranch {
  name: string;
  at: string;
  /** Line colour index. */
  colour: number;
  /** HEAD is on this branch. */
  current?: boolean;
  /** Draw as a remote-tracking branch (dashed) or a tag instead of a local branch. */
  kind?: Extract<PillKind, 'remote' | 'tag'>;
}

export interface StaticGraph {
  commits: StaticCommit[];
  branches: StaticBranch[];
  /** Commit HEAD is on (drawn filled). */
  head: string;
  /** Stations pop in one by one on first draw. */
  animate?: boolean;
}

function draw(svg: SVGSVGElement, g: StaticGraph, first: boolean): void {
  const W = svg.clientWidth;
  const H = svg.clientHeight;
  if (!W || !H) return;

  const cols = Math.max(...g.commits.map((c) => c.col)) + 1;
  const lanes = Math.max(...g.commits.map((c) => c.lane)) + 1;
  const R = W < 480 ? 15 : 19;
  const pad = R + 30;
  const dx = Math.min(100, (W - 2 * pad) / Math.max(1, cols - 1));
  const laneH = lanes > 1 ? Math.min(100, (H - 110) / (lanes - 1)) : 0;
  const ox = (W - (cols - 1) * dx) / 2;
  const oy = (H - (lanes - 1) * laneH) / 2 + 16;
  const showLabels = dx >= 76;

  const nodes = new Map<string, GraphNode>();
  g.commits.forEach((c, i) =>
    nodes.set(c.id, {
      id: c.id,
      x: ox + c.col * dx,
      y: oy + c.lane * laneH,
      line: c.colour ?? c.lane,
      faded: !!c.faded,
      head: c.id === g.head,
      label: showLabels ? c.label : undefined,
      pop: first && g.animate,
      delay: i * 90,
    }),
  );
  const lineOf = (c: StaticCommit) => c.colour ?? c.lane;
  const byId = new Map(g.commits.map((c) => [c.id, c]));

  renderGraph(svg, {
    width: W,
    height: H,
    dx,
    radius: R,
    nodes: [...nodes.values()],
    edges: g.commits.flatMap((c) =>
      (c.parents ?? []).map((pid, k) => ({
        from: nodes.get(pid)!,
        to: nodes.get(c.id)!,
        line: k === 0 ? lineOf(c) : lineOf(byId.get(pid)!),
        mergeIn: k > 0,
      })),
    ),
    pills: [...new Set(g.branches.map((b) => b.at))].map((at) => ({
      at: nodes.get(at)!,
      items: g.branches
        .filter((b) => b.at === at)
        .map((b) => ({ key: `${b.kind ?? 'branch'}:${b.name}`, text: b.current ? `HEAD → ${b.name}` : b.name, kind: b.kind ?? 'branch', line: b.colour })),
    })),
  });
}

/** Draws g into the svg and keeps it fitted as the svg resizes. */
export function mountStaticGraph(svg: SVGSVGElement | null, g: StaticGraph): void {
  if (!svg) return;
  let first = true;
  const observer = new ResizeObserver(() => {
    draw(svg, g, first);
    first = false;
  });
  observer.observe(svg);
}
