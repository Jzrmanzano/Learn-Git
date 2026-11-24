// Git simulator: commits, branches, tags, HEAD, the reflog and one simulated remote. No DOM code here.

export type CommitId = string;

export interface Commit {
  id: CommitId;
  parents: CommitId[];
  msg: string;
  /** Row the commit is drawn on; one lane per branch, assigned on first use. */
  lane: number;
  /** Creation order, used for the graph's columns and for log ordering. */
  seq: number;
  /** Original commit this one was copied from (rebase, cherry-pick). */
  copyOf?: CommitId;
  /** Commit this one reverts. */
  revertOf?: CommitId;
}

export type Head = { kind: 'branch'; name: string } | { kind: 'detached'; id: CommitId };

export interface Remote {
  name: string;
  url: string;
  branches: Record<string, CommitId>;
  tags: Record<string, CommitId>;
  /** Every commit the remote holds, including ones this repository has not fetched yet. */
  commits: Record<CommitId, Commit>;
}

export interface ReflogEntry {
  id: CommitId;
  msg: string;
}

export interface RepoState {
  commits: Record<CommitId, Commit>;
  branches: Record<string, CommitId>;
  tags: Record<string, CommitId>;
  head: Head;
  /** Where HEAD was before the last switch or checkout (branch name or commit ID), for `git switch -`. */
  prev: string | null;
  lanes: Record<string, number>;
  nextLane: number;
  seq: number;
  n: number;
  remote: Remote | null;
  /** Remote-tracking branches such as origin/main: where the remote's branches were at the last fetch or push. */
  tracking: Record<string, CommitId>;
  /** Local branch -> the remote-tracking branch it pulls from and pushes to. */
  upstream: Record<string, string>;
  /** Every commit HEAD has pointed at, oldest first. */
  reflog: ReflogEntry[];
}

export type LineKind = 'cmd' | 'out' | 'err' | 'note' | 'ok';

export interface Line {
  text: string;
  kind: LineKind;
}

class GitError extends Error {
  prefix: string;
  constructor(message: string, prefix: string) {
    super(message);
    this.prefix = prefix;
  }
}

function fail(message: string, prefix = 'fatal'): never {
  throw new GitError(message, prefix);
}

const DETACHED_LANE = '#detached';
const REFLOG_LIMIT = 60;

const TEAMMATE_MESSAGES = [
  'Update README',
  'Fix login redirect',
  'Add unit tests',
  'Tidy up CSS',
  'Translate footer',
  'Speed up search',
  'Add privacy page',
  'Bump version',
];

/** Commands that only make sense with files. They explain themselves instead of failing. */
const NO_FILES: Record<string, string> = {
  add: 'There are no files in this trainer, so there is nothing to stage. Go straight to git commit.',
  stash: 'git stash shelves uncommitted file changes. There are no files in this trainer, so there is nothing to stash.',
  restore: 'git restore throws away file changes. There are no files in this trainer, so the working tree is always clean.',
  diff: 'git diff compares file contents, and this trainer has no files. To compare history instead, try git log main..feature.',
  rm: 'There are no files in this trainer to remove.',
  mv: 'There are no files in this trainer to move.',
};

export function freshState(): RepoState {
  return {
    commits: { C0: { id: 'C0', parents: [], msg: 'Initial commit', lane: 0, seq: 0 } },
    branches: { main: 'C0' },
    tags: {},
    head: { kind: 'branch', name: 'main' },
    prev: null,
    lanes: { main: 0 },
    nextLane: 1,
    seq: 1,
    n: 1,
    remote: null,
    tracking: {},
    upstream: {},
    reflog: [{ id: 'C0', msg: 'commit (initial): Initial commit' }],
  };
}

/** Splits a command line, honouring "double" and 'single' quotes. Commit IDs like C3' stay intact. */
export function tokenize(line: string): string[] {
  return [...line.matchAll(/"([^"]*)"|'([^']*)'(?=\s|$)|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? '');
}

/** Every commit reachable from the given tips by following parents, tips included. */
export function reachIn(commits: Record<CommitId, Commit>, tips: readonly (CommitId | undefined)[]): Set<CommitId> {
  const seen = new Set<CommitId>();
  const stack = tips.filter((t): t is CommitId => !!t);
  while (stack.length) {
    const x = stack.pop()!;
    if (seen.has(x) || !commits[x]) continue;
    seen.add(x);
    stack.push(...commits[x].parents);
  }
  return seen;
}

interface Args {
  flags: Set<string>;
  opts: Map<string, string>;
  pos: string[];
}

/** Splits arguments into flags and positional values. Options listed in `valued` take the next token (or `=value`). */
function parse(args: readonly string[], valued: readonly string[] = []): Args {
  const flags = new Set<string>();
  const opts = new Map<string, string>();
  const pos: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      pos.push(...args.slice(i + 1));
      break;
    }
    if (!a.startsWith('-') || a === '-') {
      pos.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    const key = eq > 0 ? a.slice(0, eq) : a;
    flags.add(key);
    if (valued.includes(key)) {
      const value = eq > 0 ? a.slice(eq + 1) : args[++i];
      if (value === undefined) fail(`switch '${key.replace(/^-+/, '')}' requires a value`);
      opts.set(key, value);
    }
  }
  return { flags, opts, pos };
}

const plural = (k: number, word: string) => `${k} ${word}${k === 1 ? '' : 's'}`;

export interface RemoteView {
  name: string;
  branches: [string, CommitId][];
  /** Commits the remote has that this repository has not fetched. */
  unseen: number;
}

export class Repo {
  state: RepoState = freshState();
  private undoStack: string[] = [];
  private lines: Line[] = [];

  private readonly commands: Record<string, (args: string[]) => void> = {
    help: () => this.help(),
    init: () => this.init(),
    clone: () => this.clone(),
    status: () => this.status(),
    commit: (a) => this.commit(a),
    branch: (a) => this.branch(a),
    checkout: (a) => this.checkout(a),
    switch: (a) => this.switchBranch(a),
    merge: (a) => this.merge(a),
    rebase: (a) => this.rebase(a),
    reset: (a) => this.reset(a),
    revert: (a) => this.revert(a),
    'cherry-pick': (a) => this.cherryPick(a),
    log: (a) => this.log(a),
    show: (a) => this.show(a),
    tag: (a) => this.tag(a),
    reflog: (a) => this.reflog(a),
    'merge-base': (a) => this.mergeBase(a),
    remote: (a) => this.remoteCmd(a),
    fetch: (a) => this.fetch(a),
    pull: (a) => this.pull(a),
    push: (a) => this.push(a),
    ...Object.fromEntries(Object.entries(NO_FILES).map(([name, text]) => [name, () => this.note(text)])),
  };

