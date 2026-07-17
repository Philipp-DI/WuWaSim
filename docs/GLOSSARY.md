# GLOSSARY — what the words mean

Two vocabularies collide in this codebase: Wuthering Waves game terms and
project-invented terms. The second table is the one you cannot google.
Naming rule (CLAUDE.md, Code Style): one concept, one name — the names below
are the canonical ones; code should not introduce synonyms or abbreviations
for them.

---

## Game terms (Wuthering Waves)

| Term | Meaning |
| --- | --- |
| **Resonator** | A playable character. The roster has ~56; a build configures exactly one. |
| **Element** | One of six damage elements: Glacio (1), Fusion (2), Electro (3), Aero (4), Spectro (5), Havoc (6). The `elementId` numbering is load-bearing (invariant). |
| **Basic / Heavy Attack** | Normal attack string (staged: Basic 1→2→3…) / charged attack. |
| **Resonance Skill** | The "E" ability. |
| **Resonance Liberation** | The ultimate. Costs **Resonance Energy**. |
| **Intro / Outro Skill** | Cast automatically when a resonator swaps IN (Intro, requires full Concerto) / swaps OUT (Outro). Outros often buff the incoming resonator. |
| **Forte Circuit** | A resonator's unique gauge mechanic; "forte" skills consume/build the **Forte gauge**. |
| **Resonance Energy / ER** | The Liberation resource; **Energy Regen** (ER) scales how fast every gain fills it. |
| **Concerto Energy** | The swap resource (gauge cap 100). Full gauge → Outro→Intro handoff fires on swap. |
| **Resonance Chain (S1–S6)** | Duplicate-unlocked upgrade nodes ("constellations"). Each level can carry passive effects. |
| **Inherent Skill** | A resonator's unlockable passive talents (IH nodes). |
| **Echo** | Equippable gear (5 slots) with a main stat, substats, and — for the slot-0 echo — a castable **Echo Skill**. |
| **Sonata (set)** | Echo set bonus family (2pc/3pc/5pc tiers). "Set" and "sonata" are the same thing. |
| **Negative Status / Bane** | Debuffs living on the ENEMY (e.g. Havoc Bane) — shared by the whole team; many kit effects gate on them. |
| **Coordinated Attack** | Damage a benched (off-field) resonator contributes while someone else is active. |
| **Amplify / Deepen** | Separate multiplicative damage buckets on top of the additive DMG-bonus bucket (see formula.js header). |
| **STA** | Stamina — cost rows in the data that look numeric but are NOT damage (a known matching trap). |

---

## Project terms (invented here — the canonical names)

### Data & pipeline

| Term | Meaning |
| --- | --- |
| **dataset** | The parsed `wuwa-data.json` object every sim function receives. Generated — never hand-edited. |
| **nanoka source** | Raw per-character JSON dumps from nanoka.cc under `data/extracted-nanoka/`. |
| **curated data** | Human-authored inputs the pipeline folds in (`patch.json`, `skill-map.json`, `reference-rotations.json`, `effect-overrides.json`, the `rotation-rules.js` tables). See ARCHITECTURE.md §7. |
| **the meta** | `wuwa-meta.json` — frozen optimizer output: substat weights, suggested builds, ranked teams. "Covered" characters have meta entries; others fall back to live sim. |
| **anchor** | The character a suggested team is built around; also the reference build a character's weights were derived at. |
| **engineHash / ENGINE_FILES** | The meta records a hash of the engine files it was computed with; the two ENGINE_FILES lists (optimize.mjs, meta-schema test) must stay in sync. |
| **LOCK A / LOCK B** | Refactor checks: regenerate `wuwa-data.json` / `wuwa-meta.json` and require a zero diff (CLAUDE.md, Test commands). |
| **display row vs damage instance** | One skill-panel line in the game (row) may bundle several raw hits (instances). `matchRowHits` maps rows to instances by full 20-level multiplier vectors. |
| **rate vector** | That 20-level multiplier array — the fingerprint used for row↔instance matching. |

### Build & rotation

