# Phase 11 — Claude Code Instruction Set

## Visualization + UX Overhaul

**Reads**: `docs/PHASE0-ARCHITECTURE.md` (the contract this phase is part of),
`docs/PHASE10-BRIEF.md` (what P10 left in place).
**Produces**: improved team-sim and build-sim screens; shared buff-bar component;
auto-triggered rotation actions; intra-skill stage validation; echo-stat UX;
Sonata readability fixes. No optimizer or suggestion logic — that is P12.

---

## Phase 11: COMPLETE as of 2026-06-26

Re-verified against the current tree (not the 2026-06-21 snapshot below, which
predates the classic-UI retirement commit `1784620` and the v2 redesign
commits `8cd1255`/`0311bb1`). What changed since 2026-06-21:

- **§10 (team-sim screen) is done.** It was marked "❌ Not done" below because
  that was written when `team-editor.js` (classic) was still the only
  team-sim page. That file no longer exists — `src/ui/components/
  team-editor-v2.js` is the team-sim page and already implements every
  mechanical item §10a/b/c/d/f/g asked for, with test coverage in
  `tests/team-editor-v2.test.mjs`. This was the last fully-open
  code-bearing section; it's now closed.
- **§10e (inline rotation editing)** was never built. By explicit decision,
  it's superseded: the shipped page navigates to the member's Build page
  (`open-member-build` → `#edit2/<id>`) instead. Not revisited.
- **§8 (shared buff-bar component)** is now real. `src/ui/components/
  buff-bar.js` is the single renderer both `build-editor-v2.js`'s
  `renderBuffWindows` and `team-editor-v2.js`'s `renderBuffBar` delegate to
  (lane-packing, colour/icon classification). This also fixed a live bug:
  `build-editor-v2.js`'s old `hexToRgba()` choked on `var(...)` colour
  strings (`buffWindowColor()` had returned tokens, not hex, since the
  tokens-migration commit), silently breaking the buff-window strip
  tint/border. The shared renderer uses `color-mix()` like the rest of the
  v2 codebase.
- **§17a (visual-language decision)** resolved: Option A shipped — the v2
  `.bv2` scoped system, not a classic-`team.css` extension.
