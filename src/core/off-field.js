import { stateActive } from './rotation-state.js';

/**
 * Off-field damage model.
 *
 * "Off-field damage" means a resonator contributes damage while another
 * resonator is the active (on-field) character. The sim accounts for this
 * by computing each off-field resonator's contribution during every team
 * rotation window.
 *
 * Three distinct mechanics require different handling:
 *
 * ─────────────────────────────────────────────────────────────────────────
 * TYPE 1 — COORDINATED ATTACK
 *   Triggers on every on-field hit, rate-limited.
 *   Characters: Mortefi (lib), Jiyan (outro), Zhezhi (lib), Yuanwu (skill),
 *               Yinlin (forte), Verina (lib), Cantarella (lib/forte), Baizhi (lib)
 *   Modelled as: hitsPerSecond × multiplier × off-field char's ATK
 *   hitsPerSecond = 1 / cooldown
 *   Window: the off-field duration (time since the skill/outro that set it up)
 *
 * TYPE 2 — PERSISTENT SUMMON / TURRET
 *   Deployed entity deals damage on a fixed timer.
 *   Characters: Rebecca (turret), Rover:Havoc (outro field), Calcharo (phantom)
 *   Modelled as: hitsPerDuration × multiplier × off-field char's ATK
 *   hitsPerDuration = Math.floor(window / interval)
 *
 * TYPE 3 — OUTRO BURST (outgoing char fires once on switch-out)
 *   Only Galbrena has real outro DMG params in the dataset.
 *   Phrolova's Hecate is conditional on Maestro state — handled as a
 *   special note rather than auto-modelled (state tracking is Phase 10).
 *   Modelled as: single-shot damage at the outro transition moment.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Data source: `resonator.offFieldActions[]` projected by preprocess.mjs.
 *
 * OffFieldAction shape:
 *   {
 *     type:        'coordinated' | 'turret' | 'outroBurst'
 *     trigger:     'liberation' | 'outro' | 'skill' | 'forte'   (what sets it up)
 *     element:     number       (elementId of the damage)
 *     scaling:     'atk' | 'def' | 'hp'
 *     multiplier:  number       (fraction, e.g. 0.18 for 18% ATK)
 *     hitsPerCast: number | null (outroBurst: hits in the burst; coordinated: optional total-hit cap)
 *     cooldown:    number | null (seconds between coordinated/turret hits; null = no limit)
 *     duration:    number | null (how long the action is active, null = whole rotation)
 *     note:        string        (human-readable condition/caveat)
 *     requiresState?: string    (P10-2) optional — action is skipped unless this
 *                                state name appears in the memberStates set passed
 *                                to computeOffFieldContribution. Matched with the
 *                                same fuzzy logic as stateActive() in rotation-state.
 *   }
 */

// =============================================================================
// Damage computation
// =============================================================================

/**
 * Compute the total off-field damage a resonator deals during a given window.
 *
 * @param {object}   args
 * @param {object}   args.action          — OffFieldAction from resonator.offFieldActions
 * @param {object}   args.stats           — resolveTotalStats(build, dataset) of the off-field char
 * @param {number}   args.windowSeconds   — how long the on-field char's window lasts
 * @param {object}   args.target          — enemy parameters
 * @param {import('./formula.js').computeDamage} args.computeDamage
 * @returns {{ damage: number, hits: number, label: string }}
 */
export function computeOffFieldDamage({ action, stats, windowSeconds, target, computeDamage }) {
    const { type, element, scaling, multiplier, hitsPerCast, cooldown, duration } = action;

    // Active window: the shorter of action.duration and the rotation window.
    // If duration is null, the action is assumed active for the whole window.
    const activeWindow = duration != null ? Math.min(duration, windowSeconds) : windowSeconds;

    let hits = 0;
    switch (type) {
        case 'coordinated':
            // Rate-limited: one hit per `cooldown` seconds during the active window,
            // capped at `hitsPerCast` total when the kit caps total instances (e.g.
            // Cantarella's Diffusion: ≤1 Dreamweaver/s, ≤21 Dreamweavers total).
            hits = cooldown > 0 ? activeWindow / cooldown : 0;
            if (hitsPerCast != null) hits = Math.min(hits, hitsPerCast);
            break;
        case 'turret':
            // Periodic: floor(window / interval) hits.
            hits = cooldown > 0 ? Math.floor(activeWindow / cooldown) : 0;
            break;
        case 'outroBurst':
            // Single burst at the transition moment — hitsPerCast parallel hits.
            hits = hitsPerCast ?? 1;
            break;
        default:
            return { damage: 0, hits: 0, label: `Unknown type: ${type}` };
    }

    if (hits <= 0) return { damage: 0, hits: 0, label: action.note || action.type };

    // Compute damage for a single hit, then scale by hit count.
    const scalingKey = scaling ?? 'atk';
    const scalingStat = stats[scalingKey] ?? 0;

    const skill = {
        skillType:  'basic',    // off-field damage uses the generic ATK bonus bucket
        multiplier: multiplier,
        scaling:    scalingKey,
        element:    element,
    };

    const result = computeDamage({ stats, skill, target });
    const totalDamage = result.expected * hits;

    return {
        damage: totalDamage,
        hits:   Math.round(hits * 100) / 100,
        label:  action.note || `${type} × ${hits.toFixed(1)} hits`,
    };
}

// =============================================================================
// Off-field contribution across a whole member window
// =============================================================================

/**
 * Compute the total off-field damage contribution of one resonator over a
 * window in which another resonator is on-field.
 *
 * Called by team-sim for each (off-field resonator, window) pair.
 *
 * @param {object}       args
 * @param {object}       args.build           — off-field resonator's build
 * @param {object}       args.dataset
 * @param {object}       args.stats           — pre-resolved stats for this build
 * @param {number}       args.windowSeconds   — the on-field member's window duration
 * @param {object}       args.target
 * @param {import('./formula.js').computeDamage} args.computeDamage
 * @param {Set<string>}  [args.memberStates]  — (P10-2) states ever active in the
 *                                              off-field member's rotation, used to
 *                                              gate actions with requiresState
 * @returns {{ totalDamage: number, actions: Array<{action, damage, hits, label}> }}
 */
export function computeOffFieldContribution({
    build, dataset, stats, windowSeconds, target, computeDamage, memberStates = null,
}) {
    const reso = dataset.resonators?.find(r => r.id === build.resonatorId);
    const actions = reso?.offFieldActions ?? [];

    if (actions.length === 0) return { totalDamage: 0, actions: [] };

    const results = [];
    for (const action of actions) {
        // Skip state-gated actions when the required state was never active.
        if (action.requiresState && memberStates != null &&
            !stateActive(memberStates, action.requiresState)) continue;
        const r = computeOffFieldDamage({ action, stats, windowSeconds, target, computeDamage });
        results.push({ action, ...r });
    }

    return {
        totalDamage: results.reduce((s, r) => s + r.damage, 0),
        actions: results,
    };
}
