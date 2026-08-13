# RESONATOR ROSTER — id, codename, curation status

Derived from the shipped data, not hand-maintained. Names and curation signals
come from `data/wuwa-data.json` plus the curated tables; the **Name in the Data
Extract** column is derived from the game files by parsing every Role
`DT_SkillInfo` and keying each table by the resonator id that owns most of its
rows.

**Folder names are never trusted for identity** — a `DT_SkillInfo` row id's
leading 4 digits ARE the resonator id (`tools/extract/extract_timings.py`
documents the rule). See `docs/GLOSSARY.md` § "Game-data vocabulary" for what
these internal names mean.

Related, and deliberately not duplicated here:
`docs/COMBO-ENTRY-CURATION.md` owns per-character **combo-entry** coverage
(basic-chain entry mechanics that are in neither the kit text nor the data);
`docs/OPEN-ITEMS.md` owns the backlog. This table is the roster INDEX — id,
codename, and how much hand-authored modelling each carries.

---

## How to read the columns

**Name in the Data Extract** — the internal Role folder, `<RoleBody>/<codename>`.
Westernised from Chinese and matching no display name (Denia → `Daniya`,
Camellya → `Chun`, Chisa → `Qianxia`). A `+` joins a second COMBAT table
(Aemeath's mech form, Cartethyia's Fleurdelys form). `(+ _FP)` marks a
non-combat variant folder that exists but is deliberately NOT indexed.

**Curation Status** — how much hand-authored modelling a resonator carries
beyond the automatic pipeline. Derived, not judged:

| Status | Means |
| --- | --- |
| **Curated** | ≥ 2 curated mechanics (rules / states / gauge / grants / swap-in / patch / effect overrides) |
| **Curated · gaps** | curated, AND carries a recorded open item — a deferred override or a dropped clause |
| **Light** | exactly one curated mechanic |
| **Extracted** | reference rotation only; everything else is pipeline output |
| **Unrotated** | no reference rotation — the optimizer and every harness fall back |

A high status is not a quality score. It measures how much the automatic
pipeline could NOT do alone, so "Extracted" often just means the kit is simple.

**Notes** — the signals themselves, so the status is auditable:

`rot` reference rotation · `rules` `ROTATION_RULES` · `states` `STATE_DEFS` ·
`gauge` `RESOURCE_DEFS` · `grants` `STAGE_GRANTS` · `swap-in` `SWAP_IN_ENTRY` ·
`patch` `data/patch.json` · `over:N` effect overrides · `deferred:N` recorded
deferrals · `off-field` `offFieldActions` · `modes` Resonance Modes ·
`SK:N` skill-node effect nodes · `status` negative-status apply rules.

---

## The roster (56 shipped)

