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

// ─── Derived grants: a magnitude that is a COEFFICIENT, not a percentage ─────
//
// `CalculationPolicy[0]` decides how `ModifierMagnitude` reads. Modes 0 and 1
// are flat and the extractor ships their value directly; modes 2, 4 and 9 make
// the grant a function of ANOTHER attribute, and the extractor marks those
// `derived` with the policy attached rather than guessing.
//
// The client states the arithmetic itself, in `BaseAttributeComponent.Cbr` —
// the function that evaluates every modifier on an attribute:
//
//     let source = SnapshotSource ?? GetAttrValue(set, SourceAttributeId, …);
//     if (Min && (source -= Min) <= 0) break;      // below the floor: nothing
//     if (Ratio) source /= Ratio;                  // per-unit divisor
//     if (Type === 9) { scaleBase += source * Value1 * 1e-4; break; }
//     flat = source * Value1 * 1e-4 + Value2;
//     if (Max && flat > Max) flat = Max;
//     …
//     return Math.floor(base * (scaleBase * 1e-4 + 1) + added);
//
// so a mode-9 grant lands in the SAME lane as a plain "scale base" modifier and
// its fraction is `source / Ratio * Value1 * 1e-8`. Our extracted `value` is
// already `Value1 / 1e4`, which is why the divisor below is 1e4 and not 1e8.
//
// THE POLICY SLOTS, named by the client's own destructuring (ActiveBuff.p__
// hands them to AddModifier under these names):
//   [0] Type   [1] SourceAttributeId   [2] 1 = read the INSTIGATOR's attribute
//   [3] SourceCalculationType   [4] SnapshotSource   [5] Min   [6] Ratio  [7] Max
//
// All three shipped derived grants reproduce their tooltip exactly:
//   sonata 25  [9,141,1,1,0,0,100,2500] × 20  → 100 × 20/1e4 = 0.20, cap 0.25
//              "every 1% of Off-Tune Buildup Rate grants a 0.2% ATK increase,
//               up to 25%" — Off-Tune Buildup Rate is 10000 (100%) on all 2,740
//               baseproperty rows, so 100 units of 1% × 0.2% = 20%.
//   sonata 24  [9,142,0,1,0,0,  1,1500] × 30  → points × 30/1e4, cap 0.15
//              "each point of Tune Break Boost … by 0.3%, up to 15%". Ratio 1,
//              because the source is counted in POINTS rather than percent.
//   sonata 33  [9, 11,1,1,0,0,100,2500] × 10  → ER% × 10/1e4, cap 0.25
//              "0.1% ATK … for every 1% of the Resonator's Energy Regen, up to
//               25%" — 100% Energy Regen is 10000, so the base pays 10%.
//
// ONE DELIBERATE DEPARTURE FROM THE CLIENT: `Cbr` never reads `Max` on the
// mode-9 branch (the `break` above precedes the cap). The cap is applied here
// anyway, because the tooltip and the `Max` field state the same number
// independently on all three sets, and honouring it can only under-credit —
// while ignoring it is the same class of error that made Halo of Starry
// Radiance read as +2000% ATK.
const CALCULATION_POLICY = Object.freeze({
    TYPE: 0, SOURCE_ATTRIBUTE: 1, MIN: 5, RATIO: 6, MAX: 7,
});
const SCALE_BASE_POLICY = 9;

/**
 * Source attribute ids a derived grant reads. Exported so callers name the
 * value they are supplying instead of passing a bare number.
 */
export const DERIVED_SOURCE = Object.freeze({
    ENERGY_REGEN: 11,
    OFF_TUNE_BUILDUP_RATE: 141,
    TUNE_BREAK_BOOST: 142,
});

// Off-Tune Buildup Rate reads 10000 (100%) on every one of the 2,740
// `baseproperty` rows and nothing in the engine's model raises it, so it needs
// no caller to supply it. The others genuinely vary per build or per team.
const DERIVED_SOURCE_DEFAULTS = Object.freeze({
    [DERIVED_SOURCE.OFF_TUNE_BUILDUP_RATE]: 10000,
});

/**
 * The fraction a `derived` grant is worth, or null when its source attribute is
 * one the caller could not supply.
 *
 * Null is the honest answer, not zero: it lets the caller leave the grant in
 * `unplaced` (visible) rather than credit it as nothing (silent).
 *
 * @param {object} grant   — a `derived: true` row of data/external-buffs.json
 * @param {object} sources — attribute id → the game's RAW value (1e4 fixed
 *        point for a percentage, plain units for a point count)
 */