  /** The git commands worth suggesting: everything simulated, minus the ones that only explain they need files. */
  get subcommands(): string[] {
    return Object.keys(this.commands)
      .filter((k) => !Object.hasOwn(NO_FILES, k) && k !== 'init' && k !== 'clone')
      .sort();
  }

  /** Start from one commit on main, run setup commands silently, and clear undo history. */
  load(setup: readonly string[]): void {
    this.state = freshState();
    for (const line of setup) this.exec(line);
    this.undoStack = [];
  }

  /** Runs one command line and returns the terminal output it produced. */
  exec(line: string): Line[] {
    this.lines = [];
    const tokens = tokenize(line.trim());
    if (!tokens.length) return [];
    const [cmd, ...rest] = tokens;

    if (cmd === 'help') this.help();
    else if (cmd === 'undo') this.undo();
    else if (cmd === 'teammate') this.attempt(() => this.teammate(rest));
    else if (cmd !== 'git') this.say(`command not found: ${cmd}. Git commands start with git; type help to list them.`, 'err');
    else {
      const [sub, ...args] = rest;
      this.attempt(() => {
        const run = sub !== undefined && Object.hasOwn(this.commands, sub) ? this.commands[sub] : undefined;
        if (!run) fail(`'${sub ?? ''}' is not supported here. Type help to see the commands`);
        run(args);
      });
    }
    return this.lines;
  }

  /** Runs a state-changing command: on success it becomes undoable, on failure the state is rolled back. */
  private attempt(fn: () => void): void {
    const before = JSON.stringify(this.state);
    try {
      fn();
      if (JSON.stringify(this.state) !== before) this.undoStack.push(before);
    } catch (e) {
      this.state = JSON.parse(before) as RepoState;
      if (e instanceof GitError) this.say(e.prefix ? `${e.prefix}: ${e.message}` : e.message, 'err');
      else this.say(`error: ${String(e)}`, 'err');
    }
  }

  // ---- queries -------------------------------------------------------------

  get headId(): CommitId {
    const h = this.state.head;
    return h.kind === 'branch' ? this.state.branches[h.name] : h.id;
  }

  get currentBranch(): string | null {
    const h = this.state.head;
    return h.kind === 'branch' ? h.name : null;
  }

  /** Branch name, or "detached HEAD". */
  get where(): string {
    return this.currentBranch ?? 'detached HEAD';
  }

  /** Branch name, or the commit ID when detached (as the reflog writes it). */
  private get position(): string {
    return this.currentBranch ?? this.headId;
  }

  getCommit(id: CommitId): Commit {
    return this.state.commits[id];
  }

  /** Every commit reachable from id by following parents, including id itself. */
  reach(id: CommitId | undefined): Set<CommitId> {
    return reachIn(this.state.commits, [id]);
  }

  isAncestor(a: CommitId, b: CommitId): boolean {
    return this.reach(b).has(a);
  }

  /** What the remote holds right now, for showing beside the graph. */
  remoteView(): RemoteView | null {
    const r = this.state.remote;
    if (!r) return null;
    const all = reachIn(r.commits, Object.values(r.branches));
    return {
      name: r.name,
      branches: Object.entries(r.branches).sort(([a], [b]) => a.localeCompare(b)),
      unseen: [...all].filter((id) => !this.state.commits[id]).length,
    };
  }

  /** Resolves a branch, tag, remote-tracking branch, commit ID, HEAD, @ or HEAD@{n}, with optional ~n and ^n suffixes. */
  resolve(ref: string | undefined): CommitId {
    const m = /^([^~^]+)((?:[~^]\d*)*)$/.exec(ref ?? '');
    if (!m) fail(`bad revision '${ref ?? ''}'`);
    const base = m[1];
    const { branches, tags, tracking, commits, reflog } = this.state;
    const at = /^(?:HEAD)?@\{(\d+)\}$/.exec(base);
    let id: CommitId;
    if (base === 'HEAD' || base === '@') id = this.headId;
    else if (at) {
      const entry = reflog[reflog.length - 1 - Number(at[1])];
      if (!entry) fail(`the reflog only has ${reflog.length} entries, so '${base}' does not exist`);
      id = entry.id;
    } else if (Object.hasOwn(branches, base)) id = branches[base];
    else if (Object.hasOwn(tags, base)) id = tags[base];
    else if (Object.hasOwn(tracking, base)) id = tracking[base];
    else if (Object.hasOwn(commits, base.toUpperCase())) id = base.toUpperCase();
    else fail(`unknown revision '${ref}'. Use a branch name, a commit ID like C2, or HEAD`);

    for (const [, op, num] of m[2].matchAll(/([~^])(\d*)/g)) {
      const k = num === '' ? 1 : Number(num);
      if (op === '~') {
        for (let i = 0; i < k; i++) {
          const parent = commits[id].parents[0];
          if (!parent) fail(`'${ref}' goes back past the first commit`);
          id = parent;
        }
      } else if (k > 0) {
        const parent = commits[id].parents[k - 1];
        if (!parent) fail(`'${ref}': that commit has no parent ${k}`);
        id = parent;
      }
    }
    return id;
  }

  // ---- helpers -------------------------------------------------------------

  private say(text: string, kind: LineKind = 'out'): void {
    this.lines.push({ text, kind });
  }

  private note(text: string): void {
    this.say(text, 'note');
  }

  private laneOf(key: string): number {
    const lanes = this.state.lanes;
    if (!(key in lanes)) lanes[key] = this.state.nextLane++;
    return lanes[key];
  }

  /** C3 -> C3', or C3'' if C3' already exists here or on the remote. */
  private prime(id: CommitId): CommitId {
    const taken = (p: string) => !!this.state.commits[p] || !!this.state.remote?.commits[p];
    let p = `${id}'`;
    while (taken(p)) p += "'";
    return p;
  }

  private mk(parents: CommitId[], msg: string | null | undefined, o: { base?: CommitId; copyOf?: CommitId; revertOf?: CommitId } = {}): Commit {
    const s = this.state;
    const id = o.base ? this.prime(o.base) : `C${s.n++}`;
    const c: Commit = { id, parents, msg: msg || `Commit ${id}`, lane: this.laneOf(this.currentBranch ?? DETACHED_LANE), seq: s.seq++ };
    if (o.copyOf) c.copyOf = o.copyOf;
    if (o.revertOf) c.revertOf = o.revertOf;
    s.commits[id] = c;
    return c;
  }

  private moveHead(id: CommitId): void {
    const h = this.state.head;
    if (h.kind === 'branch') this.state.branches[h.name] = id;
    else this.state.head = { kind: 'detached', id };
  }

  /** Adds where HEAD is now to the reflog. */
  private logHead(msg: string): void {
    const log = this.state.reflog;
    log.push({ id: this.headId, msg });
    if (log.length > REFLOG_LIMIT) log.splice(0, log.length - REFLOG_LIMIT);
  }

