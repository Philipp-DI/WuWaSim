// src/core/types.js
/**
 * Central JSDoc type definitions (Simplification Plan S2.3).
 *
 * Type-only module: it exports nothing at runtime and is never imported by
 * engine code. Reference a type from any file by putting this tag inside a
 * JSDoc comment of its own:
 *
 *   @typedef {import('./types.js').Build} Build
 *
 * and opt a file into IDE type-checking by putting `// @ts-check` at its
 * top (jsconfig.json keeps checking off by default). Shapes here mirror the
 * authoritative doc comments in their owning modules (build.js, stats.js,
 * sim.js, formula.js, off-field.js, buffs.js) — if a shape changes, update
 * both places in the same commit.
 */

/**
 * One echo main-stat or substat roll.
 * @typedef {object} StatRoll
 * @property {number} propId   PropertyIndex id (see PROP in stats.js)
 * @property {number} addType  1 = flat, 2 = ratio (percent)
 * @property {number} value    flat amount, or fraction for ratio stats
 */

/**
 * One equipped echo slot (see build.js header).
 * @typedef {object} EchoSlot
 * @property {number} id        dataset.echoes[].id (family-level)
 * @property {1|3|4} cost
 * @property {number} level
 * @property {StatRoll} mainStat
 * @property {StatRoll[]} subStats  up to 5
 * @property {number} sonataId  active sonata set for this slot
 */

/**
 * The equipped weapon reference (see build.js header).
 * @typedef {object} WeaponEquip
 * @property {number} id     dataset.weapons[].id
 * @property {number} level
 * @property {number} rank   refinement / "tuning" (1..5)
 */

/**
 * A user's configuration of one resonator (BUILD_VERSION = 2; see build.js).
 * `rotation` is the PERSISTED format — always a linear array of skill keys.
 * @typedef {object} Build
 * @property {number} version
 * @property {string} id            local build id (not the resonator id)
 * @property {string} [name]
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {number} resonatorId   dataset.resonators[].id
 * @property {number} level
 * @property {number} chain         resonance chain 0..6
 * @property {{normal:number, skill:number, liberation:number, forte:number, intro:number}} skillLevels
 * @property {WeaponEquip|null} weapon
 * @property {Array<EchoSlot|null>} echoes  length 5
 * @property {string[]} rotation    ordered skill keys
 * @property {Object<string, boolean|number>} [effectToggles]  keys `S{level}.{index}` / `IH{node}.{index}`; integers = stack counts
 * @property {object} [statOverrides]
 */

/**
 * Enemy parameters for the damage formula (see formula.js header).
 * @typedef {object} Target
 * @property {number} level
 * @property {Object<number, number>} resistances  elementId → fraction (0.1 = 10% RES)
 * @property {number} [defShred]     0..1
 * @property {number} [defIgnore]    0..1
 * @property {number} [dmgReduction] 0..1
 */

/**
 * Output of resolveTotalStats (see stats.js header for the full breakdown).
 * @typedef {object} TotalStats
 * @property {number} atk
 * @property {number} hp
 * @property {number} def
 * @property {number} critRate   fraction (0..1+, clamped in the formula)
 * @property {number} critDmg    multiplier applied ON crit (1.5 = base)
 * @property {Object<number, number>} dmgBonusByElement    elementId → fraction
 * @property {Object<string, number>} dmgBonusBySkillType  formulaType bucket → fraction
 * @property {number} energyRegen  1.0 = 100%
 * @property {number} healingBonus
 * @property {object} breakdown    per-source math for the UI's "show your math" panel
 */

