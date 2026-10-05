# PRINCIPLES — the reasoning behind the standing rules

`CLAUDE.md` (PRINCIPLES) states the rules; this file keeps the full reasoning and
the incidents behind them. Moved verbatim from Claude Code's local auto memory on
2026-10-05, because auto memory never reaches subagents or cloud runs. In the
text, "I" is Claude and "the maintainer"/"the user" is Phil. `[[name]]` links
point to retired memory notes; that history lives in `docs/HISTORY.md`.

## Project north star

The overarching goal for ALL WuWaSim work, stated by the maintainer 2026-07-31:

1. **The simulation accurately mirrors in-game behaviour.** Correctness against
   the real game is the point; a number that is merely self-consistent is not
   done.
2. **Data-driven wherever possible.** Read what the game ships.
3. **Minimize simple regex checks in the parsers.** Text heuristics are the
   weak link, not the source data.
4. **App code and logic stay as human-readable as possible.** Complexity moved
   out of `src/` into a build-time extractor is a win twice over.

**Why:** these four pull in the same direction. Every shipped bug of this class
traced to a text heuristic standing in for a field the game already had
(see [[prefer-game-data-over-regex]] for the catalogue). Pushing derivation
into `tools/` extractors both removes the brittle layer AND leaves `src/` as
plain readable logic reading plain fields.

**How to apply:** when a mechanic could come from a regex over kit text OR from
a BinData/nanoka field, spend the time to find the field first — check
`data/bindata/` (`skill.json`, `damage.json`, `baseproperty.json`,
`roleinfo.json`) and the nanoka per-instance fields, using the id JOIN that
`tools/extract-forte.mjs` and `data/hit-map.json` already establish. If a regex
survives, it should be the narrow fallback for what no field covers, and it
should refuse to guess rather than approximate — a null the UI can surface
beats a plausible wrong number ([[silent-zero-is-a-bug]]). Prefer a build-time
`tools/` extractor with committed output over runtime parsing in `src/`.
Pairs with [[verify-before-shipping]].

## Data is the source of truth

Extracted game data is the SINGLE SOURCE OF TRUTH. Where it is inconsistent —
mistranslation, gaps, misinterpretation, wrong routing, or a contradiction with
something the maintainer said — surface the inconsistency as transparently as
possible and demand verification rather than resolving it silently. The
maintainer may offer false input. **Only what is in the data AND
confirmed/verified by the maintainer is an absolute truth.**

**Why:** stated 2026-08-25 after a concrete case. The maintainer instructed that
BOTH of Chisa's rotations end on Sawring - Eradication; the data disagreed, the
disagreement was surfaced with the arithmetic behind it, they checked in game,
and reversed half the instruction ("This one's on me"). Had the instruction been
followed silently, a wrong rotation would have shipped and the Concerto
extraction gap behind it — 65 of 261 flat grants read, 2,884 points unread —
would have stayed invisible. The same session had the reverse case: the
maintainer's read that tap-vs-hold Chainsaw Mode behaves differently was
CONFIRMED by the variant rows in the data, making it settled.

**How to apply:** treat a maintainer instruction that the data contradicts as a
FINDING to report, not an order to execute quietly and not an order to refuse —
present the measurement, state what the data says, and ask. Never split the
difference or pick the reading that makes the task easier. When data and
maintainer agree, stop re-deriving it: record it as settled (in an invariant, a
test, or a `source` note on the curated file) so it is not re-litigated. When
neither is available, say the number is unknown rather than inventing a
plausible one — see [[silent-zero-is-a-bug]] for why an honest gap must still be
visible in the UI. Related: [[prefer-game-data-over-regex]],
[[verify-before-shipping]], [[verification-protocol]], [[project-north-star]].

## Prefer game data over regex

When a mechanic can be derived EITHER by parsing kit-description text (regex)
OR by reading an authoritative structured field the game already ships, use
the field. In WuWaSim the raw nanoka `sk.damage[*].type` tag encodes damage
type per instance (0 basic, 1 heavy, 2 liberation, 3 intro, 4 skill, 5 Echo
Skill) and is 100% reliable at per-instance granularity — it replaced the
entire "considered as X DMG" regex classifier (`parseDescConversions` &co,
deleted P13-fix-5, 2026-07-04). See [[p13-team-er-status]].

**Why:** Text heuristics on kit descriptions are brittle — they mis-scope
compound/staged sentences, break on HTML wrapping (`<color=Highlight>`),
and conflate distinct concepts (e.g. "considered as *casting* Echo Skill" =
mechanical trigger vs "considered Echo Skill *DMG*" = damage-type). Every one
of those produced a real shipped bug (Aemeath, Galbrena, Cantarella). The
game's own data field has none of those failure modes. Repeatedly across this
project the user has been right that the data field is the answer and my
text-parsing was the weak link — including reversing my own "the type field
is only 80% reliable" conclusion, which was an artifact of comparing the
field against the bad regex, not a limit of the field.

