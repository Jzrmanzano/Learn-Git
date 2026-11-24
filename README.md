# LearnGit

A free, in-browser Git trainer. Students type real Git commands and a live commit graph redraws after each one, with a short note explaining what happened. Sixteen guided levels, from first commits to push and pull, plus a sandbox. Light and dark themes.

Built with **Vite + TypeScript** (no framework). Static output, no server or database.

## Getting started

```bash
npm install
npm run dev       # local dev server with hot reload
npm test          # solves every level and checks error cases
npm run build     # type-check (tsc) + production build into dist/
npm run preview   # serve the built dist/ locally
```

## Project structure

```
index.html            Landing page
learn.html            Trainer
cheatsheet.html       Key ideas, merge vs rebase, reset vs revert, fetch vs pull, command reference
public/favicon.svg    Logo / favicon (copied as-is)
src/
  sim.ts              Git simulator: commits, branches, tags, HEAD, reflog, one remote (no DOM)
  levels.ts           The 16 levels + sandbox: group, setup, story, goal, hint, check()
  learn.ts            Trainer UI: terminal, lesson, route strip of levels, routing
  home.ts             Landing page: live demo repository, progress marks on the route
  cheatsheet.ts       Cheat sheet diagrams
  progress.ts         Saved progress (localStorage), shared by trainer and landing page
  theme.ts            Light / dark toggle; follows the system until someone picks
  graph/render.ts     Shared SVG drawing (lines, stations, branch / remote / tag labels)
  graph/live.ts       Lays out a live Repo for the trainer
  graph/static.ts     Lays out fixed illustration graphs, fitted to their box
  styles.css          Shared theme, nav, buttons, footer
  home.css, cheatsheet.css, trainer.css   Page styles
scripts/check-levels.ts   Level and error-case checks (npm test)
```

## Linking to a level

`learn.html#level-1` … `learn.html#level-16`, and `learn.html#sandbox`. Progress is stored per browser in `localStorage`.

## Adding or editing a level

Add an entry to `LEVELS` in `src/levels.ts`:

```ts
{
  title: 'Branch out',
  group: 0,                                      // index into GROUPS; also its line colour
  story: 'A branch is just a movable label…',
  goal: 'Create a branch called feature and switch onto it.',
  hint: 'git switch -c feature',
  setup: ['git commit -m "Add homepage"'],      // run silently from C0 on main
  check: (r) => r.currentBranch === 'feature',  // true when the goal is met
}
```

Setup commands can include `teammate` to put a commit on origin that the student has not fetched yet. Add new levels at the end, so existing `#level-N` links and saved progress keep pointing at the same level. Then add its solution to `scripts/check-levels.ts` and run `npm test`.

## Deploy to Vercel

1. Push this folder to a GitHub repository.
2. In Vercel: **Add New → Project**, import the repo. Vercel detects Vite automatically (build `npm run build`, output `dist`).
3. Deploy.

`vercel.json` enables clean URLs (`/learn` instead of `/learn.html`). The `dist/` folder also works on GitHub Pages or any static host.

## Limits

The simulator tracks commits, branches, tags and one simulated remote (`origin`), with the `teammate` command standing in for other people's pushes. It has no file contents, so there is no staging, stash or merge conflicts; `git add`, `stash`, `diff` and `restore` explain this instead of failing. Interactive rebase is not simulated.
