# Output Template — Rotation Report

Structure every rotation report like this. Keep prose tight; the checklist is
the deliverable as much as the rotation is.

---

## [Character] — [Mode, if applicable] — Rotation (S[N], Lv[N])

### The rotation

| # | Ability (key) | Phase | Why here |
|---|---|---|---|
| 1 | Intro (`intro`) | Opener | Swap-in hit, starts Concerto |
| 2 | … (`key`) | Build / Burst / Filler | one short clause |

*(Phases: Opener / Build / Burst / Filler. Auto-inserted follow-ups marked ⚡.)*

### Why this order works
Two to four sentences: the damage engine, what gates it, and how the ordering
satisfies the gates and lands payoffs inside buff windows.

### Buff & window map
For each conditional effect that fires: `[effect] — opens at step N ([trigger]),
covers steps N+1..M ([window])`. One line each.

### Enablers & conditionals checklist
**Self (rotation)** — satisfied by the ordering above; list the key ones.
**Build** — mode selection, sequence-level dependencies, stat thresholds
(ER breakpoint assumption stated here).
**Team** — amplify types wanted, mechanic partners, outro/intro handoffs.
**Player (manual)** — asserted triggers (e.g. Tune Break at step N), uptime
discipline.

### Trigger coverage
✅ fired: [list with step numbers] · ⏸ intentionally unfired: [list + why] ·
⚠ unresolved in data: [list — flag for the data-quality pass]

### Tips & tricks
Three to six practical, kit-specific tips (window timing, stack upkeep,
sequence upgrades that change the play pattern).

### Caveats
The standing assumptions: Liberation-charged assumption, single enemy,
"strong default, not frame-perfect", any ⚠ items.

### Structured output (if requested)
The JSON block per the game module.
