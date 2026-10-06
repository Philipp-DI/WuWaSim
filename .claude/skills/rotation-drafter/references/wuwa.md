# Game Module — Wuthering Waves (WuWa Sim)

Facts and tooling for drafting rotations in the WuWa Sim repository
(github.com/Philipp-DI/WuWaSim). Read alongside the pipeline in `SKILL.md`.

## 1. Data sources

| What | Where |
|---|---|
| Compiled dataset | `data/wuwa-data.json` — `resonators[]` (kits, chain, inherents), `autoSkillMap[resonatorId]` (canonical ability keys) |
| Effects & conditionals | `resonanceChain[].effects[]`, `inherentSkills[].effects[]` — each with the trigger×window fields (`trigger`, `window`, `durationSeconds`, `mode`), or legacy `conditionKind`/`structuralTrigger` if §A isn't merged yet |
| Prerequisite rules | `src/core/rotation-rules.js` — `rulesForResonator(id)` (gates: state/resource/form), `stateDefsForResonator(id)` |
| Auto-trigger follow-ups | `src/core/rotation-triggers.js` — `triggersForResonator(id)` (forced inserts) |
| Resonance Modes | `docs/RESONANCE-MODE-SPEC.md` — mode-having roster & `modeMatch` semantics |
| Combat roles | `docs/COMBAT-ROLES-REFERENCE.md` — role tags → payoff class & team coupling |
| Negative statuses | `docs/NEGATIVE-STATUS-REFERENCE.md` — DoT appliers, stack cadences |
| Effect overrides | `data/effect-overrides.json` — corrections; merged output is authoritative |
| Concerto (swap gauge) | `autoSkillMap[id][key].concertoGen` (per-cast raw generation) — cap 100 (`CONCERTO_MAX` in `team-sim.js`); drives the **Opener** genre below, distinct from Resonance Energy |

Ability `key`s come from `autoSkillMap[resonatorId]` — the drafted rotation
must use these verbatim (it is paste-ready into `build.rotation`). Each entry
has `skillType` (node class: `basic`, `heavy`, `skill`, `liberation`,
`forte_basic`, `forte_heavy`, `intro`, `echo`) and `formulaType`; abilities
with `damageIds` deal damage.

## 2. Mode-having resonators (must pick before drafting)

Exactly these four have selectable Resonance Modes (two each):

| Resonator | Modes |
|---|---|
| Aemeath | Tune Rupture · Fusion Burst |
| Lynae | Tune Rupture · Tune Strain |
| Denia | Fusion Burst · Tune Strain |
| Lucilla | Glacio Chafe · Echo |

Mode-gated effects (`modeMatch`) resolve only in their mode. Rotation *keys*
are the same across modes (mode changes effect resolution, not the cast list),
but the *reasoning, tips, and enabler list* differ per mode — so a per-mode
report section is usually warranted.

## 3. The canonical WuWa loop

```
Intro (swap-in hit)
  → Resonance Skill (early: cheap, often opens buffs)
  → Forte build (basics/heavies that charge the Forte gauge)
  → Resonance Liberation (the burst window opener)
  → Forte payoff / empowered casts (inside the burst window)
  → Basic filler (stages in order) / Echo
  → [swap out → Outro fires automatically]
```

Not every kit follows this exactly — Liberation-stance characters (state
replaces their kit), Forte-loop characters, and off-field specialists deviate.
Let the kit's gates and multipliers override the canon, but start from it.

**Outro** is cast by *leaving* the field: a single-character rotation ends
before it; mention it under Team enablers (what this character's outro gives
the next one), not as a rotation step.

### 3a. Two rotation GENRES — ask/confirm which one is wanted if ambiguous

The canonical loop above (Intro → build → burst → payoff → filler) is the
**solo/reference-rotation** genre: a single-character, assume-Liberation-
charged DPS loop, the shape `data/reference-rotations.json` uses (it DOES
include `intro` explicitly as its first step, since nothing strips it there).
This is what P12's stat-priority/solo sims consume.

A team-swap **Opener** is a DIFFERENT genre, maintainer-corrected 2026-07-16
after an initial draft wrongly used the solo shape for it:

