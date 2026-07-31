# Handover — Full-Roster Combat Timing Extraction

**Status:** pipeline built, verified byte-exact against Rebecca (resonator 1308).
**Goal:** point the runner at an FModel-exported asset tree and produce
`data/timing-data.json` covering every resonator.
**Supersedes:** the "measure `SequenceLength`" plan in `LANE-B-ASSET-EXTRACTION.md` §4
— see §3 below for why that number is a trap.

---

## 1. What this pipeline produces (and what it does NOT)

Extracted per skill, from the game's own animation assets:

| Field | Meaning | Source |
|---|---|---|
| `hit_times_s[]` | every bullet spawn in the montage — **montage-wide, NOT one key's damage**; use `damageAt` from map-timings.mjs for that | `TsAnimNotifyReSkillEvent` |
| `actionable_at_s` | when the next attack can be **queued** (not when the player is free — swaps/dodges are not gated by it) | `TsAnimNotifyStateNextAtt` |
| `skill_end_s` | when the skill formally terminates | `TsAnimNotifyEndSkill` |
| `freeze_total_s` | union of BOTH time-stop notifies — provenance only | `*AbsoluteTimeStop` + `*TimeStopRequest` |
| `freeze_combat_clock_s` | the freeze that actually pauses timer/cooldowns/buffs — **this is `freezeTime`** | `TsAnimNotifyStateTimeStopRequest` only (see §10) |
| `cooldown_s`, `genre`, `next_skill_id` | already in your dataset; re-extracted for joining | `DT_SkillInfo` |

**Not covered:** Tune Break freeze. No notify in any montage examined relates to
it, so it is not per-character animation data — it lives in the Tune Break
mechanic's own assets or a global combat config. Treat as a separate hunt.

---

## 2. Prerequisites

- Python 3, no third-party packages.
- An FModel export tree containing, for each character, `DT_SkillInfo` and the
  `AM_*` montages. **Both `.uasset` and `.uexp` are required for every asset** —
  a `.uasset` alone is a header with no payload and will be reported as an error.
- No `.usmap` needed. These assets use classic tagged serialization, which is
  self-describing (every property declares its own byte size). This is why the
  mappings blocker in `LANE-B-ASSET-EXTRACTION.md` §2.4 does not apply here.

---

## 3. The `SequenceLength` trap — read before trusting any number

`AM_Attack01_S` reports **`SequenceLength = 5.833s`**. The skill actually ends at
**0.628s**; the remaining ~5.2s is idle-return padding (there is a literal
`TsAnimNotifyFightStand` notify at t=5.6). Using `SequenceLength` as cast time
would over-count that basic attack by roughly **9×**, and would systematically
inflate every rotation.

**Rule: never use `sequence_length_s` as a duration.** Use `actionable_at_s`
(when the player can act again) or `skill_end_s`. The field is retained in the
output only for provenance.

---

## 4. Why folder names are irrelevant (the naming problem, solved)

Character folders use internal westernised-from-Chinese codenames that do not
match display names — Rebecca sits under `.../Role/FemaleMS/Rebecca/`, and her
skeleton asset is `R2T1RebeccaMd10011_Skeleton`. Matching those to your roster
would be fragile guesswork.

**The runner never reads folder names.** It derives identity from the data:

```
DT_SkillInfo row key   1308101
                       ^^^^ resonator id (1308)
                           ^^^ skill index
```

Row keys are the game's own skill ids, and their leading four digits are the
resonator id — the same id space your dataset already uses (1107 Carlotta,
1102 Sanhua, 1210 Aemeath). So the join is exact regardless of how the folders
are named, and a renamed or unfamiliar character folder cannot break it.

Rows without a 4-digit prefix (e.g. `100005`) are shared/common skills and are
skipped.

---

## 5. Run it

```bash
# from the repo, with the extraction tools on the path
python3 tools/extract/extract_timings.py <ASSET_ROOT> \
        -o data/timing-data.json \
        --report docs/timing-extraction-report.md
```

The runner:
1. indexes every `.uasset` under the root,
2. finds every `DT_SkillInfo`, parses it, derives the resonator id from row keys,
3. resolves each row's montage references to files on disk (longest-suffix path
   match, so it works whether the export root starts at `Client/Content/` or
   directly at `Aki/`),
