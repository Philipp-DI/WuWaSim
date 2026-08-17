# The game's own ConfigDB — what it holds, and what we were approximating

**Written 2026-08-01**, after the maintainer pointed at a full FModel client
export and asked for a proper cross-check. Short version: **the four
`data/bindata/*.json` dumps we had been reasoning from are four tables out of
about five hundred**, and several things the sim derives by regex over kit text
are shipped by the game as typed columns.

The pre-existing dumps are not wrong — every value cross-checked here agreed
with them. They are just a small, differently-named slice.

---

## How to read any of it

```bash
python tools/extract/configdb.py <fmodel-export-root> Buff      # field/offset summary
```

`Content/Aki/ConfigDB/db_*.db` are SQLite files, each with one `(Id, BinData)`
table whose blob is FlatBuffers. The schema does **not** have to be guessed:
the client also ships `Content/Aki/JavaScript/Core/Define/Config/*.js`, one
accessor per table, and each accessor spells out every field's vtable offset,
read type and default:

```js
stacklimitcount(){var t=this.J7.__offset(this.z7,42);return t?this.J7.readInt32(this.z7+t):1}
```

`tools/extract/configdb.py` parses those accessors and decodes the blobs, so a
table is readable by name with correctly-typed, correctly-named fields. 499
databases, 1,688 accessors.

The export is multi-GB and machine-local, so — exactly like `data/bindata/` —
extractors commit their **output** and the pipeline never depends on the export
being present.

---

## Tables that answer questions we currently answer with a regex

| Table | Accessor | What it settles |
| --- | --- | --- |
| `db_buff` (24,777 rows) | `Buff` | **`StackLimitCount`** — the authoritative stack cap per buff (1,452 buffs stack past 1). Also `DefaultStackCount`, `StackingType`, `DurationMagnitude`, `Period`, `GameAttributeID` + `ModifierMagnitude` (what it changes, by how much), `GrantedTags` |
| `db_AbnormalDamage` | `AbnormalDamageConfig` | The affliction LevelModifier for levels 1–100, per element. **Extracted — see below** |
| `db_resonate_chain` (336) | `ResonantChain` | Chain node → **`BuffIds`**, the structural link from S1–S6 to what they actually grant |
| `db_PassiveSkill` | `PassiveSkill` | `TriggerType`, `TriggerParams`, `TriggerFormula`, `SkillAction`, `SkillActionParams` — the structured form of the "gain trigger" `descStackGain` recovers from prose |
| `db_skill` | `Skill` | The full skill table (our `bindata/skill.json` is a slice of it) |
| `db_condition` | `Condition` / `ConditionGroup` | The gating model behind "while in X state" |

## What was actually verified

- **`AbnormalDamageConfig` confirms our reverse-engineered constant exactly.**
  `enemy-status.js` had `glacio_chafe: 3674`, derived from three worked examples
  at level 90. The game's table reads **3674 at level 90** — and supplies the
  whole curve, 11 at level 1 to 4082 at level 100. It is **identical across all
  six elements at every level**, which converts that file's "ASSUMED to also
  hold for other inflicters until disproven" caveat into a confirmed fact.
  → Extracted to `data/abnormal-damage.json`, wired through the dataset, and the
  engine is now level-correct instead of level-90-only. Level 90 is unchanged to
  the last decimal, so no committed number moved.

- **Changli's Enflamement cap of 4 is confirmed twice over.** Beyond
  `SpecialEnergy1Max = 4`, the buff table models it as four discrete stack tags
  (`心火1层` … `心火4层`, "heart fire" = Enflamement).

- **Gauge income for named stack gauges is genuinely absent from the four
  dumps** — that earlier conclusion holds, and now has a cause: it lives in
  `db_buff`, which was never among them.

## The chain → buff → effect walk (resolved 2026-08-01)