**How to apply:** Before writing/extending a regex over `desc`/kit text,
check whether nanoka already carries the fact as a structured field
(`type`, `element`, `energy`, `element_power`, `related_property`, `format`,
etc.) and read it via the existing instance matcher (`matchRowHits`, full
rate-vector). Only fall back to text parsing when no field exists. If the
user says "the data is clear, lose the regex," take it literally — refactor
to data-driven and delete the dead heuristic; don't preserve it as a hedge.
Pairs with [[verify-before-shipping]] (verify the field's semantics in-game
first, then trust it).

**Same lesson, curated-override form (2026-07-23):** the trap isn't only
regex — it's ANY layer that second-guesses an authoritative field. After the
Arikatsu source swap gave Hiyuki a real `baseStats.energyMax` (125), I added
`src/core/liberation-gate.js` with a curated set force-nulling her "because
she's special-resource-gated." The user reversed it: *"the extracted data
doesn't lie, it just needs correct interpretation — populate `energyMax` if
the data says so."* Hiyuki DOES want ~110–120% ER. I deleted the module and
read the cost straight from data. Rule: a missing value in an OLD source
(Dimbreath had no Hiyuki `baseStats`) is a **data gap**, not a mechanical
fact — don't harden a gap into a curated exception. Multi-gauge nuance belongs
in energy *income* attribution (how fast the bar fills), never in nulling the
bar's existence. See [[p13-team-er-status]] and [[arikatsu-data-source]].

## Verify before shipping

Don't assert what an ambiguous/undocumented data field means and ship a feature on
that assertion without verifying it first. This project (WuWaSim) already has an
established verification methodology (in-game manual testing, documented extensively
in `docs/energy-signal-findings.md` for Resonance Energy) — use it, or explicitly
flag "unverified hypothesis" in both the commit and the docs, before building on top.

**Why:** On 2026-07-02 I identified a raw dataset field (`element_power`) as
"Concerto Energy" from a single plausible-looking example, shipped a full feature
(swap gauge, team-sim wiring, tests) on that label, and only got asked to justify it
after the fact. The user pushed back hard and correctly — three hypotheses I then
tested to replace the claim (naive Concerto, Tune Break buildup, negative-status
application) all failed under scrutiny, including one case where my own analysis
script had a real bug (transposed element-ID mapping) that I had to catch myself.
The user then did real in-game testing and reverse-engineered the actual mechanism,
which did turn out to confirm my original label — but only by chance, and only
after real work from both sides to get there. See [[p13-team-er-status]] for the
full story.

**How to apply:** When a raw/undocumented field's meaning is inferred rather than
confirmed (no source doc, no schema comment, no prior verified reference in this
codebase), either (a) do the verification work first — check multiple examples,
look for corroborating/contradicting structural evidence, cross-reference existing
project docs for a matching known-but-unmodeled mechanic — or (b) ship it explicitly
labeled "hypothesis, unverified" in code comments AND docs, so nobody (including a
future me) treats it as settled fact. Don't skip straight to a confident label.

**Companion lesson (same day, follow-up):** after the above was resolved, the user
asked a sharper follow-up — "how did you map them properly, since we're both unsure
about the ID structure?" — that forced me to actually trace the code path instead of
re-describing what the comment/docstring already claimed. That surfaced a real,
more precise bug the existing comment had understated (a per-row-reset consumption
counter that silently discarded colliding entries instead of just mildly
misattributing them — see [[p13-team-er-status]]). **When this user asks "how
exactly does X work" or pushes on a specific mechanism, trace the actual running
code, don't restate the docstring** — the two can diverge, and a written
explanation that merely sounds plausible is exactly the failure mode this user is
probing for. Read the real function body, walk a concrete example by hand, and
verify against the code's actual behavior (test output), not its stated intent.

## A silent zero is a bug

When a computed value is legitimately zero, WuWaSim must still SHOW it, with
the reason, instead of filtering it out. Established 2026-07-31 after the
maintainer's manual testing: `liveSubstatValues` dropped every zero-gain
substat, so Crit Rate silently disappeared from Stat Priority once the build
passed the formula's 100% crit cap. Reported as "not showing and not
contributing" — i.e. read as a broken panel, not as a finding.

**Why:** a missing row is indistinguishable from a row the app failed to
compute. The user cannot tell "worth nothing" from "crashed", so a correct
result destroys trust in the whole page. The same shape appeared in the empty
build-editor panel ("No precomputed suggestion available" where the real answer
was "equip an echo") and in a `catch {}` that rendered identically to an
unfinished build.

**How to apply:** report the zero AND diagnose it — core modules return a
reason CODE (`zeroReason: 'critCap' | 'noScaling'`), the UI owns the wording.
Measure the reason rather than inferring it: the crit cap is read off
`breakdown.critRate >= 1` per hit, because the sheet crit rate (97.8%) does not
show the buffs that do the capping. Never swallow an exception into an empty
state without logging.

