/**
 * Weapon passive modeling (P12).
 *
 * Weapon base ATK + secondary stat are already applied (stats.js
 * weaponContribution). This module adds the weapon's PASSIVE effect — at least
 * its always-on leading stat ("ATK is increased by {0}", "Increases Energy Regen
 * by {0}", "Increases Attribute DMG Bonus by {0}", ...), which differentiates
 * weapons that share a secondary (e.g. Frostburn's +ATK% passive vs Emerald of
 * Genesis's +ER passive) and so is essential for ranking weapons in the
 * suggested-build search.
 *
 * Scope: the unconditional leading stat only. The conditional clauses ("when you
 * cast …, gain …", stacking buffs, status-gated amplifies) are NOT modeled here
 * yet — they need the same triggerability gating as sonata 5pc and per-buff
 * uptime, a larger effort. Returns the same bucket shape resolveTotalStats folds.
 */

const ELEMENT_NAMES = Object.freeze({
    glacio: 1, fusion: 2, electro: 3, aero: 4, spectro: 5, havoc: 6,
});

function emptyPassive() {
    return { atkRatio: 0, hpRatio: 0, defRatio: 0, critRate: 0, critDmg: 0, energyRegen: 0, dmgByElement: {}, dmgBySkillType: {} };
}

// A leading stat phrase → which bucket it adds to.
function statBucket(phrase) {
    const p = (phrase || '').toLowerCase().trim();
    if (/all[- ]?attribute dmg bonus|attribute dmg bonus/.test(p)) return { kind: 'allElement' };
    for (const [name, el] of Object.entries(ELEMENT_NAMES)) {
        if (p.includes(`${name} dmg`)) return { kind: 'element', el };
    }
    if (/energy regen/.test(p)) return { kind: 'energyRegen' };
    if (/crit\.?\s*rate/.test(p)) return { kind: 'critRate' };
    if (/crit\.?\s*dmg/.test(p)) return { kind: 'critDmg' };
    if (/max\s*hp|\bhp\b/.test(p)) return { kind: 'hpRatio' };
    if (/\bdef\b/.test(p)) return { kind: 'defRatio' };
    if (/\batk\b/.test(p)) return { kind: 'atkRatio' };
    // Skill-type DMG bonuses (weapon leading stat, e.g. "Resonance Liberation DMG Bonus by {0}")
    if (/resonance liberation|liberation dmg/.test(p)) return { kind: 'dmgType', type: 'liberation' };
    if (/resonance skill|skill dmg/.test(p)) return { kind: 'dmgType', type: 'skill' };
    if (/heavy attack|heavy dmg/.test(p)) return { kind: 'dmgType', type: 'heavy' };
    if (/basic attack|basic dmg/.test(p)) return { kind: 'dmgType', type: 'basic' };
    if (/intro skill|intro dmg/.test(p)) return { kind: 'dmgType', type: 'intro' };
    return null;
}

// "24%" → 0.24; non-percent / unparseable → 0.
function pct(str) {
    const m = String(str ?? '').match(/([\d.]+)\s*%/);
    return m ? Number(m[1]) / 100 : 0;
}

/**
 * Always-on passive stat contribution of a weapon at a refinement rank (1..5).
 * @param {object} weaponDef  — dataset weapon (effect + effectParams)
 * @param {number} rank       — refinement 1..5 (effectParams index rank-1)
 * @returns {{atkRatio,hpRatio,defRatio,critRate,critDmg,energyRegen,dmgByElement}}
 */
export function weaponPassiveStats(weaponDef, rank = 1) {
    const out = emptyPassive();
    const effect = weaponDef?.effect;
    const p0 = weaponDef?.effectParams?.[0];
    if (!effect || !Array.isArray(p0) || p0.length === 0) return out;

    // Leading stat phrase, before "by {0}" / "{0}" / "+ {0}".
    const m = effect.match(/^\s*(?:increases?\s+)?(.+?)\s+(?:is\s+|are\s+)?increased by \{0\}/i)
        || effect.match(/^\s*increases?\s+(.+?)\s+by \{0\}/i)
        || effect.match(/^\s*(.+?)\s*\+\s*\{0\}/i)
        || effect.match(/^\s*(.+?)\s+by \{0\}/i);
    if (!m) return out;

    const bucket = statBucket(m[1]);
    if (!bucket) return out;

    const index = Math.max(0, Math.min((rank | 0) - 1, p0.length - 1));
    const value = pct(p0[index]);
    if (value <= 0) return out;

    switch (bucket.kind) {
        case 'atkRatio': out.atkRatio += value; break;
        case 'hpRatio': out.hpRatio += value; break;
        case 'defRatio': out.defRatio += value; break;
        case 'critRate': out.critRate += value; break;
        case 'critDmg': out.critDmg += value; break;
        case 'energyRegen': out.energyRegen += value; break;
        case 'element': out.dmgByElement[bucket.el] = (out.dmgByElement[bucket.el] || 0) + value; break;
        case 'allElement': for (let el = 1; el <= 6; el++) out.dmgByElement[el] = (out.dmgByElement[el] || 0) + value; break;
        case 'dmgType': out.dmgBySkillType[bucket.type] = (out.dmgBySkillType[bucket.type] || 0) + value; break;
        default: break;
    }
    return out;
}
