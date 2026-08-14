// src/core/buffs/external-buffs.js — the game's OWN buff rows, routed by
// attribute id instead of parsed out of English.
//
// An "external" buff is one a resonator receives from gear rather than from its
// own kit: a weapon passive, a sonata set bonus, an echo skill. The text readers
// in this directory derive those from tooltips, which fails three ways at once —
// a value written before its stat is unread, a source stating two grants can
// only carry one, and a stat the reader cannot classify is applied as a flat
// multiplier. `data/external-buffs.json` removes the guessing: one row per
// grant, each carrying the attribute id the game itself modifies.
//
// This module is deliberately only a TRANSLATOR. It answers "which engine bucket
// does game attribute N belong to, and what does this grant add to it" — nothing
// about uptime, triggers or stacking, which stay with the callers that already
// model them. Keeping it that narrow is what lets it slot under the existing
// contribution shape without changing any call site.
//
// The attribute ids are the client's own (`Proto_*` in Protocol.js) and are the
// SAME numbers `stats.js` PROP already uses — 7 Atk, 8 Crit, 9 CritDamage,
// 21..27 the element DMG bonuses, 35 HealChange. tests/external-buffs.test.mjs
// pins that so the two can never drift apart silently.

// Element DMG bonus: attribute 21 + elementId (22 = Glacio … 27 = Havoc), the
// same offset CLAUDE.md fixes for echo main stats.
const ELEMENT_DMG_BASE = 21;
// The TARGET's resistance, one attribute per element (28 physical, 29 = Glacio
// … 34 = Havoc). The game writes a resistance SHRED as a negative value here,
// which is why Everbright Polestar's "ignores 10% Fusion RES" arrives as -0.10
// on attribute 30 rather than as an ignore attribute.
const ELEMENT_RES_BASE = 28;
// Attacker-side resistance IGNORE, same layout (100 physical, 101 = Glacio …).
const ELEMENT_RES_IGNORE_BASE = 100;

// Skill-type DMG bonuses. These four ids are confirmed by the game's own substat
// names in `dataset.echoSubStats`: 14 "Resonance Skill DMG Bonus", 17 "Basic
// Attack DMG Bonus", 18 "Heavy Attack DMG Bonus", 19 "Resonance Liberation DMG
// Bonus". 20 (Qte) is the Intro Skill lane, which has no echo substat and so had
// no propId in PROP at all.
const SKILL_TYPE_BY_ATTRIBUTE = Object.freeze({
    14: 'skill',
    17: 'basic',
    18: 'heavy',
    19: 'liberation',
    20: 'intro',
    114: 'echo',
});

const SIMPLE_BY_ATTRIBUTE = Object.freeze({
    7: 'atkRatio',
    9: 'critDmg',
    10: 'defRatio',
    8: 'critRate',
    11: 'energyRegen',
});

/**
 * The engine bucket a game attribute belongs to.
 *
 * Returns null for anything the damage pipeline does not model (Proto_Energy,
 * Proto_ElementEnergy, Proto_HealChange …). A null is a deliberate SKIP, not a
 * failure: crediting an unmodelled attribute as a generic damage bonus is the
 * exact over-crediting the text path already does.
 *
 * @param {number} attribute — the game's Proto_* attribute id
 * @returns {{bucket:string, key?:string|number}|null}
 */
export function bucketForAttribute(attribute) {
    const id = Number(attribute);
    if (!Number.isFinite(id)) return null;

    if (SIMPLE_BY_ATTRIBUTE[id]) return { bucket: SIMPLE_BY_ATTRIBUTE[id] };
    if (SKILL_TYPE_BY_ATTRIBUTE[id]) return { bucket: 'dmgBySkillType', key: SKILL_TYPE_BY_ATTRIBUTE[id] };
    // Proto_DamageChange — a bonus scoped to nothing, i.e. every hit.
    if (id === 15) return { bucket: 'dmgAll' };
    // Proto_SpecialDamageChange — the multiplicative lane, our `amplify`.
    if (id === 95) return { bucket: 'amplifyAll' };
    if (id === 99) return { bucket: 'defIgnore' };
    if (id > ELEMENT_DMG_BASE && id <= ELEMENT_DMG_BASE + 6) {
        return { bucket: 'dmgByElement', key: id - ELEMENT_DMG_BASE };
    }
    if (id > ELEMENT_RES_BASE && id <= ELEMENT_RES_BASE + 6) {
        return { bucket: 'resistanceByElement', key: id - ELEMENT_RES_BASE };
    }
    if (id > ELEMENT_RES_IGNORE_BASE && id <= ELEMENT_RES_IGNORE_BASE + 6) {
        return { bucket: 'resistanceIgnoreByElement', key: id - ELEMENT_RES_IGNORE_BASE };
    }
    return null;
}