/**
 * One curated/auto skill-map entry (dataset.skillMap[resonatorId][skillKey]).
 * The skillType/formulaType split is the engine's central invariant — see
 * docs/GLOSSARY.md and CLAUDE.md.
 * @typedef {object} SkillDef
 * @property {string} skillType      MECHANICAL cast kind (node): basic/heavy/skill/liberation/intro/outro/forte_*
 * @property {string} [formulaType]  DATA-DRIVEN damage bucket; defaults to skillType when absent
 * @property {number[]} [damageIds]  rows in dataset.damageTable[resonatorId]
 * @property {number[]} [supportIds] heal/shield rows in dataset.supportTable[resonatorId]
 * @property {number} [stepDuration] seconds until the player regains control (measured from the game's animation assets for ~95% of steps, else a per-type approximation — see docs/TIMING_MODEL.md)
 * @property {number} [freezeTime] seconds of that window where the in-game clock is stopped (measured; 0 for almost everything but a Liberation)
 * @property {string} [freezeSource] identity of the animation the freeze came from — several keys can share one, and it only freezes once per rotation
 * @property {string} [timingSource] 'extracted' | 'curated' | 'estimated'
 * @property {string} [timingProvisional] 'state' | 'phaseOnly' | 'loop' when the measured value is known to be conditional, understated, or one iteration of a held loop
 * @property {boolean} [timingIsLoop] the animation repeats while held, so stepDuration is ONE iteration (orthogonal to timingProvisional, which reports only the strongest caveat)
 * @property {number} [cooldown]     seconds
 * @property {string} [label]
 */

/**
 * One executed cast in a sim result (as pushed by simulateRotation; team-sim
 * and the buff-window pass annotate copies with additional fields such as
 * gameStartTime and per-step buff scaling).
 * @typedef {object} SimStep
 * @property {number} index
 * @property {string} skillKey
 * @property {string} label
 * @property {string} skillType
 * @property {number} stepDuration
 * @property {number} startTime
 * @property {number} endTime
 * @property {number} freezeTime
 * @property {string} timingSource
 * @property {number} stepDamage
 * @property {number} stepCrit
 * @property {number} stepNonCrit
 * @property {number} hitCount
 * @property {number} stepHeal
 * @property {number} stepShield
 * @property {Array<object>|null} supportOutput
 * @property {number} cumulativeDamage
 * @property {object|null} resolved   full ResolvedSkill (per-hit formula breakdowns)
 * @property {boolean} missing        true for rotation keys absent from the skill map
 */

/**
 * Aggregate totals of one simulated rotation.
 * @typedef {object} SimTotals
 * @property {number} damage
 * @property {number} crit
 * @property {number} nonCrit
 * @property {number} heal
 * @property {number} shield
 * @property {number} time      real-time seconds
 * @property {number} gameTime  time minus freeze (two-clock model, docs/TIMING_MODEL.md)
 * @property {number} dps
 * @property {number} hits
 * @property {number} stepCount
 * @property {string[]} missingSteps
 */

/**
 * Return shape of simulateRotation — stable even on empty input.
 * @typedef {object} SimResult
 * @property {SimStep[]} steps
 * @property {Array<object>} buffWindows
 * @property {Array<object>} buffTimeline
 * @property {Array<object>} effectWindows
 * @property {Array<object>} stateWindows
 * @property {Array<object>} energyTrace
 * @property {Array<object>} cooldownViolations
 * @property {SimTotals} totals
 * @property {TotalStats} stats
 */

/**
 * Unified buff model — always create via makeBuffEffect() in buffs.js.
 * @typedef {object} BuffEffect
 * @property {'resonator'|'weapon'|'echo'|'echoSet'|'outro'|'team'} owner
 * @property {'self'|'active'|'teamWide'|'incomingResonator'} scope
 * @property {string} stat    BuffStat name
 * @property {number} value   fraction for % stats
 * @property {object} payload e.g. { elementId } | { skillType } | { duration }
 * @property {string} label
 */

/**
 * Benched-member damage action (see off-field.js).
 * @typedef {object} OffFieldAction
 * @property {'coordinated'|'turret'|'outroBurst'} type
 * @property {'liberation'|'outro'|'skill'|'forte'} trigger
 * @property {number} element    elementId 1–6
 * @property {'atk'|'def'|'hp'} scaling
 * @property {number} multiplier
 * @property {number} [hitsPerCast]  outroBurst only
 * @property {number|null} cooldown
 * @property {number|null} duration  null = whole window
 * @property {string} note
 * @property {string} [requiresState]
 */

export {};
