# Timeline-aware team-buff application — plan

**Status:** Increments 1+2 SHIPPED (2026-07-15). Increment 1: the two
already-windowed sources (sonata window-path team buffs + echo shield auras)
apply to teammates by literal team-time overlap via `team-sim.js`'s
`teamBuffTimeline` → `simulateRotation`'s `externalBuffWindows`; their flat
paths (`sonataTeamWideContribution`, `echoAmplifyBundle`) are REMOVED.
Increment 2: source 1 (chain/inherent kit effects) — the 11/16 roster effects
with a resolvable castMatch trigger + seconds window now derive REAL windows
from team-time cast events (`teamWideWindowSpecs` + `accrueChainEffectWindows`);
the 5-effect residue stays honestly flat (see the table). Source 2
(weapon/sonata conditional clauses) remains flat — the open remainder.

**Implementation deviation from the Phase-2 sketch (deliberate):** instead of
per-interval `resolveTotalStats` re-resolution, received windows are injected
into the receiving member's sim as EXTERNAL BUFF WINDOWS and applied by the
SAME `applyBuffsToSteps` path (per-step multiplicative scaling) that already
applies the wielder's own sonata windows — one tested mechanism, one
approximation family (atk ≈ flat multiplier, documented; amplify is exact as
its own multiplicative layer). Simplest code that achieves timing-awareness;
per-interval stat re-resolution remains a possible fidelity upgrade if the
atk-dilution approximation ever matters.

**Maintainer direction (2026-07-15):** timing model = **literal team-time
overlap**. Priorities are honesty + transparency. The sequential-sim timing
artifact (openers inflate support segments, so buffs may expire before the
opener-inflated carry burst) is accepted as an honest under-credit for now;
realistic timing is deferred to the upcoming real-cast-time data extraction +
a rotation-inference agent. So: **no timing corrections — credit only the real
overlap.**

---

## Problem

Two inconsistent representations of a team-wide buff exist today:

- **DISPLAY** (now correct): duration-accurate windows — e.g. Rejuvenating
  Glow live 1.7→32.1s and 49.9→79.9s (persists past the wielder's switch for
  its real 30s life); the Bell-Borne echo aura in three 15s slices.
- **DAMAGE** (still approximate): one FLAT bundle (`amplifyAll` / atkRatio /
  dmgBonus / crit) applied to EVERY member's ENTIRE rotation, timing-independent
  (`team-sim.js externalTeamBuffs` + `echoAmplifyBundle`).

A member is therefore credited a buff even for the steps of their rotation where
it is not live. Timeline-aware application makes DAMAGE read the SAME windows the
DISPLAY shows.

## Foundation already in place

The persist-past-switch fix (`buildStackedBuffWindows`) means team-buff windows
genuinely overlap later members for their real duration — so this is not
all-or-nothing. There is real, measurable overlap to credit (e.g. Rejuvenating
Glow's second window covers ~11s of Hiyuki's 19s rotation).

---

## Phase 1 — Unified team-buff timeline

Build `teamBuffTimeline: [{ start, end, bundle, sourceLabel, sourceMemberId }]`
in TEAM time — one entry per live team-wide buff window, `bundle` in the
`mergeTeamBundles` shape (atkRatio / dmgByElement / dmgBySkillType /
amplify\* / crit). Sources:

