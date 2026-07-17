# Combo-Entry Curation Pass — undocumented chain interactions

**Status:** Tier-1 desk pass SHIPPED (2026-07-05). Reference rotations are
fully clean (0 warnings, locked by `tests/stage-grants.test.mjs`); the Tier-1
worksheet below went from 8 → 20 fully-covered characters this pass. Tier-2
(in-game verification) remains open — see the worksheet.

## Why this exists

The game's basic-attack chains have entry/continuation mechanics that are
**neither in the kit text nor in the extracted data**. Verified 2026-07-05:

- `skill_branches` in the raw nanoka files holds Resonance Mode blurbs, not a
  combo graph; `skill_trees[*].skill_branch_ids` is empty for every node of
  every character; `forte.skill_input_list` is Forte input-hint text ("hold
  Attack"). The combo state machine lives in game behavior blueprints the
  extraction does not cover.
- Maintainer-verified undocumented mechanics so far:
  - **Swap-in entry**: swapped in without Intro → an automatic Basic Stage 1
    fires, and the first user Basic lands at **Stage 3** (Yangyang, Verina,
    Yinlin; spot-checked Roccia, Camellya). NOT true for Chisa, Aemeath,
    Denia (they enter at Stage 1).
  - **Yinlin**: Intro chains directly into Basic Stage 4.
  - **Danjin**: her Resonance Skill weaves INTO the Basic chain (Carmine
    Gleam → Basic Stage 2); the kit only documents the reverse direction.
  - **Heavy from idle** is always preceded by an auto Basic Attack (same
    button); heavy cast from inside another animation comes out alone.
    (Not yet modeled — see "Unmodeled mechanics" below.)

Because Prydwen/community rotations are expert-verified, **a validator warning
on a curated rotation is treated as a curation gap first, a rotation bug
second.**

## Where verified results go (authoritative, committed)

All in `src/core/rotation-rules.js` — every entry carries a `note` quoting the
kit text OR marked `Maintainer-verified in-game (date)`:

| Table | Use for | Entry form |
|---|---|---|
| `STAGE_GRANTS` | "cast X, then Stage N is available" | `{ after: [granterKeys] }` (adjacent), `{ state: 'name' }` (license via STATE_DEFS), `{ resource: {name, atLeast} }`, `{ free: true }` (family not actually sequential) |
| `SWAP_IN_ENTRY` | entry stage after swap-in | `{ family, preSeen: [1, 2] }` |
| `RESOURCE_DEFS` | quantified resource gates | `{ name, cap, gains: {key: n}, spendAll: [key] }` |
| `STATE_DEFS` | licenses/stances backing `state:` grants | enter/exit (`consumedBy`, `seconds`, `secondsOrConsumedBy`, aliases) |

`tests/stage-grants.test.mjs` enforces that every referenced key exists in the
dataset — add the entry, run the test, done.

## In-game verification protocol (per resonator)

1. **Swap-in without Intro** (empty Concerto): watch for the auto-BA1, then
   press Basic once → note the stage that comes out (= entry stage; record as
   `SWAP_IN_ENTRY` with `preSeen: [1..stage-1]`).
2. **Swap-in with Intro**: press Basic once right after the Intro → note the
   stage (record as a `STAGE_GRANTS` `after: ['intro…']` entry if ≠ Stage 1).
3. **Skill/Liberation/Dodge/Mid-air weave**: from mid-chain (after BA1-2),
   cast the ability, then press Basic → does the chain continue (grant),
   advance, or reset? Repeat from idle.
4. **Heavy interplay**: confirm the auto-BA-before-Heavy behavior and whether
   that auto-BA advances the chain position.

## Worksheet — roster coverage (generated 2026-07-05, updated after the Tier-1 pass)

`covered` = every staged family curated/verified · `text-hints` = kit text
contains grant language not yet curated for at least one family (desk work —
extract + verify) · `NO-TEXT` = nothing in text; only in-game testing can
answer (test on demand, or when a warning is disputed).

**Fully covered (20):** Hiyuki (basic_present/basic_fore; midair_fore still
open), Lucilla, Galbrena, Mornye, Aemeath, Yinlin, Augusta, Buling, Yangyang,
Cartethyia, Shorekeeper, Zani, Chisa, Lynae, Luuk Herssen, Sigrika. Note:
Hiyuki, Lupa, Denia, Rover: Aero, Ciaccona, Iuno, Lucy, Roccia, Cantarella,
Phrolova still have ≥1 uncurated family each — see Tier 1 below (partial
progress this pass reduced but did not close every family for these ten).

**Tier 1 remaining — kit text has grant language, family not yet curated:**

| Resonator | Uncurated staged families |
| --------- | -------------------------- |
| Zhezhi 1105 | basic |
| Hiyuki 1108 | midair_fore |
| Lupa 1207 | midair_mid_air_attack |
| Denia 1211 | skill_banish_breakdown_form |
| Rebecca 1308 | basic_huntress |
| Rover: Aero 1406 | forte_heavy_cloudburst_dance · forte_heavy_unbound_flow |
| Ciaccona 1407 | midair_mid_air_attack |
| Iuno 1410 | basic_moonring_basic_attack · forte_basic_enhanced_moonbow_basic_attack |
| Qiuyuan 1411 | basic |
| Lucy 1511 | skill_payload |
| Roccia 1606 | forte_heavy |
| Cantarella 1607 | forte_heavy_phantom_sting |
| Phrolova 1608 | liberation_hecate |

**Tier 2 — no text at all; in-game testing needed (prioritize characters
whose swap-in entry is unknown):**

Sanhua, Baizhi, Lingyang (+ forte_heavy_feral_gyrate), Youhu, Carlotta
(basic_necessary_measures), Chixia, Encore (+ liberation_cosmos_frolicking),
Mortefi (+ midair), Changli (+ midair), Brant (basic), Calcharo
(+ skill_extermination_order), Yuanwu (+ forte_basic), Jinhsi (+ incarnation
basics), Xiangli Yao (+ liberation_pivot_impale), Aalto, Jiyan
(+ liberation_lance), Jianxin, Rover: Spectro (+ resonating_echoes), Verina
(midair families), Lumi (both stance basics), Phoebe (+ chamuel_s_star — note
character RULES already cover the star sequence), Taoqi (+ timed_counters),
Danjin (basic; skill_crimson_erosion / skill_sanguine_pulse stage pairs),
Camellya (+ skill_vining_waltz), Rover: Havoc (+ umbra basics).

**Swap-in entry question applies to the WHOLE roster** — currently answered
for 8 characters only (5 stage-3 entries + 3 confirmed stage-1). Everyone
else defaults to stage-1 entry, which produces a warning if a user starts a
rotation mid-chain; each such warning is a test prompt, not necessarily a bug.

### Tier-1 pass results (2026-07-05)

Authored `STAGE_GRANTS` entries (all kit-text-quoted, `tests/stage-grants.test.mjs`
data-integrity checked) for: Hiyuki (Dodge Counter/Skills/Intro → Present
Stage 3; Heavy/Intro → Fore Stage 2; Dodge Counter → Fore Stage 3; Bitterfrost
→ Fore Stage 4), Lucilla (Mid-air/Compensate/Spotlight → Basic 2; Mid-air/
Dodge Reminiscence → Tracing Forms 2/3), Lupa (Dodge/Starfall/Shewolf's Hunt/
Feral Fang → Basic 2), Galbrena (Intro/Basic-4-loop/Liberation/Volley-1 →
Basic 2; Volley-2-3/Plunge → Basic 3; Dodge → Basic 4; Flamewing chain),
Mornye (Dodge → Basic 2; Mid-air → Basic 3; WFO Dodge → WFO Basic 3), Denia
(Dodge → Breakdown Stage 4, both basic and mid-air), Augusta (Steelclash Heavy
→ Basic 2), Rebecca (Big Boomin' Time skill/intro → Guts Basic 2), Rover:
Aero (Heavy → Basic 3 direct; Mid-air landing → Basic 4), Ciaccona (Dodge →
Basic 2; Intro → Basic 3; Mid-air 2 → Basic 4), Iuno (Moonbow Dodge → Moonbow
Basic 3 — Moonring Dodge Counter's grant has no skill-map key, still open),
Qiuyuan (Heavy → Inkwash Stage 4), Shorekeeper (Dim Star Butterfly → Basic 2),
Lynae (Palettes → Basic 2; Additive Color/Vivid Tomorrow/Iridescent/Visual
Impact → Kaleidoscopic Basic 2), Luuk Herssen (Dodge → Basic 3; either Scythe
variant → Mid-air 4), Lucy (Pulse Interference → Basic 2; Heavy 1 → Basic 3;
Dodge → Basic 4; Basic-3/Dodge/Pulse-hold → Heavy 2; three Threading heavies
and Deadlock → Thread Shredding 2), Cantarella (Ripple intro → Basic 3; the
Mirage entry cast → Phantom Sting Stage 2, added to her existing character
RULE rather than STAGE_GRANTS), Phrolova (Heavy → Basic 2; either Intro/Dodge
→ Basic 3). Plus the two maintainer-verified undocumented grants (Yinlin
intro→BA4, Danjin skill→BA2) from the prior session. Roster-wide stage-grant
count: 138 → 286 test assertions, 0 → 0 warnings on reference rotations
(already clean; this pass targets USER rotations).

### Effect-override batch (2026-07-05)

Of the 59 unknown-trigger chain/inherent effects flagged in the original
transparency audit, 4 were cleanly authorable via `data/effect-overrides.json`
(verified against the exact kit text, `tools/audit-effects.mjs` gate: 54 → 50
unresolved, 0 regressions in the seed+mode set):

- **Encore S1.0** — castMatch(basic) + stacking (perStack 3%, max 4, 6s).
- **Yinlin S4.0** — castMatch on her Forte Circuit key (team-wide ATK+20%/12s;
  propagation already handled by the existing team-wide text regex).
- **Lumi IH1.0** — castMatch on either Energized Pounce/Rebound key (ATK+10%/5s).
- **Phrolova S3.1 — suppressed**, not fixed: the raw text ("Targets hit by
  Enhanced Attack - Hecate: Cadenza will have their ATK reduced by 20% for
  15s") is an ENEMY debuff misparsed as a self ATK buff; this engine doesn't
  model incoming-damage-taken, so it's out of scope, not a trigger bug.

**The other ~55 were investigated and are genuinely NOT simple overrides** —
the existing `deferred` section of `effect-overrides.json` already documents
why for the highest-value candidates: **Changli's IH0/IH1** (Enflamement
stacks + Flaming Sacrifice/Radiance of Fealty) need a resolution kind this
engine doesn't have yet — "applies only to the exact triggering cast's own
damage instance," not a duration window — and IH1's extracted value is
additionally confirmed wrong (parser grabbed the DEF-ignore number instead of
the DMG-bonus number). **Hiyuki's Snow Rust family (S3.1/S6.0/S6.1)** needs a
continuous multi-source resource gauge (same class of engine work as Lynae's
Lumiflow, already deferred) — Snow Rust accrues from several unrelated
sources (ally join/revive timers, base kit stacks) that a simple `castMatch`
trigger cannot represent. Both are real engine features, not overrides;
attempting them as one-line trigger/window patches risked introducing wrong
numbers into the 6-character covered meta, which is why they're deferred
rather than rushed. Other investigated-and-parked candidates (Brant S2 —
ambiguous "and" semantics across 4 mid-air stages; Buling S1/IH0 — self-scoped
skill-crit and ally-HP-threshold, neither expressible as a window/trigger;
Yinlin IH1 / Yuanwu S5 / Lingyang S3+S6 / Jiyan S5+IH1 / Danjin S5 — each
needs either enemy-status tracking, a new state def, or a broad
any-skill-type trigger the schema doesn't support) are not yet in `deferred`
and are candidates for a future batch alongside proper engine-feature work.

## Unmodeled mechanics (known, deliberate)

- The swap-in **auto-BA1's damage** is not a rotation step (validation knows
  about it via `preSeen`; the sim does not add its damage).
- The **auto-BA-before-Heavy** cast (and its chain advancement) is not
  modeled — needs a decision on whether Heavy steps should implicitly advance
  the basic chain and add the auto-BA damage.
- Stage-3-entry-after-swap-in for the five verified characters: the *reason*
  (combo persistence vs. fixed entry) is unknown; modeled as fixed pre-seen
  stages, which matches all observations so far.