// The game's own damage-type tag (`skill.damage[*].type`, and the parameter of
// an ExtraEffect DamageTypes requirement) → our formulaType.
const FORMULA_BY_DAMAGE_TYPE = Object.freeze({
    0: 'basic', 1: 'heavy', 2: 'liberation', 3: 'intro', 4: 'skill', 5: 'echo',
});

function emptyBuckets() {
    return {
        atkRatio: 0, defRatio: 0, critRate: 0, critDmg: 0, energyRegen: 0,
        dmgAll: 0, amplifyAll: 0,
        dmgByElement: {}, dmgBySkillType: {},
    };
}

/** An empty external-grant bundle. Mirrors the conditional-contribution shape. */
export function emptyExternal() {
    return {
        ...emptyBuckets(),
        // A grant the game hands to the TEAM lands in both bundles at the same
        // value: `teamWide` for distribution to the other members, and the self
        // buckets because the wielder is themselves one of "Resonators in the
        // team". Same clause, credited once per recipient — not doubled on the
        // wielder.
        teamWide: emptyBuckets(),
        // Per-hit TARGET modifiers, each carrying the scope the game states.
        // These are kept as a list rather than summed into a bucket because they
        // apply to some hits and not others — Everbright Polestar's DEF ignore is
        // stated for Resonance Liberation DMG only (DamageTypes [2]), so folding
        // it into a single number would credit it to her Basics too.
        targetMods: [],
        // Grants the routing understood but could not place; counted rather than
        // dropped silently, so a new shape shows up instead of going missing.
        unplaced: [],
    };
}

function scopeOf(grant) {
    const types = grant?.scope?.damageTypes ?? null;
    const elements = grant?.scope?.elementTypes ?? null;
    if (!types && !elements) return null;
    return {
        skillTypes: types ? types.map(type => FORMULA_BY_DAMAGE_TYPE[type]).filter(Boolean) : null,
        elementIds: elements ? elements.slice() : null,
    };
}

/**
 * Fold a list of grants (one row of `data/external-buffs.json` each) into a
 * bundle.
 *
 * `stackLimit` is applied here because the game states it per grant and it is
 * part of the value's MAGNITUDE, not its uptime — Kumokiri's Liberation bonus is
 * "8%, stacking up to 3 times", which is 24% at cap. Uptime stays the caller's
 * problem; this returns the at-cap value, matching how the existing weapon and
 * sonata conditional paths already credit their buffs.
 *
 * A grant that states a SCOPE and is not a target modifier is left unplaced: the
 * stat buckets are whole-build numbers with nowhere to record "…but only on
 * Heavy Attacks", and quietly widening it to the whole build would over-credit.
 * No weapon needs this today (every scoped grant in the game's weapon tables is
 * DEF-ignore or resistance), so the list is expected to stay empty.
 */
export function foldExternalGrants(grants, into = emptyExternal()) {
    for (const grant of grants ?? []) {
        // A DERIVED grant's magnitude is a coefficient in a runtime formula, not
        // a flat fraction — see the extractor's FLAT_CALCULATION_POLICIES. Halo
        // of Starry Radiance ships +0.2% ATK per point of Off-Tune Buildup (cap
        // 25%) as magnitude 200000, which read flat is +2000% ATK.
        if (grant?.derived) { into.unplaced.push(grant); continue; }
        const route = bucketForAttribute(grant?.attribute);
        if (!route) continue;
        const value = Number(grant.value) * Math.max(1, Number(grant.stackLimit) || 1);
        if (!Number.isFinite(value) || value === 0) continue;
        const scope = scopeOf(grant);

        if (route.bucket === 'defIgnore') {
            into.targetMods.push({ scope, defIgnore: value });
            continue;
        }
        // A resistance attribute holds the target's RES, so the game writes a
        // shred as a NEGATIVE value; `resReduce` is the positive amount removed.
        if (route.bucket === 'resistanceByElement') {
            into.targetMods.push({ scope, elementId: Number(route.key), resReduce: -value });
            continue;
        }
        if (route.bucket === 'resistanceIgnoreByElement') {
            into.targetMods.push({ scope, elementId: Number(route.key), resReduce: value });
            continue;
        }

        if (scope) { into.unplaced.push({ ...grant, bucket: route.bucket }); continue; }
        const targets = grant.teamWide ? [into, into.teamWide] : [into];
        for (const bundle of targets) {
            if (route.key == null) bundle[route.bucket] += value;
            else bundle[route.bucket][route.key] = (bundle[route.bucket][route.key] ?? 0) + value;
        }
    }
    return into;
}

