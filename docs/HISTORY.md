# HISTORY — WuWaSim development chronicle

Append-only log of what happened, phase by phase. Moved verbatim out of
CLAUDE.md on 2026-07-17 (Simplification Plan S1.2 — see
`docs/SIMPLIFICATION-PLAN.md`): CLAUDE.md states what IS; this file records
what HAPPENED. New session summaries are appended here, never to CLAUDE.md.

Phase docs referenced below live in this same `docs/` directory
(P11/P12/P13-INSTRUCTION-SET.md, investigation write-ups, plans).

---

## CURRENT PHASE: P13 (team suggestions + team-level ER) — engine/meta shipped; P12 history below

P10, P11, P11.5 (energy modeling), and the PRE-P12 effect-data-quality gate are
complete. **P12 shipped** the offline optimizer + runtime stat-priority panel:

- `tools/optimize.mjs` + `tools/optimize/*` (reference-build, weights,
  breakpoints, validation-report) → `data/wuwa-meta.json` (committed) +
  `docs/meta-validation.md` (local QA artifact; `docs/` is gitignored).
- Runtime: `src/data/meta-loader.js`, `src/core/stat-ranking.js`,
  `src/core/stat-priority.js`, and the Stat Priority panel in
  `build-editor-v2.js` (mode toggle + ER status + weight bars).
- **ER design deviation from `P12-INSTRUCTION-SET.md §3a`** (maintainer-directed,
  2026-06-27, per PHASE0 §13.5 "never fabricate"): a solo resonator builds
  Resonance Energy over many cycles and the dominant energy sources (damage
  taken, on-hit, off-field 50%, Concerto) are unmodeled by design, so there is
  no honest single solo ER breakpoint. ER is instead a **mode choice** —
  `dmgFocus` / `balanced` (target ~125%) / `erFocus` (ER ranked only for
  ER-scaling kits). Documented in `tools/optimize/breakpoints.js` +
  `docs/meta-validation.md`. A true ER breakpoint waits on team-level energy
  modeling (P13).
- Coverage: the 6-character seed (Carlotta, Hiyuki, Jinhsi, Changli, Phoebe,
  Cantarella); uncovered configs fall back to the live sim.

**P12-fix (2026-06-27)** — corrected the priorities, which were contradicting
character roles:

- **DMG-type reclassification** (`preprocess.mjs parseDescConversions`) — the
  dominant fix; see the "Considered as X DMG" invariant. 207 roster-wide
  `formulaType` corrections.
- **Curated reference rotations** (`data/reference-rotations.json`) for all six
  seed characters, authored from Prydwen + validated; replaces the kit-blind
  synthesizer output. Also the empty-build default.
- **Per-roll stat priority** (`stat-priority.js STAT_ROLL_VALUE`) — ranks by
  weight × roll magnitude, not raw per-1% (Crit DMG rolls ~2× others). Fixes
  "ATK% > Crit DMG".
- **De-saturated anchor** (`reference-build.js`) — CR-heavy substats → realistic
  CR 69% / CD 285%.
- **Suggested build** (`tools/optimize/suggested-build.js`) — sims the pruned
  (sonata × weapon) grid, stores the best in the meta (`suggested`), surfaced as
  a one-click "Apply" on empty builds (`build-editor-v2.js` + `meta-loader`
  `suggestedBuildFor`).
- **Cache-busting** (`data/data-version.json` manifest) — content hashes auto-bust
  the CDN/browser cache on every regen, not just schema bumps.

**Auto-optimizer engine — Phase A + C shipped (2026-06-28)** — see
`docs/AUTO-OPTIMIZER-ENGINE-PLAN.md`:

- **Buff-timeline (A)** — `src/core/buff-timeline.js`: sonata stacking buffs now
  ramp per-step (0→…→cap) and decay instead of applying max stacks flat for the
  whole window; multi-trigger buffs (e.g. Freezing Frost "Basic OR Heavy") are
  grouped into ONE window over the union of triggers (`groupStackingBuffs`),
  fixing a latent double-count. `computeBuffWindows`/`applyBuffsToSteps` in
  `sim.js` consume the per-step `stacksByStepIndex`.
- **Substat co-optimization (C)** — `src/core/substat-allocate.js`: greedy
  marginal allocator (reuses the real sim) gives each candidate its OWN
  co-optimized substats, so set comparison is fair under the CR cap. The
  suggested-build search uses it; the meta stores `suggested.substatTarget`.
- Honest result: solo, Freezing Frost still narrowly beats Wishes for Hiyuki
  (~4.6%); Wishes' real edge is team/outro synergy → P13.

**P13 (team suggestions + team-level ER) — engine/meta side shipped
(2026-07-02).** Absorbed the plan's **Phase D** (team modeling) in full, plus
the energy-as-resource half of Phase B:

- **Team pass** (`tools/optimize/synergy-hints.js`, `team-enum.js`,
  `team-rank.js`; team pass in `optimize.mjs`) → `meta.teams` (8 anchors,
  curated teams pinned first, top-8 per anchor, `memberBuilds` transparency).
  **Coverage note (2026-07-10 status audit):** the 8 anchors are
  1108/1109/1209/1210/1211/1508/1509/1510 — only Hiyuki (1108) overlaps the
  P12 six. Carlotta/Jinhsi/Changli/Phoebe/Cantarella get the honest
  "no suggestion available" fallback because `SYNERGY` is currently derived
  from only 3 `CURATED_TEAMS` entries, none of which name them. Not a bug —
  `generateCandidates` correctly requires positive affinity before
  suggesting — but it inverts the original intent of seeding coverage from
  the P12 six. Fix is adding `CURATED_TEAMS` entries for those five; no
  engine change needed.
- **Team Effect Model L1–L4** in `team-sim.js`: shared enemy-status timeline,
  team-aware status gating, team-wide buff propagation, Havoc Bane DEF shred,
  incoming-resonator transfers (Wishes Snowfall).