4. parses each montage's notify timeline (each montage parsed once and cached),
5. writes the joined JSON plus a coverage report.

---

## 6. Validation requirements (do not skip)

The parser proves its own correctness — **enforce this, don't just trust it**:

- Every DataTable parse must consume **exactly** the export's declared
  `serial_size`. The runner already rejects any table that doesn't
  (`'parse did not consume payload exactly'`). One misread byte anywhere in a
  335 KB payload changes where the walk terminates, so exact landing is a
  genuine end-to-end proof, not a formality.
- Verified reference values for Rebecca (1308) — use as a regression fixture:

  | skill | id | expected |
  |---|---|---|
  | 手枪普攻1 (basic 1) | 1308101 | hits `[0.1333, 0.3667]`, actionable `0.435`, end `0.6276` |
  | 手枪重击 (heavy) | 1308111 | hits `[0.4338, 0.5336]` |
  | 手枪E (skill, cd 1.0) | 1308121 | 8 hits `0.5→1.0`, actionable `1.3333`, end `1.9233` |
  | 大招-切机枪 (burst, cd 25.0) | 1308301 | **freeze 3.0**, no hits, actionable `2.9096` |

- Sanity checks worth asserting across the roster: hit times must fall within
  `[0, sequence_length]`; `actionable_at_s` should be > 0 for non-loop montages;
  a burst skill with `freeze_total_s` should have it in a plausible 1–5s range.

---

## 7. Known edge cases the runner reports rather than hides

- **Unreferenced montages.** Files present on disk that no `DT_SkillInfo` row
  points at, listed in the report. These matter: Rebecca's `BurstAimAttack/`
  folder holds her *in-Liberation* animations, and `AM_Burst01` only covers the
  3-second transformation into machine-gun mode. **Review this list per
  character** — it is where stance/mode attack timings hide.
- **Multi-montage skills.** A row can reference several montages; the runner
  merges them conservatively (union of hits, earliest actionable, longest
  freeze) and tags the entry `_merged_from`.
- **Missing `.uexp`**, unresolvable montage paths, and parse failures are all
  collected into `_meta.errors` — never silently dropped.
- **Negative trigger times** (e.g. `-0.0001`) are authored offsets meaning
  "at montage start"; treat as 0.
- **Name-map skew** (one case: Lucilla, `FemaleXL/Luosela`). A package can ship
  a `.uexp` whose FName indices address one MORE name-map entry than the
  `.uasset` beside it declares, so every index above the insertion point is one
  too high while everything below still reads correctly. It surfaces as a
  nonsense `bad size <huge negative>` far from the real cause, because the
  shifted `None` terminator lets the walk run past a record's end. `extract`
  therefore parses in **two passes**: tables that decode on their own terms
  first, then the failures retried against the field-name vocabulary those
  successes produced (every `DT_SkillInfo` shares the `SSkillInfo` struct).
  Accepting a repair needs BOTH oracles — exact landing plus all-valid property
  types, AND vocabulary agreement — because a wrong property *name* does not
  change byte consumption, so exact landing alone cannot pin the boundary.
  Repairs are reported in `_meta.name_map_repairs`, never applied silently.
  Whether the skew originates in the game data or the exporter is unresolved;
  only 1 of 73 skill tables is affected and the bullet table in the same folder
  is clean, so it is not a systematic export fault.

---

## 8. Integrating into the engine

Per `TIMING-DATA-SOURCING.md` §3, every value carries provenance. Entries the
runner produces are `provenance: "extracted"`. Skills with no montage resolved
get `timing: null` — **do not fill these with a per-type constant and let it look
sourced.** Keep the existing fabricated defaults clearly tagged
(`"fabricated-default"`) so the two can never be confused in the UI or the
optimizer.

Before wiring extracted values into rankings, run the **±20% sensitivity check**
from `LANE-B-ASSET-EXTRACTION.md` §7: perturb the current defaults and see
whether team rankings move. That tells you how load-bearing timing precision
actually is, and therefore how much of the roster is worth extracting.

Suggested first slice: the P10/P12 seed characters (Carlotta, Hiyuki, Jinhsi,
Changli, Phoebe, Cantarella) — enough to validate the model without a full sweep.

