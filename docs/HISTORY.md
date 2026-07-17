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