export function derivedGrantValue(grant, sources = {}) {
    const policy = grant?.calculationPolicy;
    if (!Array.isArray(policy) || policy[CALCULATION_POLICY.TYPE] !== SCALE_BASE_POLICY) return null;
    const attribute = policy[CALCULATION_POLICY.SOURCE_ATTRIBUTE];
    const raw = sources?.[attribute] ?? DERIVED_SOURCE_DEFAULTS[attribute];
    if (!Number.isFinite(raw)) return null;

    let source = raw - (policy[CALCULATION_POLICY.MIN] || 0);
    if (source <= 0) return 0;
    const ratio = policy[CALCULATION_POLICY.RATIO] || 0;
    if (ratio) source /= ratio;

    const value = source * Number(grant.value) / 10000;
    const max = policy[CALCULATION_POLICY.MAX] || 0;
    return max ? Math.min(value, max / 10000) : value;
}

/**
 * What a grant contributes, derived or not — null when a derived grant's source
 * is unavailable.
 *
 * `stackLimit` is folded in here because the game states it per grant and it is
 * part of the value's MAGNITUDE, not its uptime: Kumokiri's Liberation bonus is
 * "8%, stacking up to 3 times", which is 24% at cap.
 */
function grantValue(grant, sources) {
    const base = grant?.derived ? derivedGrantValue(grant, sources) : Number(grant?.value);
    if (base == null || !Number.isFinite(base)) return null;
    return base * Math.max(1, Number(grant.stackLimit) || 1);
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
 *
 * `sources` supplies the raw attribute values a DERIVED grant scales off (see
 * derivedGrantValue). A derived grant whose source the caller cannot supply
 * stays unplaced.
 */
export function foldExternalGrants(grants, into = emptyExternal(), sources = {}) {
    for (const grant of grants ?? []) {
        const route = bucketForAttribute(grant?.attribute);
        if (!route) continue;
        const value = grantValue(grant, sources);
        // A derived grant with no source value is left visible rather than
        // credited as zero — the caller can see what it could not answer.
        if (value == null) { into.unplaced.push(grant); continue; }
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
 * A DERIVED grant is included once `sources` can answer its source attribute,
 * and silently skipped when it cannot — a window is a timeline entry, so there
 * is nowhere to surface an unplaced one; `foldExternalGrants` is the path that
 * keeps them visible.
 *
 * @returns {Array<{bonusPct, bonusKind, element, dmgType, duration, stacks, teamWide}>}
 */
export function sonataWindowGrants(grants, sources = {}) {
    const out = [];
    for (const grant of grants ?? []) {
        if (grant?.recipient) continue;
        if (grant?.scope) continue;
        const route = bucketForAttribute(grant?.attribute);
        if (!route) continue;
        const value = grantValue(grant, sources);
        if (value == null || !Number.isFinite(value) || value === 0) continue;

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

// The buckets the WINDOW path owns. Its complement is the conditional lane's,
// and the two must partition the grants exactly — a bucket in neither is
// dropped, a bucket in both is counted twice.
const WINDOW_LANE_BUCKETS = Object.freeze(['dmgByElement', 'atkRatio', 'dmgBySkillType']);

/**
 * The sonata-tier grants the CONDITIONAL path may credit — the exact complement
 * of `sonataWindowGrants`.
 *
 * That lane (`conditional-buffs.js sonataConditionalContribution`) owns crit,
 * amplify and DEF-ignore, and derived them by parsing the tier's English. The
 * text misses more than half of them: measured over the 11 tiers that state one,
 * it reads FIVE as zero outright (Eternal Radiance's 20% Crit Rate, Windward
 * Pilgrimage's 10%, Crown of Valor's 20% Crit DMG, Song of Feathered Trace's
 * 20%, Heart of Evil's Purge's 20% Crit DMG) and gets two more wrong by dropping
 * the stack multiplier (Lamp of Nether Road is 5% × 4) or a sibling grant
 * (Flamewing's Shadow ships the 20% twice).
 *
 * `teamWide` comes from the GRANT, never from the sentence — the same per-grant
 * rule the window path needed. Today no sonata crit grant is team-wide, so this
 * changes no distribution; it is here so that when one ships, the sentence
 * cannot overrule it.
 *
 * @returns {{critRate, critDmg, amplifyAll, defIgnore, teamWide:{…}}|null}
 *          null when the tier states nothing in this lane (caller keeps text).
 */
export function sonataConditionalGrants(grants, sources = {}) {
    const empty = () => ({ critRate: 0, critDmg: 0, amplifyAll: 0, defIgnore: 0 });
    const out = empty();
    const teamWide = empty();
    let found = false;
    for (const grant of grants ?? []) {
        if (grant?.recipient) continue;     // the incoming-resonator lane's
        if (grant?.scope) continue;         // no room for "…but only on Heavy Attacks"
        const route = bucketForAttribute(grant?.attribute);
        if (!route || WINDOW_LANE_BUCKETS.includes(route.bucket)) continue;
        if (!(route.bucket in out)) continue;   // resistance mods route per-hit
        const value = grantValue(grant, sources);
        if (value == null || !Number.isFinite(value) || value === 0) continue;
        found = true;
        out[route.bucket] += value;
        if (grant.teamWide) teamWide[route.bucket] += value;
    }
    return found ? { ...out, teamWide } : null;
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
