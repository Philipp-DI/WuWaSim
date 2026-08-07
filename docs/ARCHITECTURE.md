# ARCHITECTURE — how WuWaSim actually works

The one document to read end-to-end when joining the project. Everything here
is traceable to code; function names are given so you can jump straight in.
Companion docs: `GLOSSARY.md` (what the words mean), `HISTORY.md` (how we got
here), `../CLAUDE.md` (the rules and invariants).

---

## 1 · The 60-second summary

WuWaSim is a damage calculator + rotation simulator for the game
*Wuthering Waves*. A player configures a **build** (one character — a
"resonator" — plus weapon, echo gear, and skill levels), writes a **rotation**
(an ordered list of ability casts), and the app computes per-cast damage,
running totals, DPS, and team-level results.

Three properties shape everything:

1. **Zero build step.** Plain ES modules, no bundler, no framework, no
   runtime dependencies. `index.html` loads `src/ui/app.js` directly; the
   same core modules are imported by Node tests. Deployable as static files.
2. **Pure core.** Everything under `src/core/` is deterministic math — no
   DOM, no fetch, no global state. Same input, same output. The UI renders
   what the core returns; it never computes damage itself.
3. **Compiled data.** The game's numbers arrive via community data sources,
   get compiled offline into one JSON (`data/wuwa-data.json`), and the
   browser only ever loads that. Generated files are never hand-edited.

```text
   [offline]  community data ──▶ tools/preprocess.mjs ──▶ data/wuwa-data.json
   [offline]  wuwa-data.json ──▶ tools/optimize.mjs  ──▶ data/wuwa-meta.json
   [browser]  loader.js ──▶ dataset ──▶ src/core/* sim ──▶ src/ui/* render
```

---

## 2 · Data pipeline (offline, run by the maintainer)

```text
data/extracted-nanoka/characters/*.json   ← source: nanoka.cc dumps (56 files, schema v9)
data/extracted-nanoka/{echo,weapon,…}.json + Arikatsu BinData tables (fetched)
data/patch.json                           ← curated: manual field overrides
data/reference-rotations.json             ← curated: per-character reference rotations
data/effect-overrides.json                ← curated: effect trigger/window authoring
data/forte-data.json                      ← committed extraction (tools/extract-forte.mjs)
data/skill-map.json                       ← curated: skill keys, cast times, damage-row ids
          │
          ▼  node tools/preprocess.mjs
data/wuwa-data.json                       ← THE dataset (~5 MB, committed, never hand-edited)
data/data-version.json                    ← content-hash manifest (browser cache-buster)
          │
          ▼  node tools/optimize.mjs      (also reads reference-rotations.json)
data/wuwa-meta.json                       ← precomputed stat weights, suggested builds, teams
docs/meta-validation.md                   ← generated QA report (gitignored)
```

What `preprocess.mjs` does, in order: download/refresh secondary tables →
resolve localization text → project each character (damage rows, skill trees,
chains, inherent skills, per-hit energy/Concerto generation, cooldowns,
`formulaType` tags) → project weapons, echoes, sonata sets → apply curated
overrides → emit one lean JSON. The critical subtlety: each **display row**
(what the game UI shows as one line) is matched to its exact raw damage
instances by comparing full 20-level multiplier vectors (`matchRowHits`), and
the damage-type tag is read off those instances (`resolveInstanceFormula`) —
never parsed from descriptive text.

What `optimize.mjs` does: for covered characters, sim a reference build
against a grid of gear candidates (weapons × sonata sets, each with its own
co-optimized substats), derive per-substat marginal weights, rank suggested
teams (enumerate → prune by synergy tags → score with the real team sim), and
freeze it all into `wuwa-meta.json`. The runtime never re-derives any of
this; it applies the frozen numbers (`src/core/stat-ranking.js`) or falls
back to live simulation.

**Runtime loading** (`src/data/loader.js`): fetch `wuwa-data.json` +
`patch.json` in parallel, deep-merge by `id`. `src/data/meta-loader.js` does
the same for `wuwa-meta.json`. `data-version.json` hashes bust the CDN cache.

---

## 3 · Life of a damage number (worked trace)

