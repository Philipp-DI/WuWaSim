# Facts Module — Wuthering Waves (WuWa Sim)

Everything the audit pipeline in `SKILL.md` needs to know about this repo and
this game. **Never guess a fact this file supplies.**

---

## 1. Where things live

### Compiled dataset — `data/wuwa-data.json` (200k+ lines: grep, never read whole)

| Field | What |
|---|---|
| `resonators[]` | id, name, element, weaponType, `roles`, `resonanceModes`, `specialEnergyCaps`, `inherentSkills[]`, `resonanceChain[]`, `skillNodeEffects[]`, `outroBuffs[]`, `tuneBreak`, `statNodeBonuses`, `skillTreeBonuses` |
| `autoSkillMap[id][key]` | the canonical ability keys — `label`, `skillType`, `formulaType`, `damageIds`, `energyGen`, `concertoGen`, `cooldown`, `stepDuration`, `desc` |
| `damageTable[id][]` | `{ id, element, type, relatedProp, mults[20] }` — the real per-hit rates, indexed by skill level |
| `statusApplyRules`, `statusDamage`, `afflictionDamage`, `abnormalDamage` | negative-status lanes |
| `chainExtraHits` | chain-added damage instances (KIT_VERIFIED only) |

### Runtime overlay — `data/patch.json`

**Applied at RUNTIME by `applyPatch` (`src/data/loader.js`), never baked into
`wuwa-data.json`.** A harness that loads the dataset without it silently drops
curated `offFieldActions`. The audit harness applies it; anything you write
must too.

### Hand-edited inputs

`reference-rotations.json` · `effect-overrides.json` · `patch.json` are the only
hand-edited files (see `.claude/rules/data-pipeline.md`).
`benchmark-reference.json` holds captured external measurements, written by
`tools/benchmark-gap.mjs`. Everything else under `data/` is extractor or
preprocess output: change its source and regenerate. `timing-data.json` and
`bullet-timings.json` are gitignored.

### Engine

| Module | Owns |
|---|---|
| `src/core/sim.js` | `simulateRotation` — the solo/segment sim; resource + state timelines, trigger ledger |
| `src/core/team-sim.js` | `simulateTeamRotation` — passes, segments, outro/intro handoff, shared enemy, Tune Break |
| `src/core/skill.js` | `resolveSkill` — `multiplier = baseMult × (1 + multiplierUp)` |
| `src/core/buffs.js` | `unlockedEffects`, `effectsActiveAtStepDetailed`, `scaleEffect`, `resolveChainInherentContext` |
| `src/core/enemy-status.js` | negative statuses, DEF shred/ignore, cap raises, `EVENT_ORDER` |
| `src/core/rotation-rules.js` | `RESOURCE_DEFS`, `STATE_DEFS`, `STAGE_GRANTS`, rotation gates |
| `src/core/rotation-resources.js` | gauge levels, consumption, carried start levels |
| `src/core/off-field.js` | coordinated attacks / turrets / outro bursts |

### Pipeline

```
extracted-nanoka + curated inputs → tools/preprocess.mjs → data/wuwa-data.json
                                  → tools/optimize.mjs   → data/wuwa-meta.json
```

`npm run data` then `npm run meta`. **Never hand-edit a generated file.**

---

## 2. The three effect sources

Effects reach the sim from three namespaces, and an audit that checks only the
first two will miss real buffs:

| Key | Source | Note |
|---|---|---|
| `S{level}.{index}` | `resonanceChain[]` | FROZEN — addressed by `effect-overrides.json` and saved builds |
| `IH{node}.{index}` | `inherentSkills[]` | FROZEN, same reason |
| `SK{node}.{index}` | `skillNodeEffects[]` | a buff stated inside a Liberation/Skill/Forte node |

Any preprocess pass that changes an effect COUNT must run BEFORE the overrides,
or it renumbers keys out from under curated patches and saved builds.

---

## 3. Fidelity checklist

Ordered by how often each is actually wrong. For each: PASS / FAIL / N-A + evidence.

1. **Every step deals damage.** `damageIds` must resolve in `damageTable[id]`;
   `resolveSkill` returns null if none do, and the cast silently pays zero.
   *Trap:* `damageTable` is keyed by RESONATOR id and each value is an ARRAY —
   `damageTable[damageId]` is always undefined. Search the array.