  /** " (HEAD -> main, origin/main, tag: v1.0)" for log, show and friends. */
  private decorate(id: CommitId): string {
    const { branches, tags, tracking, head } = this.state;
    const current = this.currentBranch;
    const refs: string[] = [];
    if (head.kind === 'detached' && head.id === id) refs.push('HEAD');
    const names = Object.keys(branches).sort((a, b) => Number(b === current) - Number(a === current) || a.localeCompare(b));
    for (const b of names) if (branches[b] === id) refs.push(b === current ? `HEAD -> ${b}` : b);
    for (const t of Object.keys(tracking).sort()) if (tracking[t] === id) refs.push(t);
    for (const t of Object.keys(tags).sort()) if (tags[t] === id) refs.push(`tag: ${t}`);
    return refs.length ? ` (${refs.join(', ')})` : '';
  }

  private checkRefName(name: string | undefined, kind: string): asserts name is string {
    if (!name) fail(`missing ${kind} name`);
    if (!/^[A-Za-z0-9._/-]+$/.test(name) || name.startsWith('-') || name.endsWith('/') || name === 'HEAD') fail(`'${name}' is not a valid ${kind} name`);
    if (/^c\d+'*$/i.test(name)) fail(`'${name}' looks like a commit ID; pick another ${kind} name`);
  }

  private validName(name: string | undefined): asserts name is string {
    this.checkRefName(name, 'branch');
    if (Object.hasOwn(this.state.branches, name)) fail(`a branch named '${name}' already exists`);
    if (Object.hasOwn(this.state.tags, name)) fail(`'${name}' is already a tag; pick another branch name`);
    if (Object.hasOwn(this.state.tracking, name)) fail(`'${name}' is a remote-tracking branch; pick another branch name`);
  }

  private detach(id: CommitId, ref: string): void {
    const from = this.position;
    this.state.prev = from;
    this.state.head = { kind: 'detached', id };
    this.logHead(`checkout: moving from ${from} to ${ref}`);
    this.say(`HEAD is now at ${id} ${this.getCommit(id).msg}`);
    if (Object.hasOwn(this.state.tracking, ref)) {
      const local = ref.slice(ref.indexOf('/') + 1);
      return this.note(`${ref} is a remote-tracking branch, a read-only bookmark of where the remote was, so HEAD is detached. To work on it, use git switch ${local}.`);
    }
    this.note(`Detached HEAD: you are on commit ${id} itself, not on a branch. Look around freely. To keep new work here, create a branch with git switch -c <name>.`);
  }

  private switchTo(name: string): void {
    if (this.currentBranch === name) return this.say(`Already on '${name}'`);
    const from = this.position;
    this.state.prev = from;
    this.state.head = { kind: 'branch', name };
    this.logHead(`checkout: moving from ${from} to ${name}`);
    this.say(`Switched to branch '${name}'`);
    const cmp = this.compare(name);
    if (cmp) this.say(cmp);
    this.note(`HEAD now points to ${name}, which points to ${this.state.branches[name]}. New commits will extend ${name}.`);
  }

  private makeAndSwitch(name: string | undefined, start: string | undefined): void {
    this.validName(name);
    const at = start ? this.resolve(start) : this.headId;
    const from = this.position;
    this.state.branches[name] = at;
    this.laneOf(name);
    this.state.prev = from;
    this.state.head = { kind: 'branch', name };
    this.logHead(`checkout: moving from ${from} to ${name}`);
    if (start && Object.hasOwn(this.state.tracking, start)) {
      this.state.upstream[name] = start;
      this.say(`branch '${name}' set up to track '${start}'.`);
    }
    this.say(`Switched to a new branch '${name}'`);
    this.note(`Created ${name} at ${at} and moved HEAD onto it in one step.`);
  }

  /** `git switch feature` when only origin/feature exists: create a local branch that tracks it. */
  private switchToRemoteBranch(name: string): boolean {
    const r = this.state.remote;
    const ref = r ? `${r.name}/${name}` : '';
    if (!r || !Object.hasOwn(this.state.tracking, ref)) return false;
    this.validName(name);
    const at = this.state.tracking[ref];
    const from = this.position;
    this.state.branches[name] = at;
    this.laneOf(name);
    this.state.upstream[name] = ref;
    this.state.prev = from;
    this.state.head = { kind: 'branch', name };
    this.logHead(`checkout: moving from ${from} to ${name}`);
    this.say(`branch '${name}' set up to track '${ref}'.`);
    this.say(`Switched to a new branch '${name}'`);
    this.note(`There was no local ${name}, but ${ref} exists, so Git created ${name} at ${at} and linked it to ${ref} for pull and push.`);
    return true;
  }

  /** `git switch -` / `git checkout -`: go back to where HEAD was before. */
  private previous(allowDetach: boolean): void {
    const p = this.state.prev;
    if (!p) fail('there is no previous branch to go back to yet');
    if (Object.hasOwn(this.state.branches, p)) return this.switchTo(p);
    if (!allowDetach) fail(`you were last on commit ${p}, not a branch. Use git checkout - to go back to it`);
    if (!this.state.commits[p]) fail(`the previous position '${p}' no longer exists`);
    this.detach(p, p);
  }

  /** git's "Your branch is ahead of 'origin/main' by 2 commits." line, or null without an upstream. */
  private compare(branch: string): string | null {
    const up = this.state.upstream[branch];
    if (!up) return null;
    const theirs = this.state.tracking[up];
    if (!theirs) return `Your branch is based on '${up}', but that branch is gone from the remote.`;
    const mine = this.reach(this.state.branches[branch]);
    const base = this.reach(theirs);
    const ahead = [...mine].filter((x) => !base.has(x)).length;
    const behind = [...base].filter((x) => !mine.has(x)).length;
    if (!ahead && !behind) return `Your branch is up to date with '${up}'.`;
    if (!behind) return `Your branch is ahead of '${up}' by ${plural(ahead, 'commit')}.`;
    if (!ahead) return `Your branch is behind '${up}' by ${plural(behind, 'commit')}, and can be fast-forwarded.`;
    return `Your branch and '${up}' have diverged, with ${ahead} and ${behind} different commits each.`;
  }

  private needRemote(name?: string): Remote {
    const r = this.state.remote;
    if (!r) fail('no remote is set up. Add one with git remote add origin <url>');
    if (name && name !== r.name) fail(`'${name}' does not appear to be a git repository. The remote here is called ${r.name}`);
    return r;
  }

  /** Copies every commit reachable from tip onto the remote. */
  private upload(r: Remote, tip: CommitId): void {
    for (const id of this.reach(tip)) if (!r.commits[id]) r.commits[id] = { ...this.getCommit(id), parents: [...this.getCommit(id).parents] };
  }

  // ---- non-git commands ----------------------------------------------------

  private help(): void {
    this.say('commits:   commit, status, log, show, reflog');
    this.say('branches:  branch, switch, checkout, tag');
    this.say('combining: merge, rebase, cherry-pick, merge-base');
    this.say('undoing:   reset, revert');
    this.say('remotes:   remote, fetch, pull, push');
    this.say('other:     teammate, undo, clear, help');
    this.say('refs:      main, C2, HEAD~2, main^, v1.0, origin/main, HEAD@{1}');
    this.note('teammate pretends a teammate pushed a commit to origin, so you can practise fetch and pull.');
  }

  private undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return this.say('Nothing to undo.', 'err');
    this.state = JSON.parse(prev) as RepoState;
    this.note('Undid the last command.');
  }

