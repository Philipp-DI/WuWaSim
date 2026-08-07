/**
 * Put a parsed effect in the BUCKET the game puts it in.
 *
 * `computeDamage` composes three lanes, and the client's own
 * `CharacterDamageCalculations.js` has the same shape:
 *
 *     t = 1 + Proto_DamageChange + elementBonus + attackTypeBonus   ← ADDITIVE
 *     damage = … * t * (1 - Proto_DamageReduce) * (1 + Proto_SpecialDamageChange)
 *
 * so `dmgBonus` / `elementBonus` / `skillTypeBonus` are one additive bucket and
 * `amplify` is a separate multiplicative one. The engine's SHAPE was right all
 * along; what it got wrong is which bucket a value lands in.
 *
 * That assignment cannot come from the kit text, because the game does not
 * decide it from the wording — identical English lands in different lanes:
 *
 *     Sigrika    "targets take 30% more DMG"  → SpecialDamageChange, multiplicative
 *     Cartethyia "take 30% more DMG"          → DamageChange, ADDITIVE
 *     Yinlin     "deal 70% more DMG"          → DamageChange, ADDITIVE
 *
 * So the game's own table is the primary source here and the text parse is the
 * fallback: an effect is moved only when `data/buff-facts.json` has an
 * unambiguous answer for that resonator and value, and is left exactly as parsed
 * otherwise. The extractor already refuses to emit a value whose bucket differs
 * between two buffs of the same owner, so "no answer" really means no answer.
 *
 * Deliberately NOT retargeted: `multiplierUp`. It is the skill's own damage
 * RATE, not a bonus bucket at all — it multiplies before any of this.
 *
 * The same file also carries SCOPE, from `ExtraEffectRequirements` type 1 — an
 * explicit list of skill ids, resolved to our keys by prefix against
 * hit-map.json. That is strictly better than `skill-scope.mjs`'s name matching,
 * which fails whenever a kit's display name shares no token with its key
 * ("Foreclaiming: Inward Vision" → `liberation_inward_vision`). It only ever
 * FILLS IN a scope: an effect that already resolved one keeps it, because
 * skill-scope may have read a narrower clause than the buff covers.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FACTS_PATH = resolve(__dirname, '../../data/buff-facts.json');

// The stats that name a damage increase and therefore have a bucket to get
// wrong. `multiplierUp` is absent on purpose (see the note above).
const ADDITIVE_STATS = new Set(['dmgBonus', 'elementBonus', 'skillTypeBonus']);
const RETARGETABLE = new Set([...ADDITIVE_STATS, 'amplify']);

export function loadBuffFacts(path = FACTS_PATH) {
    if (!existsSync(path)) return {};
    return JSON.parse(readFileSync(path, 'utf8')).facts ?? {};
}

// The coarse family a scope is keyed by, mirroring the extractor. Keyed on
// value ALONE the join collides: Hiyuki's +500% Crit. DMG and her separate 500%
// amplify are different mechanics on different skills, and the crit clause was
// inheriting the amplify's scope.
function familyOf(stat) {
    if (stat === 'critRate' || stat === 'critDmg') return stat;
    if (RETARGETABLE.has(stat)) return 'damage';
    return 'other';
}

/** The additive stat that preserves an effect's own scope. */
function additiveStatFor(effect) {
    if (effect.element != null) return 'elementBonus';
    if (effect.skillType != null) return 'skillTypeBonus';
    return 'dmgBonus';
}

/**
 * Move each of a resonator's effects into the game's bucket. Mutates in place
 * and fills in the scope the game states. Mutates in place; returns both
 * tallies for the preprocess log.
 */
export function applyBuffFacts(resonator, facts) {
    const owned = facts?.[String(resonator.id)];
    if (!owned) return { moved: 0, scoped: 0 };
    let moved = 0, scoped = 0;
    const nodes = [...(resonator.resonanceChain ?? []), ...(resonator.inherentSkills ?? [])];
    for (const node of nodes) {
        for (const effect of node.effects ?? []) {
            const value = effect.stackable ? effect.perStack : effect.value;
            if (!(value > 0)) continue;
            // The key is the VALUE, not the stat — the stat is what is being
            // corrected, so joining on it would be circular.
            const fact = owned[String(Number(value.toFixed(6)))];
            if (!fact) continue;
            const bucket = fact.bucket;

            // Scope first: it applies whatever the bucket says, and an effect
            // with no scope is the one that most needs it.
            const scope = fact.scopeByFamily?.[familyOf(effect.stat)];
            if (scope?.length && !effect.skillKeys?.length) {
                effect.skillKeys = [...scope];
                effect.scopeSource = 'configdb';
                scoped++;
            }

            // The BUCKET only means anything for a damage-increase stat; SCOPE
            // (above) applies to any of them, which is the point — Suisui's
            // +500% Crit. DMG has no bucket to correct and every need of a scope.
            if (!RETARGETABLE.has(effect.stat)) continue;
            const isAdditive = ADDITIVE_STATS.has(effect.stat);
            if (bucket === 'additive' && !isAdditive) {
                effect.stat = additiveStatFor(effect);
                effect.bucketSource = 'configdb';
                moved++;
            } else if (bucket === 'amplify' && isAdditive) {
                effect.stat = 'amplify';
                effect.bucketSource = 'configdb';
                moved++;
            }
        }
    }
    return { moved, scoped };
}
