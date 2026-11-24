import { reachIn, type Commit, type Repo } from './sim';

/** Level groups, in route order. A group's index is also its line colour (--l0, --l1, …). */
export const GROUPS = ['Basics', 'Combining work', 'Moving around', 'Fixing mistakes', 'Sharing work'] as const;

export interface Level {
  title: string;
  /** Index into GROUPS; -1 for the sandbox. */
  group: number;
  story: string;
  goal: string;
  hint?: string;
  /** Commands run silently to build the starting repository (which begins as C0 on main). */
  setup: readonly string[];
  /** Returns true once the goal is met. Omitted for the sandbox. */
  check?: (r: Repo) => boolean;
}

const tip = (r: Repo, branch: string): Commit | undefined => {
  const id = r.state.branches[branch];
  return id ? r.getCommit(id) : undefined;
};

const DIVERGED_SETUP = [
  'git commit -m "Add homepage"',
  'git switch -c feature',
  'git commit -m "Add search box"',
  'git commit -m "Style search results"',
  'git switch main',
  'git commit -m "Fix footer links"',
];

const ORIGIN = 'git remote add origin https://example.com/team/site.git';
/** C1 on main, pushed to origin, with main tracking origin/main. */
const SHARED_SETUP = [ORIGIN, 'git commit -m "Add homepage"', 'git push -u origin main'];