  /** Simulates a teammate pushing one commit to a branch on the remote. */
  private teammate(args: string[]): void {
    const r = this.state.remote;
    if (!r) fail('there is no remote for a teammate to push to. Add one with git remote add origin <url>', '');
    const branch = parse(args).pos[0] ?? (Object.hasOwn(r.branches, 'main') ? 'main' : Object.keys(r.branches).sort()[0]);
    if (!branch) fail(`${r.name} is empty, so there is nothing for a teammate to build on. Push first: git push -u ${r.name} main`, '');
    const parent = r.branches[branch];
    if (!parent) fail(`${r.name} has no branch called ${branch}`, '');
    const s = this.state;
    const id = `C${s.n++}`;
    const c: Commit = { id, parents: [parent], msg: TEAMMATE_MESSAGES[s.n % TEAMMATE_MESSAGES.length], lane: this.laneOf(`${r.name}/${branch}`), seq: s.seq++ };
    r.commits[id] = c;
    r.branches[branch] = id;
    this.say(`A teammate pushed ${id} "${c.msg}" to ${branch} on ${r.name}.`);
    this.note(`Your repository has not seen ${id} yet. ${r.name}/${branch} still shows where ${r.name} was at your last fetch. Run git fetch or git pull to get it.`);
  }

  // ---- git commands --------------------------------------------------------

  private init(): void {
    this.say('Reinitialized existing Git repository.');
    this.note('This sandbox already has a repository, so there is nothing to set up.');
  }

  private clone(): void {
    this.say('You are already inside a repository, so there is nothing to clone.');
    this.note('Remote levels come with origin set up for you. In the sandbox, origin is connected too; connect a fresh one with git remote add origin <url>.');
  }

  private status(): void {
    const h = this.state.head;
    this.say(h.kind === 'branch' ? `On branch ${h.name}` : `HEAD detached at ${h.id}`);
    const cmp = h.kind === 'branch' ? this.compare(h.name) : null;
    if (cmp) this.say(cmp);
    this.say('nothing to commit, working tree clean');
    if (cmp && h.kind === 'branch') this.note(`That comparison uses ${this.state.upstream[h.name]} as of your last fetch. Run git fetch to check for new work.`);
    else this.note('This trainer tracks commits and pointers only, so the working tree is always clean.');
  }

  private commit(args: string[]): void {
    const p = parse(args, ['-m', '-am', '--message']);
    const msg = p.opts.get('-m') ?? p.opts.get('-am') ?? p.opts.get('--message') ?? null;
    const h = this.headId;

    if (p.flags.has('--amend')) {
      const old = this.getCommit(h);
      if (!old.parents.length) fail('the initial commit cannot be amended here');
      const c = this.mk(old.parents, msg ?? old.msg, { base: h });
      this.moveHead(c.id);
      this.logHead(`commit (amend): ${c.msg}`);
      this.say(`[${this.where} ${c.id}] ${c.msg}`);
      return this.note(`--amend does not edit ${h}. It makes a replacement, ${c.id}, with the same parent and moves the branch to it. ${h} is left behind.`);
    }

    const c = this.mk([h], msg);
    this.moveHead(c.id);
    this.logHead(`commit: ${c.msg}`);
    this.say(`[${this.where} ${c.id}] ${c.msg}`);
    const b = this.currentBranch;
    this.note(
      b
        ? `New commit ${c.id} points back to ${h}. The branch ${b} moved forward to it.`
        : `You committed on a detached HEAD. Only HEAD points at ${c.id}; create a branch (git switch -c name) or it will be lost when you check out something else.`,
    );
  }

  private branch(args: string[]): void {
    const p = parse(args, ['-u', '--set-upstream-to']);
    const { branches } = this.state;
    const has = (...names: string[]) => names.some((f) => p.flags.has(f));

    const upstream = p.opts.get('-u') ?? p.opts.get('--set-upstream-to');
    if (upstream !== undefined) return this.setUpstream(upstream, p.pos[0] ?? this.currentBranch);

    if (has('-d', '-D', '--delete')) {
      const name = p.pos[0];
      if (!name || !Object.hasOwn(branches, name)) fail(`branch '${name ?? ''}' not found`);
      if (name === this.currentBranch) fail(`cannot delete branch '${name}' while you are on it. Switch to another branch first`);
      if (!has('-D') && !this.isAncestor(branches[name], this.headId)) fail(`the branch '${name}' is not fully merged. Use -D to delete it anyway`);
      this.say(`Deleted branch ${name} (was ${branches[name]}).`);
      delete branches[name];
      delete this.state.upstream[name];
      return this.note('Deleting a branch only removes the label. Commits that nothing else points to fade out.');
    }

    if (has('-m', '-M', '--move')) return this.renameBranch(p.pos);

    if (!p.pos.length || has('--list')) return this.listBranches(has('-a', '--all'), has('-r', '--remotes'), has('-v', '-vv', '--verbose'));

    const unknown = [...p.flags].find((f) => f !== '-f' && f !== '--force');
    if (unknown) fail(`option '${unknown}' is not supported here`);
    const [name, start] = p.pos;

    if (has('-f', '--force') && Object.hasOwn(branches, name)) {
      if (name === this.currentBranch) fail(`cannot force update the current branch '${name}'. Use git reset to move it instead`);
      const from = branches[name];
      const to = this.resolve(start ?? 'HEAD');
      branches[name] = to;
      return this.note(`Moved ${name} from ${from} to ${to}. A branch is just a label, so -f simply picks it up and puts it somewhere else.`);
    }

    this.validName(name);
    const at = start ? this.resolve(start) : this.headId;
    branches[name] = at;
    this.laneOf(name);
    if (start && Object.hasOwn(this.state.tracking, start)) {
      this.state.upstream[name] = start;
      this.say(`branch '${name}' set up to track '${start}'.`);
    }
    this.note(`Branch ${name} now points at ${at}. A branch is just a movable label, and you are still on ${this.where}. Use git switch ${name} to move onto it.`);
  }

