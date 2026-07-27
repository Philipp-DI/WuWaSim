# WuWaSim — Timing Model & Ability Data Sourcing

Read this before writing or modifying anything related to `castTime`, `freezeTime`, `cooldown`, buff duration, or DPS calculation.

## Context

Community references (prydwen.gg, Maygi's calculator) report DPS numbers well above what a naive real-time simulation produces. This isn't an error in either direction — they're using a different time convention. Tower of Adversity (the benchmark content) freezes the challenge timer and ability cooldowns during Resonance Liberation (and Tune Break) animations, so community DPS figures divide by a shorter "effective" time than a wall-clock sim would use. WuWaSim should model this explicitly rather than picking one convention and hoping it matches.

## Two-clock time model

Track two time axes per rotation, not one:

- **`gameTime`** — advances by `castTime - freezeTime` per action. Cooldowns **and** buff / effect / character-state durations tick against this, and it is the DPS denominator in ToA-benchmark mode. Everything the game's own clock drives lives here.
- **`realTime`** — advances by full `castTime` per action. It positions the timeline for display and is the wall-clock rotation length.

This split matters because the two don't move together: during a Resonance Liberation animation the in-game clock freezes — cooldowns stop, active buffs keep their remaining duration, and the challenge timer pauses — while realTime keeps advancing through the animation. A single-clock model gets one of the two wrong.

> **Correction (2026-07-23).** Earlier drafts had buff/debuff durations ticking against realTime ("buffs do not pause just because the challenge clock did"). That was wrong: the maintainer confirmed a Liberation animation freezes buffs, cooldowns, and the timer alike. Duration decay now measures `gameTime`. See **Confirmed mechanics** below.

**Scope:** this split only applies to timed benchmark content (ToA, boss trials). Open-world and non-timed combat should run a single real-time clock — implement this as a mode flag, not a hardcoded assumption, so `freezeTime` can be zeroed out / ignored outside ToA-style content.

**Practical note:** `freezeTime > 0` mainly applies to Resonance Liberation and Tune Break animations. Basic/Heavy/Skill attacks are `freezeTime = 0` in almost all cases — don't go looking for freeze windows outside those two ability types unless a specific character's kit says otherwise.

## Confirmed mechanics (maintainer, 2026-07-23)

We cannot obtain measured frame-count timings (see the reframed Sourcing note below). What we *can* encode are the timing mechanics the maintainer has confirmed in-game. These are modeled structurally — no fabricated numbers — and are the source of truth over any estimate:

1. **A Resonance Liberation animation freezes the in-game clock** — challenge timer, cooldowns, **and** buff/effect/state durations all pause for the whole (non-interruptible) animation. Modeled as `HARDCODED_FREEZE_FRACTIONS.liberation = 1` in `sim.js` (freeze = the entire `castTime`; a dataset may override via `_defaults.freezeFractionBySkillType`), honored in `'toa'` mode and ignored in `'open'`. Implemented in `sim.js` (`resolveFreezeTime`, `computeStepTimes`, `deriveGameTimes`), with duration decay reading `gameTime` in `buff-timeline.js` (sonata stacks), `rotation-state.js` (state `seconds` exits), and the effect-`seconds` window in `buffs.js` (`sim.js` feeds it `gameStart`/`gameEnd`).

   **Only the CINEMATIC cast freezes** — a multi-step Liberation freezes just its opening cinematic, not the enhanced-state follow-ups. The gate (in `resolveFreezeTime`) is `skillType === 'liberation'` AND `consumesResource !== false` AND `liberationCost > 0` (the caster's `energyMax`):
   - **Energy ultimates** (Carlotta, Augusta — `energyMax > 0`): the opener consumes the bar (`consumesResource` undefined) → freezes; continuations are stamped `consumesResource: false` (Carlotta's Death Knell / Fatal Finale, Augusta's Sublime is the Sun) → do NOT freeze. Without this, the whole enhanced-state sequence freezes and `gameTime` collapses toward 0.
   - **Non-energy "ultimates"** (Lucilla, Phrolova — `energyMax 0`): their liberation-tagged steps are enhanced on-field attacks, not cinematics, and none is stamped `consumesResource: false`, so the `liberationCost > 0` guard is what stops them all freezing.
   - **Conservative residual:** a genuine cinematic *finale* (Carlotta's Fatal Finale) or a non-energy character's real cinematic cast is under-frozen — the data carries no "cinematic" flag to distinguish it, and under-freezing is the safe (never-inflate) direction. A curated key list could add such casts later.
2. **Almost every skill and attack is instant and interruptible.** Timings are animation-based and any animation (except a Liberation) can be cut by the next input. We have no measured cast lengths, so the per-type `castTimeBySkillType` estimates stand in as the "committed time until next input" proxy — a best-effort realTime scale, not a claim of accuracy.
3. **Parallel vs transformation echoes** (maintainer-verified in-game 2026-07-24 via the desc prefix — the clean classifier we thought didn't exist). A **transformation** echo — active-skill desc starts with **"Transform"** (you BECOME and control the echo) — LOCKS the resonator, so its step occupies `ECHO_CAST_TIME`. Every other echo — **"Summon"** (a helper that fights alongside while you keep acting) and direct-attack echoes — casts in **parallel**: full damage + energy at **zero** timeline time. Classified by `resolveEchoStepTime` (`ECHO_TRANSFORM_DESC = /^\s*transform/i`), computed once and threaded through `computeStepTimes` + the walk. ~65 Transform (lock) / ~115 parallel across the roster. (`opener.js`'s separate `ECHO_CAST_TIME` heuristic is unchanged — a follow-up if opener↔sim echo timing should match.)

4. **A manual Tune Break activation freezes the in-game clock** too (maintainer-confirmed in-game 2026-07-24), like a Liberation. Tune Break is not yet a sim step (its "off-tune buildup" gauge + trigger are unmodelled — see `NEGATIVE-STATUS-REFERENCE.md`), so there is nothing to freeze today; recorded here so that when a manual Tune-Break rotation step is wired it gets the same whole-animation freeze (add its skillType to `HARDCODED_FREEZE_FRACTIONS`).

**Status of the remaining facts (assessed 2026-07-24):**

- **Transformation-echo classification — SOLVED** (point 3 above): the desc-prefix regex is the maintainer-verified flag we'd earlier concluded was missing. Transformation echoes now lock for `ECHO_CAST_TIME` — an **estimate**: the real transform sequence is longer (and the sim still models it as a single damage instance), so this **under-counts** the lock, conservatively. The real lock duration + the multi-hit transformed sequence still want real animation data. **Hold-button skills** (the other half of fact 4) remain unaddressed — no classifier for them yet.
- **Fact 5 — resonator-switch cancels the previous animation, outro fires if the Concerto bar was full:** already modeled. Intro/outro auto-cast (`AUTO_CAST_SKILL_TYPES`), the Outro→Intro handoff gates on `enforceConcerto`, and the instant-cast + parallel-echo model leaves no lingering animation to cancel at a switch. No actionable gap.
- **"Collapse instant skills toward zero realTime" rescale:** deferred — no measured base to justify a new time scale.

## Ability data schema

```
{
  castTime:     number,   // seconds, full animation length
  freezeTime:   number,   // seconds of castTime where gameTime/cooldowns are frozen (0 for most non-Liberation/Tune-Break abilities)
  hits:         number,   // damage instances; distribute evenly across castTime for v1 (see Precision below)
  cooldown:     number,   // seconds, ticks against gameTime
  energyValues: {...},    // concerto / resonance energy generated
  cancelPoint?: number,   // optional: earliest time a swap-cancel can occur, if known
  source: "imported" | "frame-counted" | "estimated"   // REQUIRED — see Sourcing below
}
```

`source` is a required field, not metadata to skip. Do not merge ability data into the project without it — it's what lets users (and future us) tell a solid number from a guess. Don't let an estimated value look as solid as a measured one in any downstream UI/output.

## Sourcing ability data — priority order

> **Reframed (2026-07-23):** measured per-ability cast/freeze times are **not currently obtainable** (no access to capture footage or Maygi's sheets). So the roster runs entirely on `source: "estimated"` — the per-type `castTimeBySkillType` defaults — plus the structural rules in **Confirmed mechanics** above (Liberation freeze, parallel echoes), which are what actually improve realism without inventing numbers. The measured-data ladder below stays as the aspirational path if a source ever opens up; treat items 1–2 as "if available", not "todo".

1. **Import Maygi's calculator data first.** Her sheets have measured `castTime` / `freezeTime` / `hits` / `cooldown` for most of the roster (through roughly patch 2.6). Get permission and credit her in the project's attribution before shipping this. Tag `source: "imported"`.
2. **Frame-count from public 60fps footage** for anything missing from (1) — new characters, or gaps. Doesn't require owning the character. Pipeline: `yt-dlp` for footage (official kit showcases, rotation-guide channels, arabwuwa's recorded rotations) → `ffmpeg` frame extraction → count input-frame to next-action-available-frame for `castTime`, hit-flash frames for `hits`, frozen-HUD frames for `freezeTime`. Tag `source: "frame-counted"`.
3. **Estimate only as a last resort** (e.g., a character with no footage available yet). Tag `source: "estimated"` and surface this as provisional in output.

## Explicitly out of scope: don't extract from game assets

The pipeline to pull `AnimMontage` data from game files exists (FModel + AES key endpoint + CUE4Parse) and was evaluated. **Don't use it.** Raw montage / `SequenceLength` doesn't equal effective cast time — input buffering, hitstop, and swap-cancel windows all shift the number gameplay actually produces, which is exactly why community sources (Maygi, arabwuwa) measure from live gameplay instead of asset data. Don't resurrect this route without a concrete new reason it'd solve something the video-based approach can't.

## Precision: run the sensitivity pass before chasing exact numbers

Before spending time tightening any individual ability's timing: perturb all `castTime` values ±15% and check which ones actually move total DPS or break a rotation's cooldown/energy timing. Expect only the current on-field DPS's core combo and a few long-animation abilities to matter — support/filler precision is usually noise. Let this pass decide where accuracy effort goes; don't spend it uniformly across the roster.

## Validation

Before trusting a character's timing data:

- Rebuild 2–3 of arabwuwa's disclosed rotations (arabwuwa.com/team-dps — explicitly measured in-game, not paper frame-counted) in WuWaSim. Total rotation duration should land within ~5% of their recorded time.
- Cross-check resulting DPS against Maygi's numbers for the same rotation and assumptions (enemy level, buff uptime).
- If either check misses by more than that, re-check the timing data before touching the damage formula — timing is the more likely source of drift.