The same rule extended to "can't compute yet": rather than a blank panel, fall
back to a measure that always exists and label it. The maintainer asked for
exactly this on 2026-07-31 — compute on an empty or flawed rotation — and, when
asked what to measure instead, named **the resonator's basic kit, the reading in
the sticky bar**. So `live-weights.js` falls back to `kit` (mean expected damage
per hit across every curated ability = `strips.js abilityAverages().overall`),
not to a curated reference rotation. Prefer a measure that is already on screen
and needs no curation over one that describes someone's plan.

Two traps that cost a round each: pick the fallback the user can already see
(the first attempt substituted `data/reference-rotations.json`, which covers
only 53/56); and check that a synthetic stand-in is actually inert — a seeded
`cost: 1` echo silently added 456 flat HP via `echo-rules` sub-mains and threw
four HP scalers off the identity until it became `cost: 0`.

Related: [[verify-before-shipping]], [[p13-sonata-team-buff-model]] (the "don't
rationalize a zero as honest, dig" lesson).

## Verification protocol

Before any investigative finding is marked done, spawn **independent
sub-agents** to verify it, and only mark it done when they agree. Established
2026-08-08 as two agents; extended the same day to a **third** doing a
text/regex-side check "to lean against the numbers" — i.e. deriving from a
different source than the others (code, data, prose) so the checks triangulate
rather than repeat.

**Why:** it works. Across the first three runs, every one returned a correction
— two against my claims, one against another agent's. It caught me overreaching
three separate times in one session ("chain upgrades aren't modelled", "use
paired rows as the source", "multiplierUp has no data lane"), and the third
agent found a root cause two prior passes had missed (a 120-char `condition`
truncation). Without it, all of that would have shipped as confident prose.

**How to apply:** give each agent the CLAIM and the METHOD, and require a
verdict of CONFIRMED / PARTIALLY CONFIRMED / REFUTED with `file:line` evidence.
Tell them explicitly to DERIVE rather than confirm — an agent asked to "check
this" tends to agree. Have them compute their own numerator/denominator so the
counts triangulate independently. Record disagreements rather than smoothing
them over (two agents once agreed on a count of 9 but not its membership; that
is still unresolved and written down).

**Re-run the suite AFTER the verifier finishes, not before.** A verifier that
does its job touches the working tree — `git stash` to measure a before-state, a
mutation check to prove a test actually fails, `npm run data`/`meta` to reproduce
a lock. Any of those can rewrite an `ENGINE_FILES` member's BYTES, and
`tests/meta-schema.test.mjs` hashes bytes, so the committed meta's `engineHash`
goes stale with no number and no behaviour changed. Measured 2026-08-17: the
suite was 73/73 at hand-off and 72/73 after verification, with a freshly
regenerated meta byte-identical apart from `generatedAt`/`engineHash`. Fix is
`npm run meta`; the habit is to make `npm test` the LAST command of the session.
Also require the verifier to state every tree modification it made and confirm
the restore — and check that yourself, since a `git checkout --` can over-revert
a file that was already dirty for unrelated reasons.

Related: [[project-north-star]], [[verify-before-shipping]],
[[prefer-game-data-over-regex]].

Token economy matters, time does not — the maintainer's words. Prefer `node -e`
queries over reading `data/wuwa-data.json` (200k+ lines), and let agents run
long rather than narrowing their brief.

## Full-energy start framework

**Maintainer-directed, 2026-08-14.** The opener/rotation-loop relationship was
reframed. This underpins the ER-target work, so it is not just a gap fix.

**Start state:**
- **Resonance Energy: FULL** (`baseStats.energyMax`) for every resonator. That is
  what Tower of Adversity gives you, and ToA is the scenario worth modelling.
- **Concerto: empty.** **Forte / SpecialEnergy: empty.**
- Overcap is impossible — the gauge clamps at the cost, and the cost IS the
  meter's size.

**Why the spill is fine.** Starting full means generation before the first
Liberation is discarded. That is cheap, because a Liberation is placed for its
BUFF WINDOW, not its energy efficiency — Chisa's feeds the +120% on Sawring
Blitz, a support's is cast late so it spans the next two members' turns. The ER
target is precisely what buys the correct placement.

**Pass 1 is still the weakest pass** — Concerto bars are empty, buffs are not up,
nothing has ramped. (I initially argued the opposite and was corrected; the
argument ignored Concerto and the buff ramp entirely.)

**A curated rotation is performed as authored.** It states what the player does,
so the engine may neither splice filler into it nor drop a cast from it. A short
gauge is a BUILD problem: report the shortfall and the ER that fixes it. The old
derived padding (50.4s on the benchmark team, vs arabwuwa's 1.59s cold start) is
retired entirely, along with gating.

**The ER target binds from the SECOND pass** — pass 1 is funded by the starting
meter, so the target means "the ER at which a full meter is rebuilt within one
loop".

**Far-future note:** Whimpering Wastes needs two teams per stage, where one team
starts with 100% Resonance Energy and the other with 100% Concerto. A switch for
that is a possible later feature.

Related: [[arabwuwa-reference-rotations]], [[benchmark-reference-captured]],
[[p13-team-er-status]].
