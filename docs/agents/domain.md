# Domain Docs

How the engineering skills consume this repo's domain documentation. Layout: **single-context**.

## Before exploring, read these

- **`docs/GLOSSARY.md`**: the project glossary (this repo keeps it under `docs/`, not at the root).
- **`docs/adr/`**: ADRs that touch the area you're about to work in (none exist yet).
- **`CLAUDE.md`** and the matching `.claude/rules/*.md` file: invariants that bind any proposal.

If `docs/adr/` doesn't exist, **proceed silently**. Don't flag its absence or suggest creating it upfront. The `/domain-modeling` skill creates ADRs lazily when a decision actually gets resolved; new glossary terms go into `docs/GLOSSARY.md`.

## File structure

```
/
├── CLAUDE.md
├── docs/
│   ├── GLOSSARY.md
│   └── adr/            ← created on first ADR
│       └── 0001-<slug>.md
└── src/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as `docs/GLOSSARY.md` defines it (`CLAUDE.md`, "One concept, one name"). Don't drift to synonyms the glossary avoids.

If the concept isn't in the glossary yet, either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR and invariant conflicts

If your output contradicts an existing ADR or a `CLAUDE.md` / `.claude/rules/` invariant, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (…), but worth reopening because…_