  private listBranches(all: boolean, remotes: boolean, verbose: boolean): void {
    const { branches, tracking, head } = this.state;
    const row = (mark: string, name: string, id: CommitId) => `${mark} ${name}  ${id}${verbose ? ` ${this.getCommit(id).msg}` : ''}`;
    if (!remotes) {
      if (head.kind === 'detached') this.say(`* (HEAD detached at ${head.id})`);
      for (const b of Object.keys(branches).sort()) this.say(row(b === this.currentBranch ? '*' : ' ', b, branches[b]));
    }
    if (all || remotes) {
      const refs = Object.keys(tracking).sort();
      for (const t of refs) this.say(row(' ', all ? `remotes/${t}` : t, tracking[t]));
      if (!refs.length) this.note('No remote-tracking branches yet. They appear after you push to or fetch from a remote.');
    }
  }

  private renameBranch(pos: string[]): void {
    const { branches, lanes, upstream } = this.state;
    const [a, b] = pos;
    const old = b !== undefined ? a : this.currentBranch;
    const name = b ?? a;
    if (!old) fail('you are not on a branch. Name the one to rename: git branch -m old new');
    if (!Object.hasOwn(branches, old)) fail(`branch '${old}' not found`);
    if (old === name) return this.say(`Branch is already called '${name}'.`);
    this.validName(name);
    branches[name] = branches[old];
    delete branches[old];
    if (Object.hasOwn(lanes, old)) lanes[name] = lanes[old];
    delete lanes[old];
    if (upstream[old]) upstream[name] = upstream[old];
    delete upstream[old];
    if (this.currentBranch === old) this.state.head = { kind: 'branch', name };
    this.note(`Renamed ${old} to ${name}. Only the label changed; the commits are exactly the same.`);
  }

  private setUpstream(ref: string, branch: string | null): void {
    if (!branch) fail('you are not on a branch. Name one: git branch -u origin/main main');
    if (!Object.hasOwn(this.state.branches, branch)) fail(`branch '${branch}' not found`);
    if (!Object.hasOwn(this.state.tracking, ref)) fail(`the requested upstream branch '${ref}' does not exist. Push the branch first with git push -u, or run git fetch`);
    this.state.upstream[branch] = ref;
    this.say(`branch '${branch}' set up to track '${ref}'.`);
    this.note(`Now a plain git pull or git push on ${branch} uses ${ref}.`);
  }

  private checkout(args: string[]): void {
    const p = parse(args, ['-b', '-B']);
    const create = p.opts.get('-b') ?? p.opts.get('-B');
    if (create !== undefined) return this.makeAndSwitch(create, p.pos[0]);
    if (p.flags.has('--detach')) return this.detach(this.resolve(p.pos[0] ?? 'HEAD'), p.pos[0] ?? 'HEAD');
    const ref = p.pos[0];
    if (!ref) fail('you must name a branch or a commit');
    if (ref === '-') return this.previous(true);
    if (Object.hasOwn(this.state.branches, ref)) return this.switchTo(ref);
    if (this.switchToRemoteBranch(ref)) return;
    this.detach(this.resolve(ref), ref);
  }

  private switchBranch(args: string[]): void {
    const p = parse(args, ['-c', '-C', '--create']);
    const create = p.opts.get('-c') ?? p.opts.get('-C') ?? p.opts.get('--create');
    if (create !== undefined) return this.makeAndSwitch(create, p.pos[0]);
    if (p.flags.has('--detach') || p.flags.has('-d')) return this.detach(this.resolve(p.pos[0] ?? 'HEAD'), p.pos[0] ?? 'HEAD');
    const name = p.pos[0];
    if (name === '-') return this.previous(false);
    if (name && Object.hasOwn(this.state.branches, name)) return this.switchTo(name);
    if (name && this.switchToRemoteBranch(name)) return;
    if (name && Object.hasOwn(this.state.tracking, name)) {
      fail(`a branch is expected, got remote branch '${name}'. Switch to your own copy instead: git switch ${name.slice(name.indexOf('/') + 1)}`);
    }
    if (name && Object.hasOwn(this.state.tags, name)) fail(`a branch is expected, got tag '${name}'. To look at it, use git checkout ${name}`);
    fail(`invalid reference: ${name ?? ''}. git switch only takes branch names; use git checkout <commit> to visit a commit`);
  }

  private merge(args: string[]): void {
    const p = parse(args, ['-m']);
    if (p.flags.has('--abort') || p.flags.has('--continue')) fail('there is no merge in progress. This trainer has no files, so merges never stop for conflicts');
    const ref = p.pos[0];
    if (!ref) fail('name a branch to merge');
    this.mergeIn(ref, { noFF: p.flags.has('--no-ff'), ffOnly: p.flags.has('--ff-only'), msg: p.opts.get('-m') });
  }

  private mergeIn(ref: string, o: { noFF?: boolean; ffOnly?: boolean; msg?: string; via?: string }): void {
    const t = this.resolve(ref);
    const h = this.headId;
    const action = o.via ?? `merge ${ref}`;
    if (this.isAncestor(t, h)) {
      this.say('Already up to date.');
      return this.note(`${ref} is already part of ${this.where}'s history, so there is nothing to merge.`);
    }
    if (this.isAncestor(h, t) && !o.noFF) {
      this.moveHead(t);
      this.logHead(`${action}: Fast-forward`);
      this.say(`Updating ${h}..${t}`);
      this.say('Fast-forward');
      return this.note(`${this.where} had no commits of its own since ${ref} split off, so Git just slid the label forward to ${t}. No merge commit needed.`);
    }
    if (o.ffOnly) fail('Not possible to fast-forward, aborting. Both sides have new commits; merge without --ff-only, or rebase');
    const { branches, tracking } = this.state;
    const msg =
      o.msg ??
      (Object.hasOwn(branches, ref) ? `Merge branch '${ref}'` : Object.hasOwn(tracking, ref) ? `Merge remote-tracking branch '${ref}'` : `Merge ${t}`);
    const c = this.mk([h, t], msg);
    this.moveHead(c.id);
    this.logHead(`${action}: Merge made by the 'ort' strategy.`);
    this.say(`Merge made by the 'ort' strategy. [${c.id}]`);
    this.note(`Both lines had new work, so Git made merge commit ${c.id} with two parents: ${h} and ${t}.`);
  }

  private rebase(args: string[]): void {
    const p = parse(args);
    if (p.flags.has('-i') || p.flags.has('--interactive')) fail('interactive rebase is not simulated here. Try git rebase <branch>, or reorder commits with git cherry-pick');
    if (p.flags.has('--abort') || p.flags.has('--continue')) fail('there is no rebase in progress');
    const b = this.currentBranch;
    const ref = p.pos[0] ?? (b ? this.state.upstream[b] : undefined);
    if (!ref) fail('name a branch to rebase onto');
    this.rebaseOnto(ref);
  }

