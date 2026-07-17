# P11 Addendum — Audit Triage + Conditional-Effects Model Revision
## Amends `docs/P11-INSTRUCTION-SET.md`. Read both before implementing P11.

This addendum captures decisions from the 2026-06 design audit. Section A is a
**model revision** that supersedes parts of the P10 conditional-effects design
and amends P11 §3 (sim enrichment) — implement it FIRST within P11, because the
buff bar (P11 §8) and step tooltips depend on it. Sections B–I are scope
additions, each small.

---

## Status (verified 2026-06-21, refreshed same day after a follow-up session) — READ THIS FIRST

**Visual baseline change**: a new **Build Page v2**
(`src/ui/components/build-editor-v2.js` + `styles/build-v2.css`, reachable via
`#edit2/<id>`) was built directly from the real Figma handoff and now
**supersedes the classic build editor (`build-editor.js`) as the visual
baseline for the build-editor page**. Where this addendum's prose describes a
specific mock/markup for the build editor (§B–D, §F, §I), treat the literal
HTML/class-name shapes as historical context — the actual handoff design in
v2 is authoritative; defer to it over this doc's wording. **This does NOT
extend to the team-sim screen** (`team-editor.js`, Instruction-Set §10) — that
page is untouched by any v2 effort and §10 stands as written.

Per-section status, verified against the current tree (not re-reading commit
messages):

