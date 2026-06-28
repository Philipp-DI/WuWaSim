/**
 * Conditional buff extraction (P12) — weapons + multi-stage sonata clauses.
 *
 * Parses the conditional clauses of a weapon effect or sonata tier into a flat
 * stat / amplify contribution, applied at FULL value (theorycrafting full-uptime
 * + full stacks) AFTER triggerability gating: a clause activated by a STATUS the
 * wielder can't inflict (Glacio Chafe on a non-Chafe resonator) contributes
 * nothing; self-action clauses (cast a skill, deal damage) always count.
 *
 * Buckets:
 *   atkRatio / hpRatio / defRatio / critRate / critDmg / energyRegen — flat stats
 *   dmgByElement / dmgBySkillType — additive DMG-bonus buckets
 *   amplifyByElement / amplifyByType / amplifyAll — multiplicative amplify bucket
 *   defIgnore — fraction of enemy DEF ignored
 *
 * Conservative by design: it only emits a buff for a clause it can clearly
 * classify (recognised stat phrase + a percentage), and gates anything
 * status-dependent. Unrecognised clauses contribute nothing (we'd rather
 * under-credit than over-credit, per the suggested-build accuracy work).
 */

import { canSatisfyCondition } from './triggerability.js';

const ELEMENT_NAMES = Object.freeze({ glacio: 1, fusion: 2, electro: 3, aero: 4, spectro: 5, havoc: 6 });
const TYPE_PHRASES = Object.freeze([
    ['resonance liberation', 'liberation'],
    ['resonance skill', 'skill'],
    ['heavy attack', 'heavy'],
    ['basic attack', 'basic'],
    ['intro skill', 'intro'],
]);

export function emptyContribution() {
    return {
        atkRatio: 0, hpRatio: 0, defRatio: 0, critRate: 0, critDmg: 0, energyRegen: 0,
        dmgByElement: {}, dmgBySkillType: {},
        amplifyByElement: {}, amplifyByType: {}, amplifyAll: 0,
        defIgnore: 0,
    };
}

/** Substitute {N} placeholders with the value at refinement `rank` (1..5). */
export function substituteParams(effect, effectParams, rank = 1) {
    return String(effect ?? '').replace(/\{(\d+)\}/g, (_, n) => {
        const arr = effectParams?.[Number(n)];
        if (!Array.isArray(arr)) return '';
        return arr[Math.min(Math.max(rank - 1, 0), arr.length - 1)] ?? '';
    });
}

const pct = (s) => { const m = String(s).match(/([\d.]+)\s*%/); return m ? Number(m[1]) / 100 : 0; };

// Classify a stat phrase (with the verb that introduced it) into a bucket.
function classify(statPhrase, amplify) {
    const p = statPhrase.toLowerCase();
    for (const [name, el] of Object.entries(ELEMENT_NAMES)) {
        if (p.includes(`${name} dmg`)) return amplify ? { bucket: 'amplifyElement', key: el } : { bucket: 'dmgElement', key: el };
    }
    for (const [phrase, type] of TYPE_PHRASES) {
        if (p.includes(phrase)) return amplify ? { bucket: 'amplifyType', key: type } : { bucket: 'dmgType', key: type };
    }
    if (/all[- ]?attribute|attribute dmg/.test(p)) return { bucket: 'dmgAll' };
    if (/crit\.?\s*rate/.test(p)) return { bucket: 'critRate' };
    if (/crit\.?\s*dmg/.test(p)) return { bucket: 'critDmg' };
    if (/energy regen/.test(p)) return { bucket: 'energyRegen' };
    if (/\batk\b/.test(p)) return { bucket: 'atkRatio' };
    if (/\bmax\s*hp\b|\bhp\b/.test(p)) return { bucket: 'hpRatio' };
    if (/\bdef\b/.test(p)) return { bucket: 'defRatio' };
    return null;
}

function addBuff(out, cls, value) {
    if (!cls || value <= 0) return;
    switch (cls.bucket) {
        case 'atkRatio': out.atkRatio += value; break;
        case 'hpRatio': out.hpRatio += value; break;
        case 'defRatio': out.defRatio += value; break;
        case 'critRate': out.critRate += value; break;
        case 'critDmg': out.critDmg += value; break;
        case 'energyRegen': out.energyRegen += value; break;
        case 'dmgElement': out.dmgByElement[cls.key] = (out.dmgByElement[cls.key] || 0) + value; break;
        case 'dmgType': out.dmgBySkillType[cls.key] = (out.dmgBySkillType[cls.key] || 0) + value; break;
        case 'dmgAll': for (let el = 1; el <= 6; el++) out.dmgByElement[el] = (out.dmgByElement[el] || 0) + value; break;
        case 'amplifyElement': out.amplifyByElement[cls.key] = (out.amplifyByElement[cls.key] || 0) + value; break;
        case 'amplifyType': out.amplifyByType[cls.key] = (out.amplifyByType[cls.key] || 0) + value; break;
        default: break;
    }
}

