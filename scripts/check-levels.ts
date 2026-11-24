// Solves every level with its intended commands and runs error and behaviour checks.
// Run with: npm test
import { complete } from '../src/complete';
import { GOAL_COUNT, LEVELS } from '../src/levels';
import { Repo } from '../src/sim';

const solutions: string[][] = [
  ['git commit -m "a"', 'git commit'],
  ['git switch -c feature'],
  ['git switch -c bugfix', 'git commit', 'git switch main', 'git commit'],
  ['git merge feature'],
  ['git merge hotfix'],
  ['git rebase main'],
  ['git checkout C1', 'git switch -c old-idea'],
  ['git reset --hard HEAD~1'],
  ['git revert C2'],
  ['git cherry-pick C3'],
  ['git reflog', 'git branch search HEAD@{1}'],
  ['git tag v1.0', 'git commit'],
  ['git push'],
  ['git pull'],
  ['git pull --rebase', 'git push'],
  ['git push -u origin search'],
];

/** Other ways a student might solve a level: [level number, commands]. */
const alternatives: [number, string[]][] = [
  [11, ['git branch search C3']],
  [14, ['git fetch', 'git merge origin/main']],
  [15, ['git pull', 'git push']],
  [15, ['git fetch', 'git rebase origin/main', 'git push']],
  [16, ['git push origin search', 'git branch -u origin/search']],
];

const failures: string[] = [];
const expect = (ok: boolean, label: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failures.push(label);
};

expect(solutions.length === GOAL_COUNT, `every one of the ${GOAL_COUNT} levels has a solution`);

const play = (n: number, cmds: string[]) => {
  const r = new Repo();
  r.load(LEVELS[n - 1].setup);
  for (const c of cmds) r.exec(c);
  return r;
};

solutions.forEach((cmds, i) => {
  const level = LEVELS[i];
  expect(!level.check?.(play(i + 1, [])), `level ${i + 1} (${level.title}) is not already solved`);
  expect(!!level.check?.(play(i + 1, cmds)), `level ${i + 1} (${level.title}) solved by: ${cmds.join(' ; ')}`);
});
for (const [n, cmds] of alternatives) {
  expect(!!LEVELS[n - 1].check?.(play(n, cmds)), `level ${n} (${LEVELS[n - 1].title}) also solved by: ${cmds.join(' ; ')}`);
}

const errorOf = (r: Repo, cmd: string) => r.exec(cmd).find((l) => l.kind === 'err')?.text ?? '';
const noteOf = (r: Repo, cmd: string) => r.exec(cmd).find((l) => l.kind === 'note')?.text ?? '';

// Basics and refs
let r = new Repo();
expect(errorOf(r, 'git constructor').includes('not supported'), 'prototype names are not commands');
expect(errorOf(r, 'git checkout nope').includes('unknown revision'), 'unknown ref is rejected');
expect(errorOf(r, 'git reset HEAD~9').includes('past the first commit'), 'HEAD~n past the root is rejected');
expect(errorOf(r, 'git branch C5').includes('looks like a commit ID'), 'branch names that look like IDs are rejected');
r.exec("git commit -m 'single quoted'");
expect(r.getCommit(r.headId).msg === 'single quoted', 'single-quoted messages work');
r.exec('git branch x');
expect(errorOf(r, 'git branch -d main').includes('while you are on it'), 'cannot delete the current branch');
r.exec('git rebase x');
expect(r.headId === 'C1', 'rebase onto the same commit changes nothing');
r.exec('git undo');
r.exec('undo');
expect(r.state.branches.x === undefined, 'undo removes the branch');

// File commands explain themselves instead of failing
r = new Repo();
expect(!errorOf(r, 'git add .') && noteOf(r, 'git add .').includes('nothing to stage'), 'git add explains there are no files');
expect(noteOf(r, 'git stash').includes('nothing to stash'), 'git stash explains there are no files');

// Branch management
r = new Repo();
r.exec('git commit');
r.exec('git switch -c feature');
r.exec('git switch main');
r.exec('git switch -');
expect(r.currentBranch === 'feature', 'git switch - returns to the previous branch');
r.exec('git branch -m search');
expect(r.currentBranch === 'search' && !r.state.branches.feature, 'git branch -m renames the current branch');
r.exec('git switch main');
r.exec('git branch -f search C0');
expect(r.state.branches.search === 'C0', 'git branch -f moves a branch label');
expect(errorOf(r, 'git branch -f main C0').includes('current branch'), 'git branch -f refuses to move the current branch');