  private rebaseOnto(ref: string): void {
    const t = this.resolve(ref);
    const h = this.headId;
    if (this.isAncestor(t, h)) return this.say(`Current branch ${this.where} is up to date.`);
    if (this.isAncestor(h, t)) {
      this.moveHead(t);
      this.logHead(`rebase (finish): ${this.where} onto ${t}`);
      this.say(`Successfully rebased and updated ${this.where}.`);
      return this.note(`${this.where} had no new work, so this was a fast-forward to ${t}.`);
    }
    const onTarget = this.reach(t);
    const toCopy = [...this.reach(h)]
      .filter((id) => !onTarget.has(id))
      .map((id) => this.getCommit(id))
      .filter((c) => c.parents.length < 2)
      .sort((x, y) => x.seq - y.seq);

    let cur = t;
    const made: string[] = [];
    for (const c of toCopy) {
      const copy = this.mk([cur], c.msg, { base: c.id, copyOf: c.copyOf ?? c.id });
      made.push(`${c.id} as ${copy.id}`);
      cur = copy.id;
    }
    this.moveHead(cur);
    this.logHead(`rebase (finish): ${this.where} onto ${t}`);
    this.say(`Successfully rebased and updated ${this.where}.`);
    this.note(`Rebase replayed your commits on top of ${ref}: ${made.join(', ')}. The copies are new commits (the ' mark); the originals fade because nothing points at them now.`);
  }

  private reset(args: string[]): void {
    const p = parse(args);
    const ref = p.pos[0] ?? 'HEAD';
    const t = this.resolve(ref);
    const h = this.headId;
    this.moveHead(t);
    this.say(`HEAD is now at ${t} ${this.getCommit(t).msg}`);
    if (t === h) return this.note('Nothing moved.');
    this.logHead(`reset: moving to ${ref}`);
    this.note(`${this.where} jumped from ${h} to ${t}. Commits after it are no longer on the branch. Reset rewrites history, so avoid it on commits others already have.`);
    if (p.flags.has('--soft') || p.flags.has('--mixed')) {
      this.note('There are no files in this trainer, so --soft, --mixed and --hard all look the same here: only the branch moves.');
    }
  }

  private revert(args: string[]): void {
    const ref = parse(args).pos[0];
    if (!ref) fail('name a commit to revert');
    const t = this.resolve(ref);
    const target = this.getCommit(t);
    if (target.parents.length > 1) fail(`${t} is a merge commit; reverting merges is not supported here`);
    if (!target.parents.length) fail('the initial commit cannot be reverted');
    const c = this.mk([this.headId], `Revert "${target.msg}"`, { revertOf: t });
    this.moveHead(c.id);
    this.logHead(`revert: ${c.msg}`);
    this.say(`[${this.where} ${c.id}] ${c.msg}`);
    this.note(`Revert added ${c.id}, which undoes ${t}'s changes. No history was rewritten, so this is safe on shared branches.`);
  }

  private cherryPick(args: string[]): void {
    const refs = parse(args).pos;
    if (!refs.length) fail('name the commits to cherry-pick');
    const ids: CommitId[] = [];
    for (const r of refs) {
      const range = /^(.+?)\.\.(.+)$/.exec(r);
      if (!range) {
        ids.push(this.resolve(r));
        continue;
      }
      const exclude = this.reach(this.resolve(range[1]));
      const list = [...this.reach(this.resolve(range[2]))]
        .filter((id) => !exclude.has(id))
        .map((id) => this.getCommit(id))
        .sort((x, y) => x.seq - y.seq);
      if (!list.length) fail(`the range ${r} has no commits in it`);
      ids.push(...list.map((c) => c.id));
    }
    const made: CommitId[] = [];
    for (const id of ids) {
      if (this.isAncestor(id, this.headId)) fail(`${id} is already in ${this.where}'s history`);
      const src = this.getCommit(id);
      if (src.parents.length > 1) fail(`${id} is a merge commit; cherry-picking merges is not supported here`);
      const c = this.mk([this.headId], src.msg, { base: id, copyOf: src.copyOf ?? id });
      this.moveHead(c.id);
      this.logHead(`cherry-pick: ${c.msg}`);
      made.push(c.id);
      this.say(`[${this.where} ${c.id}] ${c.msg}`);
    }
    this.note(`Copied ${ids.join(', ')} onto ${this.where} as ${made.join(', ')}. The originals stay where they were.`);
  }

  private log(args: string[]): void {
    const p = parse(args, ['-n', '--max-count']);
    let limit = 15;
    const n = p.opts.get('-n') ?? p.opts.get('--max-count');
    if (n !== undefined) limit = Number(n);
    for (const f of p.flags) if (/^-\d+$/.test(f)) limit = Number(f.slice(1));
    if (!Number.isInteger(limit) || limit < 1) fail('the number of commits to show must be a whole number above 0');

    const include = new Set<CommitId>();
    const exclude = new Set<CommitId>();
    let range: [string, string] | null = null;
    if (p.flags.has('--all')) {
      const { branches, tags, tracking } = this.state;
      for (const id of reachIn(this.state.commits, [this.headId, ...Object.values(branches), ...Object.values(tags), ...Object.values(tracking)])) include.add(id);
    } else if (p.pos.length) {
      for (const r of p.pos) {
        const m = /^(.*?)\.\.(.*)$/.exec(r);
        if (m) {
          range = [m[1] || 'HEAD', m[2] || 'HEAD'];
          for (const id of this.reach(this.resolve(range[1]))) include.add(id);
          for (const id of this.reach(this.resolve(range[0]))) exclude.add(id);
        } else for (const id of this.reach(this.resolve(r))) include.add(id);
      }
    } else for (const id of this.reach(this.headId)) include.add(id);

    const commits = [...include]
      .filter((id) => !exclude.has(id))
      .map((id) => this.getCommit(id))
      .sort((x, y) => y.seq - x.seq);
    for (const c of commits.slice(0, limit)) this.say(`${c.id}${this.decorate(c.id)} ${c.msg}`);
    if (commits.length > limit) this.say(`... ${plural(commits.length - limit, 'older commit')}`);
    if (range) {
      this.note(
        commits.length
          ? `These are the commits in ${range[1]} that ${range[0]} does not have.`
          : `${range[1]} has no commits that ${range[0]} does not already have.`,
      );
    }
  }

  private show(args: string[]): void {
    const ref = parse(args).pos[0] ?? 'HEAD';
    const id = this.resolve(ref);
    const c = this.getCommit(id);
    this.say(`commit ${id}${this.decorate(id)}`);
    if (c.parents.length > 1) this.say(`Merge: ${c.parents.join(' ')}`);
    this.say(`    ${c.msg}`);
    const parts = [
      !c.parents.length
        ? `${id} is the first commit, so it has no parent.`
        : c.parents.length === 1
          ? `${id}'s parent is ${c.parents[0]}.`
          : `${id} is a merge commit with two parents: ${c.parents.join(' and ')}.`,
    ];
    if (c.copyOf) parts.push(`It is a copy of ${c.copyOf}, made by rebase or cherry-pick.`);
    if (c.revertOf) parts.push(`It undoes ${c.revertOf}.`);
    this.note(parts.join(' '));
  }