2. **`formulaType` vs node `skillType`.** `multiplierUp` and cast triggers match
   the NODE type; DMG bonus/amplify match the FORMULA type. A Basic dealing
   converted Liberation damage is still a Basic CAST.
3. **No unscoped `multiplierUp`.** Unscoped it multiplies the whole kit and
   makes the character look BETTER — nothing about the output looks wrong.
   Guard: `tests/multiplier-scope.test.mjs`. The single exemption is a
   `stackTrigger.consumed` multiplier, which is scoped by arithmetic.
4. **Buff buckets come from `buff-facts.json`, not the sentence.** The game does
   not decide the bucket from wording — identical English lands in additive
   `dmgBonus` for one kit and multiplicative `amplify` for another.
   `multiplierUp` is never retargeted; it is the skill's own rate.
5. **Stack counts are derivable, or say they aren't.** Precedence: manual →
   resource gauge → castMatch → **1 stack + `stacksUnknown`**. NEVER
   `maxStacks`. A band gates (tested on the RAW count); `maxStacks` caps.
6. **Gauges.** Cap from `specialEnergyCaps`; cast-lane income from
   `gauge-income.json`; a curated `gains` entry should be cross-checked against
   it. On-hit income is NOT in the cast lane and stays curated.
7. **Scope clauses.** A clause naming skills is scoped by the NAMES, and the
   binding covers every stat. A bare CATEGORY is not a name. The scoping pass
   must read the FULL clause — `effect.condition` is truncated to 120 chars for
   DISPLAY, and 32 clauses are longer.
8. **A leading TRIGGER is not a SCOPE.** "After casting Intro Skill X, DMG is
   increased by 20%" is not an Intro-only buff.
9. **Negative statuses.** Cap/lifetime/tick/multiplier come from
   `status-damage.json`. Status damage does NOT crit; a kit granting it fixed
   crit values sets `afflictionCritRate`/`afflictionCritDmg`, which must never
   reach the wielder's own crit. Base caps are BASE — kits raise them.
10. **Application is a NAMED cast.** Not every damaging step inflicts;
    `statusApplyRules` says which, gated by the stage and skill the clause
    names. Four clause shapes mention a status without applying one:
    negations, conversions, cap raises, and a teammate's infliction.
11. **Outro.** An Outro has NO level curve, so its multiplier is read from the
    sentence stating it. A mode-gated outro is a MENU — branches carry their own
    value AND duration. A resonator whose off-field actions carry an `outro`
    trigger must not also cast one.
12. **Chain extra hits** ship only from `KIT_VERIFIED`; most chain-marked
    bullets REPLACE a hit rather than add one.
13. **Labels and provenance.** A row's own name wins the label; provenance is a
    TRAILING `· Forte Circuit` / `· Echo` marker.
14. **Timing.** `stepDuration` from `actionable-times.json`; freeze is credited
    per-ANIMATION via `freezeSource`.
15. **Energy / Concerto.** `energyGen`/`concertoGen` per cast; Concerto caps at
    100 and drives the swap handoff.

---

## 4. Extraction toolbox (the game's own tables)

Export root: `G:/Software/fmodel/Output/Exports/Client` (FModel export holding
`Content/`). Tools in `tools/extract/`.

### ConfigDB — ~500 SQLite tables, read with the client's own accessors

```python
import sys; sys.path.insert(0, 'tools/extract')
from configdb import ConfigDB
db = ConfigDB(r'G:/Software/fmodel/Output/Exports/Client')
for row in db.read('db_buff', 'Buff'):
    ...   # Id is a FLOAT — use int(row['Id'])
```

`python tools/extract/configdb.py <root> <Accessor>` prints a table's schema.

| Table | Accessor | What it answers |
|---|---|---|
| `db_buff` | `Buff` | attribute, magnitude, stack limit, duration, ExtraEffect scope |
| `db_PassiveSkill` | `PassiveSkill` | which EVENT adds which buff (`TriggerType`, `SkillAction: AddBuff`, `SkillActionParams`, `CDTime`) |

### DataTables — `DT_SkillInfo`, one per character

