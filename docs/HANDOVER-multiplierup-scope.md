# Handover — `multiplierUp` scope, and the silent inflation

Written 2026-08-08 at the end of a long session, for a fresh session to pick up.
Everything below is **verified by independent agents**, not asserted. Where a
prior claim of mine was wrong, it is marked so — do not re-derive from my
earlier summaries, they contain three corrected overreaches.

---

## 1. The bug

Six chain/inherent effects have `stat: 'multiplierUp'`, **no `skillKeys`**, **no
`skillType`**, `defaultActive: true` and `window.type === 'always'`. Their kit
clause NAMES a specific skill that DOES exist as a key. Because they are
unscoped, they multiply **every damage hit the resonator lands**.

| Resonator | Slot | Value | Clause names | Key exists |
| --- | --- | --- | --- | --- |
| Cantarella (1607) | S2.0 | +245% | Jolt | `skill_jolt` |
| Chisa (1508) | S3.0 | +120% | Sawring - Blitz / Chainsaw Mode - Dodge Counter / Sawring - Eradication | `forte_heavy_sawring_blitz_{1,2,3}`, `forte_heavy_chainsaw_mode_dodge_counter`, `forte_heavy_sawring_eradication` |
| Phrolova (1608) | S2.1 | +75% | Scarlet Coda | `basic_scarlet_coda` |
| Zani (1507) | S6.0 | +40% | four Heavy Slash - … | `forte_heavy_heavy_slash_{daybreak,dawning,nightfall,lightsmash}` |
| Brant (1206) | S6.0 | +30% | Mid-air Attack | `midair_mid_air_attack_{1..4}` |
| Lucy (1511) | IH1.0 | +10% | Hack | `forte_heavy_hack_response_data_crash` (weakest — label is "Hack Response — Data Crash") |

**Measured:** a Cantarella S2 build resolves `multiplierUp = 2.45` on hit
`basic_1` (S1 build: 0). Every unrelated hit is multiplied **3.45x**.

**Direction matters.** This is silent INFLATION — the opposite of the
understatements fixed earlier in the session. It makes those characters look
better than they are.

Decisive code path, no other gate intervenes:

```
src/core/buffs.js:313   const named = Array.isArray(effect.skillKeys);   // absent ⇒ false
src/core/buffs.js:347   case 'multiplierUp': if (named || effect.skillType == null || …)
src/core/buffs.js:528   case 'always': return true;
src/core/skill.js:120   const multiplier = baseMult * (1 + (ctxNode.multiplierUp ?? 0));
```

**NOT in the set:** Brant S1.0 +20% matches the raw filter but is window-gated
(`seconds(5)`, `castMatch intro`) and its clause is genuinely all-damage
("Brant's DMG dealt is increased by 20%") — the skills it names are the TRIGGER,
not the scope. Correctly unscoped. Do not "fix" it.

---

## 2. Why only SOME fail — the answer to the maintainer's question

Because `multiplierUp` scope is **100% derived from kit TEXT** today, by regex
shape-matching in `tools/preprocess/skill-scope.mjs`. Prose matching has a
coverage curve; a data join would be boolean. "Some fail" is the signature of
pattern matching.

The cleanest single demonstration — **Phrolova has two clauses about the same
skill**:

- S2.0 binds correctly → `skillKeys: ["basic_scarlet_coda"]`
- S2.1 "Aftersound now additionally increases the DMG Multiplier of Scarlet
  Coda by 75%" → **unbound**

Same character, same node, same target skill, same data. Only the English
differs. Nothing about the game's data distinguishes them.

---

## 3. What the data can and cannot do (three agents, reconciled)

### The pipe EXISTS and is already wired — my earlier "no data lane" was wrong

`tools/preprocess/buff-facts.mjs:94-99` assigns `effect.skillKeys` from
`fact.scopeByFamily[familyOf(effect.stat)]` for **any** stat. `familyOf`
(:59-63) maps `multiplierUp` → `'other'`. The "never retargeted" note at :28
covers the **bucket**, not the **scope**. `data/buff-facts.json` carries 5
`'other'`-family scopes (Youhu 0.5, Mornye 0.3, Yuanwu 5, Sigrika 0.075,
Camellya 3).

