# 2026-11-18 — Wayfinder #43: ROADMAP.md format decided (#82)

Grilling ticket [Decide the format of docs/specs/ROADMAP.md](https://github.com/Philipp-DI/WuWaSim/issues/82), resolved with the maintainer, who accepted all six recommended answers.

- **[Files Changed]** This file only. On the tracker: #82 got a resolution comment and was closed; the body of #86 now also asks for one issue per step plus a roadmap tracking issue; the Decisions-so-far list on map #43 got one new line.
- **[Logic Altered]** None (planning only). Decided:
  - The spec opens with a ranked order table: `# | Step | Depends on | Unblocks | Proof kind`.
  - Each step has its own section with six fields: In plain terms, Goal, Depends on, Closes, Proof (zero-diff or number change), Decided in.
  - Issues are linked by full title.
  - The file is the living plan of record. Progress lives in one GitHub issue per step, wired with `blocked_by` edges.
  - A Stand-alone fixes section holds issues that wait on no step; number-changing fixes land between steps.
  - A Not on the roadmap section carries the map's out-of-scope list.
- **[Verification Method]** Re-read the map body after the edit to confirm the new Decisions-so-far line is present. No code changed, so no test run was needed.
- **[Residual Risks]** None.
- **[Updated Docs]** This file.