```python
from ue_tagged import parse_datatable
pkg, obj, n, rows, end = parse_datatable(path_uasset, path_uexp)
```

Rows ARE the casts. `SkillBuff` / `SkillStartBuff` / `SkillEndBuff` hold buff
ids → the **cast→buff link**. Row id's leading 4 digits are the resonator id —
folder names are internal codenames and must never be trusted. Handles name-map
skew via `repair_vocabulary` (pass the field names of tables that parsed).

*Note:* `ue_asset.Asset.read_export(0)` reads only an export's tagged
properties and returns ~40 bytes for a DataTable. Use `parse_datatable`.

### Attribute enum

`Aki.Protocol.Vks` in `Content/Aki/JavaScript/Core/Define/Net/Protocol.js`
(144 entries) — the authority. **Do not derive it from `BaseProperty.js` getter
order.** Landmarks: `15 Proto_DamageChange`, `59–68` Energy/SpecialEnergy
channels, `99 Proto_IgnoreDefRate`.

### Magnitude semantics — `CalculationPolicy`

From `ActiveBuff.ModifyStateAttribute` in the shipped client JS:

| policy | meaning |
|---|---|
| 0 | flat add of `ModifierMagnitude` |
| 1 | scale base by `(V1/10000 + 1)` — `-10000` ⇒ zeroed |
| 2 / 4 / 9 | add a fraction of the attribute named in `CalculationPolicy[1]` |
| 3 | override to `V1` — `0` ⇒ zeroed |
| 5 / 6 | per-duration |

`10000` = 100.00%. Draining a gauge by its own size is a flat `add` of `-cap`,
NOT a `spendAll` shape — a reader that looks only for `spendAll` misses half the
roster's spends.

### Scope stated as data — `ExtraEffect*`

`ExtraEffectReqPara` is indexed **by the requirement**, not by the buff — the
client loops requirements and reads `RequirementPara[index]`. Reading `para[0]`
unconditionally mis-reads buffs whose skill list sits at index 1.
`ExtraEffectReqSetting`: **0 = ALL** (two scope lists INTERSECT), **1 = ANY**
(they UNION — and under ANY a non-scope requirement lets the effect fire
outside the list, so the list is not a scope).
Requirement type 1 = SkillIds, type 5 = BulletIds. A skill id is a PREFIX of a
damage id; a bullet id is not — it joins through `bullet-timings.json`.

### Joins

- skill key → damage instance ids: `hit-map.json` (`matchRowHits` output).
- damage id → animation: bullet chain (`bullet-timings.json`), else longest
  prefix match against `DT_SkillInfo` row ids (coarser — rows are shared).
- **`DT_SkillInfo` row ids and damage ids are DIFFERENT id spaces** for
  E/Q/Intro. Do not assume a prefix join works.

### Existing extractors

`extract_gauge_income.py` · `extract_buff_facts.py` · `extract_status_damage.py`
· `extract_status_appliers.py` · `extract_extra_effects.py` ·
`extract_affliction_damage.py` · `extract_timings.py` · `reconcile_effects.py`

Blueprints (`GA_*`) are compiled K2 bytecode — name tables only, no buff ids.
Do not sink time into them; the DataTable and ConfigDB paths carry the data.

---

## 5. Team-only failure modes

Correct solo, silently wrong in a team. Check each explicitly.

1. **Cross-segment gauge carry.** A turn is SEVERAL `simulateRotation` calls —
   the auto-injected Intro is its own segment. A gauge earned on Intro and spent
   in the rotation reads empty unless carried (`carryInResources` /
   `resourceEndLevels` / `sim.memberResources`).
2. **The intro segment does not write `sim.memberFires`** — a known gap that
   blocks ~16 effects across 12 characters.
3. **One enemy, shared.** `team-sim.js` must read `totals.skillDamage` per
   segment; the shared timeline owns the negative-status lane. Reading
   `totals.damage` there double-counts.
4. **Tune Break is ONE per pass for the whole team** — the Off-Tune bar is the
   target's. The surplus is REMOVED, not zeroed.
5. **Team-buff paths are disjoint** — three exist; a buff flows through exactly
   one. Adding a source means picking a path, never duplicating.
