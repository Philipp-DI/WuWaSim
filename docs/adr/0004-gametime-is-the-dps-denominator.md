# DPS is damage over game time, not wall-clock time

Some animations stop the in-game clock (`freezeTime`): cooldowns, buff durations and the fight timer all pause. DPS divides by `gameTime = totalTime − totalFreeze` (`timingMode: 'toa'`, the Tower of Adversity benchmark), not by wall-clock `realTime`, because that is the clock the game's own timed content measures. Mixing the two once reported a 3.09x DPS gap against a 1.8x damage gap.

## Consequences

- Freeze is counted once per animation per rotation; over-counting it shrinks the denominator and inflates DPS, the unsafe direction.
- Any cast that freezes the clock is damage at no time cost, which is why such casts need caps (e.g. one Tune Break per team cycle, `.claude/rules/invariants-status.md`).
