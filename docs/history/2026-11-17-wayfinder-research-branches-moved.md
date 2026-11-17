# 2026-11-17 — Wayfinder: research branches moved into their tickets (#70, #43)

Wayfinder task ticket [Move the 10 research branches into their tickets, then delete them](https://github.com/Philipp-DI/WuWaSim/issues/70), on the roadmap map #43.

## [Files Changed]

- Repo: this file only.
- GitHub: 10 new collapsed findings comments (#44, #45, #46, #47, #48, #49, #58, #60, #64, #65); 12 existing comments edited to link those instead of the branch; the resolution on #70, which is now closed; one Decisions-so-far line on #43.
- Branches: the 10 `research/*` branches are deleted on `origin` and locally (maintainer confirmed).

## [Logic Altered]

None. No code or data changed.

## [Verification Method]

- Each posted comment was read back through the API and diffed against `git show origin/research/<name>:docs/research/<name>.md`. All 10 match apart from the trailing newline that `jq` adds.
- Before deleting, each branch was checked: 1 commit ahead of `main`, touching only its findings file, with the local and remote branches identical.
- An API sweep of every issue comment and body found no other branch references. After `git fetch --prune`, no `research/*` refs remain.

## [Residual Risks]

- `docs/history/2026-11-17-wayfinder-preprocessing-and-research.md:11` still names two of the deleted branches. That file is a record of what happened, so it was left unchanged; the findings are on #64 and #65.

## [Updated Docs]

None needed beyond this file.