Question a new dev should be able to answer: *"Carlotta's Liberation shows
1.2M on the build page — where did that number come from, and why does the
Skill DMG Bonus stat scale it rather than Liberation DMG Bonus?"*

**Step 0 — source data.** `data/extracted-nanoka/characters/1107.json`
(Carlotta) contains her Liberation node: display rows with 20-level
multiplier vectors, and raw damage instances each carrying the game's own
type tag (`type: 4` = "counts as Resonance Skill DMG"). `preprocess.mjs`
emits into `wuwa-data.json`:

```jsonc
// dataset.skillMap["1107"].liberation  (skill-map.json curated entry, enriched)
{ "skillType": "liberation",       // MECHANICAL: what kind of cast this is
  "formulaType": "skill",          // DAMAGE-TYPE: which DMG-bonus bucket the hits use
  "damageIds": [11070003001],      // -> rows in dataset.damageTable["1107"]
  "stepDuration": 1.8, "cooldown": 25 }
// dataset.damageTable["1107"], row 11070003001
{ "element": 1 /* Glacio */, "relatedProp": 7 /* scales off ATK */,
  "mults": [ …, 4.0271 ] }         // 402.71% at skill level 10
```

The `skillType` / `formulaType` split is the single most important idea in
the engine: *what you cast* (mechanical) and *how the damage is categorized
for bonuses* (data-driven from the game's type tag) are different axes, and
several invariants in CLAUDE.md exist to keep them from being conflated.

**Step 1 — the build.** The user's build (`src/core/build.js`,
persisted by `src/data/storage.js` in localStorage) holds
`rotation: ['intro', 'skill', 'liberation', …]` (plain skill keys — the
persisted format is always this linear array), `skillLevels`, weapon, echoes,
and `effectToggles`.

**Step 2 — the simulator walks the rotation.**
`simulateRotation({ build, dataset, target })` in `src/core/sim.js`:

1. `resolveTotalStats(build, dataset)` (`stats.js`) — folds resonator base
   stats, weapon base + passive, echo main/substats, sonata always-on pieces,
   unlocked stat nodes, and satisfied conditional clauses into one
   `TotalStats` object (with a per-source `breakdown` the UI renders as
   "show your math").
2. For each rotation step: look up the skill definition
   (`effectiveSkillMap` — curated `skillMap` first, auto-generated fallback),
   resolve which chain/inherent effects are active *at this step*
   (trigger × window evaluation, see §4), then call `resolveSkill`.
3. `resolveSkill` (`skill.js`) — for each damage row: pick the multiplier by
   skill level (`mults[skillLv-1]` → 4.0271), apply `multiplierUp` effects
   (matched against the NODE `skillType`, `'liberation'`), build the formula
   input with `skillType: formulaType` (`'skill'`), and call `computeDamage`.
4. `computeDamage` (`formula.js`) — the consensus WuWa equation:

   ```text
   Final = BaseDmg × ResMult × DefMult × (1 − DmgReduction) × CritMult × BonusMult
   BaseDmg   = ATK × 4.0271
   BonusMult = (1 + dmgBonus) × (1 + amplify) × (1 + deepen)
   dmgBonus  = dmgBonusByElement[1]        // Glacio DMG Bonus
             + dmgBonusBySkillType['skill'] // ← the formulaType bucket: THIS is why
                                            //   Skill DMG Bonus scales her Liberation
   CritMult  = 1 + critRate × (critDmg − 1)  // expected-value form
   ```

   The result carries a full `breakdown` tree — the UI never re-derives math.
5. Back in `sim.js`: per-step buff windows scale the numbers per-step
   (`applyBuffsToSteps`, §4), cast times accumulate into the timeline,
   cooldowns annotate violations (diagnostic only), energy/Concerto gauges
   accumulate, and the result (`steps[]`, totals, DPS, `buffWindows`,
   `effectWindows`, `stateWindows`, `energyTrace`) goes to the UI.

**Step 3 — render.** `build-editor/` renders the step bars, totals
donut, buff-window strips, and warnings straight from the sim result.

---

## 4 · Life of a buff

"Buff" covers several mechanically different things. The first question is
always **which source**, because each source has exactly one path into the
damage math (the paths are disjoint by construction — an invariant):