| § | Status | Notes |
| --- | --- | --- |
| A (model revision) | ✅ Done | Landed in `0e2d71f`. Verified live in `src/core/buffs.js` (trigger×window taxonomy, `castMatch`/`stateEnter`/`modeMatch`/`seconds`/`stateBound`/`persist`/`always`), `sim.js`, `build.js`. `effectToggles`/`setEffectToggle` are fully gone (only a deprecation comment remains). 12 related test files pass. |
| B (header controls) | ✅ Done, **in v2**, by a newer design | Sequence is a cascading S1–S6 toggle row (`tierNodes()` + the shared `tier()` helper) — matches §B's cumulative semantics exactly. The "single expandable description box" detail is **superseded**: per direct user feedback this session, sequence/skill-level node descriptions now live *only* in a hover-box tooltip, not an inline expandable box. |
| C (stat tree layout) | ✅ Done, **in v2** | `renderSkillLevels()` — 5 columns, node toggles above each level slider. The forte/stat nodes are **also now cascading-tiered** (not independent toggles as C's "default ON" phrasing implies) — a deliberate revision per user feedback, matching the handoff mock's left-node-is-root-of-right-node behavior. |
| D (rotation donut) | ✅ Done, **in v2** | `renderRotationDonut()`. Built with v2's own scoped colour system (`STEP_TYPE`/`stepTypeInfo()` in `build-editor-v2.js`), **not** the global `--dmg-*` tokens from `tokens.css` (§2) — v2 is deliberately self-contained/scoped (see `styles/build-v2.css` header comment) and does not consume the global token file. |
| E (palette grouping) | ✅ Done, **in v2** | `renderRotationPalette()`/`groupPaletteEntries()` group entries by skill family (header = family, body = stage buttons). Stance characters get a per-state header split (e.g. Hiyuki → "BASIC ATTACK — PRESENT SELF" / "BASIC ATTACK — FORECLAIMED SELF"), derived generically from each key's stage-family remainder against `STATE_DEFS` — no new curated table, reuses `parseStage()` (newly exported from `rotation-graph.js` for this purpose). |
| F (weapon picker max stats) | ✅ Done, **in v2** | `openWeaponPicker()`'s `renderRow` adds a third `.option__sub` line via the existing `weaponStatsLine(w, 90)` helper, e.g. "ATK 588 · Crit. DMG 48.6%". |
| G (buff bar icons) | ❌ Not done | **No longer blocked** — v2's buff-window timeline now exists (`renderBuffWindows()`; see Instruction-Set §8/§9a, updated 2026-06-21) and can be extended directly. Strips currently show only a text label, no per-buff icon. |
| H (picker filter-search) | ✅ Done | Generic, not v2-specific: `searchFields` in `src/ui/components/modal-picker.js`, used by v2's echo/weapon pickers already. |
| I (RC text formatting) | ✅ Logic done, **in v2 and substantially extended**; visual polish still handed off | `formatTipDesc()` (moved to the shared `src/ui/tip-format.js`) highlights element names (each in its own element colour) and multiplier/percent values inside hover-box descriptions, applied **uniformly** by `showTooltip()` (now the shared `src/ui/tooltip.js`) — so chain nodes, Resonance Modes, skills, sonatas, and weapons all get it for free, including the Resonance Mode buttons whose `resonanceModes[].desc` now comes from the in-game `skill_branches` text. Runs on already-escaped text (XSS-safe). **Extended in the Instruction-Set's Final wrap-up pass (2026-06-26, post-COMPLETE)**: `extractSkillSection()` resolves per-stage descriptions out of combined move-family text so every skill/ability surface — not just the RC panel — shows the real move description on hover, including individual stages of multi-stage moves; `formatTipDesc()` gained `## Heading` rendering for the multi-section case; the hover-box itself gained scroll-into and viewport-collision handling. See that section for full detail. Tested in `tests/build-editor-v2.test.mjs` and `tests/tip-format.test.mjs`. **Superseded detail**: §I's "collapsed by default, expandable" no longer applies — the home for this text is the transient hover-box, not an inline RC panel. **Design-track remainder (handed to maintainer, still untouched)**: the exact highlight colours/weight (`.bv2-tip-num`/`.bv2-tip-el` in `build-v2.css`) and whether to additionally emphasize skill-family terms. |

---

## A. Conditional effects — unified trigger + window resolution (MODEL REVISION)

### A1. The decision

**No effect-level toggles anywhere.** Node-level controls remain (chain
slider/boxes, inherent-skill toggles, stat-node toggles), but the effects
*inside* an unlocked node are never user-toggled. They resolve automatically,
identically, in both the build-page rotation sim and the team sim.

Furthermore, **"assumed active" is abolished for duration effects.** A buff
like "Basic Attack V increases Crit Rate by 15% for 10s" is not blanket-on; it
has a **trigger** (casting Basic Attack V) and a **window** (10s from the
trigger). The sim must detect the trigger firing in the rotation, open the
window at that point in time, and apply the effect only to steps inside it.

### A2. The unified taxonomy

Every parsed effect reduces to **trigger × window**:

| Component | Values | Source |
|---|---|---|
| trigger | `castMatch` (a skill key/type is cast) · `stateEnter` (a state becomes active) · `modeMatch` (build's Resonance Mode — see `RESONANCE-MODE-SPEC.md`) · `none` (unconditional) · `unknown` (unextractable) | parser + override table |
| window | `seconds(N)` (timed, from trigger) · `persist` (until rotation end) · `stateBound` (while the state is active, from the P10 state timeline) · `always` (unconditional) | parser + override table |

The old `conditionKind` values map onto this: `unconditional` → none/always;
`structural afterCast` → castMatch/persist; `structural inState` →
stateEnter/stateBound; `duration` → castMatch/seconds(N) — **the trigger must
now be extracted for these, not skipped**; `situational`/`other` →
trigger=unknown until the override table (see `PRE-P12-DATA-QUALITY.md`)
supplies one.

### A3. Resolution policy (both sims, one code path)

- `none/always` — active whenever the node is unlocked.
- `castMatch` — window opens at the **end time of the triggering step**
  (the buff is granted by the cast; the triggering step itself does NOT
  benefit from its own buff — documented approximation). A step benefits if
  its `startTime` falls inside an open window. **Re-triggering refreshes the
  window** (standard game behaviour).
- `stateEnter/stateBound` — active for steps whose index lies inside the
  state's active range from `computeStateTimeline` (P10). Already per-step.
- `unknown` trigger — **OFF, conservatively**, and flagged in the data-quality
  audit so the maintainer adds an override. With no user toggle, silent
  wrong-ON is worse than visible OFF.

**Invariant — multiple effects per node resolve independently.** A single node
(sequence or inherent) carries an **array** of effects. Each resolves
independently against its own trigger/window/mode condition, and **all active
effects contribute additively** to the build. Two effects on the same node that
differ only by their condition — e.g. the same buff gated to different Resonance
Modes (Aemeath S6 lists a fixed-crit effect **twice**, once per mode) — are
**both** real and must each be evaluated. Resolving one effect must **never
short-circuit** the others. The natural singular mental model ("a node grants an
effect") is wrong and is the exact shape of the Aemeath S6 / `modeMatch`
double-count bug — do not collapse, dedupe, or first-match-and-stop a node's
effect array.

### A4. Engine changes (amends P11 §3, supersedes parts of P10)

1. **Parser** (`tools/preprocess.mjs`): for `duration`-class effects, extract
   the trigger (reuse the existing `extractStructuralTrigger` machinery —
   "Basic Attack V", "after casting X", skill-type phrases) AND
   `durationSeconds` (the `for Ns` value). Effects gain
   `{ trigger, window, durationSeconds? }`. Keep the old fields during
   transition; remove once consumers migrate.
2. **Per-step resolution**: the P10 `structuralResolver` answered a
   whole-rotation boolean ("active anywhere"). It becomes **step-aware**:
   `resolveEffect(effect, stepIndex, stepStartTime)` evaluated inside the
   rotation walk. The sim pre-computes trigger fire-times in a first pass over
   the rotation (cheap), then evaluates windows per step in the main walk.
3. **The build/teamSim `effectMode` split collapses.** One resolution mode for
   both sims. `effectToggles` is **deprecated**: the engine ignores it; strip
   the field on next save; remove the UI handlers and the `setEffectToggle`
   pathway.
4. **`buffWindows` (P11 §3c) now falls out directly** from the window model —
   `deriveBuffWindows` reads real trigger/expiry times instead of inferring
   contiguity from per-step name sets. The buff bar becomes exactly truthful.
5. **Damage panel without rotation context**: single-skill cards resolve
   conditional effects against `build.rotation` when one exists. With no
   rotation: only unconditional effects apply, and conditional chips show
   "inactive — add a rotation to resolve" rather than a fabricated assumption.

### A5. UI changes (amends P11 §9 and the chain/inherent chips)

- Effect chips become **informational badges**: state = active / inactive in
  this rotation; hover shows the condition text, the resolved trigger, and —
  for windowed effects — the **uptime** ("active 7.2s / 18.4s — 39%"). No
  click handlers, no `~` toggle affordance.
- The RC panel hint text changes accordingly ("effects resolve automatically
  from your rotation").

### A6. Why this is the right model (for the record)

It removes the user-facing ambiguity ("is this toggle actually being
simulated?"), makes the buff bar literal rather than assumed, and — the quiet
win — makes P12's marginal weights reflect *realistic uptime* at the anchor
instead of 100%-uptime optimism. `PHASE0-ARCHITECTURE.md §4` and
`P12-INSTRUCTION-SET.md §2a` are amended to match (anchor = unified automatic
resolution over the reference rotation; no blanket assumptions).

---

## B. Header controls (design-track component + binding spec)

- **Resonator level**: stepped slider 1–90, tick markers every 10.
- **Skill levels**: five 10-step sliders (1–10), default 10, one per base node
  (Normal Attack / Resonance Skill / Forte Circuit / Resonance Liberation /
  Intro Skill).
- **Resonance Chain — sequence toggle-bar** (supersedes the earlier
  stepped-slider-bound-to-boxes design; the slider is dropped entirely): a row
  of **six toggles labelled S1–S6**. There is no S0 toggle — **all-off means
  S0** (owned, no sequences unlocked).
  - **Cumulative semantics, enforced by the control itself**: turning a toggle
    **on** activates it and all *lower* sequences (turn on S4 → S1–S4 lit);
    turning one **off** deactivates it and all *higher* sequences (turn off S2 →
    S2–S6 clear). The chain level = the highest lit toggle, or 0 if none.
    Sequential integrity (S4 implies S1–S3) is structural — no separate slider,
    no click-arithmetic edge cases.
  - Beneath the toggle-bar sits a single **expandable description box** showing
    the effect text for the unlocked sequences, collapsed by default
    (formatting per §I). Replaces per-box descriptions.
  - **Data model is unchanged**: `build.chain` stays an integer 0–6; only the
    *control* that sets it changes. No engine, no save-format impact — a
    UI-layer edit only.
- New Group A atoms for the Figma library: **stepped slider** (with a
  tick-marker variant, for level/skill) and a **toggle** (on/off, for the
  sequence bar). The sequence toggle can reuse the `atom/chip` selected/default
  states if visually appropriate, or be its own atom — design discretion.

## C. Stat tree — compact in-game-style layout (design track)

Five columns mirroring the in-game tree (screenshot in the audit): base skill
node + its level slider at the bottom of each column; the column's **two
passive nodes stacked above it as toggles, default ON** (stat-bonus nodes on
four columns; the two Inherent Skills on the Forte column). Engine already
supports all of this (P9/P10) — this is purely layout/interaction redesign via
the Figma handoff.

## D. Rotation totals — damage-category donut (amends P11 §9)

Add a donut/cake chart to the rotation totals area breaking total damage down
by the seven `damageCategory` values, coloured with the `--dmg-*` tokens.
Implementation: inline SVG or `conic-gradient` — **no chart library** (zero-dep
rule). Legend with per-category absolute + percentage; hovering a slice
highlights the matching steps in the list (stretch goal; legend alone is
acceptable).

## E. Palette grouping (amends P11 §9)

Group the rotation palette by skill family: header = the family ("Basic
Attack"), body = pickable stages ("Stage 1 … Stage 5"). Reuse the
stage-family detection from P11 §6a. **Stance edge case**: families that exist
per state (Hiyuki Present/Foreclaimed) get separate headers named from
`STATE_DEFS` — the data already exists; no new tables.

## F. Weapon picker — max stats on the card

Each weapon card in the picker shows base ATK + secondary stat at max level
(computed from `weaponCurves`). Depends on housekeeping H1 (trim) landing
first so the picker surface is final.

## G. Buff bar icons (amends P11 §8)

Buff strips gain an icon slot: per-buff icon when known, else the universal
buff glyph from `assets/icons/misc/` rendered via the **CSS-mask technique**
(housekeeping H4) and tinted to the strip's kind colour. Hover description
formalized (condition text + source skill/node + remaining window).

## H. Picker filter-search

A text input above roster / weapon / echo pickers filtering the list by name
as you type. Local, instant, no index. (The notes' "full-text search
everywhere, by stat/effect" is a separate, larger feature — **Phase X**; it
needs a query index and its own design.)

## I. RC panel text formatting (design track + small engine expose)

Per the audit: element names and multiplier values rendered prominently inside
RC descriptions; descriptions collapsed by default, expandable. The parser
already extracts values/elements per effect — expose them so the formatter can
highlight without re-parsing. Visual treatment flows through the Figma handoff.
