# Game Module Template — [Game Name]

Copy this file to `references/<game>.md` and fill every section with the
user's help. The SKILL.md pipeline stays unchanged; this file supplies all
game facts. Do not leave placeholder text in a live module.

## 1. Data sources
Where kit data lives (files/APIs), the canonical ability-key source, and how
effects/conditionals are encoded (what marks a trigger, a window/duration, a
mode/stance gate, an unconditional effect).

## 2. Modes / stances (if any)
Characters with selectable modes and the rule for how mode gates effects.

## 3. The canonical loop
The game's standard rotation shape (opener → … → handoff) and the known
archetypes that deviate from it.

## 4. Hard constraints
Forced orderings (combo stages, prerequisites), forced follow-ups, resource
feasibility rules — and which of these are NOT modeled (state the assumption
the report must carry instead).

## 5. Validation commands
Executable checks (scripts/CLI) proving: all keys exist, sequencing is legal,
trigger coverage is accounted for. Zero-warning requirement stands.

## 6. Assumed defaults for a report
Level, investment, difficulty/enemy assumptions used unless the user overrides.

## 7. Tips bank
Recurring, mechanic-grounded tip patterns for this game.

## 8. Structured output shape
The JSON shape downstream tools consume.