| ID | English Name | Name in the Data Extract | Curation Status | Notes |
| --- | --- | --- | --- | --- |
| 1102 | Sanhua | `FemaleM/Sanhua` | Curated · gaps | rot · over:1 · deferred:1 |
| 1103 | Baizhi | `FemaleXL/BaiLian` | Extracted | rot |
| 1104 | Lingyang | `MaleS/Lingyang` | Curated | rot · states · over:2 · SK:1 |
| 1105 | Zhezhi | `FemaleM/Zhezhi` | Extracted | rot · off-field · SK:1 |
| 1106 | Youhu | `FemaleS/Youhu` | Extracted | rot |
| 1107 | Carlotta | `FemaleMS/Kmola` | Curated | rot · rules · states · over:1 · SK:1 |
| 1108 | Hiyuki | `FemaleXL/TaiDaoNv` | Curated · gaps | rot · rules · states · grants · over:3 · deferred:4 · status |
| 1109 | Lucilla | `FemaleXL/Luosela` | Curated | rot · states · grants · over:2 · modes · SK:2 · status — name-map skew in her `DT_SkillInfo`; `repair_vocabulary` recovers it |
| 1110 | Suisui | `FemaleM/Suisui` | Light | rot · grants · status |
| 1202 | Chixia | `FemaleM/Maxiaofang` | Extracted | rot — short DT row ids (`120201`), needs the short-id regex |
| 1203 | Encore | `FemaleS/Anke` | Light | rot · over:1 |
| 1204 | Mortefi | `MaleXL/Baer` | Curated | rot · states · over:1 · off-field |
| 1205 | Changli | `FemaleXL/ChangLi` | Curated · gaps | rot · rules · gauge · over:2 · deferred:2 · SK:1 — Enflamement is earned ON HIT, so it stays curated (not in the cast lane) |
| 1206 | Brant | `MaleXL/Bulante` | Curated | rot · states · grants |
| 1207 | Lupa | `FemaleM/Lupa` | Curated · gaps | rot · grants · SK:2 — dropped clause: +50% to marked targets, bucket undecided |
| 1208 | Galbrena | `FemaleXL/Jiabeilina` (+ `_FP`) | Light | rot · grants · off-field · SK:2 |
| 1209 | Mornye | `FemaleMS/Mone` | Curated · gaps | rot · grants · SK:1 — dropped clause: ER-breakpoint tiers (`1209400003-008`) |
| 1210 | Aemeath | `FemaleM/Aimisi + FemaleZ2/AimisiGD` | Curated · gaps | rot · states · grants · over:2 · modes · SK:1 — two combat tables; mech basics are filed under her Resonance Skill node |
| 1211 | Denia | `FemaleMS/Daniya` | Curated · gaps | rot · states · gauge · grants · patch · deferred:1 · modes · SK:3 — three gauges; Dark Core cap + income are game-read |
| 1301 | Calcharo | `MaleXL/Kakaluo` | Curated | rot · states · over:1 · off-field |
| 1302 | Yinlin | `FemaleM/YinLin` | Curated | rot · grants · swap-in · over:1 · off-field |
| 1303 | Yuanwu | `MaleXL/Yuanwu` | Extracted | rot · off-field |
| 1304 | Jinhsi | `FemaleM/Jinxi` | Curated | rot · rules · states · over:1 |
| 1305 | Xiangli Yao | `MaleM/Xiangliyao` | Extracted | rot |
| 1306 | Augusta | `FemaleXL/Aogusita` | Curated | rot · grants · over:1 |
| 1307 | Buling | `FemaleMS/Buling` | Light | rot · grants · SK:1 |
| 1308 | Rebecca | `FemaleMS/Rebecca` | Light | rot · grants · SK:1 |
| 1309 | Rover: Electro | `MaleM/ThunderNanzhu` (+ `_FP`) | **Unrotated** | states — the only shipped resonator with NO reference rotation |
| 1402 | Yangyang | `FemaleM/Yangyang` | Curated | rot · swap-in · over:1 |
| 1403 | Aalto | `MaleXL/Qiushui` | Extracted | rot |
| 1404 | Jiyan | `MaleXL/Jiyan` | Extracted | rot · SK:1 |
| 1405 | Jianxin | `FemaleM/Jianxin` | Extracted | rot |
| 1406 | Rover: Aero | `MaleM/WindNanzhu` | Light | rot · grants · status |
| 1407 | Ciaccona | `FemaleM/Xiakong` | Curated | rot · states · grants · patch · SK:1 · status |
| 1409 | Cartethyia | `FemaleMS/Katixiya + FemaleZ/Fuludelisi` | Light | rot · grants · SK:1 · status — second Role folder is her Fleurdelys form |
| 1410 | Iuno | `FemaleM/Younuo` | Light | rot · grants · SK:1 |
| 1411 | Qiuyuan | `MaleXL/Qiuyuan` | Light | rot · grants · SK:3 |
| 1412 | Sigrika | `FemaleMS/Xigelika` | Curated | rot · gauge · grants · SK:1 — Full Stop is `SpecialEnergy2`, cap 100, confirmed against the game |
| 1501 | Rover: Spectro | `MaleM/Nanzhu` | Extracted | rot |
| 1503 | Verina | `FemaleS/Jueyuan` | Light | rot · swap-in · off-field |
| 1504 | Lumi | `FemaleMS/Dengdeng` | Light | rot · over:1 |
| 1505 | Shorekeeper | `FemaleM/Shouanren` | Light | rot · grants · SK:1 |
| 1506 | Phoebe | `FemaleMS/Feibi` | Curated · gaps | rot · rules · states · over:6 · deferred:1 · SK:3 — most-overridden resonator in the roster |
| 1507 | Zani | `FemaleXL/Zanni` | Light | rot · grants · SK:2 |
| 1508 | Chisa | `FemaleM/Qianxia` | Light | rot · grants · SK:1 — Thread of Bane DEF ignore lives in `DEF_IGNORE_GRANTS`, not the effect tables |
| 1509 | Lynae | `FemaleM/LinNai` | Curated · gaps | rot · grants · deferred:1 · modes — Lumiflow is a continuous timer gauge, out of the per-cast model |
| 1510 | Luuk Herssen | `MaleXL/Luhesi` | Curated | rot · grants · over:1 · SK:2 · status |
| 1511 | Lucy | `FemaleM/Lucy` | Light | rot · grants · SK:3 |
| 1601 | Taoqi | `FemaleM/Taohua` | Extracted | rot |
| 1602 | Danjin | `FemaleM/Micai` | Curated · gaps | rot · grants — dropped clause: game files it as `DamageChange` (attr 15, buff `1602201011`), wants a rebucket |
| 1603 | Camellya | `FemaleM/Chun` | Curated · gaps | rot · states · swap-in · over:1 · SK:1 — Crimson Bud is a resource fed by a resource; no income in either extractable lane |
| 1604 | Rover: Havoc | `FemaleM/DarkNvzhu` | Extracted | rot · off-field |
| 1606 | Roccia | `FemaleS/Luokeke` | Curated | rot · grants · swap-in · SK:1 |
| 1607 | Cantarella | `FemaleXL/Kanteleila` | Curated · gaps | rot · rules · states · grants · over:1 · deferred:1 · off-field |
| 1608 | Phrolova | `FemaleM/Fuluoluo` | Curated | rot · states · grants · patch · over:1 · SK:1 |
| 1610 | Yangyang: Xuanling | `FemaleM/Xuanling` | Light | rot · over:2 · SK:2 |

