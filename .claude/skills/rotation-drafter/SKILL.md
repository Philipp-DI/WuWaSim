---
name: rotation-drafter
description: Draft coherent, validated, and reasonably optimized ability rotations (skill sequences) for game characters by reading their kit data, and report the enablers, triggers, and conditionals the character needs to perform. Use this skill whenever the user asks for a rotation, combo, opener, skill order, ability sequence, "how do I play X", "what does X need to work", a default or reference rotation for a character, rotation candidates for the optimizer (`referenceRotation`), or tips for piloting a character — even if they don't say the word "rotation". Built for Wuthering Waves (WuWa Sim project); extensible to other games via modules in references/.
---

# Rotation Drafter

Reads a character's kit and produces: (1) a working, validated rotation using
canonical ability keys, (2) the reasoning behind the ordering, (3) tips &
tricks, and (4) a checklist of enablers/triggers/conditionals the character
depends on — grouped by who provides them (self, build, team, player).

## Step 0 — Select the game module

Game-specific knowledge lives in `references/<game>.md`. Read the module for
the game in play **before drafting anything**:

- **Wuthering Waves** (default for the WuWa Sim repo): `references/wuwa.md`
- Another game: look for its module; if none exists, copy
  `references/_game-template.md`, fill it with the user's help, then proceed.

The module defines: where kit data lives, the ability-class vocabulary, the
canonical loop shape, hard sequencing constraints, validators to run, and the
tips bank. **This SKILL.md defines the pipeline; the module supplies the facts.
Never guess facts the module should provide.**

## The pipeline

Run these seven stages in order. Do not skip VALIDATE.

### 1. INGEST — normalize the kit

From the game data (module tells you where), build a kit model:

- **Abilities**: `{ key, label, class, dealsDamage, forcedFollowups[] }`
  — `key` must be the canonical identifier from the dataset (the rotation must
  be paste-ready into the app/sim), never a made-up name.
- **Effects/conditionals**: every buff/effect in the kit with its condition:
  what triggers it (a cast? entering a state? a build-level mode? nothing —
  unconditional?), what window it has (timed? persistent? state-bound?), and
  what it benefits (which ability class / stat).
- **Resources/states/modes**: gauges the kit builds and spends, states it
  enters, modes it chooses (module lists these).

If the character has **selectable modes**, ask the user which mode to draft
for (or draft one rotation per mode if they don't specify). Mode-gated effects
only count in their mode.

### 2. CLASSIFY — find the damage engine

Identify, using multipliers, damage data, and role tags (module explains
where roles live):
- **Payoff abilities** — where the damage actually is.
- **Builders** — abilities that generate the resources/stacks/states that gate
  the payoffs.
- **Enabler casts** — abilities whose main job is opening buff windows.

### 3. LOOP-MAP — the phase skeleton

Map the kit onto the canonical loop from the game module (e.g. opener → build
→ burst → filler → handoff). Note all **forced orderings**: stage sequences,
prerequisite rules, auto-triggered follow-ups.

### 4. DRAFT — order the rotation

Rules, in priority order:
1. Every gated ability is preceded by whatever satisfies its gate.
2. Every buff whose trigger is a cast, and which benefits a payoff, fires
   **before** that payoff — and the payoff lands **inside** the buff's window
   (for timed windows, count cast time; keep the payoff close after the
   trigger).
3. Persistent buffs are front-loaded (fire their trigger early, benefit
   everything after).
4. Stage/prerequisite orderings are never violated.
5. Auto-triggered follow-ups are included explicitly as steps.
6. Filler (usually basic attacks) goes where nothing better is available and
   in correct stage order.

### 5. VALIDATE — zero warnings, full trigger coverage

Run the game module's validators (module gives exact commands). Required:
- **Sequencing validator** returns zero warnings.
- **Trigger coverage**: list every conditional effect in the kit as one of:
  - ✅ fired by this rotation (say at which step),
  - ⏸ intentionally not fired (say why — e.g. wrong mode, not worth a step),
  - ⚠ cannot be resolved (unknown trigger in the data — flag it, do not
    silently drop it).

If validation fails, fix the draft and re-validate. Never present an
unvalidated rotation.

### 6. OPTIMIZE — "somewhat", honestly

- Align payoffs into buff windows (the biggest cheap win).
- If the game module provides a runnable simulator, compare 2–3 candidate
  orderings by total damage and pick the best; report the comparison.
- Do **not** claim frame-perfect optimality. The output is a strong default,
  not a speedrun route. Say so.

### 7. REPORT — use the template

Format the output per `references/output-template.md`. The report always
includes the **enabler checklist**, grouped by the taxonomy below.

## The enabler taxonomy (game-agnostic)

Everything the character needs to perform, grouped by who supplies it:

- **Self (rotation)** — cast-order dependencies satisfied inside the rotation
  itself: trigger casts before payoffs, states entered, stacks built.
- **Build** — choices/thresholds on the character sheet: selected mode,
  sequence/constellation level an effect depends on, stat thresholds (e.g.
  an Energy Regen breakpoint for the burst to be ready — if the game module
  flags energy/resource feasibility as unmodeled, state the assumption
  explicitly instead of fabricating numbers).
- **Team** — what teammates must provide: amplification of the right type,
  buffs on swap-in, resource feeding, mechanic partners (module lists the
  game's team-coupling mechanics).
- **Player (manual)** — inputs the sim/rotation cannot automate: manually
  triggered mechanics, uptime discipline, positioning. List these as explicit
  instructions ("assert X at step N").

## Honesty rules

- Never invent abilities, keys, or effects not present in the kit data.
- Flag every ⚠ unknown-trigger effect rather than guessing its condition.
- State assumptions (energy availability, buff uptime approximations) in the
  report's Caveats section.
- If the kit data looks wrong or contradictory (a known failure mode —
  misclassified conditionals), say so and point at the data-quality process
  rather than working around it silently.

## Optional structured output

When the user wants the rotation for machine use (default rotations, optimizer
reference rotations), additionally emit the module's JSON shape (see the game
module) so it can be committed to a defaults table directly.