- **Goal: fill the Concerto gauge (0→100, `concertoGen`/`CONCERTO_MAX`) as
  fast as possible**, then hand off to the next teammate — not "loop the kit
  once for a clean DPS number."
- **Never include `intro`/`outro` as authored steps.** `team-sim.js`'s
  `AUTO_CAST_SKILL_TYPES`/`withoutAutoCastSteps` strips any manually-placed
  intro/outro from a member's own rotation array and auto-injects the Intro
  segment (with its own damage + stage-entry grants) immediately before the
  authored steps play — so the FIRST authored step may still rely on a
  same-cast Intro grant (e.g. "Intro → Normal Attack casts Basic Stage 2"),
  it just isn't written as its own step.
- **Typically 1–3 repetitions of the character's build-engine loop** (not a
  fixed number — say "repeat until Concerto ≈100" rather than committing to
  an exact loop count unless the per-hit `concertoGen` data actually adds up
  cleanly; note it as approximate if it doesn't, per the Honesty rules — a
  character's Liberation showing `concertoGen: 0` in the data is a plausible
  under-extraction of a flat kit-text grant, not necessarily true in-game).
- **Resonance Liberation is very often the LAST cast**, immediately before
  the swap — not "burst it mid-sequence, then keep playing a payoff chain
  after it." **But a gauge-gated payoff/finisher chain that is ALSO a strong
  ENERGY (or Concerto) generator belongs BEFORE Liberation, fired the moment
  it's usable** (maintainer correction, 2026-07-16, 2nd pass on the same
  Chisa draft — her Sawring-Eradication has `energyGen` ~10x a normal hit;
  it's "usually cast before Liberation because it's a great generator", not
  deferred to a later visit). Check the chain's OWN `energyGen`/`concertoGen`
  before deciding its position: a big generator goes before Liberation
  (accelerating when Liberation is castable, or exactly WHY an ER-breakpoint
  target matters — a strong-enough ER build can make Liberation castable
  after just one such loop); a chain that's mainly a DAMAGE payoff (little
  own generation, valuable mainly under Liberation's buff window) is the
  case that may genuinely belong to a later visit — evaluate them
  separately, don't assume one answer for both.
- This is also WHY a certain ER breakpoint target exists for some kits: the
  loop count needed to fill Concerto is what determines whether Liberation's
  energy is naturally ready by the time it's cast last.

## 4. Hard constraints (the validators enforce these)

1. **Basic-attack stage ordering** — stage N requires stage N−1 earlier
   (`validateRotation` stage-family check).
2. **Prerequisite rules** — `ROTATION_RULES` gates (a skill needing a state /
   resource / form must follow its provider).
3. **Auto-triggered follow-ups** — `TRIGGER_RULES` inserts (e.g. Carlotta's
   Skill forces Chromatic Splendor) are real steps; include them explicitly.
4. **Energy.** A fight starts on a FULL Resonance meter, with Concerto and
   Forte empty (invariant "A fight starts on a FULL Resonance meter…" in
   `.claude/rules/invariants-resources.md`). Solo/reference rotations
   therefore assume Liberation is charged, usually once per loop; say so in
   the report. The team sim models energy beyond that (`team-energy.js`,
   `team-er.js`): a curated rotation is performed as authored, never padded or
   gated, and a short gauge is a BUILD problem reported as the ER that fixes
   it; the ER target binds from the second pass. Never fabricate energy math.
   For an Opener (§3a), Liberation is the LAST cast and Concerto/energy
   feasibility are the whole point of the draft: reason with the real
   `energyGen`/`concertoGen` data, still without inventing exact numbers.
4a. **Genre check before drafting** (§3a): confirm whether a solo/reference
   rotation or a team-swap Opener is wanted before choosing the Intro/Outro
   authoring convention — they differ.
5. **Tune Break is player-triggered and enemy-dependent** — never a normal
   step. If the kit interacts with Tune Break, list it as a **Player enabler**:
   "assert Tune Break at/after step N" (per `RESONANCE-MODE-SPEC.md §7`).