  private tag(args: string[]): void {
    const p = parse(args, ['-m', '--message']);
    const { tags } = this.state;
    if (p.flags.has('-d') || p.flags.has('--delete')) {
      const name = p.pos[0];
      if (!name || !Object.hasOwn(tags, name)) fail(`tag '${name ?? ''}' not found`);
      this.say(`Deleted tag '${name}' (was ${tags[name]})`);
      delete tags[name];
      return;
    }
    if (!p.pos.length || p.flags.has('-l') || p.flags.has('--list')) {
      const names = Object.keys(tags).sort();
      for (const t of names) this.say(t);
      if (!names.length) this.note('No tags yet. Tag the commit you are on with git tag v1.0.');
      return;
    }
    const [name, start] = p.pos;
    this.checkRefName(name, 'tag');
    if (Object.hasOwn(tags, name) && !p.flags.has('-f') && !p.flags.has('--force')) fail(`tag '${name}' already exists`);
    if (Object.hasOwn(this.state.branches, name)) fail(`'${name}' is already a branch; pick another tag name`);
    const at = start ? this.resolve(start) : this.headId;
    tags[name] = at;
    this.note(`Tagged ${at} as ${name}. Unlike a branch, a tag stays on ${at} when you make new commits.`);
  }

  private reflog(args: string[]): void {
    const sub = parse(args).pos[0];
    if (sub && sub !== 'show') fail(`'reflog ${sub}' is not supported here`);
    const entries = [...this.state.reflog].reverse();
    entries.slice(0, 20).forEach((e, i) => this.say(`${e.id} HEAD@{${i}}: ${e.msg}`));
    if (entries.length > 20) this.say(`... ${entries.length - 20} older entries`);
    this.note('The reflog lists every commit HEAD has pointed at, newest first, even ones no branch points to. Rescue one with git branch <name> <id>, or use HEAD@{n} as a ref.');
  }

  private mergeBase(args: string[]): void {
    const [a, b] = parse(args).pos;
    if (!a || !b) fail('name two branches or commits, for example git merge-base main feature');
    const inB = this.reach(this.resolve(b));
    const common = [...this.reach(this.resolve(a))]
      .filter((id) => inB.has(id))
      .map((id) => this.getCommit(id))
      .sort((x, y) => y.seq - x.seq);
    if (!common.length) fail(`${a} and ${b} have no history in common`);
    const base = common[0].id;
    this.say(base);
    this.note(`${base} is the newest commit that ${a} and ${b} both contain: the point where they split. Merge and rebase both start from here.`);
  }

  private remoteCmd(args: string[]): void {
    const p = parse(args);
    const [sub, name, url] = p.pos;
    const r = this.state.remote;
    if (!sub) {
      if (!r) return this.note('No remotes yet. Add one with git remote add origin <url>.');
      if (p.flags.has('-v') || p.flags.has('--verbose')) {
        this.say(`${r.name}  ${r.url} (fetch)`);
        this.say(`${r.name}  ${r.url} (push)`);
      } else this.say(r.name);
      return;
    }
    if (sub === 'add') {
      if (!name || !url) fail('usage: git remote add <name> <url>');
      if (r) fail(r.name === name ? `remote ${name} already exists` : `this trainer supports one remote, and ${r.name} is already set up`);
      if (!/^[A-Za-z0-9._-]+$/.test(name)) fail(`'${name}' is not a valid remote name`);
      this.state.remote = { name, url, branches: {}, tags: {}, commits: {} };
      const b = this.currentBranch ?? 'main';
      return this.note(`Added ${name}, an empty repository at ${url}. Send ${b} to it with git push -u ${name} ${b}.`);
    }
    if (sub === 'remove' || sub === 'rm') {
      if (!r || r.name !== name) fail(`no such remote: '${name ?? ''}'`);
      const prefix = `${r.name}/`;
      for (const ref of Object.keys(this.state.tracking)) if (ref.startsWith(prefix)) delete this.state.tracking[ref];
      for (const [b, ref] of Object.entries(this.state.upstream)) if (ref.startsWith(prefix)) delete this.state.upstream[b];
      this.state.remote = null;
      return this.note(`Removed ${name} and its remote-tracking branches. Your own branches and commits are untouched.`);
    }
    fail(`'remote ${sub}' is not supported here. Try git remote -v or git remote add <name> <url>`);
  }

  /** Copies the remote's new commits and tags in, and moves the remote-tracking branches. */
  private fetchFrom(r: Remote, prune: boolean): { fresh: number; changed: boolean } {
    const { commits, tracking, tags } = this.state;
    const incoming = [...reachIn(r.commits, [...Object.values(r.branches), ...Object.values(r.tags)])]
      .map((id) => r.commits[id])
      .sort((x, y) => x.seq - y.seq);
    let fresh = 0;
    for (const c of incoming) {
      if (commits[c.id]) continue;
      commits[c.id] = { ...c, parents: [...c.parents] };
      fresh++;
    }
    const out: string[] = [];
    for (const b of Object.keys(r.branches).sort()) {
      const ref = `${r.name}/${b}`;
      const old = tracking[ref];
      const now = r.branches[b];
      if (old === now) continue;
      if (!old) out.push(` * [new branch]      ${b} -> ${ref}`);
      else if (this.isAncestor(old, now)) out.push(`   ${old}..${now}  ${b} -> ${ref}`);
      else out.push(` + ${old}...${now}  ${b} -> ${ref}  (forced update)`);
      tracking[ref] = now;
    }
    if (prune) {
      for (const ref of Object.keys(tracking)) {
        if (!ref.startsWith(`${r.name}/`) || Object.hasOwn(r.branches, ref.slice(r.name.length + 1))) continue;
        out.push(` - [deleted]         (none) -> ${ref}`);
        delete tracking[ref];
      }
    }
    for (const t of Object.keys(r.tags).sort()) {
      if (Object.hasOwn(tags, t)) continue;
      tags[t] = r.tags[t];
      out.push(` * [new tag]         ${t} -> ${t}`);
    }
    if (out.length) {
      this.say(`From ${r.url}`);
      for (const line of out) this.say(line);
    }
    return { fresh, changed: out.length > 0 };
  }

  private fetch(args: string[]): void {
    const p = parse(args);
    const r = this.needRemote(p.pos[0]);
    const { fresh, changed } = this.fetchFrom(r, p.flags.has('--prune') || p.flags.has('-p'));
    if (!changed) return this.note(`${r.name} has nothing new since you last fetched.`);
    const b = this.currentBranch;
    const up = b ? this.state.upstream[b] : undefined;
    this.note(
      `Fetched ${plural(fresh, 'new commit')}. Fetching only moves the ${r.name}/ bookmarks; your own branches stay put.` +
        (up ? ` To bring the work into ${b}, merge or rebase ${up}.` : ''),
    );
  }