| Term | Meaning |
| --- | --- |
| **build** | One resonator's full user configuration (level, weapon, echoes, skill levels, rotation, toggles). |
| **skill key** | The string identifying one castable ability (`'liberation'`, `'basic_3'`, `'forte_heavy'`, `'__echo__'`). Rotation steps are skill keys. |
| **skill map** | Per-resonator `skillKey → skill definition` table (curated `skillMap` first, auto-generated fallback; resolved by `effectiveSkillMap`). |
| **rotation** | Ordered list of skill keys. Persisted ONLY as this linear array; the graph view is sim-time-only (invariant). |
| **step** | One executed cast in a sim result: damage, timing, energy, active buffs. |
| **`skillType` (node)** | MECHANICAL kind of cast (what you pressed): basic/heavy/skill/liberation/intro/outro/forte_*. Drives cast triggers, multiplierUp matching, stage logic. |
| **`formulaType`** | DATA-DRIVEN damage categorization (which DMG-bonus bucket + skill-level key the hits use), read from the game's per-instance type tag. Carlotta's Liberation: `skillType 'liberation'`, `formulaType 'skill'`. Never conflate the two. |
| **grant** | A curated reason a rotation step is legal despite the generic stage heuristic ("chained from Intro Skill"); rendered as a ⤷ chip. Tables: `STAGE_GRANTS`, `SWAP_IN_ENTRY`, `RESOURCE_DEFS`. |
| **state** | A named character stance/mode tracked per step (`STATE_DEFS`, e.g. Denia's Stagecraft) — enters on a cast, exits by duration or a consuming cast; gates effects and off-field actions. |
| **cast time (fabricated)** | Per-skill animation seconds in `skill-map.json` — hand-approximated, NOT extracted from the game. Timing-sensitive conclusions inherit this caveat. |
| **effectToggles** | Build map of manually-assumed conditional effects; keys `S{level}.{index}` / `IH{node}.{index}` (invariant). Stackable effects store an integer stack count. |

### Buffs & effects

| Term | Meaning |
| --- | --- |
| **effect** | A chain/inherent passive parsed into structured form (stat, value, condition, trigger, window). |
| **trigger × window** | The activation model: a trigger fires (castMatch / stateEnter / modeMatch / healing), a window keeps it live (seconds / persist / stateBound / untilConsumed / always). |
| **(buff) window** | A time interval during which a buff is live, with per-step stack samples. "Windowed" = applied by literal step overlap. |
| **flat (approximation)** | The opposite: a buff credited at full value across a whole rotation/segment because its timing isn't derivable. Being progressively replaced by windows (TEAM-BUFF-TIMELINE-PLAN). |
| **stack ramp** | Stacking buffs climb 0→cap per qualifying step and decay — never applied at max flat (`buff-timeline.js`). |
| **team-wide** | A buff whose recipient is the whole team. Three disjoint application lanes — see ARCHITECTURE.md §4; picking the right lane is an invariant. |
| **incoming-resonator transfer** | Outro-granted buff targeting the NEXT resonator specifically (not team-wide); applied flat to the receiving segment. |
| **DMG-bonus bucket** | The additive `(1 + Σ bonuses)` term: element bonuses + `formulaType`-keyed skill-type bonuses. Distinct from amplify/deepen (each multiplicative). |

### Team sim

| Term | Meaning |
| --- | --- |
| **segment** | One contiguous block of one member's casts on the team timeline (auto-Intro, authored rotation, auto-Outro). |
| **pass** | One full cycle through all members. Ranking sims use 3 passes. |
| **team time** | The absolute time axis across all segments; buffs, cooldowns, and statuses live on it. |
| **teamBuffTimeline** | The chronological ledger of team-wide buff windows accrued while segments simulate; later segments receive overlapping windows (`externalBuffWindows`). |
| **opener / filler / gated** | Cold-start handling when `deriveOpeners` is on: filler = greedy energy-generating casts spliced before a Liberation that can't be paid; gated = the cast is dropped and reported when no filler can pay it. |
| **off-field share** | Benched members receive 50% of energy generated by others' casts (× their own ER). |
| **erOverride / minViableEr** | Per-team meta values: the ER at which the authored rotation loops clean (computed openers-OFF, deliberately). |
| **Concerto handoff** | The Outro→Intro exchange at a swap; modeled always, damage-gating opt-in (`enforceConcerto`). |
| **covered** | A character/config with real meta entries (weights, suggested build/teams); everything else falls back honestly to live sim or "no suggestion available". |
