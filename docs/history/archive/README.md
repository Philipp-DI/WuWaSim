# Archive — finished plans, specs and investigations

Moved here unchanged on 2026-11-16 (`docs/history/2026-11-16-docs-restructure.md`).
These record how the project got where it is; they do not describe the current
code. For that read `docs/ARCHITECTURE.md`; for open work see GitHub Issues.
Paths inside these documents still point where the files lived when they were
written (mostly `docs/<NAME>.md`): look for the same name here.

| Document | Date | What it covers |
| --- | --- | --- |
| `HISTORY.md` | frozen 2026-10-05 | The P10→P13 development chronicle (~900 KB; grep it, never read it whole) |
| `OPEN-ITEMS.md` | frozen 2026-11-16 | The backlog before GitHub Issues; items move to an issue when worked on (grep it) |
| `PHASE0-ARCHITECTURE.md` | 2026-06 | The precompute ↔ runtime contract and `wuwa-meta.json` schema behind P11–P13 |
| `PHASE10-BRIEF.md` | 2026-06 | Phase 10 completion brief |
| `PRE-P11-HOUSEKEEPING.md` | 2026-06 | Standalone tasks triaged out of the design audit before P11 |
| `P11-INSTRUCTION-SET.md`, `P11-ADDENDUM.md` | 2026-06 | P11 visualization/UX overhaul and the conditional-effects model revision |
| `PRE-P12-DATA-QUALITY.md` | 2026-06 | Effect classification and trigger audit required before P12 |
| `P12-PREREQ-ENERGY-CHECK.md`, `energy-signal-findings.md` | 2026-06/07 | The energy-signal go/no-go check for P12 and its findings (off-field share, starting energy) |
| `P12-INSTRUCTION-SET.md` | 2026-06 | The stat-weight + breakpoint optimizer (offline precompute) |
| `P13-INSTRUCTION-SET.md` | 2026-06 | Team suggestions, team-level ER, 3-way comparison |
| `RESONANCE-MODE-SPEC.md` | 2026-06 | Resonance Mode and the Tune Break trigger (still cited by code for §2/§4/§5/§7) |
| `TEAM-EFFECT-MODEL.md` | 2026-06-28 | Design of cross-member effects: enemy statuses, team-wide buffs, persistence |
| `AUTO-OPTIMIZER-ENGINE-PLAN.md` | 2026-06-28 | Optimizer engine phases A–E; Phase E is issue #9 |
| `COMBO-ENTRY-CURATION.md` | 2026-07-05 | Undocumented basic-chain entry mechanics; Tier 2 is issue #10 |
| `Status-Report-07-10.md` | 2026-07-10 | Point-in-time audit against P13 |
| `opener-pathology-investigation.md` | 2026-07-11 | Root cause of the 300s+ opener (resolved: CD-aware greedy filler) |
| `cast-time-sensitivity-findings.md` | 2026-07-11 | How sensitive rankings are to cast-time constants |
| `forte-modeling-investigation.md` | 2026-07-11 | Feasibility of Forte-gauge modelling from BinData |
| `TEAM-BUFF-TIMELINE-PLAN.md` | 2026-07-15 | Timeline-aware team-buff application; lane 2 is issue #8 |
| `SIMPLIFICATION-PLAN.md` | 2026-07-17 | Junior-dev onboarding cleanup S1–S5 (complete) |
| ~~`CALIBRATION.md`~~ | 2026-07 | ~~Verifying the damage math against the game~~ — moved to `docs/CALIBRATION.md` (living runbook, #16) |
| `LANE-B-ASSET-EXTRACTION.md` | 2026-07-29 | Extracting real cast/animation times from the game paks |
| `GAUGE-ENGINE-PLAN.md` | 2026-07-31 | The non-energy resource-gauge engine (shipped) |
| `CONFIGDB-RECON.md` | 2026-08-01 | What the game's ConfigDB holds versus what the sim approximated |
| `HANDOVER-dps-gap-harness.md`, `HANDOVER-dps-gap-analysis.md` | 2026-08-08/13 | The DPS gap against the external reference, its harness and decomposition |
| `HANDOVER-multiplierup-scope.md`, `multiplierup-scope-audit.md` | 2026-08-08 | `multiplierUp` scope binding and the silent inflation it fixed (resolved) |