A resonance chain is a **skill tree**: once a node is unlocked its description is
permanently in effect. So the buff a node points at is not a marker — it *is*
the effect, held forever, and it reaches the working buff through
`ExtraEffectParameters`. Jinhsi S3 walks `1304900300` → `1304900302`:

```
GameAttributeID 7 (Proto_Atk)   ModifierMagnitude 2500 (= 25%)
StackLimitCount 2               DurationMagnitude 20.0s
ApplicationTagRequirements ['角色.R2T1JinxiMd10011.共鸣.共鸣3']
```

That is the stat, the per-stack value, the cap and the duration — every number
our parser derives from prose — gated on the S3 tag the node itself grants.

**Coverage: 4 of 8 stackable chain effects resolve exactly**, agreeing with the
parser on every field (Youhu S6, Encore S1, Encore S6, Jinhsi S3). 92 of 330
roster chain nodes reach at least one stat-modifying buff. The rest express
themselves as DMG-multiplier changes or `SkillAction` scripts, so this is a
**validation layer**, not yet a parser replacement — which is why the kit-text
regexes stay.

`GameAttributeID` is the same enum as our `propId` space
(`Content/.../Net/Protocol.js`): 7 = Atk, 8/9 = Crit/CritDamage, 11 = EnergyEfficiency,
**22–27 = DamageChangeElement1..6**, independently confirming the CLAUDE.md
element-node mapping.

## Known open leads (status as of 2026-08-17)

- ~~**Negative-status stack-limit raises.**~~ **CLOSED 2026-08-01** —
  `STATUS_CAP_RAISES`, both trigger shapes live (OPEN-ITEMS #25). The base caps
  were correct all along.
- ~~**Gauge INCOME for named stack gauges.**~~ **CLOSED for the CAST lane
  2026-08-12** — `data/gauge-income.json` (`extract_gauge_income.py`) walks
  `DT_SkillInfo` → `SkillBuff`/`SkillStartBuff`/`SkillEndBuff` → `db_buff`, 59
  resonator entries; Denia's three gauges reproduce her kit exactly. STILL OPEN:
  income earned on a HIT, which lives in `db_PassiveSkill` (`DamageTrigger`)
  behind ExtraEffect chains — extracted, not wired, because
  `rotation-resources.js` is per-cast by construction.
- ~~**`db_PassiveSkill`'s `TriggerType`/`SkillAction`.**~~ **READ 2026-08-13**,
  by the external-buff extraction (`extract_external_buffs.py`:
  `ExtraEffectID 35 AddPassiveSkill` → `SkillActionParams`, plus
  `TriggerType`/`TriggerPreset`/`InstigatorType` for a weapon's trigger and
  recipient). STILL OPEN as the structured form of the kit-text stack GAIN
  trigger `descStackGain` recovers from prose.
- **The chain walk is still a validation layer, not a parser replacement.** The
  4-of-8 / 92-of-330 coverage above is unchanged, which is why the kit-text
  stack-cap and gain-trigger regexes stay. This is what remains of OPEN-ITEMS
  #26.
- **Tag hashing.** Older content carries readable Chinese tags
  (`角色.…buff相关.心火1层`); newer content is hashed
  (`角色.dc4175dc.9d45e28b.…`), so name-matching alone will not cover the
  roster. The id-prefix convention (buff id starts with the resonator id) does.

## What the ConfigDB now supplies (added 2026-08-17)

One committed extract per lane, none of them depending on the export being
present at build time:

| Extract | Lane |
| --- | --- |
| `data/abnormal-damage.json` | the affliction LevelModifier curve, levels 1–100 |
| `data/buff-facts.json` | a buff value's BUCKET — **primary**, text is the fallback |
| `data/status-damage.json` | the six negative statuses' own per-stack tables |
| `data/status-appliers.json` | which buffs apply a status (bounds the derived counts) |
| `data/gauge-income.json` | per-CAST gauge income |
| `data/external-buffs.json` | weapon / sonata / echo grants, by attribute id |