**Tally:** Curated 15 · Curated · gaps 12 · Light 16 · Extracted 12 · Unrotated 1.

---

## Ids in the game files but not in the dataset

Four parse out of the Role tree with no dataset entry:

| Id | Folder |
| --- | --- |
| 1310 | `FemaleM/ThunderNvzhu` |
| 1408 | `FemaleM/WindNvzhu` |
| 1502 | `FemaleM/Nvzhu` |
| 1605 | `MaleM/DarkNanzhu` |

These are the **opposite-gender Rover builds**. The game ships a male and a
female build of every element Rover under separate ids AND separate asset
folders; the dataset carries exactly one entry per element. The id chosen is not
consistently one gender — Electro / Aero / Spectro sit on the male id
(`1309` / `1406` / `1501`), Havoc on the female (`1604`).

That is an ID assignment, **not** an asset choice. The two builds apply the SAME
damage ids from separate bullet blocks, so both are candidates when joining
timings, and the project pins timing extraction to the **female** assets
throughout (maintainer call, 2026-07-29 — 40 keys had silently landed on male).
See `MALE_ROVER` in `tools/extract/map-timings.mjs`.

---

## Roster-level gaps

- **Rover: Electro (1309) has no reference rotation** — the only shipped
  resonator without one. Every harness and the offline optimizer fall back.
- The **dropped-clause contract** (`tests/skill-node-effects.test.mjs`) stands at
  **6** unscopable skill-node `multiplierUp` clauses across 5 resonators:
  Aemeath ×2, Danjin, Mornye, Camellya, Lupa. That list may shrink, never grow
  quietly.
- **7 deferred effect overrides** across Sanhua, Hiyuki, Changli, Denia, Phoebe,
  Lynae and Cantarella (`data/effect-overrides.json` → `deferred`), each with its
  own recorded reason.
