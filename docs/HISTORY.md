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