6. **The outro handoff is mode-filtered** against the OUTGOING member's mode.
7. **Member order matters**, and pass 1 differs from steady state.

---

## 6. Reading the numbers

- **DPS denominator is `gameTime`** (`totalTime − totalFreeze`), never wall
  clock. Getting this wrong reported a 3.09x gap against a 1.8x damage gap once.
- **Team totals come from `memberTotals`**, not from summing segments.
- **Per-pass figures are MARGINALS** (N-pass minus (N−1)-pass) so the post-hoc
  status lane is attributed rather than dropped.
- **Targets:** every UI surface and the optimizer sim against `DEFAULT_TARGET`
  (`src/core/target.js`). `tools/benchmark-gap.mjs` defaults to
  `TARGET_REFERENCE`, the external reference's own stated conditions;
  `--app-target` and `--zero-res` switch to the app target or the retired
  0%-RES dummy. Say which you used.
- `__echo__` deals 0 in 0 time without `--real-echoes` — by design.
- Build quality is a real axis: real echoes and co-optimized substats moved the
  captured benchmark by a large fraction of its whole gap. A gap measured on
  template stats is not a modelling gap until you have controlled for it.

---

## 7. Failure signatures → likely cause

| Symptom | Look at |
|---|---|
| One step deals 0 | `damageIds` not in `damageTable[id]`; empty `level` map (outro-style); key never matched a display row |
| Character is understated across the board | a whole lane missing: off-field actions, negative status, outro, chain extra hits |
| Character is overstated | unscoped `multiplierUp`; a bucket that should be additive modelled as multiplicative; a chain bullet added that REPLACES; affliction crit leaking into wielder crit |
| An effect resolves OFF | trigger never fires (`castMatch` reads strictly earlier steps under `persist`); mode gate; state never entered; scope bound to nothing |
| Effect fires everywhere | unscoped, or scope resolved from the wrong clause (truncated `condition`) |
| Stack count is 1 with `stacksUnknown` | no gauge defined / trigger unresolvable — expected, but verify it is not derivable |
| Solo right, team wrong | §5 |
| Gauge always empty in team | cross-segment carry (§5.1) |
| Team member receives nothing | wrong team-buff path, or `selfApplicable` |
| Numbers moved after a rebase | `git checkout -- data/wuwa-data.json` reverts to HEAD and DESTROYS uncommitted preprocess output. Regenerate with `npm run data`. |

---

## 8. Rules of engagement

- **Never hand-edit generated files** (`wuwa-data.json`, `wuwa-meta.json`,
  `data-version.json`, `hit-map.json`). Change the source, regenerate.
- **Never ship an unscoped `multiplierUp`.** Drop and COUNT it instead; the
  dropped set is a contract that may only shrink.
- **No per-effect overrides when a principled derivation exists.** Everything
  should acknowledge its source.
- **Underivable = 1 stack, and say so.** Never fall back to `maxStacks`.
- **A correct zero must be shown with a reason**, never silently filtered.
- **Resonator abilities always hit** — no miss/range/accuracy model, and enemy
  attacks are not modelled (`CLAUDE.md`, "Abilities always hit"). "on hit" /
  "nearby" are firing conditions that are always satisfied.
- **Rover is FEMALE** (`FemaleM/*Nvzhu`) throughout.
- Verification: `npm test` · `npm run sweep` · `npm run lint` (0 errors), then
  LOCK A (`npm run data`) and LOCK B (`npm run meta`) compared field-by-field
  against a pre-run snapshot — only `generatedAt` may differ for a
  behaviour-preserving change. `engineHash` moves when any ENGINE_FILES member
  changes; keep the lists in `tools/optimize.mjs` and
  `tests/meta-schema.test.mjs` in sync.
- Every new public function in `src/core/` gets a test; prefer live tests over
  fixtures.
- Write a session summary to `docs/history/YYYY-MM-DD-<topic>.md`
  (`[Files Changed]`, `[Logic Altered]`, `[Verification Method]`,
  `[Residual Risks]`, `[Updated Docs]`). Record an invariant you establish or
  falsify in the matching `.claude/rules/invariants-*.md` file (`CLAUDE.md`
  only if cross-cutting) — strikethrough, never deletion.