---

## 9. Files

| File | Role |
|---|---|
| `ue_header.py` | package summary + name table (locates fields by validation, since cooked packages report `FileVersionUE4 == 0`) |
| `ue_tagged.py` | tagged-property walker + DataTable row reader |
| `ue_asset.py` | generic multi-export asset reader (import/export maps) |
| `montage_timeline.py` | AnimMontage → notify timeline + derived timings (splits the two freezes above) |
| `extract_timings.py` | full-roster runner for the **DT_SkillInfo row route** (fallback; entry point) |
| `scan_bullet_timings.py` | full-roster runner for the **bullet chain** — the primary route (notify → bullet id → bullet table → damage id) |
| `map-timings.mjs` | the join: routes above → `autoSkillMap` keys via `hit-map.json`; writes `data/actionable-times.json` + `docs/timing-gaps-report.md` |

`montage_timeline.py` also runs standalone on a single montage:
`python3 montage_timeline.py path/to/AM_Whatever.uasset`

---

## 10. Notify vocabulary reference

Decoded from Rebecca's montages. WuWa notifies are TypeScript-generated
(`Ts*_C` classes), so the names are descriptive and stable across characters.

| Notify | Role | Notes |
|---|---|---|
| `TsAnimNotifyReSkillEvent` | **hit** | 添加子弹 "add bullet". Spawn == impact (no projectile travel in WuWa); verified in-game at 210ms against Sanhua's 0.2102 |
| `TsAnimNotifyStateNextAtt` | **next-attack gate** | 下一个技能. `SetSkillAcceptInput(true)` + `CallAnimBreakPoint()` on begin, `(false)` on end. Input is buffered earlier (~30ms) and executes when this opens |
| `TsAnimNotifyStateTimeStopRequest` | **freeze (the sim's)** | the game's own `GetNotifyName()` reads "副本计时和所有战斗单位buff、技能冷却冻结" — instance timer + ALL combat units' buffs and skill cooldowns freeze. This is `freezeTime`. |
| `TsAnimNotifyStateAbsoluteTimeStop` | ~~freeze~~ **animation hold — stops NO clock** | `GetNotifyName()` reads "动画和子弹冻结" (animation and bullet freeze). Its `K2_NotifyBegin` passes only `是否冻结移动效果`; the other three flags are declared but never read. Contributes zero to `freezeTime`. |
| `TsAnimNotifyEndSkill` | skill end | |
| `TsAnimNotifyStateBurst` | burst state span | |
| `TsAnimNotifyAddBuff` | buff application instant | useful for buff-window alignment |
| `TsAnimNotifyStateChangeSlot` | weapon **signal** | 切换组件到指定插槽 — attaches a sub-mesh to a socket, so the mechanism is cosmetic. But WHICH prop is a faithful marker of a weapon change (Rebecca `WeaponProp01` pistol / `WeaponProp02` shotgun) |
| `TsAnimNotifySkillBehavior` | skill behaviour trigger | |
| `TsAnimNotifyStateSoftLock` | ~~movement lock~~ **camera** | 开启镜头软锁 — camera lock-on, gameplay-irrelevant. The real commitment data is `DT_SkillInfo.InterruptLevel` + `TsAnimNotifyChangeSkillPriority`, and the `不能切人` / `切人结束技能` gameplay tags |
| `TsAnimNotifyFightStand` | return-to-idle | **marks the start of the padding tail** |
| `TsAnimNotify*CameraShake`, `*ControllerShake`, `*AudioEvent`, `*WeaponHide` | cosmetic | filtered out by default |

If an unfamiliar notify appears on another character, it lands in the timeline
as `role: "other"` with its name intact — nothing is silently discarded.

**Do not extend this table by guessing from a class name.** Run
`node tools/extract/scan_notify_semantics.mjs <exportRoot> --json data/notify-semantics.json`
— it reads every class's own `GetNotifyName()` out of the shipped client
JavaScript, plus which declared properties the body actually reads. Three wrong
models came from name-inference (AbsoluteTimeStop, SoftLock, ChangeSlot); the
committed `data/notify-semantics.json` covers all 202 classes.