- **Team energy** (`src/core/team-energy.js` + `memberEnergy` on every team-sim
  result): own casts + the off-field 50% share (each × the receiving member's
  own ER), closed-form minimum-ER (energy is linear in own ER — no sweep loop).
  ~~Informational; never gates damage.~~ *(Partially revoked 2026-07-12 — see
  the derived-openers bullet below: with `deriveOpeners` on, a short gauge
  changes the ROTATION (filler/gating) before the sim runs; the energy layer
  itself still never mutates a given rotation's damage.)*
- **Team-level ER (§5a.2):** steady-state closed form over per-hit generation +
  the off-field share. The P13-fix (2026-07-02, `rowHitTotals` in
  `preprocess.mjs`) corrected a systematic per-hit undercount (551/996 skill
  entries, roster base generation ~2×) — after it, **79/192 override entries
  carry real team-context targets (~1.3–1.8, conservative upper bounds)**; the
  rest stay provisional honestly (non-energy-gated kits; requirements beyond
  `MAX_CREDIBLE_ER`). Enemy-dependent generation (damage taken, kill orbs) is
  out of scope by maintainer direction. **P13-fix-2** (2026-07-03) fixed a
  more precise bug the maintainer's questioning surfaced: the per-row
  consumption counter reset on every row, so when TWO DIFFERENT ROWS shared a
  rate, both silently read the same first entry and later entries were never
  consumed. **P13-fix-3** (2026-07-03, same day) superseded the rate-keyed
  mechanism entirely with full rate-VECTOR matching + ID-adjacency
  clustering (`matchRowHits` in `preprocess.mjs`): terms match entries on
  the whole 20-level vector (level-1 exact, later levels rounding-tolerant),
  same-vector candidates cluster by raw-ID adjacency (same-term entries are
  ID-adjacent; different rows' entries are ≥100 apart), rows re-read
  consumed entries when display rows share one instance, and hidden "2×
  shadow" duplicates lose cluster tie-breaks. Also structurally eliminates
  scalar-row phantom matching ("STA Cost 25" → rate 2500), which had been
  corrupting consumption order. Dataset effect: exactly 4 hand-verified
  corrections (Aemeath, Rebecca, Rover: Havoc, Cartethyia).
  `tests/energy-per-hit.test.mjs` locks 10+ anchors. Documented in
  `docs/energy-signal-findings.md` (P13-fix-3 section, incl. the ID-structure
  findings and the decoded per-hit `type` field) and the team QA section of
  `docs/meta-validation.md`.
- **`type`-field verification (2026-07-03)** — the maintainer's two
  hypotheses for the raw per-hit `type` field were tested rigorously and
  neither held up cleanly: Coordinated Attack (off-field) shows zero
  correlation (scattered across type 0/2/4 for 6 already-modeled
  characters); Echo Skill DMG (`type=5`) shows a real but imperfect 80%
  correlation (the SAME character's kit splits types across hits —
  Cantarella's Echo-Skill rows are 100% type 0). Neither wired in. What WAS
  real: investigating the maintainer's concrete symptom (Aemeath shows as
  "overwhelmingly Heavy Attack" when she deals mostly Liberation damage
  in-game) found **P13-fix-4** — the "considered as X DMG" reclassifier's
  whole-description FALLBACK path (used whenever section-header matching
  can't isolate a row) scanned raw HTML-included text, and the game always
  wraps a reclassified type name in `<color=Highlight>...</color>`, so the
  regex could never match through the fallback. Fixed (strip HTML before
  the fallback scan, matching what the primary path already did) — 38
  newly-recovered `formulaType` conversions and 24 newly-recovered
  `isEchoSkill` rows roster-wide, landing exactly on the characters the
  maintainer named from memory (Phrolova/Cantarella/Galbrena/Lucilla) plus
  two more found independently (Qiuyuan/Sigrika). Zero regressions
  (verified: no type ever CHANGED, none went ambiguous). No live-code
  impact yet (`isEchoSkill` isn't consumed anywhere outside `preprocess.mjs`
  today) but the `formulaType` correctness gain is immediate for any
  future-covered character with this header/row-name mismatch shape.
  `tests/formula-conversion.test.mjs`. Documented in
  `docs/energy-signal-findings.md`.
- **P13-fix-5 (2026-07-04) — `formulaType` is now DATA-DRIVEN, regex retired.**
  The maintainer confirmed (spot-checks across the roster) that the raw
  per-instance `type` tag matches the actual in-game damage type *perfectly*,
  and that the earlier "imperfect 80% correlation" reading above was an
  artifact of the flawed text-parser, not the data (Galbrena's per-stage
  split — BA Stage 1-3 Heavy, Stage 4 Echo, Volley of Death Heavy — is
  exactly right in the `type` field). So `parseDescConversions` and the whole
  staged/section text-matching machinery (incl. P13-fix-4's fallback fix and
  P13-fix-5's earlier staged-regex attempt) were **deleted as dead code**.
  `matchRowHits` already maps each display row to its exact damage instances
  by full rate-vector; it now also returns their `type` tags, and
  `resolveInstanceFormula` reads `formulaType`/`isEchoSkill` straight from
  them (0→basic 1→heavy 2→liberation 3→intro 4→skill; 5→isEchoSkill only,
  keeps mechanical `baseFormula`). Per-display-row matching resolves per-stage
  conversions *naturally* — no staged logic needed. Net: 256 data-driven
  reclassifications roster-wide; Aemeath's Seraphic Duet now correctly
  `liberation` (the reported bug), Galbrena exactly matches in-game,
  Cantarella correctly loses her false `isEchoSkill` (her "considered as
  casting Echo Skill" is a mechanical cast trigger — zero type=5 damage — not
  Echo Skill DMG). `isEchoSkill` cross-validated against raw type=5 presence.
  48/48 tests pass; meta regenerated (Cantarella now correctly values Basic
  DMG Bonus). `tests/formula-conversion.test.mjs` rewritten for the
  data-driven model. Documented in `docs/energy-signal-findings.md`.
- **Concerto gauge** — `element_power` **confirmed** (2026-07-02, maintainer
  manual in-game testing + reverse-engineered per-term accounting rule; see
  `docs/energy-signal-findings.md` "CONFIRMED" section) as the Concerto
  Energy driver, extracted with the same per-hit accounting as Resonance
  energy. `concertoGen` on every skill-map entry, `rawConcertoGen` on the
  solo `energyTrace`, and a per-member gauge (cap 100, active-member-only
  income) in `team-sim.js`'s `concerto.swaps`
  (`{ outgoingId, incomingId, gauge, ready }` per boundary). Always computed;
  the Outro→Intro handoff gate is opt-in (`enforceConcerto`, default off —
  measured only ~5% of curated-team swaps reach a full gauge within one
  rotation, so default-gating would silently drop most handoff
  damage/buffs). Substitute-Basic-Attack-on-incomplete-swap is a named,
  un-modeled follow-up. `tests/concerto.test.mjs`.
- **`statusesInflictedBy` element-gate fix** (`src/core/enemy-status.js`,
  found while testing an element_power hypothesis, independently real) — the
  kit-text substring scan couldn't distinguish "this resonator inflicts
  status X" from "this resonator's kit text merely names X" (a "removes X"
  clause, or "when a teammate applies X"). Fixed by requiring the
  resonator's own element to match the status's required element before the
  text scan runs; removed 12 false positives (Rover: Aero/Cartethyia each
  wrongly flagged for 5 statuses; Hiyuki wrongly flagged for Havoc Bane) with
  zero collateral loss on genuine appliers. Was live in `team-sim.js`'s
  team-wide status gating for any user-built team including the affected
  characters. `tests/enemy-status.test.mjs`.
- **Runtime §7**: `src/core/team-er.js` `resolveErTarget()` — hybrid
  resolution (team override when the placed team matches a simulated one,
  character-level balanced default otherwise, null only when nothing exists).
  Pure over the meta object; core does not import from `src/data/`.
- **UI surfaces**: `suggested-teams.js` on the build page; 3-way team compare
  in `compare-v2.js`. §8a/§8b wired (2026-07-04): each suggested team has an
  "OPEN IN TEAM SIM" action (`loadTeamIntoSim` in `build-editor-v2.js` —
  anchor uses the current build, other members reuse the user's most recent
  build for that resonator or get a new one seeded from the meta suggestion /
  reference rotation; re-clicks reuse the existing team), and the
  "appears in suggested teams for" reverse-lookup line renders on supports'
  build pages (links to the anchor's most recent build). Still open: showing
  the team-context ER target / energy trace on the team screen. **Correction
  (2026-07-10 status audit):** the team screen itself is not the blocker —
  the classic `.ts-*` team CSS was fully retired on 2026-06-25 and
  `team-editor-v2.js` has run on the `.bv2` system since (per-step bars,
  buff windows, damage-share) — `resolveErTarget()` simply has zero call
  sites anywhere in `src/`; the target it computes is never rendered
  anywhere (build page shows the character-level default only,
  `compare-v2.js` shows the current build's equipped ER, not the computed
  target). Remaining work is wiring the existing function into the existing
  screen, not a pending design decision.
- **MVP hardening pass (2026-07-04)** — pre-MVP review fixes:
  - **Weapon skill-type passive fix**: `resolveTotalStats` never merged
    `wpass.dmgBySkillType` into `dmgBonusBySkillType` (the element map did
    include it), silently dropping the leading passive of 8 weapons
    (Lumingloss/Undying Flame +20% Skill, Amity Accord +20% Lib, Stonard,
    Call of the Abyss, Bloodpact's Pledge, Thunderbolt, Comet Flare). Fixed
    in `stats.js`; locked by `tests/weapon-buffs.test.mjs`; meta regenerated
    (engineHash only — no covered-character ranking shifts).
  - **Tier-driven sonata strip**: the ECHOES panel's set strip hardcoded
    2PC/5PC chips — mislit the 3PC-only sets and completely hid the 1PC
    collab set (Shadow of Shattered Dreams, id 32). Now renders one chip per
    tier the set actually defines (engine was already tier-correct).
  - **Dead code removed**: `src/data/kamera-import.js` (orphaned module —
    README had already declared the feature removed), the unused
    `buildSonataLUT`/`clearSonataLUT` cache in `stats.js` (its consumer was
    the deleted echo optimizer), and `amplifyContextToEffects` /
    `sonataParsedBuffToEffects` / `filterActiveBuffs` in `buffs.js`
    (definition-only). The `#share/` import route + `decodeBuild` are KEPT:
    the share-link creation side (`encodeBuild` has no caller/button) is
    deliberately deferred, not dead.
- **Trigger/state transparency pass (2026-07-05)** — the maintainer's audit
  ("conditions, windows, states + consumers must be VISIBLE and correct")
  found the stage-ordering heuristic state-blind (Denia intro→Stage 4 falsely
  warned). Shipped:
  - **Grant-aware validation** (`analyzeRotation` in `rotation-graph.js`;
    `validateRotation` stays as the grant-blind back-compat wrapper). New
    curated tables in `rotation-rules.js`, each entry kit-text-verified:
    `STAGE_GRANTS` (`after` adjacency grants — "right after casting X, cast
    Stage N"; `state` licenses; `resource` thresholds; `free` non-sequential
    families like Lynae's charge "Lv." suffixes), `SWAP_IN_ENTRY`
    (**maintainer-verified in-game, undocumented anywhere**: Yangyang/Verina/
    Yinlin/Roccia/Camellya swap in with Basic stages 1–2 pre-seen — auto-BA1
    fires, first user Basic lands at Stage 3; NOT true for Chisa/Aemeath/
    Denia), and `RESOURCE_DEFS` (per-cast gains/spendAll, e.g. Sigrika Full
    Stop: Schemata/Runic heavies +50 cap 100, Forte Circuit spends all;
    ≥50 → her Basic cycle starts at Stage 2). A key covered by a character
    rule is skipped by the generic stage heuristic (no double warning).
    Result: reference-rotation warnings 29 → 2 (both real, see open items).
    Every satisfied gate emits a **grant chip** (⤷ badge on the rotation
    step, per maintainer choice) naming its source. `tests/stage-grants.test.mjs`.
  - **Denia's real stance model** (replaces the wrong forte-entered "Entropy
    Shift" def): Stagecraft⇄Breakdown via her two Liberations (consumedBy),
    plus the mutually-exclusive timed pair Entropy Shift: Breakdown (12s) /
    Stagecraft (30s). New state-machine primitives in `rotation-state.js`:
    exit mode `secondsOrConsumedBy` (timer OR removed-by, whichever first)
    and `aliases` (recorded in activeAt alongside the canonical name — her
    S6 "While in Entropy Shift states" gate matches exactly). Brant gets an
    'Interlude Applause' one-shot license state (intro → next Mid-air at
    Stage 2, consumedBy midair).
  - **`untilConsumed` effect-window type** (`buffs.js isEffectOnAtStep`):
    ON from the trigger's most recent fire until `win.consumedBy`
    (skillType/skillKeys) fires; re-trigger re-arms. Authored per effect via
    `data/effect-overrides.json`. No effects use it yet (see open items).
  - **Windows are now visible**: `simulateRotation` returns `effectWindows`
    (per conditional chain/inherent effect, with `endReason`:
    consumed/expired/state ended/rotation end) and `stateWindows` (per state,
    with the consuming step named). The build page's BUFF WINDOWS bar renders
    them as strips ("KIT · Chain S6" / "STATE — Breakdown Form · consumed by
    Final Act"). Effect activity is now evaluated on EVERY step incl.
    `__echo__` so windows don't artificially break. `tests/effect-windows.test.mjs`.
  - ~~Open: Yinlin `intro → basic_4` / Danjin `basic_2` after skill~~ —
    both **maintainer-verified in-game (2026-07-05)** as real, undocumented
    interactions and curated as grants; **reference rotations now validate
    with ZERO warnings** (canary-locked). The maintainer also confirmed the
    raw extraction carries NO combo graph (`skill_branch_ids` empty roster-
    wide, `skill_input_list` = Forte input hints) → undocumented chain
    interactions are curation-only. **`docs/COMBO-ENTRY-CURATION.md`** holds
    the drafted roster-wide curation pass: verification protocol (swap-in
    with/without intro, ability weave, heavy interplay), tiered worksheet
    (8 covered; ~20 Tier-1 text-hints = desk work; rest Tier-2 in-game),
    and where results land (the rotation-rules.js tables).
  - **Tier-1 combo-entry desk pass SHIPPED (2026-07-05)** —
    `docs/COMBO-ENTRY-CURATION.md`: 20 characters now fully covered (up from
    8), each `STAGE_GRANTS`/`RULES` entry kit-text-quoted and
    data-integrity-tested (`tests/stage-grants.test.mjs`: 138 → 286
    assertions). Tier-2 (no kit text at all — needs in-game verification,
    same protocol as the Yinlin/Danjin cases) remains open for ~26
    characters; the worksheet in the doc tracks exactly which families.
  - **Effect-override batch (2026-07-05)** — of the 59 unknown-trigger
    effects, 4 were cleanly authorable (Encore S1 stacking Fusion bonus,
    Yinlin S4 team ATK buff, Lumi IH1 ATK buff, Phrolova S3.1 suppressed as
    an enemy-debuff misparse) — `tools/audit-effects.mjs`: 54 → 50
    unresolved, 0 regressions in the seed+mode set; meta regenerated
    (engineHash only, zero ranking shifts — none of the 4 touch covered
    characters). **The rest are NOT simple overrides**: Changli's IH0/IH1
    and Hiyuki's Snow Rust family need real engine features (an
    "instantaneous, scoped to the triggering cast" resolution kind; a
    continuous multi-source resource gauge, same class as Lynae's Lumiflow)
    already correctly parked in `effect-overrides.json`'s `deferred`
    section — attempting them as quick patches risked wrong numbers in the
    6-character covered meta. Full reasoning and the remaining candidate
    list in the curation doc. Swap-in auto-BA1 damage and the
    auto-BA-before-Heavy mechanic (maintainer-observed) are known unmodeled
    gaps, documented there too.
- **Cooldown model (2026-07-12)** — prerequisite for the derived-opener work
  (below). The game data reports per-skill "… Cooldown" skill-tree rows
  (level-invariant; already riding the META_SUFFIXES rail) and a per-echo CD
  placeholder in the echo skill's own desc (rank-invariant). `preprocess.mjs`
  extracts them: skill-map entries gain `cooldown` + `cooldownGroup` (keys fed
  by ONE shared row — e.g. Hiyuki "Jade Cleave/Petalfall Cooldown" — are one
  activation family; 133 keys, 5 shared groups), echoes gain
  `activeSkill.cooldown` (159/159 damage echoes, 8–25s). `src/core/cooldowns.js`
  (`annotateStepCooldowns`) overlays casts with an **activation-window model**:
  first cast of a group arms the window; a DIFFERENT key of the group inside it
  is a stage continuation (legal, CD runs from the activation); re-casting an
  already-used key is an early-restart violation. Overlay is diagnostic ONLY
  (authored-as-executed, mirrors the energy layer): `sim.js` returns
  `cooldownViolations` + per-step `step.cd`; `team-sim.js` §4b re-annotates in
  TEAM time (timers persist across passes/swap gaps) → `cooldownViolations`
  with resonatorId. UI: ⏱ step badges + banner (build page), ⏱ chip + step
  markers (team timeline). In ENGINE_FILES (optimize.mjs + meta-schema — keep
  both lists in sync). Scan findings: curated rotations in REAL team context
  (3 passes) = ZERO violations; back-to-back solo looping = 72 boundary
  conflicts (the filler builder must respect CDs); 4 honest intra-rotation
  flags remain — Encore/Jiyan ×2 (in-state transformation repeats carry the
  node CD via first-damage-row fallback; needs state modeling, documented in
  cooldowns.js) and Aalto (real: guide pre-casts Skill assuming a longer gap
  than our castTimes give). `tests/cooldowns.test.mjs`.
- **Direction change (maintainer, 2026-07-12): "energy never gates damage" is
  PARTIALLY REVOKED for the team path.** A rotation that can't actually be
  performed (Liberation energy not reachable) must not contribute as-is to
  team DPS/ranking. Agreed approach — **mechanically derived openers**, NOT
  hand-curated ones (that's the P12 kit-blind-synthesizer trap). Slot-1
  pass-0 additionally cannot perform Intro skills — already true in code
  (`isFirst` skips the injected intro segment; `withoutAutoCastSteps` strips
  authored intro steps).
- **Derived openers SHIPPED (2026-07-12)** — `src/core/opener.js`
  (`deriveOpenerPadding`) + `deriveOpeners` param on `simulateTeamRotation`
  (engine default OFF for a stable contract; the team page UI and the
  offline team ranking opt IN). Two prerequisites closed first: the cooldown
  model (above) and **Echo Skill Resonance Energy** (former P11.5 gap —
  `activeSkill.energyGain`, raw ÷100, e.g. Junrock 1.8; echo `element_power`
  is 0 across all 163 echoes so Concerto stays 0; accumulated in `sim.js`'s
  echo branch; `tests/energy-trace.test.mjs`). Mechanism: team-sim keeps a
  live per-member gauge ledger (`applyEnergyEvent`, extracted in
  `team-energy.js` so predictor and reported trace share ONE accumulation
  rule); before each member's pass, a consuming Liberation with a short
  projected gauge gets a **CD-aware greedy filler** spliced in (2026-07-11,
  replacing the former fixed-cycle-×k loop): at each step cast the
  highest-yield ability that is OFF COOLDOWN — the rotation's Resonance
  Skills + the equipped Echo Skill (`echoCooldown` threaded from the slot-0
  echo) — and fill the gaps with the CD-free basic chain, every candidate
  (incl. basics) ranked by energy-per-SECOND throughput. Shortfall becomes
  TIME; when nothing can generate energy (or > `MAX_FILLER_TIME` 120s compute
  bound) the cast + contiguous cost-free continuations are GATED (dropped +
  reported). Steady-state passes self-eliminate padding where own-gen ≥ cost.
  **This fixed the ~313s Aero-Rover pathology** (the old loop spun a kit's
  WEAKEST hits when its generators sat after the Liberation): Rover
  313.6s→68.1s and roster-wide the 11 opener gate-flip cliffs → 0 (insertions
  now carry `sequence`, not `cycle`/`count`;
  `docs/opener-pathology-investigation.md`).
  **Forte gauge (Lever 2, 2026-07-11 — SHIPPED)**: `tools/extract-forte.mjs`
  distills the BinData SpecialEnergy channels (`data/bindata/{damage,skill,
  baseproperty,roleinfo}.json` — moved into a committed, git-tracked location
  2026-07-16; formerly gitignored under `docs/`) → committed
  `data/forte-data.json` (16 resonators initially, 21 after the 2026-07-16
  ID-join rewrite below: channel + cap + per-skill `forteGen`);
  `preprocess.mjs` stamps
  `forteGen` on skill-map entries + exposes `dataset.forte` (cap/channel). The
  greedy tracks a Forte gauge, uses generators (incl. `forte_*` fillers) to
  build it, and fires the PAYOFF ("big gainer") at full cap — ranked by
  full-CHAIN throughput (`(gen + share·payoff)/(ct + share·payoffCt)`) so a
  slow filler never beats a fast basic → NEVER regresses; `forteCap=0`
  (37 uncovered kits) is byte-for-byte the non-Forte greedy. Aero Rover
  25.1s→22.9s. **Honest limitation:** gain is modest/opportunistic because
  cast times are FABRICATED — full value is coupled to cast-time realism (the
  chain only decisively beats basic-spam at real durations).
  `docs/forte-modeling-investigation.md`. Surfaces:
  `openerAdjustments` on the result, `segment.opener`, `step.openerFiller`
  (dashed border + ↻ in the team timeline), ↻ OPENER chip, OPENERS ON/OFF
  toggle (default ON) on the team page. **Ranking** (`team-rank.js`): teams
  now score on a multi-pass (3) openers-ON sim — replaced the former
  single-pass cold-start scoring that credited uncastable Liberations at
  full value (one confirmed source of generated teams out-ranking curated
  ones); `erOverride` stays on a separate openers-OFF run so `minViableEr`
  keeps meaning "the ER at which the authored rotation loops clean"; compact
  per-member `opener` summaries persist in `meta.teams` (all 400 stored
  teams carry cold-start adjustments). Solo sim stays informational.
  `tests/opener.test.mjs`; opener.js + cooldowns.js in ENGINE_FILES (sync
  optimize.mjs + meta-schema test). Hand-curated openers remain available
  as targeted per-character overrides if a derived one ever looks off.
- **Team-context gear search (2026-07-13)** — maintainer spot-check: Chisa's
  meta build used Thunderflare Dominion (100% self-buffing) over her
  signature Kumokiri, and Lingering Tunes over any team-amp option. Root
  cause: `representativeMemberBuild`'s gear search (`tools/optimize/
  team-rank.js`) ranked every candidate via **solo** `simulateRotation`,
  memoized once per resonator and reused for every team — a team-recipient
  mechanic is structurally invisible to a solo number. Confirmed via a real
  engine bug along the way: `conditional-buffs.js`'s
  `extractConditionalContribution` parsed Kumokiri's real payoff ("at max
  stacks, when Resonators in the team inflict Negative Statuses, **they**
  gain All-Attribute DMG Bonus") correctly, but folded it into the WIELDER's
  own stat bundle only, never distributing it to teammates — so even a
  manual in-game-editor equip couldn't show its true team value. Shipped:
  - **`extractConditionalContribution` team-wide split** — a new
    `isTeamRecipientClause` (self vs. team-as-beneficiary, generalizing
    `buffs.js`'s `isTeamWideBuff` for raw weapon/sonata text; catches the
    "named team subject → later 'they gain'" anaphora, e.g. Kumokiri) returns
    an ADDITIVE `.teamWide` bundle alongside the unchanged self bundle (the
    wielder is themselves a team member, so both apply — mirrors
    `teamWideContribution`'s existing convention). `stats.js` exposes the
    merged bundle as `weaponSonataTeamWide`; `team-sim.js` folds it into the
    existing `mergeTeamBundles`/`externalTeamBuffs` pipeline — no new
    plumbing, reuses the L3 team-wide propagation kit effects already use.
    Caught + fixed a false positive during review: a bare `resonators?`
    regex matched the game's singular "the Resonator… they gain" self-buff
    phrasing (Chromatic Foam) as if plural/team-wide — tightened to require
    literal "resonators in the team". `tests/conditional-buffs.test.mjs`.
  - **`candidateSonatasFor` team-amp pool** — HEALER/BUFFER-tagged roles now
    also get every sonata with a genuine team-recipient tier
    (`sonataGrantsTeamAmp`, reusing `isTeamRecipientClause` so "can we detect
    this buff" and "should it be a candidate" never drift apart) — the
    missing category the prior pass's own comment had flagged as deferred.
  - **`representativeMemberBuild`'s `metricOf`** now scores weapon/sonata
    candidates by **team-context damage**: `simulateTeamRotation` against up
    to 2 real teammates (`synergy-hints.js` `contextTeammatesFor` — curated
    teams first, else highest tag-affinity partners), single-pass (a
    relative-ranking probe; `scoreTeam` still computes the real, full-
    fidelity number later). Context teammates use a cheap, non-recursive
    `referenceBuild()` (the P12 anchor pattern) — never their own
    `representativeMemberBuild`, which would recurse. Falls back to solo
    scoring only for isolated characters with no tag-derived affinity at all
    (never a regression — they'd have gotten a solo number before too). Net
    optimizer cost: 47.0s vs. the prior 43.0s baseline (memoized once per
    resonator, not per team, so the fan-out across 1449 candidate teams never
    multiplies this cost).
  - **Dropped the HEALER-only `'heal'` substat/gear objective** (maintainer
    direction: "healing is secondary, buffing/amping DMG is the primary focus
    of a support unit") — substats now co-optimize against personal damage
    uniformly; the 4-cost Healing Bonus main + HP-scaling mains
    (`templateStats`/`scalingStatFor`) are separate, still-correct decisions
    this didn't touch.
  - **Found + fixed in the same pass, surfaced by the above**:
    (a) `substat-allocate.js`'s greedy allocator stopped the instant no stat
    cleared a positive-marginal-gain epsilon, silently leaving substat slots
    unfilled (Chisa's echoes showed 2/5 rolled) — a real echo's 5 lines are
    NEVER blank in-game; fixed to always place the least-bad remaining roll
    until every stat hits its cap, never regressing the reported metric
    (`tests/substat-allocate.test.mjs`). (b) `reference-build.js`'s
    `synthesizeReferenceRotation`/`pruneToValid` validated curated rotations
    with the OLD grant-BLIND `validateRotation()` wrapper instead of
    `analyzeRotation()` with the full `STAGE_GRANTS`/`SWAP_IN_ENTRY`/
    `RESOURCE_DEFS`/state-timeline context (matching `build-editor-v2.js`'s
    own call) — latent since only the P12 six ever exercised `referenceBuild()`
    before, and none of their curated rotations rely on a grant; surfaced as a
    hard crash the moment context-teammate construction (above) exercised it
    for Denia, whose curated Intro→Stagecraft-Stage-4 opener relies on exactly
    such a grant (`rotation-rules.js STAGE_GRANTS[1211]`). Fixed at the root
    (both call sites now grant-aware); `contextBuildFor` also wraps the call
    in try/catch regardless (a context teammate is a nice-to-have, never
    load-bearing) so an unrelated resonator's future curation bug can't crash
    the whole optimizer run again.
  - ~~Residual: team-amp sonata candidates (Rejuvenating Glow, Halo of
    Starry Radiance) that gate on "upon healing allies" land at their
    2pc-only floor.~~ **Superseded 2026-07-14** — the maintainer corrected
    that Chisa DOES heal (her curated rotation casts Death Snip Healing +
    Moment of Nihility), so these SHOULD fire, and investigating why they
    still showed no value uncovered a chain of real buff-model bugs; see the
    next entry. Chisa now correctly picks **Kumokiri / Rejuvenating Glow**.
  - `tests/team-rank.test.mjs` — updated the now-superseded HEALER-heal-
    objective assertions (Baizhi now correctly gets Crit Rate/DMG substats)
    and added a Chisa/Kumokiri regression lock.
- **Buff-model correctness + team-timeline UI merge (2026-07-14)** — the
  maintainer's audit ("active buffs should live IN the rotation timeline, and
  they aren't stack-aware; Chisa's Havoc Eclipse shows a flat 8% that never
  ramps and should be 7.5%; Chisa DOES heal so her heal-gated team-amp
  sonatas should trigger") surfaced a UI gap plus a chain of engine buffs
  systemically under-modeling team-support sonatas:
  - **Team-timeline buff merge** (`team-editor-v2.js`, `buff-bar.js`,
    `team-sim.js`, `sim.js`): the disconnected per-member "ACTIVE BUFFS" card
    is gone; buff strips now render as a lane directly under each member's
    row in the FULL ROTATION TIMELINE, on the SAME absolute team-time axis as
    the cast segments (a buff's window lines up with the casts that triggered
    it). `simulateTeamRotation` now returns `memberStackedBuffWindows`
    (team-time, per-step stack samples built from each segment's rich
    `simResult.buffWindows` via the now-exported `windowStacksAtStep` — the
    same function that drives damage, so display can't disagree). The
    Build-page ramp-band logic was extracted to a shared
    `buff-bar.js stackBandsFromSamples`, so both pages render identical
    height-encoded ramp/decay visualizations instead of a flat block.
  - **% rounding fix** (`sim.js shortBuffLabel` + `buff-bar.js fmtPctTrim`,
    used by both pages): a per-stack magnitude like Havoc Eclipse's 7.5% was
    `.toFixed(0)`→"8%" (and the Build page's ramped label read a
    self-inconsistent "+8→30%", since 8×4≠30). Now trims to one decimal only
    when non-integer → "+7.5→30%".
  - **`healing` trigger fix** (`buff-timeline.js`): a sonata parsed with a
    `'healing'` trigger ("upon healing allies") was matched against
    `step.skillType` — but `'healing'` is never a mechanical skillType, so the
    buff could NEVER gain a single stack for ANYONE. Now matched against
    `step.stepHeal > 0`. This is why Chisa's heal-gated sets showed zero.
  - **`detectBonusKind` broadening** (`sonata-buffs.js`): the classifier only
    recognized "ATK **+**N%", so the team-recipient "increases the ATK **of
    all party members by** 15%" phrasing (Rejuvenating Glow, Halo of Starry
    Radiance) fell through to `'unknown'` and was silently dropped by
    `computeBuffWindows`' unclassified-buff guard. Rewritten to classify the
    stat the FIRST bonus % (the one `parseBonusPct` reads) refers to, scoped
    to the clause LEADING UP TO that number — so it catches the party-wide
    ATK phrasing WITHOUT a later unrelated "ATK by N%" clause hijacking the
    kind of an earlier bonus. Caught two self-inflicted regressions doing
    this: **Empyrean Anthem** ("Coordinated Attack DMG by 80% … ATK by 20%")
    would have credited the wielder a flat 80% ATK from a whole-text scan —
    the clause-local scope keeps it `'unknown'` (correctly dropped); and
    **Moonlit Clouds / Pact of Neonlight Leap** ("ATK of the NEXT/incoming
    Resonator") are transfers, not the wielder's — a new
    `isIncomingResonatorBuff` guard in `computeBuffWindows` skips them (the
    incoming transfer is already modeled by `incomingResonatorContribution`).
  - **Team-wide distribution for window-path sonata buffs**
    (`buffs.js sonataTeamWideContribution`, wired into `team-sim.js`'s
    `memberTeamWide`): the ATK%/element%/skill-type% family (`parseSonataBuffs`
    → `computeBuffWindows`) had NO team-wide distribution at all — a support's
    "ATK of all party members" only ever buffed the support's own negligible
    damage. This is the sonata sibling of `teamWideContribution` (chain
    effects) and stats.js `weaponSonataTeamWide` (weapon/sonata CONDITIONAL
    clauses: crit/amplify/defIgnore); the three are disjoint by construction,
    no double-count. Team-recipient tiers only (`isTeamWideBuff`), applied at
    full value (same flat approximation `teamWideContribution` uses); the
    `'healing'` trigger is gated via `supportTable` (a non-healer wielding a
    heal-triggered set distributes nothing — correct, and the exact case
    Carlotta-vs-Chisa distinguishes).
  - **Sonata-selection ranking fix** (`team-rank.js representativeMemberBuild`):
    the 2026-07-13 team-context work made only the WEAPON pre-rank team-aware;
    the outer SONATA choice still ranked by solo `alloc.damage`, so a team-amp
    set (which raises the TEAM's damage, not the wielder's own) still lost
    every comparison. Now ranks the co-optimized build by `metricOf` (team
    context). Chisa flips Havoc Eclipse → Rejuvenating Glow (+~3% team damage,
    honest). Substat co-optimization itself stays solo/own-damage (team-wide
    set bonuses are flat, not substat-scaled — documented scope boundary).
  - Verification: full `tests/*.test.mjs` (0 failures) + module sweep before/
    after; meta regenerated (large diff — team-wide buffs genuinely shift team
    damage/rankings across every team with a support; covered-6 solo builds
    unchanged/sane). New/updated: `tests/{sonata-buffs,buff-timeline,
    team-buffs,team-editor-v2}.test.mjs`.
  - Honest residuals: Law of Harmony (3pc, `buffIds` empty → `parseSonataBuffs`
    skips it) and Halo of Starry Radiance ("0.2% ATK per 1% Off-Tune, up to
    25%" — `parseBonusPct` grabs the 0.2%, conservative under-credit) aren't
    fully modeled; both are parse-accuracy limits, not distribution gaps.
    Team-wide redistribution uses the flat-full-value approximation (the
    wielder's own copy still ramps per-step; only the redistributed copy is
    flat) — same v1 convention as `teamWideContribution`.
- **Team-timeline correctness pass (2026-07-15)** — a maintainer render audit
  of the curated Chisa/Lucilla/Hiyuki team surfaced four independent bugs, two
  engine + two UI:
  - **Cast-triggers are MECHANICAL, not damage-type** (`sim.js
    phraseTypesForStep`, root cause of the reported "echo shows a wrong,
    intro/liberation-related buff"). The per-step fire registration that feeds
    `castMatch` trigger activation folded the damage `formulaType` in alongside
    the mechanical node `skillType` — so a Basic Attack that deals a CONVERTED
    damage type falsely satisfied a cast-trigger for that type. Chisa's Basic
    "Death Snip" (skillType basic / formulaType liberation) fired the
    liberation cast-trigger of her inherent "All Ends Here", turning its 12s
    Havoc/Healing buff on ~2 steps before she actually cast her Liberation.
    Fixed: `phraseTypesForStep` now reads the mechanical skillType ONLY (its
    single caller is the trigger/stack fire registration; formulaType stays
    authoritative for the per-hit DMG-bonus bucket, never for cast triggers).
    Meta regenerated — **zero covered-6 ranking changes**. `tests/effect-windows.test.mjs`.
  - **Opener filler is cooldown-seeded from the authored prefix** (`opener.js`
    `deriveOpenerPadding`/`greedyFiller`, root cause of "her first Echo Skill is
    followed directly by another from the filler — impossible on cooldown").
    The greedy's cooldown ledger started EMPTY, so an ability the authored
    rotation cast right before a consuming Liberation (the Echo Skill in
    Chisa's case) was immediately re-castable in the filler, ignoring its 20s
    CD. `deriveOpenerPadding` now tracks absolute time + last-cast of every
    ability across BOTH authored and spliced steps and passes each still-cooling
    ability's remaining CD as `readySeed` into the greedy. Chisa's echo casts go
    1.7 → 22.1 → 42.5s (all ≥ the 20s CD); team `cooldownViolations` 1 → 0.
    `tests/opener.test.mjs`. (The naive basic-1/2 filler ITSELF — unrealistic,
    un-weaved — remains a known, maintainer-deferred limitation, documented in
    opener.js.)
  - **Decayed buffs split at zero-stack gaps** (`team-editor-v2.js`
    `buffStripsFor`/`activeRuns`, root cause of "Rejuvenating Glow runs ~53s
    uninterrupted, ignoring its 30s duration"). The per-step stack samples were
    already CORRECT (dropped to 0 after 30s, returned on the next heal), but the
    renderer painted one solid strip rectangle across `start..end`, so a decayed
    buff read as continuous. `buffStripsFor` now splits each window into
    contiguous ACTIVE runs (stacks > 0) — Chisa's +15% ATK renders as
    1.7→32.1s + 49.9→56.0s with a real gap.
  - **Team-wide buffs render in a dedicated lane** (`team-editor-v2.js`
    `renderTimelineCard`; `team-sim.js` `buildStackedBuffWindows` now tags each
    window `teamWide` via `isTeamWideBuff(raw)`). A window-path buff whose
    recipient is the whole team ("ATK of all party members") is pulled OUT of
    the wielder's row into a shared TEAM-WIDE lane below all members (tooltip
    names the granting member); self buffs stay in the wielder's own row,
    exactly where they're affecting. `tests/team-editor-v2.test.mjs`.
  - **Known remaining gap (honest):** incoming-resonator transfer buffs (Outro→
    Intro "ATK of the next Resonator", modeled by `incomingResonatorContribution`
    and gated OUT of `computeBuffWindows`) are still not rendered in the
    receiving member's lane — they aren't window objects, so surfacing them is a
    separate feature, not wired this pass.
  - Verification: full `tests/*.test.mjs` (0 failures) + module sweep before/
    after; meta regenerated twice (engine touched sim.js/opener.js then
    team-sim.js), zero covered-6 build/ranking changes both times.
- **Team-wide buff VISUAL + echo aura model (2026-07-15, follow-up)** — a
  maintainer render-audit found the team-wide buffs mis-surfaced and the echo's
  own effect unmodeled. Two DAMAGE/data facts landed first, then the VISUAL was
  corrected once (see the correction note below):
  - **Echo shield/aura DMG-Boost auras are now modeled** (Bell-Borne Geochelone:
    "+10% DMG Boost for the current team members", 15s). `preprocess.mjs`
    `extractEchoTeamBuff` reads the `{i} DMG Boost for … team members` clause +
    its rank-0 param → `echo.activeSkill.teamBuff = { dmgBoost, duration }`
    (exactly 1 echo roster-wide). `team-sim.js` §L3: a member whose rotation
    casts `__echo__` contributes its echo's `dmgBoost` to a GLOBAL `amplifyAll`
    applied to EVERY member incl. the caster (the shield covers the whole
    current team; survives switching) — flowing through the existing per-hit
    amplify path (`teamBuffs.amplifyAll`, sim.js:226). The enemy-dependent
    hit-count consume condition + the 50% DMG Reduction (defensive) are IGNORED
    by direction. DAMAGE is modeled FLAT (same v1 team-wide approximation; net
    effect diluted by each member's existing amplify — e.g. Hiyuki ~+5% net from
    +10% on a high-amplify carry). Surfaced as `result.teamWideEchoBuffs`.
  - ~~**Team-wide strips SPAN the full team timeline** (`teamWideStripsFor`)~~ /
    ~~echo aura as a full-span `echoBuffStrips`~~ — **REVERTED same day.** The
    maintainer's next audit: the full-span approach made "+15% ATK from
    Rejuvenating Glow look permanent again" and the echo aura "not deactivate
    after 15s." Root cause: this team's sim is SEQUENTIAL (Chisa 0–56s, Lucilla
    56–69s, Hiyuki 69–88s), so a 15s/30s buff genuinely only overlaps the
    wielder's own play — spanning it to the end was dishonest about duration.
    The flat cross-member DAMAGE credit (above) is a separate, documented
    approximation and stays; the VISUAL is now DURATION-ACCURATE:
    - **Team-wide strips are gap-split** (duration-accurate `buffStripsFor` with
      `{sourceName}`), in the shared TEAM-WIDE lane — Rejuvenating Glow renders
      as 1.7→32.1s + 49.9→79.9s (its real 30s life), not one permanent bar. A
      team-wide window whose life OUTLASTS the wielder's own segment now CONTINUES
      past the resonator switch (a constant-stack tail in `buildStackedBuffWindows`
      carries the last level to `w.end` — exact for the single-stack team buffs
      this affects) instead of cutting off at the switch: a 30s buff triggered at
      ~49.9s correctly covers the members who play after Chisa swaps out at 56s.
      Self buffs stay capped at the segment (off-field → no effect).
    - **Echo aura is a real windowed display** — `team-sim.js` adds one
      duration-accurate window per `__echo__` cast to `memberStackedBuffWindows`
      (team time, `bonusKind:'amplify'`, tagged `teamWide`) so it decays after
      15s (three strips at 1.7/22.1/42.5s for Bell-Borne), and TAGS every step
      inside a live window with the aura name so the rotation step tooltips LIST
      it (`step.activeBuffNames`). DISPLAY-only (the flat `amplifyAll` still
      drives damage) — the display shows real timing, the damage keeps the flat
      cross-member v1 approximation; the mismatch is deliberate and documented.
    - **Echo step tooltip** now shows the echo's real description
      (`sim.js fillEchoDesc` fills the `{i}` params → `step.echoDesc`;
      `renderStepBar` reads it since `skillMap` has no `__echo__` entry).
  - Data + meta regenerated (engine touched); covered-6 unchanged.
    `tests/{team-buffs,team-editor-v2}.test.mjs`.
  - **Still not modeled:** the shield's 50% DMG Reduction (defensive) and the
    hit-count consume (enemy-dependent); and the flat-vs-windowed
    display/damage mismatch for team-wide buffs (a sequential-timeline artifact —
    a true fix needs timeline-aware team-buff application, a bigger change).

- **Timeline-aware team-buff application — Increment 1 (2026-07-15, maintainer
  chose the literal-overlap model: "honesty and transparency"; full plan in
  `docs/TEAM-BUFF-TIMELINE-PLAN.md`)** — teammates are now credited a
  team-wide WINDOW buff only for the steps that literally fall inside its live
  window, replacing the flat whole-rotation approximation for the two
  already-windowed sources:
  - **Mechanism (window-injection, not per-interval stat re-resolution — the
    deliberate simplest-code deviation, documented in the plan):**
    `team-sim.js` accrues a chronological `teamBuffTimeline` per segment right
    after it simulates (`accrueSegmentBuffWindows` → `stackedWindowsForSegment`
    with `constantStackRuns`; accumulation order = simulation order, so "on the
    timeline" ≡ "started before this segment plays"); each later segment
    receives the overlapping runs via `simulateRotation`'s new
    `externalBuffWindows` param (segment-local time; same-source skipped — the
    wielder's own copy applies natively per pass). `applyBuffsToSteps` scales
    receiving steps per-step; received buffs list in `step.activeBuffNames`
    ("+15% ATK · Chisa"). Display map and timeline share ONE extraction —
    they cannot disagree.
  - **Echo aura is now a first-class window buff:** `computeBuffWindows`
    synthesizes it from `echo.activeSkill.teamBuff` (trigger `'echo'`, real
    duration, new `'amplify'` bonusKind — its own MULTIPLICATIVE per-hit layer
    in `applyBuffsToSteps`, exact for amplify; also applies in SOLO sims now,
    which is correct — the shield exists solo). Replaced the flat
    `echoAmplifyBundle` + the manual display-window/step-tagging block.
  - **Flat paths deleted:** `sonataTeamWideContribution` + its
    `sonataTriggerCanFire` supportTable gate (buffs.js) — the heal gate is now
    EMERGENT (a non-healer never produces a heal step, so the window never
    opens). Sources 1/2 (chain/inherent `teamWideContribution`,
    `weaponSonataTeamWide`) remain flat — their window derivation is the open
    remainder in the plan.
  - **Tail fix found by testing:** the persist-past-switch tail required the
    last step SAMPLE to have stacks>0 — but a buff gained on the wielder's
    very last cast (1-step `__echo__` rotation) never samples active, yet
    `w.end = lastGain + duration` past the segment PROVES ≥1 stack lives
    through the whole tail → tail stacks = `max(lastStacks, 1)`.
  - **Verified (live team):** Lucilla (56–68s) receives both Chisa buffs;
    Hiyuki gets +15% ATK for 15/21 steps until its real 79.9s expiry (last
    casts honestly unbuffed); echo window (ends 58.7s) never reaches her; team
    0.77M → 0.747M (the honest correction). **Canaries:** covered-6 solo
    builds+damage 0 diffs; Chisa keeps Kumokiri/Rejuvenating Glow; curated
    team healthy. Full suite 0 failures; meta regenerated. Member ORDER now
    matters to team damage (real in-game too). `tests/team-buffs.test.mjs`
    rewritten for the timeline path.

- **Timeline plan Increment 2 — chain/inherent team-buff windows
  (2026-07-15, same day):** source 1 of the flat remainder is now windowed.
  - **Partition (`buffs.js isWindowableTeamEffect`):** of the 16 team-wide
    chain/inherent effects roster-wide, 11 have a resolvable castMatch trigger
    (mechanical skillType or exact skillKeys) + a seconds window + a
    window-expressible stat (atk/element/skill-type/amplify) → moved to
    `teamWideWindowSpecs` (new export); `teamWideContribution` keeps ONLY the
    honest flat residue: Shorekeeper S2 (unconditional always-on), Sanhua/
    Baizhi/Yangyang S6 (unresolved triggers — no timing derivable), Mornye S2
    (critDmg — a post-hoc damage multiplier can't express a crit-mix change).
    Exactly one path per effect, never both.
  - **Derivation from CAST EVENTS, not `effectWindows`** (`team-sim.js
    accrueChainEffectWindows`, called after intro/rotation/outro segment
    pushes): intro/outro casts live in auto-injected segments the wielder's
    own rotation sim never sees, so the wielder's simResult can't carry those
    windows. Each trigger fire in team time opens [fireEnd, fireEnd+seconds];
    overlapping fires merge (re-trigger refreshes, never stacks — the same
    most-recent-fire semantics `isEffectOnAtStep` uses). Windows land on the
    teamBuffTimeline (label "+20% ATK · Changli") and in the wielder's display
    map ("KIT · Chain S4", team-wide lane).
  - **Per-hit dmgType matching in `applyBuffsToSteps`** (shipped alongside —
    required for Chixia S6's "+25% Basic Attack DMG" window): a dmgType
    window used to fall into the whole-step flat bonus, over-crediting
    non-matching hits; now matched against each HIT's formula skillType (the
    DMG-bonus-bucket invariant). Also fixes the pre-existing sonata
    dmgType-window over-credit; zero covered-6 shifts.
  - **Honest behavior change:** slot-0-pass-0 Changli grants NOTHING (no
    intro cast → no trigger; the flat model credited it regardless); she
    grants the real 30s window when she swaps in. Verified live: Mortefi S6
    (liberation, 20s) covers a following Carlotta for 13/14 steps, last step
    honestly expired.
  - **Known gap (documented in the plan):** the intro/outro-triggered
    wielder's OWN copy — her rotation sim never sees the cross-segment fire,
    so Changli doesn't credit herself S4 in team context (teammates DO get
    it). Pre-existing segment-isolation artifact, now explicit.
  - Canaries: covered-6 solo 0 diffs; Chisa keeps Kumokiri/Glow (6.86M
    curated team unchanged). Full suite 0 failures; meta regenerated.
    `tests/team-buffs.test.mjs` (28 asserts). Source 2 (weapon/sonata
    conditional clauses) remains flat — the open remainder.

- **Timeline gap-closing pass (2026-07-15, third increment same day):**
  - **Wielder self-credit for intro/outro-triggered team buffs**
    (`selfApplicable` timeline entries, team-sim.js): those triggers fire only
    in AUTO-INJECTED segments the wielder's rotation sim never sees
    (`withoutAutoCastSteps` strips authored intro/outro), so the wielder
    receiving their own window is provably double-count-free and their only
    honest credit — until this, Changli's S4 buffed every member EXCEPT
    Changli.
  - **Sanhua S6 + Yangyang S6 triggers curated** (effect-overrides.json,
    kit-text-verified — the established channel): Sanhua → detonate skillKeys
    (Ice Thorn excluded; 2-stack clause deliberately unmodeled — maxStacks
    fallback would flat-credit both stacks always); Yangyang → Feather Release
    key. Both flip from the flat residue to real windows via the existing
    partition, AND activate natively in the wielder's own sim for the first
    time. **Baizhi S6 stays flat honestly** — "when Euphonia is PICKED UP" is
    a player action, not a cast; deriving timing from the spawning cast would
    fabricate.
  - **Incoming-resonator transfers now RENDER** (`incomingDisplayEntries`,
    closing the long-standing display gap): strips in the RECEIVING member's
    own lane spanning exactly the segment the flat damage credit covers
    ("Lucilla · Outro transfer (flat)"), steps list "+25% Glacio DMG · from
    Lucilla". Display-only; transfer durations remain unparsed (disclosed).
  - Canaries: covered-6 solo 0 diffs; Chisa keeps Kumokiri/Glow (6.86M
    curated team); full suite 0 failures (`tests/team-buffs.test.mjs` → 39
    asserts); data + meta regenerated. Remaining open: source 2 (weapon/
    sonata conditional clauses) window derivation.

- **Two-clock timing model — schema shipped (2026-07-16, `docs/TIMING_MODEL.md`).**
  Maintainer decision: the Lane B game-asset (`AnimMontage`) extraction route
  is TOSSED — raw montage length doesn't equal effective cast time (input
  buffering/hitstop/swap-cancel windows shift it), matching why community
  sources (Maygi, arabwuwa) measure from live gameplay instead. New sourcing
  priority going forward (not yet executed — this pass is engine-readiness
  only): (1) import Maygi's calculator data (measured, needs her permission +
  credit), (2) frame-count from public 60fps footage (yt-dlp + ffmpeg), (3)
  estimate only as a last resort — every ability tags its own provenance.
  Also introduces a **two-clock model**: `gameTime` advances by
  `castTime - freezeTime` and is what cooldowns (and the DPS denominator in
  ToA-benchmark mode) tick against; `realTime` advances by the full
  `castTime` and is what buff/debuff durations always tick against (a
  benchmark's challenge-timer freeze doesn't pause an active buff) — this is
  why community ToA-benchmark DPS reads higher than a naive single-clock sim.
  **Shipped this pass** (engine schema + plumbing; zero real freeze data
  exists yet, so every number is byte-identical to before — verified via the
  full suite + a fresh `meta.json` regen showing only an `engineHash`/
  `generatedAt` diff):
  - `sim.js`: `resolveFreezeTime`/`resolveTimingSource` (mirror
    `resolveCastTime`'s override → per-type-default → hardcoded-fallback
    chain; fall back to `0`/`'estimated'` — the honest state of the entire
    roster today) and `deriveGameTimes(steps, timingMode)` (stamps
    `step.gameStartTime`/`gameEndTime` from realTime minus cumulative freeze,
    mode-gated). Every step now also carries `freezeTime`/`timingSource`.
    `simulateRotation` gained a `timingMode` param (`'toa'` default /
    `'open'`, per the doc's scope note that the split is ToA-specific);
    `totals` gained `gameTime`, and `dps` now reads from it in `'toa'` mode.
  - `cooldowns.js`: `annotateStepCooldowns` gained a `timeKey` option
    (default `'startTime'`, back-compat) so callers can point it at
    `gameStartTime` once derived — cooldowns now genuinely tick against
    gameTime, not realTime.
  - `team-sim.js`: threads `timingMode` through every `simulateRotation`/
    `simulateIntro` call; the team cooldown loop derives gameTime **per
    member, over that member's own steps** before annotating (an HONEST,
    documented scope limit: a teammate's frozen Liberation does not yet
    propagate to reduce THIS member's cooldowns — true ToA freezes globally;
    modeling that needs a team-wide freeze schedule, deferred until real
    freeze data makes the distinction observable). Team `totals.gameTime`
    sums freeze consumed across all members' own casts (the correct GLOBAL
    figure for the DPS-denominator use, since that doesn't need per-member
    attribution).
  - `opener.js`: `deriveOpenerPadding`'s `tNow`/readySeed bookkeeping (which
    feeds cooldown-aware filler decisions) now also subtracts a cast's
    effective freeze in `'toa'` mode, for axis consistency with cooldowns.
  - `tests/timing-model.test.mjs` (35 asserts): resolver fallback chains,
    `deriveGameTimes` arithmetic (a mid-rotation frozen step shifts every
    later step's gameTime back, `'open'` mode ignores freeze entirely),
    `timeKey` cooldown-tracking, and solo/team `totals.gameTime` parity.
  - **Not yet done** (explicitly out of THIS pass's scope, per the chosen
    "engine schema first" step): the Maygi import, the frame-counting
    pipeline (yt-dlp/ffmpeg), and the arabwuwa validation pass. Also open:
    true team-wide freeze propagation (noted above) if it ever matters once
    real freeze data lands.

- **Forte extraction root-cause fix (2026-07-16)** — a rotation-drafter test
  run on Chisa surfaced a severe Ring-of-Chainsaw (Forte) gap: her entire
  ground basic combo showed `forteGen: 0` despite kit text explicitly
  granting it on every Normal Attack hit. Root cause (confirmed against the
  raw Arikatsu dump, not guessed): `tools/extract-forte.mjs` matched our
  ALREADY-COLLAPSED `damageTable.mults` (post-`parseMult`, which SUMS a
  multi-hit term like "20%*4" into one number) against a SINGLE raw BinData
  entry — this can only ever work for single-hit rows. Any row aggregating
  2+ raw hits (Chisa's whole basic combo, and roster-wide, MOST multi-stage
  attacks) could never rate-match, silently reporting 0. `preprocess.mjs`
  already solved this exact class of problem for nanoka's own energy/
  element_power fields (P13-fix-3's `matchRowHits` — full per-level TERM
  vectors, hit-count aware, ID-adjacency clustering). Fix: extracted the
  matching primitives (`parseHitTerms`/`rowTermVectors`/`termEntryMatches`/
  `isShadowEntry`/`pickHitCluster`/`matchRowHits`, now generalized over WHICH
  value(s) to sum) into a neutral `tools/rate-match.mjs`; `preprocess.mjs`
  imports it (verified byte-identical `wuwa-data.json` content hash — a pure
  refactor); `tools/extract-forte.mjs` rewritten to feed it the RAW per-row
  mult-STRING arrays recovered from the original nanoka character JSON (via
  each damageId's `nodeId`/`paramId`, the inverse of preprocess.mjs's own id
  assignment) instead of the collapsed numbers, matched against Arikatsu's
  per-character candidate pool (no cross-source node alignment assumed —
  rate-vector identity + ID-adjacency clustering disambiguates on their own).
  Result: Chisa's basic combo now carries real forteGen (basic_2:14,
  rending_lunge:20, death_snip:18, thread_withdrawn:16, vs. 0/0/0/0 before) —
  one loop + one Skill cast now reaches 73/100 Ring of Chainsaw, honest and
  data-grounded instead of "illustrative, can't be computed." Roster-wide:
  every previously-covered character (16 total, unchanged count) gained many
  previously-0 keys (typically the 2nd/3rd/4th stage of a basic combo); a few
  keys were also CORRECTED (a wrong key was being credited before, e.g.
  Rover: Havoc's `forte_heavy_erosion_field_dmg_per_tick` → the real
  `skill_beckon_breakdown_form`). Full test suite 0 failures (incl.
  `tests/opener.test.mjs`/`tests/cooldowns.test.mjs`, which depend on Forte
  data for some characters); meta regenerated. Still NOT modeled (separate,
  smaller, correctly-flagged gap): Intro's/Liberation's FLAT kit-text-only
  Ring-of-Chainsaw grants (+20/+40 for Chisa) — these are plain-text bonuses
  with no associated damage instance/rate vector at all, so no matching
  algorithm can recover them from either data source; would need a
  kit-text-curated override channel (a NEW small table merged in preprocess's
  forte-overlay block — NOT effect-overrides.json, which patches
  chain/inherent effect objects, a different target than skill-map entries),
  not attempted.

- **Forte extraction v3 — ID JOIN, matching deleted (2026-07-16, same day,
  supersedes the rewrite above).** Investigating "should we switch data
  sourcing entirely to Arikatsu BinData?" (maintainer question) established
  the decisive fact: **nanoka's per-hit entry IDs ARE the game's own BinData
  damage IDs** — all 2,650 nanoka `sk.damage` entries roster-wide exist in
  the Arikatsu dump under the identical ID, 2,629 value-identical on (full
  rate vector + energy + element_power); nanoka is a projection of the same
  table with SpecialEnergy dropped. The 21 value disagreements are the DUMP
  being stale vs. current-patch nanoka (Lucilla Concerto rebalance, 1511 rate
  drift) — an argument AGAINST a full source switch (freshness), alongside
  BinData's unresolved localization keys and per-NODE (not per-display-row)
  `DamageList`. Decision: **no source switch; ID-join overlay instead**:
  - `tools/rate-match.mjs matchRowHits` now also returns `hitIds` (the raw
    entry ID of every counted hit, aligned with hitTypes, repeats mirrored).
  - `tools/preprocess.mjs` records them per skill key and writes
    **`data/hit-map.json`** (committed, tools-only artifact — the runtime
    never fetches it, so it is deliberately NOT in the data-version hash;
    53 resonators, 2,855 hit IDs).
  - `tools/extract-forte.mjs` is now a **pure ID join** (hit-map × Arikatsu
    `damage.json` SpecialEnergy → `data/forte-data.json`); ALL rate-matching
    against Arikatsu deleted (both the original collapsed-mults matcher and
    the same-day matchRowHits-based rewrite). One attribution algorithm, one
    place (preprocess), zero re-matching. It reports stale-dump IDs honestly
    (absent-from-dump = nanoka newer, refresh the dump).
  - Results: **100% join (2,855/2,855)**; Forte coverage 16 → **21
    resonators** (new: 1105, 1108 Hiyuki — cap 300 = her Dedication exactly,
    1501, 1510, 1511); Chisa 13 → 22 gen keys **including the SPEND side**
    (her Sawring-Blitz stages carry negative forteGen, matching "consume Ring
    of Chainsaw on hit"; opener.js already treats non-positive forte-type
    casts as payoffs, so the semantics compose). 240 skills stamped.
  - Verification: full suite 0 failures incl. new `tests/hit-map.test.mjs`
    (structure, Chisa 3-hit anchor, energy↔hit-map cross-consistency, forte
    anchors, 100%-join invariant when the dump is present); module sweep OK;
    meta regenerated — covered-6 solo sections ZERO diffs (forteGen is
    consumed only by opener.js, never by solo damage); the large teams-diff
    is legitimate opener-path churn from 21 chars' improved Forte data;
    newly-covered chars' opener probes healthy (≤42s filler, zero gated).

- **BinData dumps are now committed + flat on-cast Forte grants extracted
  (2026-07-16, same day).** Two follow-ups by maintainer direction:
  - **`data/bindata/{damage,skill,baseproperty,roleinfo}.json`** — the four
    Arikatsu dumps moved out of the gitignored `docs/` into a tracked
    location (~25MB total; large but infrequently-updated raw tables) so a
    fresh checkout can regenerate Forte data. All path references updated
    (`extract-forte.mjs`, `tests/hit-map.test.mjs`).
  - **Flat on-cast gauge grants** (`extract-forte.mjs` Phase 2): kit-text
    "Casting X grants N points of [Resource]" state effects have NO damage
    instance in any source — invisible to the per-hit ID join by
    construction. A roster-wide sweep (7 resonators matched the phrase
    family) split into: TRUE Chisa-pattern (flat top-up of the modeled
    channel — Chisa, Aemeath), SECOND-gauge grants (Hiyuki's cast-only
    Dedication vs. her per-hit Frostheart, both cap 300 — needs multi-gauge
    modeling), flat-only kits with NO per-hit channel at all (Iuno's
    Sentience, Lynae's Overflow, Galbrena's Afterflame — need a flat-only
    gauge concept), and non-gauge resources (Aemeath's 4-star "Resonance
    Rate" cap 4 — a stack system, not SpecialEnergy; Denia's per-second Void
    Particle — continuous regen). The extractor auto-applies ONLY the fully
    unambiguous class, five gates each kit-text-verified: unconditional
    sentence; mechanically-resolvable cast trigger (Intro/Liberation
    type-level, or exact normalized-label match); resource-cap match to the
    SELECTED channel incl. ×100 raw-scale detection (Aemeath: kit cap 200 vs
    raw 20000 — kit-text "+40" = +4000 raw; floor cap≥20 so a 3-point stack
    counter can never coincidentally pass as ÷100 display — caught live:
    Frostharden Iai 3×100 == Frostheart's 300); on-hit text-to-signal
    tiebreaker when sibling channels share a cap (the resource with declared
    ON-HIT income IS the per-hit-selected channel; grant verb must attach to
    the resource — a "consume [R] … on hit" co-mention false-positived until
    tightened); double-count guard (target key already carrying per-hit gen
    is flagged, not topped up). Result: **5 applied** (Chisa liberation +40 /
    intro +20; Aemeath both intros +4000, liberation +3000), **14 flagged**
    with reasons (printed by the tool, deliberately NOT applied), 3
    no-channel kits surfaced. Applied grants audit-recorded under `flat` in
    `forte-data.json`; `gen` carries the folded totals preprocess stamps.
  - **Maintainer-provided gauge mechanics (recorded for the future
    multi-gauge work):** Forte gauges usually fill → enhance/unlock another
    ability; newer kits LAYER gauges tied to their special states. Aemeath:
    two 200-point bars acting as one pool (one full bar → enhanced Resonance
    Skill; enhanced casts fill 4 "stars" = Resonance Rate; 4 stars + recent
    normal Liberation → a special Heavy unlocks her free special Liberation).
    Hiyuki: 3-step Dedication (3×100) unlocks her Liberation-state; inside it,
    two more meters (Whiteout Bitterfrost → special heavies; Frostheart
    step-charges the in-state Liberation). Our single-channel model
    approximates "one bar full → payoff" only; the second gauge + star/stack
    layers are unmodeled (SE4/SE5 checked: global defaults roster-wide, so
    Aemeath's stars are NOT a SpecialEnergy channel — likely buff-stacks).
  - Verification: full suite 0 failures (`tests/hit-map.test.mjs` → 20
    asserts, incl. flat-grant anchors + both guard regressions); data + meta
    regenerated (245 skills stamped, up from 240).

The history below is preserved for reference.

## ~~CURRENT PHASE: PHASE 10~~ (complete)

Phase 9 is complete (12/12 regression checks, 16/16 module loads, 996/996 skill
descriptions, 218 chain/inherent effects across 52/53 chars).

Work items in **strict dependency order**:

### P10-1 · Mechanics-aware rotation graph

- Stub in `src/core/rotation-graph.js` (already has `fromLinear`, `toLinear`,
  `addPrerequisite`, `prerequisitesSatisfied` by-index, `validateRotation`,
  `buildRuleGraph`).
- **TODO:** Add runtime variant `prerequisitesSatisfied(graph, nodeId, completedSet)`
  where `completedSet: Set<skillKey>` is what's been cast so far. Availability
  depends on what's actually been cast, not position order.
- 44/53 resonators have state-gated mechanics → `prerequisite` edges in `ROTATION_RULES`.

### P10-2 · Off-field Phase 2 — state-tracked mechanics

Blocked on P10-1 (state activation comes from the rotation graph).

- **Phrolova / Maestro state:** Hecate off-field damage is conditional on being in
  `maestro` state. Extend `OffFieldAction` with optional `requiresState: string`.
  `computeOffFieldContribution` checks member's active states for the window.
- **Ciaccona / Recital:** time-bounded periodic emitter during the Liberation Recital
  window — like a turret but gated by an active state.
- State activation: set by Liberation/Outro in the rotation graph (P10-1).

### P10-3 · Conditional effect stacks & states

Blocked on P10-1.

- Extend effect objects with `stackable: true`, `maxStacks: N`, `perStack: value`.
- `parseEffectsFromDesc` in `buffs.js` already isolates condition text — extend it
  to detect "per stack" / "up to N stacks" and emit stack metadata.
- UI: replace checkbox with stack stepper for stackable effects.
- Reference characters: Carlotta Deconstruction stacks, Snowforged Blade counts.

### P10-4 · Echo set optimizer

Blocked on P10-1, P10-2, P10-3.

- Combinadic substat enumeration over the legal substat pool.
- `setConstLut` caching: precompute the constant (non-substat) portion of damage
  once per rotation, then only vary substats.
- Target: suggest optimal echo main/sub configuration for a chosen rotation.

### P10-5 · Echo grading & UI/UX polish

- Substat roll-quality grading vs. theoretical max.
- General polish pass.


---

## Simplification Plan S1 — knowledge rescue (2026-07-17)

Maintainer approved `docs/SIMPLIFICATION-PLAN.md` (drafted same session after
a repo audit found: only README tracked as docs; CLAUDE.md a 1,262-line
changelog; 4 monolith files; 3-lane buff sprawl; abbreviation-heavy naming;
zero guardrails). S1 shipped:

- **docs/ + CLAUDE.md are now tracked.** Local-only material (screenshots,
  resonator-art, design handoff, personal notes, pasted third-party
  references, generic Figma tutorials) moved to gitignored `docs-local/`;
  generated `docs/meta-validation.md` + `docs/effect-audit.md` stay
  gitignored (tools keep writing those paths).
- **CLAUDE.md rewritten lean (~200 lines):** rules/invariants/commands only,
  plus the new CODE STYLE — NAMING section (plan §S3.1) and two new
  invariant rows (cast triggers are MECHANICAL; team-buff paths are
  disjoint). The whole P10→P13 chronicle moved VERBATIM here (this file).
  Module sweep converted to a one-liner covering all 28 src/core modules.
- **docs/ARCHITECTURE.md (new):** pipeline, life-of-a-damage-number worked
  trace (Carlotta Liberation: skillType 'liberation' / formulaType 'skill'),
  life-of-a-buff source→path table (7 sources, 3 disjoint team-wide lanes),
  life-of-a-team-sim, full module map, hand-curated-data lookup table.
- **docs/GLOSSARY.md (new):** game terms + project-invented terms
  (canonical names for the one-concept-one-name rule).
- **README:** "Start here" reading path, docs/ in the layout tree, stale
  "gitignored" mention fixed.

Verification: full tests/*.test.mjs suite exit 0 + module-load sweep OK
(no executable code touched). Residual: S2–S5 pending per the plan.

---

## Simplification Plan S2 — guardrails (2026-07-17)

Shipped the tooling layer (plan §3). The runtime stays dependency-free;
everything below is dev-only.

- **package.json** (`"type": "module"`, engines ≥18, devDeps eslint/@eslint/js/
  globals only): `npm test` (tools/run-tests.mjs — cross-platform runner,
  replaces the bash/PowerShell loop), `npm run sweep` (tools/sweep-modules.mjs
  — imports EVERY src module by directory walk, 49 imported / app.js skipped
  as the DOM entry point; replaces CLAUDE.md's hand-kept 31-module list),
  `npm run lint`, `npm run data`, `npm run meta`.
- **ESLint flat config** (eslint.config.js): `recommended` as errors + the
  CLAUDE.md style rules as warnings (`id-length` min 3 with the sanctioned
  exception list, `max-lines-per-function` 80, `complexity` 12). Config
  carve-outs for legit idioms: `ignoreRestSiblings` (destructure-to-omit),
  `varsIgnorePattern ^_`, `allowEmptyCatch`, `no-control-regex` off (the
  text-cleaning pipeline strips control chars deliberately).
- **Initial lint burn-down: 45 errors → 0.** ~12 were config-level false
  positives; the other ~30 were real dead code removed across 18 files:
  unused imports (SKILL_KEYS in stats.js, resolveCastTime/TEAM_SLOTS in
  team-sim.js, renderV2Header in app.js, weaponStatsLine in
  build-editor-v2.js, …), dead functions (sim.js skillLevelFor +
  FORMULA_TO_SKILL_KEY copy, stats.js dmgBonusPropForElement, build-editor's
  stubCard), unused params removed WITH their call sites (resolveEchoSkill
  `build`, primarySonata `dataset`, preprocess projectNanokaCharacterFull
  `propDict` + parseEffectsFromDesc `ownerLabel`, download-icons `category`),
  `hasOwnProperty` → `Object.hasOwn`, dead `dimbreathWeaponIds`.
  Remaining warnings = 2,496 (id-length ~2.4k, complexity 97,
  max-lines-per-function 24) — the measured S3/S4 backlog.
- **src/core/types.js** (new, type-only, NOT in ENGINE_FILES): central JSDoc
  typedefs (StatRoll, EchoSlot, WeaponEquip, Build, Target, TotalStats,
  SkillDef, SimStep, SimTotals, SimResult, BuffEffect, OffFieldAction) +
  jsconfig.json (checkJs off; files opt in via `// @ts-check`).
- **CI** (.github/workflows/ci.yml): npm ci → test → sweep → lint on every
  push/PR. LOCK A/B stay local (preprocess may fetch network sources).
- **Docs:** CLAUDE.md Test commands + pipeline commands now npm-based, with
  a new "reading the locks" note (generatedAt/manifest-hash churn is noise;
  engineHash moves on any ENGINE_FILES content change; anything else is a
  real regression). README test section updated; ARCHITECTURE.md module map
  gained types.js.

Verification: `npm test` 55/55 · sweep 49/0 failed · lint 0 errors ·
LOCK A byte-identical (timestamp-only churn reverted) · LOCK B run twice,
diff = engineHash + generatedAt only, all 252 optimizer scenarios numerically
identical — the dead-code removals are proven behavior-preserving.
Residual: wuwa-meta.json's committed engineHash now reflects the cleaned
engine files; the 2,496 style warnings are intentional debt tracked for S3/S4.

---

## Simplification Plan S3 — naming pass (2026-07-17)

Four rename-only commits (12928a9, 487bd03, 97134fe, 43e84c8), ~1,250
variables renamed via a scope-aware codemod (espree + eslint-scope, both
already present as ESLint deps): local variables/params only, per-line
mappings where one letter meant several things, collision/capture detection
(refusals like e->echo inside a callback closing over an outer `echo` were
auto-caught and given different names), shorthand-property expansion so
object shapes never changed.

- **(1/4) src/core rename table:** reso->resonator, wcond/wpass/scond->
  weaponConditional/weaponPassive/sonataConditional, seg->segment,
  st->state|step|stackTrigger, lv->level, idx->index, cur->current,
  mult->multiplier, arr->list-specific names; stale comments updated.
- **(2/4) src/core singles:** every remaining 1–2-char local in all 26 core
  modules renamed per-site (s/e/t/w/r/m/a/b/wt/ft/tl/ms/iv/...). src/core
  100% clean; id-length RATCHETED to error for src/core/**.
- **(3/4) tools:** all 454 flagged locals. preprocess.mjs's text-resolver
  `t` -> `resolveText` end-to-end; nanoka node-skill `sk` -> `skill`;
  effectSlot() { arr, idx } -> { effects, index } (+ test); ratchet extended
  to tools/**.
- **(4/4) src/ui + src/data + tests:** table names eliminated repo-wide
  (grep returns nothing), including compare-v2's view-model PROPERTY
  m.reso -> m.resonator, data-act "pick-reso"/"remove-reso" ->
  "-resonator" (markup + handlers together), data-idx/data-warn-idx ->
  data-index/data-warn-index; src/data fully clean + ratcheted; tests'
  `sk.damage[*].type` comments -> `skill.damage[*].type` (CLAUDE.md
  invariant wording updated to match).

Deliberate scope boundary: ~1,630 id-length WARNINGS remain — single-letter
lambda params in test bodies and the three large UI components (461 sites).
The UI trio is decomposed in S4.2; renaming lands there instead of touching
those files twice. Warnings stay visible as the tracked backlog.

Verification per commit: npm test 55/55 + sweep + lint 0 errors; LOCK A run
after every preprocess touch (generatedAt-only diff = byte-identical
content); LOCK B after core changes (engineHash-only diff, all 252 optimizer
scenarios numerically identical); forte-data.json regeneration zero-diff;
compare-v2 48/48 + team-editor-v2 109/109 exercised the data-act renames.

---

## Simplification Plan S4.1 — preprocess.mjs split (2026-07-17)

The 3,121-line preprocess monolith is now a 583-line CLI entry
(parseArgs/printHelp/main orchestration) + ten stage modules under
`tools/preprocess/`: download (146), text (68), constants (87),
base-stats (163), skill-rows (381), effects (440), resonators (848 — the
full nanoka kit projection, a coherent unit and the future refinement
target), weapons (152), echoes (222), sonatas (142).

Method: a segment-mover script cut the file on declaration boundaries
(preceding comment banners travel with their section), moved bodies
VERBATIM, and added `export` to moved declarations; import lists were
derived mechanically from ESLint `no-undef` reports (and stale entry
imports from `no-unused-vars`). One functional hazard existed — module-
relative paths (`__dirname`/`import.meta.url` + `../data`, `../assets`)
deepened by one level — and LOCK A caught the one miss for real: three
Rover iconUrls flipped to remote because the local-asset probe no longer
found `assets/`. Fixed all four probe/read paths; re-ran LOCK A:
content hashes UNCHANGED (byte-identical wuwa-data.json + hit-map.json),
generatedAt-only churn reverted.

`resolveNanokaStat`/`NANOKA_STAT_NAME`/`RATIO_ALIAS` moved to weapons.mjs
(their only consumer) rather than resonators, avoiding a projector→
projector import. FORMULA_RECLASSIFICATIONS/AMBIGUOUS stay in
skill-rows.mjs as exported (mutable-content) report arrays, pushed by
resonators and read by the entry's summary output.

Verification: LOCK A content-hash-identical; npm test 55/55; sweep 49/0
(new modules auto-covered by the directory walk); lint 0 errors (the new
modules inherit the tools/** id-length ERROR ratchet). ENGINE_FILES
untouched (no src/core change; no meta regen needed).
Residual: main() is still one 400-line function (complexity warning) —
its stage extraction is the natural follow-up; resonators.mjs's
projectNanokaCharacterFull (700+ lines) likewise.

---

## Simplification Plan S4.2 — build-editor split (2026-07-17)

The 4,012-line build-editor-v2.js is now src/ui/components/build-editor/:
index.js (221 — mount/commit/paint composition root) + state.js (14 — the
`api` holder with setApi(), since ESM importers cannot reassign an imported
binding; mount's whole-object assignment is the one non-verbatim body edit)
+ 10 panel modules: rotation (752), bind (704 — delegated events, pickers,
drag-and-drop), echoes (431), resonator-card (358), menus (325),
shared (319), stats-panel (280), stat-priority (248),
suggested-teams-panel (242), ability-overview (166).

Method: the S4.1 segment-mover generalized (optional-export declaration
regex); imports derived from ESLint no-undef against a name→source table
built from the original header; namespace imports (modal, echoPicker) and
the openWeaponPickerModal alias handled explicitly. Complete migration:
app.js + tests/build-editor-v2.test.mjs import paths updated, the old file
deleted, every stale "build-editor-v2" comment reference across src/ + docs
retargeted.

The deferred S3 promise landed in the same change: all 265 single-letter
locals in the new modules renamed per-site (event/build/echo/sonata/window/
value/…; exported fN/fP → formatNumber/formatPercent folder-wide), and
build-editor/** joined the id-length ERROR ratchet. Repo warnings
1,634 → 1,369 — the remainder is test bodies + the two other big UI files
(team-editor-v2, compare-v2, energy-chart et al.).

Verification: npm test 55/55 (incl. build-editor-v2.test via the new
index.js); module sweep 60 imported / 0 failed (11 new modules auto-
covered; no load-order/cycle failures); lint 0 errors. No src/core change —
no meta regen. Residual: bind.js and rotation.js exceed the 80-line-
function warning (bind() is one large wiring function by design); browser
smoke of every panel is still worth a manual pass before the next release.

---

## Simplification Plan S4.3 — team-sim stage extraction (2026-07-17)

simulateTeamRotation (~700 lines, the densest function in the codebase) is
now a ~170-line orchestrator over 17 named pipeline stages, extracted in
three verified increments (tests + LOCK B after each):

- **A (tail):** collectMemberSteps, annotateTeamCooldowns (cooldown overlay
  + per-member freeze), computeMemberEnergy.
- **B (setup):** resolveMemberContext (per-member stats/inflicts/flat
  team-wide bundles/window specs/energy constants, once up front); the three
  team-buff-timeline closures became top-level stages over an explicit
  `timeline` context ({ runs, memberStackedBuffWindows }):
  accrueSegmentWindowsToTimeline, timelineWindowsFor,
  accrueChainEffectWindowsToTimeline.
- **C (the walk):** loop state became an explicit `sim` context (cursor and
  prevSwapReady are the two mutable scalars; the rest accumulate) and the
  turn body became beginTurn → runIntroSegment → runRotationSegment
  (+ accrueStatusDamage and attachIncomingTransferDisplay sub-stages)
  → applyOffFieldContributions → recordOutroSwap. CONCERTO_MAX hoisted to a
  module constant. Every load-bearing comment (maintainer rules, honest-
  model notes) moved into the owning stage's header instead of being lost.

This is the plan's "pass an explicit context object — arguments instead of
closures" design, applied without behavior change: LOCK B after every
increment showed engineHash+generatedAt only — all 252 optimizer scenarios
numerically identical through the restructure. Full suite 55/55; targeted
team-facing tests (meta-schema 8103, team-buffs, team-effect, team-energy,
concerto, opener, sim-enrichment, timing-model, team-rank) all pass.

Residual: runRotationSegment exceeds the 80-line warning (~115 with its
header — it is the honest core of the turn); ENGINE_FILES unchanged (same
file, restructured).

---

## Simplification Plan S4.4 — sim.js window-machinery split (2026-07-17)

sim.js (1,044 lines) → sim.js (684 — the rotation walk, skill-map/cast-time/
freeze-time resolution, energy trace, totals) + src/core/buff-windows.js
(380 — computeBuffWindows, applyBuffsToSteps, deriveBuffWindows/
deriveEffectWindows/deriveStateWindows, windowStacksAtStep as the ONE
stack-count authority shared by damage scaling and display, plus the
shortBuffLabel/fmtPctTrim label formatters). Bodies moved verbatim by the
segment-mover; the dependency graph came out acyclic (buff-windows depends
only on sonata-buffs/buff-timeline/triggerability — sim.js imports FROM it,
never the reverse).

Importer updates (complete migration): team-sim.js and
tests/sim-enrichment.test.mjs re-pointed for the five moved public names
(deriveBuffWindows, deriveEffectWindows, deriveStateWindows,
windowStacksAtStep, shortBuffLabel); the other ~20 sim.js importers use only
walk/timing exports and were untouched. ENGINE_FILES gained
'buff-windows.js' in BOTH lists (tools/optimize.mjs + meta-schema test) —
the in-sync rule held.

Verification: LOCK B — 4-line diff (engineHash + generatedAt), all 252
optimizer scenarios numerically identical; npm test 55/55 (meta-schema's
staleness guard green against the new two-file hash); sweep 61 imported /
0 failed; lint 0 errors (moved code was already S3-clean and inherits the
src/core ratchet). ARCHITECTURE.md module map updated.

S4 is now COMPLETE: preprocess (S4.1), build-editor (S4.2), team-sim stages
(S4.3), sim/buff-windows (S4.4). Remaining plan item: the optional S5
buff-module colocation.

---

## Simplification Plan S5 — buff-module colocation + path manifest (2026-07-17)

The plan's final phase, both halves:

1. **The manifest.** buffs.js's header now carries "THE BUFF-PATH MANIFEST"
   — the solo paths (constant vs windowed), the three disjoint team-wide
   lanes with their exact entry functions (LANE 1 teamWideWindowSpecs/
   teamWideContribution partition; LANE 2 weaponSonataTeamWide flat, window
   derivation the documented open item; LANE 3 wielder windows → team-buff
   timeline by literal overlap), and the targeted incoming-resonator
   transfer. The 20-line summary that used to take an afternoon of
   archaeology, mirroring ARCHITECTURE.md §4, at the exact place a
   buff-adding developer will be standing.

2. **The colocation.** buff-timeline.js, sonata-buffs.js,
   conditional-buffs.js, weapon-buffs.js + S4.4's buff-windows.js moved
   (git mv, contents untouched except relative-import depth) into
   src/core/buffs/; buffs.js stays at src/core/ as the model + manifest
   front. 10 consumer files re-pointed. ENGINE_FILES updated in BOTH lists —
   and a pre-existing STALENESS GAP closed while there: sonata-buffs/
   buff-timeline/weapon-buffs affect meta numbers but were never part of
   engineHash; all five buff modules are now hashed.

Verification: sweep 61 imported / 0 failed on first try; npm test 55/55
(meta-schema green against the expanded hash); LOCK B 4-line diff
(engineHash + generatedAt) — all 252 scenarios numerically identical;
lint 0 errors; stale path mentions in ARCHITECTURE/GLOSSARY/buff-bar
comments retargeted.

THE SIMPLIFICATION PLAN IS COMPLETE — S1 through S5, all shipped 2026-07-17.

---

## Build editor — scroll-persistent HUD strips (2026-07-18)

Added two thin, scroll-persistent overview bars to the Build editor
(`#edit2`), so a single resonator's damage/stats stay visible while scrolling
any panel.

- **Top strip** — per-hit average expected damage for the three headline
  ability categories: **Basic / Skill / Liberation**. "All instances" = every
  damaging hit across every `skillMap` entry of that node `skillType`; the
  value is their crit-weighted mean. Uses the SAME `resolveTotalStats` +
  `makeDmgTarget` that the Ability Damage Overview card resolves with, so strip
  and card never disagree (live-verified: overview Skill rows 716+1,399 avg to
  the strip's 1,057; Lib rows 1,000+600+1,600 avg to 1,066). The strip re-reads
  `api.dmgTarget`, so the card's enemy-level/RES inputs move it too. Sticky
  `top:0`; the editor's header is rendered NON-sticky so it scrolls away and the
  strip pins in its place (seamless "replace" handoff).
- **Bottom strip** — the build's most important stats: **ATK · CR · CD ·
  {Element} DMG · ER**, `includeConditionals:false` to match the stowed-screen
  TOTAL STATS card. Sticky `bottom:0`, pinned to the viewport bottom while
  scrolling.

**Root-cause fix — `position: sticky` was globally broken.** First live-browser
pass showed NOTHING stuck — not even the pre-existing header. Cause:
`responsive.css` set `html, body { overflow-x: hidden }`; `overflow-x:hidden`
forces the computed `overflow-y` from `visible` to `auto`, which turned `<body>`
(auto height, so it never actually scrolls — `<html>` does) into a phantom
scroll container. `position:sticky` then resolves against `<body>`, which has no
scroll range, so every sticky descendant just scrolled away. Fixed by switching
to `overflow-x: clip` (clips the same horizontal overflow but does NOT promote
the other axis, so the viewport stays the scroll root). This also un-breaks the
shared header's own sticky on the OTHER v2 pages (roster/party/compare).

**Header handoff.** Rather than overlap-cover a pinned header (which left its
active-tab `box-shadow` glow bleeding below the strip), `renderV2Header` gained a
`sticky` option; the editor passes `sticky:false` so the header scrolls off and
the strip (same 46px height) takes the top edge cleanly.

**[Files Changed]** `src/ui/components/build-editor/strips.js` (new —
`abilityAverages`, `renderTopStrip`, `renderBottomStrip`);
`build-editor/index.js` (mount both strips in `renderPage`; header
`sticky:false`; toast bumped `bottom:28px`→`56px` to clear the bottom strip);
`build-editor/shared.js` (new `makeDmgTarget` helper);
`build-editor/ability-overview.js` (use the shared `makeDmgTarget`, dropping its
inline target block); `components/v2-header.js` (new `sticky` option, default
true); `styles/build-v2.css` (`.bv2-hud*` rules); `styles/responsive.css`
(`overflow-x: hidden`→`clip`, the sticky root-cause fix).

**[Logic Altered]** No engine change — strips are display-only, computed from
existing resolvers. `makeDmgTarget` extracted for DRY (one target builder for
the card + the strip); overview card output is byte-identical. The
`overflow-x: clip` and non-sticky editor header are the only cross-page-visible
changes (both intended).

**[Verification Method]** `npm run sweep` 62/0 failed; `npm test` 55/55;
`eslint` 0 errors (2 pre-existing ability-overview style warnings, unchanged).
Headless render harness drove the three render fns against real
`wuwa-data.json` for 5 resonators — distinct, sane averages + correct stat
cells. **Live Playwright** (Chromium, own static server, `C:\tmp\pw-shots`):
measured header/strip/bottom-strip `getBoundingClientRect` at scrollY 0 / 600 /
max — header `top` goes −600/−4590 (scrolls away), top strip clamps to `top:0`,
bottom strip holds `bottom:800` throughout; screenshots confirm clean handoff
(no glow remnant) in BOTH dark and light themes.

**[Residual Risks]** `overflow-x: clip` needs a modern browser (Chrome 90+,
Firefox 81+, Safari 16+) — fine for this ESM-only app, but a hard floor. The
editor header is now intentionally non-sticky (nav returns on scroll-up) — a
deliberate consequence of "replace". On very narrow viewports the bottom
strip's 5 cells fall back to horizontal scroll (`overflow-x:auto`).

**[Updated Docs]** This entry.

---

## Build editor — ECHOES panel cleanup (2026-07-18)

Four maintainer-requested fixes to the ECHOES card, done step-by-step with
live Playwright screenshots (dark + light) between each.

1. **Long echo names bled into the `+level · n/5` counter.** The name was a
   single ellipsis line with the counter ABSOLUTELY positioned on top of it, so
   long names ran underneath. Now name + counter share a flex row — name
   truncates (flex:1, ellipsis), counter sits beside it (flex:none).
2. **Removed the "neck" connector + accent frame outline.** Deleted the
   `.bv2-echo-neck` span, the selected-card right-edge opening CSS
   (`border-right-color:transparent` + squared right corners), AND the whole
   runtime corner-squaring machinery (`squareEchoFrameCorners()` + its `paint()`
   rAF call and window-resize listener in index.js). The frame border is now
   neutral `var(--bd)`, no glow.
3. **De-milked the frame.** Background `color-mix(--ea 8% card)` (an accent tint)
   → solid `var(--card2)`. The `--ea`/`--ec` inline accent custom-props are gone.
4. **Main stat → dropdown; MAIN STAT box removed from the frame.** Each rail card
   now carries a re-skinned native `<select class="bv2-echo-mainsel">` (value
   `"propId:addType"`, level-scaled labels, theme-aware popup via
   `color-scheme`); the auto 2nd main stat shows as a `2ND · ATK 150 auto`
   caption beneath it. The editor frame dropped its MAIN STAT button grid AND the
   redundant inner substats-box wrapper — it's now a single neutral box holding
   just the SUBSTATS editor, `align-self:flex-start` so it sizes to content
   instead of stretching to the taller 5-slot rail (no dead bordered space).

**[Files Changed]** `build-editor/echoes.js` (name row; main-stat dropdown +
2nd-stat caption on the card; `renderEchoEditor` reduced to the substats box;
dropped `margin-bottom` on the substats header; removed dead `accent`/`mainOpt`/
`mainLabel`/`mainVal`); `build-editor/bind.js` (`set-echo-main` click→change,
parses `propId:addType`; added it to the `select-echo` ignore list so opening
the native dropdown doesn't repaint-and-close it); `build-editor/index.js`
(deleted `squareEchoFrameCorners` + its two call sites); `styles/build-v2.css`
(removed `.bv2-echo-neck` + the right-edge-opening rule; neutralized
`.bv2-echo-frame`; added `.bv2-echo-mainsel`).

**[Logic Altered]** None in the engine — pure UI. The main-stat mutation is
identical (same `setEcho({...echo, mainStat})` payload), just triggered by a
select `change` carrying an encoded value instead of a button click carrying
data-attrs.

**[Verification Method]** `npm test` 55/55; `npm run sweep` 62/0; `eslint .`
0 errors (1371 pre-existing style warnings). Live Playwright: equipped a
long-named echo (`Reminiscence: Threnodian - Voidborne Construct`) + two more,
drove the new dropdown via `selectOption` (slot 0 → "Crit. DMG 44%", confirmed
applied through the change handler), screenshotted the filled + empty states in
both themes — names truncate cleanly, frame is neutral/de-milked/no-neck, main
stat picks from the card dropdown, no dead space.

**[Residual Risks]** The native `<select>` option popup is OS-rendered (only the
closed control is fully token-styled); `color-scheme` keeps it theme-matched on
Chromium/Firefox. None otherwise.

**[Updated Docs]** This entry.

### Follow-up same day — dropdown readability + coherent form restored

Two maintainer refinements after seeing the above:

1. **Dark-mode dropdown list was hard to read.** The re-skinned `<select>`'s OPEN
   popup inherited muddy translucent tokens. Added
   `.bv2-echo-mainsel option { background-color:var(--card2); color:var(--txt); }`
   (plus the existing `color-scheme`) — verified via computed style: option bg
   `#131a21` (solid) + text `#e9eef1` in dark, and it flips for light.
2. **Restored the connected "one coherent form" (echo card + substat box)** —
   but neutral, reversing part of point 2 above. The neck connector + the
   `squareEchoFrameCorners()` corner-squaring came back, and the frame stretches
   again (dropped `align-self:flex-start`); the substat groups now
   `align-content:space-between` (`.bv2-echo-groups { flex:1 }`) to fill the
   stretched height so there's still no dead space. Crucially the whole form is
   NEUTRAL now: selected card + neck + box all share `var(--card2)` fill +
   `var(--bd)` border (no milky accent fill, no tall gold left-line). "Active"
   is marked by a small `inset 3px` accent bar on the card's LEFT edge (gold for
   the main slot, `--acc` for sub slots) — never the right, which is opened so
   the neck bridges seamlessly. Live geometry confirmed: neck right (343) meets
   frame left (344), neck/frame/card tops all 107, so the box's top-left squares
   to the neck; screenshots verified in dark + light.

Verification: `npm test` 55/55; sweep 62/0; `eslint .` 0 errors.

### Follow-up — kill the card↔box seam (the "notch")

Maintainer wanted the coherent form's outline (card + box as one enclosure) but
WITHOUT the vertical seam line at the join. Two-part fix, both in build-v2.css:

1. **The neck now overlaps 3px PAST the box's left edge** (`right:-19px;
   width:22px`, was `-16/19`) so its fill covers the box's own 1px left border at
   the join — the card plugs into a NOTCH in the box's left side instead of butting
   up against a border line.
2. **Root cause was stacking, not geometry.** The substat box is a later flex
   sibling, so it painted its left border OVER the neck (which lives inside the
   rail card) — the overlap was invisible. Added `z-index:2` to the selected card
   so it (and its neck) paint above the box. Verified with a debug pass
   (magenta neck / lime box-border): pre-fix the lime border drew over the neck;
   post-fix the neck covers it, leaving the box border only above/below the card
   (the notch). Confirmed neutral in dark (mid slot) + light (top slot).

Verification: sweep 62/0, `npm test` 55/55, `eslint .` 0 errors.

### Follow-up — coherent-form outline is now a single SVG path (sub-pixel fix)

The card→box "coherent form" was three elements' 1px borders (card + neck + box)
stacked to look continuous. Under fractional device-pixel scaling (non-100%
zoom / HiDPI) each border rounds to the device grid INDEPENDENTLY, so at some
zooms they land a device pixel apart — the reported "top outline jumps 1px up /
bottom line sticks into the box" artifact. Reproduced deterministically at
deviceScaleFactor 1.25 (neck top at CSS y=392.75 → 392.75×1.25=490.94, rounds
differently than the box border).

Fix (maintainer chose the robust option): draw the ENTIRE outline as ONE
element — an `<svg class="bv2-echo-outline">` overlaying the echoes body, a
single stroked `<path>`. The card, neck, and box now carry only their FILL
(`border-color:transparent`; default border-box background-clip still fills to
the edge the path traces). Because it's one element, every edge rounds together
— no relative jump/stub possible at any zoom.

`computeEchoOutline()` (replaces `squareEchoFrameCorners`; still rAF-after-paint
+ resize) measures the selected card + frame and builds the path via
`echoOutlinePath()`: a rounded box with a left-side NOTCH where the card's tab
plugs in, handling tab-flush-top (slot 0), flush-bottom (last slot), and the
mid-slot notch; coords snapped to x.5 for crisp 1px strokes. Empty slot → plain
rounded box (no tab).

**[Files]** `build-editor/index.js` (computeEchoOutline + echoOutlinePath);
`build-editor/echoes.js` (`.bv2-echo-body` wrapper + `<svg>` overlay; neck is
now fill-only in prose); `styles/build-v2.css` (card/neck/frame borders →
transparent; `.bv2-echo-outline` + path styles).

**[Verify]** Reproduced the artifact at DPR 1.25 pre-fix; post-fix a bright-
stroke render confirmed the notch shape (slot 0 flush-top, slot 1 mid-notch via
logged path coords), and a DPR-1.25 close-up shows both notch corners as clean
turns — no stub, no step. Empty-slot outline renders (plain box). `npm test`
55/55; sweep 62/0; `eslint .` 0 errors (id-length is CI-gating — the path
math vars use full words: boxRadius/tabRadius/left/top/right/bottom/tab*).

## Echoes panel — polish pass (2026-07-19)

Five maintainer-requested changes to the ECHOES panel:

1. **REMOVE ALL is destructive-styled + confirmed.** Red (the shared danger
   treatment: `--warn` 8% fill / 30% border / `--warn` text) and now gated by a
   `confirm()` naming the count ("Remove all 3 equipped echoes? Their levels,
   main stats and substats are lost."). No-ops when nothing is equipped.
2. **Tighter substat-group spacing.** `.bv2-echo-groups` gap 9px→6px and group
   padding 10px→8px, and — the real culprit — the frame's
   `align-content:space-between` (added earlier to fill the stretched box)
   became `flex-start`. That had been inflating the gaps between group ROWS to
   soak up the box's leftover height.
3. **RESET STATS** given the same red danger styling.
4. **Coherent form is now prominent.** `--form-accent` is set per render on
   `.bv2-echo-body` (GOLD when the MAIN slot is selected, `--acc` otherwise) and
   drives all three knobs, each independently tunable: the SVG outline `stroke`,
   a `drop-shadow` glow (`--form-glow`), and an accent-tinted fill
   (`--form-fill`, 7% over `--card2`). NOTE: card, neck and frame MUST all use
   `--form-fill` — any mismatch reopens a seam at the joins.
5. **Sonata piece-count chips hover their OWN tier.** Each `2PC`/`5PC` chip got
   `data-tip-title`/`data-tip-desc` for just that tier's effect plus its status
   (active, or "needs N pieces — M equipped"). The set icon still shows every
   tier.

**[Files]** `build-editor/echoes.js` (button styling, per-tier chip tips,
`--form-accent` on the body); `build-editor/bind.js` (remove-all confirm);
`styles/build-v2.css` (`--form-fill`/`--form-glow`, accent stroke + glow, group
spacing).

**[Verification]** `npm test` 55/55; sweep 62/0; `eslint .` 0 errors. Live
Playwright: REMOVE ALL dialog **dismiss → 3 echoes survive, accept → 0**
(gating proven, not just rendered); sonata chips dumped their real tooltips
(Rejuvenating Glow 2PC "Healing Bonus + 10%" / 5PC party-ATK, each with the
right active/needs status); dark + light screenshots for the red buttons,
tighter groups and the accent outline/glow/tint.

**[Residual]** Packing groups to the top (change 2) leaves visible empty space
at the BOTTOM of the box, since the box still stretches to the 5-slot rail
height so the outline's notch can reach any selected slot. Tightening the rows
and filling the box are in direct tension; flagged for the maintainer to call.

**[Deferred — own features, not started]**
- Echo template save/load sophistication: user-named templates, reusable
  globally rather than the current per-resonator `Preset N` autonaming.
- A "My Inventory" page owning the user's added resonators, weapons, echoes,
  echo sets, teams and rotations.

### Follow-up same day — tint containment, 2nd-main-stat relocation, sonata-filter pick

1. **The accent tint was bleeding into inner boxes/chips** ("milky" again). Cause:
   the inner surfaces paint `var(--node)`, which is TRANSLUCENT — laid straight
   onto the now-tinted parent it composited the tint through. Fix: composite
   `--node` over an opaque `--card2` on those elements instead
   (`background-color:var(--card2); background-image:linear-gradient(var(--node),
   var(--node))`), so they stay neutral regardless of `--form-fill`. Applied to
   `.bv2-echo-group`, `.bv2-echo-roll`, and `.bv2-echo-mainsel` (the last keeps
   its caret by stacking two background-images). RESET STATS' translucent warn
   tint likewise re-based onto `--card2`. Net: only the big coherent box's own
   background carries the tint.
2. **Auto 2nd main stat moved off the rail cards** (low-value info eating card
   room). It now rides the main-stat dropdown's hover `title` (per card) and is
   shown once beside the SUBSTATS title for the selected echo
   (`renderSubstatsHeader`). Cards are visibly shorter as a result.
3. **Picking under a sonata filter now equips THAT set.** `echo-picker-v2`'s pick
   handler captures `state.sonataF` before `close()` and passes it as
   `onPick(item, { sonataFilter })`; `openEchoPicker` uses it when the echo
   actually offers that set, else falls back to `sonataIds[0]` as before.
   Previously a multi-set echo always got its first set regardless of the filter.

**[Verification]** sweep 62/0; `npm test` 55/55; `eslint .` 0 errors. Live
Playwright: 6/6 sonata-filtered picks equipped the filtered set — and
"Nightmare: Kelpie" came out as Gusts of Welkin under one filter and Windward
Pilgrimage under another, proving the multi-set case actually switches (a test
selector bug initially read the echo NAME off the switch-echo icon, since it
also carries data-tip-title — corrected to exclude it). Screenshots confirm
neutral inner boxes and the relocated 2ND caption.

## Echoes panel — coherent-box insight tail + flush-corner fix (2026-07-22)

The coherent box stretches to the 5-slot rail (so its outline notch can reach
any selected card), which left dead space under the substat groups. The
maintainer chose to FILL that space with useful per-echo info rather than shrink
the box to content (rejected as jumpy — box height would change per selected
slot) or pad the group rows apart (the inflated spacing removed earlier).

**[Files Changed]**
- `src/ui/components/build-editor/echoes.js` — new `renderEchoInsights(echo,
  slotIndex)`; `renderEchoEditor` mounts it and squares the flush left corner.
- `styles/build-v2.css` — groups → natural height; `.bv2-echo-insights` /
  `.bv2-echo-skilldesc` layout + clip-fade.
- `docs/HISTORY.md`.

**[Logic Altered]**
1. **Insight tail** below the substat groups, two always-on meters + the skill
   text:
   - **DMG SHARE** (build-DEPENDENT): this echo's fraction of the summed live
     per-roll substat value across all equipped echoes, from the already-cached
     `echoUpgradeRanking().perEcho[].substatValue` — **no extra sims**. Bar is
     scaled to the top contributor (a raw ~20%/echo share reads as an empty bar);
     the number carries the true proportion + rank (`38% · #1/5`). Substat-only by
     design: main stat + cost are fixed by the slot, so the substats are the
     actionable signal — and it pairs with the existing "MOST TO GAIN" headroom
     badge (same analysis).
   - **ROLL LUCK** (build-INDEPENDENT): mean of each substat's normalized position
     within its own `possibleRollsFor` range. Pure RNG quality — deliberately
     orthogonal to DMG SHARE (an off-stat echo can be 100% lucky yet contribute
     0%). Labelled Unlucky/Below avg/Average/Lucky/Blessed around the uniform-mean
     of ~0.5.
   - **ACTIVE SKILL** text (`echoActiveSkillDesc`) as the flexible tail:
     `flex:1; min-height:0; overflow:hidden` so it takes leftover height and clips
     with a faint bottom mask-fade when the box is short (narrower viewport →
     taller wrapped groups → less room). The full text stays on the card's hover.
2. **Groups → natural height** (`.bv2-echo-frame .bv2-echo-groups` `flex:1` →
   `flex:none`) so the box's leftover height flows into the insight tail instead
   of the groups.
3. **Flush-corner gap fix.** The box stretches to the rail, so slot 0 is flush at
   its top edge and the last slot flush at its bottom (matches `echoOutlinePath`'s
   topFlush/botFlush). The box's `border-radius:14px` there receded the fill from
   the straight stroke, leaving the maintainer-reported gap. `renderEchoEditor`
   now squares only the touching left corner (`border-top-left-radius:0` for slot
   0, `border-bottom-left-radius:0` for the last slot); middle slots keep both
   rounded corners + the notch.

**[Verification Method]**
- `eslint .` 0 errors; `npm run sweep` 62/0; `npm test` 55/55.
- Node check against the real engine (Carlotta + reference rotation, 5 echoes
  with a spread of rolls): DMG SHARE sums to 100% across echoes, an off-stat
  (HP%/DEF%) echo reads 0% #5/5 while ROLL LUCK reads 100%, a min-roll on-stat
  echo reads 0% luck yet 24% share — confirming the two axes are orthogonal and
  `worstSlot` agrees with the badge. (First run under-provisioned `statRanges`,
  which the loader merges from `data/stat-ranges.json` — corrected.)
- Live Playwright (deviceScaleFactor 2): slot 0 top-left and last-slot bottom-left
  render a clean single stroke with no gap; middle slot keeps rounded corners +
  mid-rail notch; the insight tail renders DMG SHARE / ROLL LUCK / ACTIVE SKILL
  filling the former dead space, with geometry confirming meters-above-skill order
  and the skill body getting real height.

**[Residual Risks]** DMG SHARE is substat-only (main stat / echo-skill / set-bonus
contribution excluded) — a deliberate, honest scope, labelled and tooltip'd as
such; if the maintainer wants whole-echo marginal contribution instead it's a
metric swap (leave-one-out, at the cost of extra sims + set-threshold cliffs).

**[Updated Docs]** This summary. No CLAUDE.md invariant touched. ~~UI/CSS only~~
(superseded by the follow-up below, which touched one runtime engine file).

### Follow-up same day — four maintainer catches on the insight tail

1. **Content bled past the box on narrow widths.** Root cause: the insight
   wrapper was `flex:1 1 0; min-height:0`, which dropped its content out of the
   frame's min-content height — so when a narrow width wrapped the substat groups
   taller, the frame didn't grow and the meters overflowed into the tally strip
   below. Fix: the meters are now a flex:none DIRECT child of the frame (so they
   count toward min-content → the box GROWS to fit them via the row's
   align-items:stretch), and only the skill text (flex:1 + min-height:0) yields
   space; `.bv2-echo-frame` also gets `overflow:hidden` as a guarantee. The old
   `.bv2-echo-insights` wrapper is gone (→ `.bv2-echo-meters` + `.bv2-echo-skilldesc`).
2. **DMG SHARE ignored roll VALUES — a real bug.** `echoUpgradeRanking` summed
   `valueOf.get(key)` (the value of ONE AVERAGE roll of the stat) per substat,
   never scaling by the actual `sub.value`, so two echoes with identical stat
   TYPES but different roll QUALITY got identical share. Fixed in
   `src/core/live-weights.js`: each substat's value is now scaled by
   `sub.value ÷ (that stat's average roll magnitude)` — a faithful linear
   approximation over one substat's narrow range. This also makes the "MOST TO
   GAIN" headroom (same `substatValue`) roll-quality-aware, an improvement;
   `live-weights.test.mjs` (16/16) still holds (the junk off-stat echo remains
   worst). Runtime-only file — NOT an ENGINE_FILE, so `wuwa-meta.json` is
   unchanged (locks verified: `generatedAt` churn only).
3. **The "Blessed" luck bar rendered black.** The top two roll tiers carry a
   gradient in `.bg` and a DARK ink in `.c`; the bar fill used `.c`. Now tiers
   ≥ 6 use `.bg`, so Blessed shows the prismatic rainbow (silver just below),
   matching the highest-rarity roll chip.
4. **Skill text didn't clip on shrink, and lacked the tooltip's formatting.**
   (a) fixed by #1 — it now clips to zero when the box runs short (verified:
   `skillH` 0 at 760 px width, meters still above the tally strip). (b) It now
   runs through `formatTipDesc(esc(...))` — the same formatter the hover box
   uses — so element names and %-values are coloured identically.

**[Files Changed]** `src/core/live-weights.js` (roll-magnitude weighting),
`src/ui/components/build-editor/echoes.js` (gradient luck fill, `formatTipDesc`
import + use, direct-child insight structure), `styles/build-v2.css` (frame
`overflow:hidden`, `.bv2-echo-meters`, comment fixups).

**[Verification]** `eslint .` 0 errors; sweep 62/0; `npm test` 55/55 (incl.
live-weights 16/16). Node check: two echoes with identical types differing only
in roll quality now read 63% vs 37% DMG SHARE (was a flat 50/50). Live Playwright
(2× DPI): the Blessed bar renders the rainbow gradient; the skill text shows
gold %-values + element-coloured "Glacio"; at 760 px the box grows and the meters
stay above the tally strip (no bleed) while the skill text clips to zero.

### Follow-up 2 same day — grown-box corner + lone title

Both regressions live in the "box grows on narrow width" regime the first
follow-up introduced, and both are fixed in `computeEchoOutline` (the existing
post-layout pass), keyed off MEASURED geometry:

1. **Sharp corner jutting out with the last slot selected on shrink.** The
   flush-corner square was static (`renderEchoEditor`, keyed off the slot index),
   assuming the last card always reaches the box bottom. When a narrow width grows
   the box PAST the last card, that corner is no longer flush, so the static
   square jutted into the rail's empty tail. Moved the squaring into
   `computeEchoOutline`, which now sets `borderTopLeftRadius`/`borderBottomLeftRadius`
   from the same measured `topFlush`/`botFlush` the outline path uses — squared
   only when genuinely flush, rounded once the box outgrows the card. Removed the
   slot-index `cornerStyle` from `renderEchoEditor`.
2. **Lone "ACTIVE SKILL" heading lingered on shrink.** The label is flex:none so
   it survived when the body clipped to 0. `computeEchoOutline` now hides the WHOLE
   `.bv2-echo-skilldesc` (`visibility:hidden` — layout-stable, so no feedback into
   the height it reads) when its measured height is under ~one line + heading.

**[Files Changed]** `src/ui/components/build-editor/index.js` (geometry-driven
corner radii + skill-section hide in `computeEchoOutline`),
`src/ui/components/build-editor/echoes.js` (dropped the static `cornerStyle`).

**[Verification]** `eslint` 0 errors; sweep 62/0; `npm test` 55/55. Playwright:
last slot WIDE → `border-bottom-left-radius` 0px (squared, flush) + skill visible;
NARROW (box grew past card) → 14px (rounded, no bleed) + skill section
`visibility:hidden` (title gone) + meters/frame still above the tally strip.

## Build editor — top HUD strip: resonator name + overall avg hit (2026-07-22)

Two maintainer-requested cells on the scroll-persistent TOP strip. Pure UI.

**[Files Changed]** `src/ui/components/build-editor/strips.js`, `docs/HISTORY.md`.

**[Logic Altered]**
- **First cell = resonator name** in its ELEMENT colour (label = element name,
  e.g. `GLACIO | Carlotta`), from `resonatorOf()` + `ELEM[element]`.
- **Last cell = OVERALL AVG** — the mean expected damage across EVERY hit instance
  in the kit (all skill types, not just the three headline categories), in
  `var(--txt)` to read as the aggregate. `abilityAverages()` was refactored to a
  single pass that buckets the three category means AND accumulates the global
  mean (each skill resolved once), rather than three filtered passes.

**[Verification Method]** `eslint .` 0 errors; sweep 62/0; `npm test` 55/55. Live
Playwright (Carlotta): strip reads `GLACIO Carlotta` (Glacio-cyan) · BASIC 3,572 ·
SKILL 8,631 · LIB 8,705 · OVERALL 6,143 (white) — name element-coloured and first,
overall last and correctly between the basic and skill/lib means.

**[Residual Risks]** none — display-only, no bind wiring; the extra cells share the
existing `flex:1 1 0` + `overflow-x:auto` layout, so they degrade to a scroll on
very narrow viewports like the existing cells.

**[Updated Docs]** This summary.

## Build editor — undo / redo (2026-07-22)

Undo/redo for the build editor, exploiting the two facts that make it cheap: every
`build.js` mutator returns a NEW immutable build (`touch({ ...build })`, verified
no substructure is mutated in place — `metaOf`/rotation/echo mutators all rebuild
their arrays), and every edit funnels through one `commit()` chokepoint.

**[Files Changed]**
- `src/ui/history.js` (NEW) — `createHistory({ limit })`: two-stack (past/future)
  undo/redo over immutable snapshots. Reusable (the team editor can adopt it).
- `tests/history.test.mjs` (NEW) — 24 assertions: round-trip, redo-branch-cleared-
  on-new-edit, limit cap, clear.
- `src/ui/components/build-editor/index.js` — `history: createHistory()` on the
  per-mount `api` (fresh per build); `commit()` records the replaced state (skips
  no-op same-reference commits); `undo()`/`redo()` restore a snapshot bypassing
  `record` (the stack stashes the current state for the opposite move) and fire
  `onChange` so autosave follows; a window `keydown` handler (bound once, like the
  resize listener) for Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z / Ctrl+Y.
- `src/ui/components/build-editor/bind.js` — `data-act="undo"/"redo"` click wiring.
- `src/ui/components/build-editor/strips.js` — `↶`/`↷` buttons at the TOP strip's
  leading edge, `disabled` bound to `canUndo`/`canRedo` (repaint keeps them live).
- `styles/build-v2.css` — `.bv2-hud__tools` / `.bv2-hud__btn`.

**[Logic Altered]** No coalescing needed: all sliders commit on `change` (release),
not `input`, so a drag is already ONE undo step. The keyboard handler no-ops off the
build routes (`#edit2`/`#new`) and while a text field is focused (leaving native text
undo intact). Undo restores the build DOCUMENT only — ephemeral UI (selected echo
slot, expanded panels) is intentionally not tracked. History resets per mount.

**[Verification Method]** `eslint .` 0 errors; sweep 63/0; `npm test` 56/56 (incl.
history 24/24). Live Playwright (Carlotta): apply-suggested → Remove All → button
Undo restored 5 echoes / Redo re-removed them / Ctrl+Z + Ctrl+Shift+Z did the same,
with the undo/redo `disabled` states flipping correctly at each step.

**[Residual Risks]** none for the build editor. Scope: build editor only — the team
editor has the same `onChangeTeam` chokepoint and can adopt `createHistory`, but it
has no HUD strip, so its button placement is an open UI decision (not done here).

**[Updated Docs]** This summary.

### Follow-up same day — team editor undo/redo

Mirrored onto the Teams page (`#party`) using the same `createHistory` module,
buttons in the shared header left of the theme toggle (maintainer's placement).

- **Chokepoint introduced.** The team editor had NO single commit — three edits
  (`setTeamSlot` assign, `setTeamSlot(null)` remove, `swapTeamSlots` reorder) each
  did `api.team = …; onChangeTeam; paint()` inline. Funnelled them through a new
  `commitTeam(next)` (records the replaced team, applies, autosaves, repaints);
  added `undoTeam()`/`redoTeam()` + a `#party`-scoped `keydown` handler. Team
  mutators are immutable (`touch({ ...team, slots:[...] })`), so snapshots are safe.
  Save/promote/name flows keep assigning `api.team` directly — they aren't content
  edits and stay out of history. (Member WEAPON edits change a build, not the team,
  so they belong to the build editor's history — a documented boundary.)
- **Header controls.** `renderV2Header` gained an optional `history:{canUndo,canRedo}`
  param → renders `data-act="v2-undo"/"v2-redo"` SVG buttons before the theme toggle
  (reusing `.bv2-iconbtn`, now with a `:disabled` style). Only the Teams page passes
  it. The `v2-` prefix is deliberate: the build editor already binds `undo`/`redo`
  on the shared `#main` root, so distinct names stop the two pages cross-firing.

**[Files Changed]** `src/ui/components/team-editor-v2.js` (commitTeam/undo/redo/key
handler; three sites routed through commitTeam; history on mount; header history
prop; button wiring), `src/ui/components/v2-header.js` (undo/redo icons + optional
history controls), `styles/build-v2.css` (`.bv2-iconbtn:disabled`),
`tests/team-editor-v2.test.mjs` (window stub gained `addEventListener`, which the
now-registered keydown listener needs).

**[Verification]** `eslint .` 0 errors; sweep 63/0; `npm test` 56/56 (team-editor
109/0). Live Playwright (#party): add member → header Undo removed it / Redo re-added
/ Ctrl+Z + Ctrl+Shift+Z did the same, `disabled` states flipping correctly, and the
buttons render cleanly left of the theme toggle. No cross-fire with the build editor.

**[Updated Docs]** This summary.

## Buff bar — drop the generic buff glyph (2026-07-23)

The generic buff icon (`gen-buff-icon`) rendered on every non-defensive buff strip
(ATK/crit/DMG-bonus/element/energy) was maintainer-flagged as visual noise — the
strip's colour + name already identify those buffs. Removed it; kept the
`defensive-buff-icon` heal/shield glyph, which still marks a distinct category.

**[Files Changed]**
- `src/ui/components/buff-bar.js` — `iconSlugFor` now returns the defensive slug
  or `null` (was the generic slug); `renderBuffStrip` renders the glyph only when
  a slug is present. Module/inline comments updated.
- `src/ui/icons.js` — dropped `gen-buff-icon` from the `misc` slug set.
- `tests/buff-bar.test.mjs` — the three generic-glyph assertions now expect `null`.
- `assets/icons/misc/gen-buff-icon.png` — deleted (now unused; `icons.test.mjs`
  only asserts registered slugs have assets, so a removed slug + file is clean —
  and `buff-simple.png` was already an unregistered orphan).

**[Verification Method]** `npm test` 56/56 (buff-bar 23/0, icons 70/0); sweep 63/0;
`eslint .` 0 errors. Direct `renderBuffStrip` render check: `+10% ATK` and
`+25% Glacio DMG` emit no icon markup (name + colour only); `Healing Bonus +20%`
still emits the defensive glyph.

**[Residual Risks]** none. Defensive buffs keep their glyph by design — trivially
removable too if wanted.

**[Updated Docs]** This summary.

## Sonata quick-switch — transient set-bonus preview (editor + team page) (2026-07-23)

A non-persistent "what-if" for echo set bonuses: click a sonata icon, pick a
different set, and every damage/stat readout re-sims as if the equipped pieces
belonged to that set — WITHOUT editing or saving the build. Answers "would set X
beat my current set?" in one click. Model (user-confirmed): SWAP the clicked set
(relabel), so combos compose by swapping each active set; keyed by the ORIGINAL
set id so re-swaps/reset stay stable, and echo species identity is preserved so
the distinct-echo 2pc/5pc rule still holds on the preview.

**[Files Changed]**
- NEW `src/core/sonata-override.js` — pure `applySonataOverride(build, override)`
  (relabels echo `sonataId` per an origId→newId map; returns the SAME ref when
  nothing changes) + `normalizeSonataOverride` (drops identity/empty → null). NO
  engine change: the existing sonataCounts derivations (`stats.js`,
  `buff-windows.js`) read `echo.sonataId`, so a relabeled build credits the
  swapped set for free. Not an ENGINE_FILE (the offline sim/optimizer never
  imports it — it's a UI-time transform).
- NEW `tests/sonata-override.test.mjs` — pure behaviour + a LIVE end-to-end check
  (swapping a Glacio 2pc set to a Fusion set moves the credited element bonus in
  `resolveTotalStats`).
- NEW `src/ui/components/sonata-quickswitch.js` — shared body-appended floating
  set-picker (all sets, current highlighted, optional "↺ Reset to equipped"),
  used by BOTH pages; preview-only via onPick/onReset callbacks.
- Build editor: `shared.js` adds memoized `simBuild()` (persisted build + preview,
  stable identity); `index.js` holds `api.sonataOverride` (transient — NOT in undo
  or autosave), adds `setSonataOverride()`, resets it on build swap, closes the
  menu on paint; `echoes.js` header chips now render the EFFECTIVE sets, are
  clickable (`data-eff`/`data-orig`), and mark the preview (accent ring + ⚡ PREVIEW
  + RESET); `bind.js` wires the chip + reset; the five editor sim/stat reads
  (`strips.js`, `stats-panel.js`, `ability-overview.js`, `stat-priority.js`
  liveAnalysis, `rotation.js`) now read `simBuild()` so the WHOLE page previews.
- Team page: `team-editor-v2.js` holds `api.sonataOverrides` keyed by `build.id`
  (persistent on the page, per resonator, never saved); `previewResolveBuild`
  wraps the sim's build resolver; the member sonata badge is now a clickable
  quick-switch showing the effective set (accent ring when previewing).

**[Logic Altered]** Persisted builds/teams are never touched — the preview is a
sim-time relabel only. Editor preview is session-scoped (cleared on build swap);
team preview persists while on the page, one entry per member. `normalizeBuild`
already whitelists the saved shape, so even a leaked override field is stripped —
but the override is held in page state, never on the build, by construction.

**[Verification Method]** `npm test` 57/57 (new sonata-override 21/0); sweep 65/0;
`eslint .` 0 errors. Node render checks against real `wuwa-data.json`: a 5pc swap
shows the new set + ⚡ PREVIEW + RESET, chip keyed by original set (`data-orig`) /
showing effective (`data-eff`), `simBuild().echoes` relabeled while the persisted
build stays untouched; a hybrid 4+1 loadout swaps only the dominant set; and
`simBuild()` memoization returns a stable ref (=== persisted build when no
preview).

**[Residual Risks]** The team member badge only exposes the DOMINANT set, so a
2pc+2pc member can preview-swap just that set (the editor exposes every active
set) — documented scope, not a bug. A "make all 5pc X" shortcut and free-form
combo building were considered and deferred (user chose the swap model).

**[Updated Docs]** This summary.

## Dataset refresh — nanoka + WutheringData 3.4.3 → 3.5 (2026-07-23)

Datasets were stale by two game versions. Re-extracted from both sources and
regenerated every downstream artifact. This is a deliberate content bump, so
LOCK A/B do NOT apply — the large wuwa-data.json / wuwa-meta.json diffs are
expected. No engine files changed.

**[Content Added]** Resonators 53 → 57 (Suisui / Glacio, Rover: Electro ×2,
Yangyang: Xuanling / Havoc) + 6 units promoted partial → FULL nanoka stats
(Hiyuki, Lucilla, Denia, Rebecca, Sigrika, Lucy). Echoes 163 → 180, sonatas
32 → 34, weapons 89 usable / 128 indexed. Schema still v9 (no schema break).
Forte overlay re-extracted (25 resonators, 295 skills); all 4 new resonators
got Forte data from the committed BinData dump — no gap.

**[Files Changed]**
- `tools/fetch-nanoka-chars.mjs` — `--all` read `item.json.characters`, which
  nanoka no longer serves as a typed list (item.json is a flat id→item map), so
  `--all` fetched nothing. Now iterates the `character.json` index, matching the
  echo/weapon fetch scripts. Root-cause fix so future full refreshes work.
- `data/extracted-nanoka/` — manifest + 4 typed index maps refreshed from
  `/ww/3.5/`; 23 new + 74 refreshed per-id detail files (chars/echoes/weapons).
- Regenerated: `data/wuwa-data.json`, `data/wuwa-meta.json`, `data/hit-map.json`,
  `data/forte-data.json`, `data/data-version.json`.
- `tests/energy-per-hit.test.mjs` — Rebecca dodge-counter energy re-pinned
  1.52 → 3.13 (she gained full stats; same algorithm, richer data).
- `tests/icons.test.mjs` — sonata-icon-gap check rewritten from an exact count
  (`=== 1`) to a named allowlist, so it flags UNEXPECTED gaps / future new sets
  instead of failing on every content bump.

**[Pipeline]** refresh index maps + `fetch-nanoka-{chars,echoes,weapons} --all`
→ `npm run data` (pass 1, live WutheringData pull, writes hit-map) →
`node tools/extract-forte.mjs` → `npm run data` (pass 2, bakes Forte) →
`npm run meta`.

**[Verification]** `npm test` 57/57 (2 data-pinned tests re-pinned to the new,
legitimately-shifted values — only Rebecca moved in the energy suite), sweep
65/0, eslint 0 errors. Spot-checked new units (real skill maps + 6 chain nodes,
correct elements) and existing units (Sanhua/Jinhsi/Carlotta stable); the
meta-validation report shows only its routine advisory sections, no
NaN/missing/errors.

**[Residual Risks / Follow-ups]** (1) Sonata ICONS for the 3 new sets (Song of
Feathered Trace, Heart of Evil's Purge, Lamp of Nether Road) are not committed
yet — they render the letter-glyph fallback (sonata icons are local-only assets;
resonators/weapons/echoes bake a nanoka CDN URL and render fine). (2) Curated
inputs (reference-rotations.json, effect-overrides.json, flat-only Forte grants)
are not authored for the 4 new resonators — they sim on auto-derived data until
curated. Neither blocks the sim.

**[Updated Docs]** This summary.

## Data source — migrate WutheringData Dimbreath → Arikatsu, Hiyuki energy-gated (2026-07-23)

The preprocess pipeline's live-fetched game tables were still pulling from
`Dimbreath/WutheringData`, stale by ≥2 game versions. Migrated the source to
`Arikatsu/WutheringWaves_Data` (current, 3.5). The swap surfaced a DEF field
rename and corrected a long-standing misread of Hiyuki's Liberation as "not
energy-gated" — which had only been true because Dimbreath shipped no `baseStats`
row for her (a data GAP, not a mechanical fact).

**[Files Changed]**
- `tools/preprocess/download.mjs` — `BASE`/`REPO` point at Arikatsu; `resolveRef()`
  auto-resolves the repo default branch (tracks the live game version, currently
  `3.5`) with a hardcoded `FALLBACK_REF` backstop; `LANG_DIR` maps langs to
  Arikatsu's `Textmaps/{lang}` dirs; `flattenTextMap()` adapts Arikatsu's
  list-shaped `MultiText.json` (`[{Id,Content,RedirectDbIndex}]`) to the flat
  `{Id:text}` map the projections expect. All 16 tables remapped to `BinData/…`
  paths. nanoka half untouched.
- `tools/preprocess/base-stats.mjs` — base DEF now `property.Def ?? property.Def_`.
  Dimbreath's ConfigDB renamed base DEF to `Def_`; Arikatsu BinData uses raw
  `Def`. Reading only `Def_` silently zeroed DEF for every resonator (Taoqi, a
  DEF-scaler, went 1802 → 0 damage). It was the ONLY underscore-renamed field any
  projection reads.
- `src/core/liberation-gate.js` — **DELETED** (was added earlier this session).
  It curated Hiyuki/Lucilla into a `SPECIAL_RESOURCE_LIBERATIONS` set that
  force-nulled their liberation cost. Per maintainer direction ("the extracted
  data doesn't lie — populate `energyMax` if the data says so"; Hiyuki genuinely
  wants ~110–120% ER), the model reads `liberationCost` straight from
  `baseStats.energyMax` again. All 5 call sites reverted to the inline read;
  `liberation-gate.js` removed from both ENGINE_FILES lists.
- `tools/optimize/breakpoints.js` — header comment: `libCostKnown` documented as
  data-authoritative (a real energy bar is energy-gated even if the kit also
  layers special-resource steps; `false` = genuine data gap only).
- `src/ui/components/energy-chart.js` — comment: dropped the now-false "e.g.
  Hiyuki" as the non-energy-gated example.
- Tests: `optimize-breakpoints`, `optimize-weights`, `stat-ranking`, `team-er`,
  `team-rank`, `build-editor-v2` — six files hard-coded "Hiyuki not energy-gated"
  (the pre-Arikatsu gap). Flipped each to the data-authoritative truth
  (`libCostKnown:true`, `liberationCost:125`) and preserved coverage of the
  genuine `libCostKnown:false` PATH via synthetic non-gated entries (no shipped
  kit hits it post-Arikatsu).
- Regenerated: `data/wuwa-data.json`, `data/wuwa-meta.json`, `data/hit-map.json`,
  `data/forte-data.json`, `data/data-version.json`.

**[Logic Altered]** DEF base stat now resolves from Arikatsu's `Def`. Hiyuki:
`libCostKnown:true`, `liberationCost:125`; her curated team's `erOverride[1108]`
is now a REAL computed value (~102.6% floor, non-provisional) instead of the
gating-forced provisional fallback. No other resonator's stats moved.

**[Pipeline]** `npm run data` (pass 1, live Arikatsu pull, writes hit-map) →
`node tools/extract-forte.mjs` → `npm run data` (pass 2, bakes Forte) →
`npm run meta`.

**[Verification Method]** `npm test` 57/57 (six data-authoritative test flips),
sweep 65 imported / 0 failed, eslint 0 errors. All 56 resonators confirmed
stat-neutral (ATK/HP/DEF/CR/CD/ER identical prev↔now); Taoqi DEF restored to
1802; Hiyuki sims to real damage; meta `engineHash` staleness guard passes. The
huge `wuwa-data.json` diff is benign: ~47/56 resonators byte-identical, the rest
ex-nanoka-fallback chars normalized to the lean shared-table shape. Migration
also collapsed a duplicate `Rover: Electro` (57 → 56, correct — Arikatsu carries
both M/F variants, primary dedup handles it).

**[Residual Risks]** (1) Hiyuki's ~102.6% ER floor under-counts her in-state
(Frostheart/Dedication) income; it will rise toward the maintainer's ~110–120%
once kit-accurate multi-gauge energy INCOME attribution lands (the same
multi-gauge modeling future work in CLAUDE.md — refines how fast the bar fills,
not whether it exists). (2) Lucilla's `energyMax` is 0 → `libCostKnown:true` with
cost 0 (a data quirk), but she is not in the covered set so it does not surface
in the meta.

**[Updated Docs]** `README.md` + `docs/ARCHITECTURE.md` — WutheringData
references now name Arikatsu. `docs/energy-signal-findings.md` — dated
**Correction (2026-07-23)** appended (Hiyuki/Lucilla ARE energy-gated; the
missing `baseStats` was a Dimbreath gap), with inline supersede markers at the
two 2026-07-02 claims (history preserved, not deleted). This summary.

## Timing model — Liberation freeze + parallel echoes (2026-07-24)

Pivoted the timing model from the abandoned "measure real cast times"
(Maygi import / frame-counting) path — not feasible without capture access —
to a **mechanical rule-based** model driven by maintainer-confirmed mechanics.
Increment 1 of two. First: compiled a full backlog audit into
`docs/OPEN-ITEMS.md`; then implemented the two confirmable, no-fabricated-number
timing structural facts.

**[Files Changed]**
- `src/core/sim.js` — `resolveFreezeTime(skillDef, dataset, castTime)` gains a
  fraction path; new `HARDCODED_FREEZE_FRACTIONS = { liberation: 1 }` (single
  source of truth — the Node consumers load `wuwa-data.json`, which has no
  injected `skillMap`, so it can't live in `skill-map.json` alone; a dataset may
  still override via `_defaults.freezeFractionBySkillType`). `computeStepTimes`
  now takes `timingMode`, resolves per-step freeze, emits `gameStart`/`gameEnd`
  arrays, and gives echo steps **0** time. Main walk: effect-window ctx
  `startTime` and the recorded trigger `endT` read `gameStart`/`gameEnd` (effect
  `seconds` windows decay against gameTime); the echo step's `castTime = 0`;
  `deriveGameTimes` moved **before** `computeBuffWindows` so sonata stack
  timelines see gameTime; the freeze comment block corrected (buffs DO pause).
- `src/core/buffs/buff-timeline.js` — `stackTimeline` samples the per-step stack
  COUNT in gameTime (`gameEndTime`/`gameStartTime`, realTime fallback) so stacks
  survive a Liberation freeze; window display/propagation bounds stay realTime
  (team-sim overlaps buffs in real segment time) — a no-op for freeze-free
  rotations.
- `src/core/rotation-state.js` — state `seconds`-expiry prefers
  `stepTimes.gameStart`/`gameEnd` (realTime fallback), so timed stances freeze
  during a Liberation.
- `src/core/buffs/buff-windows.js` — **no change** (verified): `windowStacksAtStep`'s
  non-timeline branch also serves realTime external team-buff windows; the
  freeze-awareness lives entirely in the gameTime `stacksByStepIndex` path.
- `tests/timing-model.test.mjs` — rewritten from the old structural-no-op proof:
  freeze-fraction unit cases, a `stackTimeline` freeze-preservation test with a
  no-freeze control, end-to-end Liberation-freeze assertions (freeze = castTime,
  gameEnd = gameStart, DPS from gameTime, non-Liberation steps unchanged), and a
  parallel-echo test (zero added time, damage still added). 56/56.
- `docs/TIMING_MODEL.md` — the "buffs tick against realTime always" line
  corrected to a dated note; new **Confirmed mechanics (2026-07-23)** section;
  Sourcing section reframed (measured data not obtainable → estimates + rules).
- `docs/OPEN-ITEMS.md` — **new** backlog snapshot; item 1 updated to record this
  increment and what stays deferred.
- Regenerated `data/wuwa-meta.json` (+ `data/data-version.json` meta hash).

**[Logic Altered]** Two clocks now genuinely diverge across a Resonance
Liberation: its whole animation is a freeze window (`freezeTime = castTime`), so
`gameTime` (cooldowns + buff/effect/state decay + DPS denominator) pauses while
`realTime` advances. Non-transformation echoes contribute damage + energy at
zero timeline cost. Concretely (Sanhua, `skill/basic_1/basic_2/liberation`):
realTime 4.20s → gameTime 2.40s, ToA DPS 952 vs open-world 544 (+75%); adding a
Dreamless echo step keeps time 1.10s while damage 322 → 532. Every rotation
WITHOUT a Liberation is byte-identical (freeze = 0 → gameTime === realTime).

**[Verification Method]** `npm test` 57/57 (the sole failure before regen was
the expected meta `engineHash` staleness guard — cleared by `npm run meta`);
`npm run sweep` 65 imported / 0 failed; `npm run lint` 0 errors. LOCK A
(`wuwa-data.json`) unchanged. LOCK B (`wuwa-meta.json`) intentionally shifted
roster-wide (freeze denominators + parallel echo DPS move rankings). Behavior
demonstrated with concrete before/after numbers above.

**[Residual Risks]** (1) A buff's realTime display/propagation *bounds* still
end at their realTime projection while the stack COUNT is freeze-aware — a
buff's coverage can extend a hair past its drawn strip across a Liberation
(display-only, sub-2s). (2) Freeze is honored in `'toa'` mode only (the default,
matching community DPS convention); whether cooldowns/buffs also pause during a
Liberation in `'open'` (open-world) mode is left as a follow-up, not forked now.
(3) Non-Liberation freezes (Tune Break) remain unmodeled — Tune Break is not
wired into the live sim anyway.

**[Deferred]** Transformation-echo / hold-skill lock windows (need a
transformation-vs-parallel echo classification flag), switch-cancel + outro
timing, and any "collapse instants toward zero realTime" rescale (no measured
base). See `docs/TIMING_MODEL.md` and `docs/OPEN-ITEMS.md` item 1.

**[Updated Docs]** `docs/TIMING_MODEL.md`, `docs/OPEN-ITEMS.md` (new), this
summary.

### Follow-up same day — cinematic-cast gate (multi-step + non-energy Liberations)

Maintainer catch: the blanket "every `liberation`-type step freezes" rule broke
**multi-step** Liberations. Carlotta's `liberation`/`liberation_death_knell`/
`liberation_fatal_finale` all carry `skillType: 'liberation'`, so a realistic
enhanced-state sequence froze **5/5 steps → gameTime 0.00s → DPS 0**. Only the
opening cinematic (Era of New Wave) should freeze; the Death Knells do not.

**Fix — cinematic gate in `resolveFreezeTime`** (now
`resolveFreezeTime(skillDef, dataset, castTime, liberationCost)`): a Liberation
freezes only when `consumesResource !== false` AND `liberationCost > 0` (the
caster's `energyMax`). `liberationCost` is threaded through `computeStepTimes`
and the main walk (both already had it). Rationale from the data:
- **Energy ultimates** (Carlotta, Augusta): opener is `consumesResource`
  undefined + carries a Resonance Cost → freezes; continuations are stamped
  `consumesResource: false` → don't. (Reuses the exact signal the energy model's
  `isCostConsuming` already uses — DRY.)
- **Non-energy ultimates** (Lucilla, Phrolova — `energyMax 0`): NONE of their
  liberation-tagged steps is stamped `consumesResource: false` (they're enhanced
  on-field attacks, all `undefined`), so a bare `consumesResource` gate would
  freeze them ALL. The `liberationCost > 0` guard is what stops that — they
  freeze nothing (conservative).

**[Verification]** Carlotta's 5-step sequence: 1 step frozen (the cinematic
cast), gameTime 0.00 → 7.20s, DPS 0 → 679. New tests: `resolveFreezeTime` gate
cases (continuation / energyMax 0 / null cost) + end-to-end Carlotta (exactly
one frozen step) and Phrolova (zero frozen steps) in `timing-model.test.mjs`
(66/66). Full suite 57/57, sweep 65/0, lint 0 errors, LOCK A clean, meta
regenerated (LOCK B — multi-step-liberation DPS moved again).

**[Residual]** A genuine cinematic *finale* (Carlotta's Fatal Finale) or a
non-energy character's real cinematic cast is conservatively under-frozen — no
data flag marks "cinematic", and under-freezing never inflates DPS. A curated
key list can add such casts later if wanted.

### Follow-up same day — buff-strip alignment across a freeze (increment 2 start)

The increment-1 residual (a stacking buff's strip drawn short across a
Liberation while its damage was still credited on later steps) is fixed.
`stackTimeline`'s window `end` now maps the last stack's gameTime expiry back to
realTime (`gameExpiry + freezeOffset`, where `freezeOffset` is the freeze accrued
by that gameTime) instead of the naive `realGain + duration`. So a buff whose
life spans a Liberation is drawn — and propagated to teammates (the team-wide
buff tail reads the same `window.end`) — across the frozen animation. No-op when
no freeze occurs (offset 0 → `end === realGain + duration`).

**[Files]** `src/core/buffs/buff-timeline.js` (`stackTimeline` end). Tests:
`timing-model.test.mjs` alignment case (buff active on post-Liberation steps
whose naive end would cut them off) — 69/69. **[Verification]** full suite 57/57,
sweep 65/0, lint 0 errors, LOCK A clean, meta regenerated. Team-sim tests all
still pass (the tail extension is a correctness improvement: a team-wide buff
frozen during a Liberation now lasts the right amount for the next member).

**Deferred to a curated list (maintainer, 2026-07-24):** the "is-cinematic"
finale flag stays parked — maintainer is still hopeful about sourcing real
animation/timing data elsewhere, which would supersede curation.

### Follow-up same day — echo classification (Transform locks, Summon parallel) + Tune Break freeze noted

Maintainer's in-game spot checks supplied the clean classifier we'd earlier
concluded was missing: an echo's active-skill **desc prefix**. A **"Transform"**
echo (you become/control it) LOCKS the resonator → its `__echo__` step occupies
`ECHO_CAST_TIME`; **"Summon"** (a helper fighting alongside) and direct-attack
echoes cast in **parallel** → zero time. So increment-1's blanket "all echoes
parallel" (fact 3) is now correctly split: only Transform locks. `resolveEchoStepTime`
(`ECHO_TRANSFORM_DESC = /^\s*transform/i`) computes it once, threaded through
`computeStepTimes` + the walk (replacing the hardcoded `0`). ~65 Transform / ~115
parallel roster-wide. Confirmed: a Fallacy of No Return (Summon) echo step adds
+0.00s/+817 dmg; a Dreamless (Transform) step adds +1.20s/+210 dmg.

Also recorded (maintainer, in-game): a **manual Tune Break activation freezes the
in-game clock** like a Liberation. Tune Break is not a sim step yet (unmodelled
off-tune gauge), so nothing to apply today — documented in `TIMING_MODEL.md` so it
gets the whole-animation freeze when a manual Tune-Break step is wired.

**[Files Changed]** `src/core/sim.js` (`resolveEchoStepTime` + `ECHO_TRANSFORM_DESC`;
`computeStepTimes`/walk echo-step time), `tests/timing-model.test.mjs` (Summon-
parallel vs Transform-lock cases; the old parallel test used Dreamless, which now
locks — repointed to Fallacy of No Return), `docs/TIMING_MODEL.md` (fact 3 rewrite
+ Tune Break freeze + fact-4 classification SOLVED note).

**[Logic Altered]** Transformation echoes now occupy `ECHO_CAST_TIME` (lock);
all other echoes stay parallel (zero time). Freeze unaffected (echoes never
freeze — Transform locks but the game clock runs). **[Verification]** 73/73
timing-model, full suite 57/57, sweep 65/0, lint 0 errors, LOCK A clean, meta
regenerated (LOCK B — Transform-echo builds now cost the lock time).

**[Residual]** `ECHO_CAST_TIME` (1.2s) under-counts a real transform sequence
(longer, multi-hit) — conservative, pending real animation data. Hold-button
skills (fact 4's other half) still have no classifier. `opener.js` still treats
all echoes as `ECHO_CAST_TIME` (sim↔opener echo-timing mismatch) — a follow-up.

### Timing model — real animation-data extraction lands roster-wide (2026-07-28)

The "maintainer still hopeful about sourcing real animation/timing data
elsewhere" note above paid off: the maintainer supplied a working extraction
pipeline (`tools/extract/`, guided by `tools/extract/TIMING-EXTRACTION-HANDOVER.md`)
that parses `AnimMontage`/`DT_SkillInfo` directly from an FModel-exported raw
asset tree — no `.usmap` needed (classic tagged UE4 serialization is
self-describing). Reads the montage's own **cancel/actionable notify**
(`TsAnimNotifyStateNextAtt` → `actionable_at_s`), never `SequenceLength` (which
includes idle-return padding and was the reason `docs/TIMING_MODEL.md`
previously ruled out asset extraction entirely — that section is now struck
through and superseded). Byte-exact validated against a maintainer-supplied
reference character (Rebecca/1308) fixture before trusting the roster run.

Ran it against a user-provided full-roster export (`docs-local/Role`, gitignored,
35,805 assets, 72 `DT_SkillInfo` tables). Found and fixed two silent bugs in the
pipeline itself while landing this: `resolve_game_path`'s suffix match assumed
the export root sits at/above `Aki/`, but this export starts one level deeper
(`Role/`), so the primary match never fired and everything fell back to an
ambiguous basename-only match that fails on generic montage names shared across
characters (`AM_Skill02`, `AM_Burst01`) — rewrote it to walk trailing path
segments from most to least specific instead of assuming a fixed root depth
(montages parsed: 489 → 1,344 on the same export). The "unreferenced montages"
report also had a `str.lstrip('/game/')` bug (character-class strip, not a
prefix strip) — cosmetic-only, fixed alongside.

**The join** (`tools/extract/map-timings.mjs` → `data/cast-times.json`) avoids
inferring which `DT_SkillInfo` row is "the skill entry" from `SkillGenre`
ordinals or kit text — it reuses `data/hit-map.json`, which `preprocess.mjs`
already populates with the game's own per-hit BinData damage ids per
`autoSkillMap` key (same id space `DT_SkillInfo` rows use, verified identical
roster-wide by the earlier Forte-extraction work). Longest exact-prefix match
of a hit id against that resonator's known row ids recovers the row; no match
is left unresolved rather than guessed. Result: **802/1,061 autoSkillMap keys
(75.6%) now have a real extracted `castTime`**, and Liberation entries carry a
real measured `freezeTime` where available (superseding the flat
`HARDCODED_FREEZE_FRACTIONS` estimate for those entries once wired).

A `SkillGenre` ordinal → category table fell out as a byproduct while
cross-checking the join (not needed for the join itself): basic=0,
charged/heavy=1, skill=2, liberation=3, intro("QTE")=4, dodge-counter=5,
dodge=6, air-dodge=11, outro("延奏技能")=13, **Tune Break("[weapon]破弱")=14** —
the last one is the first real per-character Tune Break timing data seen,
relevant to Open Items #7 whenever Tune Break becomes a modeled sim step.

**Known gaps, left unresolved rather than guessed:** Chixia (1202) has no
folder at all in this export (needs a re-export); Xuanling's (1610)
`DT_SkillInfo` table fails the exact-landing parse (a genuine tagged-property-
walker gap on that one table); Rover-element dataset ids don't 1:1 match the
raw client's internal id space (1501 "Rover: Spectro" joins against raw id
1502, not 1501 — needs a dedicated remap table); a few multi-stance/
transformation kits (e.g. Aemeath's Mech form) have their alternate-form
moveset under a row-id block the simple join doesn't reach.

**[Files Changed]** `tools/extract/extract_timings.py` (`resolve_game_path`
rewrite, unreferenced-montage normalization fix — both root-cause fixes, not
new features), `tools/extract/map-timings.mjs` (new — the hit-map join),
`data/timing-data.json` (new — raw extraction output), `data/cast-times.json`
(new — curated, provenance-tagged, ready-to-wire artifact), `docs/timing-extraction-report.md`
(new, generated), `docs/TIMING_MODEL.md` (struck the "don't extract" section,
new Extraction Results section, `source` enum gains `"extracted"`),
`docs/OPEN-ITEMS.md` (item 1 status).

**[Logic Altered]** None in `src/` — extraction and mapping only. `preprocess.mjs`
does not yet read `data/cast-times.json`; `sim.js`'s `resolveCastTime`/
`resolveFreezeTime` are unchanged. `data/wuwa-data.json` is byte-for-byte
untouched (LOCK A trivially holds — nothing in the compiled pipeline changed).

**[Verification]** Rebecca fixture re-validated exactly after the path-resolution
fix (all 4 rows: hits, `actionable_at_s`, `skill_end_s`, 3.0s Liberation freeze).
Full suite 57/57, sweep 65/0, lint 0 errors (fixed 4 new `id-length` errors in
`map-timings.mjs` itself before landing). LOCK A/B both a no-op (no engine files
touched).

**[Residual Risks]** `data/cast-times.json` is not yet consumed anywhere — wiring
it into `preprocess.mjs`/`sim.js` (so `resolveCastTime`/`resolveFreezeTime` pick
up measured values) is an explicit follow-up, not bundled here, since it will
shift `data/wuwa-data.json` roster-wide and deserves its own review pass. The
24.4% unresolved `autoSkillMap` keys keep their existing fabricated-default
`castTime` — no regression, just no improvement yet. `docs-local/Role` (the raw
asset export) is gitignored and never committed, consistent with
`docs/LANE-B-ASSET-EXTRACTION.md` §9 (derived numbers stay in-repo, assets do
not).

### Follow-up same day — three gap root-causes fixed, cancel-window data added (2026-07-28)

Before wiring, the maintainer asked to investigate the coverage gaps rather than
accept them. All three turned out to be tooling bugs, not roster gaps:

- **Xuanling's parse failure.** Manually replaying her `DT_SkillInfo` row walk
  showed every property on every row decoding to a legible, sensible field name
  with zero errors — the row content was never wrong. Her export's declared
  `serial_size` under-reports by exactly 112 bytes (a `ue_header.py` export-
  table quirk on that one asset); every other asset checked lands its walk
  exactly 4 bytes before the `.uexp` buffer's true end, so `parse_datatable`
  now falls back to that cross-validated target when the declared size doesn't
  land exactly, instead of only ever trusting the header field.
- **Rover's dataset-id mismatch.** Confirmed via montage path: the raw client
  keeps a separate resonator-id block per gender (raw 1501 = male "Nanzhu", raw
  1502 = female "Nvzhu"); the dataset's single merged "1501 Rover: Spectro" is
  backed by the female content, which `hit-map.json` already correctly encoded
  (its `1501` hit ids are prefixed `1502...`). The join script was assuming the
  outer dataset id always equals the raw table's own id — fixed to derive the
  raw id from each hit id's own leading 4 digits instead, which resolved Rover
  automatically with no hardcoded remap table.
- **Aemeath's Mech-form gap.** Her alternate combat moveset lives in a separate
  table, `DT_SkillInfo_GD.uasset`, which the indexer only recognized by the
  exact filename `DT_SkillInfo.uasset`. Added `_GD` to an explicit allowlist
  (`COMBAT_FORM_TABLE_NAMES`) rather than wildcard-matching `DT_SkillInfo_*` —
  a full-roster export carries ~70 same-shaped tables for non-combat modes
  (Rogue mode, cutscenes, photo minigames, one-off events) whose rows can reuse
  the same id space with different numbers; blindly merging those risks
  silently overwriting real combat timing with mode-specific data.

Chixia (1202) remains a genuine gap — confirmed via a full-tree search (not
just `Role/`) that her folder simply isn't in the export; needs a re-export,
nothing to fix in the tooling. A few other stance-switch kits (Denia/1211,
Lumi/1504, Buling/1307, Lucy/1511) show the same "alternate form resolves
nowhere" symptom and likely hide their own differently-named table — not
individually confirmed yet, left as a mechanical follow-up sweep.

Also added, per maintainer request: `cancelWindowOpensAt`/`cancelWindowDuration`
(the `TsAnimNotifyStateNextAtt` input-buffer window — distinct from `castTime`,
not yet consumed by anything, kept because it's real measured data) and
`hitTimes` (raw per-hit instants) to every `data/cast-times.json` entry.
Recorded why `sequenceLength` is never a duration in `TIMING_MODEL.md`: WuWa's
polish means an uncancelled action settles back through an idle-return tail
(`TsAnimNotifyFightStand`) instead of cutting off, so `sequenceLength` measures
the whole authored clip including that tail — a real thing, not a measurement
artifact, which is why it's kept only for provenance.

**Result: coverage 75.6% → 80.3%** (802 → 852 of 1,061 autoSkillMap keys).

**[Files Changed]** `tools/extract/ue_tagged.py` (`parse_datatable` footer-
fallback target), `tools/extract/extract_timings.py` (removed the now-redundant
outer exact-landing re-check; `COMBAT_FORM_TABLE_NAMES` allowlist),
`tools/extract/map-timings.mjs` (raw-resonator-id-from-hit-id join;
`cancelWindowOpensAt`/`cancelWindowDuration`/`hitTimes`/`skillEnd` fields;
`sourceResonatorId` breadcrumb when it differs from the dataset rid),
`data/timing-data.json`, `data/cast-times.json` (regenerated), `docs/TIMING_MODEL.md`
(Extraction results rewritten with confirmed root causes + the `sequenceLength`
explanation), `docs/OPEN-ITEMS.md` (item 1 numbers).

**[Logic Altered]** Still extraction/mapping tooling only — no `src/` changes,
`data/wuwa-data.json` still untouched, `data/cast-times.json` still not
consumed anywhere.

**[Verification]** Full suite 57/57, sweep unaffected (no `src/` touched), lint
clean on the changed files. Spot-checked the three fixes directly: Xuanling
29/31 rows now have timing; Rover's `1501.basic_1` now resolves with
`sourceResonatorId: "1502"`; Aemeath's `skill_mech_1` resolves to raw row
`12102001` ("机甲普攻1" — mech basic attack 1, confirming the right table).

**[Residual Risks]** Same as above — extraction/mapping only, engine wiring
still a separate follow-up. The 4 remaining low-coverage stance-switch kits are
suspected-not-confirmed instances of the same "differently-named alternate-form
table" pattern; each needs the same kind of manual folder check Aemeath got
before extending `COMBAT_FORM_TABLE_NAMES` further — don't wildcard-guess it,
per the same reasoning that ruled out `DT_SkillInfo_*` roster-wide.

### Follow-up same day — `castTime` renamed to `actionableAt` roster-wide (2026-07-28)

Maintainer pushback on the naming, alongside the gap-investigation request: WuWa
abilities activate on button press, not a spell-cast delay, so "cast time"
implied the wrong mechanic. The field was also never hit-registration time —
a hit can land before *or* after it (Rebecca's basic hits at 0.13s/0.37s,
the field itself reads 0.44s) — it's specifically when the player regains
control, mirroring the raw extraction's own `actionable_at_s`. Asked the
maintainer to pick between `lockDuration`/`actionableAt`/`recoveryTime`/keep
as-is; chose `actionableAt`.

Renamed everywhere the identifier appears, verified with a repo-wide grep
before and after: `src/core/sim.js` (`HARDCODED_CAST_TIMES` →
`HARDCODED_ACTIONABLE_TIMES`, `resolveCastTime` → `resolveActionableAt`,
`castTimeBySkillType` → `actionableAtBySkillType`, `echoStepCastTime` →
`echoStepActionableAt`, every `skillDef.castTime`/local `castTime` → the
same), `src/core/opener.js`, `src/core/types.js` (JSDoc), `src/ui/.../rotation.js`
(`step.castTime` reads — the UI's own `resolveCastTime` import), `tools/preprocess.mjs`
(`CAST_TIMES` → `ACTIONABLE_TIMES`, the stamped field), `data/skill-map.json`
(`_defaults.castTimeBySkillType` → `actionableAtBySkillType`), both test files
that construct skillMap fixtures with the field (`tests/timing-model.test.mjs`,
`tests/opener.test.mjs`), `docs/TIMING_MODEL.md` (schema + a new "Renamed"
callout explaining why), `docs/ARCHITECTURE.md`, `README.md`, and the two
re-runnable analysis scripts `docs/cast-time-drilldown.mjs`/`docs/cast-time-sensitivity.mjs`
(would have silently found zero slots and no-opped against a renamed dataset
otherwise). `docs/LANE-B-ASSET-EXTRACTION.md` §6 marked superseded (historical
target shape used the old name) rather than rewritten — its staging idea still
holds. `tools/extract/map-timings.mjs`'s output field renamed too, and the
artifact itself renamed `data/cast-times.json` → `data/actionable-times.json`
for consistency (regenerated, not hand-edited).

Deliberately NOT renamed: `ECHO_CAST_TIME`/`OUTRO_CAST_TIME` (separate, already
well-scoped constants for specific mechanics, not the field under discussion —
avoiding unrequested scope creep) and the UI's visible "Cast 0.55s" label text
in the rotation palette/steps (a copy decision, more subjective than an
internal identifier, left for the maintainer to decide separately).

**Verified the regenerated `data/wuwa-data.json` diff is a pure rename**
before trusting it: extracted every added/removed line, confirmed all 1,082
pairs are `-"castTime": X` / `+"actionableAt": X` with the SAME `X`, plus only
the expected `generatedAt` timestamp churn — zero behavior change, exactly as
a rename should look. LOCK B (`wuwa-meta.json`) moved by exactly 2 lines
(`engineHash` + `generatedAt`) — content unchanged, confirming no behavioral
drift.

**[Files Changed]** `src/core/sim.js`, `src/core/opener.js`, `src/core/types.js`,
`src/ui/components/build-editor/rotation.js`, `tools/preprocess.mjs`,
`data/skill-map.json`, `tests/timing-model.test.mjs`, `tests/opener.test.mjs`,
`tools/extract/map-timings.mjs`, `docs/TIMING_MODEL.md`, `docs/ARCHITECTURE.md`,
`README.md`, `docs/OPEN-ITEMS.md`, `docs/LANE-B-ASSET-EXTRACTION.md`,
`docs/cast-time-drilldown.mjs`, `docs/cast-time-sensitivity.mjs`; regenerated
`data/wuwa-data.json`, `data/data-version.json`, `data/wuwa-meta.json`;
renamed `data/cast-times.json` → `data/actionable-times.json`.

**[Logic Altered]** None — pure identifier rename, verified above. Every
`resolveCastTime`/`castTime` call site was updated in the same pass as its
declaration, so there's no stale-name/new-name split anywhere in `src/`.

**[Verification]** Full suite 57/57, sweep 65/0, lint 0 errors (0 new — the
1,420 warnings are the same pre-existing style debt). LOCK A shows the
expected pure-rename diff (verified line-by-line, see above); LOCK B moved
only `engineHash`/`generatedAt`.

**[Residual Risks]** None from this change specifically. `data/actionable-times.json`
is still not wired into `preprocess.mjs`/`sim.js` — same standing follow-up as
before, now under its new name.

### Follow-up same day — the 4 remaining stance-switch gaps investigated, hypothesis corrected (2026-07-28)

Maintainer asked to close the gap for Denia/Lumi/Buling/Lucy on the assumption
their alt-form data lives in an unindexed subfolder, same shape as Aemeath's
`DT_SkillInfo_GD`. Tested that hypothesis exhaustively and it does NOT hold —
worth recording since it corrects an earlier speculative note in
`TIMING_MODEL.md`/`OPEN-ITEMS.md`.

**What was checked:** wrote a one-off scanner (`tools/extract/_scan_variants.py`,
deleted after use) that parses every `DT_SkillInfo_*` variant table roster-wide
that isn't already indexed (~75 files: `_Rogue`/`_Rouge`, `_Performance`,
`_Child_photos`, `_MainLine`, etc.) and reports which resonator-id prefixes
each one's rows carry. Only the already-known non-combat tables matched
1211/1504/1307/1511 — no hidden `_GD`-style table exists for any of them.

Dumped Lucy's (1511) full raw row set directly from her own `DT_SkillInfo`
table (byte-exact parsed, so this is provably complete) — her real kit IS
there: E1/E2/E4 skills (`1511100`/`1511101`/`1511200`), enhanced-state moves
(`1511301`-`1511326`), Liberation (`1511400` "Lucy大招"), intro (`1511800`),
outro (`1511900`), Tune Break (`1511901`). But several of her `hit-map.json`
ids (e.g. `liberation_netrunner_override` → `151104101`) don't share a prefix
with any of these real row ids. Checked whether the real rows reference those
ids indirectly via their `SkillTriggers`/`SkillBehaviorGroup` fields (both
empty on every row checked) — ruled that out too. Denia's (1211) case looks
different again: her whole `1211100`+ id range is simply absent from her
table's row set, closer to Chixia's shape (genuinely missing) than Aemeath's
(present under an unindexed name).

**Conclusion:** for these four, `data/hit-map.json`'s ids don't reliably
decompose to `DT_SkillInfo` row ids the way they do for the other ~52
characters (95%+ of the roster) — a deeper, different problem than a missing
table, and not something `COMBAT_FORM_TABLE_NAMES` can fix. Left as a
documented limitation rather than guessed at further; coverage numbers
unchanged from the prior entry (852/1,061, 80.3%).

**[Files Changed]** `docs/TIMING_MODEL.md` (corrected the "likely hide their
own differently-named table" note with the actual finding), `docs/OPEN-ITEMS.md`
(item 1 remaining-gaps note). No code changes — the investigation didn't
surface a fixable bug.

**[Logic Altered]** None.

**[Verification]** N/A — no code changed. The three investigation scripts used
(`_scan_variants.py`, plus two smaller ad-hoc row/field dumps) were deleted
after use, consistent with how the Xuanling/Rover/Aemeath investigations were
run earlier the same day.

**[Residual Risks]** These four characters keep their existing fabricated-default
timing — no regression, same as before this investigation. If real timing for
them matters later, the next step isn't extending the table allowlist — it's
figuring out what `hit-map.json`'s ids for these characters actually reference
(a `preprocess.mjs`/`matchRowHits` question, not an extraction-tooling one).

### Follow-up same day — Chixia's "genuine gap" conclusion was wrong; two real bugs fixed (2026-07-28)

The maintainer supplied three concrete leads: Aemeath's mech form (already
found, `AimisiGD`), Cartethyia's "Fleurdelys" special form at
`FemaleZ/Fuludelisi`, and — critically — Chixia's actual folder at
`FemaleM/Maxiaofang`, identifiable from her nanoka JSON's `background` image
path (`T_IconRole_Pile_maxiaofang_UI`). The earlier session's "Chixia — no
trace anywhere in the export" conclusion was **wrong**: it searched by the
name "Chixia" and gave up, never considering she might use a codename with
zero string overlap — exactly the same class of mismatch as Rover's
Nvzhu/Nanzhu, just not recognized as the same pattern at the time. Lesson: a
"confirmed absent" conclusion built on a name-based search is only as good as
the names tried — the Rover case should have raised this as a live
possibility for every other "genuinely missing" character, not just Rover.

**Cartethyia (Fuludelisi) needed no fix** — her Fleurdelys-form table uses
standard 7-digit row ids under her normal id (1409), so it was already fully
captured from the very first extraction run; confirmed by direct inspection,
not assumed.

**Chixia (Maxiaofang) needed two real, independent fixes**, once pointed at
the right folder:

1. Her raw row ids are *shorter* than the rest of the roster — `120201`
   (4-digit resonator id + a bare 1-2 digit skill index) instead of the usual
   `1102001`-style 7-digit form. `extract_timings.py`'s `SKILL_ID_RE` required
   a 3+ digit suffix, so every one of her rows was silently excluded — the
   exact same shape of bug as the Xuanling/Rover fixes earlier the same day
   (a regex/assumption too narrow for one character's format, not a data
   gap). Added `SHORT_SKILL_ID_RE`, validated against the roster's `1[1-6]XX`
   id-tier structure to distinguish real short ids (`1202`, `1302`) from
   shared/common short ids (`1000`, `2000`, `2100`, `2200`, `2300`, `3000`)
   that show up identically across many unrelated characters' tables —
   confirmed this distinction by scanning every already-indexed table for
   collisions before trusting it, not by guessing at a cutoff.
2. Even with her rows now indexed, the *join* still failed: `hit-map.json`'s
   ids zero-pad her skill index to nanoka's standard 3 digits
   (`1202001001`), which has no exact-length-prefix match against her actual
   unpadded row (`120201`). Added a de-zero-pad fallback to `map-timings.mjs`'s
   `resolveSkillId` — tried only after the primary exact-match search fails,
   and only re-validated against her own known row set, so it can't produce a
   wrong match, only a missed one.

Re-investigated the 4 remaining stance-switch kits (Denia/Lumi/Buling/Lucy)
against both new leads — neither applies. Their row-id widths are the
standard 7-digit form (ruling out the short-id fix), and the exhaustive
variant-table scan from the prior entry already ruled out a hidden table.
Still an open, deeper problem, unchanged from the prior entry's conclusion.

**Result: coverage 852/1,061 (80.3%) → 862/1,061 (81.2%)**; resonators found
59 → 60.

**[Files Changed]** `tools/extract/extract_timings.py` (`SHORT_SKILL_ID_RE` +
its use in the row-matching loop), `tools/extract/map-timings.mjs`
(`resolveSkillId`'s de-zero-pad fallback), `data/timing-data.json`,
`data/actionable-times.json` (regenerated), `docs/TIMING_MODEL.md` (corrected
the Chixia bullet, added the Cartethyia confirmation, updated coverage
numbers), `docs/OPEN-ITEMS.md` (item 1 numbers).

**[Logic Altered]** Extraction/mapping tooling only — no `src/` changes,
`data/wuwa-data.json` still untouched, `data/actionable-times.json` still not
consumed anywhere.

**[Verification]** Full suite 57/57 (unaffected — no `src/` touched), lint
clean on the changed file. Spot-checked directly: Chixia's `basic_1`-`basic_4`,
both heavy variants, `midair_mid_air_attack`, `basic_dodge_counter`,
`liberation`, and `intro` all resolve now (10/13 keys); Cartethyia's Fleurdelys
rows (`1409201`-`1409293`) confirmed present since the very first run.
Investigation scripts (`_check_new.py`, `_check_short_ids.py`) deleted after
use.

**[Residual Risks]** None new. The 4 remaining stance-switch gaps are
unchanged and still documented as a separate, deeper limitation (see the
prior entry). `data/actionable-times.json` still isn't wired into
`preprocess.mjs`/`sim.js`.

## Timing extraction — the bullet chain replaces prefix matching (81.2% → 96.5%)

**[Files Changed]** `tools/extract/scan_bullet_timings.py` (new),
`tools/extract/map-timings.mjs`, `docs/TIMING_MODEL.md`, `docs/OPEN-ITEMS.md`,
`docs/timing-gaps-report.md` (regenerated), `data/bullet-timings.json` +
`data/actionable-times.json` (regenerated, both untracked). No `src/` change;
`wuwa-data.json`/`wuwa-meta.json` untouched — engine wiring is still deferred.

**[Logic Altered]** The join from a `hit-map.json` damage id to an animation no
longer goes through `DT_SkillInfo` row ids. It follows the link the game stores:
animation notify names a bullet (`子弹数据名` / `bulletRowName` / `BulletIds` /
`子弹id数组`), and the bullet's `DT_ReBulletDataMain` row names the damage ids it
applies (`伤害ID` / `多伤害ID`, transitively through `子子弹设置.召唤子弹ID` for
carrier bullets that spawn the damaging child). Exact string identity at every
hop. The old prefix-decomposition route is kept as the fallback for the 141 keys
the chain can't reach, and is now demonstrably the coarser of the two: 30.6% of
its keys shared a skill row with another key, so it handed distinct abilities one
merged number (Camellya's `heavy_heavy_attack` and `liberation` were identical;
Baizhi's four basics were one value — now `AM_Attack01`–`04` at 0.5/0.6/0.7/0.6s).
Route recorded per entry as `route: 'bulletChain' | 'skillRow'`; 883 / 141.

Four findings were needed, each from following evidence rather than assuming the
first working case generalised: bullet ids are **not** damage ids (Baizhi's intro
damage `1103160001` comes from bullet `11030160002`, a different number, so no
padding rule could have found it); four notify spellings fire bullets, including
the **condition-gated** `TsAnimNotifySkillBehavior` that authors alternate-form
movesets; carrier bullets deal no damage and spawn the bullet that does; and
`AnimSequence` assets carry notifies exactly like `AnimMontage` (Mortefi's
mid-airs). Detection is by export class and a byte pre-filter on the field names,
never by an `AM_*` filename. A tripwire reports any unread bullet-ish field name
(`unreadBulletLikeFields`) so a fifth spelling surfaces instead of silently
becoming a gap; `bulletName` is excluded on purpose (it belongs to a *destroy*
notify — reading it would stamp a hit time on a despawn).

**[Verification Method]** `npm test` 57/57, `npm run sweep` 65 imported / 0
failed, `npm run lint` 0 errors. Coverage measured before/after on the same
`hit-map.json`: 862 → 1,024 of 1,061. Chain validated end-to-end on Baizhi, whose
four previously-"impossible" ids all resolve through it, and spot-checked against
the row route on 721 keys both resolve — the 162 disagreements are the row route's
shared-row collapses, not chain errors. `resonatorsInDatasetNotInExtraction` is
still empty. The 7 bullet-table parse failures are all `_story`/`TestModel`
folders (non-combat), confirmed individually.

**[Residual Risks]** Where several *combat* animations fire one damage id (231
keys) the earliest actionable time is taken, matching the row route's existing
`min()`; 146 of those agree within 0.05s, but 41 entries have a >0.3s spread and
could be averaging two genuinely different moves — each carries
`montageCandidates`/`actionableAtSpread` so they are auditable rather than hidden.
The non-combat-mode exclusion is a path regex; a mode folder named differently
would leak through. 37 keys remain unresolved, and per the bullet labels most are
turret/summon/field/DoT damage with no player animation to extract (correctly
left on the fabricated default) — Ciaccona's two aimed shots are the only clear
"real move, link still missing" cases.

**[Updated Docs]** `docs/TIMING_MODEL.md` gained a "The bullet chain" section and
its coverage numbers were corrected; the previous verdict on the four
stance-switch kits ("a different, deeper problem, left as a documented
limitation") is struck through rather than deleted — it was wrong, and the reason
is recorded: their ids were never meant to decompose, so "the ids don't decompose"
was evidence the join was wrong, not that the data was missing.

## Timing extraction — candidate selection: phases, variants, and shared damage ids

**[Files Changed]** `tools/extract/montage_timeline.py`,
`tools/extract/scan_bullet_timings.py`, `tools/extract/map-timings.mjs`,
`docs/TIMING_MODEL.md`, `docs/OPEN-ITEMS.md`; regenerated
`data/bullet-timings.json`, `data/actionable-times.json`,
`docs/timing-gaps-report.md` (all untracked). No `src/` change; coverage
unchanged at 1,024/1,061 — this corrects VALUES, not reach.

**[Logic Altered]** Investigating the 41 wide-spread entries flagged by the
previous session found that "several animations fire this damage id" hides three
different situations, and taking the earliest time was wrong in all three.

1. *Sequential phases.* An animation with neither a cancel window nor a
   skill-end notify never returns control, so it cannot be where the action
   completes — it is an uncancellable wind-up chaining into a follow-up.
   `derive()` now marks these `is_phase`; they are never chosen as the answer,
   and a matching `X_Start` for a chosen `X_End` has its full length ADDED
   (`leadInPhaseMontage`/`leadInPhaseLength`). 17 entries compose; Changli's
   Skill 0.31s → 1.48s, Cantarella's mid-air 0.20s → 1.00s.
2. *Mutually-exclusive state variants* (ground/air, `_LimitDodge`, `_8M` range,
   `_20011` alternate-model copies) — `min()` was systematically picking the
   fastest, an optimistic bias.
3. *One damage id shared by different actions* — Sanhua's skill damage is also
   dealt by her enhanced basics, so her `skill` key answered with a BASIC ATTACK
   montage at 0.33s.

2 and 3 are fixed by reusing the DT_SkillInfo row as a **disambiguator only,
never as a timing**: when the row names exactly one of the candidates, it wins
(`disambiguatedBySkillRow`). Zero matches is not evidence against the ranked
pick — the row frequently names the `_Start` phase deliberately filtered out —
so only a unique match is trusted. Applies to 114 entries, corrects 26 values,
every one moving from a variant onto the canonical montage.

Also: `derive()` now prefers the `TsAnimNotifyFightStand` idle-return instant
over raw `sequence_length` in its last fallback, and the montage tie-break
prefers the shorter asset path so a canonical montage beats an alternate-model
copy of itself (which had been defeating the `_Start`/`_End` suffix match on
Chisa and Lynae).

**[Verification Method]** `npm test` 57/57, `npm run sweep` 65 imported / 0
failed, `npm run lint` 0 errors. The composition arithmetic is validated against
the single control the export contains: Camellya ships both a split pair and a
monolithic `AM_Attack05` of the same attack — composed 1.3067 vs the monolithic's
own 1.34 (Δ 0.033s), with hit instants aligning under the same offset. Each
change set was diffed against a snapshot of the previous output and inspected
entry by entry; the final refactor was confirmed behaviour-preserving (exactly
the 26 intended value changes, no others). Wide-spread entries fell 41 → 24.

**[Residual Risks]** The phase pairing is the one place the pipeline relies on a
naming convention (`X_Start`/`X_End`), because nothing else in the data carries
the relationship — zero DT_SkillInfo rows roster-wide list both halves, and
bullet ids cannot distinguish sequential phases from state variants (Denia's
`AM_AirAttackII_04_Start` and `AM_AttackII_04` are air and ground versions of one
attack, not phases of it). It fires only when both halves are candidates for the
same damage id, so the blast radius is 17 entries. The sum itself rests on one
control. 29 entries are phase-only (`isPhaseOnly`) — their completing montage
fires no bullet, so the value is a lead-in length and understates. ~12 of the
remaining 24 flagged entries are genuinely undecided (Zhezhi air-vs-ground,
Yangyang's liberation, Camellya's Waltz loop, Roccia's tiers, Rebecca's two
intros) and need a human call on which variant a rotation uses.

**[Updated Docs]** `docs/TIMING_MODEL.md` gained a "Choosing between candidate
animations" section; `docs/OPEN-ITEMS.md` item 1 notes the selection model and
the residual dozen.

## Timing extraction — maintainer walkthrough of the 13 undecidable variants

**[Files Changed]** `data/timing-overrides.json` (new, curated, hand-editable),
`tools/extract/map-timings.mjs`, `docs/TIMING_MODEL.md`, `docs/OPEN-ITEMS.md`;
regenerated `data/actionable-times.json`, `docs/timing-gaps-report.md`. No
`src/` change; coverage unchanged at 1,024/1,061.

**[Logic Altered]** Walked the 13 entries no automatic signal could resolve.
The headline finding is that they were mostly **not data problems — they are
missing state modelling**: 13 keys across 6 resonators are gated on Zhezhi's
ground-vs-air Conjuration, Brant's airborne mid-air rotation, Rebecca's
Huntress/Guts weapon mode, Lucy's [Algorithm Compaction], Camellya's [Blossom
Mode] and Roccia's [Beyond Imagination]. Those are now flagged
`needsStateModel` with their alternatives preserved rather than silently
resolved.

Three mechanisms added:

1. `data/timing-overrides.json` — curated `pinnedMontage` (6 entries, each with
   its reasoning) and `needsStateModel` (13). A pin matching no candidate is a
   hard error, so a stale entry surfaces instead of silently falling back.
2. `variants[]` on every multi-candidate key (215) — each alternative's montage,
   actionable time, cancel window, hit instants and bullet label. The pick no
   longer discards the alternatives, so a state model can select later without
   re-deriving anything.
3. Rover is always the female build. Male and female ship separate bullet id
   blocks applying the SAME damage ids, so both were candidates and the pick was
   arbitrary — **40 keys across all four elements had landed on the male build.**
   Implemented as a substitution onto the mirrored female asset, not a filter,
   which also rescues 5 Rover: Spectro keys whose ids reach only male bullets.

Six entries were decided outright from the game's own labels — notably Yangyang's
`liberation` moving to `AM_Burst01` (it previously extracted NO freeze and fell
back to `HARDCODED_FREEZE_FRACTIONS`; now 2.212s measured), Rebecca's two intros
separating along the `手枪切霰弹`/`霰弹切手枪` pistol/shotgun transition, and Rover:
Havoc's Lifetaker moving off the enhanced-heavy montage onto the enhanced-skill
one it names.

**[Verification Method]** `npm test` 57/57, `npm run sweep` 65 imported / 0
failed, `npm run lint` 0 errors. Every pin verified to land on its intended value
and montage; zero pin failures. The final refactor was diffed field-by-field
against a snapshot: 0 value differences, 30 entries differing only in key order.
Rover male-pick count 40 → 4, and each of those 4 was confirmed by direct
filesystem check to have no female asset in the export.

Also confirmed from data, answering maintainer questions: `*Execute*` montages
are Tune Break (100% of the 75 `SkillGenre 14` rows, names all `破弱` split by
weapon); `Rogue`/`Rouge` is a complete 1,212-asset parallel re-tuning of every
kit for a separate game mode; `QTE` ≈ Intro Skill, inherited from Kuro's
*Punishing: Gray Raven*.

**[Residual Risks]** The 13 `needsStateModel` keys carry a provisional value that
is only correct for one branch of the state — they are marked, not fixed, and
will read wrong for the other branch until the states exist. 4 Rover keys still
use male animations because the female asset is absent from the export. A
majority-of-damage-ids tie-breaker was evaluated and deliberately NOT added: it
was decisive for exactly one entry (Rebecca's), which a curated pin now covers,
and enabling it would have shifted other unreviewed entries. 24 keys remain
flagged above 0.3s spread, but they now keep their full `variants` array so the
flag is informational rather than lossy.

**[Updated Docs]** `docs/TIMING_MODEL.md` gained "Curated decisions", "Rover is
always the female build" and "Asset naming decoded"; `docs/OPEN-ITEMS.md` records
the state-model follow-ups.

## Timing model — measured actionableAt wired into the engine

**[Files Changed]** `tools/preprocess.mjs`, `tools/extract/map-timings.mjs`
(gaps-report generator), `tests/cooldowns.test.mjs`,
`tests/rotation-state.test.mjs`, `.gitignore`, `docs/TIMING_MODEL.md`,
`docs/OPEN-ITEMS.md`, `docs/timing-gaps-report.md`; regenerated
`data/wuwa-data.json`, `data/data-version.json`, `data/wuwa-meta.json`.

**[Logic Altered]** `preprocess.mjs` reads `data/actionable-times.json` after the
`autoSkillMap` is built and stamps the measured `actionableAt` over the per-type
`ACTIONABLE_TIMES` guess — **1,021 of 1,079 steps now carry a real
animation-derived time**, the other 58 keep the fabricated default. `sim.js`
needed no change: `resolveActionableAt` already preferred `skillDef.actionableAt`.
Each stamped step also records `timingSource` ('extracted' 1,015 / 'curated' 6)
and, where applicable, `timingProvisional` ('state' 13 / 'phaseOnly' 25). Steps
whose measured value is 0 (3 of them, e.g. Baizhi's hold-loop heavy) are skipped
by a `> 0` guard so no step collapses to zero duration.

`freezeTime` is deliberately NOT stamped. 137 entries carry a measured freeze but
only 58 are Liberations — **63 are Intro Skills**, plus 12 forte-heavy. The sim's
freeze semantics are strong (gameTime pauses, so cooldowns AND buff durations stop
and the DPS denominator excludes the window) and currently gated to cinematic
Liberations. Sampling the raw montages shows intros and Liberations use the SAME
`TsAnimNotifyStateAbsoluteTimeStop` notify, so the data cannot distinguish a
cinematic time-stop from ordinary hitstop; stamping would silently give 63 intro
steps full freeze semantics. Left as an explicit open decision.

The gaps report was broadened from "unresolved keys" to a three-section data
quality report: unresolved (37), state-gated (13), phase-only (29), with the
remaining 982 called out as measured-with-no-caveat.

**[Verification Method]** `npm test` 57/57, `npm run sweep` 65 imported / 0
failed, `npm run lint` 0 errors. LOCK A audited field-by-field rather than by
line count: the only changed JSON keys are `castTime`→`actionableAt` (the earlier
uncommitted rename), the `actionableAt` values themselves, and the new
`timingSource`/`timingProvisional`; the 1,490 `source` lines in the diff were
confirmed to be 745 identical `"source": "nanoka"` values that merely gained a
trailing comma, with zero value changes. LOCK B moved as expected (measured
timings feed the optimizer). Six known values spot-checked against the
walkthrough decisions, all exact.

**[Residual Risks]** Two tests failed on the first run and were **stale fixtures,
not regressions** — both hardcoded filler counts sized against the fabricated
0.55s basic (Sanhua 0.55→0.3333, Cantarella 0.55→0.40, Lucilla 0.55→0.426), so a
cooldown gap and two buff-expiry windows no longer elapsed. Both now DERIVE the
count from the dataset's own timings, so they cannot rot again when a montage
measurement changes. This is a general hazard: any other fixture that assumes a
per-type default will drift, and only ones with an assertion sharp enough to fail
will announce it. 38 steps carry a provisional value correct for one branch only.

**[Updated Docs]** `docs/TIMING_MODEL.md` gained "Wired into the engine";
`docs/OPEN-ITEMS.md` item 1 marks the wiring done and records freezeTime as the
remaining open decision; `.gitignore` documents why `actionable-times.json` is
committed while the multi-MB intermediates are not.

## Timing model — major vs minor freeze separated from the notify flags

**[Files Changed]** `tools/extract/montage_timeline.py`,
`tools/extract/scan_bullet_timings.py`, `tools/extract/map-timings.mjs`,
`docs/TIMING_MODEL.md`, `docs/OPEN-ITEMS.md`; regenerated
`data/bullet-timings.json`, `data/actionable-times.json`. **No engine change** —
`freezeTime` is still not stamped, and `data/wuwa-data.json` is byte-identical
(verified: 0 autoSkillMap steps changed).

**[Logic Altered]** Maintainer verified in-game that WuWa has TWO freezes: MAJOR
(complete stop — timers, buffs, cooldowns, enemy actions; Liberations and the
Tune Break `Execute` animations) and minor (enemy actions/movement only, very
brief; Intro Skills). Only MAJOR matches the sim's freeze semantics, so the
previous single `freeze_total_s` was unusable — stamping it would have given 60
intro steps a full world-pause.

The notify object distinguishes them. UE serialises only properties that differ
from the class default, and `角色战斗机制停止` ("character combat-mechanic stop")
defaults to TRUE; a notify writing it `false` is opting out of stopping the
player's clock. `montage_timeline.derive()` now resolves each freeze notify's own
export, reads that flag, and reports `freeze_major_s` (union of player-clock
windows) beside `freeze_total_s`. `actionable-times.json` splits them into
`freezeTime` (major — the sim-relevant one) and `freezeMinorTime`.

Split: **73 major** (57 liberation, 10 forte_heavy, 3 intro, 1 each
heavy/basic/skill) and **64 minor** (60 intro, 2 forte_heavy, 1 midair,
1 liberation), from 137 undifferentiated.

**[Verification Method]** Six independent in-game observations, all matching:
Liberations major; Intros minor; Tune Break `Execute` major (7/7 montages
sampled); Shorekeeper's `intro_discernment` major (it is Liberation-tied, and its
montage is literally `AM_Burst02`); Lucy's enhanced Resonance Skill
(`skill_deadlock`) major while her enhanced heavy carries no freeze at all. The
rule additionally classifies **Calcharo's `liberation_necessary_means_damage`
(a continuation stage) as minor on its own**, deriving from data what
`resolveFreezeTime`'s `consumesResource` gate hardcodes. `npm test` 57/57;
`wuwa-data.json` confirmed unchanged.

**[Residual Risks]** One discrepancy: **Aemeath's enhanced Resonance Skill**
(`AM_Skill03`) classifies MAJOR but was observed as minor. Her notify uniquely
sets `是否冻结移动效果: false` ("do not freeze movement effects"), so actors keep
moving through it — enemy movement is therefore not a valid tell for her case,
and it needs a re-test against a cooldown or buff timer. If she really is minor,
the single flag is not sufficient and a second condition is needed. Stamping
remains unwired: it would give 16 non-Liberation steps freeze semantics they have
never had, and would largely supersede the hardcoded cinematic gate.

**[Updated Docs]** `docs/TIMING_MODEL.md` gained "Two freezes, and which one the
sim models"; `docs/OPEN-ITEMS.md` records that the freezeTime blocker is resolved
and what remains is the engine-side decision.

## Timing model — the freeze-flag rule is DISPROVEN (correction to the entry above)

**[Files Changed]** `tools/extract/montage_timeline.py`,
`tools/extract/scan_bullet_timings.py`, `tools/extract/map-timings.mjs`,
`docs/TIMING_MODEL.md`, `docs/OPEN-ITEMS.md`; regenerated
`data/bullet-timings.json`, `data/actionable-times.json`. No engine change.

**[Logic Altered]** The preceding entry claimed `角色战斗机制停止` distinguishes
the major from the minor freeze, validated on six in-game observations. **It does
not.** Maintainer re-tested Aemeath definitively — both Fusion Burst and Tune
Break resonance modes — and confirmed only enemy movement/actions freeze while
timers, cooldowns and buffs keep ticking. Her mech-form `AM_Skill04_GD` and
Lucy's confirmed-major `AM_Skill05` have **byte-identical** freeze notifies: same
two classes, zero property overrides on either. Two identical serialisations,
two behaviours — so the deciding factor is not in the montage.

Rolled back accordingly: `freeze_major_s` / `freezeMinorTime` are gone. The
extraction now reports the freeze DURATION (`freezeTime`) plus the flag as
explicitly-labelled raw evidence (`freezeCharacterClockOptOut`), and the
major/minor call is deferred to curated in-game observation.

Answering two maintainer questions surfaced a second, independent reason not to
stamp per key: **freeze belongs to the ANIMATION, and several skillMap keys share
one animation.** Four non-Liberation steps resolve to their own character's
Liberation montage — Sanhua's `forte_heavy_glacier_burst_damage`, both of
Buling's forte keys, and **Jianxin's `basic_3`** (2.70s from `AM_Burst01`). Those
are damage instances occurring inside the Liberation, not steps that freeze.
Separately, 31 of 89 liberation steps have no measured freeze at all — nearly all
continuations (`consumesResource: false`) or non-energy "liberations" (Lucilla),
which is precisely what `resolveFreezeTime`'s existing gate excludes. The current
hardcoded model is therefore closer to correct than the raw data is.

**[Verification Method]** Byte-level comparison of the two notify payloads;
`npm test` 57/57; `data/wuwa-data.json` unaffected (freezeTime still not stamped).

**[Residual Risks]** None introduced — this removes a wrong inference rather than
adding behaviour. Lesson recorded: six confirming observations did not make the
rule true; the disconfirming case existed and only a targeted re-test found it.

**[Updated Docs]** `docs/TIMING_MODEL.md` "Two freezes" rewritten around the
disproof; `docs/OPEN-ITEMS.md` reframes freezeTime as needing curation, not
extraction.

## Timing model — freeze settled from the game's own source, and wired

**[Files Changed]** `tools/extract/montage_timeline.py`,
`tools/extract/scan_bullet_timings.py`, `tools/extract/map-timings.mjs`,
`tools/preprocess.mjs`, `tests/timing-model.test.mjs`, `docs/TIMING_MODEL.md`,
`docs/OPEN-ITEMS.md`; regenerated `data/bullet-timings.json`,
`data/timing-data.json`, `data/actionable-times.json`, `data/wuwa-data.json`,
`data/wuwa-meta.json`, `docs/timing-*-report.md`. Removed the redundant
`docs-local/Role` copy (superseded by a full client export).

**[Logic Altered]** The maintainer extracted a full client, which ships the
game's **JavaScript source**. `Content/Aki/JavaScript/Game/AnimNotifyState/*.js`
settles the freeze question outright — each notify's `GetNotifyName()` states its
own effect:

- `TsAnimNotifyStateTimeStopRequest` → "副本计时和所有战斗单位buff、技能冷却冻结"
  ("instance timer and ALL combat units' buffs and skill cooldowns freeze") —
  exactly the sim's gameTime pause. **This is the freeze we model.**
- `TsAnimNotifyStateAbsoluteTimeStop` → "动画和子弹冻结" ("animation and bullet
  freeze") — holds the animation, stops no clock. **Contributes zero.**

`derive()` now reports `freeze_combat_clock_s` (TimeStopRequest union) as the
freeze and `freeze_total_s` separately as `freezeAnimationTime`; the two are
never unioned. Split: 69 clock freezes vs 67 animation-only — including all 61
ordinary Intro Skills, which was the entire risk of stamping.

`preprocess.mjs` stamps the measured freeze onto **56 steps**, replacing the
`HARDCODED_FREEZE_FRACTIONS` "whole animation" estimate (Sanhua's Liberation is
1.5016s of a 1.6202s cast, not 100%). 13 steps are skipped by guards mirroring
`resolveFreezeTime`'s cinematic gate, which a stamped value would otherwise
bypass: cost-free continuations, and liberation steps of non-energy "ultimates"
(`energyMax === 0`). Phrolova proved the need — five of her liberation-tagged
steps share one summon animation each reporting 4.0s, so stamping would have
frozen 20s for one cast.

Also fixed en route: `montagesForDamageId` preferred id-identity over the bullet
table, so a damage id that is ALSO an unrelated bullet id resolved to the wrong
animation — Jianxin's `basic_3` was a **7.07s basic attack with a 2.70s freeze**
from `AM_Burst01`; it is now 0.9185s from `AM_Attack03`. 4 of 1,220 ids were
affected, identity wrong in all 4.

**[Verification Method]** `npm test` 57/57, `npm run sweep` 65/0 failed,
`npm run lint` 0 errors. Every maintainer-verified case matches: Liberations,
Tune Break `Execute`, Shorekeeper's Liberation-tied enhanced intro, Lucy's
Deadlock and Aemeath's Seraphic Duet all carry a clock freeze; ordinary intros,
Shorekeeper's plain intro and Calcharo's continuation carry none. Maintainer
cooldown measurements against the cinematic-camera window corroborate
(Aemeath mech: 1.7–1.9s ticked across a 3.00s hidden window; no-freeze would
predict 3.00s).

**[Residual Risks]** Aemeath was never a counterexample — my `角色战斗机制停止`
rule matched six observations and was still wrong, because the source shows
`AbsoluteTimeStop` never reads that flag. Her "enemies only" reading came from a
SEPARATE per-bullet system (`时间膨胀`: bullet `1210110505` "合击·登台--时停",
victim 3.0s @0.0, no attacker block), which is not modelled. Lucilla's
`DT_SkillInfo` fails to parse ~~in the re-dumped client export~~ ("bad size
-1728053248"); she still resolves 16/19 via the bullet chain, so the cost is 1
skillRow fallback key (1024 → 1023 of 1061). Per-bullet time dilation (4,375
bullets, 2,268 curves) remains unmodelled by design.
→ **CORRECTED 2026-07-29** (see "Lucilla's DT_SkillInfo — name-map skew"
below): nothing about the re-dump was involved, and the "1 fallback key" cost
was overstated — coverage is 1023/1061 either way. The failing asset was also
misread as Roccia's at one point; `FemaleXL/Luosela` IS Lucilla.

**[Updated Docs]** `docs/TIMING_MODEL.md` "Two freezes" rewritten around the
shipped-source evidence and the wiring; `docs/OPEN-ITEMS.md` marks freezeTime
done and records per-bullet dilation as out of scope.

---

## 2026-07-29 — Lucilla's DT_SkillInfo: name-map skew (root-caused and repaired)

**[Files Changed]** `tools/extract/ue_tagged.py` (`UE_PROPERTY_TYPES`,
`TaggedReader.types_seen`, `SkewedNames`, `_decode_rows`, `field_names`,
`_repair_name_map_skew`, `parse_datatable` gains `repair_vocabulary`),
`tools/extract/extract_timings.py` (two-pass parse; `source_table` dedupe fix;
`_meta.name_map_repairs`), regenerated `data/timing-data.json`,
`data/actionable-times.json`, `docs/timing-extraction-report.md`,
`docs/timing-gaps-report.md`.

**[Logic Altered]** The previous session recorded Lucilla's table as failing
because "her asset differs from the copy we had". That was an unverified guess
and it is wrong — no second copy was ever involved. The defect is entirely
inside the one `.uasset`/`.uexp` pair: **the `.uexp` addresses a name map with
526 entries while the `.uasset` ships 525.** Her name table is provably intact
(525 well-formed entries, alphabetically sorted, every null terminator valid,
consuming the span to `import_offset` exactly) and her import map resolves
perfectly at face value (`SSkillInfo` at import −7, matching the decoded
`RowStruct: {'__objref': -7}`). The extra entry sits in the enum block between
`ESkillBehaviorActionType` (226) and `ExtraDetectSphereRadius` (275), so name
indices *below* that point are correct and everything above is one too high —
which is exactly why her row ids (`1109001`, index 93) read fine while
`RowStruct` (394→393), `ObjectProperty` (363→362) and the `None` terminator
(362→361) all resolved to their alphabetical neighbours, desynchronising the
walk at the first `StructProperty` as `bad size -1728053248`.

`parse_datatable` now recovers, gated on two oracles that must BOTH agree:
(1) the walk still lands exactly AND every top-level property type is a real UE
type — necessary but not sufficient, because a wrong property *name* does not
change byte consumption, so exact landing alone tolerates any boundary in
164–362; (2) the decoded field names must match the vocabulary of the sibling
tables that parsed cleanly — every `DT_SkillInfo` shares the `SSkillInfo`
struct, which narrows it to 226–275. Only the top-level walk feeds the type
oracle; nested struct/array parsing is best-effort by design and would poison
it. The repair runs ONLY after a normal parse fails, and is reported in
`_meta.name_map_repairs` — never silent.

Also fixed, pre-existing and unrelated: `source_table` compared an absolute
path against stored relative ones, so it never deduplicated (Sanhua carried 28
copies of one path).

**[Verification Method]** `npm test` 57/57; `npm run sweep` 65 imported /
0 failed; `npm run lint` 0 errors. **65 previously-parsing tables verified
byte-identical** with the repair path compiled in. Lucilla now yields 24 rows
with correct ids and legible fields (`SkillName: 普攻1`, real `CooldownConfig`,
`Animations → AM_Attack01`); extraction errors 8 → 7; resonators 59 → 60. LOCK
A: `wuwa-data.json` byte-identical between the pre-fix and post-fix baselines
(reconstructed by deleting `1109` from the extraction and re-running the join,
since `git diff` proves nothing on these still-untracked files). LOCK B:
`wuwa-meta.json` deterministic across runs, and no engine file was touched.

**[Residual Risks]** The repair is **behaviour-preserving, not
coverage-improving**: 0 of 1,061 `actionable-times.json` entries changed, and
coverage stays 1023/1061 (96.4%). Her 16 resolved keys always came from the
bullet chain, which never needed `DT_SkillInfo`; her 3 unresolved keys have no
bullet row anywhere in the export, so the row route cannot reach them either.
The gain is a clean parse, a correct folder label in the gaps report, and the
skill-row disambiguator now being available to her. The exact insertion index
(226 vs 275) is undecidable from the data because no name index in that window
is ever referenced — every choice decodes identically for every field read.
The skew's ultimate origin (why Kuro shipped the pair mismatched) is unknown
and not chased.

**[Updated Docs]** `docs/TIMING_MODEL.md` gains "Name-map skew"; the earlier
residual-risk claim in the 2026-07-29 freeze entry is struck through and
corrected in place; `docs/OPEN-ITEMS.md` drops the Lucilla caveat.

---

## 2026-07-30 — Timing lane, increment 5 (final): freeze belongs to the animation; open item 1 closed

**[Files Changed]** `src/core/sim.js`, `src/core/opener.js`,
`src/core/team-sim.js`, `src/core/types.js`,
`src/ui/components/build-editor/rotation.js`, `tools/preprocess.mjs`,
`tests/timing-model.test.mjs`, `tests/opener.test.mjs`,
`docs/TIMING_MODEL.md`, `docs/OPEN-ITEMS.md`, `docs/ARCHITECTURE.md`,
`docs/GLOSSARY.md`, regenerated `data/wuwa-data.json` +
`data/wuwa-meta.json` + `data/data-version.json`.
**Not touched:** the extraction pipeline (`tools/extract/*`),
`data/actionable-times.json`, `data/timing-overrides.json` — no re-extraction
was needed or possible (the raw `docs-local/Role` export is gone; the committed
artifact already carried every field this used).

**[Logic Altered]** The two increment-4 freeze guards were structural
stand-ins for questions the extracted data can answer directly. All five
changes below are corrections the *wiring* exposed, not new modelling.

1. **A measured freeze outranks the cinematic gate** (`preprocess.mjs`). The
   gate (`consumesResource !== false` && `energyMax > 0`) guesses which
   Liberation step is the cinematic; where an animation carries its own
   `TsAnimNotifyStateTimeStopRequest` there is nothing to guess. This closes the
   long-deferred *"curated is-cinematic flag so cinematic finales freeze too"*
   item **with zero curation**. Six real finales gained a measured freeze —
   Carlotta Fatal Finale 3.178s (its own `AM_Burst02`), Hiyuki Inward Vision
   4.000s, Aemeath Heavenfall Edict Finale 5.667s, Ciaccona Symphonic Poem:
   Tonic 3.661s, Zani The Last Stand 2.233s, Cantarella Diffusion 3.567s — plus
   Jianxin's and Danjin's second liberation rows. Stamped steps 56 → 64.
2. **Freeze is credited per ANIMATION, not per key.** `preprocess.mjs` stamps
   `freezeSource` (montage path, or `row:<id>`); `sim.js`'s new
   `resolveFreezeSchedule` pays a source out once per rotation, with a
   *repeated key* still re-freezing (a genuine re-cast) — only different keys
   sharing one source collapse. Jinhsi's Incandescence fires Solar Flare and
   Stella Glamor off one `AM_Skill02`, and **her shipped reference rotation
   contains both**, so one 2.2s animation was counted as 4.4s of stopped clock.
   Freeze shrinks the DPS denominator, so that inflated her. Deliberately
   asymmetric: over-counting realTime deflates DPS (safe) and is left alone —
   two keys sharing a montage still each cost their full `actionableAt`.
3. **Freeze is clamped to its own step's `actionableAt`** (`resolveFreezeTime`,
   the single resolution point, so it covers stamped/default/fraction paths
   alike; skipped when no `actionableAt` is supplied). A measured
   TimeStopRequest can outlast the cancel point — Carlotta regains control at
   3.0335s, stays frozen to 3.90s — i.e. the freeze spills into the next
   action, which a per-step model cannot hold. Unclamped the step advanced
   gameTime by −0.87s. **13 reference rotations were running the in-game clock
   backwards** (Xiangli Yao −1.33s, Carlotta −0.87s, Lingyang −0.47s, Mornye
   −0.30s, …); 0 do now, verified by walking all 53.
4. **Provenance reached nothing.** `resolveTimingSource`'s accepted set was
   `imported | frame-counted | estimated` and had never been updated for what
   `preprocess.mjs` stamps, so all 1,020 measured steps reported `'estimated'`
   downstream — a measured animation time was indistinguishable from a per-type
   guess. Added `'extracted'`/`'curated'`; `step.timingProvisional` is carried
   onto steps; the rotation UI names a non-obvious provenance, always flags a
   provisional value, and shows the freeze window when there is one.
5. **`opener.js` agreed with the sim on neither echoes nor freeze.** It charged
   *every* echo the flat `ECHO_CAST_TIME`, so a parallel echo's free 50 energy
   looked like a 1.2s investment (`echoLockTime` now comes from the sim's own
   `echoStepTimeOf`, threaded as `memberEchoLock`); and its
   `resolveFreezeTime(skillMap[key], dataset)` call omitted `actionableAt` and
   `liberationCost`, silently zeroing every estimated freeze on the gameTime
   axis that seeds filler cooldowns. It now mirrors the per-animation dedup too.

**What did NOT change, and why the reason moved.** Phrolova's five Hecate keys
still contribute no freeze — but on a data rule, not `energyMax === 0`. Their
identical 4.0s windows come from the coarse `skillRow` fallback putting her
whole ultimate clip on all five keys, and their labels settle it: *"Basic
Attack — Hecate Stage 1/2"*, *"Enhanced Attack — Hecate — Strings/Winds/
Cadenza"* are on-field attacks inside the summoned form. So a freeze read off a
**shared `skillRow` row** is dropped (that route recovers a DT_SkillInfo row,
not an animation); a shared *bullet-chain* montage is kept and collapses via
rule 2. 5 steps skipped, all hers. The old guard was right by accident and
would have mis-fired on any non-energy character with a real cinematic.

**Two deferred items closed as OBSOLETE rather than done.** *Hold-button-skill
locks* — maintainer's call, and the data confirms it: the game authors a hold
as its own montage, so the measured `actionableAt` already **is** the
hold-committed time. 20 applied keys resolve to a hold/loop authoring (Rebecca
`heavy_guts` → `AM_Attack_Hold_M` 1.067s; Qiuyuan's three
`forte_heavy_thus_spoke_the_blade_*` → `AM_EX_Attack_Hold_01/02_2/03`; Camellya
Blazing Waltz → `AM_Attack03_Ex_Loop`, which the kit casts by *holding* Normal
Attack). A classifier would re-derive the measurement. One caveat: a pure loop
segment has no terminal notify and measures 0, so it is correctly not stamped
(3 keys, e.g. Baizhi `heavy_heavy_attack`, keep the per-type default).
*"Collapse instants toward zero" rescale* — it compensated for per-type
estimates overstating short abilities; there is now a measured base (Sanhua's
`basic_1` is 0.33s, not 0.55s), so it would re-fabricate on top of real data.

**[Verification Method]** `npm test` 57/57 files (timing-model 100 assertions,
up from 73; opener 37, up from 31), `npm run sweep` 65/65 modules, `npm run
lint` 0 errors. LOCK A: `wuwa-data.json` diff is exactly 8 semantic field
changes — the 8 newly-stamped freezes, with `actionableAt`, `timingSource` and
`timingProvisional` byte-identical on all 1,079 steps (the raw line churn is
key-ordering from adding `freezeSource`). LOCK B regenerated. New tests cover
`resolveFreezeSchedule` (shared source, repeated key, interleaving, order
independence, sourceless, empty), the clamp, `extracted`/`curated` provenance,
Carlotta's finale, Jinhsi's dedup end-to-end, and the opener's freeze axis
(read out as *where* `res_skill` lands in the filler: index 3 deduped / 8
unshared / 0 unfrozen, with `'open'` mode matching unfrozen exactly). The
backwards-clock defect was confirmed pre-existing by stashing and re-running
(13 hits) — not inferred. Sensitivity pass re-run on measured data (289 teams):
damage-rank ρ ≈ 0.99, DPS median Δ 5.14% per-type / 2.38% per-skill.

**[Residual Risks]** *Meta moved, deliberately.* 18 of 50 anchors reorder their
suggested teams; median team-DPS Δ 1.35%, p90 9%, max +15.7% (Chisa / Lynae /
Aemeath — her finale's 5.67s freeze plus free parallel echoes) and −5.5%
(Qiuyuan / Mornye / Sigrika — Mornye's 5.0s freeze clamped to her 4.7s step).
Every mover traces to one of the five changes; none is unexplained. Anchor
weights barely moved (Jinhsi −4.7% max, Hiyuki +1.25%, the other four
unchanged). *Per-rotation dedup is a convention*, not a measurement: if a
rotation legitimately re-casts one animation via two different keys, the second
is under-frozen — the never-inflate direction, and no reference rotation does
it. *`ECHO_CAST_TIME = 1.20` survives* as the engine's last fabricated timing
constant (open item 23). *13 keys stay `timingProvisional: 'state'`* (open item
22) — now visible in the UI rather than silent. *The arabwuwa ±5%
rotation-duration validation in TIMING_MODEL.md is still unexecuted* — no
recorded rotations were available, and nothing here substitutes for it.

**[Updated Docs]** `docs/TIMING_MODEL.md`: new sections "Freeze belongs to the
ANIMATION, not to the key", "Provenance actually reaches the sim", "Still open";
the two-guard paragraph struck through in place; facts 2 and 3 and the
remaining-facts list corrected; the Precision section replaced with the
post-measurement sensitivity numbers. `docs/OPEN-ITEMS.md`: item 1 struck
through and closed with the full increment history, section retitled, state
modelling promoted to item 22 and echo timing to item 23 (Phase E → 24).
`docs/ARCHITECTURE.md` + `docs/GLOSSARY.md`: the "cast times are fabricated"
limitation replaced with the measured/fallback split; `actionable-times.json`
and `timing-overrides.json` added to the overrides table.

---

## 2026-07-31 — Timing docs: retire the sourcing ladder, one data-driven pipeline

**[Files Changed]** `docs/TIMING_MODEL.md`, `src/core/sim.js`,
`tests/timing-model.test.mjs`, regenerated `data/wuwa-meta.json` +
`data/data-version.json`.
**Not touched:** `preprocess.mjs`, the extraction pipeline, any data artifact —
this changes what the workflow *permits*, not what it produces.

**[Logic Altered]** Maintainer direction: the timing model is fully
data-driven, so the alternative curation routes should not pollute the
workflow. A cross-check may stay as optional QA.

- **`## Sourcing ability data — priority order` deleted**, replaced by
  `## The pipeline — one source, and what to do when it misses`. The old ladder
  (0 extract → 1 import Maygi's sheets → 2 frame-count 60fps footage via
  `yt-dlp`/`ffmpeg` → 3 estimate as a last resort) was written when extraction
  was believed impossible; items 1–3 are retired. Each would introduce a number
  nobody can re-derive — pinned to a patch, a recording or a judgement call —
  sitting indistinguishable beside 1,020 values the game itself authored. The
  replacement is three tiers of which **only the first produces numbers**:
  extract (1,015 steps), curate a **decision, never a number** (`pinnedMontage`
  / `needsStateModel`, 6 steps), and the per-type fallback reframed as a **hole
  marker, not a sourcing option** (59 steps, explicitly "do not hand-tune").
- **`## Validation` → `## Optional QA: cross-checking against an outside
  measurement`.** Kept, but demoted from a gate ("before trusting a character's
  timing data") to a post-patch sanity check, with the suspect order made
  explicit — convention, then freeze model, then the rebuilt rotation, then buff
  uptime — and the rule that a miss never licenses editing a timing by hand; the
  remedy is a `pinnedMontage` decision with reasoning. Status recorded as
  unexecuted (no arabwuwa recordings available). The Maygi-specific line was
  generalised to "a community calculator".
- **`TIMING_SOURCES` in `sim.js` narrowed to `extracted | curated |
  estimated`.** `'imported'` and `'frame-counted'` were dead vocabulary for the
  two retired routes; leaving them accepted while the doc says they don't exist
  recreates exactly the drift that caused yesterday's bug (the set had never
  learned `'extracted'`, so 1,020 measured steps reported `'estimated'`). They
  now degrade to `'estimated'` rather than being accepted as if measured.
- **Schema block corrected to the real shape** — it still advertised
  `hits`/`cancelPoint`/`source`, none of which exist. Now `actionableAt`,
  `freezeTime`, `freezeSource`, `cooldown`, `timingSource`,
  `timingProvisional`, plus a note on what `actionable-times.json` carries that
  the sim does not consume.
- **`hitTimes` non-consumption documented** (prompted by a maintainer question
  about channelled abilities). The sim credits a step as one point event, so a
  multi-hit animation whose hits outlast `actionableAt` — Chisa's Serrated Loop
  is 14 hits over 1.86s against a 0.93s cancel — has its damage attributed to
  the buff state at the step rather than at impact. 21 of 825 keys have any
  overhang past 0.05s. **Totals are unaffected**: the game's own `"8.78%*8"`
  per-hit × count term is parsed and summed upstream (`tools/rate-match.mjs`),
  so magnitude and energy are right and only placement in time is collapsed.
  Maintainer's call: these are *pseudo*-channelled (a fixed multi-hit burst, not
  a player-held duration), so one point event is an acceptable model, not a
  missing feature. Recorded as such rather than left as an implied gap.

**Correction to the 2026-07-30 entry.** That entry claimed hold-button
classification was closed because "the game authors a hold as its own montage,
so the measured `actionableAt` already IS the hold time". That holds only where
the join **reaches** the hold's own montage (the 20 keys on
`AM_*_Hold*`/`*_Loop`). Where a hold reuses the tap's damage id nothing
separates them and the hold inherits the tap's time — Chisa's
`skill_serrated_loop_hold` (0.93s, the tap's own `AM_Skill02`), her
`forte_heavy_sawring_blitz_2_hold` / `_3_hold` /
`chainsaw_mode_dodge_counter_hold` (all on the same merged `skillRow` rows as
their taps), and Zhezhi's `skill_hold`. Five keys. The conclusion still stands —
their *damage* is modelled distinctly (the game ships separate rows, `"8.78%*8"`
tap vs `"3.76%*16"` hold), so this is a timing-resolution gap, not a missing
mechanic, and a classifier would only assert "this is a hold", which the key
name already says. What is missing is the montage, which only a pin or a better
join can supply. Qualified in place in `TIMING_MODEL.md`.

**[Verification Method]** `npm test` 57/57 files (timing-model 102 assertions,
up from 100 — two new ones asserting the retired values are *rejected*, plus one
for a retired value in a per-type default), `npm run sweep` 65/65, `npm run
lint` 0 errors. LOCK B: regenerated, and the diff is **exactly 2 lines**
(`engineHash` + `generatedAt`) — the vocabulary narrowing is behaviour-neutral
because no data artifact ever carried `'imported'` or `'frame-counted'`, which
is the point. LOCK A untouched (`preprocess.mjs` unchanged, no data rerun
needed).

**[Residual Risks]** None to output — no sim number moved. The one behavioural
change is that a `timingSource` of `'imported'`/`'frame-counted'` now resolves
to `'estimated'`; nothing in the repo produces either, and the fallback is the
conservative direction (a value gets labelled a guess, never the reverse). The
retirement is a policy choice recorded in the doc, not enforced by tooling —
`data/actionable-times.json` is generated and `timing-overrides.json` only
accepts montage decisions, so there is no field a hand-measured number could be
written into without also editing code, but nothing hard-blocks re-adding a
tier.

**[Updated Docs]** `docs/TIMING_MODEL.md` as above; the Context section's
reference to Maygi's calculator is kept (it explains why community DPS uses a
different time convention — that is context, not a sourcing route), as is the
struck-through "Explicitly out of scope" section, which is history.

---

## 2026-07-31 — Extraction rewrite: notify semantics from the shipped client, `damageAt`, DT_SkillInfo in full

**[Files Changed]** `tools/extract/scan_notify_semantics.mjs` (new),
`tools/extract/montage_timeline.py`, `tools/extract/extract_timings.py`,
`tools/extract/map-timings.mjs`, `tools/extract/TIMING-EXTRACTION-HANDOVER.md`,
`data/notify-semantics.json` (new, committed),
`data/actionable-times.json` (regenerated),
`docs/TIMING_MODEL.md` (rewritten), `docs/GLOSSARY.md`, `docs/ARCHITECTURE.md`.
**Not touched:** `src/`, `tools/preprocess.mjs`, `data/wuwa-data.json` — no sim
number moved. The maintainer supplied the live export
(`G:\Software\fmodel\Output\Exports\Client`), a full client build including the
`JavaScript/` tree, not just the `Role/` asset subset earlier work had.

**[Logic Altered]**

**1. The game's own labels are now the authority, mechanically.** The client
ships every notify class as JS with a `GetNotifyName()` returning the
designer-facing label. `scan_notify_semantics.mjs` reads all **202** classes and
records label, declared properties, and which the body actually *reads* — the
dead-property check that had already caught `AbsoluteTimeStop` declaring four
flags and reading one. This exists because name-inference has now produced
**three** wrong models, two of them mine this session:

- `TsAnimNotifyStateSoftLock` — I had claimed it was "very likely the authored
  committed window". It is 开启镜头软锁, **camera** lock-on. Gameplay-irrelevant.
- `TsAnimNotifyStateChangeSlot` — I called it a weapon/stance swap, then on
  reading the body over-corrected to "purely cosmetic, nothing to do with
  Rebecca". The maintainer pushed back and was right: the *mechanism* is a
  sub-mesh socket attach, but *which prop* is a faithful signal of a weapon
  change — Rebecca's two Intros target `WeaponProp01` (pistol/Huntress) vs
  `WeaponProp02` (shotgun/Guts), independently matching the split we had pinned
  by bullet label. Now a first-class `weapon_slot` event, 208 montages.

**2. `damageAt` / `resolvesAt` — the correct per-key damage instants.** Neither
existing field was that quantity, and they err in opposite directions.
`hitTimes` filters by notify CLASS so it collects every bullet spawn in the
montage regardless of owner (Sanhua's `skill` was handed
`forte_heavy_ice_prism_burst_damage`'s 0.3003) *and* misses bullets fired via
`SkillBehavior` / `StateBulletDuration` / `子弹id数组`, which are not role `hit`
(Sanhua's `glacier_burst` was missing its own 1.2074). `firesAt` was a scalar
off the one chosen candidate, dropping repeat fires — 373 keys have more than
one instant. `damageAt` is the intersection: fire times of the bullets carrying
this key's damage ids, restricted to the resolved montage. **883 keys**, 377
multi-instant, **312 differ from `hitTimes`**. `firesAt` is now anchored to
`damageAt[0]` so the two cannot disagree; `resolvesAt` is the last instant — the
"fully resolves absent a cancel" default made computable.

**3. `DT_SkillInfo` captured in full — 37 fields, we were keeping 5.** Most
consequential: **`StrengthCost`** is stamina (negative, ×100 — kit text "Heavy
Attack STA Cost: 20" ↔ `-2000`; Camellya's Blossom aerial basics `-500` each, and
`椿形态B普攻3-循环空中` "loop aerial" pays it per tick, which is exactly the
hold-length limiter the maintainer proposed), and **`InterruptLevel`** is the
authored commitment ranking (basics 2, dodge 6, charge-state 10 — why a dodge
cancels a basic). Also `SkillTag` (the game's own classification vocabulary),
`ToughRatio`, `BurstLockTime`, cooldown charges, buff wiring.

**4. Montage parser extended** — resolves each notify's own properties through
its objref, and emits `gameplay_tags` (1,046 timelines), `weapon_slots` (208),
`priority_changes` (641 montages), `break_points_s`, `section_count`.

**The Qiuyuan anomaly, root-caused.** His `basic_1` reported hits at
`[0.2333, 1.0]` against a kit that deals one. Neither of my two theories held:
his montage has a **single** section (so the section-flattening theory was
wrong), and it is not the enhanced-state variant either — that is a *separate*
key family, "Thus Spoke the Blade: Inkwash", on its own `AM_EX_*` montages with
the right instance counts (`30.00%+30.00%` → `damageAt [0.1667, 0.3333]`), which
the maintainer predicted from play. The real cause: the 1.0s notify fires bullet
`1411001000` 普攻-目押判定 — a just-frame **input detector** carrying no damage
ids at all. `hitTimes` counted it because it cannot see inside the notify.
`damageAt` gives `[0.2333]`.

**A regression I introduced and reverted.** The section-scoping change (from the
discarded Qiuyuan theory) restricted `derive()` to a montage's first section. It
broke Electro Rover's `forte_heavy_thrum_of_all_sounds_aero`: that hold skill
splits into Default (wind-up) / "1" (hold) / "2" (release), with the cancel
window in section 1 and `EndSkill` in section 2, so scoping discarded both and
`actionableAt` fell 0.7095 → **1.966667**, onto the `sequenceLength` fallback we
are trying to remove. Sections are *sequential phases*, not variants. Reverted;
membership is still tagged per event as context. Caught only because the diff
was checked field-by-field against the previous artifact rather than eyeballed.

**A false alarm of mine, recorded so it isn't re-investigated.** I reported that
`hit-map.json` had zero entries for Qiuyuan and flagged an untraced second join
path. There is none — the file has a `_doc`/`map` wrapper and I read the raw
object. He has 17 keys.

**[Verification Method]** Full re-extraction against the live export: 35,805
`.uasset`, 73 `DT_SkillInfo`, 60 resonators, 1,408 montages, 1,780 skill rows —
322 with stamina, 1,780 with interrupt level, 1,651 with skill tags. Join re-run.
**`actionable-times.json` diff: 0 differences in any pre-existing field across
all 1,023 applied keys — purely additive.** `wuwa-data.json` unchanged beyond
`generatedAt` (reverted), so LOCK A is clean and no sim number moved. `npm test`
57/57, `npm run sweep` 65/65, `npm run lint` 0 errors (the two new files broke
the S3.1 naming rule with 13 errors on first run; fixed). Spot-validated against
the maintainer's own 60-trial in-game measurement: Sanhua `basic_1`
`damageAt [0.2102]` against a measured cancel boundary of 210ms (reliable at
≥210ms, never at 195ms).

**[Residual Risks]** None to sim output — nothing consumes the new fields yet.
`hitTimes` is retained and still wrong for per-key damage; it is now labelled
montage-wide in three places, but a future consumer could still reach for it.
The 5 keys where a hold shares the tap's damage id remain indistinguishable in
timing (their damage is distinct). Per-character gameplay tags are frequently
hash-obfuscated (`角色.3130d70d.…`) — distinguishable but not readable, so
Rebecca's stance is legible only via `weapon_slots`. `data/timing-data.json` and
`data/bullet-timings.json` stay gitignored and regenerable only from an export.

**[Updated Docs]** `docs/TIMING_MODEL.md` **rewritten** — 290 → 170 lines
(44KB → 18KB) while adding the notify-authority rule, the full field inventory
with what is consumed vs reserve, `damageAt` vs `hitTimes`, the decoded
`NextAtt` mechanism, the per-move cancel model, and the unwired
stamina/interrupt/tag data. The chronology it used to carry (extraction bug
history, the five row-route root causes, Lucilla's name-map skew, Chixia) was
dropped only after confirming HISTORY covers each. `TIMING-EXTRACTION-HANDOVER.md`
notify table corrected for `SoftLock`, `ChangeSlot`, `ReSkillEvent`, `NextAtt`,
plus an instruction to run the semantics scanner rather than guess from a class
name. `GLOSSARY.md` gains `damageAt`/`resolvesAt`; `ARCHITECTURE.md` registers
`data/notify-semantics.json`.

---

## 2026-07-31 — Timing model phase 1: markers replace `actionableAt`; ability facts joined

**[Files Changed]** `tools/extract/scan_bullet_timings.py`,
`tools/extract/map-timings.mjs`, `tools/preprocess.mjs`, `src/core/types.js`,
`src/ui/components/build-editor/rotation.js`, `tests/timing-model.test.mjs`,
`data/actionable-times.json` (regenerated), `data/wuwa-data.json`,
`data/wuwa-meta.json`, `docs/TIMING_MODEL.md`, `docs/GLOSSARY.md`,
`tools/extract/TIMING-EXTRACTION-HANDOVER.md`.
**Not touched:** `src/core/sim.js` — the `max(nextAtt, resolvesAt)` rule is
phase 2. This change moves exactly one sim number, and deliberately.

**[Logic Altered]**

**1. `actionableAt` is gone from the extraction artifact.** It was one name over
four quantities — `StateNextAtt` (a measurement of when input is accepted),
`EndSkill`, `FightStand`, and the montage's authored length, which is not a
duration at all. The artifact now publishes the markers under the game's own
names (`nextAttAt`/`nextAttDuration`, `skillEndAt`, `idleReturnAt`,
`firstDamageAt`) plus **`stepDuration` + `stepDurationRule`** naming which rung
produced the number: **nextAtt 850, skillEnd 130, idleReturn 1, sequenceLength
42**. `cancelWindowOpensAt` was the worst of the old names — the notify is
下一个技能 and calls `SetSkillAcceptInput(true)`, so it is a *queue* gate, not a
cancel window.

That 42 corrects an earlier count of mine. I had reported "24 keys on
sequenceLength" from value-equality (`actionableAt === sequenceLength`), which
under-counts: a lead-in phase length is added to some, and the row route reads
`sequenceLength` from a different montage than its timing. Deriving the rule from
*which marker exists* gives the true figure — 42 with no terminal at all, plus 1
on `FightStand`, matching the 43 measured independently.

**2. Ability facts joined per key.** `staminaCost` (positive STA),
`interruptLevel`, `chainStage`, `switchBehavior`, `isLoop`. Row resolution is
montage-index-first with a hit-id-prefix fallback: **982 of 1,023 keys** reach a
row where the montage index alone reached 735.

Two of these are unanimity-gated, and the reason is the session's main finding.
**Stamina and interrupt level are ROW properties, and one animation is
regularly reached from several rows.** Camellya ships every Form B basic as a
ground row (0 STA) and an air row (5 STA) pointing at the *same* montage. Both
report `null` rather than a coin flip — 11 keys conflict on stamina, 24 on
interrupt level.

**3. Tap/hold collisions resolved by repeat count.** A hold and its tap carry the
same damage ids and differ only in how often the repeating one appears, so the
bullet chain hands both the same candidates and the ranking gives both the
tap's. Camellya: Vining Waltz Stage 3 is `1603103001` + `1603103003`×5, Blazing
Waltz the same pair with the tick ×18 — and the two ids split cleanly across
animations (`…001` from `AM_Attack03_Ex`, `…003` from `AM_Attack03_Ex_Loop`).
The higher-count key is moved onto the loop. Three groups exist roster-wide; the
other two (Rebecca's Huntress pair, Chisa's chainsaw pair) have no montage
candidates at all, so the rule is a no-op there rather than a guess.

**4. `montageMeta` added to the bullet scan.** Per-animation gameplay tags,
stored once per montage rather than per bullet fire. Raises switch-behaviour
coverage from 469 keys to 583. `switchBehavior` holds **windows, not flags** —
Camellya's `AM_Attack04` ends on switch only from t=1.2, not from 0.

**Corrections to claims made earlier in this session.**

- **"A looping attack pays stamina per tick"** — written into `TIMING_MODEL.md`
  last session. Struck. There is **no stamina notify anywhere in the client**
  (all 202 classes scanned for 体力/耐力/Strength); cost is charged from the row
  on cast. Roster maximum is **35 STA of 100**, so a "full pool at cast, deplete
  for this ability" model is provably a no-op. Not built; the cost is displayed
  instead.
- **"Camellya's ground spin contradicts its own description"** — wrong, and I
  had not read the kit text. It says "Using Basic Attack [Vining Waltz] and
  Basic Attack [Blazing Waltz] **in mid-air** consumes STA". Description and
  data agree exactly. The anomaly is aerial-only: the maintainer measured no
  cost in the air *and* stamina regenerating while suspended, against a row
  carrying 5 STA and an explicit `禁止体力恢复` regen-block tag. That is data
  **and** description against observation, which promotes one hypothesis —
  **the aerial rows may be dead, with air basics routed to the ground rows** —
  since it explains both halves at once. Recorded, blocked on airborne state.
- **"44 seconds of hovering to exhaust stamina"** — arithmetic on the wrong row.
  A filter of mine selected only rows with a nonzero cost, hiding the 0-STA
  ground row entirely.
- **Lumi's `forte_heavy_glare` "+7.51s"** — withdrawn. That key sits on
  `AM_Super_Sprint_F_Loop`, so its 21 instants may be one iteration.

**Loops carry no signal, so the flag is convention-based and says so.**
`AM_Attack03_Ex_Loop` has one `CompositeSection` whose `NextSectionName` is
`"None"`, and its `PositionBranchTarget` notify is 位移吸附到目标位置 — position
snapping, not an animation branch (checked precisely because the name invited
the opposite reading). The repeat is driven by gameplay code. `isLoop` therefore
reads the asset name and the row label 循环 — excluding 循环结束, which is the
loop's *exit* and was producing a false positive on Rebecca's
`AM_Attack_Hold01_S_End`. Its purpose is to refuse resolution, not to compute:
`timingIsLoop` is stamped separately from `timingProvisional` because 3 of the 4
loop keys already carry a stronger caveat that would hide it.

**[Verification Method]** `npm test` 57/57 (timing-model 102 → **115**
assertions; new block covers the marker vocabulary, rule/marker agreement, the
sequenceLength rung's confinement to keys with no terminal, damage-instant
ordering, both unanimity gates, switch windows, the tap/hold move, and that
every loop key reaching the dataset is flagged). `npm run sweep` 65/65.
`npm run lint` **0 errors**. Bullet re-scan verified **purely additive**:
`bulletDamageIds`, `bulletChildren`, `bulletNames`, `bulletTimings` all
byte-identical, plus 1,603 montages of tags. Artifact diff field-by-field
against the committed baseline: **1,023 entries, renames tracked, exactly 12
changed pre-existing values — all `skill_blazing_waltz`, all the intended move
onto the loop montage.** LOCK A: 4 changed lines — 3 keys gain `timingIsLoop`,
1 gains `timingProvisional: loop`, and `skill_blazing_waltz.actionableAt`
1.15 → 1.8634. LOCK B: 185 lines, and **all 20 moved team scenarios contain
Camellya** — fully attributable.

**[Residual Risks]** `skill_blazing_waltz` is now on the right animation but its
duration is one loop iteration, so it is still wrong — flagged, not fixed. The
kit's 18 ticks against the loop's 2-per-2.2s would imply ~20s of spinning
against a few seconds measured in-game, so the ticks are probably authored in a
`StateBulletDuration`-style notify `damageAt` does not read. Baizhi's
`heavy_heavy_attack` resolves to `stepDuration: 0` and is skipped entirely by
preprocess (pre-existing). `staminaCost`/`interruptLevel` are null on 11/24 keys
by design; a consumer must treat null as "unknown", not "zero". `chainStage`
covers 167 keys, so chain-based validation would be partial today.

**[Updated Docs]** `TIMING_MODEL.md` — field tables rewritten to the marker
vocabulary, the per-tick stamina claim struck in place (not deleted), two new
sections ("Loops and holds", "Naming a thing the game does not: ground vs air"),
and "Still open" grown to 5. `GLOSSARY.md` gains `stepDuration`/
`stepDurationRule`/`nextAttAt`/`timingIsLoop` and re-scopes `actionableAt`.
`TIMING-EXTRACTION-HANDOVER.md` §3 records that the sequenceLength rule is now
enforced structurally.

---

## 2026-07-31 — Timing model phase 2: a step costs the animation OR its damage, whichever is later

**[Files Changed]** `src/core/sim.js`, `src/core/opener.js`, `src/core/types.js`,
`src/ui/components/build-editor/rotation.js`, `tools/preprocess.mjs`,
`tools/extract/map-timings.mjs`, `data/skill-map.json`,
`tests/timing-model.test.mjs`, `tests/opener.test.mjs`,
`tests/cooldowns.test.mjs`, `tests/rotation-state.test.mjs`,
`data/wuwa-data.json`, `data/wuwa-meta.json`, `docs/TIMING_MODEL.md`,
`docs/GLOSSARY.md`, `docs/ARCHITECTURE.md`.

**[Logic Altered]**

**1. `resolveActionableAt` → `resolveStepDuration`, and it takes a max.**

```js
stepDuration = max( animationDurationOf(skillDef, dataset), skillDef.resolvesAt ?? 0 )
```

The lookup ladder underneath is unchanged (`skillDef.stepDuration` →
`_defaults.stepDurationBySkillType` → `HARDCODED_STEP_DURATIONS` → 1.0); what is
new is that the damage can outrank it.

The argument is not about realism, it is about **internal consistency with how
damage is credited.** A key applies its FULL kit multiplier every time it
appears in a rotation. Camellya's Vining Waltz: 20 damage instants at 0.12s
spacing, `StateNextAtt` open at 0.8s. Tapping into Stage 5 at 0.8s lands 5 of
the 20 hits — so charging the rotation 0.8s while paying out all 20 credits
damage nobody waited for. Either the damage shrinks or the clock grows, and the
clock is the side that is measurable. That also matches what the maintainer
observed in play: single Basic-Attack inputs "only let her spin shortly" before
Stage 5.

The consequence is that **"the action fully resolves" is now the default**,
which is what a player who is not deliberately cancelling actually does. An
early cancel becomes a distinct, explicit rotation step — and *that* is where
`DT_SkillInfo.InterruptLevel` belongs, not in the duration rule. Interrupt level
ranks what can override what; it never says when damage is safe. `resolvesAt`
does.

**2. `actionableAt` is now fully retired** — the artifact lost it in phase 1,
and this change removes it from the dataset, the engine, the UI and the curated
`skill-map.json` defaults (`actionableAtBySkillType` → `stepDurationBySkillType`).
One name had covered four different quantities.

**3. `preprocess.mjs` stamps `resolvesAt` and `stepDurationRule`** onto steps
(882 and 1,020 respectively). The dataset stays descriptive — it carries the
animation duration and the damage instants separately — and the engine applies
the policy. Nothing is baked in, so the rule stays visible and reversible.

**[Verification Method]** `npm test` 57/57 (timing-model 115 → **125**; the new
block covers the max in both directions, that a zero/absent `resolvesAt` can
never shorten a step, the unchanged fallback ladder, Camellya's spin by name,
and a roster-wide sweep asserting **0 steps shortened** and the extended set
bounded). `npm run sweep` 65/65. `npm run lint` 0 errors, and the warning count
is back at the pre-session baseline — two warnings this session introduced
(`bulletChainEntry` complexity, an `id-length` in the new test block) were
fixed rather than absorbed.

**Dataset diff, renames accounted for: 1,079 steps compared, exactly ONE
pre-existing value changed** — and it is phase 1's Camellya montage move, not
this change. The max() is applied at sim time, so `wuwa-data.json` gains
`resolvesAt`/`stepDurationRule` but no timing value moves.

LOCK B: **71 of 289 teams moved, all 71 containing a channel-key resonator, 0
unexplained.** Every time delta ≥ 0 (min +0.21s, median +6.66s, max +24.14s) and
every DPS delta negative (min −16.51%, median −4.87%, max −0.07%) — the exact
signature expected when time grows and damage is fixed.

**A measurement error of mine, caught and corrected.** The first LOCK B
attribution walked the meta by ARRAY POSITION and reported "100 scenarios moved,
max +43.26s, min **−18.27s**, best DPS **+4.08%**" — which contradicted the
just-passed test asserting no step ever shortens. The optimizer re-ranks, so
position N before is not position N after and I was differencing unrelated
teams. Re-keyed by team membership, the anomaly vanished entirely. A result that
contradicts a passing test is a bug in the measurement until proven otherwise.

**[Residual Risks]** Lumi's `forte_heavy_glare` takes the largest single
correction (0.43 → 7.94s) and sits on a `_Loop` montage; its `nextAttDuration`
is 8.07s and `skillEnd` 8.33s, so the montage is a self-contained channel rather
than a repeating iteration and the value is trusted — but it is the one to
re-check if the loop-iteration work changes that reading. The 9 affected keys
now assume the player always lets a channel finish; a rotation that
deliberately cancels one is not yet expressible, and will under-report until
explicit cancel steps exist. `resolvesAt` is absent for the 141 skillRow-route
keys, which therefore keep animation-only durations.

**[Updated Docs]** `TIMING_MODEL.md` gains a "What a step costs" section stating
the rule, its justification and all 9 affected keys by name; the two-clock
section and field tables re-worded off `actionableAt`. `GLOSSARY.md` marks
`actionableAt` retired by strikethrough with its replacement. `ARCHITECTURE.md`
updated for the renamed skill-map defaults and the artifact's field list.

---

## 2026-07-31 — Timing model phase 3: the measured facts reach the hover box

**[Files Changed]** `tools/preprocess.mjs`, `src/ui/tip-format.js`,
`src/ui/components/build-editor/rotation.js`,
`src/ui/components/build-editor/ability-overview.js`,
`tests/tip-format.test.mjs`, `data/wuwa-data.json`, `data/wuwa-meta.json`,
`docs/TIMING_MODEL.md`.
**Not touched:** `src/core/` — display only, no sim number moves.

**[Logic Altered]**

**1. Prerequisite: the display facts reach the dataset.** `stampAbilityFacts()`
puts `nextAttAt` (847), `firstDamageAt`/`damageCount`/`damageBeforeNextAtt`
(882 each), `interruptLevel` (956), `staminaCost` (969) and `switchBehavior`
(72) onto each step. `damageBeforeNextAtt` is precomputed rather than shipping
the whole `damageAt` array: the only question the UI asks of it is how many
hits land before the player can act, and two scalars answer that without
putting a 21-element array on Lumi's Glare.

**2. `formatTimingFacts()` in `tip-format.js`**, rendered at the head of all
three hover boxes — rotation palette, rotation chips, ability overview — so one
formatter owns the layout. 1,020 of 1,079 steps show a block; the estimated
remainder stays silent rather than printing rows of blanks.

Three places the maintainer's spec was deliberately not followed literally, all
agreed in planning:

- **No "Lossless Cancel after" row.** It is the same number as "Fully Resolved
  after" — you can act at `nextAttAt`, and it is lossless exactly when nothing
  is still landing. Two rows saying one thing. Replaced with the cancel **cost**
  in hits, printed only when nonzero: *"⚠ Acting there lands only 5 of 20
  hits"*. That fires on exactly the 9 channel keys.
- **The switch marker has three states, not two.** ✅ keeps resolving (default),
  ❌ `切人结束技能` with its start time, 🔒 `不能切人`. Both tags are timed
  windows, so the ❌ carries a timestamp rather than being a flag.
- **STA is shown** (160 steps) but the depletion model is not built — the roster
  maximum is 35 STA of 100, so it could not bind.

**Two correctness bugs found by reading the rendered output rather than
trusting the code.** Both were wrong in the same direction — asserting a
default as a fact:

- **Phrolova's Hecate keys claimed "✅ Keeps resolving after a switch"** on no
  evidence. They resolve through the coarse skill-row route, which recovers a
  table row and no montage, so there were never any gameplay tags to read.
  Absence of a tag only means the default *when we actually looked*. The switch
  line is now gated on the key having a resolved animation, and a test asserts
  no step makes the claim without one.
- **Lumi's Glare read "⚠ Acting there lands only 0 of 21 hits"** directly under
  "First DMG at 0.43s" — both true (`nextAttAt` 0.43, first damage 0.4349) but
  reading as a contradiction once rounded to 2dp. Total loss now has its own
  wording.

**A third overclaim, softened rather than fixed.** The loop note first read
"the times above are ONE iteration". That is right for Camellya's spin (both
instants at t=0, it repeats from the top) and wrong for Lumi's Glare (21 ticks
spread across a montage with its own 8.33s `EndSkill`, self-contained). Since
`timingIsLoop` is convention-based and only two cases exist, inventing a
discriminator from them would be the "six confirming cases" trap this project
has already fallen into once. The note now reports the uncertainty.

**[Verification Method]** `npm test` 57/57 (tip-format 25 → **38**; the new
block covers silence for estimated steps, null-safety, each row, the
single-hit/no-count case, both cancel-cost wordings, all three switch states,
the earned default, the loop hedge, plus a roster-wide pass asserting the
warning stays bounded and **no step claims "keeps resolving" without a resolved
animation**). `npm run sweep` 65/65. `npm run lint` 0 errors, **1429 warnings —
the pre-session baseline**; a complexity warning on `formatTimingFacts` (17)
was fixed by splitting out `timingLines`/`cancelCostLine` rather than absorbed.

Dataset diff against HEAD, renames accounted for: **1,079 steps compared, 10
fields added, exactly ONE pre-existing value changed** — still phase 1's
Camellya montage move. LOCK B moves only `generatedAt` + `engineHash` beyond
phase 2's already-attributed team deltas; no UI or preprocess file is in
ENGINE_FILES.

**A self-inflicted break worth recording.** A scripted replacement wrote a real
newline where `\n` was intended, producing an unterminated template literal
that took out 5 modules in the sweep and the build-editor test. Caught
immediately by the suite. The repair replaced the duplicated inline expression
with an `abilityTipDesc()` helper, so the two call sites no longer repeat it at
all — the fix left the file better than the pre-break state.

**[Residual Risks]** The block is plain text inside `data-tip-desc`, so it
inherits `formatTipDesc`'s highlighting: percentages and element names get
styled, bare seconds do not. Intentional, but a future change to `NUM_RE` would
start colouring these values. `interruptLevel`/`staminaCost` are null where the
rows disagreed (24 and 11 keys) and simply omit their row — indistinguishable
in the UI from "not extracted", which is acceptable for display but would not
be for a consumer. `switchBehavior` renders only the FIRST window of each kind;
no key currently has more than one, but a multi-window animation would show
only its earliest.

**[Updated Docs]** `TIMING_MODEL.md` gains "Ability facts — shown in the UI" with
the rendered block, the three deliberate spec deviations, and the earned-default
rule; the old field table is retitled "The underlying fields".

---

## 2026-07-31 — Timing model phase 4: chain slots from the game's own tag; team-page clock toggle

**[Files Changed]** `tools/preprocess.mjs`, `src/core/rotation-graph.js`,
`src/ui/components/build-editor/rotation.js`,
`src/ui/components/team-editor-v2.js`, `tests/stage-grants.test.mjs`,
`tests/team-editor-v2.test.mjs`, `data/wuwa-data.json`, `data/wuwa-meta.json`,
`docs/TIMING_MODEL.md`.

**[Logic Altered]**

**1. Chain slots (P4).** Rotation validation reads a stage off the KEY NAME
(`basic_3` → stage 3), which is blind to any ability occupying a chain slot
under a different name. The game tags every one of them, and `chainStage` now
reaches the dataset on the **41 keys whose own name carries no stage number**.
`rotation-graph.js` treats such a key, once cast, as having filled that slot.

Sanhua's dodge counter is `普攻2` and Yinlin's is `普攻3`, so
`basic_dodge_counter → basic_3` and `→ basic_4` are legal chains that both
warned before. Per character, authored, no curation table to keep in sync. The
legalization emits a `chainTag` chip naming the contributing step — the file's
existing rule is that every legalized entry says WHY, and a silent one would
have broken it.

Three limits, all deliberate and tested:

- **The key name wins where both exist.** Ours is the canonical numbering and
  the tag can mean something else: Jiyan's three Liberation lances are *all*
  tagged `普攻4`, and Rover: Havoc's `basic_4`/`basic_5` are tagged 2 and 3.
  Those are the only 5 disagreements and applying the tag would be wrong in
  every one.
- **The tag never fabricates a cast** — `basic_3` alone still warns.
- **It fills exactly one slot** — `basic_dodge_counter → basic_4` still warns.

**2. Team page: openers OFF by default.** Maintainer call. Derived openers pad a
Liberation the gauge cannot cover with real filler casts — the honest cold
start, but it makes the headline number answer a different question than the
rotation the user wrote. The chip still turns it on.

**3. Team page: GAME TIME / REAL TIME toggle.** `timingMode` was a
`simulateTeamRotation` parameter with no UI; it now has one. GAME TIME (default)
excludes Liberation freeze from the DPS denominator — the ToA convention
community figures use — and REAL TIME is wall-clock.

The DURATION chip had to change with it. It always showed `totals.time`, so
flipping the clock would have moved DPS while duration sat still, reading as a
bug. It now shows the number DPS actually divides by and names which clock
(`DURATION · GAME (41.2s REAL)`), so the wall-clock figure is still visible.

**[Verification Method]** `npm test` 57/57 (stage-grants 287 → **294**,
team-editor-v2 108 → **114**). New assertions cover both legalizations, the
chip and its source, the per-character slot, and all three limits above, plus
the openers default, the new toggle, and the duration label. `npm run sweep`
65/65. `npm run lint` **0 errors, 1429 warnings — the pre-session baseline**.
LOCK A: 1,079 steps compared, `chainStage` on 41, **still exactly one changed
pre-existing value** (phase 1's Camellya move).

**Two measurement errors of mine, both caught here.**

- I reported "the reference rotations carry 2 sequence warnings" from a probe
  that omitted `resourceDefs`/`stateDefs`. With the full context they were **0**
  before this change and 0 after — the two entries are legalized by curated
  resources and states. The test asserts 0 as a no-regression guard, and the
  claim that the tag "fixes" shipped rotations is withdrawn: its value is in
  user-authored chains, which is where the two demonstrated fixes live.
- I built a `chainSlotsFromTags` index, then implemented the fill inline and
  left the index dead. ESLint caught it as an unused variable. Removed, and the
  explanation folded onto `chainSlotOf`, the helper actually used.

**A refactor the lint ratchet forced, and it was the right call.** The two
title-row chips repeated the same four-way active/inactive style ternary,
pushing `renderTitleRow` and `renderTotalsBanner` over the complexity limit. A
shared `toggleChip()` and a `durationChipParts()` helper fixed both and mean the
OPENERS and clock chips cannot drift apart visually.

**[Residual Risks]** `chainStage` is stamped from the montage the timing join
resolved to, so a key whose chosen montage belongs to a different stage than the
ability would inherit that stage — the Rover: Havoc offset (`basic_4` tagged 2)
is likely exactly this, and it is only invisible because the key-name rule wins
there. Chain slots cover 41 keys; families with no tagged member behave exactly
as before. `timingMode` is per-session UI state, not persisted with the team, so
it resets to GAME TIME on reload.

**[Updated Docs]** `TIMING_MODEL.md` gains a "Chain slots" section with the rule,
the two worked examples and all three limits; the `chainStage` field row now
states the 167-vs-41 split.

---

## 2026-07-31 — Team page: the clock toggle drives the whole page

**[Files Changed]** `src/ui/components/team-editor-v2.js`,
`tests/team-editor-v2.test.mjs`. No engine, no generated data — UI only, and
`git diff data/` is empty.

**[Logic Altered]** The GAME TIME / REAL TIME chip previously changed only the
DPS number. Everything time-shaped on the page now moves with it, because a
toggle that shortened the DPS divisor while the timeline kept its length made
the page contradict itself.

`clockFor(segBySlot, totals, isGame)` maps real team time onto the displayed
clock by removing each Liberation's freeze, **credited at the step's END** so
the mapping agrees with `sim.js`'s `deriveGameTimes` at every boundary. It is a
pure function taking the segment map, so it is testable without a mounted page;
`displayClock()` is the thin wrapper that reads `api`.

What now follows the clock: the timeline **axis** and its tick labels, the
**segment bars** (with the real span named in their tooltip when the two
differ), the **buff strips** — which share the axis, so a buff would otherwise
drift off the cast that granted it — and on each resonator card, a **per-step
timestamp** and the **DPS tile**, whose divisor is that member's own on-field
seconds minus their own freeze. Stack bands inside a strip are stored as
fractions OF the strip, so they ride along untouched.

The step bars carried no timestamp at all before, which is precisely why a
clock switch was invisible on the cards. They now show `12.4g` / `12.4s`, and
the tooltip names both clocks plus the frozen seconds when they diverge.

**[Verification Method]** `npm test` 57/57, team-editor-v2 114 → **135**.
`clockFor` is unit-tested against a synthetic 2s freeze: identity under REAL
TIME, the freeze credited at the step end, monotonicity, no negative output,
per-member freeze attributed only to its own slot, and the no-freeze case
collapsing to the identity. The smoke test drives the toggle through the real
click handler and asserts the chip, the duration label, the DPS tile label and
the timestamp suffix all flip together. `npm run sweep` 65/65. `npm run lint`
**0 errors, 1429 warnings — the baseline**; five warnings this change
introduced (two complexity, three id-length) were fixed, not absorbed.

**A test that would have lied.** My first version asserted "the timeline axis
actually moves" after the toggle, and it failed — the smoke fixture's rotation
is the first three skill keys of the first resonator with a skill map, i.e.
three basics with no Liberation, so nothing freezes and the two clocks are
*correctly* identical. Rather than bend the fixture, the smoke test now asserts
the layout is UNCHANGED when nothing freezes (a real property) and the moving
case is covered against `clockFor` directly, where a freeze can be arranged.

**[Residual Risks]** Within a frozen step the axis compresses at that step's
end rather than continuously, matching `deriveGameTimes` but meaning a bar
spanning a freeze is drawn slightly shorter than a continuous model would give.
The energy chart still plots real time; it takes `totals.time` directly and was
out of scope. `timingMode` is per-session UI state, not persisted with the team.

---

## 2026-07-31 — Stat weights: all three scaling ratios, kit-average fallback, and zero-value stats that say why

Maintainer manual testing reported four symptoms, then a fifth. **The first four
turned out to be correct behaviour** — the maintainer's own conclusion — and none
came from the timing work (`live-weights.js`, `stat-priority.js`, `storage.js`
and `app.js` were last touched by S3/S4 and P13, not by
`a28162f`/`85c0ea5`/`5f2d4fc`). What that established is that several correct
behaviours are *unreadable*. **The fifth was a real defect**, found on
Cartethyia.

**[Files Changed]** `src/core/live-weights.js`,
`src/ui/components/build-editor/stat-priority.js`, `stats-panel.js`,
`tools/optimize/sim-eval.js`, `tests/live-weights.test.mjs`,
`tests/build-editor-v2.test.mjs`, `data/wuwa-meta.json`,
`data/data-version.json`.

**[Logic Altered]**

**1. The weight set assumed ATK scaling.** Maintainer-reported: Cartethyia's
damage scales off HP, the sim computes that correctly (adding HP raises the
displayed damage), yet HP% got no weight at all. `SUBSTAT_SET` listed only
`atkRatio` of the three scaling ratios, so her panel showed **ATK% at zero and
no HP% row whatsoever** — the worst possible pair, since it actively suggested
the wrong stat's absence was the whole story.

A kit scales off whatever `relatedProp` its damage rows name
(`skill.js SCALING_BY_PROP`), and a roster sweep found **seven resonators mostly
or entirely off-ATK**: Cartethyia 100% HP, Yuanwu 90.9% DEF, Taoqi 85.4% DEF,
Shorekeeper 79.6% HP, Suisui 67.6% HP, Baizhi 65.9% HP, Mornye 53.0% DEF. Adding
`hpRatio`/`defRatio` puts HP% at the **top of Cartethyia's ranking (normalized
100, above every DMG bonus)** and leaves ATK%/DEF% reporting `noScaling`.

Nothing is hardcoded as junk: the perturbation MEASURES each ratio, so HP% ranks
first on Cartethyia and reports a measured zero on Carlotta by the same rule.
`substatKeyOf` consequently stops calling HP%/DEF% off-stats, which also fixes
the echo editor's recommendation badges and the per-echo headroom callout for
those seven.

`src/core/substat-allocate.js` already included all three ratios
unconditionally, with a comment saying why — so suggested and team-recipe builds
were never affected, and `live-weights.js` was simply out of step with a rule
the project had already settled. `tools/optimize/sim-eval.js` had the same gap
and is fixed for consistency; every meta-covered anchor is ATK-scaling, so
`npm run meta` produced **505 added lines, all `"hpRatio": 0` / `"defRatio": 0`,
zero existing values changed and `engineHash` unmoved** — measured zeros, in a
vector that already stores zeros for `dmgBonus.heavy`/`energyRegen`.

**2. An empty or broken rotation is ranked against the resonator's KIT.**
Maintainer-directed. A stat's per-roll value can only be read off something
being cast, so `liveSubstatValues` returned null whenever the build's rotation
dealt no damage — a blank panel exactly when a new build most needs guidance.

Two measures now exist behind one interface (`MEASURES`): `rotation` (total
damage over the user's own rotation) and `kit` (**mean expected damage per hit
instance across every curated ability, one cast each** — no rotation, no
timing). `measurableBuild()` picks the kit only when the rotation deals nothing,
and reports which via `measure`; the perturbation loop then uses that same
function for the injected builds, so a gain is always denominated consistently.

The kit measure is `strips.js`'s `abilityAverages().overall` — the **OVERALL AVG
cell in the sticky top bar** — and that identity is now asserted, not merely
intended: **56 of 56 resonators match to 1e-9** once `liveAnalysis()` passes the
page's own `makeDmgTarget()` instead of the module default.

Chosen over standing in a curated reference rotation (the first attempt, since
reverted): it needs no curation, so it covers all 56 including the three with no
reference rotation (Suisui, Rover: Electro, Yangyang: Xuanling); it describes
the resonator rather than someone's plan for it; and it is a number already on
screen. **The user's own rotation always wins** the moment it produces damage —
the test is whether the rotation DEALS DAMAGE, not whether it parses, so a
half-built or invalid rotation takes the same fallback while a partly-broken one
that still hits does not.

A build with no echoes gets one seeded slot, since `injectRoll` needs somewhere
to put the synthetic substat. **`cost: 0` is load-bearing**: `echo-rules`
auto-derives a sub-main only for costs 1/3/4, so a 1-cost slot silently added
456 flat HP and pushed four HP scalers (Baizhi, Cartethyia, Shorekeeper, Suisui)
1.6–2.8% off the strip's figure. Cost 0 contributes exactly nothing, which is
what took the match from 52/56 to 56/56.

Both the measure and the seeded slot are stated on screen (`⚡ live · kit
average`, a banner naming OVERALL AVG, and a footnote that switches between
"extra average damage per hit" and "extra rotation damage").

The empty-build APPLY SUGGESTED BUILD card had to be re-ordered rather than
displaced — weights render for empty builds now and would have hidden the offer
that fills the build in. A covered character on an empty build gets **both**,
suggestion first.

**3. A stat worth exactly zero is reported, not dropped.** `formula.js` clamps
crit rate at 1, so past the cap another roll buys nothing, and every zero-gain
stat used to be filtered out. A row that disappears is indistinguishable from a
row the app failed to compute — which is how it was read. Reproduced on
Aemeath's team build: 97.80% sheet crit rate, row present at +2%, **gone** at
+3%, because the cap is decided *per hit with buffs applied*, not against the
sheet. Every rollable substat is now listed with a `zeroReason` code
(`'critCap' | 'noScaling'`) that the core sets and the UI phrases;
`critCappedShare()` measures the damage-weighted share of clamped hits off
`breakdown.critRate >= 1`. The CRIT RATE stat tile carries the same warning —
that tile shows the *stowed* value and is where the contradiction is read.

**4. `liveAnalysis()`'s silent `catch` logs.** A thrown sim used to render
identically to an unfinished build.

**Reverted before landing.** An earlier pass restored the build page's SAVE
button — `d4b7cbf` (2026-06-28) deleted its markup and left the click handler
behind — and made SAVE clear `template:true` so a saved suggestion stops being
hidden by `listBuilds()`. Maintainer call: the button is decorative next to the
debounced autosave, so both were reverted. **The underlying facts stand as open
UX items:** `data-act="save-build"` is still an orphaned handler, and a build
materialized from a team suggestion is still invisible in My Builds until
`SAVE TEAM` on the team page clears the flag.

**[Verification Method]** `npm test` 57/57 (live-weights 21 → **43**,
build-editor-v2 81 → **99**). New coverage: the kit fallback for an empty
rotation, a damage-less rotation, no echoes and a blank build; that a
partly-broken rotation which still deals damage is NOT replaced; that the kit
base is a per-hit average an order of magnitude below a rotation total; the
**kit-base ≡ OVERALL AVG identity across Carlotta + three HP scalers**; that the
three resonators without a reference rotation rank like everyone else; both
header/footnote wordings; the suggestion card staying above the ranking; the
crit cap forced by flooding an echo; the three zero-row wordings; and
`renderStats()` with and without the cap note. Scaling coverage is asserted on
the resonators themselves, not just Cartethyia: HP% top-ranked and ATK%/DEF%
`noScaling` for her, HP% > ATK% for Shorekeeper/Suisui/Baizhi, DEF% > ATK% for
Taoqi/Yuanwu/Mornye (a DEF set an HP-only fix would have missed), and the
converse measured zeroes on Carlotta. `npm run sweep` 65/65.
`npm run lint` **0 errors, 1427 warnings — two BELOW the 1429 baseline**, zero
new: the warnings this work introduced were removed by extracting
`energyRegenLineHtml`, `suggestionLabels`, `suggestedBuildCardHtml`,
`frozenPanelHtml`, `measurableBuild`, `rotationMeasure` and `kitMeasure`, which
also retired `statPriorityPanelHtml`'s long-standing complexity-31 / 114-line
pair. Kit path costs **0.9 ms** per full recompute (eleven measures), and
`liveAnalysis()` memoizes on build identity.

**LOCK A** clean — `wuwa-data.json` moved only its `generatedAt` (the manifest's
`"data"` content hash `24d136be371d` is unchanged), so it was reverted;
`data-version.json` keeps its new `meta` hash for cache-busting. **LOCK B** is
the 505 zero entries described above and nothing else. `live-weights.js` is not
in `ENGINE_FILES`, so `engineHash` correctly did not move.

**A free LOCK B.** An accidental `import` of `tools/optimize.mjs` in a probe ran
the optimizer; it reproduced `wuwa-meta.json` byte-identically apart from
`generatedAt`, independently confirming the meta committed in `85c0ea5`.

**[Residual Risks]** `liveSubstatValues` can still return null in principle (a
resonator with no skill map, or a kit that resolves to no hits) — no resonator
in the current roster does, so the "nothing to sim yet" panel is now unreachable
in practice and untested against real data. The kit average weights every
ability equally per hit, which is not how a rotation weights them: it is a
description of the resonator, not a prediction, and a stat that only matters
inside a specific rotation will rank lower than it deserves until the user
writes that rotation. Passing the page's `dmgTarget` into the weights changed
their absolute magnitudes (element-0 hits now sit at 0 RES while 1–6 take the
panel's value); only the ranking is displayed, so nothing visible moved, but a
future consumer of `base`/`gain` should know they are target-dependent. Flat
ATK/HP/DEF rolls are still excluded from the weight set — consistently for all
three scaling types, but a user rolling flat HP on Cartethyia still gets no
credit for it in the per-echo headroom figure. `scalingStat` is never consulted:
the ratios are ranked by measurement, so a kit with mixed scaling (Baizhi, 66%
HP / 34% ATK) correctly gets BOTH ratios ranked rather than one declared
canonical — which is the right behaviour but means the panel no longer implies
a single "your" scaling stat.

**[Updated Docs]** This entry. No invariant changed, so `CLAUDE.md` is untouched.
