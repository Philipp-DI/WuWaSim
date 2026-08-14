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

---

## 2026-07-31 — OPEN-ITEMS #2: the non-energy resource-gauge engine

Three increments, three commits. The handover plan
(`docs/plans/GAUGE-ENGINE-PLAN.md`) framed this as "the engine gap is one
missing stack SOURCE in `scaleEffect`; the real blocker is gauge data." Both
halves turned out to be wrong in an instructive way, and the plan doc now
carries a correction header.

**The root cause was one step upstream of the resolver.** The game states a
stack's CAP and its GAIN TRIGGER in the sentence that GRANTS the stack, while
the per-stack VALUE lives in a later "Each stack …" sentence:

> "When casting Resonance Skill Antique Appraisal, gain 1 stack of Sky Blue,
> **stackable up to 4 times**, lasting for 7s. **Each stack** increases Youhu's
> Crit. DMG by 15%."

`tools/preprocess/effects.mjs` matched `MAX_STACKS_RE` against the *clause* that
tripped `COND_STACK_RE` — the second sentence — so it never saw either. That is
why 11 of 14 stackable effects shipped `maxStacks: null` and 13 shipped an
`unknown` stack trigger. Reading the whole description took real caps from
**3 → 13 of 14** and resolvable triggers from **1 → 3**, with no new data files.

**And the data blocker was much smaller than stated.** Of the four kits the
backlog names, only **Changli** is gauge-driven at all. Hiyuki cannot prove the
increment: her S3.1/S6.0/S6.1 are not `stackable` effects but threshold GATES
("At 2 stacks of Snow Rust"), so `scaleEffect` is never invoked for them — and
Snow Rust is a **team-composition counter** ("each Resonator can trigger this
effect only once"), unrelated to the channel-2 gauge `forte-data.json` holds for
her. Classifying all 13 pinned effects by their actual stack SOURCE found nine
distinct mechanisms, only one of which is a resource gauge.

**[Files Changed]** `tools/preprocess/effects.mjs` (`MAX_STACKS_ALT_RE`,
`STACK_GAIN_RE`, `TEAM_ACTOR_RE`, `descStackCap`, `descStackGain`);
`src/core/rotation-resources.js` (new); `src/core/buffs.js`, `sim.js`,
`build.js`, `types.js`, `rotation-graph.js`, `rotation-rules.js`;
`src/ui/components/build-editor/rotation.js`, `bind.js`;
`data/effect-overrides.json` (1205, 1306, 1510, 1610); new tests
`stack-metadata.test.mjs` (106) and `rotation-resources.test.mjs` (61), plus
`stackable-effects.test.mjs` (17 → 70) and `build-editor-v2.test.mjs` (99 → 109).

**[Logic Altered]**

1. **Inc. 1 — description-scoped stack metadata.** Both resolvers refuse to
   guess: two different caps in one description returns null, and a gain trigger
   is accepted only when ONE identifiable skill type, cast by the wielder, grants
   the stack. That rejects Sigrika (teammates are the actor), Galbrena (eleven
   skills listed), Lynae (two income rates) and Phrolova (not a cast) — each of
   which is a real source the sim cannot derive, so each stays honestly unknown.
   A percentage ceiling is deliberately **not** read as a stack count: deriving
   one from the other was measured 1-of-5 correct across the roster. Three
   curated overrides cover what text alone settles — Augusta's cap declared on a
   sibling node, Luuk Herssen's `perStack` 1.20 → 0.40 (where `pctNear` captured
   the "up to 120%" ceiling as the per-stack value), and Yangyang: Xuanling's
   two caps.
2. **Inc. 2 — the `maxStacks` ceiling fallback is gone.** Once inc. 1 made caps
   real, `maxStacks ?? 1` flipped from a conservative guess into a large silent
   assertion — nine effects jumped to their ceiling, and Lynae's Premixed Hue is
   55% per stack to a cap of 25, i.e. +55% vs **+1375%** Spectro DMG on a number
   the app cannot derive. `scaleEffect` now resolves the user's count → a gauge →
   a `castMatch` trigger → else ONE stack flagged `stacksUnknown`, and every
   scaled effect reports `stacks` + `stacksSource`. New persisted
   `build.effectStacks` and a build-editor stack stepper make the assumption
   visible and correctable.
3. **Inc. 3 — the gauge itself.** `computeResourceTimeline` gives the per-step
   ENTERING level per gauge; `rotation-graph.js`'s private copy is deleted and it
   calls the shared version, so a gauge-scaled buff and a gauge-gated rotation
   warning can never disagree. A `resource` stack trigger reads the level.
   Changli's Enflamement is curated from her own Forte Circuit text (cap 4, +1
   per True Sight Conquest/Charge, +4 per Liberation, all consumed by Flaming
   Sacrifice). Her Secret Strategist was entirely OFF (trigger `unknown`) and now
   scales her True Sight casts by the stacks she actually holds: **+0% / +5% /
   +10%** across her reference rotation, off on True Sight Capture, off on
   Liberation. Required a new **`thisCast`** window — `persist`'s castMatch check
   reads strictly EARLIER steps, so it would miss the very cast the buff is for
   and then apply to every step after it. Curated-only; the parser never emits it.

**[Verification Method]** `npm test` **59/59** (two new files), `npm run sweep`
66 modules, `npm run lint` **0 errors** (the CI gate) at 1435 warnings vs a 1427
baseline — the eight new ones are complexity warnings on new functions, in line
with every neighbour in the same files.

**LOCK A** moved only the intended stack fields. **LOCK B** three times:

- *Inc. 1* — exactly one character, **Jinhsi**, stat weights only; teams block
  byte-identical; `engineHash` unchanged (no engine file touched). S0–S2 flat,
  S3+ down ~16%, precisely where S3.0 unlocks. Cause: her stack count is now the
  count of Intro casts in her rotation (**1**) instead of a flat-credited ceiling
  (2) — +25% ATK where it used to assume +50%.
- *Inc. 2* — `generatedAt` + `engineHash` ONLY, no value moved. All nine reverted
  effects belong to resonators outside the six P12 anchors.
- *Inc. 3* — attributed **by team membership, not array position** (the mistake
  this project has made twice): 48 of 50 anchors byte-identical, 2 reordered
  (Chixia, Aemeath) with **no membership change anywhere**. Of 45 teams whose DPS
  moved, **all 45 contain Changli and not one without her moved** — median 0.11%,
  p90 0.16%, max 0.25%. Both reorderings are a Changli team crossing an unchanged
  neighbour.

**[Residual Risks]** **Yangyang: Xuanling IH0.0 (1–3 Havoc Bane stacks) and
IH0.1 (4–6) are mutually exclusive branches of one piecewise function, but the
resolver applies both** — a real double-count, bounded now by caps of 3 but not
resolved; the fix is the `enemy-status.js` wiring, not a cap. `thisCast` is
evaluated only where the ctx carries `stepKey`/`stepTypes`, which today means
`sim.js`; any future caller that resolves effects without a current step will
see such effects as OFF (conservative, but silent). `descStackGain` accepts a
gain clause naming one skill type — a kit that grants stacks from one skill and
states a second skill phrase incidentally in the same sentence would resolve
wrongly; none in the current roster does, and the multi-phrase guard rejects the
ambiguous shape. Phrolova's Aftersound keeps `maxStacks: null`: "Obtain 10 stacks
upon entering battle" is a floor, and whether 10 is also the cap is not settled
by the text, so it was left for the stepper rather than guessed. Eight effects
remain underivable by design and are only as accurate as the count a user types.

**[Updated Docs]** This entry; `docs/OPEN-ITEMS.md` #2 struck through with the
corrected landscape and a by-cause list of what remains;
`docs/plans/GAUGE-ENGINE-PLAN.md` given a STATUS header recording both
corrections and the answers to its three open questions (plan body preserved);
`docs/ARCHITECTURE.md` §4 gains `thisCast` and a "a stack count has exactly one
source, and says which" bullet; `CLAUDE.md` gains two invariants (underivable
stacks resolve to ONE and say so, never `maxStacks`; stack cap + gain trigger are
description-scoped) and the `effectToggles` row is renamed to the effect-slot key
format it actually describes.

### Addendum, same day — increment 4: gauge caps come from the game, not a regex

The maintainer restated the standing goal (now
`memory/project-north-star.md`): the sim mirrors in-game behaviour, is
data-driven where possible, parsers minimize simple regex checks, and app code
stays readable. Increment 1 had gone the other way — it *added* three regexes to
recover stack caps and gain triggers from kit text. This addendum takes back the
part the game actually answers.

**What the four committed BinData dumps can answer.** `baseproperty.json`
declares `SpecialEnergy{N}Max` for every channel a resonator owns. Changli's
Enflamement is `SpecialEnergy1Max = 4` — the exact number increment 3 had
hand-curated. Youhu's Sky Blue is `SpecialEnergy2Max = 4`, matching the
"stackable up to 4 times" the regex read. And Lynae's Lumiflow is
`SpecialEnergy2Max = 120`, exactly the "when Lumiflow is at least 120 points"
gate her kit states — a gauge the plan had listed as having no data at all.

None of the three reach `extract-forte.mjs`'s existing output: its Forte-channel
selection requires per-hit income and a cap ≥ 10, which is the right rule for
picking the ONE bar a rotation runs on and the wrong one as a filter on what
gauges exist. So caps now ship separately and unfiltered, for all 56 resonators.

**And what they cannot.** Gauge INCOME for a named stack gauge is not in these
dumps, and this was verified rather than assumed: all 40 of Changli's damage
instances are present in `damage.json` and every one carries `SpecialEnergy 0`;
`skill.json` has no energy field at all, only a `BuffList` of ids into a Buff
table none of the four dumps contain. So the channel↔name link and the gains
stay curated, and that boundary is now documented where the curation lives.

**[Files Changed]** `tools/extract-forte.mjs` (emit `_specialEnergyCaps` for the
whole roster), `tools/preprocess.mjs` (skip `_`-prefixed keys; stamp
`resonator.specialEnergyCaps`), `src/core/rotation-rules.js` (`channel` on a
gauge def; `resourceDefsForResonator(id, dataset)` resolves the cap from the
game), `src/core/sim.js`, `src/ui/components/build-editor/rotation.js`,
`tools/optimize/reference-build.js` (thread the dataset),
`tests/rotation-resources.test.mjs` (61 → 71), `data/forte-data.json`,
`data/wuwa-data.json`, `data/wuwa-meta.json`.

**[Logic Altered]** A curated gauge declares `channel`, and its cap is taken
from `SpecialEnergy{channel}Max` at resolve time; the curated literal remains as
the offline fallback for callers with no dataset and is **test-asserted equal to
the game's number**, so it cannot silently drift. The test also spot-checks the
extraction independently against two numbers stated in kits (Youhu's 4-stack Sky
Blue, Lynae's 120-point Lumiflow gate).

**[Verification Method]** `npm test` 59/59, `npm run sweep` 66 modules,
`npm run lint` 0 errors. **LOCK A**: `wuwa-data.json` moved only `generatedAt`
plus the new `specialEnergyCaps` blocks — every other value byte-identical,
which is the proof that resolving the cap from data yields the same 4 the
literal held. **LOCK B**: `generatedAt` + `engineHash` only, no value moved.

**[Residual Risks]** The `resource → channel` link is still hand-written; a
wrong channel would silently pick another bar's cap, and only the equality test
against the curated literal would catch it — which is a real guard, but both
sides are authored by the same hand. Lynae's Lumiflow is now identified from
data but deliberately still unmodelled: Premixed Hue accrues 1 stack/s while the
bar is full, and a real-time tick is outside the per-cast income model.
Identified is not modellable. The regexes increment 1 added are unchanged for
gain triggers, because no dumped table carries that fact.

**[Updated Docs]** This addendum; `CLAUDE.md` gains a "gauge caps come from the
GAME" invariant that also records what the dumps cannot answer;
`docs/plans/GAUGE-ENGINE-PLAN.md` gains an increment-4 section answering its own
increment-2 question (BinData half-answers: caps yes, income no).

### Addendum 2 (2026-08-01) — the ConfigDB cross-check

The maintainer pointed at a full FModel client export and asked for a proper
cross-check, with the standing caution that our third-party data is sound but
its *wiring, wording and pathing* may mislead. That was the right instinct: the
four `data/bindata/*.json` dumps everything above reasoned from are **four
tables out of ~500** the client ships.

`Content/Aki/ConfigDB/db_*.db` are SQLite files holding FlatBuffers blobs, and
the client ALSO ships one JS accessor per table spelling out each field's vtable
offset, read type and default. So nothing needs reverse-engineering —
`tools/extract/configdb.py` (new) parses the accessor and decodes the table.
Full survey in `docs/CONFIGDB-RECON.md`.

**What this overturns from Addendum 1.** "Income for named stack gauges is not
in the dumps" was true but incomplete: it isn't in the four dumps because it
lives in `db_buff`, a table we never had. `db_buff` also carries
**`StackLimitCount`** — an authoritative per-buff stack cap, 1,452 buffs of
which stack past 1 — which is the data-driven answer to the kit-text cap regex
increment 1 added.

**What was verified and shipped.** `AbnormalDamageConfig` is the LevelModifier
term `enemy-status.js` had reverse-engineered as the single constant **3674**
from three worked examples. The game's table reads **exactly 3674 at level 90**,
supplies the whole curve (11 at level 1 → 4082 at level 100), and is
**identical across all six elements at every level** — which converts that
file's "ASSUMED to also hold for other inflicters until disproven" into a
confirmed fact. The engine had been applying the level-90 number at every level;
it now reads the curve.

**[Files Changed]** `tools/extract/configdb.py` (new, reusable ConfigDB reader),
`tools/extract/extract_abnormal_damage.py` (new), `data/abnormal-damage.json`
(new, committed extraction output), `tools/preprocess.mjs` (fold it into the
dataset), `src/core/enemy-status.js` (`nsLevelModifier`), `src/core/team-sim.js`
(pass the dataset), `tests/enemy-status.test.mjs` (44 → 56),
`docs/CONFIGDB-RECON.md` (new), `docs/OPEN-ITEMS.md` (#25, #26).

**[Verification Method]** `npm test` 59/59, `npm run sweep` 66 modules,
`npm run lint` 0 errors. **LOCK A**: `wuwa-data.json` moved only `generatedAt`
plus the new `abnormalDamage` block. **LOCK B**: `generatedAt` + `engineHash`
only — no value moved, because level 90 resolves to the same 3674 either way.
The test pins both halves: identical at 90, and scaling by exactly the table
ratio (1005/3674) at level 70.

**[Residual Risks]** Only `glacio_chafe` is mapped to the abnormal-damage curve;
Tune Rupture/Strain keep their calibrated 716.22, which is a different mechanic
and is NOT in that table. Whether the LevelModifier is indexed by the
inflicter's level or the target's is inferred from the formula's existing
`atkLv` argument, not proven — at the standard level-90-vs-90 target the two are
indistinguishable. Newer buff rows carry hashed tags rather than readable
Chinese, so name-matching will not scale across the roster; the id-prefix
convention will.

**[Updated Docs]** This addendum; `docs/CONFIGDB-RECON.md` (new — the survey and
how to read any table); `docs/OPEN-ITEMS.md` gains #25 (Havoc Bane's max stacks:
`enemy-status.js` says 3, Yangyang's kit says 4–6, and `team-sim.js` clamps to
the 3 so her IH0.1 branch is unreachable — an internal contradiction independent
of the export) and #26 (the ConfigDB itself as an unexploited source).

### Addendum 3 (2026-08-01) — chain→buff resolved, stack bands, partial consumption

Three things, after the maintainer corrected two of my readings.

**The chain→buff join, resolved.** My "ResonantChain.BuffIds lands on unlock
markers" was a misreading. The maintainer's clarification — *the resonance chain
is a skill tree, and once a node is unlocked its description is PERMANENTLY in
effect* — is exactly what the data says: the node's buff IS the effect, held
forever, and it reaches the working buff through `ExtraEffectParameters`.
Jinhsi S3 walks `1304900300` → `1304900302`, which reads:

```
GameAttributeID 7 (Proto_Atk)   ModifierMagnitude 2500 (= 25%)
StackLimitCount 2               DurationMagnitude 20.0s
ApplicationTagRequirements ['角色.R2T1JinxiMd10011.共鸣.共鸣3']
```

— the stat, the per-stack value, the cap AND the duration, gated on the S3 tag.
**Four of the eight stackable chain effects resolve exactly**, matching what our
parser derived from prose on every field: Youhu S6 (critDmg/0.15/4/7s), Encore
S1 (Fusion DMG/0.03/4/6s), Encore S6 (atkRatio/0.05/5/10s), Jinhsi S3
(atkRatio/0.25/2/20s). `GameAttributeID` is also the same enum as our `propId`
space — 22–27 are `DamageChangeElement1..6`, independently confirming the
CLAUDE.md element-node mapping. The other four reach no stat buff (their
semantics sit further along `SkillAction`), so this is a validation layer, not
yet a parser replacement.

**Havoc Bane: our base cap was right, and I was wrong to doubt it.** The
maintainer's recollection — a general debuff cap that specific kits supersede —
is exactly the mechanic, and the kit text is explicit: **Yangyang: Xuanling S3**
raises it *herself*: "increase the maximum Havoc Bane stacks on targets within a
certain range **by 3**, lasting 20s." So `havoc_bane: maxStacks: 3` is correct
and the 4-6 band is chain-gated at S3+. The same shape recurs across the roster:
Cartethyia S2 (+3 Aero Erosion), Suisui (+3 Electro Flare), Aemeath S6
(Fusion/Rupturous Trail) — a general **cap-raise** mechanic we do not model
(OPEN-ITEMS #25, rewritten).

I also have to retract the "double-count" I claimed in increment 1: the pair was
not double-counting, it was **entirely inert**. `persist` + `trigger: unknown`
resolves to OFF, so Yangyang's amplify never applied at all.

**[Logic Altered]**

1. **`stackBand` on an effect** (`buffs.js scaleEffect`): one branch of a
   piecewise per-stack function. Yangyang ships 10%/stack at 1-3 stacks and
   12%/stack at 4-6 as two effects; outside its band a branch contributes
   nothing, so exactly one is ever live. The band is tested against the RAW
   count and gates applicability; `maxStacks` then caps the VALUE — two
   different limits that must not collapse, since capping first would pull a raw
   4 down to 3 and wrongly light the 1-3 branch. Both stated ceilings now
   reproduce exactly: 10%×3 = **30%**, 12%×3 = **36%**.
   Their window becomes `always`/`trigger: none` because **the condition IS the
   band** — the effect applies whenever the target holds a count inside it.
   With the stack stepper the user supplies the real Havoc Bane count; at the
   default single stack the 1-3 branch pays 10% and the 4-6 branch stays silent
   rather than claiming a floor it cannot have.
2. **`spend: { skillKey: amount }`** in the resource timeline — partial gauge
   consumption alongside the existing `spendAll`. Most kits draw a gauge DOWN
   rather than emptying it ("consume 50 of [Wolflame]", "consume 1 of
   [Frostharden Iai]", "consume 100 of [Frostheart]", Chisa 50, Lynae 3,
   Cantarella 1); modelling only spendAll zeroes a pool the game leaves change
   in, so a later cast reads 0 where the game still has some. Spends never go
   below zero and still resolve before gains within a step.

**[Files Changed]** `src/core/buffs.js` (stackBand), `src/core/rotation-resources.js`
(`spend`), `data/effect-overrides.json` (1610 IH0.0/IH0.1 rewritten),
`tests/stackable-effects.test.mjs` (70 → 87), `tests/rotation-resources.test.mjs`
(71 → 76), `docs/OPEN-ITEMS.md` #25 rewritten, `docs/CONFIGDB-RECON.md`.

**[Verification Method]** `npm test` 59/59, `npm run sweep` 66 modules,
`npm run lint` 0 errors. **LOCK A**: only Yangyang's two effects moved.
**LOCK B**: `generatedAt` + `engineHash` only — she is not a P12 anchor and no
other resonator carries a band.

**[Residual Risks]** `stackBand` is curated per effect, not extracted — the game
expresses these bands as separate buff rows with their own tag requirements, and
resolving them automatically needs the same chain→buff walk that only reaches
half the roster. Cap RAISES remain unmodelled, so an enemy still cannot exceed a
base cap in the sim; Yangyang's 4-6 band is reachable only by the user setting
the count. `spend` is implemented and tested but no curated gauge uses it yet —
the two defined gauges (Enflamement, Full Stop) both genuinely spendAll.

**[Updated Docs]** This addendum; `docs/OPEN-ITEMS.md` #25 rewritten from "Havoc
Bane max stacks disagree" (wrong) to "negative-status stack-limit RAISES are
unmodelled" (the real gap), recording that the base caps are correct;
`docs/CONFIGDB-RECON.md` updated with the resolved chain→buff walk.

### Addendum 4 (2026-08-01) — negative-status stack-limit raises

Closes OPEN-ITEMS #25, the gap the previous increment identified but left
unbuilt. `NEGATIVE_STATUS_DEFS.maxStacks` was a single fixed number; the game
treats it as a BASE that kits lift for a window, and the lift is what makes a
kit's own higher-band effects reachable at all.

**[Logic Altered]**

- `STATUS_CAP_RAISES` + `capRaisesForResonator` + `capRaiseWindowsFromSteps`
  (`enemy-status.js`). A raise arms at the END of a triggering cast and lasts a
  stated duration — the same convention castMatch buff windows use, so a raise
  and a buff triggered by the same cast agree about when they start. Raises are
  CHAIN-GATED: a resonance chain is a skill tree, so the entry declares the
  level that must be unlocked and stays in force above it.
- `buildEnemyStatusTimeline(applications, capRaises)` is now cap-aware, with
  `capAt(status, time)` exposed. Two clamps, deliberately different:
  a stack is capped at the limit in force **when it lands** (a stack gained
  under a raise was legitimately gained), and the held total is clamped to the
  limit in force **now** (when a raise lapses the excess falls away).
- "This effect does not stack" is honoured structurally: repeats of one SOURCE
  refresh rather than add (max per source), while distinct sources sum — which
  is what two different kits raising the same status would do.
- `team-sim.js` accumulates each member's raise windows on the shared enemy
  before resolving that member's status damage, and the Havoc Bane DEF-shred
  path no longer re-clamps to the base cap — `statusStacksAt` already returns
  the correctly-capped count, so clamping again would have undone every raise.
  `HAVOC_BANE_MAX` is deleted rather than left as a stale constant.

Curated: **Yangyang: Xuanling S3**, +3 Havoc Bane for 20s, armed by Intro -
Skybound Feather or either Sword Stance Flow. Measured end to end: the base cap
holds her at 3 stacks, the raise takes her to 6 (so her 4-6 amplify band is
reachable), the cap returns to 3 when the window lapses and the excess drops.

**[Files Changed]** `src/core/enemy-status.js`, `src/core/team-sim.js`,
`tests/enemy-status.test.mjs` (56 → 84), `CLAUDE.md` (invariant rewritten),
`docs/OPEN-ITEMS.md` (#25 struck through, #2's stale "both branches apply" line
corrected), `data/wuwa-meta.json`.

**[Verification Method]** `npm test` 59/59, `npm run sweep` 66 modules,
`npm run lint` 0 errors (1437, one BELOW the previous baseline — the deleted
`HAVOC_BANE_MAX`). **LOCK A**: completely clean, no data change; this increment
is engine plus one curated table in `src/core`. **LOCK B**: `generatedAt` +
`engineHash` only — Xuanling is not a P12 anchor and no anchor carries a raise.

**[Residual Risks]** Three raises are verified in kit text but NOT yet curated:
Cartethyia S2 (+3 Aero Erosion), Suisui (+3 Electro Flare / Electro Rage),
Aemeath S6 (Fusion/Rupturous Trail) — each needs its trigger keys read off the
kit the same way, and until then those kits still cannot exceed their base cap.
The "within a certain range" spatial qualifier every one of these carries is not
modelled: the sim has no positioning, so a raise applies to the shared enemy
unconditionally, which is the optimistic reading. Xuanling's own live Havoc Bane
COUNT still comes from the build editor's stepper rather than the enemy
timeline; the raise makes the higher band legal, it does not by itself feed her
effects a count.

### Addendum 5 (2026-08-01) — the three remaining cap raises, resolved

The previous increment left three raises verified in kit text but uncurated.
Resolving them properly needed two new shapes and one refusal.

**A standing rule first.** Maintainer, 2026-08-01: *for anything enemy-related,
assume abilities always hit and trigger.* Every one of these raises carries a
spatial qualifier ("on targets within a certain range", "targets near the active
Resonator"); they are now dropped outright rather than hedged as "the optimistic
reading", and the module says so.

**Cartethyia S2 — a cast raise with no stated duration.** "Casting Resonance
Liberation - A Knight's Heartfelt Prayers increases the max stack limit of Aero
Erosion … by 3." No duration is given, so `seconds: null` now means "holds to the
end of the fight" rather than collapsing to a zero-length window. Her two
Liberation forms (A Knight's Heartfelt Prayers / Blade of Howling Squall, the
Fleurdelys transformation) share the single `liberation_blade_of_howling_squall`
skill-map entry, which is therefore the only Liberation step her rotation can
hold — worth knowing before wiring anything else of hers.

**Suisui — an INFLICT-triggered raise, and it is bigger than the note said.**
Not one status but five: her Liberation deploys [Ceaseless Landscape] for 30s,
and while it is up, *any* team member inflicting Spectro Frazzle, Fusion Burst,
Glacio Chafe, Aero Erosion or Electro Flare raises **that** status's cap by 3 for
15s. This needed a genuinely different trigger: the raise is armed by the status
APPLICATION, not by a cast, and it lifts whichever status was applied. Two new
functions carry it — `capRaiseGateWindows` (the enclosing Landscape, which
outlives the segment that opened it) and `capRaiseWindowsFromInflicts` (the
raises the applications arm, consulted across every member, because a raise
belongs to the ENEMY: Suisui's Landscape lifts the cap for whoever inflicts
next, not just for her). Her partner counter [Electro Rage] is not a negative
status we model, so only the Flare half is represented.

**Aemeath S6 — deliberately NOT curated.** "The max stack limit of Rupturous
Trail/Fusion Trail … is increased to 60." Rupturous Trail and Fusion Trail are a
SEPARATE Aemeath mechanic, not `tune_rupture` / `fusion_burst` — her kit names
all four distinctly (93 Tune Rupture / 88 Fusion Burst / 21 Rupturous Trail / 32
Fusion Trail mentions) — and we model no Trail stacks at all. It is also a SET
("to 60"), not an ADD, which the table has no shape for. Mapping it onto a status
we do model would have invented a mechanic; recorded as a refusal with its
reason instead.

**[Files Changed]** `src/core/enemy-status.js` (two trigger shapes, null
duration, three entries incl. one refusal), `src/core/team-sim.js` (gate
accumulation + team-wide inflict raises, applications computed up front so a
stack landing under a raise is capped correctly), `tests/enemy-status.test.mjs`
(84 → 129), `docs/OPEN-ITEMS.md` #25 closed, `data/wuwa-meta.json`.

**[Verification Method]** `npm test` 59/59, `npm run sweep` 66 modules,
`npm run lint` 0 errors. **LOCK A** clean — no data change. **LOCK B**
`generatedAt` + `engineHash` only: none of Suisui, Cartethyia or Xuanling is a
P12 anchor. Measured end to end: Glacio Chafe's base cap of 10 becomes 13 under
the Landscape, and only for applications inside the 30s window.

**[Residual Risks]** Suisui's gate is armed only by casts already in a member's
rotation — if her Liberation is never cast, no raise exists, which is correct but
means the five-status lift is invisible in any team that does not run her
Liberation. Cartethyia's null duration is an inference from silence: the kit
states no timer, and "until the fight ends" is the only reading the text
supports, but a real in-game timer would make it optimistic. `capAt` groups
"does not stack" by `resonatorId:status`, so two COPIES of the same resonator
(impossible in a team today) would collapse into one group.

### Addendum 6 (2026-08-01) — the uncounted negative-status damage

Chasing "Aemeath's Trail damage goes uncounted" found something much larger:
**four of the six negative statuses dealt no damage at all.** `accrueStatusDamage`
only ever handled `damageOnStack`, which is `glacio_chafe` alone —
`damageOnTick` and `damageOnMax` were declared in `NEGATIVE_STATUS_DEFS` and
read by nothing. And two of those four had **confirmed per-stack multipliers
sitting unused in `docs/NEGATIVE-STATUS-REFERENCE.md` §2c since 2026-06-28**.

**[Logic Altered]**

1. **Spectro Frazzle and Aero Erosion multipliers wired.** Straight from the
   reference doc, which had them marked confirmed while the engine carried only
   glacio's. Aero Erosion's table runs to 6 stacks against a base cap of 3
   precisely because a cap raise is what reaches them — the mechanic shipped two
   increments ago.
2. **`resolveStatusOverTimeDamage`** — periodic ticks and burst-on-max, resolved
   as a POST-PASS over the finished timeline rather than incrementally, because a
   tick must know how long the status survived and a burst must know the cap in
   force; neither is knowable while the rotation is still being built.
   Attribution follows `lastApplicatorAt`, the same rule the per-application path
   already used for the inflicting level.
3. **The affliction LevelModifier now applies to every ELEMENTAL status.** The
   game's `AbnormalDamageConfig` is one value per level, *identical across all
   six elements* — the previous increment restricted it to `glacio_chafe`, the
   status whose worked examples happened to pin the constant. That restriction
   was why the newly-wired multipliers still produced zero on first run. Tune
   Rupture/Strain are excluded: they carry no element and their 716.22 is a
   different mechanic's constant.
4. **`statusDamageGaps`** — a status that DOES deal damage but has no confirmed
   multiplier is now reported on the team result (`statusDamageGaps: [{ status,
   applications, reason }]`) instead of silently contributing nothing. This is
   the honest answer for **Aemeath**: her whole kit runs on Fusion Burst / Tune
   Rupture, and neither has a calibrated multiplier, so the sim can now say "12
   applications, no confirmed per-stack multiplier" rather than reporting a bare
   zero that reads like "she deals no burst damage".

**[Files Changed]** `src/core/enemy-status.js`, `src/core/team-sim.js`
(`statusDamageGaps` on the result), `tests/enemy-status.test.mjs` (129 → 158),
`data/wuwa-meta.json`.

**[Verification Method]** `npm test` 59/59, `npm run sweep` 66 modules,
`npm run lint` 0 errors. **LOCK A** clean — no data change. **LOCK B moved, by
design, and attributes perfectly**: 40 of 50 anchors identical, 8 reordered, 2
changed membership; 58 teams moved in DPS, median 3.58%, p90 5.03%, max 8.56%.
**Every one of the 58 contains an inflicter of Spectro Frazzle or Aero Erosion
(Phoebe, Zani, Rover: Spectro, Rover: Aero, Ciaccona, Cartethyia), and every
team containing one moved** — an exact partition, which is the strongest
attribution this project has managed.

**[Residual Risks]** Fusion Burst and Electro Flare remain uncalibrated, so
Aemeath's and Buling's status damage is still absent — now visibly so rather
than silently. Ticks run from the first application to the end of the fight at
`tickIntervalS`, which assumes the status is re-applied often enough to survive;
the decay model handles the falloff, but a status that lapses and is re-applied
restarts its tick phase from the FIRST application, not the re-application.
Burst-on-max credits the application that first reaches the cap and does not
re-credit while the status stays pinned there — in-game `resetOnMax` clears the
stacks, which the presence timeline deliberately does not model, so a rotation
that would detonate repeatedly is credited once per climb.

### Addendum 7 (2026-08-01) — Fusion Burst found; Tune Break is not an affliction

Maintainer asked for the real Fusion Burst and Tune Rupture multipliers, with the
hint that Tune Break "MIGHT not be a negative status effect per se". Both
questions resolved from the game's own tables, and the hint was right.

**Affliction damage rows.** `db_damage` carries seven `Type 10` /
`FormulaType 9` rows, one per element — `1003` glacio, **`1004` fusion**,
`1002` electro, `1001` aero, `1005` spectro, `1006` havoc, plus `1007`, a glacio
variant. These are exactly what `AbnormalDamageConfig`'s `Abnormal1001..1006`
columns are named after. Their own FormulaParams are empty: the row says WHAT to
deal, not how much.

**The multiplier is KIT-SPECIFIC, which is why it was never found.** It lives on
the BUFF that triggers the damage (`ExtraEffectID 121`) as an explicit
`stacks#multiplier` table. There is no single global per-status constant to
calibrate — which is precisely why `docs/NEGATIVE-STATUS-REFERENCE.md` §2c had
Fusion Burst marked "pending calibration" for so long: observing one character
could never generalise.

Aemeath's four tables read straight onto her kit text — 110%+10%/stack (base),
310%+10%/stack, **115%+15%/stack** (her S2, "each stack of Fusion Trail removed
provides a 15% DMG Multiplier increase to Fusion Burst") and **515%+15%/stack**
(the same, +400% in Stardust Resonance) — all to 60 stacks, matching her S6
"max stack limit … increased to 60". Qiuyuan carries a flat 300%; Hiyuki two
100% entries against the glacio variant.

**Tune Break is not a negative status.** Tune Rupture DMG is damage **`Type 12`**
— ordinary rate-scaled skill damage (`RateLv` per level, `FormulaType 0`) —
delivered as instances on real skill keys: Mornye's Particle Jet, Aemeath's
Starburst and Seraphic Duet bonus, Lynae's Spectral Analysis. It is not an
affliction and has no stack multiplier to find. So `tune_rupture` /
`tune_strain` being `gatingOnly: true` is CORRECT, and `computeTuneBreakDamage`
models the separate Tune-Break-bar mechanic rather than these instances.

**[Files Changed]** `tools/extract/extract_affliction_damage.py` (new),
`data/affliction-damage.json` (new, committed),
`docs/NEGATIVE-STATUS-REFERENCE.md` §2c rewritten + new §2d.

**[Verification Method]** `npm test` 59/59, `npm run sweep` 66 modules. No
engine change, so LOCK A and LOCK B are both untouched — this increment is
extraction and documentation only.

**[Residual Risks]** The Fusion Burst numbers are NOT yet wired into the sim:
applying them needs the Trail stack count at the moment Seraphic Duet consumes
it, plus a way to pick which of Aemeath's four variants is live (chain level +
Stardust Resonance state). Both are real work, and half-wiring would have
credited the wrong table. Electro Flare still has no table at all — no buff
carries an `ExtraEffectID 121` entry against damage id `1002`. Separately
discovered and NOT fixed: the four Type-12 Tune Break keys carry `damageIds` but
no projected `damage` rows, so they currently resolve to zero — one of the ids
(`12100007003`) is absent from both our committed dump and the live export, so
it is a provenance mismatch rather than a projection bug.

### Addendum 8 (2026-08-01) — Aemeath's Fusion Burst wired

The extracted multipliers from Addendum 7, applied.

**Direction check first**, on the maintainer's warning that these debuffs began
as enemy→player and the player→enemy versions are recent. Two independent
confirmations that rows `1001–1006` are the player→enemy path:
`AbnormalDamageConfig` reads **3674 at level 90**, exactly the constant three
player→enemy Hiyuki worked examples pinned; and **every** buff referencing an
affliction damage id is resonator-owned (Hiyuki, Mornye, Aemeath, Qiuyuan,
Lynae, Luuk Herssen) — no monster or system owner anywhere in the table.

The maintainer's Electro Flare recollection also checks out: exactly one buff
references id `1002`, and it carries no multiplier table. Our own inflicter
detection independently lists only **Buling and Rover: Electro**.

**A distinction the data forced.** Spectro Frazzle has an observed per-stack
table but ZERO `ExtraEffect` buffs; Fusion Burst is the reverse. So there are
two separate damage paths, not one: the GENERIC affliction (ticks, detonation —
the globally-observed per-stack tables) and KIT-TRIGGERED instances (a kit
consuming a mark to fire one big hit at its own multiplier). Wiring the second
is additive; it does not replace the first.

**[Logic Altered]** `AFFLICTION_TRIGGERS` + `resolveAfflictionTriggers` +
`computeAfflictionDamage`. Aemeath's Seraphic Duet consumes Fusion Trail and
fires one Fusion Burst instance at the table's multiplier. The mark is DERIVED,
not curated: Fusion Trail accrues one stack per team Fusion Burst infliction
(30s, cap 30 → 60 at S6), and those applications are already on the shared enemy
timeline. Table selection follows the chain — base below S2, the 15%/stack table
from S2 — and deliberately does NOT pick the Stardust Resonance variants
(+200%/+400%), because that state is not modelled and assuming it would credit
the stronger table unearned.

The numbers are read from `data/afflictionDamage`, never hardcoded, and the test
asserts the extracted tables equal the kit's stated formula (100% + 10%/stack,
115%+15% at S2) — the cross-check that the extraction found the right rows.

**[Verification Method]** `npm test` 59/59 (enemy-status 158 → 184),
`npm run sweep` 66 modules, `npm run lint` 0 errors. **LOCK A**: only the new
`afflictionDamage` block. **LOCK B**: 48 of 50 anchors identical, 2 reordered, no
membership change; **all 30 moved teams contain Aemeath and not one without her
moved** — an exact partition.

**[Residual Risks — and an honest note on magnitude]** The movement is **median
0.54%, max 1.34%**, not the substantial jump expected against Prydwen. Measured
on her own reference rotation the two Seraphic Duet casts fire at 9 and 13 Fusion
Trail stacks for **~7.7k damage total at S0, ~9.8k at S2+** — real, correctly
sourced, but small beside a rotation totalling over a million. So this was NOT
the bulk of her gap. The likelier remainder, already recorded in Addendum 7:
her four **Type-12 Tune Break keys carry `damageIds` but no projected `damage`
rows and resolve to ZERO**, and her kit deals *five* Tune Rupture instances per
Seraphic Duet, each scaling +4% per Rupturous Trail stack. That is a
preprocessing/provenance problem rather than an enemy-status one, and it is the
next thing to chase.

Also still absent: the GENERIC Fusion Burst detonation (no observed per-stack
table), and Electro Flare entirely. Both continue to surface via
`statusDamageGaps` rather than silently.

### Addendum 9 (2026-08-01) — the state tracker, audited and closed

Maintainer asked why Resonance Mode isn't modelled and for a state tracker that
does not miss ability interactions. The audit corrected the premise and found
the real gap somewhere adjacent.

**Resonance Mode IS modelled, and works.** `build.resonanceMode` gates 12
effects across Lucilla and Aemeath via `effect.mode` / `modeGateOk`, and
Aemeath's active-effect set correctly differs between her two modes (10 vs 9).
My earlier note was about **Stardust Resonance** — an in-combat STATE, a
different mechanism from the build-level mode toggle — and that one genuinely
was missing.

**The tracker was never the weak link.** Of 8 state-gated effects, 7 resolved;
exactly one did not. The gap was UPSTREAM: the parser almost never EMITS a state
gate. Ten effects named an in-combat state in their condition text and parsed to
`persist` + `trigger: unknown`, which resolves OFF — so those buffs never
applied at all, silently.

**[Logic Altered]** Six new curated states, and the effects bound to them:

| resonator | state | effect that was dead |
| --- | --- | --- |
| Lingyang | Lion's Vigor | S3 — +20% Basic / +10% Skill DMG |
| Lingyang | (3s after Mountain Roamer) | S6 — +100% next Basic |
| Mortefi | Burning Rhapsody | S3 — +30% Marcato Crit DMG |
| Calcharo | Deathblade Gear | S3 — +25% Electro DMG |
| Camellya | Budding Mode | S3 — +58% ATK |
| Rover: Electro | Apex Resonance | S5 — +20% Crit DMG |
| Aemeath | Stardust Resonance (30s) | selects her stronger burst table |

None of these kits states a timer, so each persists per the standing reading of
silence — except Aemeath's, where the kit says "for 30s" outright.

Lingyang's S6 names TWO conditions ("in the Striding Lion state, during the
first 3s after every Mountain Roamer") and only one window is expressible. It
binds to the 3s-after-cast, the tighter of the two; Mountain Roamer is itself a
Striding Lion skill, so the state requirement is implied by the cast rather than
dropped.

**Aemeath's Stardust now selects her empowered Fusion Burst table** (+200% base,
+400% at S2 — the kit's own "further increased to 400%"), gated on the cast
window rather than the state timeline so the resolver stays self-contained, the
same shape the cap-raise gates use. Measured on her reference rotation, both
Seraphic Duet casts fall inside the 30s window: her burst total goes
**9.8k → 24.5k at S2+**, and 7.7k → 15.1k at S0.

**A correction.** Addendum 7 claimed the four Type-12 Tune Break keys "carry
`damageIds` but no projected `damage` rows and resolve to ZERO", and blamed a
provenance mismatch. **That was wrong** — I looked for a `damage` field that does
not exist; rows live in `damageTable[resonatorId]`. They are all present with
real multipliers (Aemeath's Starburst is 300% → 596% across levels). There is no
bug: those keys simply are not in her curated reference rotation, and one of
them is Tune-Rupture-mode only while her rotation is Fusion Burst.

**[Files Changed]** `src/core/rotation-rules.js` (6 states),
`src/core/enemy-status.js` (Stardust table selection),
`data/effect-overrides.json` (5 effects bound),
`tests/enemy-status.test.mjs` (184 → 235), regenerated data.

**[Verification Method]** `npm test` 59/59, `npm run sweep` 66 modules,
`npm run lint` 0 errors. State-naming effects resolving OFF: **10 → 5**, and the
remaining five are other classes entirely (Hiyuki ×3 and Sigrika are
team-composition counters, Mornye's is an enemy-side marker) — correctly not
states. **LOCK A**: only the five bound effects. **LOCK B**: 48 of 50 anchors
identical, 2 reordered, no membership change; 30 teams moved, median 0.50%, max
0.63%, and **all 30 contain Aemeath** — the other five state fixes are
non-anchors, so their effect is real on the build page but invisible to the meta.

**[Residual Risks]** The roster-wide assertion added here (no state-bound effect
may name a state its resonator lacks) is what caught Rover: Electro; it will now
fail loudly rather than silently for any future effect bound to an undefined
state. The five states with no stated timer persist for the whole rotation,
which overstates any that actually expire — the standing reading of silence, not
a measurement. Lingyang S6 drops its Striding Lion requirement as implied.

## 2026-08-01 — Aemeath build-page bug report: three defects, three causes

A maintainer audit of Aemeath's build page reported two engine bugs and one UI
bug. All three reproduced; none shared a cause.

### 1. S6's fixed crit was being read as an ordinary stat

**The report:** "the S6 is misattributing, concretely visible: Crit. Rate …
going above 20% CR with S6 enabled flags the overcap. This CR and CD buff ONLY
applies to the negative status effects, namely Fusion Burst and Tune Rupture.
These debuffs usually can NOT crit! But Aemeath's S6 enables that at a FIXED
rate, independent from other crit sources."

Exactly right, and the consequence was larger than the overcap warning. Her S6
reads *"Aemeath's Tune Rupture DMG can critically hit, with a fixed Crit. Rate
of 80%, and fixed Crit. DMG of 275%"* (once per Resonance Mode). The parser
emitted four ordinary `critRate` / `critDmg` effects, which
`resolveChainInherentContext` folds into `critRateBonus` / `critDmgBonus` on
**every hit she lands**. Measured on her reference rotation at S6:
**169,984 → 41,346**, a **4.1× overcount** — and identical to S5 now, which is
the correct relationship, since S6 grants her ordinary damage nothing.

**[Logic Altered]** A negative status's damage runs on its own formula
(`enemy-status.js`) with no crit term at all, and no gear stat reaches it. The
parser now recognises the kit granting it and routes those two numbers onto an
**affliction lane** (`afflictionCritRate` / `afflictionCritDmg`) that the stat
pipeline does not read — `resolveChainInherentContext`'s `default: break`
already ignores unknown stats, so the separation needs no new plumbing there.

Recognition is off the shared status vocabulary (`STATUS_KEYS` +
`statusSpaceForm`), not a per-character rule: `can critically hit` AND a
`"<status> DMG"` mention. Roster-wide, exactly one description matches, but any
future kit using the game's standard phrasing lands on the right lane for free.

`afflictionCritMultiplier(build, resonator)` returns the expected-value factor
in formula.js's own form — `1 + rate × (critDmg − 1)` = **2.4×** — and
`resolveAfflictionTriggers` applies it, reporting `critMultiplier` on the
instance so a doubled number is explainable rather than mysterious. Measured in
the team sim: her Fusion Burst damage **23,944 → 57,466** between S5 and S6,
exactly 2.4×.

The UI labels it *"Fixed 80% Crit Rate on Negative Status DMG"* — a leading "+"
would read as a bonus on her sheet, which is precisely what it is not.

### 2. A Resonance MODE was modelled as a combat STATE

**The report:** "it shows a 'Resonance Mode - Tune Rupture' state starting at
… step 8 EVEN when Fusion Burst Mode is toggled."

Reproduced in both modes. `STATE_DEFS[1210]` carried a
`'Resonance Mode - Tune Rupture'` state entered by any `forte_basic` /
`forte_heavy` cast. Wrong twice over: a Resonance Mode is a **build-level
toggle** (`build.resonanceMode` → `effect.mode` → `modeGateOk`) and is locked
for the whole fight, so the state switched on mid-rotation; and its name was
hardcoded to one mode, so it lit up in the other one too. Modes already have
their own gate — a second path for the same concept could only ever disagree
with the first. **Deleted**, with a roster-wide test forbidding any state named
after a Resonance Mode.

### 3. State strips named their closer but not their opener

**The report:** "her rotation (template) attributes 'Stardust Resonance' being
activated on Basic Attack Stage 4. But the state entry/trigger for it is the
Res. Liberation cast 'Heavenfall Edict - Overdrive'."

The engine had this right — `stateWindows` put Stardust at step 4,
`liberation_heavenfall_edict_overdrive`, which is the correct cast. The defect
is that the strip never **said** so, leaving the entering step to be inferred
from the picture: the strip sits on a **time** axis (0 → 21.57s) while the
rotation rail beneath it is `min-width:max-content` with per-chip widths set by
**label length**. Those two axes have nothing to do with each other, so reading
one against the other points at an arbitrary step.

`mkStateWindow` now carries `enteredBy` — the opening step's key, but only when
it actually matches the state's `enter` trigger, so a stance already on from
step 0 says *"active from the start"* rather than inventing a cause. The strip
eyebrow reads `STATE · entered by Heavenfall Edict — Overdrive`.

### 4. The echo main-stat dropdown stopped opening

**The report (sidenote):** "after some action on the page, which I can't
identify at this point, the echo main stat drop down breaks and won't show when
clicking on it."

`paint()` closed the tooltip, the sonata menu, the sonata quick-switch and the
rotation-load menu — but **not the echo-load menu**. All five are appended to
`document.body`, deliberately outside the repainted `.bv2` subtree so a repaint
cannot tear them down, which means every repaint has to close them by hand. The
echo-load menu is `position:fixed; z-index:9999`, anchored under the Echoes
panel's LOAD button — directly over the echo rail, where the main-stat
`<select>`s live. Surviving a repaint left it open over them holding a stale
anchor node, and its own outside-click guard counts a click landing on it as
"inside", so those clicks never reached the control underneath.

Fixed at the class, not the instance: one `closeFloatingMenus()` in `menus.js`
that closes all five, called by `paint()`. Adding a floating layer can no longer
silently miss the teardown.

**[Files Changed]** `tools/preprocess/effects.mjs` (affliction crit lane),
`src/core/enemy-status.js` (`afflictionCritMultiplier` + wiring),
`src/core/rotation-rules.js` (mode-as-state deleted),
`src/core/buffs/buff-windows.js` (`enteredBy`),
`src/ui/components/build-editor/rotation.js` (fixed-stat label, strip eyebrow),
`src/ui/components/build-editor/menus.js` + `index.js` (`closeFloatingMenus`),
tests: `enemy-status` (246), `rotation-state` (77), `effect-windows` (25),
`resonance-mode` (26); regenerated data.

**[Verification Method]** `npm test` 59/59, `npm run sweep` 66 modules,
`npm run lint` 0 errors. **LOCK A**: exactly four lines — the four S6 stat
names. **LOCK B**: `generatedAt` + `engineHash` only, **zero** behavioural
movement, and that is explained rather than assumed — `team-rank.js` builds
teammates with `setChain(createBuild(resonator), 0)`, so S6 is locked for every
one of the 30 teams Aemeath appears in. The fix is real on the build page and
invisible to the meta by construction.

**[Residual Risks]** Her build-page number drops 4.1×, and the correct
replacement is **not visible there**: `resolveStatusOverTimeDamage` and
`resolveAfflictionTriggers` are team-sim-only, so the build page renders no
negative-status damage at all. That gap predates this change but is now
conspicuous — recorded as OPEN-ITEMS #27. The affliction crit is applied only on
the kit-triggered path; the over-time path is per-STATUS across every applicator
and would need each applicator's build, which no status of hers reaches today
(neither Fusion Burst nor Tune Rupture has a per-stack table).

**[Updated Docs]** `CLAUDE.md` (two invariants: negative-status DMG does not
crit; a Resonance Mode is not a state), `docs/OPEN-ITEMS.md` (#27),
`docs/HISTORY.md` (this entry).

## 2026-08-01 — Aemeath follow-up: Stardust's real exit, contradictory skill labels, and negative-status damage made visible

A second maintainer pass on the same build page. One report was a display bug
with a mechanical fact attached, one was a naming bug with 17 siblings, and one
was the feature the previous session had flagged as OPEN-ITEMS #27.

### 1. Stardust still read as starting at the wrong step — and its exit was half-modelled

**The report:** "Stardust Resonance still shows at BA4 step. Liberation
activates the state and either by 30s it's ended or consumed by 2 enhanced
resonance skill casts."

Two separate things, both real.

**The position.** The state window opened at the entering cast's START time
(2.97s, the Liberation's first frame). The rotation chart plots each step's dot
at its END time — and the Liberation's start IS the previous step's end, so the
strip's left edge landed exactly on the `skill_mech_4` dot. Naming the entering
cast (previous session) did not help a reader who trusts the picture.

Fixed at the axis: a state entered by a cast now opens at that cast's **END**,
which is (a) the same convention `castMatch` buff windows already use, (b) the
same instant the state's own `seconds` timer counts from — `rotation-state.js`
has always set `expiresAt = endTimes[i] + seconds`, so the strip and the expiry
had been drawn from different origins, 4.37s apart for a Liberation that freezes
the clock. It now opens at 7.34s, on the Liberation's own dot.

**The exit.** Her kit states BOTH ends and we modelled one:

> "Casting this skill grants … Enter [Stardust Resonance] for 30s."
> "## Stardust Resonance — Enhance the effect of Resonance Skill [Seraphic
> Duet]. **This effect ends after [Seraphic Duet] is cast 2 times.**"

New `exit.uses` (default absent → nothing changes) turns `consumedBy` /
`secondsOrConsumedBy` into a BUDGET of consuming casts. It also changes who
benefits: with `uses` the state stays active THROUGH the cast that spends the
last use, because the kit says it ends *after* that cast — the last one is
spent, not skipped. Without `uses` the consuming cast still does not see the
state, which is what every stance swap wants (Hiyuki's Liberation belongs to
Foreclaimed Self, not to the Present Self it ends).

`AFFLICTION_TRIGGERS` gained the matching `casts: 2`, so a third Seraphic Duet
inside the 30s window uses the base table rather than the empowered one.
`mkStateWindow` also had to learn that a uses-budget exit is closed by the LAST
ACTIVE step, not the first inactive one, or it named an unrelated step and
reported "expired" for a state a cast had actually consumed.

Her strip now reads: **entered by Heavenfall Edict — Overdrive · 7.8s · consumed
by Seraphic Duet — Overture**, steps 4–12.

### 2. "Resonance Skill: Basic Attack — Mech Stage 4" — 18 labels naming two categories

**The report:** "the resonance skill part doesn't make sense."

It doesn't. The game files a move under the INPUT that casts it, which is not
always what it calls the move: her Mech basic chain lives inside her Resonance
Skill node, so the node's mechanical `skillType` is `'skill'` while the row's own
name is "Basic Attack - Mech Stage 4". `generateSkillLabel` prefixed the node's
category unconditionally, producing a label that contradicts itself.

**18 of them, across 9 resonators** — Lucilla ×3, Aemeath ×4, Augusta ×3,
Phrolova ×2, Yangyang: Xuanling ×2, Galbrena, Rover: Electro, Lynae, Luuk
Herssen. When a row already names a category, THAT is what the move is called
and it wins; the node's annotation — `(Forte)` / `(Echo)`, which describes how
the move is reached rather than what it is — is kept:

    Resonance Skill: Basic Attack — Mech Stage 4   →  Basic Attack: Mech Stage 4
    Heavy Attack (Forte): Resonance Skill — Ravage →  Resonance Skill (Forte): Ravage
    Resonance Liberation (Echo): Basic Attack — Hecate Stage 1
                                                   →  Basic Attack (Echo): Hecate Stage 1

The mechanical `skillType` is untouched — `castMatch` triggers still read it, per
the standing invariant — and the rotation chip's own type badge still shows it.
A roster-wide test now fails on any label that names two categories.

### 3. Negative-status damage is user-facing (OPEN-ITEMS #27, closed)

**The report:** "make negative status DMG user-facing, visible, and correctly
attributed towards DMG/DPS."

`resolveStatusOverTimeDamage` / `resolveAfflictionTriggers` lived only inside
`team-sim.js`, so the build page showed none of this lane. New
`soloStatusDamage` (enemy-status.js) resolves all three shapes a status can
have for one rotation — per-application (`damageOnStack`), ticks and
burst-on-max (which need the finished timeline), and kit-triggered afflictions —
building its own applications, cap-raise windows and enemy timeline, exactly as
the team path does with a roster of one.

`simulateRotation` reports `totals.statusDamage` beside a new
`totals.skillDamage`; `totals.damage` and DPS count both. Status damage stays
OUT of `step.stepDamage` — a step's damage must remain the sum of that cast's
hits or the hit breakdown stops adding up — and gets its own block instead.

**Nine resonators** now show damage the build page had been omitting, and for
most of them it is the majority of their output:

| | skill | status | status share |
| --- | --- | --- | --- |
| Ciaccona | 8,276 | 32,800 | 79.9% |
| Hiyuki | 27,153 | 58,553 | 68.3% |
| Aemeath | 41,346 | 58,792 | 58.7% |
| Phoebe | 11,382 | 15,941 | 58.3% |
| Rover: Aero | 7,602 | 9,940 | 56.7% |
| Rover: Spectro | 7,050 | 7,793 | 52.5% |
| Lucilla | 12,189 | 5,925 | 32.7% |
| Cartethyia | 41,347 | 16,567 | 28.6% |
| Zani | 38,800 | 15,223 | 28.2% |

Surfaced three ways: the DMG BREAKDOWN donut gives each status its own
element-coloured slice (so it still sums to 100%), the timeline gains a strip
per status spanning its first to last instance, and the total spells out
"41,346 skill + 58,792 negative status". A status with no confirmed multiplier
is NAMED under the donut rather than silently absent — and a status that is
PARTLY counted (Aemeath's Fusion Burst: the kit-triggered burst carries its own
multiplier, the generic detonation does not) says so, instead of a bare "not
counted" sitting beside a large slice of exactly that status.

**[Files Changed]** `src/core/enemy-status.js` (`soloStatusDamage`, stardust
`casts`, gap `countedDamage`), `src/core/rotation-state.js` (`exit.uses`),
`src/core/rotation-rules.js` (Stardust's real exit),
`src/core/buffs/buff-windows.js` (window start axis, uses-budget closer),
`src/core/sim.js` (status lane in totals/DPS), `src/core/team-sim.js`
(reads `skillDamage`), `tools/preprocess/skill-rows.mjs` (label category),
`src/ui/components/build-editor/rotation.js` (donut slices, strips, split line,
gap lines), `src/ui/components/team-editor-v2.js` (status named in the share
hover), tests: `enemy-status` (260), `rotation-state` (86), `sim-enrichment`
(18); regenerated data.

**[Verification Method]** `npm test` 59/59, `npm run sweep` 66 modules,
`npm run lint` 0 errors. **LOCK A**: 41 label lines + the 4 stat names from the
previous change, nothing else. **LOCK B**: all six anchors keep **byte-identical
suggested builds** (sonata, weapon, substat allocation, anchor stats) and **all
400 team entries hold their DPS**, with only last-digit float noise in the raw
weight numbers. That is not luck and it is the point: negative-status damage has
no ATK/crit scaling, so it adds a CONSTANT to every candidate build and cancels
exactly out of the marginal-value differences the optimizer ranks on. An
intermediate run BEFORE `team-sim.js` was switched to `skillDamage` moved 144
teams by a median 2.90% — that was the double count, caught by this same check.

**[Residual Risks]** `simulateRotation` inside the team sim still computes a
solo status lane that the team path discards (the team's shared timeline is
authoritative); it is wasted work, not wrong, and `npm run meta` did not
regress. The generic Fusion Burst / Electro Flare detonations still have no
confirmed per-stack multiplier, now reported per status rather than assumed.
`exit.uses` counts casts, not the in-game enhancement itself — a rotation that
enters Stardust twice with an unspent budget between them gets a fresh two,
which is the literal reading of the kit but is untested against the game.

**[Updated Docs]** `CLAUDE.md` (two invariants: solo-vs-team status ownership;
label category from the game's name, type from the node), `docs/OPEN-ITEMS.md`
(#27 closed), `docs/HISTORY.md` (this entry).

## 2026-08-01 — Aemeath S6's missing amplify, the negative-status tables the game ships, and purging "Heavy Attack (Forte)"

Third maintainer pass. One reported regression, one "this looks understated"
hunch that turned out to be a much larger data gap, and one naming complaint.

### 1. S6's "+40% Liberation DMG taken" was parsed to nothing

**The report:** "Aemeath's S6 grants an unconditional 40% Liberation DMG
increase which the build editor data does not reflect (no change in numbers on
switching between S5 and S6)."

Correct — S5 and S6 produced byte-identical skill damage. The clause is
*"Targets take 40% more Resonance Liberation DMG from Aemeath"*: the same
DMG-amplification bucket as an `amplify` clause, phrased from the TARGET's side,
which is why a branch keyed on the word "amplif" never saw it. **Six such clauses
exist roster-wide and all six parsed to nothing.**

New rule, scoped by the actor named after "from" — the clause only covers THAT
actor's damage:

| resonator | clause | outcome |
| --- | --- | --- |
| Aemeath S6 | +40%, Resonance Liberation, from Aemeath | ON, liberation-scoped |
| Sigrika S6 | +30% from Sigrika | ON |
| Cartethyia S6 | +40% **from Fleurdelys** | SKIPPED — a summon/alt form, not her |
| Cartethyia IH1 ×2 | Aero Erosion stack-gated | parsed, resolves OFF (enemy-status count lane) |
| Phrolova S6 | conditional on being off-field in Maestro | parsed, resolves OFF |

Skipping the Fleurdelys clause is the point: emitting it would have spread a
summon-only amplify across every hit Cartethyia lands.

Measured, S5 → S6 on her reference rotation: skill damage **41,346 → 49,956**.
The ×1.25 (not ×1.4) on her Liberation hits is correct — her S3 already
contributes +60% to the same additive amplify bucket, so 2.0/1.6.

### 2. Fusion Burst was not understated — it was ZERO, and so was Electro Flare

**The report:** "I don't know how exactly fusion burst works, but at the moment
it looks heavily understated on Aemeath. We should see Fusion Burst debuff ticks
PLUS the additional damage that Aemeath can trigger mechanically?"

The hunch was right and the cause was bigger than Aemeath. `STACK_MV_TABLES`
carried three community-derived curves and left Fusion Burst and Electro Flare
as "pending calibration", contributing nothing at all.

**It was never a calibration problem.** The game ships all six, on SYSTEM buffs
in a reserved id block — one dedicated `ExtraEffectID` per status. The earlier
affliction sweep missed them because KIT tables use `ExtraEffectID 121`, and
these do not:

| buff | effect | status | cap | stack life | tick | 1 stack → cap |
| --- | --- | --- | --- | --- | --- | --- |
| 10011000 | 1003 | Glacio Chafe | 10 | 15s | — | 0.2450 → 2.0377 |
| 10021000 | 1004 | Fusion Burst | 10 | 15s | — | 0.8400 → 6.9863 |
| 10031000 | 1002 | Electro Flare | 10 | 15s | 5s | 0.5000 → 4.1585 |
| 10041000 | 1001 | Aero Erosion | 3 | 14.8s | 3s | 0.4500 → 2.2500 |
| 10051000 | 1005 | Spectro Frazzle | 10 | 3s | 3s | 0.3000 → 2.4951 |
| 10061000 | 1006 | Havoc Bane | 3 | 25s | — | −0.02/stack (DEF, not DMG) |

**Glacio Chafe's shipped row reproduces this engine's reverse-engineered curve
to the digit** (0.2450 / 1.4401 / 2.0377 at stacks 1 / 7 / 10). That is what
validates every other row — the extraction was checked against a number the
project had already confirmed in game, not assumed. Havoc Bane's negative row is
the −2%/stack DEF reduction already modelled, cap 3.

Four corrections fell out:

- **Fusion Burst and Electro Flare dealt nothing.** Electro Flare additionally
  declared `damageOnTick` with **no interval**, so even a table would not have
  paid out; the game says 5s.
- **Spectro Frazzle and Aero Erosion were at exactly 0.8× the shipped values** —
  the community figures confirmed in `docs/NEGATIVE-STATUS-REFERENCE.md` are
  uniformly four fifths of the game's.
- **Glacio Chafe, Fusion Burst and Electro Flare had no stack lifetime**, so
  their stacks never expired. All six now carry the game's own duration.
- Every `NEGATIVE_STATUS_DEFS` structural field (cap, lifetime, tick) is now
  test-asserted equal to the shipped table, so a curated def cannot drift.

To Aemeath's actual question — **both**, and now visibly so:

    t=11.41  Fusion Burst  kit-triggered  9 stacks   28,070   (Stardust, crit ×2.4)
    t=12.01  Fusion Burst  detonation    10 stacks   12,868   ← was zero
    t=15.14  Fusion Burst  kit-triggered 13 stacks   30,722   (Stardust, crit ×2.4)

Her status damage goes **58,792 → 71,659**; the new instance is the generic
detonation at cap, on top of the two her kit triggers. (It is a detonation, not
a tick — Fusion Burst ships no `Period`; Electro Flare, Aero Erosion and Spectro
Frazzle are the periodic ones.)

Roster-wide, `statusDamageGaps` is now **empty**, and two resonators gained a
damage lane they never had: **Buling** (Electro Flare, 88% of her output) and
**Denia** (Fusion Burst).

### 3. "Heavy Attack (Forte)" purged as a title

**The report:** "Forte is a resonator's specialty… In itself Forte is a passive
that does have interactions with other abilities, but doesn't actively perform
itself. So Heavy Attack as a title doesn't make sense, since Forte can affect
more than just a HA nor is it activated or directly correlated to HA."

`CATEGORY_PREFIX` mapped `forte_heavy` → "Heavy Attack (Forte)" and
`forte_basic` → "Basic Attack (Forte)" as a blanket default, titling **187 keys**
after an input that has nothing to do with them. Both now read **"Forte
Circuit"** — the game's own name for the node — and the mechanical
`forte_basic`/`forte_heavy` split stays where it belongs, on `skillType` for
`multiplierUp` matching.

**198 of 239** forte keys are now plainly "Forte Circuit". The other 41 keep an
attack title because the GAME itself names them one — Phoebe's "Heavy Attack -
Starflash", Cartethyia's forte basic chain — and there the "(Forte)" survives as
an ANNOTATION marking the circuit, exactly as Augusta's "Resonance Skill
(Forte): Undying Sunlight" already did. The category comes from the game's name;
the annotation says how the move is reached.

Forte steps also stopped rendering in the WARN colour: `STEP_TYPE` had no
`forte_*` entry, so every one of them fell through to the error styling. They
now share an `FC` badge on a new `--dmg-forte` token.

**[Files Changed]** `tools/extract/extract_status_damage.py` (new) +
`data/status-damage.json` (new), `tools/preprocess.mjs` (carry it),
`tools/preprocess/effects.mjs` (`dmgTakenEffect`),
`tools/preprocess/resonators.mjs` (pass the resonator name),
`tools/preprocess/skill-rows.mjs` (Forte Circuit prefix, annotation-preserving
override), `src/core/enemy-status.js` (`stackMvTable`, defs from the game),
`src/core/team-sim.js` + `src/ui/.../shared.js` + `rotation.js`,
`styles/tokens.css`, `CLAUDE.md`, `docs/NEGATIVE-STATUS-REFERENCE.md` §2c,
`docs/OPEN-ITEMS.md` (#28), tests: `enemy-status` (292), `sim-enrichment` (24),
`stack-metadata` (108).

**[Verification Method]** `npm test` 59/59, `npm run sweep` 66 modules,
`npm run lint` 0 errors. **LOCK A**: label/name lines plus the four S6 stat
names — no other content moved. **LOCK B**: all six anchors keep **identical
suggested builds** for the third change running (status damage has no ATK/crit
scaling, so it adds a constant to every candidate and cancels out of the
marginal-value weights). 241 team entries identical; **150 moved** (median
0.53%, max 8.28%) with 9 membership changes — and **every one of the 150
contains a status inflicter, while zero teams without one moved**, which is the
check that the movement is the new damage rather than drift.

**[Residual Risks]** Fusion Burst is modelled as detonating at its cap
(`damageOnMax`), which is the documented mechanic and matches the kit language
("trigger the Fusion Burst"); the shipped row has no `Period`, so it is
certainly not periodic, but the data does not by itself prove detonation over
per-application. Glacio Chafe ships a second, exactly-half variant (10010000)
whose trigger conditions are unknown; the calibrated curve matches the full one,
so that is what is used. The "targets take N% more DMG" rule reads the actor by
NAME, so a kit that credits an alternate form under a name we cannot match to
the resonator is skipped rather than guessed — Cartethyia S6 is the one live
case, and it is deliberately absent rather than overstated.

**[Updated Docs]** `CLAUDE.md` (invariant: negative statuses are data, not
folklore), `docs/NEGATIVE-STATUS-REFERENCE.md` §2c (rewritten around the shipped
tables), `docs/OPEN-ITEMS.md` (#28 closed), `docs/HISTORY.md` (this entry).

### Addendum (2026-08-01) — the kit-triggered burst was missing its entire base

The maintainer supplied a community explanation of Fusion Burst and asked for it
NOT to be taken at face value, since the in-game description of the mechanic is
thin and community numbers are often wrong. Checking it against the kit text
found the explanation correct and the sim wrong in a way the previous increment
had not caught.

**What the kit actually says.** Aemeath's Forte:

> "…Resonance Skill [Seraphic Duet] removes the [Fusion Trail] stacks on targets
> …, and **trigger the [Fusion Burst] on the target based on its max stack limit
> without removing its stacks**. Each stack of [Fusion Trail] removed
> **increases the DMG Multiplier of [Fusion Burst]** on the main target by 10%."

So the extracted `ExtraEffectID 121` table is a DMG-multiplier FACTOR, and the
burst it scales is the status's own value **at the target's stack limit**. The
engine was using the table as the complete multiplier — dropping the base
entirely, a **~7× understatement** on her largest damage source.

**Three kits confirm it independently**, which is what makes this a reading of
the game rather than of a forum post:

| kit | its own words | its table |
| --- | --- | --- |
| Hiyuki | "triggered based on that enemy's current [Glacio Bite] **stack limit**" | 1.00 — her text states no increase at all |
| Denia | "based on its **max limit** … gains a **200% DMG Multiplier increase**" | 3.00 — exactly 100% + 200% |
| Aemeath | "based on its **max stack limit** … +10% per Fusion Trail removed" | 1.00 + 0.10/stack |

Denia's single-value table is the exact check: 3.0 is 1 + the increase her own
text states, and it cannot be anything else. Aemeath's Stardust pair falls out
the same way — 3.00 + 0.10/stack is her "+200%", 5.00 + 0.15/stack her "+400%".

**[Logic Altered]** `AFFLICTION_TRIGGERS` gained `baseAtMaxStacks`, and
`resolveAfflictionTriggers` now prices the burst as
`stackMvTable(status)[timeline.capAt(status, t)] × table[trailStacks]`. Reading
the cap off the TIMELINE rather than the def is deliberate: a teammate raising
the Fusion Burst limit (Suisui, Chisa) makes every one of her triggers bigger,
which is precisely what "based on its max stack limit" buys — and is the synergy
the community explanation described. `burstCap` is reported on each instance so
the number is inspectable.

Measured on her reference rotation, status damage **58,792 → 423,605** at S6
(kit-triggered bursts 28,070 → 196,104 and 30,722 → 214,633; the natural
detonation is unchanged at 12,868). Her build page now reads 49,956 skill +
423,605 status. That the status share is so large is a property of the mechanic,
not a modelling artefact: negative-status damage has NO ATK or crit scaling, so
gear lifts only the skill half.

**[Verification Method]** `npm test` 59/59 (`enemy-status` 300), sweep 66, lint
0 errors. **LOCK B**: all six anchors still keep identical suggested builds; 148
team entries moved, **every one containing a status inflicter and zero without
one**, 29 of them Aemeath's.

**[Residual Risks]** Two clauses of the same Forte remain unmodelled and are
recorded as OPEN-ITEMS #29: the enemy detonates at **>5** stacks rather than at
the cap, and re-seeds one stack when it hits zero — together roughly doubling
the natural detonation rate. Blocked on the timeline deliberately not modelling
`resetOnMax` removal; impact is 3% of her status damage, hence recorded rather
than half-built. Hiyuki's and Denia's own kit triggers still have no
`AFFLICTION_TRIGGERS` entry, so their tables sit extracted but unused.

### Addendum 2 (2026-08-01) — what applies a stack, and when a status actually deals damage

Two maintainer questions, both answered from the game's own tutorial text
(`ConfigDB/en/lang_multi_text.db`) rather than from kit descriptions or forums.

**Q: Does Fusion Burst deal damage ON infliction?** No — and the game says so
outright, which also settles the three statuses around it:

> **Fusion Burst** — "When Fusion Burst is stacked to its max, **all stacks will
> be removed to trigger an explosion**, dealing Fusion DMG to the target and
> nearby enemies. Fusion Burst stacks up to 10 times by default. The higher the
> stacks, the more DMG dealt."
>
> **Glacio Chafe** — "**When Glacio Chafe is inflicted, the target receives
> Glacio DMG.** … Each stack reduces the target's Movement Speed." (and at max
> stacks the target is **frozen**, not damaged)
>
> **Electro Flare** — "While Electro Flare lasts, it deals **periodic** Electro
> DMG… **the target loses half of the effect stacks with each instance of
> damage**."

So `fusion_burst: damageOnMax` and `glacio_chafe: damageOnStack` were both
already right, and are now asserted against those sentences rather than assumed.
Electro Flare's half-stack loss on tick, and its Electro Rage overflow at max,
remain unmodelled (OPEN-ITEMS #30).

**Q: What actually applies a stack?** Not "every damaging cast", which is what
`applicationsFromSteps` did. Aemeath's Forte names the rule exactly:

> "…inflict [Tune Rupture - Shifting]/[Fusion Burst] when the following skills
> deal damage. **The same skill can only trigger this effect on the same target
> once every 3s**: [Basic Attack - Aemeath Stage 3 & 4], [Basic Attack - Mech
> Stage 3 & 4], Resonance Skill [Sync Strike: Armament Merge], Resonance Skill
> [Sync Strike: Call of Dawn], Intro Skill [Songs Across the Universe], and Intro
> Skill [Debut of Meteoric Radiance]."

**[Logic Altered]** New `STATUS_APPLY_RULES` — named skill keys, a stack count,
and a PER-SKILL-KEY ICD (two different listed skills 1s apart both apply; the
same one twice in 3s applies once), mode-gated. A kit with no entry keeps the
every-damaging-step fallback. On Aemeath's reference rotation her Fusion Burst
applications drop **15 → 7**, and with them her Fusion Trail counts at the two
Seraphic Duets (9/13 → 5/7).

That correction removed her natural detonation entirely — 7 applications never
reach a cap of 10 — which made the other half of the same Forte load-bearing:

> "If the targets have **more than 5 stacks** of [Fusion Burst], trigger [Fusion
> Burst] **based on their max stack limit** and **remove all of their stacks**."

So `STATUS_BURST_RULES` now carries a per-kit detonation threshold, and the
burst path tracks the held count LOCALLY — accruing per application and resetting
on each detonation — which is what lets a threshold fire more than once. Damage
is priced at the cap, per the same clause. Her detonation is back at t=12.01.

**The timeline now shows inflictions and stacks regardless of damage.**
`soloStatusDamage` returns `stackTimelines`: per status, the application count,
first/last time, peak stacks, per-step stack count, and the damage it paid out.
The build page renders one strip per status APPLIED — not per status that
damages — with height-encoded stack bands, so Havoc Bane (pure DEF reduction)
and Tune Rupture (gating-only) are visible as things the rotation did rather
than absent because they deal nothing. Aemeath's Fusion Burst curve reads
`1,2,3,3,3,4,5,5,5,6,7,7,…` across her steps; Hiyuki's Glacio Chafe ramps to its
cap of 10 and holds.

**[Verification Method]** `npm test` 59/59 (`enemy-status` 318), sweep 66, lint
0 errors. **LOCK B**: all six anchors keep identical suggested builds; 148 team
entries moved, **every one containing a status inflicter, zero without one**.

**[Residual Risks]** The presence timeline still does not clear stacks on
detonation, so a status strip keeps climbing while the burst path (correctly)
resets — the two disagree after a detonation and the strip is the optimistic
one. Aemeath's re-seed at 0 stacks is unmodelled, which understates her
detonation rate. Only Aemeath has a curated apply rule; every other inflicter
still applies on every damaging step, which over-applies by roughly the ratio of
its damaging steps to its real inflicting ones — now the largest remaining
source of status-damage error (OPEN-ITEMS #29).

### Addendum 3 (2026-08-01) — the MARK is a debuff, and S6 has three of its modifiers

The maintainer went into the game to test the infliction rule directly, could not
tell the abilities apart in live combat (two small icons under the health bar),
but reported one unambiguous observation: on an **S6 Aemeath, Fusion Trail
stacks much faster and much higher** than the sim showed. That observation was
right and located a gap the kit text spells out.

**S6 carries FOUR Fusion Trail modifiers. We modelled one.**

| S6 clause | modelled before |
| --- | --- |
| "The stacks of … Fusion Trail inflicted on the target through Forte Circuit … is **doubled**" | no |
| "the **max stack limit** … is increased to 60" | yes |
| "While casting Resonance Skill [Seraphic Duet], **inflict 10 stacks** of … Fusion Trail … for 30s" | no |
| (Forte) "when Resonators in the team inflict [Fusion Burst], inflict **1** of [Fusion Trail] for 30s" | as a count of applications |

**[Logic Altered]** The mark stopped being "a count of qualifying applications
inside a window" and became a real event timeline (`markEventsFor`): per-source
grants, each expiring on its own 30s clock, a cap, and an explicit consumption
that clears what is standing. `afflictionTriggerFor` resolves `markPerApplication`
/ `markOnCast` / `markCap` by chain level the same way the damage tables already
resolved.

The S6 on-cast grant is stamped a hair AFTER the cast, because the same Seraphic
Duet is usually the one consuming the mark — the grant must neither inflate that
consumption nor be wiped by it. "While casting" does not settle the ordering;
this is the conservative reading, and it is called out in the code.

On her reference rotation the Trail now reads `2,4,6,6,6,8,10,10,10,12,14,14,14,
10,10,10` across the steps, spending ×10 at the first Duet and ×14 at the second
(it was a flat 5 and 7). Status damage **377,281 → 432,869** at S6; S0 is
unchanged apart from consumption now emptying the Trail.

**The mark is now visible as its own debuff.** The build page renders one strip
per tracked debuff, so Aemeath shows TWO: `fusion burst` with its own stack curve,
and `Fusion Trail (MARK)` in gold with its cap, its per-step count, and each
consumption labelled with what was spent. That makes the mechanic legible instead
of inferred — the Duet spends the TRAIL, fires Fusion Burst at its max stack
limit, and leaves the Fusion Burst stacks untouched, which is exactly why the
Fusion Burst count beside it keeps climbing through both Duets. The tooltip says
so in those words rather than leaving the reader to notice.

**[Verification Method]** `npm test` 59/59 (`enemy-status` 335), sweep 66, lint 0
errors. **LOCK B**: all six anchors keep identical suggested builds; 149 team
entries moved, every one containing a status inflicter and zero without.

**[Residual Risks]** The maintainer could not verify the infliction RULE in game,
and neither the in-game description nor the resource pages state it — the eight
skills and the 3s ICD come from her Forte's own text, which is the best source
available but has not been confirmed against observed behaviour. If Fusion Trail
still climbs faster in game than the sim shows after this, the remaining
candidates are, in order: her unmodelled re-seed at 0 stacks (each re-seed is
itself a Fusion Burst infliction, so it feeds the Trail — OPEN-ITEMS #30);
teammates inflicting Fusion Burst, which the solo sim has no way to include; and
the on-cast grant ordering above, which if it lands BEFORE the consumption would
add 10 to each Duet.

### Addendum 4 (2026-08-01) — the debuff board, audited in a real browser

The maintainer reported that Fusion Burst "stacks to 7 and vanishes completely
after BA Stage 3", asked for buffs and debuffs to be split into separate lanes
with titles on the left, and — because the data question kept resisting kit text
— asked for a PARALLEL AGENT driving Playwright to independently check whether
what the page SHOWS matches what the engine COMPUTES.

That audit ran three times against a live browser (screenshots read as pixels,
plus DOM geometry, cross-checked against `simulateRotation` in Node). It found
**twelve defects across three rounds**, every one of them real, and several that
this session's own fixes had introduced.

**The reported bug.** The lane's bar ended at the last APPLICATION, not where the
stacks run out — Fusion Burst holds 7 stacks to the end of the rotation, so the
bar stopped at 12.57s while the debuff was still up. `stackTimelines` gained
`activeUntil`, computed from the last step whose held count is non-zero.

**The layout.** `renderTrackBoard` replaces `renderBuffBar` on the build page:
one row per track, the NAME in a fixed left column, grouped under *Buffs · self
and team* / *States* / *Debuffs on the enemy*, with step gridlines behind every
bar. The old renderer packed unrelated tracks into shared rows and wrote each
label INSIDE its own bar, so a 0.6s window on a 22s axis clipped to
"Fusion Burst …". The team page keeps the packed renderer.

**What the audit caught, in the order it hurt:**

| | defect | why it mattered |
| --- | --- | --- |
| D1 | the board had no ruler of its own | the label column shifts the tracks 250px right, so bars sat under the CHART's axis — Stardust's start read **~10.9s instead of 7.34s** |
| D4 | the mark's curve was one step behind its own "spent ×N" | consumptions are stamped at a cast's `endTime`, which IS the next step's sampling point, so the trail sat at full height for the whole step AFTER being emptied |
| D2 | the headline clipped in every case measured | `scrollWidth 228 > clientWidth 210` — the instance count was being eaten |
| D3 | `eyebrow` computed for all four strip kinds, silently dropped | nothing marked MARK vs STATUS, and a state's entering cast vanished — the exact thing the eyebrow was added for |
| D5 | bands unlabelled, height normalised per lane | a full-height band was 14 stacks on one row and 7 on the row above, pixel-identical |
| D6 | status rows had no cap | "peak ×7" read as a ceiling rather than 7 of 10 — and 10 is a DETONATION |
| — | the S6 fixed crit drove a 4.3× jump with nothing on the timeline saying so | the tooltip even hedged "no crit unless a kit grants one" while this kit granted one |

Fixing those exposed four more, all found by the same audit: the States row
clipped *because* the eyebrow now rendered a full "Resonance Liberation:
Heavenfall Edict — Overdrive" (she has TWO Heavenfall Edict liberations, so
clipping to "…Heavenfall…" restored the ambiguity the label existed to remove);
a zero-count band drew a 4px stub 2px shorter than one stack, at the exact
instant a consumption is meant to be legible; the band-number threshold was
measured against the strip's own span, so Fusion Burst printed `1,3,5,7` and
**read as a +2 ramp when the real curve is +1**; and the tick labels were
`toFixed(0)` of a 2.697s step, putting "3s" at 2.70s.

Final round closed the last three: the cumulative-damage chart now shares the
board's left gutter (one exported `TRACK_LABEL_WIDTH`), so the card has one
origin instead of two rulers 90px apart both reading "0s"; band counts moved to
their own overlay layer, since a 7.5px digit inside a 4.19px band lost 44% of
itself to `overflow:hidden` on the FIRST band of every ramp; and the page
reserves 76px for the sticky stat strip, which was covering the ruler and the
whole Fusion Trail row (43.9px of measured overlap — the 6px I first added was
useless against a 46px fixed overlay).

**Deliberately NOT fixed:** height is still normalised per lane, so shapes are
not comparable across rows. Normalising globally would flatten every short-cap
status into an unreadable sliver, and the printed counts now carry the value.

**[Logic Altered]** `enemy-status.js`: `activeUntil` per lane; `cap` +
`detonatesAtCap` on status lanes, not just marks; `markEventsFor` split into
`stacksAt` (what the consuming cast READS and spends) and `heldAt` (what the
enemy is LEFT holding — what to draw), because those legitimately differ AT a
consumption. `buff-bar.js`: `renderTrackBoard`, `stackBandsFromSamples` carrying
`count`. `rotation.js`: grouped strips, short key labels, consumption markers,
the fixed-crit note.

**[Verification Method]** `npm test` 59/59, sweep 66, lint 0 errors. The audit
independently re-ran the suite, swept **165 label lines across the 14 busiest
boards** (0 clipped), and probed **53 resonators at S6** for lane anomalies
(none: every lane carries `cap` and `activeUntil`, `activeUntil ≥ firstAt`,
`peakStacks ≥ max(stacksByStepIndex)`, `peakStacks ≤ cap`). Numbers verified
equal to the engine to the digit: strip labels, `spent ×N`, per-instance tooltip
damage, donut arcs, and the skill/status split. Marker positions 52.875% and
70.18% of the track = 11.4075s and 15.1409s, matching `consumedAt` exactly.

**[Residual Risks]** The final round's three fixes are verified structurally
(rendered HTML asserted in Node: no digit inside a band, zeros dropped, whole-
second ticks, one shared gutter constant) but NOT re-checked in a browser — the
audit agent hit its session limit before that pass. Cross-lane heights remain
non-comparable by design. Everything the audit measured before that point was
confirmed green.

### Addendum 5 (2026-08-02) — not every hit inflicts

Two quick visual fixes, then OPEN-ITEMS #29: the last large source of
negative-status error, and the one the previous session stopped short of rather
than half-ship.

**The visual pair.** The track board's left column carried a name, an eyebrow
and a meta line in 250px; it now carries the NAME only, at 168px, with the rest
folded into the hover — rows drop 32px → 24px and long titles trail. The DMG
breakdown gives up 58px of width (donut 220 → 176) so the chart and the board,
which share one `TRACK_LABEL_WIDTH` gutter, get the room.

**#29 — WHICH casts inflict.** `applicationsFromSteps` counted EVERY damaging
step as an application. Cartethyia's 16-step reference rotation applied 16
stacks of Aero Erosion where her kit names three casts worth 5; Rover: Aero
applied 10 where his kit names one.

The first question was whether this is data. It nearly is: 73 buffs in the
ConfigDB carry `ExtraEffectID 5` (apply-buff) naming one of the six system
status buffs, and their third parameter is the stack count — now extracted to
`data/status-appliers.json`. But the link from a SKILL to those buffs is not
there, and that was worth proving rather than assuming: `db_skill` holds 562
exploration rows, not character skills, and an ASCII sweep of **all 482
`db_*.db` files** finds each applier referenced only from `db_buff` itself. The
grant lives in the ability blueprints. So the game says HOW MANY and the kit
text says WHICH — and the former now bounds the latter (`assertCountsAgainstGame`
throws in preprocess if a clause is read as more stacks than any applier the
game defines for that kit).

**What the derivation gets right, and the two gates that make it so.** A
description section is the whole FAMILY, so a clause is inherited by every key
in it. Both gates are needed and neither is sufficient:

| gate | what it fixes |
| --- | --- |
| **stage** — a "Stage N" clause attaches only to the key whose trailing index is N | Ciaccona's "Basic Attack Stage 4 inflicts 1 stack" was landing on stages 1-3, the aimed shot and the fully-charged aimed shot |
| **named skill**, resolved only among keys whose OWN section carries the clause | Lucilla's "While casting [Spotlight]" leaked onto Phantom Frame, which shares the section |

The second gate's scoping clause is the part that took two wrong attempts. Made
global, it swallowed clauses whose bracketed name is not the acting skill at
all: Suisui's Awakening Spring "sends Suisui into [Drizzle Stance]" (a stance)
pulled the whole Drizzle family in, and Luuk's intro "Hurl out an [Ichor Blade]"
(a projectile) handed his intro's infliction to his Forte and lost the intro.
Restricting resolution to keys whose section carries the same clause fixes both,
and a self-reference guard ("Casting **this skill** …") keeps a section's own
sentence in its section however many other things it brackets.

Four rejections drop clauses that are ABOUT a status without applying one:
negations (Yangyang: Xuanling's entire set is "does not inflict [Havoc Bane]"),
conversions (Hiyuki's Glacio Chafe → Glacio Bite), cap raises, and a teammate's
infliction the kit merely reacts to (Zani, Aemeath's Trail). Two more were added
after the first run produced junk: a capability statement ("Lynae **can** inflict
…") and a deferral ("inflict X when **the following skills** deal damage" —
Aemeath's Forte, which is exactly why she is curated). Without them Lynae would
have derived one rule for a key not in her rotation and gone from 12
applications to **zero** — a derived rule set replaces the fallback wholesale,
so a bad rule is worse than no rule.

**Result: 19 rules over 7 resonators**, each carrying the clause it came from in
`derivedFrom`. Cartethyia 16 applications → 5, Ciaccona 9 → 6, Hiyuki 20 damaging
steps → 3 inflicting casts (9 stacks, her Iai applies 3), Rover: Aero 10 → 1.
Twelve inflicters derive nothing and keep the fallback unchanged.

**Deliberately left on the fallback:** Buling's array — "inflicts 2 stacks of
[Electro Flare] … **every 2s, lasting for 24s**" is a periodic applier worth up
to 24 stacks from one cast, and reading it as a per-cast 2 would be further from
the truth than the fallback's 9. Rules with a period are the next piece of this
lane. Also left: Ciaccona's Green Tonic (one application too many), Luuk's
Aureole of Execution (described in his Basic Attack section, so 3 casts
under-apply) and Rover: Aero's variable "1 per stack removed" (1 is the floor).

**#30 got its confirmation for free.** Aemeath's Fusion Burst re-seed is buff
`1210072004`: apply `10021000`, permanent, `Period 0.2s`, requirement
`0#0#…聚爆效应` — "while the target holds 0 stacks". The kit text exactly. The
mechanic and its 1-stack size are now settled; only the stack-removal model it
needs is still missing.

**[Files Changed]** new `tools/preprocess/status-apply.mjs`,
`tools/extract/extract_status_appliers.py`, `data/status-appliers.json`,
`tests/status-apply.test.mjs`; `tools/preprocess.mjs` (load + emit),
`src/core/enemy-status.js` (`statusApplyRules` takes a dataset; curated outrank
derived; `applicationsFromSteps` gates on the inflicted set),
`src/core/team-sim.js` (pass the dataset), `src/ui/components/buff-bar.js` +
`build-editor/rotation.js` (the visual pair), `CLAUDE.md`, `docs/OPEN-ITEMS.md`.

**[Logic Altered]** `dataset.statusApplyRules` is a new compiled output.
`statusApplyRules(id, mode, dataset)` prefers a curated entry outright — it
exists where the kit states its rule somewhere the per-skill derivation cannot
see, so a derived rule for the same kit would be the weaker reading of the same
text. Derived rules cover every Resonance Mode a kit has (a mode is a build
toggle, both branches are described), so `applicationsFromSteps` now intersects
each rule's status with the chosen mode's inflicted set.

**[Verification Method]** `npm test` 60/60 (36 new assertions, over half of them
NEGATIVE — the keys that must not be present), sweep 66, lint 0 errors. LOCK A:
`statusApplyRules` is the only new top-level key; the other four that differ from
HEAD are this session's earlier uncommitted work. LOCK B measured team-by-team
BY MEMBERSHIP rather than by rank — comparing rank slots showed spurious ±90%
swings that were teams changing places. Like-for-like: **87 teams move, every one
of them DOWN, median 2.40%, p90 3.40%, max 4.79%**; 14 of 50 anchors reorder
their suggested teams. Every affected team contains a resonator that gained a
rule.

**[Residual Risks]** The derivation reads kit text, and the four residuals above
are known to be wrong in a known direction (three under-apply, one over-applies
by one). The counts are bounded by the game's own appliers but the SKILL LIST is
not, and cannot be until the ability blueprints are read. Aemeath's curated rule
is still unverified in combat (#29's earlier note stands). Team members whose
statuses interact on the shared enemy will move more than their own lane does.

**[Updated Docs]** `CLAUDE.md` gains the "a status application is a NAMED cast"
invariant; `docs/OPEN-ITEMS.md` #29 closed with its residuals enumerated and #30
gains the ConfigDB confirmation of the re-seed buff.

### Addendum 6 (2026-08-02) — closing the backlog behind the status lane

Four items, three closed and one recorded, all downstream of the #29 derivation.

**#19 was a duplicate, and closed by extraction rather than calibration.** It
asked for in-game capture of Fusion Burst and Electro Flare stack multipliers
and re-verification of Spectro Frazzle and Aero Erosion. All four had already
been settled by #28: every one of the six per-stack tables, plus each status's
cap, stack lifetime and tick period, ships in the game's own system buffs and is
read wholesale into `data/status-damage.json`. No capture was ever needed. The
stale "still uncalibrated" passage in `TEAM-EFFECT-MODEL.md` is struck through
with what the numbers actually turned out to be.

**#10 was half-fixed and half-hidden.** The raw `forte_basic` / `forte_heavy`
string stopped reaching the donut tooltip with the "Heavy Attack (Forte)" purge,
which gave both node types the label "Forte Circuit". That fix exposed the other
half of the same bug: the donut accumulated on the RAW node type, so the five
resonators whose reference rotation uses both drew **two identical "Forte
Circuit" slices**. Iuno's Forte is 68% of her damage and was drawn as a 26% arc
beside a 43% one; also Jinhsi, Cartethyia, Lumi and Rover: Havoc. `damageFamily()`
collapses the mechanical split into one display family before aggregating. The
split also risked binning each half under the 4% "Other" threshold the combined
slice clears — latent in the current rotations, not observed, and now impossible.
The guard is a live test that fails by NAME for any rotation drawing two
same-label slices; reverting `damageFamily` to identity fails it with all five.

**#29's periodic residual is done.** `applicationsFromSteps` understands
`everySeconds` + `durationS`, clamped to the rotation the same way an off-field
turret already is (`off-field.js`: the shorter of the action's duration and the
window). Buling's array lasts 24s but is cast at 6.2s of a 10.3s rotation, so
counting all 12 ticks would credit damage past the clock the DPS denominator
measures; she applies 6 stacks over 3 ticks.

Her rule is CURATED, and the reason is structural rather than a shortcut. The
sentence that applies the status reads *"**The array** deals Electro DMG and
inflicts 2 stacks of [Electro Flare] … every 2s, lasting for 24s"* — its subject
is a summon, and the cast that creates it is named only in the sentence before.
Section scoping therefore hands the clause to both her Forte keys, and the wrong
one of the two is the array's own per-tick DAMAGE row rather than the cast that
places it. Resolving that automatically needs cross-sentence subject resolution
for the ONE kit that has it (a roster sweep found no other periodic infliction
clause), so the derivation keeps rejecting periodic clauses outright and
`STATUS_APPLY_RULES` states this one — the same escape hatch, and the same
justification, as Aemeath's.

**#31 is new, and deliberately not solved.** Making Buling's applications
faithful surfaced a modelling boundary that was already there: DoT damage is
credited only for ticks landing inside the rotation window, so a status applied
late in a short rotation deals **nothing at all**. Buling lands Electro Flare at
6.2s and it ticks every 5s against a 10.3s rotation; Rover: Aero is the same
shape (Aero Erosion at 7.4s, 3s tick, 9.2s rotation). Both zeros are correct for
a fight that ENDS at the last cast and wrong for the repeating cycle a reference
rotation actually represents. Solving it means deciding what a rotation IS — one
cycle of a loop, or a whole fight — which equally governs buff uptime and
cooldown carryover, so it is recorded rather than guessed at. What DID ship is
the mitigation the project's own rule demands: the zero is no longer silent. It
carries a measured reason naming both instants the reader needs to check it
("applied at 6.2s, but it ticks every 5s — the rotation ends at 10.3s, before
the first tick"), and the build page already renders `gap.reason`. Note the two
directions are not symmetric: crediting ticks past the window would inflate DPS
against a denominator that stops at the last cast, so the current under-count is
the conservative side to be wrong on.

**[Files Changed]** `src/core/enemy-status.js` (periodic rules + clamping,
Buling's curated rule, the stranded-tick gap reason),
`src/ui/components/build-editor/shared.js` (`damageFamily`, `forte` family entry
in `TYPE_LABEL`/`STEP_TYPE`), `build-editor/rotation.js` (donut aggregates by
family), `tests/status-apply.test.mjs` (+10), `tests/build-editor-v2.test.mjs`
(+5), `docs/OPEN-ITEMS.md`, `docs/TEAM-EFFECT-MODEL.md`.

**[Logic Altered]** An apply rule may now carry `everySeconds`/`durationS`; a
rule without them behaves exactly as before (one application per qualifying
cast, asserted). Donut slices key on the damage FAMILY, not the mechanical node
type. `soloStatusDamage` emits a gap for a calibrated, applied status whose
first tick falls outside the rotation.

**[Verification Method]** `npm test` 60/60, sweep 66, lint 0 errors. The donut
test was negative-controlled: reverting `damageFamily` to identity fails it and
names all five offenders. LOCK A: one line (the manifest hash). LOCK B measured
by team MEMBERSHIP — **19 entries move, every one of them containing Buling, all
down 1.6-3.1%**, which is the exact blast radius of the one rule that changed.

**[Residual Risks]** #31 stands: two reference rotations show an applied status
dealing zero, now explained rather than hidden. Buling's periodic rule assumes
the array is placed once per cast of Harmony; a rotation placing both her Forte
keys still models one array, because only the placing cast carries the rule.

**[Updated Docs]** `docs/OPEN-ITEMS.md` — #10 and #19 closed, #29's periodic
residual struck through and resolved, #31 added; `docs/TEAM-EFFECT-MODEL.md` —
the stale calibration passage struck through with the extracted outcome.

### Addendum 7 (2026-08-02) — what a rotation IS, answered per surface

#31 asked a question the engine could not answer on its own: is a rotation one
cycle of a loop, or a whole fight? The maintainer answered it per surface — a
single rotation attributes only what falls inside its own window; the team sim's
up-to-3 passes ARE the loop, and effects, buffs and debuffs must propagate from
one pass into the next.

That splits into three lanes with three different owners, and the useful part of
this session was finding out that **two of them were already correct** and only
the third was broken — the opposite of what the truncated window data suggested.

| lane | owner | state |
| --- | --- | --- |
| debuffs | one global enemy timeline built from every pass's applications | already correct |
| team-wide buffs | the shared team-buff timeline, opened `[fireEnd, fireEnd + seconds]` **unclipped** | already correct |
| a member's OWN timed effects | each segment's isolated `simulateRotation` | **broken** |

Both "already correct" verdicts are measured, not assumed. Status share of team
damage rises **77% → 81% → 83%** across three passes as stacks compound on the
shared enemy. A member's damage is flat cold on pass 1 and identical on passes 2
and 3 — the settled loop — with Zhezhi **+20%** on pass 2 once teammates' still-
live windows cover her.

**The real gap, and why it was nearly invisible.** Each member's segment is an
isolated `simulateRotation` over local time. A 30s self-buff opened late in pass
1 was truncated at the segment boundary — `deriveEffectWindows` closes anything
still open at the last step with `endReason: 'rotation end'` — and then silently
restarted from nothing when the member swapped back in. The first probe for
surviving windows found **zero**, which was misleading: the information needed
to detect the loss had already been destroyed upstream by the clipping. What
gave it away was that every bounded window in the dataset ends at exactly
`totals.time`. Zhezhi's 27s window reports 4.3–11.4 in an 11.4s rotation.

**The fix carries the trigger-fire ledger, not the windows.** A `seconds` window
is evaluated from when its trigger last fired, so `simulateRotation` now accepts
`carryInFires` and returns the ledger it ends with; team-sim hands each member
their own ledger shifted into the next segment's frame, where a fire from an
earlier pass lands at a NEGATIVE local time. Nothing has to be forced open, no
window has to be reconstructed, and the freeze-aware gameTime semantics keep
working untouched — the existing window logic simply sees a trigger that fired
15.6s ago instead of never.

Fire COUNTS deliberately do NOT carry. Carrying them would change what "the Nth
cast" triggers read on every pass, which is a far larger blast radius than the
residual-window problem being solved.

**Impact:** 4 of 22 reference teams gain up to **+1.71%** — Encore's S4, a 30s
Fusion DMG Bonus that now survives his swap-out. Every move is positive, which
is the only direction a recovered buff can have. Solo is untouched by
construction (`carryInFires` defaults to null) and the meta does not move.

**The single-rotation half needs no code.** Buling's and Rover: Aero's zeros are
correct and stay: a status applied at 6.2s that ticks every 5s genuinely deals
nothing before a 10.3s rotation ends. They keep the measured reason added
earlier rather than being hidden, and the asymmetry is worth restating — crediting
ticks past the window would inflate DPS against a denominator that stops at the
last cast, so under-counting is the safe side.

**[Files Changed]** `src/core/sim.js` (`carryInFires` in, `fires` out),
`src/core/team-sim.js` (`memberFires` + `shiftFiresToLocal`/`shiftFiresToTeam`),
`tests/team-sim.test.mjs` (+10), `docs/OPEN-ITEMS.md`.

**[Logic Altered]** `simulateRotation` seeds `lastFireEndByType`/
`lastFireEndByKey` from `carryInFires` and reports its ending ledger. Team-sim
keeps a per-member ledger in team time and threads it across that member's
passes. No other caller passes the option, so every non-team sim is bit-identical.

**[Verification Method]** `npm test` 60/60, sweep 66, lint 0 errors. The
cross-pass test is negative-controlled: disabling the carry-in fails "a timed
self-effect can arrive already open on a later pass" and nothing else. Impact
measured by A/B — the same 22 teams simulated with the carry-in enabled and
disabled, differing on 4. LOCK B: no meta movement (the optimizer's own builds
and derived openers do not hit the affected effects).

**[Residual Risks]** Fire counts not carrying is a deliberate asymmetry: a kit
whose effect genuinely depends on a cumulative cast count across passes will
still read only the current pass. A teamWide + `selfApplicable` effect could in
principle now reach its wielder through both the shared timeline and their own
carried ledger; none of the effects observed carrying are team-wide (all have
`scope: undefined`), but this is the shape to watch if double-counting ever
appears.

**[Updated Docs]** `docs/OPEN-ITEMS.md` #31 resolved, with all three lanes and
the measured evidence for each.

### Addendum 8 (2026-08-03) — benchmarked against Prydwen and Arabwuwa

The maintainer supplied two external references for Aemeath — Prydwen's per-
sequence numbers with a stated loadout, and Arabwuwa's 83,009 TEAM DPS for her
Fusion Burst team — explicitly as a DIRECTIONAL benchmark, not a source of
truth. Comparing against them found four real defects, two of which have nothing
to do with Aemeath.

**The timing model needs nothing.** Our game time for her reference rotation is
**11.54s against Prydwen's 11.69s** — 1.3% apart, confirming their figure is
game time and validating the extraction lane end to end. Our wall clock for the
same rotation is 21.57s; the two Liberation animations she freezes are almost
exactly the difference.

**Defect 1 — the build page reported the wrong clock.** It showed `totals.time`
(wall clock) beside a DPS that `simulateRotation` computes on the freeze-excluded
clock, so damage / displayed-time did not equal the displayed DPS. It now reads
`TIME · GAME (21.6s REAL)`, mirroring the team page's existing chip.

**Defect 2 — a named DMG-multiplier clause was applied to its whole CATEGORY.**
The kit names one move: *"The DMG Multiplier of Resonance Skill Seraphic Duet:
Overture is increased by 100%"*. `detectSkillType` reduced that to `'skill'` and
dropped the name, which is wrong twice over — sibling clauses stack onto each
other, and they land on every step of the category. Measured on Aemeath: her S2
gave **+200% to all four Mech skill steps and nothing at all to either Seraphic
Duet** (the Duets are `forte_heavy` nodes, so the category never even matched the
skills the clause names), and her S3 gave **+140% to BOTH liberations** where the
kit says Finale +100% and Overdrive +40%. Her S2→S3 jump read 2.36x against a
reference of ~1.25x. `tools/preprocess/multiplier-scope.mjs` now binds each
clause to the keys it names (34 roster-wide); a name that resolves to nothing is
left category-scoped, so a kit this cannot read is never made worse.
Verified per step: the Duets alone double at S2, and Finale/Overdrive now differ
by exactly 1.43 — the 2.0/1.4 ratio the kit states.

**Defect 3 — "All-Attribute DMG Bonus" parsed to nothing, for five kits.** The
parser had an element branch and a skill-type branch; the game's phrase for a
bonus scoped to NOTHING matched neither. It also has to be tested BEFORE the
scoped branches and exclude them, because the sentence that grants it usually
also names the casts that trigger it — `detectSkillType` reads 'skill' out of
that trigger list and would shrink a bonus on everything to one category.
Aemeath, Chisa, Galbrena, Rebecca and Lucy all state it; none parsed before.

**Defect 4 — the one that has nothing to do with Aemeath.** `condition` is
truncated to 120 characters for DISPLAY, and a grant sentence says its recipient
LAST. `isTeamWideBuff` read that truncated text, so **5 effects were silently
scoped to self when the kit says team** — including **both of Verina's** (her
+20% team ATK and +15% element bonus), plus Jiyan's and Mornye's. Team-wideness
is now decided at parse time from the whole clause and stored on the effect
(`effect.teamWide`, read via `effectIsTeamWide`); 23 effects flag team-wide
across 22 resonators. The team bundle also had no bucket for an unscoped bonus —
`amplifyAll` existed, `dmgAll` did not — so even a correctly classified
all-attribute bonus had nowhere to land.

**Label purge finished (partially).** "Heavy Attack (Forte)" survived the earlier
pass on 56 labels because the annotation was glued to the CATEGORY prefix, which
is exactly what makes Forte read as a kind of Heavy Attack. It is now a trailing
provenance marker — `Heavy Attack: Flamewing Verdict Stage 1 · Forte Circuit`.
It cannot simply be deleted: Cartethyia has both a normal Basic Stage 1-4 and an
enhanced Forte Basic Stage 1-5, and dropping it collides those four pairs. 0
duplicate labels roster-wide, and a test now forbids any `(Forte` parenthetical.
**19 Echo-only labels** ("Basic Attack (Echo): …") go through a different code
path and still carry theirs — same class, not done.

**Where the numbers stand.** Sequence shape, which is gear-independent and so the
honest diagnostic:

```
ours   : 1.00  1.00  1.24  2.59  2.87  2.87  4.05
prydwen: 1.00  1.08  1.32  1.65  1.72  1.72  3.20
```

Team, both sides with their own stated loadouts, Aemeath moving last:
**ours 35,191 vs Arabwuwa's 83,009 at S0 (2.36x).** Today's fixes are S4+ only,
so they do not move that number.

**[Files Changed]** new `tools/preprocess/multiplier-scope.mjs`;
`tools/preprocess/effects.mjs` (all-attribute branch, stored `teamWide`),
`tools/preprocess/skill-rows.mjs` (provenance marker),
`tools/preprocess/status-apply.mjs` (exported name helpers),
`tools/preprocess.mjs`; `src/core/buffs.js` (`skillKeys` gate on multiplierUp,
`dmgAll` bucket, `effectIsTeamWide`), `stats.js`, `formula.js`, `skill.js`,
`sim.js`, `live-weights.js`, two build-editor panels, `rotation.js`
(`timeChipLabel`); tests in conditional-effects, sim-enrichment.

**[Verification Method]** `npm test` 60/60 (+8 assertions), sweep 66, lint 0
errors. LOCK B vs HEAD: **36 teams move — 9 UP, all Verina's (+4% to +8.26%), 27
DOWN** from the multiplier over-application being removed; median 1.59%, p90
5.24%. The Verina gains are the team-wide fix corroborating itself.

**[Residual Risks]** S1 is still unmodelled (needs an "Instant Response" state
plus a crit-DMG effect scoped to two named Heavy Attacks). S3 remains ~1.6x hot
after the scoping fix, so something else in that node over-applies. The
Arabwuwa rotation was NOT run: their step names ("Tune Break", "Forte Skill",
"Hold Basic") need mapping to our keys, and a number resting on a guessed
mapping would be worse than none. The team gap at S0 is unexplained.

**[Updated Docs]** this entry; `docs/OPEN-ITEMS.md` gains #32.

**Addendum 8 correction (2026-08-03):** re-measured under Arabwuwa's own stated
conditions (level 100 boss, 20% RES, their standardized substat budget) the team
gap is 2.90x on DPS, not the 2.36x first reported against an easier target — and
it is UNIFORM: Aemeath 2.58x, Denia+Chisa 2.64x, team 2.60x, while rotation time
agrees to 2% and the damage SHARE across the three kits agrees to 0.4%. That
shape rules out a missing per-kit mechanic as the primary cause and points at a
global factor in the damage path. See OPEN-ITEMS #32.

### Addendum 9 (2026-08-03) — an in-game capture settles three mechanics

The maintainer ran a controlled test: S6 Aemeath, solo, ToA, enemy Lv100, with a
stated character sheet (ATK 2470, Crit Rate 62.2%, Crit DMG 255.2%, Fusion DMG
82.0%). The predicted-vs-observed reconciliation found three defects and, just as
usefully, PROVED several things correct that the previous session had suspected.

**What the capture proved RIGHT.** The affliction formula, the burst tables, the
2.4x affliction crit, DEF at Lv100 and the RES model all reproduce the game to
the digit once the right table is picked:

| observed | consumed stacks | our table `1210072025` | our value | observed |
| --- | --- | --- | --- | --- |
| hit A (crit) | 18 | 7.7 | 77,228 non-crit | 77,228 (212,376 / 2.75) |
| hit B (non-crit) | 34 | 10.1 | 101,299 | 101,299 |

Both exact. The earlier "we are 2x low on magnitude" reading was a scratch-pad
error on my side — I had hand-picked the BASE table; the engine picks the
Stardust one correctly. **The damage path was never the problem.** Two further
confirmations fell out of the same arithmetic: the ToA floor is 20% RES, and the
`278,572 / 101,299 = 2.7500` ratio identifies the big hits as AFFLICTION damage
running on Aemeath's fixed 275% (S6), not on her sheet crit.

**Defect 1 — a sequence node that REPLACES an inherent was stacking with it.**
Aemeath S3 says *"Inherent Skill Between the Stars is replaced with the following
effects"*, and the replacement restates the inherent's Crit DMG buff at a higher
value (+60% vs the inherent's +30%). Both were being applied, putting every crit
at 3.452x her sheet where the game measures **3.1515x** (2849 / 904) — her sheet's
2.552 plus the replacement alone. `tools/preprocess/inherent-replace.mjs` reads
the clause, resolves the named inherent, and stamps `replacedByChain`;
`unlockedEffects` skips it at or above that level. After the fix we compute
**3.1520x**. The maintainer's second observed value falls out too: at S2, before
the replacement exists, we give 2.8520x against their measured 2.840x.
One node in the roster does this, and the link is read rather than curated.

**Defect 2 — Fusion Trail was consumed by every cast, so it never compounded.**
The maintainer established the rule by direct test: *normally* every enhanced
skill cast removes all Fusion Trail, but **inside Stardust Resonance the stacks
survive the FIRST cast** and are only removed by the second — the same cast that
spends the state's 2-cast budget and ends it. That is what the footage showed:
8 → 18 (detonated, not consumed) → 24 → 34 → 0. `markEventsFor` now spares the
first consuming cast inside each empowering window (`markEmpowerWindows`, shared
with the burst's table pick so the two can never disagree about whether the state
was open). The second burst of her reference rotation went from reading 14 stacks
to **24** (170,903 → 207,009); her status total rose 337,393 → **373,500**.
The compounding is the point: the table is steeply stack-scaled, so the spared
cast makes the NEXT detonation bigger too.

**Defect 3 — the burst reset to zero; the game leaves one.** Observed: the
counter climbs to 5, the next application briefly shows 6 and detonates, and the
target is left holding **1**. That is OPEN-ITEMS #30's re-seed (*"when the
[Fusion Burst] … reaches 0 stacks, inflict 1 stack"*, buff 1210072004) firing
immediately — previously unmodelled, now confirmed by observation and modelled as
`reseed` on the burst rule. It matters for RATE, not display: each cycle then
needs 5 further applications rather than 6.

**What is still short, and it is now narrow.** Our first burst reads 10 Trail
stacks where the capture shows 18. The 8-stack difference is Trail already
standing before the cast — 4 prior Fusion Burst applications at +2 each (S6). So
the remaining gap is isolated to the **Fusion Burst application RATE**
(`STATUS_APPLY_RULES[1210]`: eight named skills, 3s ICD), which is the one part
of this chain still unverified against the game.

**[Files Changed]** new `tools/preprocess/inherent-replace.mjs`;
`src/core/enemy-status.js` (`markEmpowerWindows`, spared consumption, `reseed`),
`src/core/buffs.js` (`replacedByChain` gate), `tools/preprocess.mjs`;
`tests/conditional-effects.test.mjs` (+6), `tests/enemy-status.test.mjs`.

**[Verification Method]** `npm test` 60/60, sweep 66, lint 0 errors. Every fix is
pinned to a measured number rather than to a reading of the kit text: the crit
test asserts 2.552 + 0.60 = 3.1520 against the captured 3.1515, and the Trail
test asserts exactly one consumption across the two Duets in her reference
rotation.

**[Residual Risks]** The Fusion Burst application rate is unverified. The spared-
consumption rule is modelled as "first consuming cast inside an empowering
window", which matches the capture but is generalised from one kit. `reseed` is
Aemeath-only and does not fire in her short solo rotation (one burst), so its
effect shows only in longer/team runs.

### Addendum 10 (2026-08-03) — a cast-by-cast capture closes the application rate

The maintainer ran one more controlled ToA rotation on their S6 Aemeath and
reported the enemy's Fusion Burst / Fusion Trail counters after every cast. The
enemy already held 1 FB / 2 FT from a teammate, so the reading is on the deltas:

| cast | FB | FT | delta |
| --- | --- | --- | --- |
| Res. Lib. Overdrive | 1 | 2 | — nothing |
| Basic - Mech Stage 3 | 2 | 4 | +1 / +2 |
| Basic - Mech Stage 4 | 3 | 6 | +1 / +2 |
| Enh. Res. Skill (Duet) | 3 | 16 | +0 / +10 |
| Basic - Aemeath Stage 3 | 4 | 18 | +1 / +2 |
| Basic - Aemeath Stage 4 | 5 | 20 | +1 / +2 |
| Enh. Res. Skill (Duet) | 5 | 0 | consumed |
| Basic - Mech Stage 3 | 6 → **1** | 2 → **4** | detonation + re-seed |
| Basic - Mech Stage 4 | 2 | 6 | +1 / +2 |
| Enh. Res. Skill (Duet) | 2 | 0 | consumed |
| **Enh. Heavy Attack** | **3** | **2** | **+1 / +2** |

Nine of those eleven rows the sim already produced. The two it did not are the
findings, and a third fell out of reconciling the numbers.

**Finding 1 — a second applier, granted by a sequence node.** Her Forte names
eight skills and the Heavy Attack is not among them. S3 is: *"In [Instant
Response], Aemeath now inflicts … [Fusion Burst] on nearby targets while casting
[Heavy Attack - Aemeath] or [Heavy Attack - Mech]."* `STATUS_APPLY_RULES` gained
`minChain` and `state` so a rule can carry the gates its kit states, `sim.js`
stamps each step's active states, and the applier fires exactly where the capture
shows it. At S2 the Heavy applies nothing, which is also the kit.

**Finding 2 — the on-cast grant lands BEFORE the cast reads it.** The previous
session stamped S6's *"While casting Seraphic Duet, inflict 10 stacks of Fusion
Trail"* a hair AFTER the cast, calling it the conservative reading of "while
casting". Two captures settle it in the other direction, and both are exact:
8 Trail standing → Duet → burst priced at **18** (212,376 observed); 24 standing
→ Duet → priced at **34** (101,299). The cast spends its own grant. The old
reading was short by a whole grant on every Duet.

**Finding 3 — the re-seed is itself an infliction.** 6 FB / 2 FT detonated to
**1 FB / 4 FT**: the stack the burst puts back is a Fusion Burst infliction, and
an infliction grants the mark like any other (2 at S6). `burstInstants` is now
one shared counter for the damage lane and the mark, which matters because the
damage lane SKIPS Fusion Burst (it has no per-stack table) while the mark still
needs its re-seeds.

Reconciling the last row also exposed an ordering bug with nothing to do with
Aemeath: a step's start time IS the previous step's end time, so a consumption
and the next cast's application share one number, and the application was being
wiped by a consumption it comes after. Encoding that order as a tiny time offset
cannot work — the offset must be smaller than any real gap between steps and
larger than the sampler's "at this instant" tolerance, and no value is both. It
is now an explicit `EVENT_ORDER` (cast grant → consumption → application).

**S1 and its inherent, which had parsed to nothing.** *"In Instant Response,
Heavy Attack - Aemeath and Heavy Attack - Mech gain 300% Crit. DMG increase"* and
*"…gain 200% DMG Amplification"*. Both failed for one reason: the value PRECEDES
its keyword and `pctNear` only ever looks forward. Reading them is half the fix —
unscoped, a +300% Crit. DMG lands on every hit she makes. So
`multiplier-scope.mjs` became `skill-scope.mjs` and learned the SUBJECT form
("X and Y gain …") beside the TARGET form it already read, plus the state a
clause's leading "In X," gates it behind — matched against the states the
resonator actually DECLARES, so a Resonance Mode can never be read as a state.
`resolveChainInherentContext` now honours `skillKeys` for every stat rather than
`multiplierUp` alone, and once the names have matched they ARE the scope: the
category read off the same clause can contradict them outright, since her Heavy
Attacks are "considered Resonance Liberation DMG" and so parse `skillType:
'heavy'` while their hits carry 'liberation'. Measured on one Heavy: **606 →
1,819 at S0** (the inherent's ×3 alone) **→ 2,461 at S1**, every other step
unchanged. Two effects roster-wide bind by subject, both hers — the resolver
returns nothing for "Resonators in the team", which is what keeps the pass safe.

**A wrong number in S3.** Its `amplify` read **60%** where the kit says 25%: the
node states two effects in one sentence (*"Crit. DMG is increased by 60%, and …
Finale DMG is now Amplified by 25%"*) and the branch's last-resort bare `by`
matched the earlier phrase. Now read in order of specificity.

**Labels.** The Forte half of the provenance purge shipped last session; 19
labels still read "… (Echo)". "Forte Circuit (Echo)" is the same backwards
qualifier — an Echo skill is a normal skill of its category that this resonator
happens to reach through an Echo — so provenance is now a trailing marker in ALL
cases. 25 labels carry `· Echo`, 7 of those `· Forte Circuit · Echo`, and they
stay unique per resonator, which is why the marker cannot simply be dropped.

**[Files Changed]** `src/core/enemy-status.js` (`burstInstants`, `EVENT_ORDER`,
`minChain`/`state` on apply rules, re-seed → mark), `src/core/sim.js` (per-step
`states`), `src/core/skill.js` (`skillKey` to both lenses), `src/core/buffs.js`
(`skillKeys` for every stat), `src/core/rotation-rules.js` (Instant Response),
`src/core/team-sim.js`; `tools/preprocess/multiplier-scope.mjs` →
`skill-scope.mjs`, `tools/preprocess/effects.mjs` (`pctGained`, amplify order),
`tools/preprocess/skill-rows.mjs` (trailing provenance),
`tools/preprocess/status-apply.mjs` (`nameTokens` option), `tools/preprocess.mjs`,
`tools/optimize.mjs` + `tests/meta-schema.test.mjs` (ENGINE_FILES now covers the
state/resource machinery — a state changes damage, so the hash must move with
it); `tests/status-apply.test.mjs` (+8, the measured rotation),
`tests/conditional-effects.test.mjs` (+9), `tests/enemy-status.test.mjs` (+5),
`tests/sim-enrichment.test.mjs` (+2), `tests/effect-windows.test.mjs`.

**[Verification Method]** `npm test` 60/60, sweep 66, lint 0 errors. The
application model is asserted against the capture cast by cast — which casts
apply, which do not, and the seven applications the run produces. LOCK B:
**34 teams move, ALL up, median 3.11%, max 4.42%**, every one of them containing
Aemeath; no other character's teams move and no team-set reorders.

**[Residual Risks]** `Instant Response` is entered on the Overdrive cast, as
Stardust Resonance is — the Resonance Rate limit that gates it in game is a
resource the rotation is authored to reach, not something the sim checks. The
subject-form scoping is generalised from two clauses; it binds nothing else
roster-wide today, so a future kit is its first real test. Whether S3 is still
hot against the reference has not been re-measured, and the uniform ~2.6x team
gap in OPEN-ITEMS #32 is untouched by any of this.

## 2026-08-04 — Suggested-team honesty split, signature-weapon defaults, and replacing Duplicate/Delete with Save-gated autosave + Reset

Five requests in one session: a search-bar bug report, the Suggested Teams
card's numbers, fresh-resonator defaults, and reworking the editor's
Duplicate/Delete pair. Four shipped; the bug report was investigated hard and
explicitly deprioritized by the maintainer rather than fixed blind.

**1. Search bars "stop working," symptom "box becomes uninteractable/invisible," no repro.**
Live-drove the app (Playwright + real Chrome, headless) through every search
surface — roster, weapon/build-switcher picker, echo picker, team-slot picker,
compare picker — under adversarial sequences: rapid typing, reopening pickers,
navigating away via the nav bar while a floating menu (sonata quick-switch,
rotation/echo-load menu) was still open, hovering a tooltip and forcing a
repaint mid-hover. Every scenario self-healed or worked. Two real, narrower
defects surfaced but were NOT fixed (deprioritized — maintainer confirmed "I
can't replicate it myself either," and asked to drop it):
  - `compare-v2.js`'s `paint()` never calls `hideTooltip()`, unlike
    `team-editor-v2.js` and the build editor's `closeFloatingMenus()` — this is
    the exact bug CLASS documented at 2026-08-01 §4 (a body-appended floating
    layer surviving a repaint, sitting at `pointer-events:auto` over live
    content). It happened not to reproduce in Chromium because the browser
    fires a synthetic `mouseout` when a hovered element is removed from the
    DOM — a guarantee Firefox/Safari may not share.
  - `menus.js`/`sonata-quickswitch.js` register `document`-level CAPTURE-phase
    `mousedown`/`keydown` listeners while a floating menu is open, closed only
    by their own `close*()` functions; `app.js`'s `resetRoot()` (on every
    navigation) removes the menu's DOM node directly via `querySelectorAll`,
    bypassing `close*()` — the listeners leak. Self-heals on the next
    `mousedown` almost always, EXCEPT keyboard-only navigation (Tab+Enter on a
    nav link, no mousedown), which is the one path that would leave it
    dangling.
  Recorded here for whoever reopens this — both are legitimate latent bugs,
  just unconfirmed as *this* report's cause.

**2. Suggested Teams (build page) showed 3-pass, openers-ON numbers.**
`tools/optimize/team-rank.js`'s `scoreTeam()` used ONE sim run — multi-pass,
derived-openers-ON (the 2026-07-12 ranking-honesty pass) — for BOTH ranking
candidates AND the transparency numbers rendered on the card, even though the
card's own footnote already claimed "one rotation, carry plays last." Split
into `rankingDamage` (the unchanged openers-ON multi-pass figure, ranking-only,
never displayed, dropped before the meta is serialized) and a new `displayRun`
— default `simulateTeamRotation` params (`passCount` 1, `deriveOpeners` false,
`timingMode` 'toa' → game time) — feeding `teamDamage`/`teamTime`(now
`gameTime`)/`teamDps`/`teamHeal`/`teamShield`/`perMember`. Card footnote
updated to say so explicitly. Regenerated `data/wuwa-meta.json`; the 6 covered
anchors' card numbers dropped ~3× (one rotation instead of three) — ranking
order (`score`, curated-pin-first) is untouched, since it still keys off
`rankingDamage`.

**3. A fresh/empty resonator opened to a blank page.**
`showEditorForNew` called plain `createBuild(resonator)` — no weapon, no
echoes, no rotation — for every roster click. Now pre-fills, best-effort per
field:
  - **Weapon → the resonator's own signature weapon**, not a min-maxed pick.
    New `resonator.signatureWeaponId`, sourced from nanoka's own
    `recommend.weapon[0]` — verified roster-wide (56/56) to always be a 5★
    weapon of the resonator's own `weaponType` (Carlotta → The Last Dance,
    Changli → Blazing Brilliance, …). Data-driven; no name/regex matching
    needed, despite the request half-expecting to need it. Wired as a
    post-merge enrichment pass in `tools/preprocess.mjs` (reads each
    resonator's already-fetched nanoka JSON directly, independent of whether
    the BinData/Dimbreath or nanoka-full pipeline built that resonator's core
    projection — `recommend` only ever lives in the nanoka file).
  - **Echoes → the sonata + template mains the sim's suggested build uses**
    (`suggestedBuildFor`/`applySuggestion`, meta-covered anchors only).
  - **Rotation → the reference rotation, if curated** (`resolveReferenceRotation`,
    a new pure function in `meta-loader.js` extracted from the build-editor's
    existing api-coupled `referenceRotationFor` — needed pure because app.js
    calls it in `showEditorForNew`, BEFORE the build-editor module is even
    mounted).
  New `defaultFreshBuild()` (`suggested-teams-panel.js`) composes all three;
  the signature weapon always overrides whatever `applySuggestion` equipped.
  Applied once, at build CREATION — an already-existing build the user has
  since emptied back out is left alone (RESET, below, is the explicit
  re-apply).

**4/5. Duplicate/Delete → Save-gated autosave / Reset.**
Two behavior changes bundled because they share one root cause: today, ANY
edit to ANY build — including a fresh one the user is just glancing at —
autosaves 400ms later, unconditionally. Requested instead: a fresh build stays
in-memory-only until the user deliberately clicks a save action; only then
does autosave arm for that build.
  - **DUPLICATE → "Save & add to My Builds."** Prompts (`prompt()`, matching
    the existing `confirm()`-for-delete convention) for a name, defaulting to
    the build's current name (itself the resonator's name until edited —
    literally satisfies "default resonator name filled in"). Renames via the
    normal `commit()`/`setName()` path (UI stays in sync), then a new
    `onSaveAndAdd` app.js callback force-persists immediately and sets
    `buildSaved = true`. `handleBuildChange` now checks `buildSaved` (computed
    from `!!readBuild(id)` on every editor visit) before scheduling the
    autosave debounce at all — unarmed, an edit updates `currentBuild` in
    memory and nothing else. The old "Duplicate" (clone under a new id) is
    gone from the editor page; My Builds' own independent Duplicate button
    already covers that use case, untouched. Removed the now-fully-unreachable
    duplicate-guardrails subsystem from `storage.js`
    (`duplicateBuildWithGuardrails`, the rate-limit/cap bookkeeping it
    existed solely to protect) — dead code once its only caller was deleted.
  - **DELETE → "Reset."** A small anchored 3-option menu (Reset to Template /
    Reset to Empty / Cancel) — new `openResetMenu`/`closeResetMenu` in
    `menus.js`, added to `closeFloatingMenus()`'s teardown list (per the
    "ONE list" warning already on that function, from the 2026-08-01 §4 bug).
    Replaces the build's CONTENT in place (same id/name/createdAt) via the
    SAME `defaultFreshBuild`/`createBuild` a brand-new resonator gets, or a
    fully blank build — routes through `commit()`, so it obeys the same
    armed/unarmed autosave gating as any other edit. Outright deletion is now
    exclusively a My Builds page action (already existed there).

**[Files Changed]** `tools/optimize/team-rank.js` (ranking/display sim split),
`tools/optimize.mjs` (comment only — field names unchanged), `tools/preprocess.mjs`
(`signatureWeaponId` enrichment pass); `src/data/meta-loader.js`
(`resolveReferenceRotation`), `src/data/storage.js` (removed dead duplicate-
guardrails subsystem); `src/ui/app.js` (`buildSaved`, `defaultFreshBuild` wiring,
`onSaveAndAdd` replaces `onDuplicate`/`onDelete`), `src/ui/components/build-editor/bind.js`
(save-build-prompt / reset-build handlers), `index.js` (mount signature,
resetMenu state fields, `__test__` export), `menus.js` (reset menu),
`resonator-card.js` (button labels/acts), `shared.js` (`referenceRotationFor`
now delegates), `suggested-teams-panel.js` (`defaultFreshBuild`),
`src/ui/components/suggested-teams.js` (footnote text); regenerated
`data/wuwa-data.json` (`signatureWeaponId` × 56), `data/wuwa-meta.json`
(display-sim numbers), `data/data-version.json`. Tests:
`tests/build-editor-v2.test.mjs` (+2 blocks — signatureWeaponId roster-wide,
`defaultFreshBuild` covered/uncovered), `tests/team-rank.test.mjs`
(rankingDamage vs. displayRun exact-match lock), `tests/meta-schema.test.mjs`
(`rankingDamage` must not leak into the persisted meta).

**[Verification Method]** `npm test` 60/60 (3 new/extended test blocks),
`npm run sweep` 66 modules 0 failed, `npm run lint` 0 errors. Live-verified
every UI behavior via Playwright against a real served instance (not just
unit tests): fresh-resonator defaults (Carlotta → The Last Dance signature +
5 real echoes + 14-step rotation, all visible and simmed), Suggested Teams
card numbers dropping to single-rotation scale with the updated footnote,
"Save & add to My Builds" prompt/toast/My-Builds-listing round trip, no
autosave toast on an unsaved draft edit vs. one firing after Save & Add,
and all 3 Reset menu outcomes (Cancel/Empty/Template) changing echo/weapon
state correctly.

**[Residual Risks]** The search-bar report is unresolved by design (deprioritized,
not fixed) — the two latent defects above are real but unconfirmed as ITS
cause; if it resurfaces, start there. `defaultFreshBuild`'s echo/rotation
legs are silent no-ops for the 50/56 resonators outside the P12 meta's 6
covered anchors (matches existing, documented scope — not a regression).
Clicking "Save & add to My Builds" on an ALREADY-armed build is a harmless
rename-and-resave, not disabled/hidden — intentional, but a repeat click
doesn't visually distinguish "first save" from "renamed."

**[Updated Docs]** `docs/HISTORY.md` (this entry). No CLAUDE.md invariants
changed; the new `signatureWeaponId` field and the ranking/display sim split
are implementation detail behind already-documented UI, not new invariants.

## 2026-08-04 — Same-day follow-up: fresh-build coverage, a prompt() that never fired, and scroll carrying across pages

Three maintainer reports against the work above, landed within the hour.

**1. "Many resonators have no echoes equipped at all, those that do have no rolled substats."**
`defaultFreshBuild` sourced echoes from `suggestedBuildFor` alone — the P12
solo-suggestion pass, which covers exactly **6** resonators (the P12 anchor
set), and which deliberately leaves substats blank (that path also serves the
manual "APPLY SUGGESTED BUILD" button, where blank-for-the-user-to-roll is
correct). Every OTHER resonator got no echoes at all. The P13 team pass's
per-member recipes (`teamMemberBuildFor`, `meta.teams.memberBuilds`) were
sitting right there, unused by this path, covering **53/56** — and carrying
REAL co-optimized substats (`representativeMemberBuild`'s `allocateSubstats`
output), not blank ovals, because that recipe is meant to be immediately
simmable. `defaultFreshBuild` now tries the recipe FIRST
(`teamMemberBuildFor`/`applyTeamRecipe`), falling back to the solo suggestion
only when no recipe exists — which today never happens for a currently-
covered resonator (all 6 P12 anchors also have a recipe), so the fallback
branch needed a synthetic-meta test to reach at all. Only 3 resonators (Rover:
Electro, Rover: Spectro, Shorekeeper) still open with no echoes — no recipe
and no suggestion exist for them yet, a real data gap, not a bug.

**2. "'Save & add to my build' button is non-functional."**
Root cause: the button's confirmation UI was `window.prompt()`. Several
embedded/sandboxed browser contexts — VS Code's Simple Browser among them —
don't implement `prompt()`/`confirm()`/`alert()` at all; the call returns
`null` immediately with no dialog ever shown, which is indistinguishable from
the user hitting Cancel. The tell: RESET (item 5, same session) uses a custom
in-page menu, no native dialog, and was NOT reported broken — only the one
button still wired through a native dialog was. Replaced with
`openSaveDialog()` (new, `menus.js`) — a small centered modal (name input +
Save/Cancel), body-appended like the other floating layers, added to
`closeFloatingMenus()`. Verified by stubbing `window.prompt`/`confirm`/`alert`
to no-op-and-record before driving the button: zero native-dialog calls for
this flow, full round-trip (name entry → My Builds listing) still works.
Every OTHER native `confirm()`/`alert()` in the app (delete-team, delete-build
on My Builds, clear-rotation, load-template, the suggested-team "use theirs?"
choice) is pre-existing and unreported — left alone, but likely the same
failure mode in the same environment; worth a broader sweep if any of them
come back as "does nothing."

**3. "When switching pages, reset the scroll state to top."**
`route()` never touched scroll position, so a page opened deep-scrolled
(e.g. from a long build page) landed with the SAME scroll offset applied to
the new page's unrelated content. One line, `window.scrollTo(0, 0)` in
`route()` right after `resetRoot()` — every navigation goes through `route()`
(hashchange-driven), so this is the one seam that covers all of them.

**[Files Changed]** `src/ui/components/build-editor/suggested-teams-panel.js`
(`defaultFreshBuild` recipe-first), `src/ui/components/build-editor/menus.js`
(`openSaveDialog`/`closeSaveDialog`, added to `closeFloatingMenus`),
`src/ui/components/build-editor/bind.js` (save-build-prompt now opens the
dialog instead of calling `prompt()`), `src/ui/components/build-editor/index.js`
(`saveDialogEl`/`saveDialogKeyHandler` state fields), `src/ui/app.js`
(`window.scrollTo(0, 0)` in `route()`). Tests: `tests/build-editor-v2.test.mjs`
(rewrote the fresh-build-defaults block for the 3-tier recipe → suggestion →
neither priority, incl. a synthetic-meta case for the now-otherwise-
unreachable suggestion-only fallback).

**[Verification Method]** `npm test` 60/60, `npm run sweep` 66 modules 0
failed, `npm run lint` 0 errors. Live Playwright verification: Sanhua (a
non-anchor resonator) now opens with 5 real echoes and non-empty rolled
substats visible in the UI; the save dialog completes a full round-trip
(My Builds listing) with `window.prompt`/`confirm`/`alert` stubbed to
no-op-and-record, and zero calls recorded; scroll position measured at 0 on
three consecutive cross-page navigations after scrolling deep into the
previous page each time; the RESET menu and the unarmed-autosave gating
(no save toast before "Save & add," one after) were re-run end-to-end and
still pass with the new recipe-sourced echoes.

**[Residual Risks]** The other native `confirm()`/`alert()` call sites listed
above are unfixed — same likely failure mode, different buttons, not yet
reported. Rover: Electro / Rover: Spectro / Shorekeeper still open with no
echoes (no P13 recipe or P12 suggestion exists for them); closing that needs
new optimizer coverage, not a UI change. The "Save & Add" button's default
name still comes from `api.build.name`, not literally `resonator.name`, when
the user has already typed a custom build name — unchanged from the original
implementation, still considered correct (see the 2026-08-04 entry above).

**[Updated Docs]** `docs/HISTORY.md` (this entry).

## 2026-08-04 — Roster spot-check: Brant's blank build page, and a legacy propId encoding bug two files deep

A "quickly checking every resonator once" pass caught what the two sessions
above missed: Brant's build page rendered a completely blank/black window.
Root-caused, fixed at the source (not papered over), and then proactively
swept the other 55 to make sure nothing else was hiding the same way.

**The crash.** `TypeError: Cannot read properties of null (reading 'slice')`
in `echoes.js`'s substat-chip renderer (`s.name.slice(0, 3)`), thrown the
instant Brant's fresh build tried to paint its echoes — a hard crash, not a
caught error, so the whole page stayed blank. Traced to
`data/wuwa-meta.json`'s `teams.memberBuilds['1206']`: every substat on his
recipe carried `"name": null`.

**Root cause, layer 1 (the actual crash).** Brant is HEALER-tagged, and his
heal formula scales off **Energy Regen**, not ATK/HP/DEF
(`scalingStatFor`/`dataset.supportTable` — a real, correctly-detected fact
about his kit). `substat-allocate.js`'s `substatPool(scaling, …)` built a
"flat scaling-stat" substat option for every scaling value via
`FLAT_PROP[scaling] ?? PROP.ATK_FLAT` — for `scaling: 'er'`, that's not in
`FLAT_PROP` (`{atk,hp,def}` only), so it silently fell back to the legacy
`PROP.ATK_FLAT` (propId 7) encoding. That propId has no entry in
`dataset.echoSubStats` (the real catalog uses `propId 10007, addType 1` for
flat ATK — flat vs. % is `addType`, not a separate propId; 7/2/10 are a
*different*, older encoding used for skill-formula scaling elsewhere in the
pipeline) — so the name lookup always missed. Energy Regen has no flat
variant in-game at all, so the fix removes the flat-stat roll entirely for
any scaling stat outside `{atk,hp,def}`, rather than substituting a wrong
propId.

**Root cause, layer 2 (the same bug, one file over, still live).** Fixing
layer 1 surfaced that `reference-build.js`'s `templateStats()` — the
"neutral 25-roll package," used as BOTH the anchor's stat baseline AND (via
`representativeMemberBuild`'s "no curated rotation" fallback) the literal
substats shipped for any resonator with no hand-curated rotation entry — had
the identical `SCALING_FLAT_PROP = {atk: PROP.ATK_FLAT, hp: PROP.HP_FLAT, def:
PROP.DEF_FLAT}` mistake, PLUS never attached `.name` to its substats at all
(the real allocator's `allocationToEchoSubstats` does; `templateStats()`'s
raw `roll()` helper didn't). This second one wasn't reachable through the
shipped meta (Brant DOES have a curated rotation, so he never touches the
fallback) — until a roster-wide regression test (added below) exercised
`templateStats()`/`representativeMemberBuild` directly and caught it on
**Rover: Electro**, who has no `data/reference-rotations.json` entry and so
hits that exact fallback. Fixed both: `SCALING_FLAT_PROP` now aliases
`SCALING_RATIO_PROP` (flat vs. ratio distinguished by `addType`, matching the
real catalog), and `templateStats()`'s `roll()` resolves `.name` against
`dataset.echoSubStats` directly, same as the real allocator does. The
3-cost main also got smarter for `'er'` scaling specifically — Energy Regen
IS a valid cost-3 main option in the real game, so Brant's template now uses
it there instead of a fallback.

**"Rover: Electro has no echoes."** Confirmed, but separate from the crash
above — she (and Rover: Spectro, Shorekeeper) are excluded from
`meta.teams.memberBuilds` entirely, by design: `scoreTeam()` discards any
candidate team containing a member whose `representativeMemberBuild` has an
empty rotation (`"no curated rotation → can't rank honestly"` — a deliberate
2026-07-12 honesty rule, not a bug). Electro has no
`reference-rotations.json` entry at all (the other two do, but apparently
generate no candidate teams for an unrelated reason — not investigated
further this pass). `synthesizeReferenceRotation` CAN already produce a
valid, warning-free 7-step rotation for her mechanically, but promoting that
straight to "curated" would be lower-bar than the other 53 resonators' hand-
authored entries — left for the maintainer to decide whether to draft one
(the `rotation-drafter` skill is built for exactly this) rather than assumed.

**Proactive sweep.** Live-drove all 56 resonators' fresh-build pages after
the fix (Playwright, real Chrome): 56/56 load with zero page errors; exactly
the 3 known-uncovered resonators (Electro/Spectro/Shorekeeper) show no
echoes, nobody else does. No other latent instance of this bug class exists
in the current roster.

**[Files Changed]** `src/core/substat-allocate.js` (`substatPool` drops the
flat-stat roll instead of falling back to a legacy propId), `tools/optimize/reference-build.js`
(`SCALING_FLAT_PROP` aliases `SCALING_RATIO_PROP`; `templateStats()`'s `roll()`
resolves substat names; 3-cost main uses Energy Regen directly for `'er'`
scaling). Tests: `tests/substat-allocate.test.mjs` (every `substatPool()` entry
must resolve a real name, for `atk`/`hp`/`def`/`er`), `tests/optimize-reference-build.test.mjs`
(roster-wide `templateStats()` sweep via `coveredCharacters()`, not just the 6
SEED anchors — this shape of check is what was missing before), `tests/team-rank.test.mjs`
(roster-wide `summarizeMemberBuild()` sweep — the direct client-facing
contract). Regenerated `data/wuwa-meta.json`.

**[Verification Method]** `npm test` 60/60 (all three new/extended roster-wide
checks pass), `npm run sweep` 66 modules 0 failed, `npm run lint` 0 errors.
Live Playwright: Brant's build page confirmed loading with a full 5-echo
layout, correct weapon/rotation, `Energy Regen` 3-cost main visible; a
56/56 roster sweep (fresh build page per resonator) shows zero page errors
and confirms exactly the 3 expected no-echo cases.

**[Residual Risks]** Rover: Spectro / Shorekeeper's exclusion (they DO have
curated rotations but still generate no team-pass recipe) wasn't
investigated — may be a legitimate "no synergy partners" absence or a
second, different bug; unknown until looked at directly. Whether to draft a
curated rotation for Rover: Electro is an open question for the maintainer,
not decided here. The two propId-encoding bugs fixed here are specifically
about the ECHO substat/main-stat catalog convention (`addType` distinguishes
flat/%) vs. the SKILL-FORMULA scaling convention (`PROP.ATK_FLAT`/`HP_FLAT`/
`DEF_FLAT` as distinct propIds) — both conventions are real and used
correctly elsewhere in the codebase for their own purposes; the bug was only
ever "using the wrong one when building an echo-facing value," and nothing
found suggests a third file makes the same mistake, but it wasn't
exhaustively grepped for beyond the two fixed here.

**[Updated Docs]** `docs/HISTORY.md` (this entry).

### Addendum 11 (2026-08-03) — Tune Break becomes a rotation step (OPEN-ITEMS #7)

The formula had been calibrated and tested since the negative-status work
(`computeTuneBreakDamage`, verified against one worked example to within
0.001%), but nothing could cast it. #7 had recorded the blocker as "needs the
gauge engine (#2) + a manual rotation-step toggle, default OFF". Both halves of
that turned out to be wrong, and seeing why is most of the design.

**There is no gauge to model.** Tune Break is a RESPONSE to the target's
Off-Tune bar — the enemy's mechanic, not a resource of ours. So there is nothing
on our side to fill, and a "default OFF toggle" is the wrong shape too: the step
is slotted by hand, and slotting it IS the assertion that the bar was full. It
carries no conditionals of any kind.

**Every resonator gets it, and the game says so.** Each character ships a Tune
Break node — `skill_trees[*]` with `skill.type === 'Tune Break'`, exactly one
per character, 60/60 in the source and 56/56 after the roster filter. It is
projected to `resonator.tuneBreak`. The game names it by WEAPON TYPE for 49 of
them ("Tune Break: Sword", "Tune Break: Rectifier") and gives seven kits a name
of their own ("Unlanded Melody", "Data Crash", "Shattered Hours"), which is why
the name is read rather than synthesised — and why the palette button leads with
the mechanic regardless, since a bare "Unlanded Melody" does not read as a Tune
Break.

**The node ships no damage table and no level curve** (`damage: {}`,
`level: {}`), which is the confirmation rather than a gap: its damage is the
tune-bar mechanic's own formula, not a character multiplier. `resolveTuneBreakStep`
therefore reads nothing from `stats` and nothing from the effect pipeline. Its
only two inputs are the responder's own ELEMENT — Tune Rupture/Strain carry no
element of their own, and the verified example's 90% RES matches Hiyuki's own
Glacio RES rather than any fixed "tune" bucket — and the enemy CLASS (14× between
Common and Overlord).

That gives the property the test suite actually guards: **two builds of one
resonator that differ enormously in every other step deal IDENTICAL Tune Break
damage.** A regression that quietly routed it through the normal damage path
would still look plausible in the UI; only that equality catches it. Measured:
S0 and S6 Hiyuki, same number to the digit, and that number is exactly
`computeTuneBreakDamage` called directly — the wiring adds no arithmetic.

**Two curated numbers, both surfaced rather than hidden.**
`TUNE_BREAK_CAST_TIME = 1.50s` is an estimate; the node ships no animation data
of any kind, and having no damage instances it gives the bullet-timing
extraction nothing to hang a duration on, so no timing source covers it. It is
stamped `timingSource: 'estimated'` and the step tooltip says so in those words
rather than reusing the generic "summon/DoT/field damage" note, which would have
been the wrong reason. The formula's Bonus DMG% and Tune Break Boost% buckets
are passed as 0: both are real and separately modelled, both were 0% in the
verified example, and nothing in the engine sources either yet — a guess would
be worse than nothing. Several kits DO state a Tune Break Boost (Luuk Herssen,
Mornye, Lynae) and wiring those is the natural next piece.

**UI.** Its own display category, not folded into an attack bucket: a `TB` badge
on `--dmg-tuneBreak`, its own donut slice, and a place in the compare/team
colour maps (leaving it out of those drops real damage from a breakdown rather
than colouring it wrong). The palette button sits to the RIGHT of the Echo Skill
button under one "ECHO & TUNE BREAK" heading — the two steps that belong to no
skill map — and falls back to a "TUNE BREAK" heading when no echo with an active
skill is equipped. The step tooltip states the mechanic's terms plainly: cannot
crit, no ATK scaling, no gear stat reaches it.

Deliberately unmodelled: the Off-Tune bar itself. Nothing checks that a slotted
response is legal, so a rotation can slot more of them than a fight would allow
— the same contract every other manual step has.

**[Files Changed]** `tools/preprocess/resonators.mjs` + `tools/preprocess.mjs`
(project `resonator.tuneBreak`), `src/core/enemy-status.js`
(`resolveTuneBreakStep`), `src/core/sim.js` (`TUNE_BREAK_STEP_KEY`,
`TUNE_BREAK_CAST_TIME`, the step branch, the display category),
`src/core/opener.js` (never filler, but it still spends its cast time),
`src/ui/components/build-editor/{rotation,shared}.js`,
`src/ui/components/{compare-v2,team-editor-v2}.js`, `styles/tokens.css`;
new `tests/tune-break.test.mjs` (34), `tests/compare-v2.test.mjs`.

**[Verification Method]** `npm test` 61/61, sweep 66, lint 0 errors. LOCK A is
purely additive — the 56 `tuneBreak` blocks and the timestamp, nothing else in
the file moved. LOCK B moved `generatedAt` and `engineHash` only: **zero team
scores changed**, which is the expected result, since a manual step appears in
no reference rotation and so cannot reach the meta.

**[Residual Risks]** The 1.50s cast time is invented and will shift every DPS
number of any rotation that slots one — it is flagged in the UI, but it is not
measured. Bonus DMG% / Tune Break Boost% are unwired, so kits that state a boost
currently under-report. Nothing validates that the Off-Tune bar was full.

### Addendum 12 (2026-08-03) — Tune Break, measured rather than guessed

Addendum 11 shipped Tune Break with one invented number, the 1.50s cast time,
and reported honestly that the node "ships no animation data of any kind". That
was wrong, and the maintainer's instinct — *"might sit somewhere else, perhaps in
a more general/default place"* — was right. The same message settled two
mechanics from play: the animation freezes gameTime and is uninterruptible, and
a rotation gets ONE Tune Break.

**The animation was findable, just not by the route everything else uses.**
With no damage ids there is no bullet chain and no hit id to resolve a row from,
which is why the extraction had nothing for it. The rows are reachable directly
instead: 68 of them declare `TriggerType: 'BreakWeaknessTrigger'` (internal name
破弱, "break weakness"), covering all 60 resonators, every one `provenance:
extracted` with a resolved montage and a full timeline. `map-timings.mjs` gained
a `breakWeakness` route; regenerating `data/actionable-times.json` changed
**zero existing entries** and added exactly 56.

Everything the maintainer said is in the measurement:

| field | reading |
| --- | --- |
| `freeze_combat_clock_s` | a TimeStopRequest window over the whole animation, on all 68 |
| `功能.逻辑状态标识.无敌.通用无敌` | general invincibility, same span |
| `interrupt_level` | **11** on all 68, where a Basic is 2 |
| `switchBehavior.cannotSwitch` | the whole animation |

So a Tune Break costs real seconds and **zero game seconds** on the ToA clock —
measured, not inferred. Duration is now per resonator (1.4857–1.6086s, clustered
by weapon type: Sword ~1.49, Rectifier ~1.50, Gauntlets ~1.55, Broadblade ~1.57,
Pistols ~1.60). The guess had been 1.50s, which is the median — right by luck,
wrong per character.

Eight resonators ship two rows, and they are FORM variants (Aemeath's Mech,
Cartethyia's Fleurdelys, Camellya's 魔人化). The sim has no form model for this
step, so the base form is picked by matching the animation name against the
resonator's own weapon type — which is also how the game names the node itself
("Tune Break: Sword"). 56/56 resolve, asserted rather than assumed.

The freeze is clamped to the step like every other measured freeze: the raw
window runs ~15ms past the actionable point, and unclamped it drove gameTime
NEGATIVE on a rotation of nothing but Tune Breaks.

**One per pass, for the whole team** (maintainer ruling). The bar is the
TARGET's and refills once per cycle, so three members moving through one pass
share a single opportunity rather than getting one each. This matters precisely
BECAUSE the animation stops the clock — each uncapped extra is damage at no cost
to the DPS denominator, which compounds straight into DPS.
`capTuneBreaksPerPass` REMOVES the surplus rather than zeroing it, so nothing
downstream sees a cast that did not happen, and reports it as
`tuneBreaksDropped`. The build page still simulates every slotted response — a
rotation there is a scratchpad, and a long fight really does offer more than one
— but flags the second and later ones, with no FIX button, since resolving means
removing a step rather than reordering.

**Tune Break Boost and Bonus DMG%: investigated, and the answer is still 0.**
The previous note called both "unverified"; they are now settled with evidence.
`BreakWeaknessRatio` is the game's own Tune Break ratio and reads **10000
(= 100%) on every one of the 2,740 `baseproperty.json` rows** — no character and
no level varies it, which is why the worked example reproduces to 0.001% without
it. The kit stat "Tune Break Boost" does NOT increase a Tune Break's own damage
in any kit text: Denia, Mornye, Lynae and Luuk Herssen all state the identical
rule, *"For each stack of Tune Strain - Interfered on the target, each point of
X's Tune Break Boost increases X's total DMG against the target by 0.12%"*,
matching the BinData row's own `SkillDetailNum: ["8", "0.12%", "1"]`. Its effect
is gated on Tune Strain - Interfered, a status the sim does not model. Wiring
either bucket now would be inventing the mapping the docs had already flagged as
assumed. Modelling Tune Strain - Interfered is the next piece of this lane.

**What a Tune Break now triggers.** It registers as a CAST, and Luuk Herssen S4
— *"After a Resonator in the team deals Tune Break DMG, all Resonators in the
team deal 20% more DMG for 20s"* — was parsing to **zero effects**. Three parser
gaps had to close: a "deals N% more DMG" branch (the dealer's side of the
amplify bucket, the mirror of "Targets take N% more DMG from X", which nothing
read); `deals Tune Break DMG` as a structural cast trigger, since the game never
says "casting" for one; and the team-recipient phrasing "all Resonators in the
team deal N%". Measured **+10.5%** on his own reference rotation, the shortfall
from 20% being the window expiring partway through.

Two traps in that, both caught by measurement rather than by reading:

- `SKILL_PHRASE_TO_TYPE` is read for BOTH the trigger's category and the
  effect's SCOPE, and for a Tune Break the two are opposites. Listing it there
  scoped Luuk's S4 to the one step type it must never buff. The trigger reads it
  from its own branch instead.
- The "deals N% more DMG" phrasing carries its condition in prose the clause
  classifier does not read ("to targets whose HP is below 50%"). Unscoped,
  Chixia's +40% and Mornye's **+400%** would have landed on every hit, always.
  The branch now keeps a clause only if it named its skills or named the team;
  three are dropped, which is exactly the status quo for them.

**And a latent ordering bug the drop exposed.** `S{level}.{index}` is a critical
invariant — `effect-overrides.json` and a saved build's `effectStacks` both
address effects by it — and `bindSkillScopes` was running AFTER the overrides.
Dropping an effect there silently moved Luuk Herssen's curated S6.0 patch
(`perStack` 0.40, which exists precisely because `pctNear` reads the "up to
120%" ceiling as the per-stack value) onto a different effect. Any pass that
changes the effect COUNT now runs before anything keyed on the slot.

**[Files Changed]** `tools/extract/map-timings.mjs` (the `breakWeakness` route),
`tools/preprocess.mjs` (Tune Break timing stamp; pass ORDER),
`tools/preprocess/effects.mjs` (deals-more branch, Tune Break cast trigger),
`tools/preprocess/skill-scope.mjs` (subject form widened to `deals`, last-match
rule, unscopable drop), `src/core/sim.js` (measured duration + freeze, cast
registration, phrase type), `src/core/team-sim.js` (`capTuneBreaksPerPass`),
`src/core/rotation-graph.js` (the once-per-rotation flag), `src/core/buffs.js`
(team-recipient phrasing), `src/ui/components/build-editor/rotation.js` (no FIX
button on an unfixable warning); `data/actionable-times.json` (+56 entries);
`tests/tune-break.test.mjs` (37 → 57).

**[Verification Method]** `npm test` 61/61, sweep 66, lint 0 errors.
`actionable-times.json` regenerated with zero existing entries changed. LOCK A
is additive: 5 resonators gain an effect, each at a node that previously had
NONE, so no slot shifted — verified against HEAD, and the three surviving
curated overrides (Calcharo S3.0, Yinlin S4.0, Luuk S6.0) all still land.
LOCK B: **7 teams move, all UP, median 1.29%, max 1.70%**, every one anchored on
Qiuyuan — the only meta anchor among the five kits that gained an effect — plus
one team-set swap in her list.

**[Residual Risks]** The once-per-pass cap is a modelling ruling, not a measured
game limit; a fight that genuinely offers two in one cycle is understated. Tune
Break Boost is derivable but unwired, so kits that grant it under-report until
Tune Strain - Interfered exists. Luuk S6's comma-separated skill list still
parses to nothing — the subject binder deliberately never reads across a comma,
because that is how it avoids binding a team buff to the trigger list in front
of it. Calcharo S5 binds one of the two Intro Skills it names.

### Addendum 13 (2026-08-03) — the Tune Strain chain

Addendum 12 closed Tune Break with one thing explicitly held back: Tune Break
Boost was derivable but had nothing to multiply, because its payout is gated on
**Tune Strain - Interfered**, a status the sim did not model. That status is the
subject here, and modelling it turns the whole lane on.

**The chain, as the game states it:**

1. A cast inflicts **Tune Strain - Shifting** on the target (25s).
2. A **Tune Break** on a Shifting target converts it to **Tune Strain -
   Interfered**.
3. A resonator who *"can respond to Tune Strain - Interfered"* then gets *"For
   each stack of Tune Strain - Interfered on the target, each point of X's Tune
   Break Boost increases X's total DMG against the target by 0.12%."*

**Derived, not curated, because it is a template.** Four kits state step 3 in
near-identical words, and each also states *"While X is in the team, the max
stack limit of Tune Strain - Interfered on a target is increased by 1."*
`tools/preprocess/tune-strain.mjs` reads all three facts off each resonator's own
Tune Break node — who responds, the +1, and the 0.12% — and finds exactly four
responders (Mornye, Denia, Lynae, Luuk Herssen) in unanimous agreement. The
uniformity is asserted rather than assumed: `tests/tune-strain.test.mjs` fails if
a future kit ever states a different rate, which is a finding about the kit and
not a parser bug to average away.

**Why the stack cap needs no curated base.** No kit states one; four state the
same +1. The limit therefore IS the number of responders present — any other base
would make four identical statements arbitrary. A solo responder caps the target
at 1, a Denia/Lynae/Luuk team at 3. That cap doing its job is visible in the
solo numbers: Denia's S6 grants a SECOND Interfered stack per Tune Break, and
solo it changes nothing, because her own cap is one.

**Curated, because it is not a template:** the five Tune Break Boost GRANTS, which
sit in scattered chain/inherent/skill nodes with genuinely varied phrasing
(`TUNE_BREAK_BOOST_GRANTS`, each carrying its quote). The stat's base is 0 —
`WeaknessTotalBonus` reads 0 on 2,729 of the 2,740 `baseproperty.json` rows, the
exceptions being enemies — so a team's total is exactly what its kits grant.
Denia's +10 is mode-gated, her S2 +20 needs the chain level, Lynae's +40 needs
her own Iridescent Splash cast to actually be in the rotation (it is not in her
reference rotation, so it correctly does not fire), and Rebecca's +30 is a HACK
trigger that still reaches a Tune Strain responder — Tune Break Boost is one
stat, not one per family.

**Measured payouts**, all on the members' OTHER steps, with the Tune Break's own
damage excluded so the amplify is what is being read:

| | cap | stacks | payout |
| --- | --- | --- | --- |
| Denia solo S0 | 1 | 1 | +1.20% (10 points) |
| Denia solo S2 | 1 | 1 | +3.60% (30 points) |
| Denia/Luuk/Lynae S0, 1 pass | 3 | 1 | team skill damage **+3.04%** |
| Denia/Luuk/Lynae S6, 1 pass | 3 | 2 | team skill damage **+18.12%** |

Luuk gains most, because he carries a second clause the others do not: *"every
10 points of Tune Break Boost he has Amplifies this instance of damage by 5%, up
to 30%"* — flat rather than per-stack, and his S2 REPLACES the rate with 10%
rather than adding to it.

**Three things it deliberately refuses to do.** The chain pays nothing unless a
responder, a Tune Break AND a Shifting mark are all present — any one missing and
it never started. A non-responder holding team-wide Boost points converts none of
them, because the payout clause lives on the responder's own node. And Denia's
*"every 10% of Off-Tune Buildup Rate over 100% increases Tune Break Boost by 8,
up to 40"* is omitted: `WeaknessMastery` is a real property but reads 0 for every
resonator row, so the grant evaluates to zero and guessing it would be inventing
a stat the game does not give them.

The Tune Rupture and Hack families share the SHAPE but not the payout — their
responders cast a real RESPONSE SKILL (Mornye's Particle Jet, Lynae's Spectral
Analysis, Rebecca's Meltdown, Lucy's Data Crash), and those are ordinary damage
rows already in the skill map, slottable today. Only Tune Strain pays out as a
stat, which is why only it needed a model.

**[Files Changed]** new `tools/preprocess/tune-strain.mjs`, new
`src/core/tune-break.js`; `tools/preprocess.mjs` (the derivation pass),
`src/core/sim.js` (solo resolution + the `tuneStrainAmplify` hand-in + the
chain on the result), `src/core/team-sim.js` (team-wide resolution, reported as
`tuneStrain`), `src/ui/components/build-editor/rotation.js` (the chain shown on
the Tune Break chip that caused it; the now-stale "estimated" note dropped, since
addendum 12 made the timing measured), `tools/optimize.mjs` +
`tests/meta-schema.test.mjs` (ENGINE_FILES); new `tests/tune-strain.test.mjs` (53).

**[Verification Method]** `npm test` 62/62, sweep 67, lint 0 errors. LOCK A adds
only the four `tuneBreak.strain` blocks. LOCK B does not move a single team score:
the chain needs a Tune Break, no reference rotation has one, so the meta cannot
see it — which is the same reason the previous addendum's cap changed nothing
there.

**[Residual Risks]** The Interfered cap being exactly the responder count is a
reading of four identical clauses, not a stated base — if the game has a hidden
base of 1, every payout here is understated by one stack's worth. The Boost
grants' 15s/30s windows are modelled as "live whenever the chain has fired",
which is true in a rotation short enough for one Tune Break and optimistic in a
longer one. Stacks accrue per Tune Break landed rather than per qualifying cast,
so a fight that re-breaks faster than the cap refills is understated.

### Addendum 14 (2026-08-07) — the buffs that were never read

The 2.6x team-DPS shortfall against Arabwuwa's published Aemeath/Denia/Chisa
rotation (OPEN-ITEMS #32) had been called UNIFORM, and a uniform gap points at a
global factor in the damage path. It was neither.

**Localising it took two changes to the measurement, not to the engine.**
Arabwuwa publish their rotation per member; mapped onto our keys, with a real
Echo equipped instead of the empty slot the bench had been running, the gap went
2.60x → 2.09x and stopped being flat. **Chisa leads the pass and receives
nothing from anybody, and she was only 1.37x low. The two who DO receive team
buffs were 2.1x low.** That split is the whole finding: about 1.37x is
per-character modelling, and about 1.5x on top of it lived in the team-buff lane.

A stat-free anchor agrees that solo is close. Our Tune Break for Aemeath is
62,689, computed from the game's own LevelModifier with no ATK, no crit and no
gear input; Arabwuwa's character page puts Tune Break at 11.90% of a solo Aemeath
rotation, so their solo is ≈527k against our 462,901 on the same rotation —
**1.14x**. Their stated build target (ATK 2050–2100, CR 73–78%, CD 270–275%) is
*lower* than ours, which rules out stats from both directions.

**The parser was failing silently, at scale.** A clause it cannot read produces
no effect, no warning and no diff — the buff simply is not there. Measured
against every inherent and chain description on the roster: **109 of 324 clauses
that state a buff percentage parsed to nothing.** Among them Denia's team-wide
*"All Resonators in the team gain 30% Fusion DMG Bonus"* and Chisa's team-wide
*"gain 50% All-Attribute DMG Bonus"* — the two largest missing buffs for the very
team being benchmarked. Nothing in the suite noticed, because every test asserted
what the parser DID produce.

Four families, in descending size:

| family | clauses | what was wrong |
| --- | --- | --- |
| DMG Bonus | 41 | the value PRECEDES the stat ("gain 30% Fusion DMG Bonus") and the reader only looked forward |
| "DMG of X is increased by N%" | 29 | no branch existed at all — no "DMG Bonus", no "Amplif", no "DMG Multiplier" |
| DMG Multiplier | 27 | "increases by" (not "increased by"), and the same backward word order |
| Amplification | 10 | backward word order again |

`pctFor` reads either direction from a STAT NAME and `pctNear` stays
forward-only from a VERB — what precedes a verb belongs to a different effect in
the same sentence. **109 → 9**, and the nine that remain are listed one at a
time, with reasons, in the new `tests/effect-coverage.test.mjs`.

**Two scope corrections came with it, and both REDUCE damage.** The game names
the cast that TRIGGERS a buff before it names the buff, so reading a category off
the whole clause reads the trigger: Brant's *"After casting Intro Skill Applaud
for Me!, Brant's DMG dealt is increased by 20%"* is not an Intro-only buff, and
Calcharo's *"Casting Heavy Attack Mercy gives Calcharo 10% Resonance Liberation
DMG Bonus"* is not a Heavy one. Scope now comes from the segment that owns the
stat. Separately, `targetNamesInClause` grew to every stat and to plural names,
so 60 effects bind to the skills their clause names instead of to a whole
category — Carlotta's S3, Encore's S3, Zani's S2, Lynae's S3 and Rover: Electro's
S6 were all applying to every skill of that type.

**`isTeamWideBuff` had no pattern for a grant VERB in front of the team.**
"grants all Resonators in the team 25% …" and "gives all team members 25% …" both
read as self-only. Six team buffs were scoped to their own wielder, including
Chisa's +50% All-Attribute and Suisui's +50% Crit. DMG. One test had recorded
that gap as a fact about a kit — *"Carlotta grants no team buff (her kit is
personal)"* — when her S4 plainly grants one; it now asserts the window.

**Outro Skills were invisible twice over.** An Outro node's `level` map is
EMPTY — the skill does not scale with skill level — so the row loop walked zero
params and **55 of 56 resonators shipped with no outro damage row at all**, while
`recordOutroSwap` scored a hard-coded `damage: 0` with the comment "Outro skills
have no damage params". Thirteen of them deal up to 795% of ATK, once per swap
per member. The multiplier is now read from the sentence that states it and
repeated across the level band; the three whose outro is already paid as an
off-field action (Galbrena's burst, Calcharo's and Rover: Havoc's summons) are
refused in the engine as well as in preprocess — two paths, one cast.

And a mode-gated outro is a MENU, not one grant. Denia's took its value from the
Tune Strain branch (15%) and its duration from the Fusion Burst one (30s) and
handed the mix to every build regardless of mode. Branches now carry their own
value, their own duration and a `mode` key, filtered at the hand-off against the
outgoing member's build. In Fusion Burst she now grants nothing through that
path, which is correct: her 60% there amplifies the *status's* damage, a formula
with no crit and no gear stat. Widening the patterns to allow the actor phrase
the game writes between scope and verb ("Glacio DMG **dealt by nearby Resonators
other than Hiyuki in the team** is Amplified by 20%") recovered four more.

**Chisa's Outro was in no table at all.** *"When an attack hits, increase the max
stacks of Negative Status … by 3 for 15s"*, team-wide for 20s — the same shape as
Suisui's, gated on the swap instead of a rotation step, which is why the gate is
`onOutro` (her Outro deals no damage, so it is never a step). For this roster it
takes Fusion Burst 10 → 13 stacks and the game's own per-stack table 6.9863 →
13.9726: the burst lands later and is worth exactly twice as much. Arabwuwa's
own writeup for this team names it, and the sim was modelling none of it.

**Where the benchmark stands**, same rotation, same conditions:

| | before | after | Arabwuwa | ratio |
| --- | --- | --- | --- | --- |
| Chisa (receives nothing) | 127,180 | 127,180 | 174,451 | 1.37x |
| Denia | 186,658 | 223,246 | 389,281 | 1.74x |
| Aemeath | 702,521 | 821,634 | 1,521,562 | 1.85x |
| team | 999,913 | 1,157,011 | 2,085,294 | **1.80x** (was 2.60x) |

**[Files Changed]** `tools/preprocess/effects.mjs` (`splitClauses` exported,
`pctFor` replacing `pctGained`, `ownerSkillType`, `statScopeSkillType`,
`SCOPE_ONLY_PHRASE_TO_TYPE`, the DMG-increase branch, four exclusions, the
situational gate), `tools/preprocess/skill-scope.mjs` (plural target names, three
more TARGET forms, possessive-owner stripping, every stat not just
`multiplierUp`, owner-name refusal), `tools/preprocess/resonators.mjs` (outro
mode segments + widened amplify patterns + the outro damage row),
`src/core/buffs.js` (`TEAM_RECIPIENT_RE`), `src/core/team-sim.js`
(`simulateOutro`, `outroKeyFor`, `outroBuffsInMode`, the outro cap-raise gate),
`src/core/enemy-status.js` (Chisa's `STATUS_CAP_RAISES` entry,
`capRaiseOutroGates`), `data/effect-overrides.json` (2 resolved, 5 deferred);
new `tests/effect-coverage.test.mjs` (25) and `tests/outro.test.mjs` (26);
`tests/stack-metadata.test.mjs`, `tests/team-buffs.test.mjs`,
`tests/audit-effects.test.mjs` updated where they had pinned a parser gap.

**[Verification Method]** `npm test` 64/64, sweep 67, lint 0 errors. LOCK A adds
110 effects, removes none, and changes 20 — every one reviewed by hand against
its kit text, and all 37 `effect-overrides.json` slot keys re-audited to confirm
none shifted onto a different effect. LOCK B moves 269 persisting teams, median
+5.3%, max +17.5%, worst drop −4.8%; the drops are the scope narrowings and
Denia's removed phantom outro buff, i.e. corrections.

**[Residual Risks]** Adding effects SHIFTS `S{level}.{index}` slot indices inside
six nodes (Denia S2/S6, Yinlin IH0, Luuk S5, Lucy IH0, Hiyuki S6). Curated
overrides were re-audited and are fine; a saved build's `effectStacks` for those
slots now points at a different effect, and there is no migration. Three 500%
Crit. DMG clauses (Hiyuki S6, Suisui S6, Shorekeeper S6) stay unread because
nothing can scope them — a known understatement, listed in the guardrail rather
than applied to every hit. Chisa's raise arms on a status APPLICATION where the
kit says "when an attack hits"; equivalent in effect, since a cap only matters
where stacks exist, but not literally the same trigger. The residual 1.80x is not
explained, and Chisa's own 1.37x — a member receiving nothing from anyone — is now
the floor to chase.

### Addendum 15 (2026-08-07) — the game's ConfigDB becomes a source

Addendum 14 fixed WHICH kit clauses parse. It could not say whether the numbers
were right, because the only reference was the same English text the parser was
reading. This addendum makes the game itself the reference.

**The tooling was already here.** `tools/extract/configdb.py` reads any of the
~500 `db_*.db` config tables using the client's OWN JavaScript accessors, so the
schema is read rather than guessed. It had only ever been pointed at four tables.

**What the buff table holds.** `db_buff` is 24,777 Unreal GameplayEffect rows:
`GameAttributeID`, `CalculationPolicy`, `ModifierMagnitude`, the whole
`Stacking*` family, and four `*TagRequirements` pairs that ARE the gating
conditions. `GameAttributeID` is the SAME id space `src/core/stats.js` uses —
7 Atk, 9 CritDamage, 22..27 element bonus — so nothing needed translating, which
is what made the comparison possible at all.

**Reaching the modifiers took four hops, each a real fact about the wiring:**
`ExtraEffectID 35` registers a passive skill whose `SkillActionParams` name the
buffs it applies; parameters pack lists with `#`; most nodes grant only a TAG and
the modifier is a separate buff whose `*TagRequirements` demand it (the Unreal
idiom); and a skill-scoped stat modifier is not a `GameAttributeID` column at all
but `ExtraEffectID 1 CommonSnapshotModify`, with the attribute in `params[1]` and
the VALUE in `ExtraEffectParametersGrow1`. Chain matches climbed 20 → 66 → 95 →
121 as each was added.

**The enum never had to be guessed either.** `ExtraEffectDefine.js` ships the
dispatch switch: 67 persistent effect classes, 28 execution classes, now
extracted to `data/extra-effects.json`. Nearly everything the sim curates by hand
has a numbered slot in it — `53 BindBuffToTeam` and `90 ModifyTeamMemberBuff` for
team distribution, `70 ModifyBuffMaxStack` for `STATUS_CAP_RAISES`,
`87 SpecialEnergyModifier` for gauge income, `25 AddBuffOnChangeTeam` for the
outro transfer. Fifteen of them route buffs onward, and following all fifteen is
what took chain-node reachability from 16% to 51%.

**Three parser defects fell out of it**, none of which any amount of re-reading
the kit text could have found:

- Augusta's *"For every 1% of Crit. Rate over 150%…"* was emitting a live +150%
  Crit Rate (and +100% on her S2) out of a THRESHOLD. The game lists no such
  modifier — and it encodes the threshold explicitly, as `AttributeThreshold` in
  `CommonSnapshotModify`'s `params[3]`.
- Changli's IH1 read 0.15 where the game says 0.20. The clause is *"gives 20%
  Fusion DMG Bonus and ignores 15% of the target's DEF"*, and `pctFor` preferred
  FORWARD, so it took the DEF-ignore. Forward now needs a LINKING VERB; without
  one the value belongs to the stat it sits in front of. The game files the two
  separately (1205301002 elementBonus 0.20, 1205301003 attribute 10 at −0.15),
  which is what proves it. A deferred note had predicted exactly this.
- Buling's *"25% Healing Bonus … for Resonators with less than 50% HP"* read
  0.50, the same threshold-as-value shape.

**The finding that mattered most is a bucket, not a number.** The client ships
its damage formula in `CharacterDamageCalculations.js`:

```text
t = 1 + Proto_DamageChange + elementBonus + attackTypeBonus      ← ONE additive
damage = base * crit * defMult * t * resMult
       * (1 - Proto_DamageReduce) * (1 + Proto_SpecialDamageChange) * …
```

Our shape was right all along. The assignment was not, and it is **not derivable
from the sentence** — the game does not decide it from the wording:

| clause | game lane |
| --- | --- |
| Sigrika *"targets take 30% more DMG"* | `SpecialDamageChange` — multiplicative |
| Cartethyia *"take 30% more DMG"* | `DamageChange` — ADDITIVE |
| Yinlin *"deal 70% more DMG"* | `DamageChange` — ADDITIVE |
| Calcharo *"Intro Skills deal 50% more DMG"* | `DamageChangeQTE` — ADDITIVE |

Identical English, different lane. So `data/buff-facts.json` is now the PRIMARY
source for the bucket and the text parse is the fallback: `buff-facts.mjs` moves
an effect only where the game is unambiguous, keyed on (resonator, VALUE) — not
on our stat name, since the stat name is what is being corrected. The extractor
drops any value whose bucket differs between two buffs of one owner (24 of 266)
rather than guess. Four effects moved, all from a multiplicative `amplify` into
the additive bucket they belong in, all with their skill scopes intact:
Calcharo S5, Yinlin S1, Verina S6, Cartethyia IH1. Sigrika kept her amplify,
which is the case that proves the rule is reading data and not phrasing.

**Two long-standing mysteries closed**, both the same mechanism. Aemeath S6's
*"targets take 40% more Resonance Liberation DMG"* is buff 1210066008 —
`TargetType 1` (the target), attribute 16 `DamageReduce`, magnitude **−4000**,
gated by `ExtraEffectRequirements [12] ['2']` (damage type 2 = Liberation).
Qiuyuan IH0's *"these three heavies deal 50% more DMG"* is 1411800100, the same
shape, gated by `[1] ['1411110#1411120#1411130']` — his three skill ids, listed.
Negative damage-reduction on the TARGET is how the game writes "takes more DMG",
which is why a search for a positive bonus under the wielder could never find
them. Both compose at 1.4x and 1.5x either way, so neither needed correcting.

That requirement enum is now extracted too, and type 1 is significant beyond
these two: it is an explicit SKILL-ID scope, the same thing `skill-scope.mjs`
infers from English names and fails to find whenever a display name shares no
token with its key.

**Where the roster stands.** 202 of 214 emitted values exist in the game's own
buffs (94.4%) — 193 exact, 9 the right number in a different bucket, 12 found
nowhere. The 12 are classified, not unknown: rate-vs-cumulative (the game
precomputes a buff per stack COUNT where we store the rate — Yangyang: Xuanling's
0.1/0.2/0.3/0.42/0.54/0.66 is exactly her banded 10%/stack then 12%/stack, which
independently confirms the banded-stack invariant), rate-against-a-reference-
attribute with a threshold which we flatten (Augusta, Mornye, Sigrika), and
Aemeath's S3 replaced inherent (0.6 is max stacks of the 0.2/0.3 buff — the game
stores the rate, we store the total).

**Two notes in the repo were wrong and are corrected.** `db_skill` DOES hold
character skills (562 rows, keyed by `SkillGroupId`, not by an id prefix), and
the skill→buff grant does NOT live only in the ability blueprints — `db_PassiveSkill`
carries it, with `TriggerFormula` naming the exact cast
(`DamageValue>=1 AND SkillID==1211061`) and `SkillActionParams` the buffs applied.

**[Files Changed]** new `tools/extract/reconcile_effects.py`,
`extract_extra_effects.py`, `extract_buff_facts.py`,
`tools/preprocess/buff-facts.mjs`; new `data/extra-effects.json`,
`data/buff-facts.json`; `tools/extract/configdb.py` (a `table=` override —
db_property.db holds three), `tools/preprocess/effects.mjs` (the threshold guard
and the linking-verb rule), `tools/preprocess.mjs` (the new pass); new
`tests/buff-facts.test.mjs` (21).

**[Verification Method]** `npm test` 65/65, sweep 67, lint 0 errors. LOCK A: six
effects change across the whole roster (2 phantoms removed, 2 values corrected,
4 rebucketed), 0 added, 0 removed. LOCK B: 0 of 416 team entries move — the four
rebucketed effects are self-buffs on supports, so no anchor's damage path sees
them. The benchmark is unchanged at 1.80x for the same reason.

**[Residual Risks]** The join is keyed on (resonator, value), so a value that is
unique today but duplicated by a future kit would start binding ambiguously; the
extractor's own drop rule catches the collision only when the two buffs disagree
about the bucket, not when they agree for different reasons. `data/buff-facts.json`
is regenerable ONLY from a local fmodel export, like the other committed
extractions — the file is the artefact, not the export. 12 values still have no
buff behind them, and the two genuinely unexplained ones from the previous pass
are now explained, leaving the rate-flattening cases as the real remaining
under-model: we emit "2% per 1% over the threshold" as a flat 2%, where the game
computes `refAttrValue x rate` capped by `ModifierMax`.

**[Updated Docs]** `CLAUDE.md` (the pipeline block plus a new invariant on where
the bucket comes from), `docs/ARCHITECTURE.md` (the new modules),
`docs/OPEN-ITEMS.md` unchanged — the benchmark gap is untouched by this work.

---

## 2026-08-07 — Requirement routing: the para index, the ANY/ALL check, and the bullet chain

Follow-up to the ConfigDB buff-facts work, prompted by "gaps in the data
wouldn't make sense, as it would break the game — it should all be there, it
just needs the correct routing." It was. Nothing new was extracted; three
routing defects were fixed and all six unread clauses were traced to source.

**[Files Changed]** `tools/extract/extract_buff_facts.py` (parallel para
indexing, `ExtraEffectReqSetting`/CheckType, `resolve_bullet_ids`,
`RESOLVERS`), `data/buff-facts.json` (regenerated), `data/wuwa-data.json`,
`data/wuwa-meta.json`, `data/effect-overrides.json` (Hiyuki deferred keys
renumbered), `tests/buff-facts.test.mjs`, `tests/effect-coverage.test.mjs`
(UNREAD entries rewritten with their game-data source), `CLAUDE.md` (two
invariants).

**[Logic Altered]**

1. **`ExtraEffectReqPara` is parallel-indexed.** The client loops
   `for ([index, type] of Requirements.entries())` and reads
   `RequirementPara[index]` (`ExtraEffectLibrary.ResolveRequireAndLimits`).
   `scope_of` read `para[0]` unconditionally, so 16 buffs whose SkillIds list
   sits at index 1 — behind an element gate (Galbrena x5), a buff-stack gate
   (Cartethyia x5, Brant), or an attribute-interval gate (Verina x4,
   Yangyang: Xuanling) — had their stated scope dropped and an unrelated
   parameter string parsed in its place.
2. **`ExtraEffectReqSetting` is the CheckType.** 0 = every requirement holds
   (two scope lists INTERSECT), 1 = any one does (they UNION). Under ANY, a
   non-scope requirement means the effect fires outside the list, so the list
   is refused as a scope — Ciaccona's `1407000060` fires on four named skills
   OR on DamageType 2.
3. **Requirement type 5 (BulletIds) now resolves.** Bullet ids are not a prefix
   of our damage ids; they join through `data/bullet-timings.json`
   (`bulletDamageIds`) to a damage id and from there to a `hit-map.json` key.
   77 valued roster buffs use type 5, against type 1's 106.

**[The six unread clauses, all traced]** None was a hole in the data.

| Clause | Source | Why still unread |
| --- | --- | --- |
| Hiyuki S6 Glacio Bite +25% | `db_buff 1108501811`, EEID 38, grow1 2500, requirement 17 on DamageSubType **1007** | Amplifies the STATUS's damage (`enemy-status.js`), which has no crit and no gear stat. Needs a per-status amplify lane |
| Aemeath S2 Fusion Burst x2 | `affliction-damage.json` buffs `1210072022`/`23` (base, +10%/stack) vs `1210072024`/`25` (S2, +15%/stack, +400% main target) | Full tables already extracted; what is missing is variant SELECTION by chain level |
| Yuanwu S3 +20% DEF | `db_buff 1303700703`, EEID **9 DamageAugment**, attribute 10 current value, bullet `1303904003` | Client adds `max(attr x rate + flat, 0)` as flat damage. Needs a stat-scaled flat add |
| Xiangli Yao S1 6x8% | bullets `1305053101..106`, damage row `1305053101` RateLv 2568 = exactly 8% of Law of Reigns' 32100 | Rate is shipped, not derived. Needs an added-instance shape |
| Camellya S6 "to 250%" | Forte params: 50% base + 5%/bud to a 50% cap; S6's own leading clause adds 150%, already read | **Correctly unread** — 50 + 150 + 50 = 250 is a restated CEILING. Reading it double-counts |

**[Verification Method]** `npm test` 65/65, `npm run sweep` 67 imported / 0
failed, `npm run lint` 0 errors. LOCK A: +66/-5 lines, all of it scope fill —
`scopeByFamily` coverage 37 -> 72 values. LOCK B: 26 lines, confined to
`characters/1108/bySequence/6` — Hiyuki's S6 crit weight (+49% critRate,
+34% Liberation bonus). No team score moved. The bullet join is self-verifying:
her bullets resolve to `liberation_inward_vision` + `liberation_blade_liberation`,
which is her clause verbatim.

**[Residual Risks]** The five traced-but-unread clauses are still known
understatements of those five characters; each now names the engine shape that
would clear it. Hiyuki's `effect-overrides.json` deferred keys were renumbered
(S6.0/S6.1 -> S6.1/S6.2) because S6 gained a leading effect — the frozen
effect-slot-key invariant biting exactly as documented; any OTHER saved build
referencing Hiyuki S6 stacks by key is subject to the same shift.

**[Updated Docs]** `CLAUDE.md` (two new invariants: the para index + ANY/ALL
check, and the bullet-chain scope route), `docs/HISTORY.md` (this entry).

---

## 2026-08-08 — Chain-added damage instances (and a correction to the entry above)

**[Correction first]** The 2026-08-07 entry says Aemeath's S2 Fusion Burst
clauses are "missing variant SELECTION by chain level". That is wrong.
`AFFLICTION_TRIGGERS[1210]` in `enemy-status.js` already carries
`buffIdByChain: { 2: 1210072024 }` and `stardust.buffIdByChain: { 2: 1210072025 }`,
so the S2 tables were already being selected. Her two clauses are unread by the
PARSER on purpose — the mechanic lives in the affliction lane and reading the
sentence as a buff on her own hits would double-count into the wrong formula.
Nothing was broken; the note over-claimed.

**[Files Changed]** `tools/preprocess/chain-extra-hits.mjs` (new),
`tools/preprocess.mjs` (the pass + `dataset.chainExtraHits`), `src/core/skill.js`
(`chainExtraHitsFor` + the attachment), `tests/chain-extra-hits.test.mjs` (new),
`data/wuwa-data.json`, `data/wuwa-meta.json`, `CLAUDE.md`.

**[Logic Altered]** A Resonance Chain's own damage instances ship as bullets
marked 共鸣N, and their rows are already in `damageTable` — `matchRowHits` never
attaches them, because the kit's display rows describe an S0 build. 111 such
rows exist across 20 resonators, so an S1 Xiangli Yao's six Convolution Matrices
were shipped, present, and worth exactly nothing.

The dangerous half is that most chain-marked bullets REPLACE a hit rather than
add one — 84 of 106 measured — and adding a replacement inflates a character
instead of merely understating them. The name test (strip the marker, look for
an unmarked sibling) turned out to be a CANDIDATE generator, not an answer:
spot-checking all 16 survivors against their own chain node found Cantarella's
S1 "finisher" bullets and Phoebe's S6 heavies to be upgrades whose base bullet
is merely named differently, and Zhezhi's genuine extra Ivory Herald to resolve
onto the wrong parent (her Liberation, when the kit fires it from her Resonance
Skill and calls it Basic Attack DMG). So the pass ships only what `KIT_VERIFIED`
confirms, quoting the node; the other 14 are reported and withheld.

Within a `family` — one bullet, shipped once per chain level it exists at — the
highest level at or below the build's SUPERSEDES the rest.

**[What shipped]** Xiangli Yao only, confirmed three independent ways:

  - the kit says "6 Convolution Matrices … 8% of the skill's DMG Multiplier";
  - row `1305053101` is 0.2568 against Law of Reigns' own 3.21 total
    (4 x 0.4815 + 1.284) — exactly 8%, and still exactly 8% at the sim's real
    skill level (0.5106 / 6.3820);
  - S6's row `1305053201` is 1.760x the S1 row, exactly the "+76% DMG
    Multiplier of Law of Reigns" S6 states — which is why it supersedes.

Law of Reigns: 1 hit -> 7. Multiplier 6.3820 -> 9.4456 at S1 (+48.0%) and
11.7736 at S6 (+84.5%).

**[Verification Method]** `npm test` 66/66 (new file included), `npm run sweep`
67 imported / 0 failed, `npm run lint` 0 errors. LOCK A: +21/-1, the new
`chainExtraHits` block and nothing else. LOCK B: `generatedAt` + `engineHash`
only — no team score moved, since Xiangli Yao is not one of the six meta
anchors. The engineHash moved because `src/core/skill.js` is an ENGINE_FILES
member.

**[Residual Risks]** 14 candidates are withheld pending a kit-text read, so
those characters remain understated at high sequence — the same direction of
error as before, not a new one. Nine more were skipped for having no unique
parent skill key or no non-zero multiplier. The `KIT_VERIFIED` list is a manual
gate by construction: "is this an addition" is stated in English and nowhere in
the tables, so it cannot be derived. Chain UPGRADES of existing hits are still
not modelled at all — the base row stands and the improvement is dropped.

**[Updated Docs]** `CLAUDE.md` (new invariant), `docs/HISTORY.md` (this entry
plus the correction above).

---

## 2026-08-08 (later) — Chain UPGRADES are already modelled; a correction and a bug

Investigating whether the withheld addition candidates and the unmodelled chain
upgrades were the same problem. They are — one pairing decides both — but the
conclusion inverts the previous entry's claim.

**[Correction]** The entry above says chain upgrades "are still not modelled at
all — the base row stands and the improvement is dropped", and the 23b86f1
commit message repeats it. That is WRONG. The kit states an upgrade as a
percentage and the text parser already reads it:

    Xiangli Yao S6  "+76% DMG Multiplier of Law of Reigns"  → multiplierUp 0.76
    Cantarella S1   "+50%"                                  → multiplierUp 0.50, scoped
    Camellya S2     "+120%"                                 → multiplierUp 1.20, scoped
    Jinhsi S5       "+120%"                                 → multiplierUp 1.20

So a data-driven upgrade lane on top of that would DOUBLE-COUNT. The 共鸣N
damage rows are the DATA form of what the kit says in English, not a separate
mechanic. No upgrade lane was built, deliberately.

**[Files Changed]** `tools/preprocess/chain-extra-hits.mjs` (`stripChainMarker`
now normalises separators), `data/wuwa-data.json`, `data/data-version.json`.

**[Logic Altered]** Removing the 共鸣N marker leaves a separator RUN behind —
`坎特蕾拉终结技能-共鸣1-1` became `坎特蕾拉终结技能--1`, which never matched its base
`坎特蕾拉终结技能-1`. Collapsing runs took paired bullets 81 → 111 and the unpaired
pool 70 → 40, moving Cantarella's finisher rows to `paired` where they belong.
Withheld addition candidates fell 14 → 11. The shipped output is unchanged:
Xiangli Yao's matrices are unpaired either way.

**[The bug this surfaced]** Xiangli Yao's S6 `multiplierUp 0.76` carries
`skillType: 'skill'` (the kit calls it "Resonance Skill Law of Reigns") while the
node's own skillType is `forte_heavy`, so per the multiplierUp invariant it
matches NOTHING. Measured: the base Law of Reigns hit is 6.382 at chain 0 AND at
chain 6. `skill-scope.mjs` did not bind the clause by name either — its TARGET
form expects "The DMG Multiplier of X is increased", not "increasing the DMG
Multiplier of X by N%" — so the name that would have overridden the category was
never read. Expected value is 6.382 x 1.76 = 11.232.

**[Verification Method]** `npm test` 66/66, `npm run sweep` 67 / 0 failed,
`npm run lint` 0 errors. LOCK A: one line (`generatedAt`) — the pairing change
alters what is WITHHELD, not what ships. LOCK B untouched (no ENGINE_FILES
member changed).

**[Residual Risks]** 11 candidates still withheld pending a kit-text read. The
paired-upgrade set is now a usable CROSS-CHECK rather than a build target: the
data states the exact ratio (Xiangli Yao 1.76) that the text-parsed multiplierUp
should equal, which is how the mis-scoping above was caught. Nothing consumes
that check yet.

**[Updated Docs]** `docs/HISTORY.md` (this entry + the correction).

---

## 2026-08-08 (later still) — "Forte" is provenance, not a damage type

Maintainer's correction, mid-session: *"'forte_heavy' surfaced again. Confusing.
It's 'forte'. Forte itself is NEVER a damage type. It's a passive enhancement
and the resonator's specialty."* Correct, and it was costing damage.

**[Files Changed]** `src/core/buffs.js` (`nodeTypeMatches`, used by the
`multiplierUp` branch), `tests/node-type-match.test.mjs` (new),
`data/wuwa-meta.json`, `docs/HISTORY.md`.

**[Logic Altered]** A `forte_heavy` node is a Heavy Attack REACHED THROUGH the
Forte Circuit; the mechanical type is `heavy` and the `forte_` part is
provenance. `resolveChainInherentContext` compared `effect.skillType ===
hit.skillType` by strict equality, so a clause saying "Heavy Attack" never
matched a `forte_heavy` node and the effect was dropped whole. CLAUDE.md has
documented the intended rule — "a `forte_heavy` node uses 'heavy' for
multiplierUp matching" — since before it was implemented.

`nodeTypeMatches` strips the `forte_` prefix and compares. It is deliberately
NOT a general loosening: `basic` still does not match `forte_heavy`, and the
scope is the `multiplierUp` branch alone, which is the only consumer of the NODE
context (`skill.js` reads `ctxNode.multiplierUp`; every DMG-bonus bucket matches
the FORMULA type, which is never a `forte_*` value).

**[Measured]** Clauses stating a skill type that no node of their own resonator
could answer to: 4 -> 2.

    Changli            S5  heavy  +50%   — now applies
    Yangyang: Xuanling S6  heavy  +40%   — now applies
    Taoqi              S5  forte  +50%   — still dead (see below)
    Camellya           S6  forte  +150%  — still dead

**[What is left, and why it is NOT a matcher fix]** The two survivors state
`forte` as though it were a category. It is not, so the matcher must keep
refusing it. Both clauses NAME their skill — Camellya's is "Forte Circuit's
Sweet Dream" — so they are fixed by binding the name in `skill-scope.mjs`, the
same TARGET-form gap that leaves Xiangli Yao's S6 "+76% of Law of Reigns"
unbound ("increasing the DMG Multiplier of X by N%" is not the "The DMG
Multiplier of X is increased" shape it matches). Teaching the matcher a
category the game does not have would paper over both.

**[Verification Method]** `npm test` 67/67 (new file), `npm run sweep` 67 / 0
failed, `npm run lint` 0 errors. LOCK A unchanged (no preprocess change). LOCK B
moved for exactly two characters — 1205 Changli and 1108 Hiyuki, whose Heavy
clauses now reach their `forte_heavy` stages — plus 21 team scores shifting
0.3-0.4% as the ranking re-normalises around them.

**[Residual Risks]** Hiyuki's movement was not predicted from the census (her
S3 +160% Heavy now also reaches her Forte heavy stages); it is the correct
consequence of the same rule, but it means the fix reaches further than the two
clauses it was aimed at. Any kit clause that says "Heavy Attack" while meaning
only the non-Forte stages would now over-apply — none is known, and the game
does not appear to draw that distinction in kit text.

**[Updated Docs]** `docs/HISTORY.md` (this entry). CLAUDE.md's invariant already
stated the rule and needed no change — it was the implementation that was missing.

---

## 2026-08-08 (cont.) — The node/damage-type boundary, enforced

Maintainer, on seeing `forte_heavy` twice in one session: *"It's plain wrong.
The correct dmg types should be data-driven by DMG ID rows and/or bullet IDs.
Not through regex interpretation."*

**[What the premise got right and wrong]** There was no earlier `forte_heavy`
purge — no commit removes it, and it runs through this file continuously as a
key prefix and node type. Nothing regressed. And DAMAGE types already ARE
data-driven: `formulaType` is read from the game's own `skill.damage[*].type`
tag, never from text (Law of Reigns is `liberation` from data, while
`forte_heavy` is its NODE identity, which `castMatch` and the skill-level
lookup both need).

But the instinct found a real defect. Nothing ENFORCED the boundary, and a node
type had leaked into the damage-type column:

    Baizhi forte_heavy_concentration_healing   formulaType = forte_heavy

`formulaType` addresses the DMG-bonus buckets in `stats.js`, which are keyed by
real damage types, so a `forte_*` value there silently resolves to no bucket at
all (`dmgBonusBySkillType?.[…] ?? 0`).

**[Files Changed]** `tools/preprocess/skill-rows.mjs` (`mechanicalToFormula`,
applied to both fallbacks in `resolveInstanceFormula`), `tools/preprocess.mjs`
(the support-only stub at the second assignment site — the one that actually
produced the leak), `tests/node-type-match.test.mjs` (boundary guard),
`data/wuwa-data.json`.

**[Logic Altered]** A support-only row (Baizhi's is HEALING) has no damage
instances, so nothing data-driven sets its type and the mechanical fallback
fires. That fallback now strips the `forte_` provenance prefix, because the
fallback must still name a real damage type. The guard asserts no `forte_*`
value reaches `formulaType` at all, and pins the remaining `unknown` leak
(Lynae's discorded-tune row, which has no mechanical type to fall back to
either) so it cannot grow.

**[The strategic point, conceded]** Measured this session, `multiplierUp`
scoping is 52 by NAME/ids against 55 by regex CATEGORY, plus 19 unscoped. So
~44% still rides on category matching. The replacement already exists and is
already wired — `ExtraEffectRequirements` type 1/5 -> `skillKeys`, which
short-circuits the category branch entirely (`named` in
`resolveChainInherentContext`). The direction is to grow the id lane until the
category branch is dead weight, NOT to keep improving the regex lane. The
previous entry's matcher fix stopped four effects being silently dropped, which
was real, but it made the regex lane work better rather than matter less.

**[Verification Method]** `npm test` 67/67, `npm run sweep` 67 / 0 failed,
`npm run lint` 0 errors. LOCK A: one row, `forte_heavy` -> `heavy`. LOCK B
untouched (no ENGINE_FILES member changed).

**[Residual Risks]** One `unknown` formulaType remains (Lynae), pinned by the
ratchet. The boundary guard covers `autoSkillMap` only; nothing yet asserts the
same for effect-side `skillType` values, which is where the two surviving
`forte` pseudo-type clauses (Taoqi S5, Camellya S6) live.

**[Updated Docs]** `docs/HISTORY.md` (this entry).

## 2026-08-08 (cont.) — multiplierUp scope: bind the clause's own names

Steps 1, 1b and 2 of `docs/HANDOVER-multiplierup-scope.md`. Six chain/inherent
effects shipped with `stat: 'multiplierUp'`, no `skillKeys`, no `skillType`,
`defaultActive` and `window.type === 'always'` — so their value reached EVERY
hit the wielder landed, from a clause that names one skill. A Cantarella S2
build resolved `multiplierUp = 2.45` on `basic_1`: every unrelated hit
multiplied 3.45x. Silent INFLATION, the opposite of the understatements fixed
earlier in the day.

**[Files Changed]** `tests/multiplier-scope.test.mjs` (new),
`tools/preprocess/skill-scope.mjs`, `tools/preprocess/effects.mjs`,
`data/effect-overrides.json`, `tests/stack-metadata.test.mjs`,
`data/wuwa-data.json` + `data/wuwa-meta.json` + `data/data-version.json`
(regenerated), `docs/HANDOVER-multiplierup-scope.md`.

**[Logic Altered]**

*The guard (step 1).* `tests/multiplier-scope.test.mjs` fails when any
`multiplierUp` effect is always-on with no scope at all, and separately when a
clause whose skill names RESOLVE is not bound to them — the second catches
`bindSkillScopes` being dropped or ordered after anything keyed on an effect
slot. Six failures on day one, 0 now.

*The truncation (step 1b).* `effects.mjs` stores `condition` truncated to 120
characters FOR DISPLAY, and `bindSkillScopes` read that same field; 32 clauses
are longer, and the cut routinely removes the skill name (Xiangli Yao's "Law of
Reigns" survived as the fragment "Resona"). Fixed without a new field or any
dataset growth: the node's own `desc` is already in hand, the truncation is a
prefix, so the full clause is recovered by re-splitting `node.desc` and matching
`clause.slice(0, 120)`.

*The shapes (step 2).* `TARGET_STAT` now takes the plural the game writes
whenever it lists skills (`DMG Multipliers of X, Y and Z **are** increased` — 14
clauses, matched by NONE of the forms before, one character). A captured name is
trimmed where the sentence resumes (`by N%`, `is/are`, `triggered by`, `granted
by`, `within Ns`), which is what "of Jolt triggered by Cantarella" needed. Four
forms added: `for` in place of `of`, `X has its …`, the bulleted `the following
skills: - X, Y, Z` list, and a name sitting directly in front of `DMG
Multiplier` (`10% additional Hack DMG Multiplier`). A TARGET capture that
resolves to nothing now falls through to the SUBJECT form instead of ending the
search, and the SUBJECT is walked BACKWARDS across commas — the subject is
itself a list often enough to matter (Luuk S6, Qiuyuan S3.1).

*Two corrections to the audit's own recommendations, both measured.* Its item 4
("stop `targetNamesInClause` applying `PROSE_CATEGORY_LEAD` to the whole name …
Zero-risk") is not zero-risk: with the strip gone, a name that is nothing but a
CATEGORY resolves by token, and one token is far too blunt — "Heavy Attack"
reaches Cartethyia's `forte_heavy_mid_air_attack_*`, which are not Heavy
Attacks. The strip is removed AND bare-category names are refused, so a category
keeps travelling through `skillType`/`nodeTypeMatches`, which strips the
`forte_` provenance prefix properly. That leaves Brant S6.0 with no name to
bind, so its inflation is fixed at its real root instead:
`SCOPE_ONLY_PHRASE_TO_TYPE` demanded `Mid-air Attack DMG` where the clause
writes `Mid-air Attack's DMG Multiplier`. One possessive, and the category scope
was lost entirely.

*Two regressions caught by the roster-wide diff, before they shipped.*
`POSSESSIVE_FORM` captured `[^.;]+?`, which reaches back over commas and
swallowed a whole leading trigger clause; "Resonance Mode - Tune Rupture" inside
it then resolved to `forte_heavy_tune_rupture_response_starburst`, scoping
Aemeath's global +20% Crit. DMG to one row. Fixed by making the capture
comma-free (the same rule `SUBJECT_FORM` already had) and by removing
"resonance mode" from the category stripper — a MODE is not a category a skill
is filed under, so stripping it exposes the mode's name, not a skill's.

*A bulleted list runs past its own clause* (found by the first verification
agent). The game ends a bullet group with a period and opens the next with a
bullet, so `splitClauses` cut Augusta's seven names into three clauses of which
only the first carries the effect — and an all-or-nothing gate cannot weigh
members it was never handed, which is exactly the property it was written to
guarantee. `namesInClause` now takes the clause AND everything the node says
after it, and the bullet reader absorbs following clauses while they are bare
continuation bullets. Augusta 4 of 7 named skills → 7 of 7. Every other form
still reads the first clause alone.

*A bulleted list of TRIGGERS is not a scope* (found by the second verification
agent). `BULLET_LIST_FORM` matched on "following skills" alone, and the game
writes the identical list to say what FIRES an effect: Galbrena's inherent is
"1 stack of Fated End is inflicted on the target when the following skills hit:
Intro Skill, Basic Attack, …", where 11 of 13 members resolve and only the
all-or-nothing gate stood between an infliction list and a buff scope. The stat
must now be named in the preamble ahead of the colon — on either side of
"following skills", since the game writes both orders.

*The slot shift.* Luuk Herssen's S6 first clause is a `needsScope` amplify that
used to be DROPPED as unscopable and now binds to its five named keys, so it
occupies S6.0 and Endnotes moved to S6.1. `S{level}.{index}` is positional by
design, so the curated override and the `stack-metadata` expectation were
re-slotted with a `_reslotted` note. A saved build's `effectStacks['S6.0']` for
1510 now addresses the amplify, which is not stackable and ignores it; the
Endnotes count falls back to its default.

**[Verification Method]** `npm test` 68/68 (the new file included),
`npm run sweep` 67 imported / 0 failed, `npm run lint` 0 errors.
LOCK A: 241 lines, all of them `skillKeys` additions — intended, this is a
behaviour change. LOCK B: moved, which the plan called for. Bindings went 52 →
87. Direct measurement through `resolveChainInherentContext`: all six effects
now read 0 on an unrelated hit and their stated value on the skill their clause
names (Cantarella `skill_jolt` 2.45 / `basic_1` 0, Chisa
`forte_heavy_sawring_eradication` 2.40 / 0, Phrolova `basic_scarlet_coda` 1.50 /
0, Zani `forte_heavy_heavy_slash_daybreak` 0.40 / 0, Brant
`midair_mid_air_attack_1` +0.30, Lucy `forte_heavy_hack_response_data_crash`
0.15 / 0). Every one of the 32 changed rows was read against its own kit text.

**[Verification — the §6 protocol]** Two independent agents, both asked to
DERIVE and to try hardest to refute. Both confirmed the six and the direction
(0 on an unrelated hit, stated value on the named key). Both returned
corrections, which is the point: agent 1 found the bulleted list being cut at
the clause boundary, agent 2 found `BULLET_LIST_FORM` firing on a TRIGGER list
and the two behaviour-neutral facts recorded below. Both independently landed on
Suisui S5.0 as the one live over-bind. Both fixes above were made after their
reports and re-verified.

**[Two changes that are not defects but must be on the record]**

- **Taoqi S6.0 LOST its `skillKeys`** — "Taoqi's Basic Attack and Heavy Attack"
  is a bare category, which the new guard refuses. Measured through
  `resolveChainInherentContext` against both versions: the payout set is
  IDENTICAL (the same six keys), because `skillType: 'basic'` +
  `nodeTypeMatches` reaches exactly them. The clause's "and Heavy Attack" is
  modelled by neither version — a pre-existing gap, unchanged.
- **`isBareCategory` refuses names that WOULD resolve** — "Dodge Counter",
  "Plunging Attack", "Echo Skill", "Forte Circuit". That is safe only while the
  category fallback can answer for the clause, and all 10 live refusals sit in
  clauses whose `skillType` is non-null. A future clause naming only one of
  those has no `detectSkillType` phrase and would end up scoped to nothing —
  which is why `plunging`/`echo`/`circuit` were dropped from `CATEGORY_TOKENS`,
  and why guard 1 of `tests/multiplier-scope.test.mjs` exists: it turns exactly
  that failure into a build error instead of silent inflation.

**[Residual Risks]**

- **Suisui S5.0 binds `skill_drizzle_stance`, which her clause does not name.**
  Both verifiers found it independently and it is the only live over-bind on the
  roster. "Heavy Attack - Drizzle Stance" has no key, so the category-stripped
  attempt resolves the bare "Drizzle Stance" and reaches the Resonance Skill
  row. There is no principled fix available: filtering that attempt by the
  name's own category is exactly what CLAUDE.md forbids ("the category read off
  the same clause is the weaker restatement and can contradict it outright" —
  it is what lets "Basic Attack Phantom Sting" reach `forte_heavy_phantom_sting_*`).
  Net still a large improvement: 9 paid rows → 5, dropping 5 rows the clause
  never named and adding 1.
- **Partial name resolution narrows a scope.** Where a clause names two skills
  and only one has a reachable key, the effect binds to that one and the other
  loses the grant it used to get from the category fallback: Rebecca S3.0 ("Party
  'til Dawn!" has no key), Lucy S3.1/S3.0 before the noise strip, Luuk S3.1
  ("Mid-Attack - Gavel of Earthshaker" — the game's own typo). This is the
  documented behaviour of the pass ("once the names match they ARE the scope")
  and the same trade the Suisui comment already records, but it is a real
  understatement in those rows.
- **Suisui S5.0 picks up `skill_drizzle_stance`.** Her clause names "Heavy
  Attack - Drizzle Stance", which has no key; the category-stripped fallback
  resolves "Drizzle Stance" and reaches the Resonance Skill row as well as the
  four `forte_basic_` ones. Still strictly narrower than the `basic` category it
  replaced.
- **`NAME_NOISE` is a word list.** It is applied only in the LOOSEST resolution
  attempt, so it can never widen a name the four narrower forms already read,
  but adding to it is how this quietly goes wrong. Measured: 11 real bindings
  resolve through it, all correct; 48 skill labels contain one of its words and
  every one of them resolves at attempt 1, so the loose attempt never sees them.
- **Two guarantees hold empirically, not structurally.** (a) The subject
  backward walk never reaches a leading TRIGGER because every real trigger opens
  with "After casting"/"When casting"/"Whenever", none of which is a stopword —
  a trigger opening with one ("In Ichor Deposit, Aureole of Execution gains …")
  would be absorbed. No such clause exists on the roster; only 3 clauses walk
  past the verb-adjacent segment at all, and all 3 are genuine subject lists.
  (b) `NAME_TAIL` would cut a name that legitimately contains " is " — Augusta's
  `liberation_sublime_is_the_sun_*`. Not live: her clause is a bulleted list,
  and the bullet reader never calls `trimNameTail`. Roster-wide `trimNameTail`
  changes 12 resolutions, every one of them `none → the correct key`.
- **Saved builds are not migrated.** A persisted `effectStacks` entry for
  `1510 S6.0` now addresses the amplify, which is not stackable and ignores it;
  Endnotes at S6.1 falls back to its default. No data is corrupted and no
  migration was written.
- Rebecca S1.0's bulleted list, shapes 7b and 8, Aemeath S2.2's wrong lane and
  Hiyuki S6.2's mis-parsed Crit. DMG are all still open, each with its reason
  recorded in the handover.
- **Phrolova S2.0 and S2.1 now both pay `basic_scarlet_coda` unconditionally**
  (+75% each, +150% total), because scoping them to the same key made a
  pre-existing gap visible: the kit gates the second on Aftersound
  ("**Aftersound now additionally** increases …") and the clause classifier does
  not read that. Newly visible, not newly wrong.
- **Taoqi S5.0 and Camellya S6.0 pay out on ZERO keys** in this version and in
  every version before it: they carry `skillType: 'forte'`, and
  `nodeTypeMatches('forte', 'forte_heavy')` strips the prefix to `'heavy'`,
  which never equals `'forte'`. The handover expected step 2 to fix them by
  name; measured, neither name exists as a key. Both are dead buffs and want
  their own look.

**[Updated Docs]**

- `docs/HISTORY.md` — this entry.
- `CLAUDE.md` — four new invariants, each one a defect this session paid for:
  an unscoped `multiplierUp` multiplies the whole kit; a bare CATEGORY is not a
  skill NAME (and refusing one is only safe while `detectSkillType` can answer);
  the scoping pass reads the FULL clause, not the 120-char `condition`; and a
  list of casts that FIRE an effect is not its scope.
- `docs/ARCHITECTURE.md` — the `skill-scope.mjs` row now says what it reads and
  what it refuses, and names its guard.
- `docs/OPEN-ITEMS.md` — new item **33**, the residue: Suisui's over-bind, the
  two dead `forte` buffs, partial name resolution, Rebecca's list, the two
  wrong-lane clauses, Phrolova's double grant, and the missing saved-build
  migration. That list, not the handover, is what to work from now.
- `docs/HANDOVER-multiplierup-scope.md` — CLOSED banner at the top, steps
  1/1b/2 marked done, the outcome and the two audit corrections recorded, a
  "Still open after step 2" section added, and the claim that step 2 would fix
  Taoqi S5 / Camellya S6 struck through: measured, neither name has a key to
  resolve to (Taoqi ships `forte_heavy_timed_counters_*`, Camellya
  `forte_heavy_ephemeral`), so the two `forte` survivors in
  `tests/node-type-match.test.mjs` stay at 2.
- `docs/multiplierup-scope-audit.md` — RESOLVED banner; its Status columns are
  now stale and it is kept for the reasoning. Its own two mis-calls (item 4 is
  not "zero-risk"; the all-or-nothing guard was per-clause, not per-list) are
  recorded on it.
- `README.md` — test count 50 → 68, `OPEN-ITEMS.md` added to the layout and
  named as the backlog, and the Simplification Plan correctly described as
  complete rather than "the current cleanup roadmap".

---

## 2026-08-10 — The DPS-gap harness, and the first reproducible gap figure

Executes steps 1 and 2 of `docs/HANDOVER-dps-gap-harness.md`. Two agents built
the harness INDEPENDENTLY (maintainer's verification protocol, §7) from the same
brief, in separate files, without seeing each other's work. Their numbers agree
to the digit on every figure below.

**[Files Changed]**

- `tools/benchmark-gap.mjs` — NEW. The harness. Nothing else in the repo moved.

**[Logic Altered]**

None. The harness is purely additive and reads the engine through its public
entry points (`simulateTeamRotation`, `templateStats`, `rolesOf`).

**[The number, at last reproducible]**

`node tools/benchmark-gap.mjs --zero-res` — 3 passes, S0, L90, the reference's
pinned R1 weapons and sonatas, recommender `templateStats` echoes, 0% RES:

| | sim | reference | gap |
| --- | --- | --- | --- |
| team damage | 3,999,049 | 6,533,757 | **1.634x** |
| team DPS | 52,546 | 82,874 | **1.577x** |
| team time (gameTime) | 76.11s | 78.84s | 1.036x |
| Chisa | 278,844 | 594,209 | 2.131x |
| Denia | 710,194 | 1,306,453 | 1.840x |
| Aemeath | 3,010,011 | 4,633,096 | 1.539x |

At the app team page's 10% RES target the damage gap is 1.815x / DPS 1.752x.
2.60x, 2.09x and 1.80x remain dead.

**[Three corrections to the handover, all measured]**

1. **§4 anchor 2 (the Chisa shape) is REFUTED, and inverted.** Its PREMISE holds
   — Chisa gains nothing from her teammates (in-team 278,844 vs alone 300,837,
   −7.3%), while Denia gains +43.0% and Aemeath +35.2% from her presence. But
   the conclusion drawn from it does not: the member the team-buff lane never
   touches is the WORST match (2.13x) and the two who receive it in full are the
   BEST (1.84x / 1.54x). On this measurement **the gap does not localise to the
   team-buff lane** — the shortfall is broadly uniform, so per-character damage
   is back in scope. Partial confound, stated: the recommender gives Chisa
   (HEALER-tagged) a Healing Bonus 4-cost main; forcing Crit DMG moves her to
   1.73x, between the other two. Aemeath is still closest either way.
2. **§4 anchor 1 (Tune Break) is off in the OPPOSITE direction.** Sim 80,428
   context-free / 82,909 in-team (Havoc Bane DEF shred) against 62,689 — the sim
   is 1.28x HIGH on the one gear-independent number, while everything else is
   1.5–2.1x low. The formula takes no ATK and no gear stat, so the residual is a
   target assumption: 62,689 needs `TUNE_AMP x defMult x resMult` at 0.779x what
   the engine uses (≈22% RES, or TUNE_AMP 12.47 vs 16.00). Undecidable from the
   reference, which records only the number.
3. **§3's denominator note distinguishes nothing, and the real trap is elsewhere.**
   "Sum of per-member on-field times" EQUALS wall-clock in this engine (the
   cursor advances only by intro + rotation; the outro runs parallel). The trap
   is that under `timingMode: 'toa'` the engine's own DPS denominator is
   `gameTime = time − freeze` (team-sim.js:359). Wall-clock is 134.25s against
   gameTime's 76.11s, so dividing by the wrong one turns a 1.58x DPS gap into
   2.78x. Both agents hit this; both caught it.

**[Two lanes that score zero — neither is the gap, both are real]**

- Every `__echo__` step deals 0 in 0s: `templateStats` sets echo `id: null`
  ("stats don't depend on echo id" — true of stats, false of the CAST). Real
  echoes are worth ≈ +5%.
- All nine outro segments deal 0: none of 1508 / 1211 / 1210 has ANY
  `skillType === 'outro'` key in `effectiveSkillMap`. Against the standing
  invariant that an Outro's multiplier is read from the sentence stating it —
  whatever that pass fixed did not reach these three.

**[New lead, replacing the refuted one]**

The sim barely ramps across passes on identical rotations while the reference
does: team p2/p1 sim 1.004 vs reference 1.067; Aemeath goes BACKWARDS (0.975 vs
1.022). Denia's and Aemeath's segment damage is bit-identical across all three
passes — only the status lane varies.

**[Also found]**

- `introKeyFor` (team-sim.js:1323) picks the first `intro`-typed key in dataset
  order, not the one the rotation's grants need: Aemeath gets
  `intro_songs_across_the_universe` (1.3458) where `STAGE_GRANTS[1210]` requires
  `intro_debut_of_meteoric_radiance` (1.6325) to grant her opening `skill_mech_3`.
  Denia likewise gets `it_s_been_a_while` (1.0462) over `knock_knock` (1.5522).
- Resonance mode is NOT in the reference and is worth up to 30%
  (fusion_burst/fusion_burst 3,999,049 vs Aemeath=tune_rupture 2,808,002). The
  curated modes are used as primary. **This wants a maintainer ruling before the
  gap number is stable.**

**[Verification Method]**

`npm test` 68/68, `npm run sweep` 67 imported / 0 failed, `npm run lint` 0
errors. `git status` shows one added file. Harness output byte-identical across
consecutive runs. Per-pass marginals sum to `memberTotals` exactly; per-member
gameTime sum reproduces the engine's own DPS to <1. Two independent harnesses,
built from the brief alone in separate files, agree on every figure.

**[Residual Risks]**

- The resonance-mode choice (above) is the single largest unpinned input.
- Neither the reference's echoes nor its enemy RES are recorded; both are
  assumptions worth ≈5% and ≈11% respectively.
- Chisa's pass-2/3 prose contains the Sawring — Blitz chain but no Serrated Loop
  (the only cast entering Chainsaw Mode). Self-consistent only if she holds the
  mode from pass 1. The engine models neither, so the keys resolve regardless,
  but the prose is underspecified.
- `simulateTeamRotation` takes ONE rotation per member for all passes, so
  Chisa's differing pass 1 is reported as its own run (RUN B), never blended.

**[Updated Docs]**

- `docs/HISTORY.md` — this entry.
- `tools/benchmark-gap.mjs` — carries its own D1–D10 + Z1/Z2 decision record, so
  the method travels with the tool rather than with a chat log.

---

## 2026-08-10 (later) — Investigating the gap: three named causes, 57% closed

Step 3 of `docs/HANDOVER-dps-gap-harness.md`, on top of the harness above.
Maintainer ruling first: **both Aemeath and Denia run `fusion_burst`** — this
composition is Fusion-Burst synergy (Chisa raises negative-status max stack
counts and brings no Tune-Break buffs); a Tune-Break Aemeath team is a different
roster (Mornye / Lynae / Aemeath). Recorded as D9 in `tools/benchmark-gap.mjs`;
`--tune-modes` is retained only as the refuted alternative.

**NOTE ON PROCESS:** the parallel verification agent hit the account's monthly
spend limit and terminated before reporting. Everything below is therefore
SINGLE-SOURCED and has NOT met the two-agent bar. It wants an independent pass.

**[Files Changed]** `tools/benchmark-gap.mjs` (D9 rewritten to the ruling);
`docs/HISTORY.md`. No engine file touched — nothing below is fixed yet.

**[The ladder]** (0% RES, 3 passes, reference 6,533,757)

| step | team total | delta | gap |
| --- | --- | --- | --- |
| baseline | 3,999,049 | — | 1.634x |
| + co-optimized substats | 4,715,279 | +716,230 | 1.386x |
| + Thread of Bane 18% DEF ignore | 5,169,712 | +454,432 | 1.264x |
| + Denia Erosion Field | 5,441,846 | +272,134 | 1.201x |

Shortfall 2,534,708 → 1,091,912. **56.9% closed.**

**[1. Anchor build vs. pinned weapon — +716,230, category: harness input]**

`templateStats` is a FIXED 25-roll package tuned (its own comment) to land
≈ CR 69% / CD 285% *with `representativeWeaponId`*. The benchmark PINS different
weapons, and against those the same package over-caps Crit Rate — Chisa 105%,
Aemeath 113.3%, every point over 100% dead — while starving Crit DMG.
`allocateSubstats` adapts and recovers 716,230.
**Self-correction, measured:** this is NOT a roster-wide crit over-cap. Checked
all 56 resonators at their representative weapon: **0 exceed 100% CR.** The
defect is the template not adapting to the equipped weapon, so it does NOT
generalise to other teams, and it does NOT explain the Hiyuki shortfall.
This does contradict the handover §3 claim that the substat spread is "far too
small to explain the gap" — for this team it is the single largest term.

**[2. Chisa's Thread of Bane — +454,432, category: genuine engine gap]**

Kit: "When dealing damage to targets affected by [Unseen Snare], **ignore 18% of
their DEF**" — applying to EVERY Resonator's damage, not just hers. Neither
"Unseen Snare" nor "Thread of Bane" appears anywhere in `src/`, `tools/` or
curated data; the only `defShred` source in the engine is Havoc Bane
(team-sim.js:813). The tell that this is an omission and not a judgement call:
the engine already lands **21 Havoc Bane stacks** from Chisa, and her kit only
grants those THROUGH Unseen Snare — so the mark is assumed up for the stacks and
ignored for the DEF clause on the same mark.

**[3. Denia's Erosion Field — +272,134, category: genuine engine gap]**

"After casting [Final Act - Breakdown Form], generate an [Erosion Field] lasting
30s … pulls in nearby targets once every 4s, dealing Fusion DMG, considered
[Resonance Liberation DMG]." `forte_heavy_erosion_field_dmg_per_tick` carries a
real damage id, but Denia's `offFieldActions` is null and the key is in no
rotation. One tick 12,959 x 7 ticks x 3 casts.

**[What is NOT wrong — checked, don't re-investigate]**

- The negative-status machinery is sound: 48 fusion_burst applications, Chisa's
  +3 cap raise arming correctly off her Outro (stacks reach 13 not 10, doubling
  the detonation 6.9863 → 13.9726), 9 bursts at 25,735, Aemeath's affliction lane
  736,032. `statusDamageGaps` reports nothing.
- Aemeath's `Between the Stars` IH1 tier DOES fire here (2 distinct fusion_burst
  applicators ≥ minCount 2 → +25% liberation amplify).
- Chisa's Sawring-Blitz already carries `formulaType: 'liberation'` — the kit's
  "considered Resonance Liberation DMG" conversion is data-driven and applied.

**[Hiyuki / Snow Rust cross-check — the lead does NOT pan out at size]**

`conditional-buffs.js:~250` declines to model Hiyuki's Glacio Bite because
"its scaling is … `stackMult: null, pending calibration` … modeling it would mean
fabricating a number we don't have". **That comment is now stale**:
`affliction-damage.json` ships row **1007** (a second glacio_chafe damage row,
`resonatorId: 1108`, buffs 1108501133 / 1108501511, `stackLimit: 1`,
`byStacks: {"1": 1}`), and `dataset.statusDamage.glacio_chafe.byStacks` is fully
calibrated. So the lane is buildable today.
BUT it is SMALL: one instance at multiplier 1.0 is **1,842** at lv90 / 0% RES —
40 applications is 73,674, under 2% of a team total. Real, cheap to build,
and NOT an explanation for Hiyuki teams being "substantially lower".
**No shared root cause between this team and the Hiyuki teams was found.**

**[Smaller, measured but not counted]**

- Denia resolves exactly ONE effect window. Void Particle's "+50% DMG Multiplier"
  and its "considered Resonance Liberation DMG" conversion on Breakdown normals
  are both absent (≈ 34k over 3 passes).
- `forte_heavy_seraphic_duet_bonus_dmg_per_instance` (Aemeath, 7,241/instance)
  and `forte_heavy_bonus_dmg_multiplier_per_ring_of_chainsaw` (Chisa, 170) carry
  real damage ids and are never cast. Aemeath's MAY already be paid via the
  affliction lane — not claimed without disambiguating.

**[Verification Method]** `npm test` 68/68, `npm run sweep` 0 failed,
`npm run lint` 0 errors. Every figure produced by `node -e` against the live
dataset and re-derived through `simulateTeamRotation`; the ladder is cumulative
and each delta measured by moving one axis. Roster-wide crit check over all 56.

**[Residual Risks]**

- SINGLE-SOURCED (see process note). Not verified by a second agent.
- 1,091,912 (1.20x) remains unexplained.
- The Erosion Field figure assumes 7 ticks per 30s cast and no off-field
  contention; modelled as a flat add, not through `computeOffFieldContribution`.
- Thread of Bane applied as a global `target.defIgnore`; the real mechanic is
  gated on Unseen Snare uptime, taken here as 100% (its "[Locking] on to a
  target" trigger is always satisfiable, per the always-hits invariant).

**[Updated Docs]** `docs/HISTORY.md` (this entry); `tools/benchmark-gap.mjs` D9.

---

## 2026-08-10 (build) — Thread of Bane + Erosion Field wired in; patch.json reaches Node

Builds the two confirmed engine gaps from the investigation above, plus the
root cause found while wiring them.

**[Files Changed]**

- `src/core/enemy-status.js` — `DEF_IGNORE_GRANTS`, `defIgnoreGrantsForResonator`,
  `defIgnoreOutroGates`, `defIgnoreForMemberAt`.
- `src/core/team-sim.js` — accumulate the Outro gates; fold the member's DEF
  ignore into `memberTarget.defIgnore`.
- `src/core/off-field.js` — an `OffFieldAction` may declare its own `skillType`
  (default `'basic'`, so no existing action changes).
- `src/data/loader.js` — extracted+exported `applyPatch(baseline, patch)`;
  `loadDataset` now calls it.
- `tools/optimize.mjs` — applies `applyPatch`; `ENGINE_FILES` is now
  `src/`-relative and includes `data/loader.js`.
- `tests/meta-schema.test.mjs` — ENGINE_FILES copy kept in sync.
- `data/patch.json` — Denia's Erosion Field.
- `tests/thread-of-bane.test.mjs` — NEW, 21 assertions.
- `data/wuwa-meta.json`, `data/data-version.json` — regenerated.

**[Logic Altered]**

1. **Thread of Bane.** Chisa's Outro "Unraveling - Law Zero" (params
   `[20,3,15,15]`) states TWO bullets; only the cap raise was modelled. The
   second — "Inflicting Negative Status or dealing Negative Status DMG grants
   [Thread of Bane] for 15s", where Thread of Bane is "ignore 18% of their DEF"
   — now grants `defIgnore` to any status-inflicting member playing inside the
   20s gate. `defIgnore`, NOT `defShred`: the formula multiplies
   `(1−defShred)(1−defIgnore)` separately and the kit says "ignore".
   **Resolved from the GATE, not from realised applications** — a member's
   applications derive from its own steps, so they do not exist until after its
   segment has simulated, but the value must be in `target` BEFORE it runs.
   Arming from applications and sampling at segment start fires NEVER (the only
   visible window would be the previous pass's, ~45s stale against a 15s
   duration) — a silent zero, which is how the first cut of this shipped and
   why it measured 0. The gate is the real constraint anyway: a member that
   inflicts at all does so on its first damaging step.
   Chisa herself correctly gains nothing — her gate opens as she LEAVES.
2. **Erosion Field.** 30s / 4s-period turret off `Final Act - Breakdown Form`,
   `multiplier` = `mults[9]` of damage row 12110007001 (skill level 10),
   `skillType: 'liberation'` per the kit's "considered [Resonance Liberation
   DMG]". The preprocess turret branch only reads Outro Skill nodes, so a Forte
   Circuit persistent field was never derived.
3. **patch.json now reaches Node.** It is a RUNTIME overlay `preprocess.mjs`
   never bakes in, so everything reading `wuwa-data.json` off disk — the offline
   optimizer, every test, the new harness — saw an UNPATCHED dataset while the
   browser saw a patched one. `tools/optimize.mjs` even carried a comment
   claiming it "Mirrors src/data/loader.js's merge" while mirroring only the
   `statRanges` half. Consequence: **Phrolova's and Ciaccona's curated
   `offFieldActions` had never once reached the meta** — both were ranked with
   zero off-field damage in every meta ever shipped.

**[Measured effect]** (harness, 0% RES, 3 passes, reference 6,533,757)

| | team | gap |
| --- | --- | --- |
| before | 3,999,049 | 1.634x |
| after | **4,429,175** | **1.475x** |

Denia 710,194 → 936,026 (1.396x); Aemeath 3,010,011 → 3,214,305 (1.441x);
Chisa 278,844 unchanged (correct). DPS gap 1.577x → **1.424x**.

**[Verification Method]** `npm test` 69/69 (incl. the new file),
`npm run sweep` 67 imported / 0 failed, `npm run lint` 0 errors.
LOCK A: `wuwa-data.json` diff was `generatedAt` only → reverted;
`data-version.json` legitimately moves because its hash covers `patch.json`.
LOCK B: `wuwa-meta.json` regenerated and changes substantially — EXPECTED, this
is a deliberate behaviour change (three characters gained off-field damage and
two gained a DEF-ignore window), not a behaviour-preserving refactor.

**[Residual Risks]**

- Thread of Bane is a per-SEGMENT binary (sampled at segment start), matching
  the existing Havoc Bane `defShred` convention. A member whose segment starts
  just before the gate opens gets nothing for that whole segment; one whose
  segment starts just inside it holds the buff for the entire segment even
  past the 15s. Fractional coverage needs per-step targets, which the segment
  API does not have.
- The Erosion Field does NOT yet apply Fusion Burst stacks. Maintainer's point
  (2026-08-10) is that it should — more stacks, more detonations — so the true
  value is HIGHER than the +158,697 measured here. Off-field segments carry
  `steps: []`, so `applicationsFromSteps` never sees them; wiring that is its
  own change. **Named as the next piece of work, not silently dropped.**
- Still single-sourced: the verification sub-agent hit the account spend limit.
- 1.475x remains. Chisa is now the outlier at 2.131x and is the obvious next
  target (she has no status lane and receives no team buffs, so her shortfall
  is pure per-character damage).

**[Updated Docs]** `docs/HISTORY.md` (this entry). `CLAUDE.md` NOT yet amended —
the patch.json/Node split deserves an invariant, flagged for the next pass.

---

## 2026-08-10 (build 2) — Chisa's own kit, verified against the game's tables; off-field damage joins the ordinary lane

Two maintainer corrections, both confirmed against the raw fmodel export
(`G:/Software/fmodel/Output/Exports/Client`, `db_buff` via `tools/extract/configdb.py`).

**[Correction 1 — Chisa DOES hold Thread of Bane, permanently]**

The previous entry modelled Thread of Bane as granted ONLY by her Outro, which
meant she never held it at all (her gate opens as she leaves the field). The
game says otherwise, and says it plainly:

- Buff **`1508970005`** is the effect: `ExtraEffectID 1` (CommonSnapshotModify),
  `ExtraEffectParametersGrow1 = [1800]` — the kit's "ignore 18% of their DEF"
  verbatim — gated on a target requirement (type 9, a tag = Unseen Snare) and on
  its HOLDER carrying one tag.
- That tag is granted by **two** buffs:
  - **`1508970003`** — `DurationPolicy 1`, no duration → **PERMANENT** (Chisa's own)
  - **`1508970004`** — `DurationPolicy 2`, **15.0s** → the Outro copy for teammates

So the Outro EXTENDS a passive she already has. `DEF_IGNORE_GRANTS` gained
`selfPermanent`, and `defIgnoreForMemberAt` takes the resonator being resolved so
the owner's own grant is told apart from a teammate's borrowed one.
Chisa 278,844 → **305,221** (2.131x → 1.947x).

CONFIRMED BY NAME (2026-08-10, later the same day). `params[1] = 99` is
**`Proto_IgnoreDefRate`** — DEF ignore exactly. The attribute enum is NOT
BaseProperty's getter order (an earlier note here said so and was WRONG); the
client reads it from `EAttributeId`, which is `Aki.Protocol.Vks` in
`Core/Define/Net/Protocol.js` — 144 entries — as
`ExtraEffectSnapModifier.js` spells out for CommonSnapshotModify:

    this.TargetType = Number(i[0]);
    this.AttrId     = Number(i[1]);
    this.CalculationPolicy = Number(i[2]);

BaseProperty's getters diverge from that enum from index 13 on, because the enum
carries a `Proto_ElementEfficiency` entry BaseProperty has no getter for — which
is the whole of the "off by one" that made the earlier note look inconsistent.

RETRACTION: that note also claimed `reconcile_effects.py`'s `ATTR_TO_STAT` was
internally inconsistent. **It is not — it is correct.** Checked against the real
enum: 8 Proto_Crit, 9 Proto_CritDamage, 15 Proto_DamageChange, 22–27
DamageChangeElement1–6, 35 HealChange / 36 HealedChange all match its entries
exactly. The faulty reference was the BaseProperty-derived list used to judge it.

**[Correction 2 — Havoc Bane: modelled, but the applier never sees their own stacks]**

`HAVOC_BANE_PER_STACK = 0.02` is correct and does feed `target.defShred`. But the
count is point-sampled at SEGMENT START (team-sim.js), and Chisa is the only
Havoc Bane applier on this team: at her segment start she has applied nothing,
and by her next pass (45s later) her stacks have decayed (25s). So she reaches 3
stacks during her own segment and is credited 0 for all of it.
MEASURED at ~+2,969 for her (≈1%), so it is recorded as a quantified limitation
rather than fixed — a real fix needs per-STEP target resolution, which the
segment API does not have. NOT fixed, NOT hidden.

**[Off-field damage now runs on the ordinary damage lane]**

Maintainer direction: off-field damage "still receives the same buffs and can
induce triggers and conditions" — only the offField flag should distinguish it.
An `OffFieldAction` may now name a real `skillKey`; when it does,
`simulateOffFieldActions` (team-sim.js) runs it through `simulateRotation` with
exactly the context its owner's own segment gets — team bundles, external buff
windows, enemy statuses, carry-in fires, tune-strain amplify — instead of the
bare `computeDamage` call. The resulting steps are real steps, flagged
`offField: true`, spread across the elapsed window at their own cadence, with
zero duration, and fed to `accrueStatusDamage`.

Two things deliberately do NOT follow, both documented at the call site:
TIME (off-field occupies no slice of the shared timeline) and ENERGY/CONCERTO
(`creditTraceToLedger` is not called — the gauge already gives a benched member
a 50% share of the active member's income, so crediting these too would
double-count). A test asserts no off-field cast reaches the energy trace.

Actions with no `skillKey` (a curated multiplier with no damage row behind it —
Phrolova, Ciaccona) keep the bare path; there is nothing for the pipeline to
resolve.

**[Measured effect]** (harness, 0% RES, 3 passes, reference 6,533,757)

| step | team | gap |
| --- | --- | --- |
| start of session | 3,999,049 | 1.634x |
| + Thread of Bane (gated) + Erosion Field | 4,429,175 | 1.475x |
| + Chisa's permanent Thread of Bane | 4,457,341 | 1.466x |
| + off-field on the ordinary lane | **4,651,350** | **1.405x** |

The last step is mostly NOT the tick damage: Denia's negative-status lane went
128,677 → **205,883** and Aemeath's 838,974 → **905,886**, because the Erosion
Field now builds Fusion Burst and drives more detonations — exactly the
maintainer's stated reason for wanting the lane unified. Denia 937,815 →
1,064,912 (1.227x); Aemeath 3,214,305 → 3,281,217 (1.412x).

Session total: **1.634x → 1.405x**, i.e. 41% of the original 2,534,708 shortfall
closed by engine fixes alone (the earlier substat-quality finding is separate and
not included here).

**[Verification Method]** `npm test` 69/69, `npm run sweep` 0 failed,
`npm run lint` 0 errors, `meta-schema` 8811/0 after regeneration.
LOCK A: `wuwa-data.json` timestamp-only → reverted. LOCK B: `wuwa-meta.json`
regenerated; changes are expected (deliberate behaviour change).

**[Residual Risks]**

- Havoc Bane self-credit (above), ~1%, unfixed by design decision.
- Thread of Bane and the Havoc Bane shred are both per-SEGMENT point samples.
- The attribute-id enum question (above) is unresolved.
- Off-field steps do not generate energy/concerto. Believed correct; unverified
  against the game.
- Still single-sourced — the verification agent hit the account spend limit.
- 1.405x remains. Chisa is the outlier at 1.947x.

**[Updated Docs]** `docs/HISTORY.md` (this entry).

---

## 2026-08-10 (build 3) — Aemeath's missing +60% Crit. DMG, and the anchor-build share of the gap

Data-driven sweep (the game's own `db_buff`, decoded through the now-correct
`EAttributeId` enum) plus a text sweep, on the remaining 1.405x.

**[Method that made this possible]**

`tools/extract/configdb.py` + the `EAttributeId` enum (`Aki.Protocol.Vks`,
`Core/Define/Net/Protocol.js`) makes every buff row decodable: stat name, value
(units of 1/10000), duration, stack limit, requirements. That turns "does the
engine model this kit?" from a text-reading exercise into a diff against the
game's own table. Buff ids are `<resonatorId>` prefixed, and for these two the
sub-block encodes the source — Chisa `150895<N>xx` is chain level N, Aemeath
`12100750xx` / `12100751xx` are the two inherent nodes.

**[FOUND — Aemeath's Between the Stars pays only half. GENUINE ENGINE DEFECT.]**

Kit: "In Resonance Mode - Fusion Burst, when Resonators in the team inflict
Fusion Burst, Aemeath's **Crit. DMG increases by 30%, up to 2 times**. Each
Resonator can only trigger this effect once. **With 2 stacks**, Resonance
Liberation Heavenfall Edict: Finale DMG is **Amplified by 25%**."

`DISTINCT_APPLICATOR_TIERS[1210]` modelled the 25% amplify and NOT the Crit. DMG,
in either branch. The game states both:

    1210075116  CritDamage 3000 (30%), StackLimitCount 2   ← Fusion Burst
    1210075016  CritDamage 2000 (20%), StackLimitCount 3   ← Tune Rupture
    1210075117 / 1210075017  ExtraEffectID 37 amplify 2500 (25%), one per branch

**CORRECTED the same day — see the next entry.** The figures first recorded here
(Aemeath 3,748,290 / team 5,118,423 / 1.277x) were INFLATED: the parsed inherent
effect already applies stack ONE flat, so adding a full ladder double-counted it,
and nothing gated the tier at S3 where the chain REPLACES the inherent outright.
The honest numbers are Aemeath 3,281,217 → **3,514,753** (1.412x → **1.318x**)
and team 4,651,350 → **4,884,887** (1.405x → **1.338x**) — +233,536, half what
was claimed. Aemeath is she/her throughout; earlier prose in this file that used
"he" is wrong.

**[Chisa: her S0 buff table is FULLY accounted for — not a missing-buff problem]**

Every valued `1508*` row maps to something already handled or correctly off:
- `1508970005` IgnoreDefRate 1800 → Thread of Bane (modelled this session)
- `1508982003/4` DamageChangeElement6 + HealChange 2000/12s → the inherent (modelled)
- `150895<N>xx` → chain S1/S2/S5/S6, correctly OFF at S0. Verified against her
  chain text line by line: S1 ATK+30%/15s, S2's 10% Havoc-RES ignore and 50%
  All-Attribute (six element rows), S5's +100% Liberation, S6's two
  "takes more DMG" clauses.
- `1508800xxx` / `150897002x` → Lifethread/SpecialEnergy plumbing, not damage.
A `1508095xxx` block (Crit 35%/10s, Havoc 60%/10s, amplify 150% and 240%) matches
NOTHING in her kit text and is NOT hers despite the prefix — UNRESOLVED, flagged,
deliberately not acted on.

So Chisa's residual is per-hit damage and build quality, not unmodelled kit.

**[The anchor build is a large share of what remained — harness input, not engine]**

`templateStats` sets echo `id: null`, which costs BOTH the Echo cast AND the
echoes' own base stats. Measured with real ids (`pickEchoId`, the app's own
helper): **+216,538 team**, Chisa alone +10.8% — and only 3,070 of hers is the
cast. Added as `--real-echoes` (NOT the default: the handover pins "the app's
DEFAULT echo stats", and the reference does not record which echoes it ran).

Stacking the two honest build axes on top of the engine fixes:

| configuration | team | gap |
| --- | --- | --- |
| default (template echoes, template substats) | 5,118,423 | 1.277x |
| `--real-echoes` | 5,338,523 | 1.224x |
| real echoes + co-optimized substats (measured separately) | ~5,743,274 | ~1.138x |

At the last of these Denia OVERSHOOTS (0.91x) and Chisa is 1.14x, i.e. most of
what was left after the engine fixes is the deliberately-unoptimized anchor, not
sim error. Aemeath stays the worst in every configuration.

**[Verification Method]** `npm test` 69/69, `npm run sweep` 0 failed,
`npm run lint` 0 errors, `meta-schema` 8811/0 after regeneration. The tier ladder
is asserted directly (cap at 2 / at 3, amplify only at the cap, mode isolation,
no mode → nothing). LOCK A reverted (timestamp-only); LOCK B regenerated
(deliberate behaviour change).

**[Residual Risks]**

- The `1508095xxx` block is unidentified. It carries large amplify values
  (150%, 240%); if any of it IS S0 Chisa, she is still understated.
- Aemeath's Crit. DMG tiers assume "each Resonator triggers once" == distinct
  applicator count, which is what `distinctApplicators` already counts. A
  teammate who inflicts Fusion Burst but is never counted would under-credit.
- Everything remains SINGLE-SOURCED for the earlier findings; a Sonnet agent was
  running the same sweep in parallel but its result is not folded in here.
- 1.277x remains at the default configuration; ~1.14x on a fair build.

**[Updated Docs]** `docs/HISTORY.md` (this entry); `tools/benchmark-gap.mjs` Z1
rewritten with the measured figure and the new `--real-echoes` flag.

---

## 2026-08-10 (investigation) — A whole effect SOURCE is never parsed. Verified, quantified, NOT built.

A parallel Sonnet agent found this; every claim below was independently
re-derived here before being accepted. **This is the first finding this session
to have two sources.**

**[FINDING 1 — base-kit effects stated in a skill node are invisible. GENUINE PARSER GAP.]**

`parseEffectsFromDesc` (tools/preprocess/effects.mjs:498) has exactly TWO call
sites — `resonators.mjs:223` (inherentSkills) and `:592` (resonanceChain).
Nothing else in the pipeline reads a description for effects, and
`buffs.js unlockedEffects` confirms only those two sources ever reach it.

So a buff the game states inside a **Resonance Liberation / Resonance Skill /
Forte Circuit** node is never parsed at all.

The live case is Chisa, and it is large. Her Liberation node
(`data/extracted-nanoka/characters/1508.json` `skill_trees["3"]`, `node_type: 2`,
`param: ['15','120%','120%']`):

> "Casting this skill sends Chisa into **Woven Myriad - Convergence** for 15s …
> The DMG Multipliers of Sawring - Blitz, Chainsaw Mode - Dodge Counter, and
> Sawring - Eradication are increased by **120%**."

Her rotation casts Liberation immediately before all three Blitz stages, so it
should be live for every one of them. What proves the parser CAN read this shape
is her S2 chain node, which states the identical clause, is parsed correctly as
`multiplierUp: 1.2` with the right `skillKeys`, and says in so many words that it
**stacks with** Woven Myriad - Convergence — i.e. the two are distinct grants and
the base-kit one is simply never seen.

MEASURED (agent, real engine, in-memory patch): Chisa 305,221 → **375,856**
(1.947x → 1.581x), team → 4,721,985. **+70,635, or 24.4% of Chisa's own gap.**

CLASS SIZE, derived here: scanning all 56 characters' REAL skill nodes (excluding
the empty-type stat-tree nodes, which have their own correct `skillTreeBonuses`
path, and Inherent Skill, which IS parsed): **9 of 56** state a damage-affecting
clause in an unparsed node, of which **4 state a DMG Multiplier increase** —
Lupa (Resonance Skill), Aemeath (Forte, Tune-Rupture-gated so inert here),
Denia (Resonance Skill + Forte — the already-known Void Particle ~34k),
Chisa (Resonance Liberation, the one above).

NOT BUILT, and the reason is an invariant: effect-slot keys (`S{level}.{index}`,
`IH{node}.{index}`) are FROZEN before `effect-overrides.json` and saved builds'
`effectStacks` read them, so any pass that changes an effect COUNT must not
disturb them. Naively extending `parseEffectsFromDesc` to more nodes would
renumber nothing today (it would ADD, not reorder) ONLY if the new effects get
their OWN key namespace — e.g. `SK{node}.{index}` — leaving every existing
`IH`/`S` key untouched. That is the safe design and it is a real feature
(preprocess + `unlockedEffects` + a trigger/window model for "while in <state>"),
not a one-liner. Flagged for a decision rather than started.

**[FINDING 2 — an Intro cast's trigger fires are dropped. GENUINE ENGINE DEFECT, 0 here.]**

`sim.memberFires` is initialised at team-sim.js:218, read at :865, and written at
:873 — inside `runRotationSegment` only. `runIntroSegment` never writes it.
So a SELF-scoped effect whose trigger is "casting Intro Skill" structurally
cannot see its own trigger fire; team-wide effects escape via the separate
`teamWideWindowSpecs` timeline path. Chisa's IH1 is one such effect (its text
says "Casting Intro Skill … **or** Resonance Liberation …"; only the liberation
trigger is parsed).
MEASURED: widening the trigger changes this benchmark by **exactly 0**, because
the fires never carry. Agent's roster scan: 16 such effects across 12 characters
are self-scoped and therefore blocked in team sim (solo is unaffected — intro
sits in the member's own rotation array there). Denia and Aemeath carry none.

**[Ruled out — do not re-investigate]**

Kumokiri's passive (24% Liberation + 24% team-wide All-Attribute) resolves at
full value and reaches both teammates; Sonata 7's 5pc fires from Chisa's own
heals; Chisa's S1/S2 correctly gated off at S0; stat-tree nodes use their own
correct path.

**[Where the remaining absolute damage actually is]**

Aemeath holds ~72% of the remaining shortfall by absolute damage despite a better ratio
than Chisa, simply because he is bigger. The agent flagged, and could NOT
resolve, whether his Forte clause "each stack of Fusion Trail removed increases
the DMG Multiplier of Fusion Burst" is already inside the calibrated
`affliction-damage.json` lane (which a prior audit cleared) or is a separate
miss of the same class as Finding 1. **Highest-leverage next question.**

**[Verification Method]** Both agent claims re-derived independently here:
the two `parseEffectsFromDesc` call sites read directly; Chisa's Liberation node
text and params read from the raw nanoka source; the `memberFires` write sites
grepped. Class size computed here, not taken from the agent. No repo file was
changed by this investigation — `npm test` 69/69 unchanged from build 3.

**[Updated Docs]** `docs/HISTORY.md` (this entry).

---

## 2026-08-10 (correction) — Aemeath's Crit. DMG was double-counted; Fusion Trail verified sound

Maintainer flagged the previous entry as re-surfacing a resolved issue. They were
right, and the investigation found a SECOND double-count that predated this
session.

**[What was already correct, and what I misread]**

`effect-overrides.json` suppresses two effects out of Aemeath's IH1, and
`tools/effect-overrides.js:51` **drops suppressed effects and renumbers**
("slot keys are positional"). So the pre-suppression node had four effects
(TR critDmg, TR amplify, FB critDmg, FB amplify); the overrides removed the two
AMPLIFIES; the survivors renumbered to IH1.0 = tune_rupture critDmg 0.20 and
IH1.1 = fusion_burst critDmg 0.30. Nothing is stale and nothing is mis-indexed —
an earlier note in this file calling the override "mis-indexed" was WRONG.

Measured live, solo, no team (so the tier system is not involved):

| build | resolved Crit. DMG | reading |
| --- | --- | --- |
| S0 fusion_burst | 2.36 → **2.66** | the inherent's 0.30 IS applying, flat |
| S0 tune_rupture | 2.36 → **2.56** | likewise 0.20 |
| S3 either mode | 2.36 → **2.96** | S3's flat 0.60, and it REPLACES rather than adds |

So the pipeline already paid stack one, and S3's "Inherent Skill Between the
Stars is replaced" was already handled.

**[Two double-counts, one mine, one pre-existing]**

1. MINE: the previous entry gave the tier a full ladder from stack 1, on top of
   the pipeline's flat stack 1 → +0.90 where the kit says +0.60 (fusion_burst,
   2 applicators), and +0.80 vs +0.60 in tune_rupture.
2. PRE-EXISTING: the tier's 25% Finale amplify had no chain gate, so at S3+ it
   stacked with S3.3/S3.5's own 25% → 50%. Measured at S3: the chain grants
   amplify 0.25 and critDmg 0.60 on its own.

**[Fix]** `DISTINCT_APPLICATOR_TIERS[1210]` now supplies stacks **2..N only**
(fusion_burst: minCount 2 → 0.30; tune_rupture: minCount 2 → 0.20, minCount 3 →
0.20), and every entry carries `maxChain: 2` so the table goes silent from S3 up.
`distinctApplicatorTierContribution` gained a `chainLevel` parameter; entries
without `maxChain` (Hiyuki) are unaffected, which a test asserts.

Totals: fusion_burst 2 applicators = 0.30 (pipeline) + 0.30 (tier) = **0.60** ✓;
tune_rupture 3 = 0.20 + 0.20 + 0.20 = **0.60** ✓; S3+ = 0.60 from the chain
alone ✓.

**[Fusion Burst ← removed Fusion Trail stacks: VERIFIED CORRECT, no change]**

Kit: "Each stack of [Fusion Trail] removed from the target increases the DMG
Multiplier of [Fusion Burst] on the main target by 10%", and Seraphic Duet
"trigger[s] the [Fusion Burst] on the target based on its max stack limit".
Both halves are modelled and the numbers reconcile end to end:

- `data/affliction-damage.json` ships the exact curve — buff `1210072022`
  byStacks 1→1.1, 2→1.2, 3→1.3 … i.e. **+0.1 per stack**; `1210072023` is the
  Stardust-empowered twin at base 3.0.
- `resolveAfflictionTriggers` computes `multiplier = base × boost`, where `boost`
  is that table at the trail-stack count and `base` is Fusion Burst's own MV at
  the cap in force (`baseAtMaxStacks`).
- Measured over 3 passes: 6 Duet consumptions at trail stacks 19/23/21/24/21/24
  (cap 30, 30s lifetime), boost 4.90–5.40 = 1 + 0.1×stacks + 2.0 empowered,
  `burstCap 13` — Chisa's +3 raise on the base 10 — for 126k–139k each.

Nothing to fix here. The Erosion Field work earlier today feeds it further: more
Fusion Burst applications means more Fusion Trail stacks at consumption.

**[Verification Method]** `npm test`, `npm run sweep`, `npm run lint`, meta
regenerated. New assertions cover the stacks-2..N semantics, the S3–S6 silence,
S2 still paying, and Hiyuki's un-gated ladder.

**[Residual Risks]**

- The tier still cannot see WHICH resonator triggered which stack; it uses the
  distinct-applicator count, matching "each Resonator can only trigger once".
- The pipeline's stack-1 grant is flat and unconditional — it does not itself
  require an applicator, so a lone Aemeath with no Fusion Burst inflicted at all
  would still show +0.30. Not exercised by this benchmark; noted.

**[Updated Docs]** `docs/HISTORY.md` — this entry, plus the build-3 figures
struck through in place.

---

## 2026-08-10 (build 4) — Skill nodes become a first-class effect source. No override.

Maintainer direction: a buff's source must be acknowledged — the +120% belongs to
the Liberation CAST, not to an inherent slot — and "our model should work without
any overrides, this just creates maintenance overhead and sets up for lazy,
non-robust code." So this is wired into the pipeline, not patched.

**[Files Changed]** `tools/preprocess.mjs` (new pass), `tools/preprocess/skill-scope.mjs`
(scope the new nodes), `src/core/buffs.js` (`unlockedEffects` third loop),
`tests/skill-node-effects.test.mjs` (NEW), regenerated data + meta.

**[Why not the alternatives — each was checked, not assumed]**

- **Raw data routing?** Checked three homes, all empty. `db_buff`: no row among
  Chisa's 174 carries 12000, and `ExtraEffectID 12 (DamageModifier)` — the
  natural home — is absent from her set entirely. `damageTable`: one row per
  Blitz stage, no state-selected variant. Compiled node: preprocess drops
  `params`, leaving only prose. The game DOES ship the number as clean data
  (`skill_trees["3"].skill.param = ['15','120%','120%']`), but nothing binds it
  to a stat or a scope.
- **An `effect-overrides.json` entry?** Rejected on the maintainer's grounds, and
  it would also have filed a Liberation mechanic under `IH0` — Chisa's
  "Inescapable Fate", a cooldown reset the sim does not even model.

**[The mechanism]**

`parseEffectsFromDesc` now also runs over SKILL nodes, emitting
`resonator.skillNodeEffects` and a THIRD key namespace `SK{node}.{index}`.
Three things make it structural rather than a wider prose sweep:

1. **The NODE is the unit, never the skill key.** One node's description is
   shared by every key derived from it — Chisa's 28 keys carry 5 distinct
   descriptions, 11 sharing the Forte text — so a per-key pass would multiply one
   clause elevenfold. Keys are grouped by description; each node parses once.
2. **The TRIGGER comes from WHERE the text lives, not from the prose.** An effect
   stated in a node is granted by casting that node — a structural fact about the
   data, not a reading of English. The parser's "unconditional / always-on"
   default is right for chain and inherent nodes (both passive) and wrong here,
   so an untriggered effect is re-anchored to `castMatch` over the node's own
   keys, windowed to the duration the node states (`extractDurationSeconds`).
   Effects the parser DID find a trigger for keep it.
3. **Unscopable `multiplierUp` is DROPPED, not shipped.** `bindSkillScopes` now
   covers these nodes; 9 multiplierUp effects it could not scope were dropped and
   the count is REPORTED. Unscoped, each would multiply every hit the wielder
   throws (CLAUDE.md). `tests/multiplier-scope.test.mjs` still passes at zero.

Roster-wide the source is small and auditable: 293 distinct skill nodes yield
**55 effects across 28 resonators** (64 parsed, 9 dropped as unscopable).

**[Measured]** (harness, 0% RES, 3 passes, reference 6,533,757)

| | before | after |
| --- | --- | --- |
| Chisa | 305,221 (1.947x) | **375,856 (1.581x)** |
| Denia | 1,064,912 (1.227x) | **1,252,741 (1.043x)** |
| TEAM | 4,884,887 (1.338x) | **5,143,350 (1.270x)** |

Chisa's figure reproduces the parallel Sonnet agent's independently measured
375,856 exactly — the second cross-validated number this session. Denia gained
without being the target: her Resonance Skill and Forte nodes state multiplier
clauses of the same shape.

**[Frozen slot keys — verified, not assumed]** Diffed the regenerated dataset
against HEAD: 56/56 resonators, **0 fields lost**, one field gained
(`skillNodeEffects`), and **0 drift in any S/IH effect count**. So
`effect-overrides.json` and saved builds' `effectStacks` address exactly what
they addressed before. `SK` cannot collide with `S`/`IH` (asserted).

**[On retiring the existing overrides — assessed, and mostly NOT retirable]**

Asked to fix them where possible. Surveyed: 33 entries over 21 resonators, and
preprocess reports `27 patched, 6 suppressed, **0 added**`. The dominant kinds are
`trigger+window` (13) and `trigger` (7) — surgical corrections to WHEN a
chain/inherent effect fires, and 6 suppressions handing an effect to a curated
mechanism that models it better (`distinctApplicatorTierContribution`). This
pass fixes a missing SOURCE, not a wrong TRIGGER, so it retires none of them.
**Every entry still binds — `0 added` means none is being used as a crutch to
inject data the parser missed, which is the failure mode worth guarding.** No
stale entries found; nothing removed.

**[Verification Method]** `npm test` **70/70** (new file, 30 assertions),
`npm run sweep` 0 failed, `npm run lint` 0 errors, `meta-schema` 8811/0 after
regeneration, `multiplier-scope` 19/0. LOCK A audited structurally (above);
LOCK B regenerated — a deliberate behaviour change.

**[Residual Risks]**

- The node-duration rule takes the FIRST duration the node states. Where a node
  states several, the window may be the wrong one — but the effect is still
  gated on the cast, which is strictly better than not applying it at all.
- The 9 dropped unscoped `multiplierUp` are real buffs going unmodelled. They are
  counted and printed, so the set can only shrink; scoping them is future work.
- An effect whose clause the parser reads with a WRONG trigger keeps that wrong
  trigger (only untriggered ones are re-anchored). Conservative by design.
- 1.270x remains. Aemeath (1.318x) now holds the largest absolute share.

**[Updated Docs]** `docs/HISTORY.md` (this entry).

---

## 2026-08-10 (build 5) — Phoebe's state-labelled branches wired; the other five blocked, with reasons

Maintainer asked for all seven dropped clauses to be wired, starting with
Phoebe. Phoebe is done. The other five are NOT, and each is blocked on something
concrete found while trying — recorded rather than guessed at.

**[DONE — Phoebe ×2, and it generalises]**

Two fixes, both small:

1. `stateInClause` learned the form the kit actually uses. It read only the
   SENTENCE form (`LEADING_IN`, "In Absolution, …"); Phoebe's Liberation writes a
   bulleted, state-LABELLED menu instead:
       - [Absolution] Enhancement: Increase DMG Multiplier by 255%.
       - [Confession] Enhancement: Apply 8 of [Spectro Frazzle] to targets hit.
   `LEADING_BRACKET` reads that, and binds ONLY on an EXACT match against a state
   the resonator declares — brackets are also the kit's markup for SKILL names,
   so a bracketed skill can never light a state that does not exist.
2. A state-gated skill-node multiplier with NO named skill now scopes to the node
   it is written in. "Enhancement" has an elided subject and the node supplies
   it; the state gate is what makes that safe, since a clause meaning some other
   skill would have to name it, and a named subject binds earlier via
   bindSkillScopes.

Both her +255% now carry `inState: absolution` and scope to their own key
(`liberation`, `outro_attentive_heart`). Dropped set 9 → **7**.
Nothing else in the roster changed shape: 55 → 57 effects kept.

**[NOT DONE — and why, per clause]**

- **Denia, Dark Core +150%/core.** Cap and spender are both stated ("Denia can
  hold up to 3 [Dark Cores]", "[Banish - Breakdown Form Stage 2] consumes all
  [Dark Cores]"), but **no kit sentence states how a Dark Core is GAINED**.
  `RESOURCE_DEFS.gains` is `{skillKey: n}` and cannot be filled by guessing.
  BLOCKED on finding the grant (likely the ability blueprints, as with status
  appliers).
- **Camellya, Crimson Bud +5%/bud (cap 50%).** Buds are gained by CONSUMING 10
  Crimson Pistils (cap 100) — a resource fed by another resource. The flat
  `gains: {skillKey: n}` shape has no way to express that. BLOCKED on a model
  change, not a curated row.
- **Danjin +20%.** Not a multiplierUp at all: the game files it as buff
  `1602201011` `DamageChange` (attr 15), the ADDITIVE dmgBonus bucket. Wants a
  buff-facts rebucket of a skill-node effect — a path `applyBuffFacts` does not
  currently walk.
- **Mornye.** Parses as +0% because "0.25% per 1% Energy Regen over 100%, up to
  40%" states no fixed number. The game ships DISCRETE tiers instead
  (`1209400003-008`, per element), so it wants a tier table keyed on an ER
  breakpoint — which the maintainer has flagged as pending work in its own right.
- **Lupa +50% "to [marked] targets".** Maintainer ruling is that a mark is always
  assumed satisfied, which makes this a GLOBAL multiplier on her whole kit. That
  is exactly the shape `tests/multiplier-scope.test.mjs` guard 1 exists to catch,
  and unlike every other clause here it has NO attribute row in `db_buff` to
  confirm the bucket. Deliberately left for an explicit decision rather than
  shipped on inference.

**[The dropped-clause contract]** `tests/skill-node-effects.test.mjs` now pins the
set per resonator WITH its reason, re-derived from source (not read from the
shipped dataset, where they are already gone) so a NEW one fails the build. The
probe replicates the pipeline including the state-scope step, so it cannot drift
into a second, disagreeing model.

**[Measured]** Chisa 375,856 (1.581x), Denia 1,252,741 (1.043x), Aemeath
3,514,753 (1.318x), TEAM **5,143,350 (1.270x)** — unchanged by this build, as
expected: none of the seven touches the benchmark team's damage. Phoebe's fix is
worth nothing here and everything on a Phoebe team.

**[Verification Method]** `npm test` **70/70**, `npm run sweep` 0 failed,
`npm run lint` 0 errors, `meta-schema` 8811/0, `multiplier-scope` 19/0.
NOTE: `data/wuwa-data.json` must NOT be reverted after a run any more — it now
carries `skillNodeEffects`, so the old "revert if only generatedAt changed" habit
destroys the build. Caught and corrected during this session.

**[Residual Risks]**

- Five clauses remain silent, each counted and reasoned above.
- The state-scope rule assumes an elided subject means the node. Safe while
  gated on a state; it is deliberately NOT applied to ungated clauses, which is
  what keeps Aemeath's two (already paid by the affliction lane) dropped.

**[Updated Docs]** `docs/HISTORY.md` (this entry).

---

## 2026-08-10 (investigation) — The ability blueprints: where the resource grants actually live

Maintainer asked for a thorough blueprint search to unblock the five remaining
dropped clauses. Result: **the grant IS in the export and IS reachable, but not
from anything we currently parse.** One bounded piece of tooling stands between
here and it. Nothing was guessed at or shipped on inference.

**[Finding 1 — the blueprints exist, under INTERNAL codenames]**

`Content/Aki/Character/Role/<Body>/<Codename>/Abilities/GA/*.uasset`. Codename is
NOT the English name; map it from `data/bindata/roleinfo.json` `RoleBody` plus the
character's pinyin:

    Denia    1211 → FemaleMS/Daniya   (6 GA assets, 9 DataTables)
    Camellya 1603 → FemaleM/Chun      (9 DataTables)
    Lupa     1207 → FemaleM/Lupa      (6 GA assets, 10 DataTables)

**[Finding 2 — the GA blueprints are a DEAD END for this]**

They are compiled Blueprint K2 bytecode. `tools/extract/ue_asset.py` reads their
name tables fine (`AddBuffFromGA`, `AbilityTask_PlayMontageAndWait`, …) but no
buff ids: the graph is bytecode, not tagged properties. A raw int32 literal scan
over every `.uexp` in Lupa's GA folder for her own buff-id range returned exactly
one value (1207959552) and it is coincidental bytes, not a buff.

**[Finding 3 — db_PassiveSkill IS a real cast→buff link table, and it does NOT
have these]**

`db_PassiveSkill` (2083 rows) carries `TriggerType` + `SkillAction: AddBuff` +
`SkillActionParams: [buffId, …]`. It genuinely works — 20 rows grant the
Fusion Burst system buff `10021000`, and Denia's own `1211703011-016`
(`DamageTrigger → AddBuff 10021000`) are among them. But a roster-wide search for
the Dark Core buffs (`1211300001/2/11/12`, `1211700105`) and the Crimson Bud
buffs returned **ZERO rows, at any id prefix**. So these particular grants are
simply not in that table.

**[Finding 4 — THE ANSWER: they are in the per-character `DT_SkillInfo` DataTable]**

A byte scan over every `DT_*.uexp` under each character's folder finds the Dark
Core buff ids as real int32 literals:

    Daniya/Data/DT_SkillInfo.uexp               → 1211300011
    Daniya/…/DT_SkillInfo_Child_photos.uexp     → 1211300011
    Daniya/…/DT_SkillInfo_Rouge.uexp            → 1211300012

`DT_SkillInfo` is a DataTable of `SSkillInfo` rows whose name table references
each `GA_*` ability and each `AM_*` montage by path — i.e. it is exactly the
skill → ability → buff join we need, and it is a DataTable rather than bytecode,
so it is parseable in principle.

**[What blocks it — bounded, not open-ended]**

`ue_asset.py` `read_export` returns 40 bytes for this asset: it reads an export's
own TAGGED properties, and a DataTable's ROWS live in the tail after them
(row-name FName + struct per row, terminated by a null name). Reading it needs a
DataTable row loop on top of the existing `TaggedReader.read_struct` — a
contained addition to `tools/extract/`, not a new discipline. That is the single
prerequisite for Denia's Dark Core gains, and very likely Camellya's Crimson
Pistil → Bud chain too.

**[Status of the five, updated]**

| clause | blocked on |
| --- | --- |
| Denia Dark Core +150%/core | the DataTable row reader above |
| Camellya Crimson Bud +5%/bud | same, PLUS a nested-resource shape (Buds are bought with 10 Pistils; `gains: {skillKey: n}` cannot express a resource fed by a resource) |
| Danjin +20% | NOT a blueprint problem: the game files it as `DamageChange` (attr 15, buff `1602201011`), so it needs a buff-facts rebucket on the skill-node path |
| Mornye | NOT a blueprint problem: game ships DISCRETE tiers (`1209400003-008`); wants the pending ER-breakpoint table |
| Lupa +50% | NOT a blueprint problem: needs a maintainer ruling on the bucket. No attribute row exists in `db_buff` for it, so nothing in the data settles global-multiplierUp vs dmgBonus |

So three of the five were never blocked on blueprints at all, and the two that
were now have a named, bounded prerequisite instead of an unknown.

**[Verification Method]** Every claim above is a direct query recorded in this
entry: folder listings, `ue_asset.Asset` name-table reads, an int32 literal scan
over each character's `.uexp` set, and a roster-wide `db_PassiveSkill` scan with
a positive control (20 fusion_burst grants) to prove the search would have found
a hit had one existed. No repo file changed; `npm test` 70/70 unchanged.

**[Updated Docs]** `docs/HISTORY.md` (this entry).

---

## 2026-08-12 — Gauge income is readable after all: the cast lane, extracted

**[Files Changed]** `tools/extract/extract_gauge_income.py` (new),
`data/gauge-income.json` (new, generated), `tests/gauge-income.test.mjs` (new),
`tests/skill-node-effects.test.mjs` (dropped-clause reasons for Denia and
Camellya rewritten), `CLAUDE.md` (one invariant superseded, one added).

**[Correction to the previous entry]** The stated blocker was wrong. The
DataTable row reader **already exists** — `ue_tagged.parse_datatable`, with row-map
probing, exact-landing validation and name-map skew repair, used by
`extract_timings.py` and `scan_bullet_timings.py` since July. The previous
entry reached for `ue_asset.Asset.read_export(0)`, which by design reads only an
export's tagged properties and therefore returned 40 bytes. Nothing needed
building at that layer; what was missing was the extractor on top of it.

**[Logic Altered]** None in `src/`. This turn is extraction + data + docs.

`extract_gauge_income.py` joins three of the game's own tables and parses no
prose:

    DT_SkillInfo row  →  SkillBuff / SkillStartBuff / SkillEndBuff
                      →  db_buff.GameAttributeID ∈ Proto_(Special)Energy*
                      →  ModifierMagnitude × CalculationPolicy

Resonator identity comes from the row id's own 4-digit prefix, never a folder
name (the `extract_timings.py` rule). 66 of 73 combat tables parse; the 7
failures are 5 `TestModel` placeholders and 2 story-mode variants.

Magnitude semantics are **read from the client**, not guessed —
`ActiveBuff.ModifyStateAttribute` switches on `CalculationPolicy[0]`:
**0** flat add · **1** scale base (`-10000` ⇒ zeroed) · **2/4/9** fraction of the
attribute named in `policy[1]` · **3** override (`0` ⇒ zeroed) · **5/6**
per-duration. `classify()` normalises only those shapes and answers `unknown`
(1 of 386) rather than guess; raw policy+magnitude always travel alongside.

**[What this retires]** `rotation-rules.js` carried: *"The game states a gauge's
cap in baseproperty.json but grants these named stack gauges through its Buff
table, which is not among the four BinData dumps … Income becomes extractable if
that table is ever dumped."* It is dumped. 50 resonators carry cast-lane gauge
moves, against the 2 hand-curated `RESOURCE_DEFS` entries that exist today.

The boundary is real and is now stated precisely: this reads the **cast** lane.
Income earned **on a hit** lives in `db_PassiveSkill` (`DamageTrigger`, own CD)
behind ExtraEffect chains — extracted into a separate `trigger` section but
deliberately NOT wired, because `rotation-resources.js` is per-cast by
construction. That lane is why Changli's Enflamement and Camellya's Crimson Bud
show nothing under `cast`, and the test asserts Changli's emptiness so a future
widening cannot quietly invent income for her.

**[The Denia finding — and why her clause stays dropped]**

Her three gauges reproduce her kit to the digit, with no text parsing:

| kit text | extracted |
| --- | --- |
| "hold up to 3 [Dark Cores]" · "obtains 1 upon casting Intro Skill" | ch2 cap 3; rows `1211061`/`1211062` (both QTE) → **+1** |
| "up to 100 [Void Particle]" · "…or Resonance Skill [Phantom Bubble] grants 25" | ch1 cap 100; `1211041`/`1211061`/`1211062` → **+25** |
| "up to 100 [Conformal Charge]" · "[Banish - Breakdown Form Stage 2] grants 40" | ch3 cap 100; `1211048` → **+40** |

So the old reason for dropping her `+150% per Dark Core` clause — *"NO kit
sentence states how a Dark Core is GAINED"* — was **false twice over**: the kit
says it, and so does the game.

The clause still must not ship, for a much better reason: **the game already
ships this ladder as damage rows, so a `multiplierUp` on top would double-count.**
Her display row for [Banish - Breakdown Form Stage 2] is `56.34%`, and
`damageTable['1211']` holds

    12111052110  1.4085   = 2.5 × 0.5634
    12111052120  2.2536   = 4.0 ×
    12111052130  3.0987   = 5.5 ×
    12111052140  3.9438   = 7.0 ×
    12111052150  4.7889   = 8.5 ×

— exactly `base × (1 + 1.5N)` for N = 1..5 Dark Cores, five variants because S3
states *"Denia now holds up to 5 Dark Cores."* Every value is an exact multiple;
the `…2`-suffixed siblings are a parallel ladder at 1.4× throughout.

A second, larger gap surfaced with it: the key's own `damageId` `12110002005` is
**absent** from `damageTable`, so `resolveSkill` returns null and **Banish Stage
2 deals ZERO damage today** — none of the five variant rows is mapped to any
skill key. The clause therefore looked merely unscopable when the real defect is
unmapped rows. The fix is to select the variant by gauge level, which is now
fully specified by the data but is a new engine capability (a damage row chosen
at sim time) and is NOT attempted here.

**[Status of the five, updated again]**

| clause | state |
| --- | --- |
| Denia Dark Core +150%/core | gauge now fully readable (cap + income + the S3 cap raise). Remaining work is variant selection in `resolveSkill`, not an effect — shipping the clause as a buff would double-count |
| Camellya Crimson Bud +5%/bud | still blocked, now with evidence: no cast-lane income at all, and her one `db_PassiveSkill` gauge row (`1603906015`) has magnitude 0. Unreadable from either extractable lane, on top of the nested-resource shape |
| Danjin +20% | unchanged — buff-facts rebucket to `dmgBonus` (attr 15, buff `1602201011`) |
| Mornye | unchanged, with a new pointer: `1209400000` is an `AttributeChangedTrigger` described as *"Resonance Efficiency converted to attribute #66"* (SpecialEnergy3) — the data behind her ER breakpoint |
| Lupa +50% | unchanged — needs a maintainer ruling on the bucket |

**[Verification Method]** `npm test` **71/71** (new `gauge-income.test.mjs`
included); `npm run sweep` 67 imported / 0 failed; `npm run lint` **0 errors**.
LOCK A and LOCK B both re-run and compared field-by-field against a pre-run
snapshot: `generatedAt` is the ONLY differing top-level key in either file, so
the change is dataset- and meta-neutral as intended. The extraction itself is
validated by three mutually independent sources agreeing — the cap channel comes
from `baseproperty.json`, the amounts from `db_buff`, and the English from the
kit — plus the Sigrika control, whose curated `cap: 100` predates all of this and
matches both `SpecialEnergy2Max` and the −100 her spender removes.

**[Residual Risks]** The `trigger` lane's readings are COARSE and must not be
wired as-is: Denia's 12s Entropy Shift tick reads as "+100% of max" because the
real grant sits behind ExtraEffect gates two buffs deeper. It is labelled and
unused, and `rotation-resources.js` documents the same boundary. Separately,
Banish Stage 2 dealing zero is a pre-existing defect this entry documents but
does not fix; it means Denia is understated by however much that cast is worth.

**[Updated Docs]** `CLAUDE.md` — the "Gauge income … stays curated" clause is
struck and replaced with "Gauge income is readable ON A CAST, and only there"
(including the CalculationPolicy decode and the flat-`add`-of-`-cap` spend
shape); a new invariant "A per-resource DMG-Multiplier clause may ALREADY be in
the damage table" records the Denia ladder. `docs/HISTORY.md` (this entry).

---

## 2026-08-12 — Denia's Dark Core: a multiplier that scopes itself

**[Files Changed]** `src/core/rotation-resources.js` (consumption series +
carried start levels), `src/core/buffs.js` (`scaleEffect` consumption branch),
`src/core/sim.js` (`carryInResources` in, `resourceEndLevels` out),
`src/core/team-sim.js` (`sim.memberResources`, threaded Intro → rotation → next
pass), `src/core/rotation-rules.js` (`RESOURCE_DEFS[1211]`, header note),
`tools/preprocess/effects.mjs` (`PER_RESOURCE_CONSUMED_RE`),
`tools/preprocess.mjs` (`thisCast` window + drop-guard exemption),
`tests/rotation-resources.test.mjs`, `tests/skill-node-effects.test.mjs`,
`CLAUDE.md`.

**[Correction to the previous entry]** It claimed Banish Stage 2 "deals ZERO"
because `damageId 12110002005` was "absent from `damageTable`". Wrong — that came
from a probe that indexed `dataset.damageTable[id]` (an object keyed by
RESONATOR id) instead of searching `damageTable['1211']`. All 27 of her keys
resolve. The row is present at **0.5634**, which is exactly her 56.34% display
row, and the cast was dealing damage all along — just unscaled by Dark Cores.
The five variant rows are therefore not a missing-damage bug but an ANSWER KEY.

**[Logic Altered]**

The clause is *"For each [Dark Core] consumed, the DMG Multiplier of the attack
is increased by 150%."* It names no skill, so it cannot be scoped by binding a
name — and it does not need to be. **Read the count as what the step CONSUMES,
and the effect scopes itself**: it is 0 on every cast that spends nothing.

    computeResourceConsumption(rotation, defs)   — the spend series, from the
                                                   same walk as the levels
    stackTrigger { type:'resource', consumed:true }
    window       'thisCast'

`persist` was tried first and is wrong in both directions: its castMatch check
reads strictly EARLIER steps, so the effect was dark on the very cast it is for
(the unit test caught this) and would then have been live on every step after.
`thisCast` had been curated-only; the parser now emits it for this one shape,
which is what let the whole thing work with **no override** — the standing
requirement for this lane.

Safety rests on two properties, both now invariants: `resourceConsumedAt`
returns **0, never null**, so an uncurated gauge understates rather than paying
on every cast; and only the CONSUMED wording is matched, because a clause
scaling on the gauge merely HELD would still need a real scope.

`RESOURCE_DEFS[1211]` is filled from `data/gauge-income.json` — cap 3
(SpecialEnergy2Max) and +1 per Intro cast are the game's own numbers; only the
spender is still the kit's, since no `DT_SkillInfo` row spends SpecialEnergy2.

**[The cross-segment gap, found by measuring]**

With all of the above the solo sim was exact and the TEAM sim moved by
**nothing at all** — byte-identical totals with the gauge disabled. Cause: a
turn is several `simulateRotation` calls (the auto-injected Intro is its own
segment), and each computed its gauge from its own rotation array. Denia earns
the core on Intro and spends it in the next segment, so the spending cast read
an empty gauge. Fixed the way the trigger ledger already was: `carryInResources`
in, `resourceEndLevels` out, threaded through `sim.memberResources` — Intro →
rotation → next pass. (The sibling gap remains: `runIntroSegment` still does not
write `sim.memberFires`.)

**[Verification Method]** `npm test` **71/71**, `npm run sweep` 67/0 failed,
`npm run lint` **0 errors**.

The model is checked against the GAME rather than against arithmetic this repo
repeats: `tests/rotation-resources.test.mjs` asserts the five variant rows are
`base × (1 + 1.5N)` for N = 1..5 **at every one of the 20 levels**, that the
reference rotation consumes on exactly one step, that **no other step is
multiplied**, and that the sim's one-core multiplier reproduces row
`12111052110` exactly. Solo A/B on her reference rotation: Banish Stage 2
**463 → 1,157 = exactly 2.5×**, the game's own one-core ratio.

Benchmark (`tools/benchmark-gap.mjs`, Run A): Denia **1,127,467 → 1,183,614**,
gap 1.159x → **1.104x**; team 1.411x → 1.395x. Chisa and Aemeath are unchanged
to the digit, which is the evidence of no collateral effect. With
`--real-echoes`: Denia **1,368,904 (0.954x)**, team **1.332x**.

**[Residual Risks]** Denia now slightly OVERSHOOTS her reference under
`--real-echoes` (0.954x); the multiplier itself is pinned to the game's own row,
so if that is real it lies in another of her lanes, not here. The chain-gated cap
raise is NOT modelled — S3 states "Denia now holds up to 5 Dark Cores" (hence
five variant rows) but a cap is per-resonator, not per-chain, so an S3+ build is
held to 3; no reference rotation casts enough Intros to reach even 3, so nothing
today is affected. Off-field and outro segments deliberately do not carry the
gauge. Also unreconciled: pre-compaction notes record a 5,143,350 / 1.270x team
baseline, while today's is 4,629,015 before this change. An A/B with the gauge
disabled reproduces 4,629,015 exactly, so the shift PREDATES this work; the
likely cause is Aemeath's Crit-DMG double-count correction reaching the
regenerated dataset (she moves 3,514,753 → 3,162,652, and Chisa still matches at
373,548 vs 375,856 under the same flags). Not chased further — it is a separate
thread and the direction is a fix, not a regression.

**[Updated Docs]** `CLAUDE.md` — the previous entry's damage-table invariant is
replaced with a corrected one (the row is present; the variants are the answer
key), plus two new invariants: "A 'for each [X] CONSUMED' multiplier scopes
ITSELF" and "A gauge belongs to the CHARACTER, not to a segment".
`docs/HISTORY.md` (this entry). `tests/skill-node-effects.test.mjs` — Denia
removed from the dropped-clause contract, which is now **6**, with her reason
rewritten as a wired-not-dropped note.

---

## 2026-08-12 — Doc hygiene: the game's own vocabulary, and a roster index

**[Files Changed]** `docs/GLOSSARY.md` (new "Game-data vocabulary" section +
9 new project terms), `docs/RESONATOR-ROSTER.md` (new), `README.md` (docs index,
stale test counts), `tools/extract-forte.mjs` (stale comment).

**[Logic Altered]** None — documentation only. No `src/` file changed, so
`engineHash` is untouched and no regeneration was needed.

**[What was added]**

`docs/GLOSSARY.md` gained a **Game-data vocabulary** table: the names the
shipped client uses, which are not guessable from the English UI.
**Phantom = Echo** (`db_phantom.db`, `db_PhantomBattle.db`,
`ExhibitPhantom.js`; there is no `db_echo` anywhere in the ConfigDB) and
**QTE = Intro Skill** (`DT_SkillInfo` rows are named `…QTE入场`) are the two
that cost the most time this session. Alongside them: `SpecialEnergy{N}`,
`GameAttributeID`, `CalculationPolicy`, `ExtraEffect*`, `DT_SkillInfo`,
`db_PassiveSkill`, ConfigDB, name-map skew, the bullet chain, and what the
`_GD` / `_FP` / `_Rogue` folder suffixes mean.

Nine project terms were added to the existing tables: the **three effect
sources** (`S` / `IH` / `SK`) as one entry, `thisCast`, **consumption-scoped
effect**, `stacksUnknown`, **resource/gauge**, **cast lane / trigger lane**,
`gameTime`/`realTime`, **marginal (per-pass)**, and **cross-segment carry**.

`docs/RESONATOR-ROSTER.md` is a new roster INDEX: all 56 shipped resonators with
id, English name, internal codename, curation status and the signals behind it.

**[How the codename column was derived]** Not by reading folder names — by
parsing every Role `DT_SkillInfo` and keying each table by the resonator id
owning most of its rows, the same identity rule `extract_timings.py` documents.
60 ids mapped; every one of the 56 dataset resonators resolved.

**[Findings that fell out of building it]**

- **Rover: Electro (1309) has no reference rotation** — the only shipped
  resonator without one. Every harness and the offline optimizer fall back.
- Four ids parse with no dataset entry (`1310`, `1408`, `1502`, `1605`): the
  opposite-gender Rover builds. The id the dataset keeps is NOT consistently one
  gender — Electro/Aero/Spectro sit on the male id, Havoc on the female. That is
  an ID assignment, not an asset choice; timing extraction stays pinned to the
  female assets (`MALE_ROVER` in `map-timings.mjs`).
- Curation tally: Curated 15 · Curated·gaps 12 · Light 16 · Extracted 12 ·
  Unrotated 1. Phoebe is the most-overridden resonator (6).

**[Stale claims corrected]** `tools/extract-forte.mjs` said income for a
non-Forte gauge "stays curated until that table is dumped too" — the table is
dumped. Rewritten to say what is still true: Changli specifically stays curated
because her Enflamement is earned ON HIT, which is outside the per-cast model.
`README.md` claimed 55 and 68 test files in two places; both are 71.

**[Verification Method]** `npm test` **71/71**, `npm run sweep` 67/0 failed.
The roster table's derived columns were generated, not typed. The Phantom=Echo
claim is verified by absence as well as presence (no `db_echo` exists).

**[Residual Risks]** `RESONATOR-ROSTER.md` is generated-by-hand-invocation, not
by a pipeline step, so it can drift as curation changes — the doc says how to
regenerate each column. The curation status is a coverage signal, NOT a quality
score: "Extracted" often just means the kit is simple enough that the automatic
pipeline handles it.

**[Updated Docs]** This entry; `docs/GLOSSARY.md`; `docs/RESONATOR-ROSTER.md`
(new, cross-referenced from `README.md` and from the GLOSSARY codename row, and
pointing at `COMBO-ENTRY-CURATION.md` / `OPEN-ITEMS.md` for what it does not own).

---

## 2026-08-13 — The DPS gap: the harness was measuring the wrong enemy

Picks up `HANDOVER-dps-gap-analysis.md`. Its §1/§2 tables reproduce digit-for-
digit, and were confirmed independently by a second agent. Three of its
conclusions do not survive, and the headline moves the OPPOSITE way from what it
predicted.

**[Files Changed]** `tools/benchmark-gap.mjs` (only — no engine, no dataset).

**[Logic Altered]**

- **D7 RULING — the target was wrong, and both of the codebase's answers were.**
  `TARGET_REFERENCE` (level 100, 20% RES) is now the default. Settled against
  ANCHOR 1, the cleanest probe available because `computeTuneBreakDamage` takes
  no ATK, no crit and no gear stat:

      lv90,  10% res, + this team's DEF shred/ignore   81,727   1.304x
      lv100, 20% res, + this team's DEF shred/ignore   71,015   1.133x
      lv100, 20% res, UNBUFFED                         62,689   1.000x  (-0.001%)
                                           reference   62,689

  `--app-target` / `--zero-res` keep both old readings runnable.

- **ANCHOR 1 is now COMPUTED.** It had been printing a hardcoded sensitivity
  string ("at 0% RES it reads 80,428, at 10% 72,385, at 20% 64,343") derived
  from a bare-target probe, against a measured value that carries the team's own
  DEF reduction — a different code path. The measured 81,727 matched none of the
  three literals and nobody noticed. The handover's entire D7 argument ("the
  reference sits just past 20% RES") was read off that stale table.

- **A second fact falls out of the exact ANCHOR 1 hit:** the reference does NOT
  apply the team's DEF reduction to the tune bar and the sim DOES — Chisa's
  Thread of Bane 18% + 3 Havoc Bane stacks 6%, folded in at team-sim.js:846-847.
  That is now the whole of ANCHOR 1's residual, and it is an ATTRIBUTION
  question, not a target-assumption one. Left open deliberately.

- **D6 / Z1 RULING — both sides now buy the same gear.** The benchmark no longer
  spends the recommender's 25-roll template package. It spends the reference's
  OWN stated budget (`SUB_*` / `referenceSubstats`): three echoes at 8.1% Crit
  Rate / 16.2% Crit DMG / 8.6% scaling / 8.6% damage bonus, two at 8.1% / 16.2%.
  Sixteen substats, not 25 — the remaining nine are left EMPTY rather than
  invented. Mains are "best applicable" for all three (no Healing Bonus 4-cost
  for the healer-tagged member) and real echo ids are the default. Old
  behaviour survives as `--role-mains` / `--null-echoes` / `--template-substats`.

- **`--profile` added,** printing each member's damage share by DMG-bonus bucket.
  It is the derivation behind `RELEVANT_DMG_BONUS` rather than a hand-picked
  constant. All three members land on Liberation — and NOT because all three are
  Liberation spammers: Chisa's Death Snip and all three Sawring - Blitz stages
  carry `formulaType: liberation`, as do Aemeath's charged Heavies. Reading the
  CAST type would have put two of three in the wrong bucket. The CLAUDE.md
  invariant "DMG bonus matches FORMULA type", restated as a measurement.

**[Measured]** New baseline, on the reference's own conditions:

    member     sim damage   reference     gap      status lane   game s   ref s
    Chisa         412,293      594,209   1.441x              0    14.19   22.80
    Denia       1,144,150    1,306,453   1.142x        190,561    33.00   19.05
    Aemeath     2,807,154    4,633,096   1.650x        694,043    32.52   36.99
    TEAM        4,363,597    6,533,757   1.497x                   79.71   78.84
    TEAM DPS       54,746       82,874   1.514x

The time denominator is now **0.989x** (79.71s vs 78.84s) — near-exact, which
retires the timing lane for good. The substat swap is worth only 0.6%
(1.497x vs 1.488x under `--template-substats`), so the gear model was never the
source of the gap.

**[Two corrections to the record]**

1. **The "unverified 352k Aemeath shift" is not an engine shift.** The prior
   entry in this file (Residual Risks, Denia's Dark Core) attributes a
   5,143,350 -> 4,629,015 team move to "Aemeath's Crit-DMG double-count
   correction reaching the regenerated dataset" and records her at
   3,514,753 -> 3,162,652. Both figures are reproducible TODAY as harness
   FLAGS: `--zero-res` gives 3,514,753 and `--real-echoes` gives 3,162,652, on
   the current dataset. The clincher is `5,143,350 x 0.9 = 4,629,015.00` exactly
   — the 10% resistance factor — with the remaining +62,385 being Denia's Dark
   Core to the unit. The two measurements were taken under DIFFERENT flags. The
   near-match that hid it ("Chisa still matches at 373,548 vs 375,856 under the
   same flags") is a coincidence: she loses 10% to resistance and gains ~10.4%
   from echo base stats. No Crit-DMG leak, no S6-onto-S0 bug, no dataset change.
   The handover called this "the single best-defined open number in the
   project"; it is closed, as a refutation.

2. **Z2 ("nine outro segments deal zero damage") was never a defect.** The claim
   as written is true — none of 1508/1211/1210 has an `outro` key — but the
   conclusion drawn from it was wrong. All three Outro Skills are buff-only in
   the GAME's own text: Chisa's "Unraveling - Law Zero" raises negative-status
   max stacks, Denia's "Unfinished Lies" and Aemeath's "Silent Protection" hand
   mode-gated amplification to the incoming resonator. None contains a damage
   clause, so `OUTRO_DMG_RE` correctly matches nothing and `effectiveSkillMap`
   filters nothing. Roster-wide: 13/56 have an outro damage key, 2 more model it
   as an off-field turret, and the remaining 41 are buff/heal transfers — which
   is ordinary WuWa outro design, not a broad extraction failure.

**[Verification Method]** `npm test` **71/71**, `npm run sweep` 67 imported /
0 failed, `npm run lint` **0 errors** (3083 style-only warnings, S3/S4 ratchet).
LOCK A and LOCK B verified CLEAN — the three dirty data files were confirmed
`generatedAt`-only (every changed line contains it, one line per file) and
reverted. Both §1/§2 tables reproduced before any edit. ANCHOR 1's exact hit is
independently reproducible from the formula constants alone.

**[Residual Risks]**

- The `RELEVANT_DMG_BONUS` pick reads "the relevant damage bonus" as a
  skill-type substat because those are the only damage-bonus ROLLS the game has
  (element DMG bonus is main-stat-only). If the reference meant something else
  by the phrase, that is 25.8% in the wrong bucket for all three. The bucket
  shares are lopsided enough (72.8-89.5%) that the PICK is not in doubt; the
  READING of the phrase is the assumption.
- The tune-bar DEF-attribution question above is open and unmodelled either way.
- The reference's enemy is stated as a level 100 boss at 20% RES; `enemyType`
  stays `overlord` (the engine default) because the reference does not name a
  type and `overlord`/`calamity` share a multiplier of 14 anyway.
- Denia OVERSHOT under the previous configuration (0.954x with `--real-echoes`,
  0.859x composed). On the settled baseline she is back to 1.142x, so the
  overshoot was a configuration artefact rather than a live inflation — but it
  was real under the numbers the handover quoted, and an overshoot is the
  failure mode that looks like nothing is wrong.
- **The gap got WIDER, not narrower.** The handover's §2 argued the residual
  engine-side gap was "on the order of 1.15-1.20x". It reached that by composing
  toward a 0% RES target, which is the one axis its own §3 said the evidence
  contradicted. On the reference's real conditions it is **1.497x**. Steps 3-4
  of that document (Chisa's rotation; Aemeath's 79.5% share) are now to be
  re-read against this baseline — Aemeath is still the largest miss
  (1,825,942 of 2,170,160) and her share has RISEN to 84.1%.

**[Updated Docs]** This entry; `tools/benchmark-gap.mjs` header (D6/D7/Z1
rulings written next to the preserved originals, Z2 withdrawn with its original
text kept, usage block extended); `docs/HANDOVER-dps-gap-analysis.md` corrected
in place.

---

## 2026-08-13 — Outro damage: the game writes it two ways, we read one

Follow-up to the harness re-baseline earlier today. Withdrawing Z2 (the three
benchmark outros are buff-only and correctly deal nothing) meant sweeping all 56
outro descriptions for damage-shaped clauses the extractor might be dropping.
Two were.

**[Files Changed]** `tools/preprocess/resonators.mjs`, `tests/outro.test.mjs`,
`data/wuwa-data.json`, `data/data-version.json`, `data/wuwa-meta.json`.

**[Logic Altered]** `OUTRO_DMG_RE` reads one sentence shape — "deals <Element>
DMG equal to X% of <name>'s ATK". The game also writes outro damage with the
multiplier FIRST and no scaling-stat tail at all:

    Lynae (1509)  "Attack the target and deal {0} Spectro DMG."
    Iuno  (1410)  "Attack the target to deal {0} Aero DMG."

Both state real damage (param[0] = "100%"), both ship `damage: {}` and an empty
`level` map, and both were dropped silently — no warning, no diff. Added
`OUTRO_DMG_INLINE_RE`, tried only when the primary fails, with the two shapes
normalised into `multRaw` / `elementWord` / `scalingWord` because they order
their capture groups differently. With no stated scaling stat and no damage
entries, `relatedPropId` takes the ATK default the other branches already use.

The inline pattern is deliberately anchored on "Attack the target", the stock
phrasing for the Outro's OWN hit, rather than matching "deal {n} <Element> DMG"
anywhere in the node. An Outro description also describes what the INCOMING
resonator will do, and a loose pattern would credit the wielder with that.
Missing a multiplier understates; inventing one INFLATES, and inflation is the
failure mode that looks like nothing is wrong.

**[Verification Method]** Validated roster-wide BEFORE editing: the new pattern
matches exactly 1509 and 1410, overlaps the primary pattern on nobody (both = 0),
and the only damage-shaped outro clause left unmatched is Suisui's "deals {3}
more DMG" — an amplification clause, correctly excluded.

`npm test` **71/71** (outro.test.mjs 39/0), `npm run sweep` 67 imported /
0 failed, `npm run lint` **0 errors**.

LOCK A — a real, bounded diff, as expected: `generatedAt`, the `damageTable`
count 4098 -> 4100, the two new rows and their own `skillNodeEffects` entries.
No effect-slot key (`S{n}.{i}` / `IH{n}.{i}`) moved. Both rows verified correct:
mult 1.0 flat across the 20-level band (an Outro has no level curve), element 5
Spectro / 4 Aero, relatedProp 7 ATK.

LOCK B — 70 team-damage nodes moved, and EVERY one is accounted for: 68 are
same-team deltas of exactly +5,753 (a Lynae outro) or +3,731 (an Iuno one), and
5 are rank reshuffles where such a team's gain changed its score and displaced a
neighbour whose own damage is unchanged. `engineHash` is unchanged, correctly —
no ENGINE_FILES member was touched. Verified structurally by diffing HEAD's meta
against the new one team-by-team rather than by reading the line diff, because a
rank reshuffle reads as an unexplained mover when compared by position.

**[Residual Risks]**

- The inline pattern is tight by choice. A third phrasing, if one ships, will be
  dropped just as silently — the roster sweep is the guard, and it is a
  throwaway probe rather than a test. What IS pinned is the COUNT: `outro.test`
  asserts 15 resonators have an outro damage row, so a new drop or a new false
  positive fails the build.
- The ATK default for the two new rows is an assumption in the sense that
  neither node states a scaling stat anywhere — text or data. It is the same
  default the other branches already fall back to, and it is now test-pinned so
  a change is visible rather than silent.
- Neither character is on the benchmark team, so the DPS-gap baseline
  (1.497x) is unmoved by this.

**[Updated Docs]** This entry. `tests/outro.test.mjs` — the roster count comment
records why the number moved and that it is not expected to climb to 56, and a
new block pins BOTH halves of the finding: the two recovered rows, and that the
three benchmark members' buff-only outros must stay at zero (that one was
reported as a defect twice).

---

## 2026-08-13 — External buffs, lane 1: weapons routed by attribute id

The gap thread reached the gear lanes. Every external buff — weapon passive,
sonata bonus, echo skill — was being derived by parsing English, and three
independent failure modes were found in one sitting. The game states all of it
as data; this lands the weapon lane on that data.

**[Files Changed]** `tools/extract/extract_external_buffs.py` (new),
`src/core/buffs/external-buffs.js` (new), `tests/external-buffs.test.mjs` (new),
`data/external-buffs.json` (new, committed), `src/core/buffs/conditional-buffs.js`,
`src/core/skill.js`, `src/core/sim.js`, `tools/preprocess.mjs`,
`tools/optimize.mjs`, `tests/meta-schema.test.mjs`, `CLAUDE.md`, this file.

**[Logic Altered]**

- **The routing exists in the game and is exact.** `WeaponConf.ItemId ->
  ResonId -> WeaponReson(Level = refinement).Effect[] -> db_buff`, following
  `ExtraEffectID 35 AddPassiveSkill` through `db_PassiveSkill.SkillActionParams`
  and `ExtraEffectID 2 AddBuffTrigger` through its chained ids, down to leaf rows
  carrying `GameAttributeID` + `ModifierMagnitude` (or `CommonSnapshotModify`,
  which puts the attribute id in its parameters). 96 weapons, 745 grants across
  all five ranks. Every value checked against its own tooltip ladder: Everbright
  Polestar 0.32/0.40/0.48/0.56/0.64 DEF-ignore and -0.10..-0.30 Fusion RES,
  Kumokiri 0.08..0.16 per stack and 0.24..0.48 all-element.

- **The walk DEDUPES by buff id.** Everbright Polestar reaches its two grants
  from two passives — one listening for Tune Rupture - Shifting, one for Fusion
  Burst. They are one 8-second pair, not two. The test asserts exactly two grants
  at R1, because emitting per path would double them, and inflation is the
  failure mode that looks like nothing is wrong.

- **The SCOPE is data too, and is applied PER HIT.** `ExtraEffectRequirements`
  12 = DamageTypes; Everbright Polestar's grants carry `[2]` = Liberation,
  matching its text ("the wielder's Resonance Liberation DMG ignores 32% DEF")
  without reading the text. `skill.js` gained a `targetContext` and applies
  `defIgnore`/`resReduce` per hit, scoped exactly the way `amplifyContext`
  already is. The proof it works: wiring a 32% DEF-ignore moved Aemeath 23.9%
  and left the Tune Break anchor **byte-identical**, because a Tune Break is not
  Liberation damage.

- **Two dead hooks got a producer.** `formula.js` has always had
  `context.defIgnore` and `context.resReduce`; nothing ever set them.
  `contribution.defIgnore` was parsed and read by NOTHING — `sim.js` consumed
  only the amplify buckets, `stats.js` names it only in empty-shape literals. So
  every weapon DEF-ignore clause in the game was computed and discarded. Its
  text pattern was also wrong (`ignores 32% **of** ... DEF`, and half the weapons
  omit the "of"), which is why the lane read zero twice over.

- **The split is deliberate and is what keeps this safe.** The data path adds
  ONLY `targetMods`; every bucket the text reader has always owned it still
  owns. A first attempt returned early from the data and regressed three tests —
  the extractor does not yet read `ExtraEffectID 37/38` (the multiplicative
  amplify lane) or the team-wide routing, so replacing DROPPED what the text
  path did cover. Adding only the lane the text path has never produced a value
  for means there is nothing to double-count against and nothing taken away.

**[Measured]** Benchmark, on the reference's own conditions:

    member      before        after      reference    gap
    Chisa       412,293      412,293       594,209   1.441x   (unchanged)
    Denia     1,144,150    1,144,150     1,306,453   1.142x   (unchanged)
    Aemeath   2,807,154    3,478,366     4,633,096   1.332x   +671,212 / +23.9%
    TEAM      4,363,597    5,034,809     6,533,757   1.298x   (was 1.497x)
    TEAM DPS     54,746       63,167        82,874   1.312x

Chisa and Denia unchanged is the no-double-count check: their weapons'
conditionals are DMG bonuses the text path already read correctly, and the data
path deliberately does not touch that bucket.

**[Verification Method]** `npm test` **72/72** (new `external-buffs` 43/0),
`npm run sweep` 68 imported / 0 failed, `npm run lint` **0 errors** (3087
style-only warnings). LOCK A and LOCK B both regenerated — real diffs, expected:
the dataset gains `externalBuffs` and the meta moves because DEF-ignore now
reaches the damage formula. `ENGINE_FILES` updated in BOTH `tools/optimize.mjs`
and `tests/meta-schema.test.mjs` for the new engine module.

**[Residual Risks]**

- The extractor reads `GameAttributeID` and `CommonSnapshotModify` only. The
  multiplicative amplify lane (`ExtraEffectID` 37/38) and team-wide routing
  (`BindBuffToTeam` and friends) are NOT read, which is exactly why the data path
  is additive rather than a replacement. Migrating the remaining buckets needs
  those first.
- UPTIME is unchanged: these grants are credited at full uptime, gated by the
  existing text triggerability check, the same as every other weapon conditional.
  The data carries `durationSeconds` and the passive carries its trigger preset;
  neither is modelled yet.
- The triggerability GATE still reads text. Only the values, buckets and scopes
  are data-driven.
- `stackLimit` is credited at cap (Kumokiri 8% x 3 = 24%), matching what the
  text path already did for stacking weapon buffs.

**[Updated Docs]** `CLAUDE.md` — five new invariants: external routing is data,
the DamageTypes scope, "All-Attribute" being six element rows rather than one id,
the dead DEF-ignore/RES-shred hooks, and the leading unconditional stat not being
in ConfigDB at all. This file.

---

## 2026-08-13 — External buffs, lane 1b: amplify, team routing, and the migration

Extends the previous entry's extractor so the data path is complete enough to
OWN the stat buckets rather than only add to them.

**[CORRECTION to the previous entry and its commit message]** Both quote
Aemeath at 3,478,366 / TEAM 5,034,809 / gap 1.298x. Those figures were measured
BEFORE the DamageTypes scope reached the regenerated dataset, so the DEF-ignore
was still being credited to every hit instead of to Resonance Liberation hits
only. The committed state actually reads **Aemeath 3,377,823 / TEAM 4,934,266 /
gap 1.324x**. The direction of that correction is the scope working — it takes
damage AWAY, correctly — but the numbers in that entry are wrong and these are
the right ones. Verified by checking out the commit and re-running the harness.

**[Files Changed]** `tools/extract/extract_external_buffs.py`,
`src/core/buffs/external-buffs.js`, `src/core/buffs/conditional-buffs.js`,
`tests/external-buffs.test.mjs`, `tests/stat-ranking.test.mjs`,
`tests/build-editor-v2.test.mjs`, `data/external-buffs.json`,
`data/wuwa-data.json`, `data/data-version.json`, `data/wuwa-meta.json`.

**[Logic Altered]**

- **The multiplicative lane.** `ExtraEffectID` 37/38 (DamageAmplifyOnHit /
  OnBeHit) carry no `GameAttributeID` at all — the magnitude is
  `ExtraEffectParametersGrow1` alone. They are emitted as attribute 95
  (`Proto_SpecialDamageChange`), which is the attribute the engine already routes
  to its `amplify` bucket, with the originating effect id kept for traceability.

- **Team routing, read from the data.** A passive's `TriggerPreset[0]` says who
  the grant is for: '0' the wielder, '1' the whole team. The game's own
  descriptions confirm it — every preset-'1' weapon passive is named 队伍…
  ("team…") and carries `InstigatorType` 'Attacker' where the self ones carry
  'Owner' (115 self vs 20 team across the roster). The flag propagates DOWN the
  walk, because it belongs to the passive that hands the buff out, not to the
  buff row. Kumokiri splits exactly as its tooltip reads: the Liberation stack
  self, the all-element bonus team. A team grant lands in BOTH bundles at the
  same value, since the wielder is themselves one of "Resonators in the team".

- **The walk now dedupes by (buffId, teamWide)** rather than buffId alone, so a
  buff genuinely handed out both ways can appear as both without a self-only
  grant being collapsed into a team one.

- **The migration, and the rule that makes it safe.** The data now wins the stat
  buckets PER WEAPON, all-or-nothing, whenever it produces a placeable value.
  All-or-nothing rather than a merge is the whole point: text and data routinely
  express the SAME grant in different buckets (Bloodpact's Pledge reads as an
  element amplify from its wording and as a Resonance Skill DMG bonus in the
  tables), so a union would credit one value twice. Taking one source per weapon
  cannot.

**[Measured — the comparison that justified migrating]** All 89 weapons at R1,
both sides gated identically so only the parsing differs:

    identical                       36
    DATA only (text read nothing)   43     <- nearly half the roster
    TEXT only (data read nothing)    2     <- Azure Oath, Lux & Umbra
    both, differing                  8     <- data carries a stack limit or the
                                              bucket the wording hides

Both TEXT-only weapons are in the known-unplaced set, so they fall through to the
text reader automatically and nothing is lost.

Benchmark, committed lane 1 -> now:

    Chisa     412,293 -> 449,868     (+37,575)
    Denia   1,144,150 -> 1,144,150   (unchanged)
    Aemeath 3,377,823 -> 3,624,182   (+246,359)
    TEAM    4,934,266 -> 5,218,199   gap 1.324x -> 1.252x

Denia unchanged with both teammates up is the check that nothing double-counts:
her Forged Dwarf Star grants +24% ATK marked `teamWide`, which she already held
in her own bundle and which now correctly reaches Chisa and Aemeath. The Tune
Break anchor stays at 71,015 throughout.

**[Residual Risks]**

- **Scoped amplify is deliberately UNPLACED** (8 weapons, pinned as a contract
  in `tests/external-buffs.test.mjs`). Lux & Umbra ships +24% scoped to Heavy,
  +24% scoped to Echo Skill, and +24% scoped to BOTH — the third is the
  tooltip's "DMG Amplification on each attack is capped at 24%", not a third
  bonus. The three differ only in `BuffAction`, so telling a cap from a grant
  needs that chain modelled. Widening them would be exactly the double-count
  this work exists to avoid, so they fall through to the text reader instead.
- Uptime and the triggerability gate still come from the text. Only values,
  buckets, scopes and recipients are data-driven.
- Two tests had premises that a legitimately better weapon pick invalidated, and
  were fixed rather than pinned: `stat-ranking` now reconstructs the anchor with
  the meta's OWN `referenceWeapon` instead of assuming it equals
  `representativeWeaponId`, and `build-editor-v2`'s signature-vs-suggestion
  discriminator moved from Carlotta to Jinhsi because the optimizer now picks
  the REAL signature weapon for Carlotta, Hiyuki and Changli (3 of 6 anchors).

**[Updated Docs]** This entry, including the correction above.

---

## 2026-08-13 — External buffs, lane 2: sonata sets

**[Files Changed]** `tools/extract/extract_external_buffs.py`,
`src/core/buffs/external-buffs.js`, `src/core/buffs/sonata-buffs.js`,
`src/core/buffs/buff-windows.js`, `tests/external-buffs.test.mjs`,
`tools/preprocess.mjs`, `data/external-buffs.json`, `data/wuwa-data.json`,
`data/data-version.json`, `data/wuwa-meta.json`.

**[Logic Altered]**

- **The join, doubly confirmed.** A fetter row names itself
  `PhantomFetter_<sonataId>_Name` AND its buff ids independently encode the same
  number (`31000027001` -> set 27). Both agree on all 64 rows and cover all 34
  of our sonatas. The piece count is in the row id: sets 10+ use
  `sonataId*10 + pieces` (272 / 275), sets 1-9 the older sequential pair.
  The 2-piece bonus is NOT taken from here — it lives in `AddProp`, which the
  dataset already carries.

- **Recipients are data.** `FormationPolicy: 1` marks a team grant, which is how
  the sonatas say what weapons say with `TriggerPreset` — Rejuvenating Glow's
  ATK buff carries it and its passive is literally described 声骸套装-触发治疗时
  给队友加攻击力 ("echo set: on healing, give TEAMMATES ATK"). `AddBuffTrigger`'s
  parameters are `[EventType, TargetType, BuffIds, InstigatorType]` per the
  client's own `InitParameters`, and `TargetType` is the recipient
  (`GetTargetByType`: 0 Owner, 1 Opponent, 2 Instigator, 3 skill target).
  Chromatic Foam's 25% hand-off targets 1, which does NOT plainly match its
  tooltip ("grants the incoming Resonator"), so it is marked `recipient: other`
  and deliberately left UNROUTED rather than guessed.

- **Values feed the WINDOW path, and only the buckets it owns.** The two sonata
  lanes are disjoint by construction — the window path owns element / ATK /
  skill-type DMG, `sonataConditionalContribution` owns crit / amplify /
  DEF-ignore — so `sonataWindowGrants` returns only the former. Handing it
  Trailblazing Star's Crit Rate grant would have doubled a value the conditional
  path already credits.

- **The trigger comes from the data only where the text cannot be trusted.**
  Almost every sonata grant fires on a status inflict or a damage event, not a
  cast (`BuffInstigatorTrigger` x20, `DamageTrigger` x5; `SkillTrigger` x1). The
  override is therefore NARROW: only `BuffInstigatorTrigger` forces 'unknown',
  because only a status inflict can never be a cast. A first attempt overrode
  every non-cast trigger and cost the team 150k — Rejuvenating Glow fires on a
  `DamageTrigger` that its sentence calls "upon healing allies", and that word is
  what gates its team distribution through `supportTable`.

- **A text guard that silenced a whole tier.** `computeBuffWindows` drops any
  sonata buff whose text `isIncomingResonatorBuff` matches — and that reads the
  WHOLE tier, so Chromatic Foam's own 10% was discarded because its SECOND
  clause mentions the incoming resonator. Data-derived buffs skip that guard;
  the tables already stated the recipient.

**[Measured]** Benchmark, lane 1b -> now:

    Chisa     449,868 -> 449,868     (unchanged)
    Denia   1,144,150 -> 1,227,306   (+83,156)
    Aemeath 3,624,182 -> 3,624,182   (unchanged)
    TEAM    5,218,199 -> 5,301,355   gap 1.252x -> 1.232x

Denia's +83,156 is Chromatic Foam's self 10% Fusion DMG finally paying, and it
matches to the unit the figure measured independently days earlier by REPHRASING
the tier text so the old parser could read it — two unrelated routes to the same
number. Aemeath unchanged is the expected result, not a null: Trailblazing
Star's 20% was already numerically right because the old parser applied it as a
FLAT multiplier and she is mono-Fusion. It is now correctly element-scoped, which
matters for any wielder who is not.

**[Verification Method]** `npm test` **72/72** (external-buffs 57/0),
`npm run sweep` 68 imported / 0 failed, `npm run lint` **0 errors**. LOCK A and
LOCK B regenerated.

**[Residual Risks]**

- Chromatic Foam's 25% hand-off is still unpaid. It is now correctly IDENTIFIED
  (`recipient: other`) rather than silently mis-credited, but routing it needs
  `TargetType 1` reconciled with the tooltip's "incoming Resonator" — the client
  has `ExtraEffectAddBuffOnChangeTeam` and `ExtraEffectFormationAttribute`
  classes that likely explain it. 8 sonata grants are unrouted this way.
- Uptime and the triggerability gate are still text-derived; only values,
  buckets, durations, recipients and the status-inflict trigger are data.
- The 2-piece bonus still comes from the dataset's `addProp`, not from here.

**[Updated Docs]** This entry.

---

## 2026-08-13 — "Opponent" is not the enemy: the incoming-resonator transfer

A maintainer challenge to the previous entry's reading, and it was right. Lane 2
marked Chromatic Foam's 25% hand-off `recipient: other` on the grounds that its
`AddBuffTrigger` targets `TargetType 1 = Opponent`, which "doesn't plainly match"
a tooltip that says *incoming Resonator*. That inference was wrong.

**[Files Changed]** `tools/extract/extract_external_buffs.py`,
`src/core/buffs/conditional-buffs.js`, `tests/external-buffs.test.mjs`,
`data/external-buffs.json`, `data/wuwa-data.json`, `data/data-version.json`,
`data/wuwa-meta.json`.

**[Logic Altered]**

- **`Opponent` means COUNTERPARTY OF THE EVENT, not "enemy".**
  `ExtraEffectBase.BuffEffectBase.Check(context, e)` sets
  `this.OpponentEntityId = e.GetEntity()?.Id`, so the "opponent" is simply
  whichever entity the FIRING EVENT supplied. `GetTargetByType(1)` then resolves
  to that entity. Nothing about it is inherently hostile — reading the enum name
  as though it were was the whole mistake.

- **EventType 10 is the Outro -> Intro handoff.**
  `BaseBuffComponent.TriggerEvents(type, entity, ctx)` dispatches to
  `TryExecute(ctx, entity)`, and event 10 is raised by
  `RoleElementComponent.TriggerEvents`, whose caller is `RoleQteComponent` — QTE
  being the swap:

      this.m1t.TriggerEvents(10, t.m1t, e);   // on the OUTGOING role,
      t.m1t.TriggerEvents(13, this.m1t, e);   // passing the INCOMING one

  So on event 10 the counterparty IS the resonator swapping in, and a
  TargetType-1 grant behind it is precisely the incoming-resonator transfer the
  tooltip describes. The extractor now emits `recipient: 'incoming'` for that
  combination (6 sonata grants), keeping `'other'` only for target types it
  genuinely cannot place (2).

- **The transfer is wired to the lane that already existed.**
  `incomingResonatorContribution` takes the data when the tier has an incoming
  grant and skips its text scan for that tier. That scan had scored ZERO here
  for as long as it has existed: the tier writes the value BEFORE the stat
  ("grants the incoming Resonator 25% Fusion DMG Bonus") and `extractClause`
  only ever matched "…by 25%".

**[Measured]** Benchmark, lane 2 -> now:

    Chisa     449,868 -> 449,868     (unchanged)
    Denia   1,227,306 -> 1,227,306   (unchanged)
    Aemeath 3,624,182 -> 3,918,772   (+294,590)
    TEAM    5,301,355 -> 5,595,945   gap 1.232x -> 1.168x

Only Aemeath moves, which is the shape the mechanic predicts: she is the member
who swaps in after Denia, so she alone receives the transfer. Denia unchanged
confirms the wielder is not also credited with her own hand-off. The Tune Break
anchor stays 71,015.

**[Verification Method]** `npm test` **72/72** (external-buffs 59/0),
`npm run sweep` 68 imported / 0 failed, `npm run lint` **0 errors**. LOCK A and
LOCK B regenerated. The test now asserts the transfer lands as 25% Fusion DMG on
the incoming bundle AND that the wielder's own 10% does not leak into it.

**[Residual Risks]**

- 2 sonata grants remain `recipient: 'other'` (target types the walk cannot
  place). They are identified, not mis-credited.
- The transfer is credited at full value for the receiving segment, matching how
  `incomingResonatorContribution` already treats every other set; its 15s
  duration is carried in the data but not yet used to bound it.
- Uptime and the triggerability gate remain text-derived.

**[Updated Docs]** This entry. The lesson generalises and is worth stating: an
enum NAME in the client is not its semantics. `Opponent`, `Instigator` and
`Owner` are roles in whatever event is firing, and the event decides who fills
them — which is discoverable, since the dispatcher passes the entity explicitly.

---

## 2026-08-13 — External buffs, lane 3 (echoes): the source does not exist

Lane 3 was investigated to the same depth as lanes 1 and 2 and produced a
DETERMINATION rather than a change: the exported ConfigDB has no stat-buff data
for echo skills. Recorded so it is not re-derived.

**[Files Changed]** `docs/HISTORY.md` only. No code, no data.

**[What was checked]**

- **The join EXISTS and is total.** An echo's `activeSkill.settleId` appears in
  `phantomskill.SettleIds` for **161 of 161** echoes that have one. So the route
  echo -> skill row is not the problem.
- **The route is empty.** Only **2 of 243** `phantomskill` rows carry `BuffIds`
  at all — Tambourinist (200020) and Cruisewing (200024) — and neither leads to
  an attribute. Both terminate in `ExtraEffectID 4` spawns (Tambourinist's Havoc
  pulse, Cruisewing's heal), with no `GameAttributeID` anywhere in the chain.
- **The one echo whose buff the engine models has nothing there.** Bell-Borne
  Geochelone (390080005, settleId 28000301) is the only echo carrying a
  `teamBuff` in our dataset (+10% DMG, 15s) — and its `phantomskill` row
  (PhantomSkillId 280003) has NO `BuffIds`. Its shield and team boost are not in
  this table.
- Echo ids resolve only into handbook / reward / exhibit tables
  (`phantomhandbook`, `calabashdevelopreward`, …) — nothing ability-shaped.

**[Conclusion]** Echo skill effects live in the monster ABILITY BLUEPRINTS, the
same binary `.uasset` space as a weapon's unconditional leading stat, and are not
reachable from ConfigDB. This is the same wall `docs/OPEN-ITEMS.md` #23 already
records as the Monster-tree export. Lane 3 cannot be done the way lanes 1 and 2
were, and the existing `preprocess.mjs extractEchoTeamBuff` text path remains the
only source. Only 1 of 180 echoes carries a modelled team buff today, so the
exposure is small.

**[Also settled — the two `recipient: 'other'` grants]** Both belong to ONE set,
Crown of Valor (sonata 20) 3pc, and both are SELF grants that the conservative
rule declined to place:

    31000020006  AddBuffTrigger ["7", "2", "31000020007#31000020008"]  CD 0.5s
       31000020007  attr 7 Proto_Atk        = 0.06  4s  stack 5
       31000020008  attr 9 Proto_CritDamage = 0.04  4s  stack 5

EventType 7 is shield-gained, fired by `CharacterShieldComponent` as
`this.m1t.TriggerEvents(7, this.m1t, {})` — it passes its OWN buff component, so
the event's counterparty is the same character. TargetType 2 is
`InstigatorBuffComponent`, which for a self-applied shield is also that
character. The `ExtraEffectCD: [0.5]` and `StackLimitCount: 5` match the
tooltip's "once every 0.5s" and "stacks up to 5 times" exactly, and the sibling
buff `31000020001` reaches the same character via TargetType 0. Widening
TargetType 2 to self is therefore a one-line change, left for the maintainer.

**[Residual Risks]** None introduced — nothing was changed.

---

## 2026-08-13 — Crown of Valor wired; the phantom tables surveyed

**[Files Changed]** `tools/extract/extract_external_buffs.py`,
`tests/external-buffs.test.mjs`, `data/external-buffs.json`,
`data/wuwa-data.json`, `data/data-version.json`, `data/wuwa-meta.json`,
`docs/HISTORY.md`.

**[Logic Altered]** `AddBuffTrigger` TargetType **2** (`InstigatorBuffComponent`)
now counts as SELF alongside TargetType 0. For a gear grant fired by the
wielder's own action the instigator IS the wielder, and the single case in the
data confirms it three ways: Crown of Valor's 3-piece sits behind EventType 7
(shield gained), which `CharacterShieldComponent` fires as
`this.m1t.TriggerEvents(7, this.m1t, {})` — passing its OWN buff component; its
`ExtraEffectCD 0.5` and `StackLimitCount 5` match the tooltip's "once every 0.5s"
and "stacks up to 5 times"; and its sibling `31000020001` reaches the same
character through TargetType 0. Sonata recipients are now **59 self / 6 incoming
/ 0 unrouted**, and the test asserts that nothing is left unrouted.

The benchmark is unchanged (5,595,945) because none of the three members runs
Crown of Valor — the fix is roster-wide, not team-specific.

**[The phantom ConfigDB files — surveyed, nothing further to extract]**

Prompted by a maintainer nudge that four phantom files looked worth a look. All
four were opened and every table listed:

- **`db_PhantomBattle.db`** (38 tables, incl. `phantombattlebuff` 154 and
  `phantombattleskill` 328) — the **card minigame**, not combat. Its skills carry
  `CostDurability` / `BattlePower` / `ActivateCondition` and its buffs an effect
  DSL (`EffectType` + `EffectParams` strings like `"1:1:10"`). No
  `GameAttributeID` anywhere. Not the echo system.
- **`db_PhantomCollectActivity.db`** — 4 rows total, an activity.
- **`db_PhantomManagePlan.db`** — saved echo loadouts (`phantommanageplanv2`).
- **`db_phantom.db`** — the real one, already used for `phantomfetter`.

Two things inside `db_phantom` that had not been examined:

- **`phantomitem.CalabashBuffs`** — 3 distinct buffs (70045/70046/70047) across
  all 829 rows, all `ExtraEffectID 1` on attribute **114
  `Proto_DamageChangePhantom`** (Echo DMG). They are the **Data Bank progression
  curve**, not a build buff: their `ExtraEffectParametersGrow1` ramps to 10000
  (=100%) across Data Bank levels — 70045 over levels 1-10, 70046 over 11-30,
  70047 over 21-40 — and sits at 100% thereafter. At endgame all three are
  saturated, i.e. "echo damage NOT reduced" rather than a bonus, which is what
  the sim already assumes.
- **`phantomsumleveleffect`** (101 rows) and **`phantomsubpropaction`** (20 rows)
  ship NO accessor JS, so their schema cannot be read from the client and this
  project does not guess FlatBuffers offsets (that is the entire premise of
  `tools/extract/configdb.py`). Both names point at the same Data Bank / substat
  progression family as the Calabash curve above, so the expected value is low.

This closes the question the echo lane raised: the phantom files hold no echo
stat-buff data beyond what is already modelled, and the earlier determination
stands — echo skill effects live in the monster ability blueprints.

**[Verification Method]** `npm test` **72/72** (external-buffs 64/0),
`npm run sweep` 68 imported / 0 failed, `npm run lint` **0 errors**. LOCK A and
LOCK B regenerated.

**[Residual Risks]** None introduced. The two undecodable tables are recorded
above rather than guessed at.

---

## 2026-08-13 — The blueprint hunt: the leading stat is not in the client at all

Prompted by a maintainer request to search the asset tree directly. The answer is
a NEGATIVE, but an exhaustive one — recorded so the ground is not re-covered.

**[Files Changed]** `docs/HISTORY.md` only.

**[What was searched, and what it found]**

1. **Every ConfigDB file, by ID.** A byte scan of all **486** `db_*.db` files for
   the int32 / int64 / float64 / ASCII encodings of a weapon id. Kumokiri
   (21010056) is referenced by exactly: `weaponconf`, `weaponreson`,
   `weaponbreach`, and UI/gacha/trial tables (`trialweaponinfo`,
   `prefabrichtextdata`, `gachaviewinfo`, `roledev*`, `modelconfigpreload`).
   Nothing else in the entire client config knows the weapon exists.
2. **All three gameplay tables read in full.** `weaponconf` holds base ATK +
   secondary (`FirstPropId {Id:7}`, `SecondPropId {Id:8}`); `weaponreson` holds
   the five refinement rows whose `Effect[]` are the CONDITIONAL buff ids already
   extracted; `weaponbreach` is ascension gating only — level limits, gold costs
   and condition ids, no stats.
3. **`buffequipitem`** — the accessor `BuffEquipItem.js` and its
   `BuffEquipItemByItemId` / `ByRoleId` query helpers looked exactly right, and
   the table is hidden inside `db_ItemAttributeReward.db` rather than a file of
   its own. It is **cosmetics**: 32 rows of masks and crowns
   (`Tips_Mask_Wear`, `Tips_Crown_Wear`). No weapons.
4. **The asset tree, by filename.** A native
   `Directory.EnumerateFiles(..., AllDirectories)` pass (19s, vs. the pipeline
   walk that had to be abandoned) over `Content/Aki`: weapon 21010056 resolves to
   **icon textures only** (`T_IconWeapon21010056_UI` and friends); echo
   390080005 resolves to **nothing**; the `110036` hits are unrelated
   `LevelEntity` configs in a different number space.
5. **The client script.** `Content/Aki/TypeScript` holds only UE blueprint stubs
   (.uasset/.uexp), not readable source. In the minified JS, every consumer of
   `WeaponReson` / `WeaponConf` outside `Define/Config` is UI — tips, forging,
   gacha, exhibits.

**[Conclusion]** A weapon's unconditional leading stat ("ATK is increased by
12%") exists in the client ONLY as `WeaponConf.DescParams`, a display parameter
ladder indexed by refinement rank. There is no attribute row, no per-weapon
asset, and no equip-buff entry anywhere in the shipped client. The most
consistent explanation is that it is applied SERVER-SIDE and the client simply
receives resolved attribute values — which also explains why **0 of 127** rank-1
`WeaponReson` rows carry a permanent attribute buff while their CONDITIONAL
grants are all present in `db_buff`.

The same applies to echo skill effects (lane 3): `phantomskill.BuffIds` is empty
for all but 2 of 243 rows, neither of which is an attribute.

**[What this means for the project]** `weapon-buffs.js weaponPassiveStats` is not
a stopgap to be replaced later — it is the ONLY available source, and it is
reading the right thing: the stat NAME from the leading sentence and the VALUE
from `effectParams[rank-1]`, which is nanoka's mirror of `DescParams`. The value
is therefore already data-driven and rank-correct; only the stat-name
classification is textual, and that clause is always first and always
unconditional, which is what makes it reliable.

**[Residual Risks]** None introduced — nothing was changed. If a future export
includes server tables or decoded blueprints, the first thing to re-check is
whether a permanent attribute buff appears in a weapon's `WeaponReson.Effect[]`.

---

## 2026-08-13 — Echoes DO have a source, and a whole transfer lane was unread

A maintainer test — "Lucilla casts Glommoth, Outros into Hiyuki, does Hiyuki get
the 12% Glacio DMG Bonus?" — answered NO, and finding out why corrected the
previous entry's conclusion about the echo lane.

**[Files Changed]** `tools/preprocess/echoes.mjs`,
`src/core/buffs/conditional-buffs.js`, `src/core/buffs/buff-windows.js`,
`tests/outro.test.mjs`, `data/wuwa-data.json`, `data/data-version.json`,
`data/wuwa-meta.json`.

**[The correction]** Lane 3 was recorded as having no usable source because
`phantomskill.BuffIds` is empty for 241 of 243 rows. That was the wrong place to
look. Echoes have the SAME source shape as weapons:

    weapon   WeaponConf.Desc      + DescParams[param][rank]      -> effectParams
    echo     phantomskill.DescriptionEx (lang_multi_text)
                                  + per-level params             -> activeSkill.params

Verified on Bell-Borne to the digit: `{0}` 91.20%->145.92% is `rateByLevel`,
`{1}` 15 and `{3}` 10% are its modelled `teamBuff`, `{5}` 20 the cooldown. So the
echo VALUES are structured and level-indexed, exactly like the weapon rank
ladder — not prose.

**[What was unread]** A first survey said "1 unmodelled echo buff". That survey
was WRONG: it searched only for TEAM-wide wording and so matched none of the
INCOMING-RESONATOR transfers. Corrected, there were **5**:

    Hyvatia              c4  10% All-Attribute DMG -> next resonator
    Reminiscence: Denia  c4  12% Fusion DMG        -> incoming
    Glommoth             c3  12% Glacio DMG        -> incoming
    Voidwing Moth        c3  12% ATK               -> incoming
    Fallacy of No Return c4  10% ATK               -> all team members

**[Logic Altered]**

- `extractEchoIncomingBuff` (new) reads the transfer from the sentence naming
  the incoming resonator, taking the VALUE from the MAX-level param column —
  matching the cooldown reader, and unlike `extractEchoTeamBuff`, which reads
  level 1 (harmless only because Bell-Borne's buff params do not scale). The
  stat is matched by NAME rather than "any word after a placeholder": the loose
  form latched onto the `{1}s` of "within {1}s after summoning" and read the
  stat as "s", which is why the first attempt extracted nothing at all.
- `incomingResonatorContribution` credits it, gated twice: the echo must be in
  SLOT 0 (only that skill is ever cast) and the rotation must actually contain
  the echo step, since the clause reads "casting Outro Skill within Ns AFTER
  summoning".
- `extractEchoTeamBuff` also learns the LITERAL team-ATK shape. Fallacy of No
  Return writes "all team members 10% bonus ATK for 20s" with no `{N}` param, so
  the number has to come from the sentence and does not scale with echo level.
  `computeBuffWindows` emits it as an 'atk' window rather than 'amplify',
  because it scales the attacker stat and not the per-hit multiplier.
- Checked before wiring, per maintainer instruction: Fallacy of No Return has
  exactly ONE entry. 26 of 180 echoes are Nightmare variants shipping as separate
  echoes with different effects, so a duplicate was a real risk.

**[Measured]** The maintainer's own scenario, Lucilla (Glacio) with sonata 30:

    Glommoth slot 0, rotation casts the echo   incoming Glacio 0.37
    Glommoth slot 0, rotation does NOT cast it incoming Glacio 0.25
    no echo equipped                           incoming Glacio 0.25
    Glommoth in slot 1 (skill never cast)      incoming Glacio 0.25

Exactly +0.12 for the echo, on top of the 0.25 Wishes of Quiet Snowfall already
transfers. The benchmark is UNCHANGED at 1.168x, as predicted: none of the five
echoes sits in slot 0 for that team (Denia's is Reactor Husk; Aemeath holds
Glommoth in a 3-cost slot, whose skill is never cast).

**[Verification Method]** `npm test` **72/72** (outro 46/0), `npm run sweep` 68
imported / 0 failed, `npm run lint` **0 errors**. LOCK A and LOCK B regenerated.

**[Residual Risks]**

- The `windowSeconds` ("within 15s after summoning") is extracted but NOT
  enforced — the transfer is credited whenever the echo is cast in the rotation.
  A segment longer than the window would over-credit. Reminiscence: Denia states
  its window in prose rather than a param, so its `windowSeconds` is null.
- Fallacy's self "+10% bonus Energy Regen" is still unread; only the team ATK
  half is wired.
- The echo lane's remaining unmodelled buffs are the ~37 self/defensive clauses
  (DMG Reduction, shield values), which the damage model does not consume.

**[Updated Docs]** This entry, which supersedes the previous entry's claim that
the echo lane has no usable source. It has one; the earlier survey simply asked
the wrong question of it.

---

## 2026-08-14 — The derived magnitudes decoded: three sonatas paid, one grouping bug found

The previous entry left three sonata grants marked `derived` and credited
nowhere, because `ModifierMagnitude` under `CalculationPolicy[0] ∈ {2,4,9}` is a
coefficient in a runtime formula rather than a percentage. Reading it flat had
put a healer at 21× her real output. This session decodes the formula from the
client's own evaluator and pays all three at their tooltip values.

**[Files Changed]**
- `src/core/buffs/external-buffs.js` — `derivedGrantValue()`, `DERIVED_SOURCE`,
  and a shared `grantValue()` both fold paths use; `foldExternalGrants` and
  `sonataWindowGrants` take a `sources` map.
- `src/core/buffs/buff-timeline.js` — `groupStackingBuffs` key.
- `src/core/buffs/sonata-buffs.js`, `buff-windows.js`, `sim.js` — thread the
  wielder's Energy Regen down to the window path.
- `src/core/buffs/conditional-buffs.js`, `team-sim.js` — thread the INCOMING
  member's Tune Break Boost to the transfer path.
- `src/core/tune-break.js` — Tune Break Boost base; corrected attribute names.
- `tools/extract-forte.mjs`, `tools/preprocess.mjs` — `_tuneBreakBoostBase` →
  `resonator.tuneBreakBoostBase`.
- `tests/external-buffs.test.mjs` (82 assertions), `tests/tune-strain.test.mjs`
  (59), `CLAUDE.md` (three new invariants).

**[Logic Altered]**

1. **The formula, read off `BaseAttributeComponent.Cbr`.** Subtract `Min`
   (`policy[5]`) and stop if ≤ 0; divide by `Ratio` (`policy[6]`); multiply by
   the magnitude; cap at `Max` (`policy[7]`). Mode 9 lands in the same lane as a
   plain "scale base" modifier, so the fraction is
   `source / Ratio × Value1 × 1e-8`. The slot names are the client's own — they
   are what `ActiveBuff.p__` passes to `AddModifier`.

   `policy[2]` picks whose attribute set is read (1 = instigator, 0 = the buff
   holder), and the three tooltips name exactly those people. `Ratio` says what
   KIND of quantity the source is: 100 for a percentage read per 1%, 1 for a
   point count. All three reproduce their tooltip to the digit:

   | set | policy | source | result |
   | --- | --- | --- | --- |
   | 25 Halo of Starry Radiance | `[9,141,1,1,0,0,100,2500]` × 20 | Off-Tune Buildup Rate, 10000 on all 2,740 rows | **20% ATK**, cap 25% |
   | 33 Song of Feathered Trace | `[9,11,1,1,0,0,100,2500]` × 10 | wielder's Energy Regen | **10% at 100% ER**, cap 25% at 250% |
   | 24 Pact of Neonlight Leap | `[9,142,0,1,0,0,1,1500]` × 30 | incoming member's Tune Break Boost | **0.3%/point**, cap 15% |

   ONE DEPARTURE FROM THE CLIENT: `Cbr` never consults `Max` on the mode-9
   branch — the `break` precedes the cap check. It is applied anyway, because
   the tooltip and the `Max` field state the same number independently on all
   three sets. Honouring it can only under-credit; ignoring it is how +2000% ATK
   happened.

2. **A source the caller cannot supply stays UNPLACED, not zero.**
   `derivedGrantValue` returns null rather than 0, so a grant nobody can answer
   stays visible in `unplaced` instead of silently reading as nothing. Off-Tune
   Buildup Rate needs no caller at all (it is 10000 on every row and nothing in
   the model raises it), which is why Halo resolves from data alone.

3. **Tune Break Boost is attribute 142, and it HAS a base.** `tune-break.js` had
   the two Tune attributes swapped and read a third: it checked
   `Proto_WeaknessTotalBonus` (140), which is 0 on every resonator and non-zero
   only on 11 enemy rows, and concluded the stat had no base. The game says
   otherwise — `Proto_WeaknessMastery` (142) reads **10** on exactly the seven
   Tune-family responders, and `Proto_BreakWeaknessRatio` (141) is Off-Tune
   Buildup Rate at a universal 100%. Pact of Neonlight Leap pins which is which
   twice over: its tooltip says "each POINT", and its `Ratio` is 1.

   This is a REAL BEHAVIOUR CHANGE beyond the derived grants: the Tune Strain
   payout now reads base + grants, so solo Denia S0 moves 1.2% → 2.4% and S2
   3.6% → 4.8%. A base of 10 is also what makes Luuk's "every 10 points of Tune
   Break Boost he has" pay one tick with no grants at all.

4. **A tier's SECOND grant needs its own group key** (found while verifying, not
   sought). `groupStackingBuffs` keyed a window on `sonataId::raw` to merge the
   one-entry-per-trigger-phrase the TEXT parser emits. The DATA path reads a
   tier's grants one row each and they share that same tier text, so the key
   kept the FIRST and dropped the rest — Song of Feathered Trace's ATK grant
   never reached a window while its 35% Heavy Attack DMG did. This is the "a
   tier stating two grants can only carry one" failure the data path was built
   to fix, resurfacing one layer downstream. The bonus itself now joins the key;
   every field is identical across a text-parsed buff's triggers, so the
   original merge is untouched.

**[Verification Method]**
- Every expected value in `tests/external-buffs.test.mjs` is the SET'S OWN
  TOOLTIP, so the arithmetic is checked against the game's words rather than
  against itself: Halo 20%; Feathered Trace 10/18/25/25% at 100/180/250/400% ER;
  Pact 0/3/12/15/15% at 0/10/40/50/90 points. Both caps are exercised from both
  sides. A roster-wide sweep asserts every derived grant resolves to a bounded
  fraction.
- End-to-end through `incomingResonatorContribution`: Pact hands 15 / 18 / 27 /
  30% ATK at 0 / 10 / 40 / 60 points — its flat 15% plus the per-point half,
  capped at +15%, exactly as written.
- LOCK A: `data/wuwa-data.json` diff is exactly the seven `tuneBreakBoostBase`
  lines plus the timestamp — no incidental drift.
- LOCK B: regenerated. The meta re-ranked (Chisa's suggested set moved off 25),
  which is the intended consequence of the values becoming real.
- `npm test` 72/72 · `npm run sweep` 68/0 · `npm run lint` 0 errors.
- Benchmark, measured before/after against the same reference (RUN A 3-pass):
  team damage gap 1.168x → **1.165x**, DPS gap 1.180x → **1.178x**; RUN B
  1.122x → **1.120x**. Small, and expected: the harness pins sonatas that are
  none of the three, so the only change reaching it is the Tune Break Boost
  base. The gear-independent Tune Break anchor is unmoved at 71,015.

**[Residual Risks]**
- The mode-9 `Max` departure is a judgement call. If the client's omission is
  faithful to the server, these three sets are under-credited above their caps —
  reachable in practice only by Feathered Trace above 250% ER and Pact at 50+
  Boost points.
- `derivedGrantValue` handles mode 9 only. Modes 2 and 4 have a different shape
  (`+ Value2`, and 4 overrides rather than adds) and no shipped grant uses them;
  it returns null for those, which leaves them unplaced rather than wrong.
- Uptime for the derived grants is still the existing window model — Halo's 4s
  on a healing trigger, Feathered Trace's 10s. Only the MAGNITUDE changed hands.
- The three sets' triggers remain text-derived, so a set whose trigger the
  sentence does not name still lands on 'unknown'.

**[Updated Docs]** `CLAUDE.md` gains three invariants (the derived-magnitude
formula, the Tune Break Boost attribute and its base, the group key); the
existing "A magnitude is only flat if `CalculationPolicy` says so" row is
amended from "credited nowhere" to "carry the policy". `tune-break.js`'s header
keeps its wrong claim under strikethrough with the correction beneath it.

---

## 2026-08-14 (later) — Four spot-check findings: a per-grant recipient, a two-sim card, and a fictional opener

A maintainer spot-check of the running app found four issues. Three were real
defects; the fourth was a transparency gap. All four are fixed here.

**[Files Changed]**
- `tools/extract/extract_external_buffs.py` — `FORMATION_TEAM_POLICIES`.
- `src/core/buffs/buff-windows.js` — emit `teamWide` even when false.
- `src/core/buffs/conditional-buffs.js` — per-source provenance on the transfer.
- `src/core/team-sim.js` — `breakdown` on the transfer display entries.
- `src/ui/components/team-editor-v2.js` — render the breakdown in the tooltip.
- `tools/optimize/team-rank.js`, `tools/optimize.mjs`,
  `src/ui/components/suggested-teams.js` — one sim, averaged per pass; opener
  credibility filter.
- `tests/team-rank.test.mjs`, `tests/meta-schema.test.mjs`,
  `tests/suggested-teams.test.mjs`; `CLAUDE.md` (4 invariants).

**[Logic Altered]**

1. **`FormationPolicy` is an ENUM, and the extractor accepted one of its two
   team values.** The client branches on each value in a different component:
   **1** `ShareApplyBuffInner` copies the buff to every other team member; **5**
   `AddBuffInner` routes the add to the FORMATION buff component (216) instead
   of the character's own; **2/3** are the swap-inheritance lane
   (`RoleInheritComponent`), already modelled as `recipient: 'incoming'`.
   Accepting only 1 read exactly ONE of the sixteen team-wide sonata grants.

2. **A recipient is per GRANT, so `false` has to be said out loud.** team-sim
   reads `window.teamWide ?? isTeamWideBuff(window.raw)`, so an ABSENT flag
   means "ask the text" — and that fallback is per-TIER, `raw` being the whole
   tier sentence. Flaming Clawprint's 5-piece grants the team 15% Fusion Bonus
   **and the caster** 20% Liberation Bonus; both halves read team-wide, so the
   caster's own buff was handed to the whole team. A data-derived buff now emits
   the flag even when false. NOTE these two fixes are a PAIR: the data fix alone
   would still have been overridden by the text, and the engine fix alone would
   have had nothing but `false` to read.

3. **The suggested-teams bar and its numbers were two different sims.** `score`
   was the openers-ON 3-pass total damage; the card showed a no-opener single
   pass. Each is defensible, the pairing is not — the pool shipped a 90% card
   out-DPSing a 95% one. Per maintainer direction: one sim (openers ON,
   multi-pass), reported as the AVERAGE of its passes rather than a cumulative
   total, with `score` normalizing `teamDps` — the figure the card headlines.
   Per-pass figures are MARGINALS (N-total − (N−1)-total), not per-segment sums,
   because lanes that accrue post-hoc over the whole timeline (negative-status
   DoT, kit afflictions) belong to no segment and would silently fall out.

4. **A derived opener can be fiction, and a team of only those is dropped.** The
   opener is derived, not curated, and for some kits derives absurdity — Jiyan
   189–211s of filler to charge his first Liberation, Encore 114–144s. The
   existing `gatedLibs` signal cannot find them: it reads 0 on all 416 shipped
   teams. The bound is relative and needs no invented constant — a credible
   opener costs no more than ONE ROTATION of the team it opens — and a team
   where no member clears it is not suggested. Curated teams are exempt and
   flagged instead; silently dropping a maintainer-asserted comp would hide the
   finding rather than report it.

5. **The incoming-transfer strip shows its addends.** "+37% Fusion DMG" is two
   unrelated pieces of gear; the tooltip now reads "Chromatic Foam (5pc) +25% ·
   Reminiscence: Denia (Echo) +12%". The text-parsed branch recovers its addends
   by DIFFING the bundle either side of `extractClause`, which cannot disagree
   with what was actually added. Display-only — the damage model reads buckets.

**[Verification Method]**
- Flaming Clawprint end-to-end: `+15% Fusion DMG teamWide=true`, `+20%
  Resonance Liberation DMG teamWide=false` — the tooltip's own split.
- Transfer breakdown end-to-end: `dmgByElement {2: 0.37}` with sources
  `Reminiscence: Denia (Echo) 12%` + `Chromatic Foam (5pc) 25%`.
- `tests/meta-schema.test.mjs` now asserts DPS never rises as the bar falls,
  across every anchor. Measured over the regenerated meta: **0 violations on all
  52 anchors** (the shipped pool had them).
- `tests/team-rank.test.mjs` recomputes the openers-ON 3-pass run directly and
  requires the averages to match, the marginals to sum to the total, and pass 1
  to be the longest (it carries the cold start).
- Meta regenerated: 141 team slots changed; the dropped comps are the
  pathological ones (Sanhua/Jianxin/Encore, Youhu/Mortefi/Jiyan). All 52 anchors
  keep 8 suggestions; 0 curated teams needed the exemption.
- `npm test` 72/72 · `npm run sweep` 68/0 · `npm run lint` 0 errors.

**[Residual Risks]**
- The averaged `teamTime` (≈39–46s/pass) describes no individual pass, because
  pass 1 carries the opener and passes 2–3 do not. The P1/P2/P3 strip exists to
  show that spread, but a reader who ignores it will over-read the average.
- Ranking on DPS rather than total damage favours shorter rotations. Harmless at
  the current spread (all comps run 36–47s/pass), but a future burst comp could
  exploit it.
- `sonataConditionalContribution` (crit / amplify / DEF-ignore) is still
  ENTIRELY text-driven and does NOT read the per-grant data — so the same
  per-tier team-wide fallacy fixed here in the window path still exists in that
  lane. It is the next lane to migrate, and it is the honest answer to "is the
  sonata pipeline robust yet": the window path now is, that one is not.
- Weapon and echo grants route per-grant already (`foldExternalGrants`), but
  weapon team-wide-ness reads `TriggerPreset[0]`, a different mechanism from
  `FormationPolicy` — not re-verified against the client in this session.

**[Updated Docs]** `CLAUDE.md` gains four invariants; the ~~two-sim card~~ and
~~`FormationPolicy` 1~~ claims are struck through with the correction beneath.

---

## 2026-08-14 (lane 4) — The conditional lane, the piece-count join, and a weapon trigger read as a recipient

Continuing the external-buff lanes from the two items the previous entry named
as open: migrate `sonataConditionalContribution` off prose, and verify the
weapon team-wide mechanism against the client rather than against a correlation.

**[Files Changed]**
- `tools/extract/extract_external_buffs.py` — team-wide needs preset AND
  `InstigatorType`.
- `tools/preprocess.mjs` — re-key sonata tiers by the game's own params.
- `src/core/buffs/external-buffs.js` — `sonataConditionalGrants`,
  `WINDOW_LANE_BUCKETS`.
- `src/core/buffs/conditional-buffs.js` — data-first per tier.
- `tests/external-buffs.test.mjs` (95 assertions, was 82); `CLAUDE.md` (4
  invariants).

**[Logic Altered]**

1. **A weapon's team TRIGGER is not a team GRANT.** `TriggerPreset` is passed to
   the trigger as its own `Preset`, so `preset[0]` means something different per
   TriggerType — it says who may FIRE the passive. The RECIPIENT is
   `InstigatorType` (`jxm(skillId, r.InstigatorType, ...)`, stored as
   `TargetKey`): Owner the wielder, Attacker whoever fired it. My original note
   had already observed the conjunction ("...and they carry InstigatorType
   'Attacker' where the self ones carry 'Owner'") and the code implemented only
   half of it. Both counterexamples ship: preset 1 + Owner (Phasic Homogenizer,
   Boson Astrolabe — "After a Resonator in the team casts a Tune Break skill, it
   grants ... TO THE WIELDER") and preset 0 + Attacker (Spectrum Blaster).
   **40 grants flipped team-wide to self**, all of it over-crediting removed.

2. **The sonata piece count is not in `PhantomFetter`,** so the extractor guesses
   it from the row id — and Dream of the Lost's row 192 filed a THREE-piece
   tier's grants under "2 pieces". The tier then fell back to the text reader and
   its 35% Echo Skill DMG Bonus went unread. `EffectDescriptionParam` IS the
   dataset tier's `params`, so preprocess re-keys on that; a fetter matching
   nothing keeps the old key, making the pass correct-only. 1 tier re-keyed.

3. **The conditional lane reads the tables.** `sonataConditionalGrants` is the
   exact complement of `sonataWindowGrants` — between them they partition a
   tier's grants, asserted roster-wide. Data-first per tier, all-or-nothing, the
   same rule the weapon path uses and for the same reason (text and data express
   one grant in different buckets, so a union double-counts). A SCOPED grant
   still falls back to text: a whole-build bucket has no room for "...but only on
   Heavy Attacks".

**[Verification Method]**
- Measured text vs data across every sonata tier BEFORE changing anything: of
  the 11 tiers stating a crit/amplify/DEF-ignore grant, 3 agreed, **5 read as
  ZERO in the text**, 2 differed (stack multiplier, sibling row), 1 was
  text-only (the mis-keyed tier). Zero tiers had the text claiming team-wide
  where the data said self, so this lane had no Flaming-Clawprint-class bug.
- Each of the five is pinned to its own tooltip value, resolved BY NAME — two of
  my first numeric ids were wrong and the test caught it, which is the argument
  against numeric ids in tests.
- Every team-wide weapon must NAME the team in its own tooltip: a roster-wide
  guard where the mechanism is data and the tooltip an independent witness. All
  10 pass.
- Investigated 29 sonata buffs the walk never reaches and confirmed **all are
  legacy config**: each hangs off a `...001`-series tree no `PhantomFetter`
  references, or off a passive the live root does not add. Halo's fetter reaches
  `31000025017` alone, so its six element rows and its Crit DMG row are dead.
  This is a NON-finding, recorded so it is not re-investigated.
- `npm test` 72/72 · `npm run sweep` 68/0 · `npm run lint` 0 errors. Data and
  meta regenerated.

**[Residual Risks]**
- Flamewing's Shadow's two crit grants are scoped (`damageTypes [1]` Heavy and
  `[5]` Echo), so the tier still falls back to text — which credits a flat 20%
  on everything. That is now an OVER-credit relative to the data, and closing it
  needs per-hit crit, a real feature rather than a routing fix.
- Three sets (Eternal Radiance, Heart of Evil's Purge, and Song of Feathered
  Trace on a non-Chafe wielder) still contribute zero, gated by the pre-existing
  tier-level `canSatisfyCondition`. Correct for the wielders tested; not
  re-examined here.
- The amplify and DEF-ignore halves of the conditional lane are wired but
  UNEXERCISED — no sonata grant routes to them today, so those code paths have
  no live data behind them.
- The maintainer's broader findings (rotation steps, sequence nodes, damage and
  DPS figures across the roster) are DEFERRED by agreement and untouched here.

**[Updated Docs]** `CLAUDE.md` gains four invariants; the ~~`TriggerPreset[0]`
alone~~ claim is struck through with the correction beneath it.