## 5. Validation commands

Run from the repo root (Node, no install). Zero warnings required.

```bash
node --input-type=module <<'EOF'
import { readFileSync } from 'fs';
import { validateRotation } from './src/core/rotation-graph.js';
import { rulesForResonator, stateDefsForResonator } from './src/core/rotation-rules.js';
import { computeStateTimeline } from './src/core/rotation-state.js';

const d = JSON.parse(readFileSync('./data/wuwa-data.json','utf8'));
const RID = /* resonator id */;
const rotation = [ /* drafted keys */ ];
const map = d.autoSkillMap[RID];

// 1. Every key exists
for (const k of rotation) if (!map[k]) throw new Error('unknown key: ' + k);

// 2. Sequencing (prerequisites + stage ordering)
const warnings = validateRotation(rotation, rulesForResonator(RID), map);
console.log('warnings:', warnings.length ? warnings : 'none ✅');

// 3. State timeline (for inState-gated effects)
const tl = computeStateTimeline(rotation, map, stateDefsForResonator(RID));
console.log('states ever active:', [...new Set(tl.activeAt.flatMap(s=>[...s]))]);
EOF
```

**Trigger coverage** (the ✅/⏸/⚠ audit from SKILL.md §5): walk every effect on
the resonator's chain (at the assumed sequence level) + inherents; resolve its
trigger against the rotation (castMatch → is a matching key/type present
before the payoff? stateEnter → is the state in the timeline? modeMatch → does
it match the chosen mode? none → ✅ always; unknown → ⚠).

**Optional damage comparison**: if the repo is runnable, `simulateRotation`
(with a localStorage shim, teamSim-style effect resolution) can score 2–3
candidate orderings. Report totals; pick the highest.

## 6. Assumed defaults for a report

Unless the user says otherwise: level 90, all skills 10, **S0** (call out
which higher-sequence effects would change the rotation), the character's
standard sonata, single enemy. For mode characters with no stated mode: draft
both modes or ask.

## 7. Tips bank (draw on these where the kit matches)

- **Negative-status appliers** (`NEGATIVE-STATUS-REFERENCE.md`): Spectro
  Frazzle ticks every 3s and loses 1 stack per tick → tip: keep re-applying
  during filler to hold stacks high (damage scales steeply with stacks). Aero
  Erosion decays every 15s but ticks every 3s → build to cap early, then it
  largely sustains itself for the window.
- **Amplify pairing** (`COMBAT-ROLES-REFERENCE.md`): if the kit has an
  `AMP_*` role, the "rotation" advice is partly *team* advice — the payoff is
  the amplified teammate's damage; the enabler list should name the intended
  recipient class.
- **Tune Break partners**: `TB_RUPTURE`/`TB_STRAIN` kits want a `TB_BOOST`
  provider (Mornye) on the team — a Team enabler, not a rotation step.
- **Concerto/outro handoff**: kits with high per-cast `concertoGen` (§3a) fill Concerto fast —
  tip: their rotation can be short; overstaying wastes team uptime.
- **Mode-specific quirks**: e.g. Aemeath S6 makes Tune Rupture able to crit
  (normally it cannot) — a Build enabler (S6 + Tune Rupture mode) that changes
  which stats matter. Check chain effects for mode-crossing surprises like
  this before writing tips.
- **Window alignment**: when a chain/inherent buff is `castMatch` + timed
  (e.g. "+crit for 10s after Basic V"), schedule the heaviest payoff
  immediately after the trigger — and say so in the tips ("Liberation within
  Xs of Basic V").

## 8. Structured output shape (for defaults/optimizer use)

```json
{
  "resonatorId": 1107,
  "mode": null,
  "sequenceLevel": 0,
  "rotation": ["intro", "skill", "skill_chromatic_splendor", "..."],
  "assumes": ["liberation charged (ER breakpoint)", "single enemy"]
}
```

Emit alongside the human report when the user wants it committed to
`data/reference-rotations.json` or consumed by the optimizer as
`referenceRotation` (in `data/wuwa-meta.json`) — this skill is the shared
brain for both.
