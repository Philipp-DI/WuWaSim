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

## Known open leads (not yet chased)

- **Havoc Bane's max stacks.** `enemy-status.js` caps it at **3**, but Yangyang:
  Xuanling's own kit text describes a **4–6 stack** band, and `team-sim.js`
  clamps to the 3, making that entire branch unreachable. The two disagree
  regardless of the export; the buff table should settle which is right.
- **Chain node → buff → effect.** `ResonantChain.BuffIds` resolves, but the
  buffs it points at are unlock markers; the effect semantics sit one or more
  hops further (`RelatedExtraEffectBuffId`, `SkillAction`). Following that chain
  properly is what would let stack caps and triggers stop being parsed from
  prose at all.
- **Tag hashing.** Older content carries readable Chinese tags
  (`角色.…buff相关.心火1层`); newer content is hashed
  (`角色.dc4175dc.9d45e28b.…`), so name-matching alone will not cover the
  roster. The id-prefix convention (buff id starts with the resonator id) does.
