# Rover: one dataset entry per element; gender is cosmetic

The game ships every Rover element twice, male and female, with their own ids and assets but shared damage ids and identical stats. The dataset keeps ONE entry per element, the lower id (1309, 1406, 1501 are the male source, 1604 the female), and treats that id as a key only. Timings come from the female build (maintainer, 2026-07-29), and the damage table is read wherever the game filed it. Gender is cosmetic in-game (maintainer, 2026-10-07), so two entries per element would double the roster without changing any number.

## Consequences

- Saved presets and curated Rover entries depend on the kept ids, so changing which id survives needs a migration.
- A nanoka source directory counts four more characters than the dataset; that is correct, not data loss.
- The mechanics of the gender mirror live in `.claude/rules/invariant-rover.md`.