  private pull(args: string[]): void {
    const p = parse(args);
    const b = this.currentBranch;
    if (!b) fail('you are not on a branch. Switch to a branch before pulling');
    const r = this.needRemote(p.pos[0]);
    let ref: string;
    if (p.pos[1]) ref = `${r.name}/${p.pos[1]}`;
    else {
      const up = this.state.upstream[b];
      if (!up) fail(`there is no tracking information for ${b}. Say what to pull with git pull ${r.name} ${b}, or link it with git branch -u ${r.name}/${b}`);
      ref = up;
    }
    this.fetchFrom(r, false);
    if (!Object.hasOwn(this.state.tracking, ref)) fail(`couldn't find remote ref ${ref.slice(r.name.length + 1)}`);
    const rebase = p.flags.has('--rebase') || p.flags.has('-r');
    if (rebase) this.rebaseOnto(ref);
    else this.mergeIn(ref, { ffOnly: p.flags.has('--ff-only'), via: 'pull' });
    this.note(`git pull${rebase ? ' --rebase' : ''} is git fetch followed by git ${rebase ? 'rebase' : 'merge'} ${ref}.`);
  }

  private push(args: string[]): void {
    const p = parse(args);
    const r = this.state.remote;
    if (!r) fail('no configured push destination. Add a remote first: git remote add origin <url>');
    const [remoteName, ...specs] = p.pos;
    if (remoteName && remoteName !== r.name) fail(`'${remoteName}' does not appear to be a git repository. The remote here is called ${r.name}`);
    const has = (...names: string[]) => names.some((f) => p.flags.has(f));
    const force = has('-f', '--force');
    const lease = has('--force-with-lease');
    const setUp = has('-u', '--set-upstream');
    const { branches, tags, tracking, upstream } = this.state;
    const out: string[] = [];
    const notes: string[] = [];

    if (has('-d', '--delete')) {
      if (!specs.length) fail(`name the remote branch to delete, for example git push ${r.name} --delete feature`);
      for (const s of specs) this.deleteRemoteBranch(r, s, out);
      this.say(`To ${r.url}`);
      for (const line of out) this.say(line);
      return this.note(`Deleted ${specs.join(', ')} on ${r.name}. Your local branches are untouched.`);
    }

    let todo = specs;
    if (!todo.length && !has('--tags')) {
      const b = this.currentBranch;
      if (!b) fail('you are not currently on a branch. Switch to the branch you want to push');
      if (!setUp && !upstream[b]) fail(`the current branch ${b} has no upstream branch. To push it and set the upstream, use git push -u ${r.name} ${b}`);
      const up = upstream[b];
      todo = [up && up.startsWith(`${r.name}/`) ? `${b}:${up.slice(r.name.length + 1)}` : b];
    }

    if (has('--tags')) {
      for (const t of Object.keys(tags).sort()) if (r.tags[t] !== tags[t]) this.pushTag(r, t, force, out);
    }

    for (const spec of todo) {
      const [src, dst] = spec.includes(':') ? (spec.split(':', 2) as [string, string]) : [spec, spec];
      if (!src) {
        this.deleteRemoteBranch(r, dst, out);
        continue;
      }
      if (Object.hasOwn(tags, src) && !Object.hasOwn(branches, src)) {
        this.pushTag(r, src, force, out);
        continue;
      }
      if (!Object.hasOwn(branches, src) && !spec.includes(':')) {
        fail(`src refspec ${src} does not match any branch or tag. To push a commit, name where it goes: git push ${r.name} ${src}:main`, 'error');
      }
      const tip = this.resolve(src);
      const old = r.branches[dst];
      if (old === tip) continue;
      let forced = false;
      if (old && !this.isAncestor(old, tip)) {
        const known = !!this.state.commits[old];
        const leaseOk = tracking[`${r.name}/${dst}`] === old;
        if (lease && !leaseOk) {
          this.say(` ! [rejected]        ${src} -> ${dst} (stale info)`, 'err');
          fail(`${r.name}'s ${dst} moved since you last fetched, so --force-with-lease refused to overwrite it. Run git fetch and look first`, 'error');
        }
        if (!force && !lease) {
          this.say(` ! [rejected]        ${src} -> ${dst} (${known ? 'non-fast-forward' : 'fetch first'})`, 'err');
          fail(
            known
              ? `push rejected: ${r.name}/${dst} has commits your ${src} does not. Merge or rebase them in (git pull does this), then push again`
              : `push rejected: ${r.name} has new commits on ${dst} that you do not have yet. Run git pull (or git pull --rebase), then push again`,
            'error',
          );
        }
        forced = true;
      }
      this.upload(r, tip);
      r.branches[dst] = tip;
      tracking[`${r.name}/${dst}`] = tip;
      if (!old) out.push(` * [new branch]      ${src} -> ${dst}`);
      else if (forced) out.push(` + ${old}...${tip}  ${src} -> ${dst} (forced update)`);
      else out.push(`   ${old}..${tip}  ${src} -> ${dst}`);

      if (forced) notes.push(`Force push replaced ${r.name}'s ${dst}. Commits only ${r.name} had are gone from it, which is why teams avoid force-pushing shared branches.`);
      else if (!old) notes.push(`${r.name} now has a ${dst} branch too.`);
      else notes.push(`${r.name}'s ${dst} now points at ${tip}, and so does your ${r.name}/${dst}. Teammates get these commits next time they fetch.`);

      if (setUp && Object.hasOwn(branches, src)) {
        upstream[src] = `${r.name}/${dst}`;
        out.push(`branch '${src}' set up to track '${r.name}/${dst}'.`);
        notes.push(`-u linked ${src} to ${r.name}/${dst}, so from now on a plain git push or git pull just works.`);
      }
    }

    if (!out.length) {
      this.say('Everything up-to-date');
      return this.note(`${r.name} already has everything you tried to push.`);
    }
    this.say(`To ${r.url}`);
    for (const line of out) this.say(line);
    if (notes.length) this.note(notes.join(' '));
  }

  private pushTag(r: Remote, name: string, force: boolean, out: string[]): void {
    const id = this.state.tags[name];
    const old = r.tags[name];
    if (old === id) return;
    if (old && !force) {
      this.say(` ! [rejected]        ${name} -> ${name} (already exists)`, 'err');
      fail(`${r.name} already has a tag called ${name} on a different commit. Tags are not supposed to move`, 'error');
    }
    this.upload(r, id);
    r.tags[name] = id;
    out.push(` * [new tag]         ${name} -> ${name}`);
  }

  private deleteRemoteBranch(r: Remote, name: string, out: string[]): void {
    if (!Object.hasOwn(r.branches, name)) fail(`unable to delete '${name}': remote ref does not exist`, 'error');
    delete r.branches[name];
    delete this.state.tracking[`${r.name}/${name}`];
    out.push(` - [deleted]         ${name}`);
  }
}
