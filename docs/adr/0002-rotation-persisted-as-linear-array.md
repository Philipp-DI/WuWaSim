# A rotation is persisted only as a linear array of skill keys

`build.rotation` is stored, shared and saved as a plain ordered array of skill keys; the rotation graph is built from it at sim time (`fromLinear()`) and never persisted. The linear form is what a player writes and what share strings and saved builds can carry stably; a persisted graph would have to be migrated every time graph semantics change.

## Consequences

- Skill keys are a published format: renaming a key breaks saved builds and share strings. That is why, for example, 30 resonators keep their main Liberation keyed as bare `liberation` even where a named key would help skill-scope binding (`.claude/rules/invariants-effects.md`).
- Anything that needs structure (grants, stages, prerequisites) is derived at sim time from curated rules, not stored on the rotation.
