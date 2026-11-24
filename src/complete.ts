// Tab completion for the command line: trainer commands, git commands, flags, and the names the
// repository has right now (branches, tags, remote-tracking branches, commit IDs). No DOM code here.
import type { Repo } from './sim';

export interface Completion {
  /** The command line after completing. */
  value: string;
  /** Where the cursor goes. */
  caret: number;
  /** Matches to show when the line could not be completed any further (two or more). */
  options: string[];
}

const TRAINER = ['git', 'help', 'undo', 'clear', 'teammate'];

const FLAGS: Record<string, string[]> = {
  commit: ['-m', '--amend'],
  branch: ['-a', '-d', '-D', '-f', '-m', '-r', '-u', '-v'],
  switch: ['-c', '--detach', '-'],
  checkout: ['-b', '--detach', '-'],
  merge: ['--no-ff', '--ff-only'],
  rebase: [],
  reset: ['--hard', '--mixed', '--soft'],
  log: ['--all', '--oneline', '-n'],
  tag: ['-d', '-f', '-l'],
  fetch: ['--prune'],
  pull: ['--rebase', '--ff-only'],
  push: ['-u', '--delete', '--force', '--force-with-lease', '--tags'],
  remote: ['-v'],
};

function names(repo: Repo) {
  const { branches, tags, tracking, commits, remote } = repo.state;
  const remoteName = remote?.name;
  const remoteBranches = remote ? Object.keys(remote.branches).sort() : [];
  const local = Object.keys(branches).sort();
  return {
    local,
    tags: Object.keys(tags).sort(),
    tracking: Object.keys(tracking).sort(),
    commits: Object.values(commits)
      .sort((a, b) => a.seq - b.seq)
      .map((c) => c.id),
    remote: remoteName ? [remoteName] : [],
    remoteBranches,
    /** Branches you could switch to that only exist on the remote so far (git creates them for you). */
    remoteOnly: remoteName ? Object.keys(tracking).map((t) => t.slice(remoteName.length + 1)).filter((b) => !local.includes(b)) : [],
  };
}

/** What could go in the word being typed, given the words before it. */
function candidates(words: string[], token: string, repo: Repo): string[] {
  if (!words.length) return TRAINER;
  const n = names(repo);
  if (words[0] === 'teammate') return words.length === 1 ? n.remoteBranches : [];
  if (words[0] !== 'git') return [];
  if (words.length === 1) return repo.subcommands;

  const sub = words[1];
  const args = words.slice(2);
  const last = args.at(-1);
  const positional = args.filter((a) => !a.startsWith('-'));
  if (token.startsWith('-')) return FLAGS[sub] ?? [];
  const refs = [...n.local, ...n.tags, ...n.tracking, 'HEAD', ...n.commits];

  switch (sub) {
    case 'switch':
      if (last === '-c' || last === '-C') return []; // a new branch name: nothing to suggest
      return positional.length ? refs : [...n.local, ...n.remoteOnly];
    case 'checkout':
      if (last === '-b' || last === '-B') return [];
      return positional.length ? refs : [...n.local, ...n.remoteOnly, ...n.tags, ...n.tracking, ...n.commits];
    case 'branch':
      if (last === '-u') return n.tracking;
      if (args.some((a) => ['-d', '-D', '-m', '-M'].includes(a))) return positional.length ? [] : n.local;
      if (args.includes('-f')) return positional.length ? refs : n.local;
      return positional.length ? refs : []; // the first word is a new branch name
    case 'tag':
      if (args.includes('-d')) return n.tags;
      return positional.length ? refs : []; // the first word is a new tag name
    case 'push':
      if (!positional.length) return n.remote;
      return args.includes('--delete') ? n.remoteBranches : [...n.local, ...n.tags];
    case 'pull':
    case 'fetch':
      return positional.length ? n.remoteBranches : n.remote;
    case 'remote':
      return positional.length ? [] : ['add', 'remove'];
    case 'commit':
    case 'status':
    case 'reflog':
    case 'help':
      return [];
    default:
      // merge, rebase, reset, revert, cherry-pick, show, log, merge-base
      return refs;
  }
}

const lower = (s: string) => s.toLowerCase();

function commonPrefix(words: string[]): string {
  let p = words[0];
  for (const w of words) while (!lower(w).startsWith(lower(p))) p = p.slice(0, -1);
  return p;
}

/**
 * Completes the word at the cursor. Returns null inside a quoted message, where there is nothing
 * to complete. Matching ignores case, so c3 completes to C3.
 */
export function complete(line: string, caret: number, repo: Repo): Completion | null {
  const before = line.slice(0, caret);
  const after = line.slice(caret);
  if ((before.match(/"/g) ?? []).length % 2) return null;
  const start = before.search(/\S*$/);
  const token = before.slice(start);
  if (token.startsWith("'") || token.startsWith('"')) return null;

  const words = before.slice(0, start).trim().split(/\s+/).filter(Boolean);
  const matches = [...new Set(candidates(words, token, repo))].filter((c) => lower(c).startsWith(lower(token)));
  const unchanged = { value: line, caret, options: [] };
  if (!matches.length) return unchanged;

  const replace = (word: string, space: boolean) => {
    const head = before.slice(0, start) + word + (space && !after.startsWith(' ') ? ' ' : '');
    return { value: head + after, caret: head.length + (space && after.startsWith(' ') ? 1 : 0), options: [] };
  };
  if (matches.length === 1) return replace(matches[0], true);
  const prefix = commonPrefix(matches);
  if (prefix.length > token.length) return replace(prefix, false);
  return { ...unchanged, options: matches };
}