| # | Source | Parsed by | Applied by | Time-resolution |
| --- | --- | --- | --- | --- |
| 1 | Always-on stats: weapon secondary, echo main/substats, sonata 2pc, stat nodes | `preprocess.mjs` → dataset | `stats.js resolveTotalStats` | constant |
| 2 | Weapon passives (unconditional part) | `buffs/weapon-buffs.js weaponPassiveStats` | folded into `resolveTotalStats` | constant |
| 3 | Weapon/sonata **conditional clauses** ("when at max stacks, gain crit…") | `buffs/conditional-buffs.js` | folded into stats + per-hit amplify scopes (`sim.js weaponAmplifyScopes`); `triggerability.js` gates on whether the rotation can satisfy the condition | constant while satisfiable |
| 4 | **Chain/inherent effects** (S1–S6 nodes, inherent skills) | `preprocess.mjs` + curated `effect-overrides.json` | `buffs.js` trigger×window evaluation per step; folded per-hit in `skill.js resolveChainInherentContext` | windowed per step |
| 5 | **Sonata 5pc window buffs** ("gain 15% ATK for 30s upon healing") | `buffs/sonata-buffs.js parseSonataBuffs` | `buffs/buff-windows.js computeBuffWindows` → stack ramp (`buffs/buff-timeline.js`) → `applyBuffsToSteps` | windowed per step, stack-aware |
| 6 | **Echo aura** (Bell-Borne DMG boost) | `preprocess.mjs extractEchoTeamBuff` | synthesized as a window in `computeBuffWindows` (own multiplicative amplify layer) | windowed per step |
| 7 | **Outro → incoming-resonator transfer** ("next resonator +25% Glacio DMG") | `buffs.js incomingResonatorContribution` | team sim applies it flat to the receiving member's segment | flat per segment |

Key mechanics shared by the windowed paths (4–6):