// Tags, show, log and merge-base
r = new Repo();
r.exec('git commit -m "One"');
r.exec('git tag v1.0');
r.exec('git commit -m "Two"');
expect(r.state.tags['v1.0'] === 'C1' && r.headId === 'C2', 'a tag stays put when you commit');
r.exec('git checkout v1.0');
expect(r.state.head.kind === 'detached' && r.headId === 'C1', 'checking out a tag detaches HEAD');
expect(r.exec('git show C2').some((l) => l.text.includes('tag') === false && l.text.startsWith('commit C2')), 'git show prints the commit');
r.exec('git switch main');
r.exec('git switch -c side C1');
r.exec('git commit -m "Side"');
expect(r.exec('git merge-base main side')[0]?.text === 'C1', 'merge-base finds where two branches split');
expect(r.exec('git log main..side').filter((l) => l.kind === 'out').length === 1, 'log A..B lists only commits B has and A lacks');

// Reflog
r = new Repo();
r.exec('git commit');
r.exec('git commit');
r.exec('git reset --hard C0');
r.exec('git reset --hard HEAD@{1}');
expect(r.headId === 'C2', 'HEAD@{1} resolves through the reflog');

// Remotes
r = new Repo();
expect(errorOf(r, 'git push').includes('no configured push destination'), 'push without a remote explains how to add one');
r.exec('git remote add origin https://example.com/x.git');
r.exec('git commit');
expect(errorOf(r, 'git push').includes('no upstream'), 'first push without -u explains -u');
r.exec('git push -u origin main');
expect(r.state.tracking['origin/main'] === 'C1' && r.state.upstream.main === 'origin/main', 'push -u sets origin/main and the upstream');
r.exec('teammate');
expect(r.remoteView()?.unseen === 1 && !r.state.commits.C2, 'a teammate commit stays on origin until you fetch');
r.exec('git fetch');
expect(r.state.tracking['origin/main'] === 'C2' && r.state.branches.main === 'C1', 'fetch moves origin/main but not main');
expect(r.exec('git status').some((l) => l.text.includes('behind')), 'status reports being behind origin/main');
r.exec('git commit');
expect(errorOf(r, 'git push').includes('rejected'), 'pushing a diverged branch is rejected');
const forced = play(15, ['git push --force']);
expect(!LEVELS[14].check?.(forced), 'force-pushing over a teammate does not solve "Rejected push"');
r = play(16, []);
r.exec('git push -u origin search');
r.exec('git switch main');
r.exec('git branch -D search');
r.exec('git switch search');
expect(r.currentBranch === 'search' && r.state.upstream.search === 'origin/search', 'switching to a remote-only branch creates a tracking branch');
r.exec('git push origin --delete search');
expect(!r.state.remote?.branches.search && !r.state.tracking['origin/search'], 'push --delete removes the remote branch');

// Tab completion
r = play(16, ['git tag v1.0 C1']); // main, search (current), origin/main, tag v1.0, commits C0–C2
const tab = (line: string) => complete(line, line.length, r);
const completesTo = (line: string, want: string) => expect(tab(line)?.value === want, `Tab: "${line}" completes to "${want}" (got "${tab(line)?.value}")`);
completesTo('gi', 'git ');
completesTo('git sw', 'git switch ');
completesTo('git switch ma', 'git switch main ');
completesTo('git cherry-pick c1', 'git cherry-pick C1 ');
completesTo('git push ', 'git push origin ');
completesTo('git push origin se', 'git push origin search ');
completesTo('git reset --h', 'git reset --hard ');
completesTo('git checkout v', 'git checkout v1.0 ');
completesTo('git merge origin', 'git merge origin/main ');
completesTo('teammate m', 'teammate main ');
const many = tab('git s');
expect(!!many && many.value === 'git s' && ['show', 'status', 'switch'].every((o) => many.options.includes(o)), 'Tab: an ambiguous word lists its matches');
expect(tab('git commit -m "Add ') === null, 'Tab: nothing is completed inside a quoted message');
expect(tab('git switch -c ')?.options.length === 0, 'Tab: no suggestions for a new branch name');
const mid = complete('git merge ma --no-ff', 'git merge ma'.length, r);
expect(mid?.value === 'git merge main --no-ff' && mid.caret === 'git merge main '.length, 'Tab: completes in the middle of a line');

if (failures.length) throw new Error(`${failures.length} check(s) failed`);
console.log('\nAll checks passed.');
