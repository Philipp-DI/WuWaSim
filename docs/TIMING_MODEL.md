# WuWaSim — Timing Model & Ability Data Sourcing

Read this before writing or modifying anything related to `castTime`, `freezeTime`, `cooldown`, buff duration, or DPS calculation.

## Context

Community references (prydwen.gg, Maygi's calculator) report DPS numbers well above what a naive real-time simulation produces. This isn't an error in either direction — they're using a different time convention. Tower of Adversity (the benchmark content) freezes the challenge timer and ability cooldowns during Resonance Liberation (and Tune Break) animations, so community DPS figures divide by a shorter "effective" time than a wall-clock sim would use. WuWaSim should model this explicitly rather than picking one convention and hoping it matches.

## Two-clock time model

Track two time axes per rotation, not one:

- **`gameTime`** — advances by `castTime - freezeTime` per action. Cooldowns tick against this. This is the DPS denominator in ToA-benchmark mode.
- **`realTime`** — advances by full `castTime` per action. Buff/debuff durations tick against this, always — buffs do not pause just because the challenge clock did.

This split matters because the two don't move together: a Liberation can be "free" on the clock while still burning down an active buff's remaining duration in the background. A single-clock model gets one of the two wrong.

**Scope:** this split only applies to timed benchmark content (ToA, boss trials). Open-world and non-timed combat should run a single real-time clock — implement this as a mode flag, not a hardcoded assumption, so `freezeTime` can be zeroed out / ignored outside ToA-style content.

**Practical note:** `freezeTime > 0` mainly applies to Resonance Liberation and Tune Break animations. Basic/Heavy/Skill attacks are `freezeTime = 0` in almost all cases — don't go looking for freeze windows outside those two ability types unless a specific character's kit says otherwise.

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