export const LEVELS: readonly Level[] = [
  {
    title: 'First commits',
    group: 0,
    story: 'A commit is a saved snapshot of your project. Each new commit points back to the one before it, so history forms a chain.',
    goal: 'Make two commits on main.',
    hint: 'git commit -m "Add homepage"   then   git commit',
    setup: [],
    check: (r) => !!r.state.branches.main && r.reach(r.state.branches.main).size >= 3,
  },
  {
    title: 'Branch out',
    group: 0,
    story: 'A branch is just a movable label pointing at a commit. Making one is instant and copies nothing.',
    goal: 'Create a branch called feature and switch onto it.',
    hint: 'git switch -c feature   (or git branch feature, then git switch feature)',
    setup: ['git commit -m "Add homepage"'],
    check: (r) => r.currentBranch === 'feature',
  },
  {
    title: 'Parallel work',
    group: 0,
    story: 'Once two branches each get their own commits, history splits into two lines. This is how teammates work side by side without stepping on each other.',
    goal: 'Make a commit on a new branch called bugfix, then switch back to main and make a commit there too.',
    hint: 'git switch -c bugfix, git commit, git switch main, git commit',
    setup: ['git commit -m "Add homepage"'],
    check: (r) => {
      const b = r.state.branches.bugfix;
      const m = r.state.branches.main;
      return !!(b && m) && !r.isAncestor(b, m) && !r.isAncestor(m, b);
    },
  },
  {
    title: 'Merge it back',
    group: 1,
    story: 'main and feature have both moved on since they split at C1. Merging joins them with a merge commit that has two parents.',
    goal: 'You are on main. Merge feature into it.',
    hint: 'git merge feature',
    setup: DIVERGED_SETUP,
    check: (r) => {
      const m = tip(r, 'main');
      const f = r.state.branches.feature;
      return !!(m && f) && m.parents.length === 2 && r.isAncestor(f, m.id);
    },
  },
  {
    title: 'Fast-forward',
    group: 1,
    story: 'When your branch has nothing new of its own, Git does not need a merge commit. It just slides the label forward.',
    goal: 'Bring main up to hotfix without creating a merge commit.',
    hint: 'git merge hotfix',
    setup: ['git commit -m "Add homepage"', 'git switch -c hotfix', 'git commit -m "Patch login bug"', 'git switch main'],
    check: (r) => !!r.state.branches.hotfix && r.state.branches.main === r.state.branches.hotfix,
  },
  {
    title: 'Rebase',
    group: 1,
    story: "Rebase replays your branch's commits on top of another branch, giving a straight line of history instead of a merge.",
    goal: 'You are on feature. Rebase it onto main so history is one straight line.',
    hint: 'git rebase main',
    setup: [...DIVERGED_SETUP, 'git switch feature'],
    check: (r) => {
      const f = r.state.branches.feature;
      const m = r.state.branches.main;
      return !!(f && m) && r.isAncestor(m, f) && [...r.reach(f)].every((id) => r.getCommit(id).parents.length < 2);
    },
  },
  {
    title: 'Detached HEAD',
    group: 2,
    story: 'HEAD marks where you are. Usually it points to a branch, but you can point it at a commit directly to look at old work.',
    goal: 'Check out commit C1 directly, then create a branch called old-idea right there.',
    hint: 'git checkout C1   then   git switch -c old-idea',
    setup: ['git commit -m "Add homepage"', 'git commit -m "Add blog"', 'git commit -m "Redesign nav"'],
    check: (r) => r.state.branches['old-idea'] === 'C1',
  },
  {
    title: 'Reset',
    group: 3,
    story: 'C3 deleted the config file by mistake. Nobody else has pulled it yet, so you can safely rewind main.',
    goal: 'Move main back to C2.',
    hint: 'git reset --hard HEAD~1   (HEAD~1 means one commit before HEAD)',
    setup: ['git commit -m "Add homepage"', 'git commit -m "Add contact form"', 'git commit -m "Oops: delete config"'],
    check: (r) => r.state.branches.main === 'C2',
  },
  {
    title: 'Revert',
    group: 3,
    story: 'C2 added a broken widget, but main is shared with your team. Rewriting shared history causes trouble, so undo it with a new commit instead.',
    goal: 'Undo C2 without removing any commits from main.',
    hint: 'git revert C2',
    setup: ['git commit -m "Add homepage"', 'git commit -m "Add broken widget"', 'git commit -m "Write about page"'],
    check: (r) => {
      const m = tip(r, 'main');
      return !!m && m.revertOf === 'C2' && r.isAncestor('C3', m.id);
    },
  },
  {
    title: 'Cherry-pick',
    group: 3,
    story: 'feature has a typo fix (C3) mixed in with unfinished dark mode work. You need just the fix on main today.',
    goal: 'Copy only C3 onto main.',
    hint: 'git cherry-pick C3',
    setup: [
      'git commit -m "Add homepage"',
      'git switch -c feature',
      'git commit -m "Start dark mode"',
      'git commit -m "Fix typo in header"',
      'git commit -m "More dark mode"',
      'git switch main',
    ],
    check: (r) => {
      const m = tip(r, 'main');
      return !!m && m.copyOf === 'C3' && m.parents[0] === 'C1';
    },
  },
  {
    title: 'Find a lost commit',
    group: 3,
    story:
      'A minute ago you ran git reset --hard HEAD~2 and threw away your search work, C2 and C3. No branch points at them now, but the reflog remembers every commit HEAD has visited.',
    goal: 'Put a branch called search on the commit main pointed at before the reset.',
    hint: 'git reflog   then   git branch search C3   (git branch search HEAD@{1} works too)',
    setup: ['git commit -m "Add homepage"', 'git commit -m "Add search"', 'git commit -m "Add search filters"', 'git reset --hard HEAD~2'],
    check: (r) => r.state.branches.search === 'C3',
  },
  {
    title: 'Tag a release',
    group: 4,
    story: 'A tag is a label for one exact commit, usually a release. Unlike a branch it never moves, so v1.0 always means the same snapshot.',
    goal: 'Tag the commit you are on as v1.0, then make one more commit. v1.0 should stay behind on C2.',
    hint: 'git tag v1.0   then   git commit',
    setup: ['git commit -m "Add homepage"', 'git commit -m "Add pricing page"'],
    check: (r) => {
      const m = r.state.branches.main;
      return r.state.tags['v1.0'] === 'C2' && !!m && m !== 'C2' && r.isAncestor('C2', m);
    },
  },
  {
    title: 'Push your work',
    group: 4,
    story:
      "origin is the shared copy of the repository on a server. The dashed origin/main label shows where origin's main was the last time you talked to it. Your two newest commits exist only on your machine.",
    goal: 'Send your new commits to origin.',
    hint: 'git push',
    setup: [...SHARED_SETUP, 'git commit -m "Add about page"', 'git commit -m "Add contact page"'],
    check: (r) => {
      const m = r.state.branches.main;
      return !!m && r.state.remote?.branches.main === m && r.isAncestor('C3', m);
    },
  },
  {
    title: 'Pull',
    group: 4,
    story:
      'While you were away, a teammate pushed two commits to origin. Your repository does not know yet. git fetch downloads them and moves origin/main; git pull fetches and then merges, in one step.',
    goal: "Bring your teammate's commits into your main.",
    hint: 'git pull   (or git fetch, then git merge origin/main)',
    setup: [...SHARED_SETUP, 'teammate', 'teammate'],
    check: (r) => {
      const theirs = r.state.remote?.branches.main;
      const m = r.state.branches.main;
      return !!(theirs && m && r.state.commits[theirs]) && r.isAncestor(theirs, m);
    },
  },
  {
    title: 'Rejected push',
    group: 4,
    story:
      'You and a teammate both committed to main. If you push now, origin refuses, because taking your main would drop their commit. Bring their work in first, then push.',
    goal: "Get your commit C3 onto origin's main without losing your teammate's C2.",
    hint: 'git pull --rebase   then   git push   (plain git pull works too, with a merge commit)',
    setup: [...SHARED_SETUP, 'teammate', 'git commit -m "Add newsletter form"'],
    check: (r) => {
      const remote = r.state.remote;
      const theirs = remote?.branches.main;
      if (!remote || !theirs) return false;
      const onOrigin = reachIn(remote.commits, [theirs]);
      return onOrigin.has('C2') && [...onOrigin].some((id) => id === 'C3' || remote.commits[id].copyOf === 'C3');
    },
  },
  {
    title: 'Publish a branch',
    group: 4,
    story:
      'A new branch lives only on your machine until you push it. The first push needs -u, which also links your branch to its copy on origin so later pushes and pulls know where to go.',
    goal: 'Push the search branch to origin and set it to track origin/search.',
    hint: 'git push -u origin search',
    setup: [...SHARED_SETUP, 'git switch -c search', 'git commit -m "Add search box"'],
    check: (r) => {
      const s = r.state.branches.search;
      return !!s && r.state.remote?.branches.search === s && r.state.upstream.search === 'origin/search';
    },
  },
  {
    title: 'Sandbox',
    group: -1,
    story: 'No goals here. Try merges, rebases and resets and watch what each one does. origin is connected, and typing teammate makes a teammate push a commit to it.',
    goal: 'Experiment freely. Restart wipes the repository back to a single commit.',
    setup: [ORIGIN, 'git push -u origin main'],
  },
];

/** Number of levels with a goal (everything except the sandbox). */
export const GOAL_COUNT = LEVELS.filter((l) => l.check).length;
export const SANDBOX_INDEX = LEVELS.length - 1;
