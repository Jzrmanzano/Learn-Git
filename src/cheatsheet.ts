// Cheat sheet: before/after diagrams for merge vs rebase, reset vs revert and fetch vs pull.
import './styles.css';
import './cheatsheet.css';
import { mountStaticGraph, type StaticGraph } from './graph/static';
import { initTheme } from './theme';

initTheme();

const mount = (id: string, g: StaticGraph) => mountStaticGraph(document.querySelector<SVGSVGElement>(`#${id} svg`), g);

mount('g-merge', {
  head: 'C5',
  commits: [
    { id: 'C0', col: 0, lane: 0 },
    { id: 'C1', col: 1, lane: 0, parents: ['C0'] },
    { id: 'C2', col: 2, lane: 1, parents: ['C1'] },
    { id: 'C3', col: 3, lane: 1, parents: ['C2'] },
    { id: 'C4', col: 2, lane: 0, parents: ['C1'] },
    { id: 'C5', col: 4, lane: 0, parents: ['C4', 'C3'] },
  ],
  branches: [
    { name: 'main', at: 'C5', colour: 0, current: true },
    { name: 'feature', at: 'C3', colour: 1 },
  ],
});

mount('g-rebase', {
  head: "C3'",
  commits: [
    { id: 'C0', col: 0, lane: 0 },
    { id: 'C1', col: 1, lane: 0, parents: ['C0'] },
    { id: 'C2', col: 2, lane: 2, parents: ['C1'], faded: true, colour: 1 },
    { id: 'C3', col: 3, lane: 2, parents: ['C2'], faded: true, colour: 1 },
    { id: 'C4', col: 2, lane: 0, parents: ['C1'] },
    { id: "C2'", col: 3, lane: 1, parents: ['C4'] },
    { id: "C3'", col: 4, lane: 1, parents: ["C2'"] },
  ],
  branches: [
    { name: 'main', at: 'C4', colour: 0 },
    { name: 'feature', at: "C3'", colour: 1, current: true },
  ],
});

mount('g-reset', {
  head: 'C2',
  commits: [
    { id: 'C0', col: 0, lane: 0 },
    { id: 'C1', col: 1, lane: 0, parents: ['C0'] },
    { id: 'C2', col: 2, lane: 0, parents: ['C1'] },
    { id: 'C3', col: 3, lane: 0, parents: ['C2'], faded: true },
  ],
  branches: [{ name: 'main', at: 'C2', colour: 0, current: true }],
});

mount('g-revert', {
  head: 'C4',
  commits: [
    { id: 'C0', col: 0, lane: 0 },
    { id: 'C1', col: 1, lane: 0, parents: ['C0'] },
    { id: 'C2', col: 2, lane: 0, parents: ['C1'] },
    { id: 'C3', col: 3, lane: 0, parents: ['C2'] },
    { id: 'C4', col: 4, lane: 0, parents: ['C3'] },
  ],
  branches: [{ name: 'main', at: 'C4', colour: 0, current: true }],
});

// The teammate's commit sits on its own line (colour 4) in both, as it does in the trainer.
mount('g-fetch', {
  head: 'C1',
  commits: [
    { id: 'C0', col: 0, lane: 0 },
    { id: 'C1', col: 1, lane: 0, parents: ['C0'] },
    { id: 'C2', col: 2, lane: 1, parents: ['C1'], colour: 4 },
  ],
  branches: [
    { name: 'main', at: 'C1', colour: 0, current: true },
    { name: 'origin/main', at: 'C2', colour: 0, kind: 'remote' },
  ],
});

mount('g-pull', {
  head: 'C4',
  commits: [
    { id: 'C0', col: 0, lane: 0 },
    { id: 'C1', col: 1, lane: 0, parents: ['C0'] },
    { id: 'C2', col: 2, lane: 1, parents: ['C1'], colour: 4 },
    { id: 'C3', col: 2, lane: 0, parents: ['C1'] },
    { id: 'C4', col: 3, lane: 0, parents: ['C3', 'C2'] },
  ],
  branches: [
    { name: 'main', at: 'C4', colour: 0, current: true },
    { name: 'origin/main', at: 'C2', colour: 0, kind: 'remote' },
  ],
});
