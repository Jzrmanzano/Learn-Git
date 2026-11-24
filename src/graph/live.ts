// Lays out a Repo's real state: one column per commit in creation order, one row per lane in use,
// fixed spacing (the wrapper scrolls sideways when history is long).
import { reachIn, type Repo } from '../sim';
import { PILL_ROW, renderGraph, type GraphEdge, type GraphNode, type Pill } from './render';

const DX = 84;
const LANE_H = 112;
const R = 20;
const PAD = 60;

const shorten = (s: string) => (s.length > 11 ? `${s.slice(0, 10)}…` : s);

export interface DrawOptions {
  /** Build new commits one after another, this many ms apart, instead of all at once (a level loading, the landing page opening). */
  stagger?: number;
  /** Animate the change since the last draw: labels slide, lines draw in, dropped commits fade. */
  motion?: boolean;
}

/** Draws the repo into svg, sized to fill wrap. `seen` holds IDs already drawn, so only new commits pop in. */
export function drawRepo(wrap: HTMLElement, svg: SVGSVGElement, repo: Repo, seen: Set<string>, o: DrawOptions = {}): void {
  const { commits, branches, lanes, tags, tracking } = repo.state;
  const all = Object.values(commits).sort((a, b) => a.seq - b.seq);
  const head = repo.headId;
  const current = repo.currentBranch;

  const live = reachIn(commits, [head, ...Object.values(branches), ...Object.values(tags), ...Object.values(tracking)]);

  // Labels grouped by commit, nearest first: current branch, other branches, remote-tracking branches, tags.
  // A detached HEAD gets its own label, closest of all.
  const byCommit = new Map<string, Pill[]>();
  const add = (id: string, pill: Pill) => byCommit.set(id, [...(byCommit.get(id) ?? []), pill]);
  if (!current) add(head, { key: 'h', text: 'HEAD', kind: 'head', line: 0 });
  const names = Object.keys(branches).sort((a, b) => Number(b === current) - Number(a === current) || a.localeCompare(b));
  for (const name of names) {
    const id = branches[name];
    add(id, { key: `b:${name}`, text: name === current ? `HEAD → ${name}` : name, kind: 'branch', line: lanes[name] ?? commits[id].lane });
  }
  for (const ref of Object.keys(tracking).sort()) {
    const id = tracking[ref];
    const local = ref.slice(ref.indexOf('/') + 1);
    add(id, { key: `r:${ref}`, text: ref, kind: 'remote', line: lanes[local] ?? lanes[ref] ?? commits[id].lane });
  }
  for (const name of Object.keys(tags).sort()) add(tags[name], { key: `t:${name}`, text: name, kind: 'tag', line: 0 });

  const usedLanes = [...new Set(all.map((c) => c.lane))].sort((a, b) => a - b);
  const row = new Map(usedLanes.map((lane, i) => [lane, i]));
  const stack = Math.max(1, ...[...byCommit.values()].map((p) => p.length));
  const top = R + 34 + stack * PILL_ROW;

  const contentW = (all.length - 1) * DX + 2 * PAD;
  const contentH = top + (usedLanes.length - 1) * LANE_H + 56;
  const width = Math.max(wrap.clientWidth, contentW);
  const height = Math.max(wrap.clientHeight, contentH);
  const ox = (width - contentW) / 2 + PAD;
  const oy = (height - contentH) / 2 + top;

  const nodes = new Map<string, GraphNode>();
  let fresh = 0;
  all.forEach((c, i) => {
    const pop = !seen.has(c.id);
    nodes.set(c.id, {
      id: c.id,
      x: ox + i * DX,
      y: oy + (row.get(c.lane) ?? 0) * LANE_H,
      line: c.lane,
      faded: !live.has(c.id),
      head: c.id === head,
      label: shorten(c.msg),
      title: `${c.id}: ${c.msg}`,
      pop,
      delay: pop && o.stagger ? 120 + fresh++ * o.stagger : 0,
    });
  });

  const edges: GraphEdge[] = all.flatMap((c) =>
    c.parents.map((pid, k) => ({
      from: nodes.get(pid)!,
      to: nodes.get(c.id)!,
      line: k === 0 ? c.lane : commits[pid].lane,
      mergeIn: k > 0,
    })),
  );

  renderGraph(svg, {
    width,
    height,
    dx: DX,
    radius: R,
    nodes: [...nodes.values()],
    edges,
    pills: [...byCommit].map(([id, items]) => ({ at: nodes.get(id)!, items })),
  }, { motion: o.motion });

  for (const c of all) seen.add(c.id);
  const left = nodes.get(head)!.x - wrap.clientWidth / 2;
  const smooth = o.motion && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  wrap.scrollTo({ left, behavior: smooth ? 'smooth' : 'instant' });
}