| # | Source | Function | Status |
| --- | --- | --- | --- |
| 3 | Sonata window-path (ATK% / element% / skill-type%) | `computeBuffWindows` (wielder's own sim) | **SHIPPED 2026-07-15** — on the timeline via `accrueSegmentBuffWindows`; flat `sonataTeamWideContribution` deleted |
| echo | Echo shield/aura DMG-Boost | synthetic `'amplify'` window in `computeBuffWindows` | **SHIPPED 2026-07-15** — same path; flat `echoAmplifyBundle` deleted |
| 1 | Chain/inherent kit effects | `teamWideContribution` (flat residue) + `teamWideWindowSpecs` (windowed) | **SHIPPED 2026-07-15 (Increment 2)** — 11/16 roster effects with a resolvable castMatch trigger + seconds window derive REAL windows from team-time CAST EVENTS (`accrueChainEffectWindows`, all three segment kinds — intro/outro casts live in auto-injected segments, so `effectWindows` was NOT usable). The 5-effect flat residue (documented in `isWindowableTeamEffect`): Shorekeeper S2 (unconditional always-on — genuinely timing-independent), Sanhua/Baizhi/Yangyang S6 (unresolved triggers — no honest timing derivable), Mornye S2 (critDmg — inexpressible post-hoc) |
| 2 | Weapon/sonata CONDITIONAL (crit / amplify / defIgnore / atk) | `weaponSonataTeamWide` (`extractConditionalContribution`) | **OPEN** — still flat. Text-parsed clauses with no structured trigger/window; the crit/defIgnore buckets are ALSO inexpressible in the post-hoc window path (they change the crit mix / enemy DEF term, not a damage multiplier) — windowing these needs per-hit crit decomposition or per-interval stat re-resolution |

Per-step **stacks** matter: a stacking buff's bundle scales with the stack level
at each sub-interval, so timeline entries carry the stack-scaled bundle (the
window-path source already has per-step samples to read this from).

## Phase 2 — Per-interval application in the sim

**SHIPPED 2026-07-15, as window-injection (see the deviation note at top):**
`team-sim.js` keeps a chronological `teamBuffTimeline` (constant-stack runs,
accrued per segment right after it simulates — accumulation order equals
simulation order, so "already on the timeline" is exactly "started before this
segment plays"); each later segment receives the overlapping runs as
`simulateRotation`'s `externalBuffWindows` (segment-local time, same-source
entries skipped — the wielder's own copy applies natively in their own sim).
`applyBuffsToSteps` scales the receiving steps per-step (new multiplicative
`'amplify'` kind for echo auras; atk/element as before), and the received
buffs appear in `step.activeBuffNames` as "`+15% ATK · Chisa`".

~~The original per-interval `resolveTotalStats` sketch~~ — not needed for the
windowed sources; revisit only if the atk-dilution fidelity gap ever matters.

## Phase 3 — Single source of truth

**SHIPPED for the windowed sources:** display (`memberStackedBuffWindows`) and
the timeline are built from the SAME per-segment extraction
(`stackedWindowsForSegment`) — they cannot disagree. The flat
`sonataTeamWideContribution` / `echoAmplifyBundle` paths are deleted. Sources
1/2 still flow through the remaining flat `externalTeamBuffs` (and have no
display windows) — dissolves when their window derivation lands.

## Phase 4 — Validation & migration

**Increment-1 results (2026-07-15):** full suite 0 failures; meta regenerated;
covered-6 solo builds AND damage unchanged (0 diffs); **Chisa keeps
Kumokiri / Rejuvenating Glow** (she plays slot 0 in her curated/context teams,
so her windows genuinely cover the teammates); curated Chisa team healthy
(6.86M). Verified overlap on the live team: Lucilla (plays 56–68s) receives
both Chisa buffs; Hiyuki gets +15% ATK for 15/21 steps (until its real 79.9s
expiry — her last casts honestly unbuffed); the echo window (ends 58.7s) never
reaches her. Team damage 0.77M → 0.747M — the honest correction.

**Increment-2 results (2026-07-15, source 1):** full suite 0 failures; meta
regenerated; covered-6 solo 0 diffs; Chisa canary unchanged (Kumokiri/Glow,
6.86M curated team). Live probe: Mortefi S6 (+20% team ATK, liberation-
triggered, 20s) opens at his Liberation and covers a following Carlotta for
13/14 steps — her last step honestly expired. Changli S4 (intro-triggered) now
correctly grants NOTHING when she plays slot 0 pass 0 (no intro cast → no
trigger — the flat model used to credit this regardless), and grants the real
30s window when she swaps in.

Shipped alongside (same family): **per-hit dmgType matching in
`applyBuffsToSteps`** — a dmgType window ("+25% Basic Attack DMG") used to
fall into the whole-step flat bonus and over-credit non-matching hits; it now
matches each HIT's formula skillType (the DMG-bonus-bucket invariant). Fixes
Chixia S6's window AND the pre-existing sonata dmgType-window over-credit
(zero covered-6 shifts — none of their sets carry a dmgType window).

**Gap-closing pass (2026-07-15, third increment):**

- ~~**Intro/outro self-credit gap**~~ **CLOSED** — timeline entries whose
  trigger is intro/outro are marked `selfApplicable`: those triggers can NEVER
  fire inside a rotation sim (`withoutAutoCastSteps` strips authored
  intro/outro steps), so letting the wielder receive their own cross-segment
  window cannot double-count — it is their only honest credit path. Changli
  now buffs herself too (verified 11/11 in-window steps).
- **Unresolved triggers, 2 of 3 CURATED** (`data/effect-overrides.json`,
  kit-text-verified): Sanhua S6 → her detonate skillKeys (detonate cast + Ice
  Prism/Glacier burst rows; Ice Thorn excluded — the kit names only
  Prism/Glacier; the "stacking up to 2 times" clause deliberately NOT modeled
  — scaleEffect's maxStacks fallback would flat-credit 2 stacks always, so
  single-stack is the conservative floor); Yangyang S6 → her Feather Release
  key (NOT the plain mid-air attack). Both now windowed AND natively active in
  the wielder's own sim (they never activated for the wielder's own damage
  before at all). **Baizhi S6 stays honestly flat** — "when Euphonia is PICKED
  UP" is a player action, not a cast; curating it to the spawning cast would
  fabricate timing.
- **Incoming-resonator transfer DISPLAY CLOSED** (`incomingDisplayEntries`,
  team-sim.js): the Outro→Intro handoff bundle (Wishes' "+25% Glacio DMG to
  the incoming Resonator") renders as strips in the RECEIVING member's own
  lane (not team-wide), spanning exactly the rotation segment the flat damage
  credit covers, named for the granting member ("Lucilla · Outro transfer
  (flat)"); receiving steps list it ("+25% Glacio DMG · from Lucilla").
  Display-only — shows what the damage model actually credits; transfer-clause
  durations remain unparsed (the disclosed flat v1).

Remaining honest limitations:

- Literal overlap under-credits supports whose buffs expire before the
  opener-inflated carry burst — corrected later by real cast times + the
  rotation-inference agent. Member ORDER matters to team damage (real
  in-game too).
- **Canary for future work:** a curated-team support's team value must not
  collapse to ~0 — that signals a window-DERIVATION bug, not the accepted
  timing under-credit.

## Cost / risk

- Optimizer inner loop ×~(distinct buff-states) ≈ 3–5×. Profile; memoize
  `resolveTotalStats`. `team-rank` already multi-passes; this is a constant
  factor.
- **Trickiest part:** window derivation for sources 1 & 2 (conditional
  triggers). De-risk by shipping incrementally: start with the already-windowed
  sources (3 + echo) + always-on parts of 1/2, verify end-to-end, then add
  conditional-window derivation.

## Sequencing

Phase 1 (timeline builder, per source, incrementally) → Phase 2 (per-interval
application) → Phase 3 (remove flat, unify) → Phase 4 (validate). Each phase is
independently testable; sources within Phase 1 land one at a time behind the
same timeline structure.