- **§17b (buff-bar icons)** is done. Two glyphs are committed
  (`assets/icons/misc/gen-buff-icon.png`, `defensive-buff-icon.png`,
  registered in `icons.js`'s `KINDS.misc`). Strip colour priority is:
  explicit element colour → damage-type colour (`--dmg-basic/heavy/skill/
  liberation/echo/intro/outro`, detected via the new `detectDamageType()` in
  `src/core/sonata-buffs.js`, e.g. "Heavy Attack DMG +25%" → `--dmg-heavy`) →
  the new neutral `--buff-neutral` token for everything else (ATK%, heal%,
  energy, etc.). Icon shape (generic vs. defensive) is a separate keyword
  classification (heal/shield/resist/etc. → defensive glyph).
- **§17c (highlight colour/weight tuning)** is still open — no design input
  given; pure CSS, low priority, do whenever (unchanged from below).

Everything else in the table below was already accurate. See `tests/
buff-bar.test.mjs`, `tests/sonata-buffs.test.mjs`, and the updated
`tests/team-editor-v2.test.mjs` (`elementColorFromName` replaces the old
source-based `buffKindFor`) for the new coverage. Full suite: all test files
and the module-load sweep green.

---

## Final wrap-up pass — same-day validation fixes (2026-06-26)

The maintainer ran manual validation against the COMPLETE state above, found
three live bugs, then requested one more completeness pass before sign-off.
All of it is closure work on this phase — not new scope — and supersedes the
"do whenever" framing on §17c below where the two overlap.

**Three bugs found during validation, all fixed:**

1. The hover-box tooltip stayed visible/open across a page navigation
   (it's appended to `document.body`, outside the repainted `.bv2` subtree,
   so a route change didn't tear it down). Fixed in `app.js`'s navigation
   handler, which now sweeps stray `.bv2-tooltip`/`.bv2-sonata-menu` nodes on
   every route change.
2. Changing a team member's weapon from the Teams page navigated away to the
   Build editor instead of staying put. Fixed — the weapon change now saves
   in place and shows a toast confirming the build was updated, matching the
   Teams page's other inline-edit affordances.
3. Returning to the Teams page (`#party`, no id) always resumed the
   first-ever-created team instead of the most recently opened one. Fixed —
   `src/data/storage.js` now tracks the last-opened team id and `app.js`'s
   `#party` (bare) route resolves to it.

**Hover-box descriptions everywhere** (extends Addendum §I past its original
RC-panel-only scope, in direct response to "easier manual validation" — every
skill/ability surface needed real description text, not just mechanical
stats). Every skill/ability surface in the v2 UI — rotation palette buttons,
rotation chips, the rotation line-chart's hit dots, Ability Damage Overview
rows (including the support-only heal/shield row), and the Team page's
per-member step bars — now shows the move's real description on hover,
**including every individual stage of a multi-stage move** (Basic Attack
Stage 1/2/3…) even though those stages share one combined, mechanically-
identical-but-multiplier-varying description block in the dataset.

New `extractSkillSection(desc, skillKey, skillType)` in `src/ui/tip-format.js`
resolves which part of a combined move-family `desc` applies to one skill
key, via a three-tier heuristic that never commits to a wrong single answer:
(1) match the universal basic/heavy/midair/dodge-counter heading vocabulary;
(2) disambiguate ties or named follow-ups (e.g. "Wooly Strike", "Death
Knell") by distinctive-word overlap between the key and each heading; (3)
fall back to a safe superset (all bucket matches, or the full combined text)
when neither tier finds confident signal. `formatTipDesc()` extended to
render `## Heading` lines — present when a multi-section result is shown —
as styled `.bv2-tip-heading` section labels. Tests: `tests/tip-format.test.mjs`
(19 assertions, verified against real dataset shapes including Encore/1203's
Wooly Strike bonus heading).

**Hover-box scroll + viewport-collision fix, with a DRY pass.** Two UX bugs
reported immediately after the above shipped: the box couldn't be scrolled
(a long description just clipped, with no way to read the rest — it was
`pointer-events:none`), and it didn't reposition near the bottom edge of the
viewport (content could run off-screen with no way to bring it into view,
since `position:fixed` content isn't reachable by scrolling the page). Both
fixed in a new shared `src/ui/tooltip.js`, which also **replaces three
near-identical hand-duplicated copies** of the tooltip implementation
(`build-editor-v2.js`, `team-editor-v2.js`, `compare-v2.js` each carried
their own `ensureTooltipEl`/`showTooltip`/`hideTooltip`) — consolidated per
this codebase's DRY rule rather than patching the same fix three times.
`pointer-events:auto` plus a 150ms grace-period close (cancelled by the
tooltip's own `mouseenter`, since the box lives outside whatever element it
describes) lets the cursor reach into the box to scroll it; `showTooltip()`
now measures available space above vs. below the target, flips to render
above when below would overflow, and clamps the final position fully inside
the viewport.

**Verification**: 21 test files, 0 failures; module-load sweep green
(including the two new modules, `tip-format.js`'s extended surface, and
`tooltip.js`); Playwright smoke-checked live for all three bug fixes and
both hover-box features (scroll-while-hovering, bottom-edge flip, per-stage
section resolution, zero console errors throughout).

---

## Status (verified 2026-06-21, refreshed same day after a follow-up session) — historical, superseded above

**Visual baseline change**: a new **Build Page v2**
(`src/ui/components/build-editor-v2.js` + `styles/build-v2.css`, routed at
`#edit2/<id>`) was built from the real Figma handoff and is now the visual
baseline for the **build editor page**. `build-editor.js` ("classic") is
disregarded as a target for new build-editor UI work — sections below that
named it as the file to change (§9, §11, §12) should retarget to v2 if picked
up. **The team-sim screen is a separate page and is unaffected**:
`team-editor.js` has not been touched by P11 or by v2 at all — §10 stands
exactly as written.

Per-section status, verified directly against the current tree (not by
re-reading old commit messages):

| § | File(s) | Status |
| --- | --- | --- |
| 0–1 | (process) | N/A — process steps, not deliverables |
| 2 | `tokens.css` | ✅ Done (classic engine). v2 does **not** consume these tokens — it uses its own scoped colour system in `build-editor-v2.js`/`build-v2.css` by design |
| 3 | `sim.js` | ✅ Done — `damageCategory`, `activeBuffNames`, `buffWindows`, `deriveBuffWindows` all present and exported, used by `team-sim.js` |
| 4 | `team-sim.js` | ✅ Done — `memberSteps`, `memberBuffWindows` returned |
| 5 | `build.js` | ✅ Done — `rotationMeta`, `setRotationMeta`; mutation helpers kept in sync |
| 6 | `rotation-graph.js` | ✅ Done — `validateRotation(rotation, rules, skillMap)` with intra-skill stage-ordering check; **fully consumed in v2** — `renderRotation()` now passes `skillMap`, so stage-ordering warnings carry the proper skill labels. `parseStage` is exported (reused by §E grouping and §9d fix-target derivation) |
| 7a | `rotation-triggers.js` | ✅ Done — module + `proposeTriggeredInsert`, 21 tests passing |
| 7b | (UI integration) | ✅ Done, **in v2** — `applyAutoTrigger()` is wired into the `add-step` click handler and both palette drag-drop insert paths in `build-editor-v2.js`. It checks `proposeTriggeredInsert()`, appends the forced follow-up tagged `{autoInserted:true}` in `rotationMeta`, and shows a dismissible "⚡ Auto-inserted: …" notice (`renderAutoInsertNotice`/`dismiss-auto-notice`). Verified live against the dataset (Carlotta: adding `skill` auto-inserts `skill_chromatic_splendor`). Still not wired in classic `build-editor.js` — not a target per the baseline change above |
| 8 | `buff-bar.js` | ✅ Done (2026-06-26) — `src/ui/components/buff-bar.js` now exists for real and is the single renderer both `build-editor-v2.js`'s `renderBuffWindows()` and `team-editor-v2.js`'s `renderBuffBar()` delegate to: lane-packing, colour classification (element → damage-type via `sonata-buffs.js`'s `detectDamageType()` → neutral `--buff-neutral` token), and the icon glyph (generic vs. defensive). Fixed a live bug in the process: the old `hexToRgba()` in `build-editor-v2.js` only handled literal hex strings, but `buffWindowColor()` had been returning `var(...)` tokens since the tokens-migration commit — the buff-window strip tint/border was silently broken. Tests: `tests/buff-bar.test.mjs`, `tests/sonata-buffs.test.mjs` |
| 9 | `rotation-panel.js` | ✅ Done in spirit, **in v2 instead** — all sub-items now landed there: §9a's goal is met by v2's own `renderBuffWindows()` (see §8 row); §9b collapsible hit breakdown is a ▾ toggle on chips with >1 hit, opening a single shared detail panel (`renderRotStepDetail`); §9d replaced the generic warning count with a per-warning list and individual "FIX" buttons (`renderValidationBanner` / `computeFixTarget` / `applyFix`); §9e gives auto-inserted chips a ⚡ badge + gold border sourced from `rotationMeta`. §9c (damage-type colour coding) was already done via `STEP_TYPE`. The literally-named `rotation-panel.js` file remains untouched — not a target per the baseline change above |
| 10 | `team-editor.js` | ✅ Done, **in v2 instead** (`team-editor-v2.js`, landed in `8cd1255`/`0311bb1`, predating this status table's last refresh — this row was simply stale, not the code). Implements §10a–§10d/f/g: per-member columns (`renderMemberColumn`), damage-category-coloured step bars (`renderStepBar`), collapsible rotation groups defaulting expanded ≤6 steps (`renderStepGroups`), per-member buff bar (`renderBuffBar`, now via `buff-bar.js` — see §8), per-member + team totals rows, drag-and-drop column reorder (`swapTeamSlots` in `core/team.js`). Tests: `tests/team-editor-v2.test.mjs`. **§10e (inline rotation editing) was never built and is superseded by design** — the shipped page navigates to the member's Build page (`open-member-build` → `#edit2/<id>`) instead; decided 2026-06-26, not revisited |
| 11 | `build-editor.js` (echo chips) | ✅ Done in spirit, **in v2 instead** — v2's echo slot cards use click-to-toggle substat chips (`toggle-sub`/`cycle-sub`), not `<select>` dropdowns. Markup/class names differ from this section's literal spec |
| 12 | `build-editor.js`/`editor.css` (sonata card) | ✅ Done in spirit, **in v2 instead** — v2's sonata strip shows name + 2PC/5PC pill states (text descriptions moved to a hover-box per user feedback this session, not inline). More compact than this section's "card stack" framing, by explicit design choice |
| 13 | tests | ✅ Gap **closed** — `test/build-editor-v2.test.mjs` (new, 32 assertions) covers the pure v2 helpers now exported via `__test__`: `formatTipDesc` (§I), `groupPaletteEntries` (§E), `computeFixTarget` + `applyFix` (§9d), run against real `wuwa-data.json`. 13 test files total, 0 failures, 21/21 modules load. Still untested by automation: the DOM-bound glue (`applyAutoTrigger`'s notice side-effect, drag-drop, click dispatch) — those remain covered only by manual smoke checks, acceptable since they're thin wiring over tested pure logic |
| 14 | (verification script) | ✅ Refreshed below to match the current module list (added `build-editor-v2.js`; dropped `buff-bar.js`, which still doesn't exist as a file — see §8) |
| 15 | (files-changed table) | ⚠️ Still stale by design — kept as the historical plan, not corrected. What actually changed is tracked in this status table instead (`build-editor.js` was the real target for §11/§12-equivalent work; `build-editor-v2.js` absorbed §7b/§8/§9/§11/§12 once it became the baseline) |
| 16 | (deferred items) | Unaffected — still accurate |

**Net effect (updated 2026-06-26 — see the COMPLETE banner and the Final
wrap-up pass section at the top of this file): Phase 11 is closed.** The
engine/data layer (§2–§7a) is solid and fully tested; every UI-consumption
item for the **build page** (§7b, §8, §9 in full, §11, §12, plus Addendum
§E/§F and the logic half of §I) is wired into **Build Page v2**; **§10 — the
team-sim screen** is done in **Team Sim v2** (`team-editor-v2.js`), including
the shared buff-bar (§8) both pages now consume; and the Final wrap-up pass
closed out three validation-blocking bugs plus extended hover-box
descriptions and fixed their scroll/positioning to every skill/ability
surface across the build, team, and compare pages. The only remaining item
is **design-track and optional**: the visual-polish half of §I (highlight
colour/weight tuning) — pure CSS, no design input given, do whenever.
Addendum §G (buff-bar icons) is no longer open — assets were provided and
landed (see §8's row above).

---

## 0. Pre-flight checklist

Before writing a single line of code, Claude Code must:

1. Run `node --input-type=module` against every module in `src/core/` and
   `src/ui/components/` to confirm the P10 codebase loads cleanly. Any module
   that fails to load is a blocker — fix it before proceeding.
2. Run all three test suites:

   ```text
   node test/rotation-validation.test.mjs
   node test/conditional-effects.test.mjs
   node test/rotation-state.test.mjs
   ```

   All must pass. P11 must not regress any of these.
3. Read `styles/tokens.css` in full before touching any CSS. Every new colour or
   spacing value introduced in P11 must be added as a token to that file first,
   then referenced by variable name everywhere — never as a hardcoded literal.
4. Read `docs/UI-DESIGN-WORKFLOW.md` §5 (Annotation) and §6 (Handoff) so you
   understand what visual decisions are left to the maintainer's Figma pass
   versus what is specified here.

---

## 1. Scope boundary

### P11 DOES change

- `src/core/sim.js` — enrich step output; add buff-window computation.
- `src/core/team-sim.js` — expose per-member step data in the returned result.
- `src/core/build.js` — add `rotationMeta` field; add `setRotationMeta` helper.
- `src/core/rotation-graph.js` — extend `validateRotation` for intra-skill stage
  ordering.
- New: `src/core/rotation-triggers.js` — auto-triggered action rules.
- New: `src/ui/components/buff-bar.js` — shared buff/effect timeline component.
- `src/ui/components/rotation-panel.js` — buff bar, step detail, stage guidance.
- `src/ui/components/team-editor.js` — full team-sim visualization overhaul.
- `src/ui/components/build-editor.js` — echo stat UX, auto-inserted steps.
- `styles/tokens.css` — new damage-type colour tokens (7 types).
- `styles/rotation.css` — buff bar, step expansion, type colour coding.
- `styles/editor.css` — echo stat chip styles; Sonata readability fixes.
- `test/` — new tests for triggers, stage validation, buff-window derivation.

### P11 does NOT change

- `src/core/formula.js`, `stats.js`, `skill.js`, `off-field.js`,
  `sonata-buffs.js`, `sonata-stats.js`, `team.js` — the engine is correct.
  **Correction (verified 2026-06-21): `buffs.js` was in fact rewritten** by the
  Addendum §A model revision (`0e2d71f`) — this line was already inaccurate
  before any v2 work started.
- `src/core/rotation-rules.js`, `rotation-state.js` — keep P10 output intact.
- ~~`tools/preprocess.mjs`, `data/wuwa-data.json` — no data pipeline changes.~~
  **Correction: both were changed**, repeatedly. `0e2d71f` added the
  trigger×window parser, `tools/resonance-modes.js`, `tools/effect-overrides.js`,
  and `data/effect-overrides.json` for Addendum §A. A later session-level fix
  (2026-06-21, undocumented in this file until now) added a sonata-AddProp
  parser to `projectNanokaSonatas` — nanoka-sourced sonata 2pc tiers had no
  structured stat data at all, so their always-on bonuses (e.g. "Fusion DMG +
  10%") silently never reached `resolveTotalStats()` in *either* editor. This
  line should be read as aspirational-at-time-of-writing, not current scope.
- `src/data/storage.js` — storage contract unchanged.
- `src/ui/components/damage-panel.js` — in-scope for a future UX pass; skip P11.
- Any file not listed above. If you find yourself editing something unlisted,
  stop and question whether it is truly necessary.

---

## 2. Design tokens — do this first

Add to `styles/tokens.css` under the existing skill-type colour section:

```css
/* Damage-type display colours — used for step bars, tooltips, legends.
   All seven must be perceptually distinct on the dark background.
   These extend the existing seg-color values in rotation.css. */
--dmg-basic:       #9ad8ff;   /* matches existing basic seg-color */
--dmg-heavy:       #ff9c66;   /* matches existing heavy seg-color */
--dmg-skill:       var(--accent);   /* teal */
--dmg-liberation:  #c084fc;   /* purple — Liberation is the big cooldown */
--dmg-echo:        #facc15;   /* amber-yellow — distinct from all above */
--dmg-intro:       #86efac;   /* green — entry hit */
--dmg-outro:       #f9a8d4;   /* pink — exit hit */
```

Add under spacing:

```css
--buff-bar-h:     24px;   /* height of a single buff strip in the buff bar */
--buff-bar-gap:   2px;    /* gap between buff strips */
```

---

## 3. Sim output enrichment — `src/core/sim.js`

The sim currently returns steps with `buffed: boolean` (coarse) and no buff
timeline. P11 components need finer data. **Enrich without breaking callers.**

### 3a. Add `damageCategory` to each step

Map the step's `skillType` to one of the seven display categories
`basic | heavy | skill | liberation | echo | intro | outro`.

```js
// Add this mapping near the top of simulateRotation, after skillMap is resolved.
// Off-field/coordinated steps inherit from the skill that generated them:
// use the description-derived type (from the skill's skillType field) first,
// or the origin skill's type as fallback — matching the Q12 decision.
const SKILL_TYPE_TO_DMG_CATEGORY = {
    basic:       'basic',
    midair:      'basic',      // mid-air basics fold into basic
    heavy:       'heavy',
    skill:       'skill',
    liberation:  'liberation',
    forte_basic: 'basic',
    forte_heavy: 'heavy',
    forte:       'skill',
    echo:        'echo',
    intro:       'intro',
    outro:       'outro',
};
// Default fallback: 'skill'
```

Attach to each step object: `damageCategory: SKILL_TYPE_TO_DMG_CATEGORY[step.skillType] ?? 'skill'`.

### 3b. Add `activeBuffNames` to each step

For each step, record which *named conditional buffs* are contributing — i.e.,
those whose presence changes the damage relative to the unconditional baseline.
This drives the buff bar display. Collect:

1. **Active conditional sonata buffs** at this step. The sim already resolves
   `conditionalSonataBuffs` per step — extract the `label` / `name` of each
   active one.
2. **Active conditional chain/inherent effects** (those with
   `conditionKind !== 'unconditional'`) that `collectActiveEffects` returns for
   this build. Unconditional effects are baked in; they are NOT buff-bar items
   (they're permanent and the user already knows about them from the chain
   panel). Only conditional ones — those that could be off — belong in the bar.

Attach to each step: `activeBuffNames: string[]` (may be empty).

### 3c. Add `buffWindows` to the SimResult

After the step-walk loop, derive contiguous buff windows from the per-step
`activeBuffNames` data:

```js
// Derive buffWindows from step-level activeBuffNames.
// A window opens when a buff name first appears; closes when it disappears.
// Returns Array<{name, startStep, endStep, startTime, endTime}>.
function deriveBuffWindows(steps) {
    const open = new Map();   // name → {startStep, startTime}
    const windows = [];
    for (const step of steps) {
        const names = new Set(step.activeBuffNames ?? []);
        // Close windows for buffs that ended
        for (const [name, w] of open) {
            if (!names.has(name)) {
                windows.push({ name, startStep: w.startStep, endStep: step.index - 1,
                    startTime: w.startTime, endTime: step.startTime });
                open.delete(name);
            }
        }
        // Open windows for buffs that started
        for (const name of names) {
            if (!open.has(name)) open.set(name, { startStep: step.index, startTime: step.startTime });
        }
    }
    // Close anything still open at end of rotation
    const last = steps[steps.length - 1];
    if (last) {
        for (const [name, w] of open) {
            windows.push({ name, startStep: w.startStep, endStep: last.index,
                startTime: w.startTime, endTime: last.endTime });
        }
    }
    return windows;
}
```

Add to SimResult: `buffWindows: deriveBuffWindows(steps)`.

### 3d. Backward compatibility

All new fields are additive. Callers that only read `totals` and `steps` (without
the new fields) continue to work. The team-sim.js, damage-panel.js, and
rotation-panel.js callers must be audited to ensure they don't break.

---

## 4. Team sim result — `src/core/team-sim.js`

`simulateTeamRotation` currently returns `{ segments, memberTotals, totals }`.
The `segments` array carries per-member step data already, but `memberTotals`
is just aggregates. P11's team visualization needs per-member step arrays and
buff windows. **Add to the return value — do not remove anything.**

Add `memberSteps` to the return:

```js
// memberSteps: map from resonatorId → the steps array for that member's rotation.
// Derived from segments: collect all steps across all segments for each member.
const memberSteps = new Map();
for (const seg of segments) {
    if (seg.steps) {
        const existing = memberSteps.get(seg.resonatorId) ?? [];
        memberSteps.set(seg.resonatorId, [...existing, ...seg.steps]);
    }
}
// Also expose per-member buffWindows.
const memberBuffWindows = new Map();
for (const [rid, steps] of memberSteps) {
    memberBuffWindows.set(rid, deriveBuffWindows(steps));
}
```

Import `deriveBuffWindows` from `sim.js` (export it from there). Do not
duplicate the function.

Return shape addition:

```js
return { segments, memberTotals, totals, memberSteps, memberBuffWindows };
```

---

## 5. Build rotation metadata — `src/core/build.js`

Auto-triggered actions (§8) are *real* rotation steps but marked as
machine-inserted so the UI can style them differently and the user can remove
them with a clear affordance. The rotation string array (`build.rotation`)
stays unchanged — it is the storage format. Metadata is parallel.

### 5a. Add `rotationMeta` field

```js
// In createBuild return object, add:
rotationMeta: [],   // Array<{autoInserted?: boolean}>
                    // Parallel to build.rotation. Index i describes step i.
                    // Empty object = user-added step (default).
                    // Sparse: missing entries treated as {}.
```

Add to sanitize path:

```js
rotationMeta: Array.isArray(input.rotationMeta) ? input.rotationMeta.slice() : [],
```

### 5b. Add `setRotationMeta(build, index, meta)` helper

```js
// Set or clear the metadata for a specific rotation step.
// meta = null clears it (reverts to default user-added).
export function setRotationMeta(build, index, meta) {
    const m = (build.rotationMeta ?? []).slice();
    while (m.length <= index) m.push({});
    m[index] = meta ?? {};
    return touch({ ...build, rotationMeta: m });
}
```

### 5c. Keep `appendRotationStep`, `removeRotationStep`, `moveRotationStep`

consistent with `rotationMeta`

When a step is removed at index i, also remove `rotationMeta[i]`.
When a step is moved, move its `rotationMeta` entry with it.
**This is a critical correctness requirement** — failing to keep them in sync
means auto-inserted markers will drift to the wrong steps.

Audit every mutation helper in `build.js` that modifies `rotation` and add the
parallel `rotationMeta` mutation.

---

## 6. Intra-skill stage validation — `src/core/rotation-graph.js`

P10's `validateRotation` checks character-level prerequisites from the
`ROTATION_RULES` table. P11 extends it to catch **intra-skill stage ordering
errors** — cases like "Basic Attack Stage 3 before Stage 2" that are independent
of character-specific rules.

### 6a. Stage-ordering rule detection

Examine the `autoSkillMap` skill labels. Many skills follow a stage naming
pattern: "Basic Attack I", "Basic Attack II", "Basic Attack III" or "Stage 1",
"Stage 2", etc. The validator should detect when a higher-numbered stage key
appears before a lower-numbered one.

**Detection logic:**

```js
// In validateRotation (or a helper called by it), after character-rule checks:
// Group rotation entries by their "stage family" — a prefix formed by stripping
// trailing numeric suffixes from the key (e.g. "basic_attack_" from
// "basic_attack_1", "basic_attack_2"). Within each family, verify that a step
// at index i with stage N is preceded somewhere earlier by stage N-1.
// If not, emit a warning with gate: 'sequence' and a note like:
//   "Basic Attack Stage 3 — Stage 2 should come first."
```

**Signature stays the same**: `validateRotation(rotation, rules)` — the stage
check is implicit and always runs regardless of the `rules` array.

Add a `skillMap` optional parameter so the validator can read labels for better
warning messages:

```js
export function validateRotation(rotation, rules, skillMap = null)
```

### 6b. Test coverage

Add to `test/rotation-validation.test.mjs`:

- "Basic Attack Stage 3 without Stage 2 produces a warning"
- "Basic Attack Stages in order produce no warning"
- "Stage ordering does not fire for non-staged skills"

---

## 7. Auto-triggered actions — `src/core/rotation-triggers.js` (new module)

Many skills in WuWa automatically trigger a follow-up. When the user adds the
trigger skill to their rotation, the sim should offer to insert the follow-up
automatically.

### 7a. Module shape

```js
// src/core/rotation-triggers.js
//
// Trigger rules: when the user adds `after` to the rotation, the system
// proposes inserting `inserts` immediately after it. The user sees both as
// real, editable steps; the auto-inserted step carries {autoInserted: true}
// in rotationMeta.
//
// Rules are curated and dataset-verified (same approach as rotation-rules.js).
// Add only clear, unambiguous auto-triggers — not "sometimes follows" but
// "always follows in the standard rotation."

export const TRIGGER_RULES = Object.freeze({
    // Carlotta: Chromatic Splendor is the forced follow-up to Art of Violence
    1107: [
        { after: 'skill', inserts: 'skill_chromatic_splendor',
          note: 'Chromatic Splendor automatically follows Art of Violence.' },
    ],
    // Add more characters as verified against the dataset.
    // Each entry: { after: string, inserts: string, note: string }
});

export function triggersForResonator(resonatorId) {
    return TRIGGER_RULES[Number(resonatorId)] ?? [];
}
```

**Data integrity gate**: after writing the table, run a verification pass that
every key in `after` and `inserts` exists in the resonator's `autoSkillMap`.
Add this as a data-integrity assertion in `test/rotation-triggers.test.mjs`
(new test file).

### 7b. Build editor integration

When the user adds a step to the rotation (via the palette click handler in
`build-editor.js`):

1. Check `triggersForResonator(build.resonatorId)` for rules matching the
   just-added key.
2. If a trigger matches AND the `inserts` key is not already the next step in
   the rotation: append `inserts` to the rotation immediately after the
   triggering step, and set `rotationMeta[insertedIndex] = { autoInserted: true }`.
3. Show a dismissible notification: "Auto-inserted: [skill label]. Tap × to
   remove." — one line, not a modal.

When the user removes an auto-inserted step (× button), call `removeRotationStep`
normally. The `autoInserted` marker is in `rotationMeta`; removing the step
removes both.

**Do not** auto-insert if the skill is already in the rotation at the right
position — detect duplicates to avoid double-insertion on re-renders.

---

## 8. Shared buff-bar component — `src/ui/components/buff-bar.js` (new)

The buff bar is used by both the build-rotation panel and the team-sim screen.
Extract it as a standalone component.

### 8a. API

```js
// mount(root, { buffWindows, totalTime, steps })
//   root        — DOM element to render into
//   buffWindows — Array<{name, startTime, endTime, kind?}>
//   totalTime   — float (seconds), the rotation's total duration
//   steps       — the steps array (for step-boundary markers)
// Returns { update(buffWindows, totalTime, steps) }

export function mount(root, { buffWindows, totalTime, steps }) { ... }
```

### 8b. Visual structure

```html
<div class="buff-bar">
  <!-- One strip per unique buff name -->
  <div class="buff-strip" style="--buff-start: 0.12; --buff-end: 0.67;"
       data-kind="sonata" title="[name] [effect summary]">
    <span class="buff-strip__label">[name]</span>
  </div>
  <!-- ... -->
  <!-- Step boundary markers (faint vertical lines at each step's startTime) -->
  <div class="buff-bar__steps">
    <div class="buff-bar__step-mark" style="--step-pos: 0.12;"></div>
    <!-- ... -->
  </div>
</div>
```

`--buff-start` and `--buff-end` are fractions (0–1) of `totalTime`. CSS uses
them: `left: calc(var(--buff-start) * 100%)`,
`width: calc((var(--buff-end) - var(--buff-start)) * 100%)`.

Buffs that persist to the end of the rotation (`endTime === -1`) fill to 100%.

### 8c. CSS in `styles/rotation.css`

```css
.buff-bar {
    position: relative;
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: var(--buff-bar-gap);
    padding: var(--sp-1) 0;
    overflow: hidden;
}
.buff-strip {
    position: relative;
    height: var(--buff-bar-h);
    background: color-mix(in srgb, var(--accent) 20%, transparent);
    border-left: 2px solid var(--accent);
    border-radius: 2px;
    /* width/left set via JS-written CSS vars */
    left: calc(var(--buff-start, 0) * 100%);
    width: calc((var(--buff-end, 1) - var(--buff-start, 0)) * 100%);
    min-width: 4px;
}
.buff-strip[data-kind="outro"] { border-left-color: var(--dmg-outro); background: color-mix(in srgb, var(--dmg-outro) 20%, transparent); }
.buff-strip[data-kind="chain"] { border-left-color: var(--dmg-liberation); background: color-mix(in srgb, var(--dmg-liberation) 20%, transparent); }
.buff-strip[data-kind="sonata"]{ border-left-color: var(--dmg-echo); background: color-mix(in srgb, var(--dmg-echo) 20%, transparent); }
.buff-strip__label {
    position: absolute;
    left: 4px; top: 50%;
    transform: translateY(-50%);
    font-size: var(--fs-xs);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: calc(100% - 8px);
    color: var(--text-secondary);
    pointer-events: none;
}
.buff-bar__step-mark {
    position: absolute;
    top: 0; bottom: 0;
    width: 1px;
    background: var(--line-dim);
    left: calc(var(--step-pos, 0) * 100%);
    pointer-events: none;
}
```

### 8d. Empty state

When `buffWindows` is empty, render:

```html
<div class="buff-bar buff-bar--empty">
    <span class="buff-bar__empty-msg">No conditional buffs active in this rotation.</span>
</div>
```

---

## 9. Build rotation panel — `src/ui/components/rotation-panel.js`

> **Status: not done.** Neither `rotation-panel.js` nor Build Page v2 has the
> buff bar, hit-breakdown expansion, "Fix it" button, or auto-insert badge.
> v2 is the current build-editor baseline — if picking this up, implement it
> there, not in this file. See the top-of-document status table.

### 9a. Add the buff bar

Below the existing step list, mount the buff-bar component:

```js
import { mount as mountBuffBar } from './buff-bar.js';
// After renderRoot, mount the buff bar into [data-region="buff-bar"]
```

Add to the rotation panel's HTML template:

```html
<div class="section">
    <h3 class="section__title">Active buffs</h3>
    <div data-region="buff-bar"></div>
</div>
```

Pass `sim.buffWindows`, `sim.totals.time`, `sim.steps` to `mountBuffBar`.
Update the buff bar on every rotation repaint.

### 9b. Step detail: collapsible hit breakdown

Each `.rot-step` row currently shows one line. Add an **expand control** so the
user can see the individual hits within a step (the `hits` array from
`resolveSkill`, which the step already carries as `step.hits` — check sim.js;
if not, add it in §3).

```html
<div class="rot-step [...]" data-index="...">
    <span class="rot-step__idx">1</span>
    <!-- existing fields -->
    <button class="rot-step__expand" data-action="expand-step"
            aria-expanded="false" title="Show hit breakdown">▾</button>
</div>
<!-- Collapse panel, hidden by default -->
<div class="rot-step-detail" data-for-index="..." hidden>
    <!-- one row per hit in step.hits -->
    <div class="rot-step-detail__hit" data-dmg-type="[category]"
         style="--dmg-color: var(--dmg-[category]);">
        <span class="rot-step-detail__hit-label">[hit id or ordinal]</span>
        <span class="rot-step-detail__hit-dmg">[expected damage]</span>
        <span class="rot-step-detail__hit-crit">[crit damage]</span>
    </div>
</div>
```

**Expand/collapse behavior:**

- Click `rot-step__expand` toggles `hidden` on the sibling `.rot-step-detail`
  and flips `aria-expanded`.
- At most one step is expanded at a time (collapsing the previous one is
  courteous but not required; leave this to visual design discretion).
- The expand button is **only shown when the step has >1 hit** — single-hit
  steps don't need expansion.

### 9c. Damage type colour coding on steps

Each `.rot-step` already has `data-type="[skillType]"`. Extend the CSS to use
the new `--dmg-*` tokens for the left border:

In `rotation.css`, replace the existing `--seg-color` per-type rules with:

```css
.rot-step[data-type="basic"]       { --seg-color: var(--dmg-basic); }
.rot-step[data-type="heavy"]       { --seg-color: var(--dmg-heavy); }
.rot-step[data-type="skill"]       { --seg-color: var(--dmg-skill); }
.rot-step[data-type="liberation"]  { --seg-color: var(--dmg-liberation); }
.rot-step[data-type="echo"]        { --seg-color: var(--dmg-echo); }
.rot-step[data-type="intro"]       { --seg-color: var(--dmg-intro); }
.rot-step[data-type="outro"]       { --seg-color: var(--dmg-outro); }
.rot-step[data-type="forte_basic"] { --seg-color: var(--dmg-basic); }
.rot-step[data-type="forte_heavy"] { --seg-color: var(--dmg-heavy); }
.rot-step[data-type="forte"]       { --seg-color: var(--dmg-skill); }
```

The damage panel and timeline use the same `data-type` attribute — these CSS
changes flow through automatically.

### 9d. Validation guidance improvements

The validation banner from P10 (`renderValidationBanner`) currently shows a
plain warning message. Extend it:

For each warning, add a **"Fix it" affordance** — a button that, when clicked,
reorders the rotation to place the missing prerequisite before the flagged step.

```js
// For each warning { index, skillKey, gate, note, requires }:
// Find the first satisfied `requires` key already in the rotation.
// If one exists: the "Fix it" button moves the flagged step to
// just after that requires entry.
// If none exists: the button adds the first `requires` key before the
// flagged step (as a new step). The inserted step carries
// { autoInserted: false } — it is user-visible but not machine-flagged.
```

Add to the banner HTML:

```html
<div class="rot-validation__item">
    <span class="rot-validation__icon">⚠</span>
    <span class="rot-validation__note">[note]</span>
    <button class="btn btn--warn btn--xs" data-action="fix-warning"
            data-index="[index]" data-requires="[requires[0]]">Fix</button>
</div>
```

Stage-ordering warnings (from §6) also show in this banner, with the note
derived from the validator.

### 9e. Auto-inserted step indicator

In `renderSteps`, when `step.index` has `rotationMeta[step.index]?.autoInserted`,
add a visual marker:

```html
<span class="rot-step__auto-badge" title="Auto-inserted by trigger">⚡</span>
```

Style `.rot-step__auto-badge` as a small inline icon, not a block element
(doesn't shift the grid). The step's `×` remove button removes it normally.

---

## 10. Team sim visualization — `src/ui/components/team-editor.js`

> **Status: not done, not superseded.** `team-editor.js` has not been touched
> since before P10. Unlike §9/§11/§12, this section is **not** affected by the
> build-editor-v2 baseline change — the team-sim screen is a separate page
> with no v2 equivalent yet. This section stands exactly as written.

This is the largest visual change in P11. The current "team editor" is a build
assignment UI + a simple totals table. P11 adds a full per-character column
visualization of the simulated rotation.

### 10a. Layout: per-character columns

The team sim section is split into N columns (1, 2, or 3 for each team slot).
Each column contains:

1. **Header** — character name, element indicator.
2. **Rotation steps** — the per-step breakdown for this character's segments,
   color-coded by damage type.
3. **Buff/effect bar** — the character's active buffs over the rotation.
4. **Totals row** — damage / DPS / heal / shield totals for this member.
5. **Edit rotation button** — opens inline rotation editing (§10b).

The columns sit side-by-side in a CSS grid. Empty slots render a placeholder
("Add a character to this slot"). When only 1 or 2 members, the unused columns
show the placeholder — they should not collapse the layout.

```html
<div class="team-sim-grid" data-members="[1|2|3]">
    <div class="team-col" data-slot="0">...</div>
    <div class="team-col" data-slot="1">...</div>
    <div class="team-col" data-slot="2">...</div>
</div>
```

### 10b. Step display within a column

Each character's `memberSteps` (from team-sim output §4) is rendered as a
vertical stack of step bars. Each step bar:

- Width = full column width.
- Height proportional to `stepDamage` (normalized within the column, with a
  minimum height of 4px so near-zero steps are visible).
- Background = `--dmg-[damageCategory]` at 60% opacity; border-left = solid
  `--dmg-[damageCategory]`.
- Label: skill short name, damage value.
- **Hover tooltip** (HTML `title` or a custom tooltip via CSS `::after`):
  - Step name (full label)
  - Damage (expected)
  - Crit damage
  - Damage type
  - Active buffs at this step (`activeBuffNames`)

Intro and outro steps are shown in the column of the character that casts them,
not the character they affect.

Steps are rendered in rotation order (intro → rotation → outro). A subtle
divider separates intro / rotation / outro groups within the column.

### 10c. Collapsible rotation groups

Within each column, the rotation steps group can be collapsed to show only
the group total (a single labelled bar) with a toggle to expand. Default:
expanded if ≤ 6 steps; collapsed if > 6.

```html
<div class="team-col__group" data-group="rotation">
    <button class="team-col__group-toggle" data-action="toggle-col-group"
            data-slot="[slot]" data-group="rotation">
        Rotation (5 steps, [total dmg]) ▾
    </button>
    <div class="team-col__group-steps" hidden>
        <!-- step bars -->
    </div>
</div>
```

### 10d. Team-level buff bar

Below the columns, a single **team-level buff bar** spans the full width of
the team-sim section. It shows outro buffs contributed by each member (from
`simulateTeamRotation`'s `amplifyContext` and `outroBuffs` tracking). Each
strip is labelled "[CharacterName] outro" and coloured with the character's
element colour.

Mount the shared buff-bar component (§8) here, populated with the team-level
buff windows.

### 10e. Inline rotation editing

Each column's "Edit rotation" button opens an **inline rotation editor panel**
directly within the team sim section, below the column. It uses the same
rotation-panel component as the build editor:

- Mount a rotation-panel instance into a `<div class="team-col__rot-editor">`.
- Edits are saved to the member's build via `storage.saveBuild` and trigger an
  immediate team sim re-run.
- The panel closes on a second click of "Edit rotation" or an explicit "Close"
  button.

Do not navigate away from the team sim screen to edit the rotation. The edit
happens in-place.

### 10f. Totals row per column

Below each column, show:

```text
Total DMG: [x]   Off-field: [x]
Heal: [x]        DPS: [x]
```

Pulled from `memberTotals` in the team sim result.

### 10g. Team totals row

Below all columns, show the combined team totals. This already exists as
`ts.totals` — retain it, but style it more prominently than the per-member rows.

### 10h. CSS additions in `styles/rotation.css` and/or `styles/team.css`

If a `styles/team.css` file does not exist, create it. Do not pile all team-sim
styles into `rotation.css` — keep them separate by concern.

---

## 11. Echo stat UX — `src/ui/components/build-editor.js`

> **Status: done in spirit, in Build Page v2 instead.** v2's echo slot cards
> already use click-to-toggle substat chips, not `<select>` dropdowns — the
> markup/class names below are historical, not what was actually built.

Currently echo substats are selected with `<select>` dropdowns. Replace them
with **stat chips**: a row of small toggleable chips, one per available substat.
The selected stat is highlighted (`is-selected`); clicking a different chip
selects it. This reduces the interaction to a single click (no open/pick/close
cycle).

### 11a. Available substat pool

The list of possible echo substats is: ATK%, HP%, DEF%, Crit Rate, Crit DMG,
Energy Regen, Resonance Liberation DMG Bonus, Resonance Skill DMG Bonus, Basic
Attack DMG Bonus, Heavy Attack DMG Bonus, and Flat ATK/HP/DEF. Source this list
from a constant (don't hardcode in the template) placed at the top of
`build-editor.js` or in a new `src/data/echo-substats.js`.

### 11b. Chip rendering

```html
<div class="echo-substat-chips" data-echo-slot="[i]" data-substat-idx="[j]">
    <!-- One chip per available substat -->
    <button class="echo-chip [is-selected?]"
            data-action="set-echo-substat"
            data-slot="[i]" data-sub-idx="[j]" data-stat="[statKey]"
            title="[stat display name]">
        [short label]  <!-- e.g. "CR", "CD", "ATK%", "ER" -->
    </button>
    <!-- ... -->
</div>
```

Short labels: CR = Crit Rate, CD = Crit DMG, ATK = ATK flat, ATK% = ATK ratio,
ER = Energy Regen, Lib = Liberation DMG, Skill = Skill DMG, Basic = Basic ATK
DMG, Heavy = Heavy ATK DMG. Keep labels ≤6 chars — these are chips, not
sentences.

### 11c. Echo main stat

The echo main stat can also be a chip row (filter to valid mains for the echo
cost class — 4-cost mains differ from 3-cost). If this list is too long for
chips, keep a dropdown for the main stat and chips for substats only.

### 11d. Value input

Each selected substat still needs a numeric value (the roll amount). Retain a
compact `<input type="number">` per selected substat below or next to the chip
row. Do not remove value inputs — they are critical for stat calculation.

---

## 12. Sonata readability — `styles/editor.css` and `build-editor.js`

> **Status: done in spirit, in Build Page v2 instead**, as a compact pill
> strip rather than the stacked-card layout below — a deliberate, more
> compact design (effect text moved to a hover-box per direct user feedback).

The Sonata display is currently a cramped pill. Rewrite it as a readable card.

### 12a. Per-sonata card structure

```html
<div class="sonata-card" data-set-id="[id]">
    <div class="sonata-card__head">
        <span class="sonata-card__name">[Set name]</span>
        <span class="sonata-card__count">[N] pcs</span>
    </div>
    <div class="sonata-card__effect">
        <!-- One row per active bonus tier (2-pc, 5-pc) -->
        <div class="sonata-card__tier" data-active="[true|false]">
            <span class="sonata-card__tier-label">[2-pc]</span>
            <span class="sonata-card__tier-desc">[effect summary]</span>
        </div>
    </div>
</div>
```

The 2-piece and 5-piece bonuses each get their own row. Inactive tiers (e.g.
only 2 equipped, so 5-piece is locked) are dimmed.

### 12b. Layout

Show at most two distinct sonata cards (the two sets contributing to the build).
If all 5 echoes share the same set, show one card with "5 pcs". Cards stack
vertically in the echo section, not horizontally in a cramped row.

---

## 13. Test coverage requirements

P11 must add the following tests:

**`test/rotation-triggers.test.mjs`** (new):

- All `after` and `inserts` keys reference real `autoSkillMap` entries
  (data integrity check, same pattern as rotation-validation data integrity test).
- Triggering a skill proposes the correct follow-up.
- Already-present follow-up is not duplicated.

**`test/rotation-validation.test.mjs`** (extend):

- Basic stage 3 before stage 2 emits a warning.
- Basic stages in correct order emits no warning.

**`test/sim-enrichment.test.mjs`** (new):

- Steps carry `damageCategory` (one of the 7 valid values).
- `buffWindows` is non-null on a result with conditional buffs active.
- `buffWindows` is empty on a rotation with only unconditional effects.
- `deriveBuffWindows` produces contiguous windows with correct start/end steps.

All existing tests must continue to pass.

---

## 14. Verification method

> **Refreshed 2026-06-21** — the script below originally predated
> `build-editor-v2.js` and assumed a standalone `buff-bar.js` would exist;
> it doesn't (see §8 status). Updated to match the actual current tree.

After completing all items above, run in this order:

```bash
# 1. Syntax check every changed module
node --check src/core/sim.js
node --check src/core/team-sim.js
node --check src/core/build.js
node --check src/core/rotation-graph.js
node --check src/core/rotation-triggers.js
node --check src/ui/components/rotation-panel.js
node --check src/ui/components/team-editor.js
node --check src/ui/components/build-editor.js
node --check src/ui/components/build-editor-v2.js

# 2. Full runtime module load sweep (ALWAYS do this — syntax check is not enough)
node --input-type=module << 'EOF'
const ls = new Map();
globalThis.localStorage = { getItem:k=>ls.get(k)??null, setItem:(k,v)=>ls.set(k,v), removeItem:k=>ls.delete(k) };
globalThis.window = globalThis;
globalThis.document = { createElement:()=>({style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}}}), querySelector:()=>null, querySelectorAll:()=>[], addEventListener:()=>{} };
globalThis.HTMLElement = class {};
const mods = [
    './src/core/formula.js','./src/core/stats.js','./src/core/build.js',
    './src/core/skill.js','./src/core/sim.js','./src/core/team-sim.js',
    './src/core/off-field.js','./src/core/buffs.js','./src/core/team.js',
    './src/core/rotation-graph.js','./src/core/rotation-rules.js',
    './src/core/rotation-state.js','./src/core/rotation-triggers.js',
    './src/data/storage.js','./src/ui/dom.js','./src/ui/icons.js',
    './src/ui/components/damage-panel.js','./src/ui/components/team-editor.js',
    './src/ui/components/rotation-panel.js','./src/ui/components/build-editor.js',
    './src/ui/components/build-editor-v2.js',
];
let ok=0; for (const m of mods) { try { await import(m); ok++; } catch(e){ console.error('FAIL',m,e.message); } }
console.log('Modules:', ok+'/'+mods.length);
EOF

# 3. All test suites (12 files as of this update)
for t in test/*.test.mjs; do node "$t" || echo "FAILED: $t"; done
```

All modules must load. All tests must pass. If any fail, fix before staging.

---

## 15. Files changed summary (expected)

| File | Change type |
| --- | --- |
| `styles/tokens.css` | Add 7 damage-type colour tokens + buff-bar sizing |
| `styles/rotation.css` | Extend type colours; add buff-bar, step-detail, auto-badge |
| `styles/editor.css` | Sonata card; echo chip; auto-inserted step |
| `styles/team.css` | New — team column layout, step bars, group toggles |
| `src/core/sim.js` | Add `damageCategory`, `activeBuffNames`, `buffWindows`, export `deriveBuffWindows` |
| `src/core/team-sim.js` | Add `memberSteps`, `memberBuffWindows` to return |
| `src/core/build.js` | Add `rotationMeta`, `setRotationMeta`; keep mutation helpers in sync |
| `src/core/rotation-graph.js` | Extend `validateRotation` for stage ordering; add `skillMap` param |
| `src/core/rotation-triggers.js` | New — auto-trigger rule table |
| `src/ui/components/buff-bar.js` | New — shared buff/effect timeline component |
| `src/ui/components/rotation-panel.js` | Buff bar mount; step expansion; guidance "Fix" buttons; auto-badge |
| `src/ui/components/team-editor.js` | Full team-sim visualization |
| `src/ui/components/build-editor.js` | Echo stat chips; Sonata card; auto-inserted step display |
| `test/rotation-triggers.test.mjs` | New |
| `test/sim-enrichment.test.mjs` | New |
| `test/rotation-validation.test.mjs` | Extend with stage-ordering cases |

---

## 16. Open items deferred from P11 to later phases

- **3-way team comparison** — P13 (team suggestions phase). The per-character
  column design above is intentionally self-contained so P13 can render three
  `team-sim-grid` instances side by side without rework.
- **Stat priority display on build page** — P12 (optimizer phase).
- **Suggested teams on build page** — P13.
- **"Appears in teams" indicator on build page** — P13.
- **Mobile layout** — out of scope until explicitly scheduled.
- **Enemy count** — permanently out of scope; always single-enemy.

---

## 17. Hand-off — resolved 2026-06-26 (historical: design input needed, added 2026-06-21)

Every item below was resolved in the 2026-06-26 wrap-up session.

### 17a. §10 — team-sim screen overhaul · RESOLVED

**Decision: Option A** — the v2 scoped `.bv2` system, matching the build page.
Shipped as `team-editor-v2.js` (already on the tree before this session;
this hand-off note was simply stale). The shared bits called out in the
original lean — the buff-window renderer — were extracted into
`src/ui/components/buff-bar.js` in this session (see §8 in the status table).
`stepTypeInfo`/`STEP_TYPE`-equivalent colour mapping (`DMG_COLOR`/`DMG_BADGE`)
remains duplicated per-page rather than extracted; revisit only if a third
consumer (P13's 3-way compare) needs it.

Inline rotation editing (the last paragraph of the original note) was **not**
built — superseded by navigating to the member's Build page instead, by
decision in this session (see §10's table row).

### 17b. Addendum §G — buff-bar icons · RESOLVED

Two glyphs committed to `assets/icons/misc/`: `gen-buff-icon.png` (default)
and `defensive-buff-icon.png` (heal/shield/resist/tenacity/mitigation
keyword match). Registered in `icons.js`'s `KINDS.misc` with a `.png`
extension override (the per-kind `ext` field is new — every other kind still
defaults to `.webp`). Colour mapping rule (this session, supersedes the
original sonata-crest/element-icon idea): element-specific buffs use the
matching `--el-*` token; damage-type-specific buffs (e.g. "Heavy Attack DMG
+25%") use the matching `--dmg-*` token via the new `detectDamageType()` in
`src/core/sonata-buffs.js`; everything else uses the new `--buff-neutral`
token. Icon *shape* (generic vs. defensive) is a separate, independent
classification from colour.

### 17c. §I visual polish · still open, optional, low priority

Unchanged — no design input given on the specific literal ask. The §I
highlighting logic shipped (`formatTipDesc`, applied to every hover-box) and
was substantially extended in the final wrap-up pass above (per-stage
description resolution via `extractSkillSection`, `## Heading` rendering,
scroll/viewport-collision handling) — but that work is orthogonal to this
item. Still open only: tune the highlight colour/weight (`.bv2-tip-num` /
`.bv2-tip-el` in `build-v2.css`) and decide whether skill-family terms
("Resonance Skill", etc.) should also be emphasized. Pure CSS / one regex —
do whenever.