### But it is inert

Measured: **0** of 126 `multiplierUp` effects carry `scopeSource: 'configdb'`
(21 effects total have that marker, none of them `multiplierUp`). No value
collision exists between those 5 `'other'` scopes and any `multiplierUp` value.

**Upstream blocker:** `tools/extract/extract_buff_facts.py:169-188`
(`attr_and_value`) returns `None` unless the buff has a `GameAttributeID`, or an
`ExtraEffectID` in `{37, 38}` (:57), or `SNAPSHOT_MODIFY = 1` (:58). A DMG
Multiplier increase is a skill's own RATE and is not a stat buff, so it never
passes the gate.

### The paired-row lane covers ~12% — not a systematic fix

Chain variants shipped as bullets named 共鸣N can be paired with their unmarked
base bullet, giving scope (base row's skill key) and value (ratio). Measured
**independently twice, both 9 of 74 = 12.2%**. Relaxing the chain-level
constraint still yields 9, so coverage is the limiter, not gating.

When a pair exists it is exact — Changli S5 +50% → 1.5, Brant S6 +30% → 1.3,
Jinhsi S5 +120% → 2.2, Xiangli Yao S6 +76% → 1.76. Most characters simply do not
ship alternate damage rows for their chain multipliers.

**Known discrepancy, unresolved:** the two runs got the same COUNT (9) but not
the same membership — one lists Phoebe S1 0.9 / Camellya S3 0.5 / Camellya S5
3.03 / Roccia S4 0.6 / Roccia S5 0.2 where the other flagged Phoebe S1 +480% as
a near-miss. Pair totals also differ (70 vs 111) because of how strictly the
"base mapped / marked unmapped" condition was applied. Worth settling before
relying on the matched set; it does not change the conclusion.

---

## 4. Corrections to my own earlier claims (do not trust the old summaries)

1. **"Chain upgrades aren't modelled at all"** — wrong. The kit states them as
   percentages and the parser already reads them (Xiangli Yao S6 +76%,
   Cantarella S1 +50%, Camellya S2 +120%, Jinhsi S5 +120%). A data-driven upgrade
   lane on top would DOUBLE-COUNT. Corrected in `HISTORY.md` and commit bdaf8aa.
2. **"Use paired rows as the source of truth instead of the text"** — proposed,
   then measured at 9/74. Not viable as the systematic fix.
3. **"`multiplierUp` has no data lane"** — overreach. The pipe exists (§3); it
   has no data flowing through it.
4. **"19 unscoped effects"** — that was `multiplierUp`-only AND
   no-category. Roster-wide it is 135 unscoped of 352 effects, but most of that
   is correct: scope is meaningless for `atkRatio`/`critRate`/`critDmg`/
   `dmgBonus`/`healingBonus`. Only `multiplierUp` (19) and `amplify` (13) are
   defects. The unbound `multiplierUp` pool is **74** (55 category + 19 nothing).

---

## 5. Plan, in order

### Step 1 — Guard first (small, self-contained, do this first)

A test that FAILS when any `multiplierUp` effect is `defaultActive`,
`window.type === 'always'`, has no `skillKeys`, no `skillType`, and its
`condition` names a skill resolvable in `autoSkillMap`. Six failures on day one.
This converts silent inflation into a build error and stops regressions while
step 2 proceeds.

Put it next to `tests/node-type-match.test.mjs`, which already has the shape
(matcher assertions + a roster-wide census ratchet).

### Step 1b — FIX THE TRUNCATION FIRST (found by the third agent, 2026-08-08)

`tools/preprocess/effects.mjs:547` stores `condition: clause.trim().slice(0, 120)`,
and `bindSkillScopes` reads that field. **32 clauses exceed 120 chars and lose
their skill names before the binder ever sees them** — Carlotta and Lucy S3.1
lose their bindings to truncation ALONE. No regex widening can fix these.

Do this before step 2, or step 2's before/after measurements are meaningless.
Keep a truncated field for display if the UI needs one, but the binder must read
the full clause.

### Step 2 — Widen `skill-scope.mjs`, one sentence shape at a time

**SCOPE CORRECTION (third agent, 2026-08-08).** The "six inflating effects" in
§1 are the subset whose miss is TOTAL (`skillType === null`). Drop that term and
the mis-scoped count is **49**. The other 43 carry a `skillType` that targets the
WRONG subset — harder to see, equally wrong:

- Carlotta S6.0 +187% leaks onto Fatal Finale
- Xiangli Yao S6.0 and Cantarella S6.0 land on the wrong rows entirely
- Cartethyia S2.0 misses 17 of its 22 targets

Text-first bucketing of all 74 unbound: **A = 66** should be scoped (59
proper-noun, 7 category-only), **B = 4** genuinely global, **C = 4** belong to
another lane — including Hiyuki S6.2, which is a **Crit. DMG value mis-parsed as
`multiplierUp`** (fix that separately; it is not a scope problem).

Sentence shapes by count — fix in this order:

| # | Shape | Count |
| --- | --- | --- |
| 1 | plural `The DMG **Multipliers** of X, Y and Z are increased` | 13 (unmatched over one character) |
| 2 | verb-first `increases the DMG Multiplier of X **by N%**` | 10 |
| 3 | bare juxtaposition `<Name> DMG Multiplier is increased` | 8 |

Full table, per-effect, in `docs/multiplierup-scope-audit.md`.

**Already fixed, do not redo:** the audit lists Changli S5.0 as "does nothing at
all" (`heavy`, she owns no plain-heavy row). That describes the state BEFORE
commit 7f930fa, which added `nodeTypeMatches` so a `heavy` clause matches a
`forte_heavy` node. Verified: her node types are `basic, midair, skill,
liberation, intro, forte_heavy`, and LOCK B moved for 1205 when the fix landed.

`docs/multiplierup-scope-audit.md` (written by the third agent, see §6) groups
the bucket-A clauses by SENTENCE SHAPE with counts — fix in descending count
order, measuring bind-rate before and after each. Known-missing shapes include:

- `"Y now additionally increases the DMG Multiplier of X by N%"` (Phrolova S2.1)
- `"increasing the DMG Multiplier of X by N%"` (Xiangli Yao S6 — currently the
  TARGET form expects `"The DMG Multiplier of X **is increased**"`)
- `"The DMG Multipliers of X, Y and Z are increased by N%"` (Chisa S3.0, Zani S6.0)

Expect LOCK B to move DOWNWARD for the affected characters. That is the point.

### Step 3 — Only then, ask whether `db_buff` has rate-scoped buffs worth
feeding the existing `'other'`-family pipe. Low expected yield (5 scopes exist,
none collide today), so this is last.

### Also still open, from earlier in the session

- 11 chain-extra-hit candidates withheld pending a kit-text read
  (`KIT_VERIFIED` in `tools/preprocess/chain-extra-hits.mjs`). Zhezhi's S6 extra
  Ivory Herald is real but resolves onto the wrong parent.
- Two `forte` pseudo-type clauses still match nothing (Taoqi S5 +50%,
  Camellya S6 +150%) — both NAME their skill, so step 2 fixes them.
- One `unknown` formulaType remains (Lynae), pinned by a ratchet.
- Hiyuki's Glacio Bite instance + S6 +25% amplify: the number the code said was
  unavailable now exists (`affliction-damage.json` row 1007, buffs 1108501133 /
  1108501511 at a fixed 1.0). Never built.
- Yuanwu S3 `DamageAugment` stat-scaled flat add: never built.

---

## 6. Verification protocol (maintainer's standing rule)

> "Have two separate agents spawn that independently verify your claims. Only
> when all agents are in agreement the step/work can be marked as done."

Extended 2026-08-08 to a THIRD agent doing a text-side check to lean against the
numbers. Its report lands at `docs/multiplierup-scope-audit.md`.

Agents must DERIVE, not confirm — give them the claim and the method, and ask
for CONFIRMED / PARTIALLY CONFIRMED / REFUTED with file:line evidence. Two of
the three checks so far returned a correction, which is the point.

Time is not a constraint; token economy is. Prefer `node -e` queries over
reading `wuwa-data.json` (200k+ lines).