- **Trigger × window.** An effect fires on a trigger (`castMatch` against the
  MECHANICAL step `skillType` via `phraseTypesForStep` — never the damage
  `formulaType` —, `stateEnter`, `modeMatch`, or `stepHeal > 0` for
  heal-triggered sets) and stays live for its window (`seconds`, `persist`,
  `stateBound`, `untilConsumed`, `always`, `thisCast`).
  `thisCast` is the odd one: ON only for the triggering cast ITSELF, for a buff
  phrased "when casting X, that cast gains …" (Changli's Secret Strategist).
  `persist` cannot express it — its castMatch check reads strictly EARLIER
  steps, so it misses the very cast the buff is for. Curated-only; the parser
  never emits it.
- **Stacks ramp honestly.** A stacking buff climbs 0→cap per qualifying step
  and decays (`buffs/buff-timeline.js stackTimeline`); multi-trigger stacking buffs
  are grouped into one window over the union of their triggers so they never
  double-count (`groupStackingBuffs`).
- **A stack count has exactly one source, and says which** (2026-07-31).
  `buffs.js scaleEffect` resolves in precedence order: the user's own count
  (`build.effectStacks`) → a curated resource gauge
  (`rotation-resources.js computeResourceTimeline`, e.g. Changli's Enflamement)
  → a resolvable `castMatch` stack trigger (fires so far, capped) → **one stack,
  flagged `stacksUnknown`**. That last case is not a guess dressed as a number:
  most remaining stack sources are things a rotation cannot describe (an enemy's
  Havoc Bane count, which teammates you brought, a gauge with no definition), so
  the sim credits the conservative floor and the build editor renders a stepper
  so the user can supply the real count. Never fall back to `maxStacks` — Lynae's
  Premixed Hue is 55% per stack to a cap of 25.
- **Conditional-by-default.** Any effect whose condition text says
  when/after/while/upon/duration is a toggle that defaults OFF; unconditional
  effects bake into totals and never appear as windows.

**Team-wide distribution** (a buff whose recipient is the whole team) exists
for three of these sources, and the three lanes are deliberately disjoint:

1. Chain/inherent team effects — windowed where a trigger + duration is
   derivable (`buffs.js teamWideWindowSpecs`, windows derived from CAST
   EVENTS in team time by `team-sim.js accrueChainEffectWindows`); an honest
   flat residue remains for the few effects with no derivable timing
   (`teamWideContribution`).
2. Weapon/sonata conditional clauses with a team recipient (e.g. Kumokiri) —
   `stats.js weaponSonataTeamWide`, currently flat for the whole rotation
   (the documented open item in `TEAM-BUFF-TIMELINE-PLAN.md`).
3. Window-path sonata buffs + echo auras — accrued onto a chronological
   `teamBuffTimeline` as segments simulate; later segments literally receive
   the overlapping windows (`externalBuffWindows` into `simulateRotation`),
   so a 30s buff cast at t=50s covers exactly the teammates playing inside
   50–80s and nothing else.

If you are adding a buff source: pick the ONE path that matches its shape.
Never let a buff flow through two paths — that is the double-count bug class
this table exists to prevent.

---

## 5 · Life of a team sim

`simulateTeamRotation({ team, resolveBuild, dataset, target, … })` in
`src/core/team-sim.js`. A team is up to 3 members (`team.js`), each with
their own build + rotation.

**Segment sequence.** Members play strictly in slot order, `passCount` times
around. Each member's turn expands to up to three segments on one absolute
team-time axis:

```text
[Intro (auto)] → [authored rotation (minus any authored intro/outro)] → [Outro (auto)]
```

Intro/Outro segments are auto-injected at swap boundaries (`simulateIntro`,
`withoutAutoCastSteps`); slot 0 on pass 0 gets no intro (nobody swapped in).
The outgoing member's Outro produces an amplify context the incoming member's
segments receive (path 7 above).

**Shared state across segments, in team time:**

- **Enemy status timeline** (`enemy-status.js`) — negative statuses live on
  the enemy and are shared: any member's application satisfies another
  member's "target has Havoc Bane" gate.
- **Team buff timeline** — §4's lane 3: windows accrued as segments simulate,
  delivered to later overlapping segments.
- **Cooldown ledger** (`cooldowns.js`) — re-annotated in team time so a CD
  spans passes and swap gaps (diagnostic overlay; never changes damage).
- **Per-member energy ledger** (`team-energy.js applyEnergyEvent`) — own
  casts + a 50% share of others' generation, each × the receiver's own ER.
- **Concerto gauge** per member — built by the active member's casts; swap
  readiness reported per boundary (`result.concerto.swaps`); gating the
  handoff on it is opt-in (`enforceConcerto`, default off).

**Derived openers** (`opener.js`, opt-in via `deriveOpeners`; the team page
and offline ranking turn it ON): before a member's pass, if their consuming
Liberation would arrive with a short energy gauge, a cooldown-aware greedy
filler splices real casts in front of it — the shortfall becomes TIME. If
nothing can generate the energy, the cast is GATED (dropped and reported).
This is the one sanctioned exception to "energy never gates damage".

**Off-field contributions** (`off-field.js`) — coordinated attacks, turrets,
outro bursts from benched members, optionally gated on that member's active
states.

**Output:** per-member segments and totals, team totals/DPS,
`memberEnergy`, `concerto`, `cooldownViolations`, `openerAdjustments`,
`memberStackedBuffWindows` (the team-page timeline renders buffs from the
same windows that scaled the damage — display and math cannot disagree).

Because buffs are delivered by literal time overlap, **member order matters
to team damage** — as it does in-game.

---

## 6 · Module map

### `src/core/` — pure engine (no DOM, no fetch; safe to import in Node)

| Module | Responsibility |
| --- | --- |
| `types.js` | Central JSDoc typedefs (Build, TotalStats, SimResult, …) — type-only, no runtime code |
| `formula.js` | The WuWa damage equation + heal/shield formula; returns full breakdown trees |
| `skill.js` | Resolve one skill cast: damage rows × level multiplier × effects → formula calls |
| `stats.js` | `resolveTotalStats` — Build + dataset → TotalStats with per-source breakdown |
| `sim.js` | Solo rotation walk: steps, timing/cast-time resolution, energy trace, totals |
| `team-sim.js` | Team sequencing: segments, shared timelines, cross-member buffs, gauges |
| `build.js` | Build schema, normalization, skill keys |
| `team.js` | Team model (3 slots, names, slot ops) |
| `buffs.js` | Unified BuffEffect model; chain/inherent trigger×window evaluation; team-wide partition — **its header carries the buff-path manifest (the three disjoint lanes)** |
| `buffs/buff-windows.js` | Window machinery: derive every window a rotation opens, scale steps by them, one shared stack-count authority |
| `buffs/buff-timeline.js` | Per-step stack ramp/decay for stacking buffs |
| `buffs/sonata-buffs.js` | Parse sonata 5pc/3pc effect text into window-buff specs |
| `buffs/conditional-buffs.js` | Parse weapon/sonata conditional clauses into stat contributions |
| `buffs/weapon-buffs.js` | Weapon passive (unconditional) stat extraction |
| `triggerability.js` | Can this rotation satisfy a conditional clause's activation at all? |
| `enemy-status.js` | Shared enemy negative-status timeline + who can inflict what |
| `off-field.js` | Benched-member damage (coordinated/turret/outro-burst), state-gated |
| `rotation-graph.js` | Sim-time rotation graph; grant-aware validation (`analyzeRotation`) |
| `rotation-rules.js` | Curated per-character tables: prerequisites, states, grants, resources |
| `rotation-state.js` | Per-step character-state timeline (enter/exit/consume semantics) |
| `rotation-triggers.js` | Auto-inserted forced follow-up steps |
| `cooldowns.js` | Diagnostic cooldown overlay (activation-window model) |
| `opener.js` | Derived opener padding: CD-aware greedy energy filler / gating |
| `team-energy.js` | Per-member Resonance Energy ledger + closed-form minimum-ER |
| `team-er.js` | Resolve the ER target shown for a build (team override → character default) |
| `echo-rules.js` | Echo gear legality: cost tiers, main-stat pools, sub-main derivation |
| `stat-priority.js` | Turn marginal-weight vectors into ranked, per-roll stat priorities |
| `stat-ranking.js` | Apply the frozen meta weights to the user's actual build |
| `live-weights.js` | Live per-roll marginal values computed at the user's current stats |
| `substat-allocate.js` | Greedy marginal substat allocator (co-optimization) |

### `src/data/` — IO boundary

| Module | Responsibility |
| --- | --- |
| `loader.js` | Fetch + deep-merge `wuwa-data.json` and `patch.json` |
| `meta-loader.js` | Fetch + validate `wuwa-meta.json`; suggested-build/team lookups |
| `storage.js` | localStorage persistence: builds, teams, rotation/echo presets |
| `build-codec.js` | Build ↔ URL-safe share string |

### `src/ui/` — rendering only

| Module | Responsibility |
| --- | --- |
| `app.js` | Boot + hash routing (`#roster`, `#new/<id>`, `#edit2/<id>`, `#party`, `#compare`, `#mybuilds`) |
| `dom.js` | Tiny `html`/`render`/`on` template helpers (no virtual DOM) |
| `icons.js`, `tooltip.js`, `tip-format.js` | Icon resolution, shared hover box, description formatting |
| `components/build-editor/` | THE build page: `index.js` mount/paint + panel modules (state, shared, menus, resonator-card, echoes, rotation, ability-overview, stat-priority, suggested-teams-panel, stats-panel, bind) |
| `components/team-editor-v2.js` | Team simulator page (timeline, buff lanes, energy chart) |
| `components/compare-v2.js` | 6-build / 3-team comparison |
| `components/roster-v2.js`, `my-builds-v2.js` | Roster browser; saved-builds manager |
| `components/echo-picker-v2.js`, `weapon-picker.js`, `modal-picker.js` | Pickers |
| `components/buff-bar.js` | Shared lane-packed buff-strip renderer (build + team pages) |
| `components/suggested-teams.js`, `energy-chart.js`, `v2-header.js` | Meta panels, ER timeline, shared chrome |

### `tools/` — offline (Node only)

| Tool | Responsibility |
| --- | --- |
| `preprocess.mjs` | CLI entry + orchestration: compile all sources → `wuwa-data.json` (stages in `tools/preprocess/`) |
| `preprocess/download.mjs` | Source fetch, nanoka raw-data loading, icon-URL resolution |
| `preprocess/text.mjs` | Localization resolution + skill-description formatting |
| `preprocess/constants.mjs` | Shared game-id tables (elements, weapon types, rarity/cost classes) |
| `preprocess/base-stats.mjs` | Property dictionary, growth curves, damage/base-stat/skill-tree tables |
| `preprocess/skill-rows.mjs` | Display-row classification, data-driven formula types, skill keys/labels, multiplier parsing |
| `preprocess/effects.mjs` | Chain/inherent effect parsing (trigger × window), resonance modes, role tags |
| `preprocess/resonators.mjs` | Resonator projection — the full nanoka kit projection lives here |
| `preprocess/weapons.mjs`, `echoes.mjs`, `sonatas.mjs` | Weapon / echo / sonata-set projection |
| `preprocess/skill-scope.mjs` | Bind an effect to the skills its clause NAMES, and to the state its clause gates it behind |
| `preprocess/tune-strain.mjs` | Read the Tune Strain chain (responder, +1 cap raise, 0.12%/point) off each Tune Break node |
| `preprocess/status-apply.mjs` | Derive which casts inflict a negative status, from each kit's own clauses |
| `preprocess/inherent-replace.mjs` | Mark an inherent a sequence node states it REPLACES, so the two never stack |
| `optimize.mjs` + `optimize/*` | Precompute `wuwa-meta.json`: weights, suggested builds, team rankings |
| `extract-forte.mjs` | Distill Forte-gauge channels → `data/forte-data.json` |
| `audit-effects.mjs` | QA report of unresolved effect triggers → `docs/effect-audit.md` |
| `fetch-nanoka-*.mjs`, `download-icons.mjs`, `gen-manifest.mjs` | Source refresh utilities |

---

## 7 · Where numbers are curated by hand

If the sim disagrees with the game, check these before suspecting the engine —
they are the human-authored inputs, in lookup order:

| File | What it overrides |
| --- | --- |
| `data/patch.json` | Any dataset field, deep-merged by `id` at load time |
| `data/skill-map.json` | Curated skill keys, damage-row ids, per-type `stepDuration` fallbacks (only ~5% of steps still use them — see `data/actionable-times.json`) |
| `data/actionable-times.json` | Per-step **measured** timing markers (`stepDuration`, `nextAttAt`, `damageAt`/`resolvesAt`, `freezeTime`), read from the game's own animation assets; stamped onto `autoSkillMap` by `preprocess.mjs` (docs/TIMING_MODEL.md) |
| `data/notify-semantics.json` | Generated inventory of all 202 animation-notify classes with the game's own `GetNotifyName()` label and dead-property analysis (`tools/extract/scan_notify_semantics.mjs`) — the authority on what a notify does |
| `data/timing-overrides.json` | Curated timing decisions — `pinnedMontage` (which candidate animation a key resolves to) and `needsStateModel` (keys gated on an unmodelled character state) |
| `data/reference-rotations.json` | The rotation used for empty builds and all optimizer scoring |
| `data/effect-overrides.json` | Chain/inherent effect triggers/windows the parser can't derive (+ a `deferred` section for effects needing engine features) |
| `src/core/rotation-rules.js` | `ROTATION_RULES`, `STATE_DEFS`, `STAGE_GRANTS`, `SWAP_IN_ENTRY`, `RESOURCE_DEFS` — all kit-text-verified or maintainer-verified in-game |
| `tools/optimize/synergy-hints.js` | `CURATED_TEAMS` + role-tag affinity driving team suggestions |

Known honest limitations (documented, not bugs): ~5% of steps still fall back
to a fabricated per-type `stepDuration` (turret/summon/DoT damage with no player
animation to measure — every step carries a `timingSource` saying which it is);
38 measured times are `timingProvisional` (conditional on an unmodelled state,
or measuring only one phase); team-wide lane 2 is still flat; incoming-transfer
durations are unparsed; the opener filler weaves no real combos. Details and status live in
`SIMPLIFICATION-PLAN.md`, `TEAM-BUFF-TIMELINE-PLAN.md`, and `HISTORY.md`.
