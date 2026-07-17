# Team Effect Model — Design (P13 core)

**Status:** DRAFT for sign-off (2026-06-28). Maintainer directive: *model team-side
effects properly from the start — surgical refinement later would be a nightmare.*
This is the architecture for cross-member effects (enemy statuses, team-wide
buffs, persistence) that makes the team sim mechanically honest and the P13
team ranking trustworthy. Grounds in `docs/NEGATIVE-STATUS-REFERENCE.md` and
`docs/effect-audit.md`.

---

## 0. The rules (maintainer, 2026-06-28)

1. **Enemy-side gates/conditions/triggers/debuffs persist across resonator
   switching** and stay up as long as their uptime/stacks last. (Glacio Chafe,
   Fusion Burst, Tune Rupture/Strain, Spectro Frazzle, Aero Erosion, Electro
   Flare, Havoc Bane — all live on the *enemy*.)
2. **Team-wide effects** (those affecting resonators other than the source) are
   *described that way* in the kit text ("all team members", "all Resonators in
   the team", "nearby party members"). If the text does NOT say so, the buff is
   **personal** to the source and does not carry to others.
3. **Conditions, uptimes, states and triggers do NOT vanish on switching** the
   active resonator mid-combat (unless the kit says otherwise).

These three rules define three effect **scopes**: `enemy`, `team`, `self`.

---

## 1. Why (the concrete failure)

The current team sim sums each member's *solo* damage + outro buffs + off-field.
It models neither (a) a teammate applying a status that un-gates the carry's
amplifiers, nor (b) team-wide buffs reaching other members. Confirmed: Hiyuki
gains only **+2%** inside the curated Glacio-Chafe team, so the meta comp ranks
*below* a generic high-DPS pairing. The audit shows this is systemic — Aemeath's
"+60% Crit DMG when **the team** inflicts Fusion Burst", Luuk's "Tune Strain"
amplify, and every "all team members" ATK/element buff are invisible today; many
are already **deferred** for exactly this missing infra (Hiyuki Snow Rust,
Aemeath stack tiers, Lynae Premixed Hue).

---

## 2. The model

A team rotation produces, in addition to per-member step damage, **two shared
timelines** over team-rotation time:

### 2a. Enemy-status timeline (`enemy` scope)

Per negative-status type, the stack count over time, contributed by ANY member
whose kit/mode inflicts it, decaying by that status's own rule
(`NEGATIVE_STATUS_DEFS`). It persists across member switches (rule 1).

```js
// enemyStatusTimeline: status → [{ t, stacks, applicator }]  (step-change points)
// query: statusStacksAt(status, t) -> number ;  statusPresentDuring(status, win) -> bool
```

- **Who inflicts what** reuses + extends `triggerability.js`
  (`inflictsStatus`/`statusesInText`): each member's status-applying casts push
  stacks; the existing `NEGATIVE_STATUS_DEFS` give max-stacks + decay.
- **Application granularity (v1):** a member who *can* inflict status S applies a
  stack on each qualifying cast in their rotation (or, conservatively, marks S
  "present for their whole on-field window" when per-cast application is
  ambiguous). Stacks cap + decay per the defs. Refinement (exact per-hit stack
  counts) is additive and calibration-gated.

### 2b. Team-buff timeline (`team` scope)

Team-scoped buffs (rule 2) collected from every member, each active over its own
trigger × duration window, applied to **all** members' steps that fall in the
window. Personal (`self`) buffs stay on the source (today's behavior).

```js
// teamBuffWindows: [{ source, scope:'team', stat, value, payload, start, end }]
```

---

## 3. Scope classification (the load-bearing parser change)

Every parsed effect gets a `scope`:

| scope | detect from text | delivery |
| --- | --- | --- |
| `team` | "all team members", "all Resonators in the team", "(nearby) party members", "Resonators in the team", "team member(s)" | applied to every member's window |
| `enemy` | it INFLICTS a negative status (Glacio Chafe, Fusion Burst, Tune Rupture/Strain, Spectro Frazzle, Aero Erosion, Electro Flare, Havoc Bane) | pushes onto the enemy-status timeline |
| `self` | default (no team phrase) | source member only (unchanged) |

Plus, for buffs **gated on** an enemy status: a gate satisfied when **2a** has
that status present in the member's window — the *team-level* generalization of
P12's own-kit triggerability gate. **Crucially, only ENEMY-STATE / TEAM-INFLICT
gates are team-satisfiable; SELF-INFLICT gates are not** (`statusGateScope`):

| gate phrasing | scope | a teammate satisfies it? |
| --- | --- | --- |
| "**Inflicting** Glacio Chafe on enemies", "the wielder **applies** X", "when the Resonator **inflicts** X" | `self` | **NO** — the wielder must inflict it personally |
| "**Resonators in the team inflict** X" | `team` | yes |
| "targets **under** Tune Strain", "**hitting a target with** Aero Erosion", "targets **inflicted with** X", "**affected by** X" | `enemy` | yes (the enemy has it, any source) |
| no clear verb | `ambiguous` | no (conservative) |

This is the maintainer correction (2026-06-28): Wishes of Quiet Snowfall's +25%
Crit Rate is gated on the WIELDER inflicting Glacio Chafe → gaining the Snowfall
state → casting Liberation. A teammate putting Chafe on the enemy does NOT give a
non-inflicting carry that Crit Rate. (The only cross-member piece of Wishes is the
Snowfall holder's Outro granting +25% Glacio DMG to the incoming Resonator — a
team-wide L3 effect, owned by the *Wishes wielder*.) Almost every negative-status
SONATA is `self`; the team-satisfiable `enemy` cases are mostly WEAPONS
("targets under Tune Strain": Radiance Cleaver / Laser Shearer / Pulsation Bracer)
and a few sonatas (Windward Pilgrimage — "hitting a target with Aero Erosion").

Implemented in the existing parsers (`buffs.js parseEffectsFromDesc`,
`conditional-buffs.js`, `sonata-buffs.js`) — they already isolate the clause; we
add scope + enemy-gate tagging. Negative-status **amplify** additionally carries
`affectsNegativeStatus + negativeStatusTypes` (NEGATIVE-STATUS-REFERENCE §6) so
it never leaks into generic damage.

---

## 4. Resolution layers (build order)

> Layers L1–L3 fix the RANKING (the synergies that define these teams). L4 is
> additive DoT damage, much of it calibration-gated, and lands after.

- **L1 — Enemy-status timeline (presence + stacks).** Build 2a in `team-sim.js`
  from members' status-applying casts. New `src/core/enemy-status.js`
  (`NEGATIVE_STATUS_DEFS`, stack/decay, query helpers).
- **L2 — Team-aware gating.** A member's status-gated buff (`gate.enemyStatus`)
  is active when 2a has the status present in its window — from ANY member. This
  un-gates Aemeath/Hiyuki/Luuk synergies. Extends `canSatisfyCondition` to accept
  an `enemyStatusContext`. *L1+L2 is the minimum that makes the curated teams
  rank correctly.*
- **L3 — Team-wide buff propagation.** Build 2b; the team sim folds team-scoped
  buffs from every member into each member's per-step stats (reuses the
  conditional-buff buckets). Replaces the "all team members" effects' current
  no-op.
- **L4 — Negative-status DoT damage + Havoc Bane DEF shred.**
  `computeNegativeStatusDamage` (separate formula, NEGATIVE-STATUS-REFERENCE §2)
  attributed to `lastApplicator`'s level; Havoc Bane → `defShred` into every
  member's `computeDamage`. Spectro Frazzle + Aero Erosion have confirmed stack
  mults; the other four stay `null` (no DoT credited) until calibrated —
  conservative, never fabricated.

---

## 5. Synergy-aware builds (after L1–L3)

Once a team-applied status pays off, a carry's build should be chosen in team
context (a Chafe team → Hiyuki on Chafe-scaling gear, not the element default).
`team-rank.representativeMemberBuild` becomes team-context-aware; the substat
co-optimizer (P12 Phase C) already adapts since it re-runs the real sim.

---

## 6. Schema additions

```js
// parsed effect (buffs.js / conditional-buffs.js):
{ …, scope: 'self'|'team'|'enemy',
     gate?: { enemyStatus: 'glacio_chafe'|… },
     affectsNegativeStatus?: true, negativeStatusTypes?: ['glacio_chafe'|…|'all'] }
```

No change to `build.rotation` (linear) or stored builds. The timelines are
sim-time-only views (same discipline as the buff-timeline + rotation graph).

---

## 7. Invariants (do not regress)

- **Personal by default** — a buff with no team phrase never reaches other
  members (rule 2). Conservative: ambiguous scope → `self`.
- **NS amplify is separate** — status-specific amplify never flows into generic
  `computeDamage` (NEGATIVE-STATUS-REFERENCE §2e); generic amplify never flows
  into `computeNegativeStatusDamage`.
- **Enemy statuses persist across switches** (rule 1) — the timeline is global to
  the team rotation, not reset per member.
- **Conservative crediting** — an unclassifiable clause contributes 0; an
  uncalibrated NS DoT contributes 0 (not a guess).
- **Solo path unchanged** — single-resonator sim keeps own-kit gating (a solo
  resonator IS the whole "team", so 2a is just her own applications).
- `build.rotation` linear; timelines sim-time-only.

---

## 8. Test strategy

- L1: status timeline ramps/decays/caps; persists across member boundaries;
  applicator tracked.
- L2: a Chafe-gated buff is OFF solo (non-inflictor) but ON in a team with an
  inflictor; Aemeath's Fusion-Burst crit lights up only in a Fusion-Burst team.
- L3: an "all team members" ATK buff raises every member's damage; a personal
  buff does not.
- L4 (when built): NS-C1…NS-C5 from NEGATIVE-STATUS-REFERENCE §7; generic Spectro
  bonus does NOT raise Frazzle (NS-C4).
- Regression: full suite + module sweep green per layer; the curated Glacio-Chafe
  team out-ranks the generic pairing after L1–L3.

---

## 9. This-round scope / status

**SHIPPED: L1 + L2 + L3.**

- L1 enemy-status timeline (`enemy-status.js`) — per-cast accrual, persists across switches.
- L2 team-aware gating (`triggerability.statusGateScope` + `canSatisfyCondition`)
  — self-inflict stays personal, enemy-state/team-inflict are team-satisfiable.
- L3 team-wide buff propagation (`buffs.teamWideContribution` / `mergeTeamBundles`,
  threaded through `resolveTotalStats` + `simulateRotation` + `team-sim`) — "all
  team members" auras reach everyone; recipient-vs-actor distinguished; mode +
  sequence gated; full-uptime for the receiving window (v1).

**ALSO SHIPPED:**

- Havoc Bane → team DEF shred (`team-sim` reads the L1 timeline's havoc_bane
  stacks → `target.defShred` for every member's rotation + off-field). The
  calibration-free half of L4.
- Incoming-resonator transfer (`conditional-buffs.incomingResonatorContribution`,
  folded into the next member's team bundle) — Wishes' Snowfall Outro grants
  +25% Glacio DMG to the incoming, gated on the WIELDER's own inflict (self).
- Team-suggestions feature: meta team pass (§6) + `meta.teams` + meta-loader
  lookups + the build-page Suggested Teams panel (curated META pinned).
- Distinct-applicator tier buffs (`conditional-buffs.distinctApplicatorTierContribution`)
  — Hiyuki's Snow Rust (Fine Snow IH0) and Aemeath's Tune Rupture/Fusion Burst
  max-stack Liberation amplify (Between the Stars IH1.1/IH1.3), gated on how
  many DISTINCT teammates have inflicted a qualifying status, not per-cast.
- **NS DoT half of L4 — Glacio Chafe (2026-06-28)**: `computeNegativeStatusDamage`
  (`enemy-status.js`), calibrated against 3 real maintainer-sourced worked
  examples to <0.1% error (see `NEGATIVE-STATUS-REFERENCE.md` §2/§2c — the old
  `1.25078`-constant wiki formula was superseded by a real DefMult/ResMult
  split). Wired into `team-sim.js`: every Chafe application is its own damage
  instance scaled to its resulting stack count, credited to the applicator.

**REMAINING:**

- ~~The NS DoT half of L4 (`computeNegativeStatusDamage`) — Spectro Frazzle +
  Aero Erosion have confirmed stack mults; the other four stay null until
  calibrated.~~ Glacio Chafe done (above); Spectro Frazzle/Aero Erosion's
  EXISTING stack mults predate the corrected DefMult/ResMult formula and have
  NOT been re-verified against it (`NEGATIVE-STATUS-REFERENCE.md` §2 note) —
  may need re-derivation. Fusion Burst, Electro Flare still uncalibrated.
- **Tune Break formula confirmed but explicitly deferred** (maintainer
  direction 2026-06-28) — `computeTuneBreakDamage` exists + is calibration-
  tested (`NEGATIVE-STATUS-REFERENCE.md` §2f) but is NOT wired into the live
  sim. Needs an "off-tune buildup" gauge model (per-skill fill rate, plus
  who/when triggers the break) the engine has no data for — pushed to its own
  future "bonus phase," not silently dropped.
- Synergy-aware member builds (Chafe team → Chafe/Wishes gear) so the sim SCORE
  itself favours the curated comps (they're pinned regardless today).
- §9 3-way team comparison view.

Each layer ships with tests and keeps the solo path byte-identical.