/**
 * Does a target modifier apply to this hit? An absent scope applies to every
 * hit; a stated one must match the hit's own damage type and element.
 */
export function targetModApplies(mod, formulaType, elementId) {
    if (mod.elementId != null && Number(elementId) !== mod.elementId) return false;
    const scope = mod.scope;
    if (!scope) return true;
    if (scope.skillTypes?.length && !scope.skillTypes.includes(formulaType)) return false;
    if (scope.elementIds?.length && !scope.elementIds.includes(Number(elementId))) return false;
    return true;
}

/**
 * The sonata-tier grants the WINDOW path may credit, shaped as that path's own
 * ParsedBuff fields.
 *
 * The sonata lanes are disjoint by construction and must stay that way: the
 * window path (`sonata-buffs.js` → `buff-windows.js`) owns element / ATK /
 * skill-type DMG, and `conditional-buffs.js sonataConditionalContribution` owns
 * crit, amplify and DEF-ignore. So this returns ONLY the window path's buckets —
 * handing it a Crit Rate grant would double-count Trailblazing Star's +20%,
 * which the conditional path already credits.
 *
 * Two other exclusions, both deliberate:
 *   - `recipient: 'other'` grants. The game routes these to someone who is not
 *     the wielder (Chromatic Foam's 25% hand-off targets `TargetType 1`), and
 *     which teammate is not yet derived — crediting them to the wielder would
 *     be wrong in a way that inflates.
 *   - a scoped grant, for the same reason as on the weapon side: a window
 *     carries no room for "…but only on Heavy Attacks".
 *
 * @returns {Array<{bonusPct, bonusKind, element, dmgType, duration, stacks, teamWide}>}
 */
export function sonataWindowGrants(grants) {
    const out = [];
    for (const grant of grants ?? []) {
        if (grant?.recipient) continue;
        if (grant?.scope) continue;
        if (grant?.derived) continue;   // a formula coefficient, not a percentage
        const route = bucketForAttribute(grant?.attribute);
        if (!route) continue;
        const value = Number(grant.value) * Math.max(1, Number(grant.stackLimit) || 1);
        if (!Number.isFinite(value) || value === 0) continue;

        // crit / amplify / defIgnore belong to the other sonata lane and are
        // skipped here — crediting them in both would double them.
        if (!['dmgByElement', 'atkRatio', 'dmgBySkillType'].includes(route.bucket)) continue;
        const bonusKind = route.bucket === 'dmgByElement' ? 'element'
            : route.bucket === 'atkRatio' ? 'atk' : 'dmgType';
        const element = route.bucket === 'dmgByElement' ? Number(route.key) : null;
        const dmgType = route.bucket === 'dmgBySkillType' ? route.key : null;

        out.push({
            bonusPct: value,
            bonusKind, element, dmgType,
            duration: grant.durationSeconds ?? null,
            // The stack limit is already folded into `bonusPct` above, matching
            // how the text path credits a stacking sonata buff at cap.
            stacks: 1,
            teamWide: !!grant.teamWide,
            buffId: grant.buffId ?? null,
            triggerType: grant.triggerType ?? null,
        });
    }
    return out;
}

/** A sonata tier's grants from the dataset, or null when there is no row. */
export function sonataExternalGrants(dataset, sonataId, pieces) {
    const tier = dataset?.externalBuffs?.sonatas?.[String(sonataId)]?.tiers?.[String(pieces)];
    return tier?.grants ?? null;
}

/**
 * The grants a weapon's passive applies at a refinement rank, or null when the
 * dataset carries no row for it (callers then fall back to the text reader).
 *
 * Only the CONDITIONAL grants are here. A weapon's unconditional leading stat
 * ("ATK is increased by 12%") is not in the game's ConfigDB at all — verified
 * across all 127 rank-1 rows — and stays with `weaponPassiveStats`.
 */
export function weaponExternalGrants(dataset, weaponId, rank = 1) {
    const entry = dataset?.externalBuffs?.weapons?.[String(weaponId)];
    if (!entry) return null;
    const clamped = Math.min(Math.max(Number(rank) || 1, 1), 5);
    return entry.ranks?.[String(clamped)] ?? null;
}
