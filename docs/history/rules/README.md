# Rule history

`CLAUDE.md` and the files under `.claude/` state current truth only. When a rule
changes, its superseded text, measurements and incident narrative move here
verbatim (nothing is deleted), and the rule keeps a pointer to this folder.

- One file per rules file, named like it (`invariants-damage.md`, …;
  `CLAUDE.md.md` for rows in the root file).
- One `## <exact rule title>` section per rule, newest entry first.
- `tests/instruction-files.test.mjs` checks that every pointer resolves to
  such a section.