// Extract every buff statement in one clause (a clause shares a trigger).
function extractClause(clause, stacks, out) {
    // DEF ignore: "ignores 10% of the target's DEF"
    const defIg = clause.match(/ignores?\s+([\d.]+%)\s+of[^.]*\bdef\b/i);
    if (defIg) out.defIgnore += pct(defIg[1]) * stacks;

    // "{stat} (is) Amplified/increased by {value}"  (stat precedes the verb)
    const re1 = /([A-Za-z][\w.'\- ]*?)\s+(?:is\s+|are\s+)?(amplified|increased)\s+by\s+([\d.]+\s*%)/gi;
    let m;
    while ((m = re1.exec(clause))) {
        addBuff(out, classify(m[1], /amplif/i.test(m[2])), pct(m[3]) * stacks);
    }
    // "increases {stat} by {value}"  (verb precedes the stat)
    const re2 = /increases?\s+([\w.'\- ]*?)\s+by\s+([\d.]+\s*%)/gi;
    while ((m = re2.exec(clause))) {
        addBuff(out, classify(m[1], false), pct(m[2]) * stacks);
    }
    // "grants {value} {stat}" / "gains {value} {stat}"
    const re3 = /(?:grants?|gains?)\s+(?:the equipper\s+|the wielder\s+)?([\d.]+\s*%)\s+([\w.'\- ]*?)(?:\s+for\s+\d|[.,]|$)/gi;
    while ((m = re3.exec(clause))) {
        addBuff(out, classify(m[2], false), pct(m[1]) * stacks);
    }
}

/**
 * Extract the conditional buff contribution from a resolved (param-substituted)
 * effect text. The first sentence is the always-on leading stat (handled by
 * weapon-buffs.js for weapons) and is skipped by default.
 *
 * @param {string} text                — resolved effect text
 * @param {object} opts
 * @param {object} opts.resonator      — wielder (for triggerability)
 * @param {object} opts.dataset
 * @param {boolean} [opts.skipFirstSentence=true]
 * @param {Set<string>} [opts.enemyStatuses] — team-inflicted statuses (P13 L2);
 *        null → solo own-kit gating (unchanged).
 */
export function extractConditionalContribution(text, { resonator, dataset, skipFirstSentence = true, enemyStatuses = null } = {}) {
    const out = emptyContribution();
    // Normalise the "Crit." abbreviation so its period isn't treated as a
    // sentence boundary (it would split "Crit. Rate by 25%" in two). classify()
    // already tolerates the missing period.
    const normalised = String(text ?? '').replace(/\bCrit\.\s*/gi, 'Crit ');
    const sentences = normalised.split(/(?<=[.!])\s+/).filter(Boolean);
    for (let i = skipFirstSentence ? 1 : 0; i < sentences.length; i++) {
        const sentence = sentences[i];
        if (!canSatisfyCondition(resonator, dataset, sentence, enemyStatuses)) continue;   // status gate (team-aware)
        const stackM = sentence.match(/stacking up to (\d+)/i);
        const stacks = stackM ? Number(stackM[1]) : 1;
        // Split into clauses that share the sentence's trigger.
        for (const clause of sentence.split(/,?\s+and\s+|;\s*/i)) {
            extractClause(clause, stacks, out);
        }
    }
    return out;
}

/** Conditional contribution of a weapon's passive at a refinement rank. */
export function weaponConditionalContribution(weaponDef, rank, resonator, dataset, enemyStatuses = null) {
    if (!weaponDef?.effect) return emptyContribution();
    const text = substituteParams(weaponDef.effect, weaponDef.effectParams, rank);
    return extractConditionalContribution(text, { resonator, dataset, skipFirstSentence: true, enemyStatuses });
}

/**
 * Sonata conditional contribution — ONLY the buckets the existing sonata window
 * path (parseSonataBuffs → computeBuffWindows) does NOT model: Crit Rate, Crit
 * DMG, amplify, DEF-ignore (the window path covers element / ATK / type DMG
 * bonus, so those are deliberately excluded here to avoid double-counting). This
 * captures multi-stage mechanics like Wishes of Quiet Snowfall's "+25% Crit Rate
 * after Liberation DMG". Full-uptime, gated by triggerability.
 */
export function sonataConditionalContribution(build, dataset, resonator, enemyStatuses = null) {
    const out = { critRate: 0, critDmg: 0, amplifyByElement: {}, amplifyByType: {}, amplifyAll: 0, defIgnore: 0 };
    const counts = {};
    for (const e of build?.echoes ?? []) if (e?.sonataId != null) counts[e.sonataId] = (counts[e.sonataId] || 0) + 1;
    for (const [idStr, count] of Object.entries(counts)) {
        const sonata = dataset?.sonatas?.find(s => s.id === Number(idStr));
        if (!sonata) continue;
        for (const tier of sonata.tiers ?? []) {
            if (count < tier.pieces) continue;
            // Tier-level gate: a multi-stage tier is unreachable if its PRIMARY
            // status activation can't be met (e.g. Wishes' whole Snowfall chain
            // requires inflicting Glacio Chafe — its downstream crit clause doesn't
            // re-name the status, so per-sentence gating alone would miss it).
            // Team-aware: a teammate inflicting the status satisfies the gate.
            if (!canSatisfyCondition(resonator, dataset, tier.effect, enemyStatuses)) continue;
            // Sonata tier text already has values inline (no {N} placeholders) and
            // its first sentence can itself be conditional → process all sentences.
            const c = extractConditionalContribution(tier.effect, { resonator, dataset, skipFirstSentence: false, enemyStatuses });
            out.critRate += c.critRate;
            out.critDmg += c.critDmg;
            out.defIgnore += c.defIgnore;
            for (const [el, v] of Object.entries(c.amplifyByElement)) out.amplifyByElement[el] = (out.amplifyByElement[el] || 0) + v;
            for (const [t, v] of Object.entries(c.amplifyByType)) out.amplifyByType[t] = (out.amplifyByType[t] || 0) + v;
            out.amplifyAll += c.amplifyAll;
        }
    }
    return out;
}
