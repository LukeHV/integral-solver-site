# Handoff: restyle, review and keep publishing the Integral Solver

You are taking over the **Integral Solver**, a step-by-step integration website.

- **Project folder (edit here):** `/Users/luke_vos/Mathematics Apps/integral solver`, a git repo on `main` that pushes to the private repo `LukeHV/integral-solver`.
- **Live site:** https://lukehv.github.io/integral-solver-site/ (public repo `LukeHV/integral-solver-site`).
- **Sister site (read-only reference):** `/Users/luke_vos/Mathematics Apps/Derivative Solver`.

## Hard rule: never change the Derivative Solver

You may read anything in `/Users/luke_vos/Mathematics Apps/Derivative Solver`. You must never edit, create, move, delete, commit, push or publish anything there. That includes its `upload/` and `scripts/` folders.

Before any other work, add deny rules to `.claude/settings.json` in the Integral Solver project so the harness enforces this:
- `Edit(/Users/luke_vos/Mathematics Apps/Derivative Solver/**)`
- `Write(/Users/luke_vos/Mathematics Apps/Derivative Solver/**)`
- `Bash(* /Users/luke_vos/Mathematics Apps/Derivative Solver*)`

Pass this rule word for word to every agent you start. If any step seems to need a change there, stop and ask me.

## B) Follow the math-tool-builder skill throughout

Load the `math-tool-builder` skill first and keep to it for every step: planning, theming, review, fixes and publishing.
- Read `SKILL.md`, `references/pitfalls.md`, `references/quality-bar.md`, `references/symbolic-solver.md` and `references/publishing.md`. These are recently updated, so trust them over your memory.
- Use its review rubric and non-negotiables as the standard: every category 5/5, textbook-style working, self-checks, vendored KaTeX, specific class names, and testing at 1440, 768 and 390 px in light and dark mode.
- Commit after each significant change (my global rule).

## A) Bring the Integral Solver's look in line with the Derivative Solver

Study the Derivative Solver's `index.html`, `style.css` and `js/app.js` (read only). Make the Integral Solver feel like part of the same family.

**Match these:**
- Colour tokens, light and dark
- Type and fonts
- Card, button, chip, keypad and tab styling
- Header and brand mark style
- Spacing and radii
- Graph styling
- Layout of the working panel

**Keep these from the Integral Solver:**
- Its own single accent colour, so the two sites stay easy to tell apart. If the Derivative Solver already uses the Integral Solver's blue, give the Integral Solver a distinct accent and tell me.
- Its own favicon mark (∫).
- All of its features and behaviour.

Copy styles by writing them into the Integral Solver's own files; never link to files in the other folder. Re-run `test.html` afterwards: every case must still verify. Then check all three widths in both themes with the browser pane, and commit.

## C) Review and fix loop: a Sonnet reviewer, an Opus fixer

Define two agents as files in the Integral Solver project.

**`.claude/agents/integral-reviewer.md`**
- `model: sonnet`
- Tools: read-only only (`Read`, `Grep`, `Glob`, read-only `Bash` such as `git log`/`git diff`/`ls`, and the browser-pane tools to load and inspect the site). No `Edit`, `Write` or `NotebookEdit`.
- Job: review the Integral Solver meticulously against the math-tool-builder skill. Cover:
  - maths correctness: run `test.html`, hand-check samples, try hard and odd inputs, definite and improper cases
  - bugs and glitches in the UI, layout, keyboard use, accessibility and mobile
  - wording
  - performance
  - areas to improve even where nothing is broken
- Output: a numbered report. For each finding give severity (bug / glitch / improvement), exact file and line or how to reproduce it, expected vs actual, and a suggested direction.
- Its prompt must say, in capitals: **YOU MUST NOT FIX, EDIT OR WRITE ANYTHING, UNDER ANY CIRCUMSTANCES. Report only; fixes are handed to the Opus fixer.**

**`.claude/agents/integral-fixer.md`**
- `model: opus`
- Edit tools allowed in the Integral Solver folder only.
- Job: take the reviewer's findings and fix them one at a time, following the math-tool-builder skill. After each batch, re-run `test.html` and check the affected screens, then commit with a clear message.
- It must obey the Derivative Solver rule above.

**Running the loop:** start the reviewer, then pass its report to the fixer. Then run the reviewer again on the fixed version. Repeat until the reviewer reports no bugs or glitches and only minor improvements remain, with at most 3 rounds. Keep a short log of what was found and fixed in `REVIEW-LOG.md`.

## D) A publisher agent that ships every change

Define **`.claude/agents/integral-publisher.md`**:
- `model: haiku`. It's a mechanical job, so use the cheapest model that can do it.
- Tools: `Bash` and `Read` only.
- Job: from the Integral Solver folder, run
  ```bash
  bash ~/.claude/skills/publish-site/scripts/publish.sh "/Users/luke_vos/Mathematics Apps/integral solver" "/Users/luke_vos/Mathematics Apps/integral solver" "integral-solver"
  ```
- Then wait until `https://lukehv.github.io/integral-solver-site/` returns 200 with the new content (check `gh api repos/LukeHV/integral-solver-site/pages/builds/latest --jq .status`). Report the result in one line.
- It must never touch any other folder or repo, and never publish the Derivative Solver.

Run the publisher **after every committed change**: after the restyle, and after each fixer batch. Never publish with failing tests or uncommitted work.

## Done means

- The restyle is committed and live, matching the Derivative Solver's family look with its own accent.
- The review loop is finished, with `REVIEW-LOG.md` committed.
- The final version is live on GitHub Pages.
- The Derivative Solver folder is untouched. Prove it with `git -C "/Users/luke_vos/Mathematics Apps/Derivative Solver" status`, and by comparing file timestamps from before you started.
- You give me a short summary: what changed in the look, the main findings and fixes, anything left as a suggestion, and the live link.
