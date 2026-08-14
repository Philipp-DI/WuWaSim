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

import { canSatisfyCondition } from '../triggerability.js';
import { isTeamWideBuff } from '../buffs.js';
import { weaponExternalGrants, sonataExternalGrants, foldExternalGrants } from './external-buffs.js';

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
        // A bonus the game scopes to nothing (Proto_DamageChange) — every hit
        // reads it, so it belongs in its own bucket rather than being smeared
        // across the six element ones.
        dmgAll: 0,
        // TARGET-side. `defIgnore` is the flat, whole-build number the text path
        // produces (and which nothing has ever read); `targetMods` is the
        // data path's per-hit list, each entry carrying the scope the game
        // states. Both are consumed by sim.js — see externalTargetContext.
        defIgnore: 0,
        targetMods: [],
    };
}

/** Substitute {N} placeholders with the value at refinement `rank` (1..5). */
export function substituteParams(effect, effectParams, rank = 1) {
    return String(effect ?? '').replace(/\{(\d+)\}/g, (_, paramIndex) => {
        const values = effectParams?.[Number(paramIndex)];
        if (!Array.isArray(values)) return '';
        return values[Math.min(Math.max(rank - 1, 0), values.length - 1)] ?? '';
    });
}

const pct = (text) => { const match = String(text).match(/([\d.]+)\s*%/); return match ? Number(match[1]) / 100 : 0; };

// Classify a stat phrase (with the verb that introduced it) into a bucket.
function classify(statPhrase, amplify) {
    const lowered = statPhrase.toLowerCase();
    for (const [name, el] of Object.entries(ELEMENT_NAMES)) {
        if (lowered.includes(`${name} dmg`)) return amplify ? { bucket: 'amplifyElement', key: el } : { bucket: 'dmgElement', key: el };
    }
    for (const [phrase, type] of TYPE_PHRASES) {
        if (lowered.includes(phrase)) return amplify ? { bucket: 'amplifyType', key: type } : { bucket: 'dmgType', key: type };
    }
    if (/all[- ]?attribute|attribute dmg/.test(lowered)) return { bucket: 'dmgAll' };
    if (/crit\.?\s*rate/.test(lowered)) return { bucket: 'critRate' };
    if (/crit\.?\s*dmg/.test(lowered)) return { bucket: 'critDmg' };
    if (/energy regen/.test(lowered)) return { bucket: 'energyRegen' };
    if (/\batk\b/.test(lowered)) return { bucket: 'atkRatio' };
    if (/\bmax\s*hp\b|\bhp\b/.test(lowered)) return { bucket: 'hpRatio' };
    if (/\bdef\b/.test(lowered)) return { bucket: 'defRatio' };
    return null;
}

// Team-RECIPIENT detector for raw weapon/sonata clause text — a different
// question from statusGateScope's "can the TEAM satisfy the TRIGGER". A
// clause is team-wide when the buff's BENEFICIARY is the team, either named
// directly before the granting verb (isTeamWideBuff's existing patterns:
// "all team members' ATK is increased", "Resonators in the team gain X") or
// referred back to with a plural pronoun after an earlier team-scoped clause
// in the same sentence — the weapon/sonata convention for this, e.g.
// Kumokiri: "when Resonators in the team inflict Negative Statuses, they
// gain 24% All-Attribute DMG Bonus". This is distinct from a SELF buff merely
// GATED on a team condition (Aemeath's chain: "when Resonators in the team
// inflict Fusion Burst, Aemeath's Crit. DMG is increased…") — that sentence
// never says "they gain", it names the wielder specifically. PLURAL only —
// "resonators" (never the singular "the Resonator", the game's own singular
// they/them phrasing for the wielder, e.g. Chromatic Foam: "When the
// Resonator inflicts Fusion Burst… they gain 10% Fusion DMG Bonus" is a SELF
// buff, not a team one — a bare `resonators?` would wrongly match it.
const TEAM_RECIPIENT_SUBJECT_RE = /\b(?:all\s+)?(?:nearby\s+)?(?:resonators\s+in\s+the\s+team|team\s+members?|teammates?|party\s+members?)\b/i;
export function isTeamRecipientClause(sentence) {
    if (isTeamWideBuff(sentence)) return true;
    return TEAM_RECIPIENT_SUBJECT_RE.test(sentence) && /\bthey\s+(?:gain|receive|are)\b/i.test(sentence);
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
    let match;
    while ((match = re1.exec(clause))) {
        addBuff(out, classify(match[1], /amplif/i.test(match[2])), pct(match[3]) * stacks);
    }
    // "increases {stat} by {value}"  (verb precedes the stat)
    const re2 = /increases?\s+([\w.'\- ]*?)\s+by\s+([\d.]+\s*%)/gi;
    while ((match = re2.exec(clause))) {
        addBuff(out, classify(match[1], false), pct(match[2]) * stacks);
    }
    // "grants {value} {stat}" / "gains {value} {stat}"
    const re3 = /(?:grants?|gains?)\s+(?:the equipper\s+|the wielder\s+)?([\d.]+\s*%)\s+([\w.'\- ]*?)(?:\s+for\s+\d|[.,]|$)/gi;
    while ((match = re3.exec(clause))) {
        addBuff(out, classify(match[2], false), pct(match[1]) * stacks);
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
 * @returns {object} emptyContribution()-shaped self bundle, PLUS a nested
 *          `teamWide` bundle (same shape) of whatever clauses named the TEAM
 *          as beneficiary (see isTeamRecipientClause) — additive, not a
 *          reroute: the wielder is themselves a team member, so a team-wide
 *          clause counts in `out` exactly as before AND is duplicated into
 *          `teamWide` for the caller to distribute to the rest of the team
 *          (mirrors buffs.js's teamWideContribution convention: "the member's
 *          OWN damage already gets these via its per-step effect resolution").
 */
export function extractConditionalContribution(text, { resonator, dataset, skipFirstSentence = true, enemyStatuses = null } = {}) {
    const out = emptyContribution();
    const teamWide = emptyContribution();
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
        const teamRecipient = isTeamRecipientClause(sentence);
        // Split into clauses that share the sentence's trigger.
        for (const clause of sentence.split(/,?\s+and\s+|;\s*/i)) {
            extractClause(clause, stacks, out);
            if (teamRecipient) extractClause(clause, stacks, teamWide);
        }
    }
    return { ...out, teamWide };
}

/** Conditional contribution of a weapon's passive at a refinement rank. */
// Did the data path actually produce a stat value? A weapon whose every grant is
// a target modifier or an unplaceable scoped one has nothing to put in the
// buckets, and must fall through to the text reader rather than blanking them.
function hasPlaceableValue(folded) {
    for (const key of ['atkRatio', 'defRatio', 'critRate', 'critDmg', 'energyRegen', 'dmgAll', 'amplifyAll']) {
        if (folded[key]) return true;
    }
    return Object.keys(folded.dmgByElement).length > 0 || Object.keys(folded.dmgBySkillType).length > 0;
}

function assignBuckets(into, folded) {
    into.atkRatio = folded.atkRatio;
    into.defRatio = folded.defRatio;
    into.critRate = folded.critRate;
    into.critDmg = folded.critDmg;
    into.energyRegen = folded.energyRegen;
    into.amplifyAll = folded.amplifyAll;
    into.dmgAll = folded.dmgAll;
    into.dmgByElement = { ...folded.dmgByElement };
    into.dmgBySkillType = { ...folded.dmgBySkillType };
}

export function weaponConditionalContribution(weaponDef, rank, resonator, dataset, enemyStatuses = null) {
    if (!weaponDef?.effect) return { ...emptyContribution(), teamWide: emptyContribution() };
    const text = substituteParams(weaponDef.effect, weaponDef.effectParams, rank);

    const grants = weaponExternalGrants(dataset, weaponDef.id, rank);
    const folded = grants?.length ? foldExternalGrants(grants) : null;
    const satisfiable = canSatisfyCondition(resonator, dataset, text, enemyStatuses);

    // DATA WINS, PER WEAPON, WHEN IT HAS SOMETHING TO SAY.
    //
    // The rule is all-or-nothing on the stat buckets rather than a merge, and
    // that is the point: the text and the data routinely express the SAME grant
    // in different buckets (Bloodpact's Pledge reads as an element amplify from
    // its wording and as a Resonance Skill DMG bonus in the tables), so a union
    // would credit one value twice. Taking one source per weapon cannot.
    //
    // Measured over the 89 shipped weapons at R1: 37 agree exactly, 43 are read
    // by the DATA ONLY — the text reader returns nothing at all for nearly half
    // the roster — and 8 differ, all of them the data carrying a stack limit or
    // a bucket the wording hides. Exactly one weapon (Lux & Umbra) is read by
    // the text alone, and it falls through to the text automatically because
    // every one of its grants is a scoped amplify that lands in `unplaced`.
    if (folded && hasPlaceableValue(folded)) {
        const out = { ...emptyContribution(), teamWide: emptyContribution() };
        if (!satisfiable) return out;
        assignBuckets(out, folded);
        assignBuckets(out.teamWide, folded.teamWide);
        out.targetMods = folded.targetMods;
        return out;
    }

    const out = extractConditionalContribution(text, { resonator, dataset, skipFirstSentence: true, enemyStatuses });
    // DEF-ignore and RES-shred come from the tables even when the buckets do
    // not, because the text path has never produced a single value for them:
    // `extractClause`'s pattern demands an "of" that half the weapons omit, and
    // even when it matched, `contribution.defIgnore` was read by nothing in the
    // engine. Nothing to double-count against, nothing taken away.
    if (folded && satisfiable) out.targetMods = folded.targetMods;
    return out;
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
    const teamWide = { critRate: 0, critDmg: 0, amplifyByElement: {}, amplifyByType: {}, amplifyAll: 0, defIgnore: 0 };
    const counts = {};
    for (const echo of build?.echoes ?? []) if (echo?.sonataId != null) counts[echo.sonataId] = (counts[echo.sonataId] || 0) + 1;
    for (const [idStr, count] of Object.entries(counts)) {
        const sonata = dataset?.sonatas?.find(sonata => sonata.id === Number(idStr));
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
            const contribution = extractConditionalContribution(tier.effect, { resonator, dataset, skipFirstSentence: false, enemyStatuses });
            out.critRate += contribution.critRate;
            out.critDmg += contribution.critDmg;
            out.defIgnore += contribution.defIgnore;
            for (const [el, value] of Object.entries(contribution.amplifyByElement)) out.amplifyByElement[el] = (out.amplifyByElement[el] || 0) + value;
            for (const [type, value] of Object.entries(contribution.amplifyByType)) out.amplifyByType[type] = (out.amplifyByType[type] || 0) + value;
            out.amplifyAll += contribution.amplifyAll;
            // Team-recipient clauses (see extractConditionalContribution) —
            // additive, same convention as the self bucket above.
            teamWide.critRate += contribution.teamWide.critRate;
            teamWide.critDmg += contribution.teamWide.critDmg;
            teamWide.defIgnore += contribution.teamWide.defIgnore;
            for (const [el, value] of Object.entries(contribution.teamWide.amplifyByElement)) teamWide.amplifyByElement[el] = (teamWide.amplifyByElement[el] || 0) + value;
            for (const [type, value] of Object.entries(contribution.teamWide.amplifyByType)) teamWide.amplifyByType[type] = (teamWide.amplifyByType[type] || 0) + value;
            teamWide.amplifyAll += contribution.teamWide.amplifyAll;
        }
    }
    return { ...out, teamWide };
}

/**
 * Team-wide DISTINCT-APPLICATOR tier bonuses ("Snow Rust"-style self-buffs):
 * Hiyuki's Fine Snow (IH0) and Aemeath's Between the Stars (IH1) each grant
 * escalating SELF bonuses based on how many DISTINCT teammates have, over the
 * fight, inflicted a qualifying status — deduped per resonator ("each
 * Resonator can trigger this effect only once"), not per cast. This is a
 * different count from the shared enemy-stack timeline (enemy-status.js
 * statusStacksAt, which counts CASTS for DoT/decay purposes) — see
 * enemy-status.js distinctApplicators, the per-applicator sibling query.
 *
 * Hardcoded per resonator: the mechanic shape is rare (2 known instances) and
 * the qualifying statuses/tier thresholds/values come straight from kit text,
 * not from a generalizable description pattern worth auto-detecting.
 *
 * NOT modeled here: Hiyuki's 2-stack tier ("each time she applies Glacio
 * Chafe, she additionally deals an instance of Glacio Bite DMG") — that's a
 * genuine extra damage HIT, not a stat/amplify buff, and its scaling is the
 * same stack-scaling Glacio Chafe damage value docs/NEGATIVE-STATUS-REFERENCE.md
 * §2c marks `stackMult: null, pending calibration`. Modeling it would mean
 * fabricating a number we don't have — left as a documented gap, not silently
 * dropped (data/effect-overrides.json `deferred.1108`).
 */
const DISTINCT_APPLICATOR_TIERS = Object.freeze({
    1108: [ // Hiyuki — Fine Snow (IH0): glacio_chafe OR havoc_bane, cap 3
        { statuses: ['glacio_chafe', 'havoc_bane'], minCount: 1, critDmg: 0.4, amplifyElement: 1, amplify: 0.3 },
        { statuses: ['glacio_chafe', 'havoc_bane'], minCount: 3, amplifyElement: 1, amplify: 0.3 },
    ],
    // Aemeath — Between the Stars (IH1). Two things make this narrower than it
    // looks, and getting either wrong double-counts a main carry's Crit. DMG.
    //
    // 1. STACK ONE IS NOT OURS. The parsed inherent effect already applies the
    //    per-stack value FLAT (IH1.0 tune_rupture 0.20, IH1.1 fusion_burst 0.30
    //    — those two survive because effect-overrides.json suppresses the two
    //    AMPLIFY effects out of this node and the remainder renumbers,
    //    effect-overrides.js:51). What the pipeline cannot do is count distinct
    //    applicators, so this table supplies stacks 2..N ONLY. The amplify is
    //    entirely ours — its copies are the ones the overrides removed.
    //      fusion_burst, 2 applicators: 0.30 (pipeline) + 0.30 (here) = 0.60 ✓
    //      tune_rupture, 3 applicators: 0.20 (pipeline) + 0.20 + 0.20  = 0.60 ✓
    //
    // 2. S3 REPLACES THE WHOLE INHERENT — "Inherent Skill Between the Stars is
    //    replaced with the following effects: ... Crit. DMG is increased by 60%,
    //    and ... Finale DMG is now Amplified by 25%" — i.e. the flat 60% with no
    //    stacking, granted by S3.2/S3.4 (+ S3.3/S3.5 for the amplify), which the
    //    chain pipeline applies correctly (measured at S3: critDmg +0.60,
    //    amplify +0.25, not doubled). So this table must go SILENT at S3+, or it
    //    adds a second 60%/25% on top. `maxChain` is that gate; the amplify half
    //    of it was double-counting at S3+ before this was written.
    //
    // The game's own rows agree on the per-stack values (db_buff, 1/10000):
    //   1210075016  CritDamage 2000 (20%), StackLimitCount 3  ← Tune Rupture
    //   1210075116  CritDamage 3000 (30%), StackLimitCount 2  ← Fusion Burst
    //   1210075017 / 1210075117  ExtraEffectID 37 amplify 2500 (25%), one per branch
    1210: [
        { statuses: ['tune_rupture'], minCount: 2, requiresMode: 'tune_rupture', maxChain: 2, critDmg: 0.20 },
        { statuses: ['tune_rupture'], minCount: 3, requiresMode: 'tune_rupture', maxChain: 2, critDmg: 0.20,
            amplifySkillType: 'liberation', amplify: 0.25 },
        { statuses: ['fusion_burst'], minCount: 2, requiresMode: 'fusion_burst', maxChain: 2, critDmg: 0.30,
            amplifySkillType: 'liberation', amplify: 0.25 },
    ],
});

/**
 * @param {number} resonatorId
 * @param {string|null} resonanceMode    — the member's own build.resonanceMode
 * @param {(statuses: string[]) => Set<number>} countDistinct — distinct
 *        applicator ids for a status list, as of this member's window
 * @returns {object} an emptyContribution()-shaped bundle for the member's OWN window
 */
export function distinctApplicatorTierContribution(resonatorId, resonanceMode, countDistinct, chainLevel = 0) {
    const out = emptyContribution();
    const tiers = DISTINCT_APPLICATOR_TIERS[resonatorId];
    if (!tiers) return out;
    for (const tier of tiers) {
        if (tier.requiresMode && tier.requiresMode !== resonanceMode) continue;
        // `maxChain`: a chain node that REPLACES the inherent this tier models
        // silences it from that level up, so the two never both pay (Aemeath's
        // S3). Absent = no upper gate, which is every other entry.
        if (tier.maxChain != null && (chainLevel ?? 0) > tier.maxChain) continue;
        if (countDistinct(tier.statuses).size < tier.minCount) continue;
        if (tier.critDmg) out.critDmg += tier.critDmg;
        if (tier.atkRatio) out.atkRatio += tier.atkRatio;
        if (tier.amplify) {
            if (tier.amplifyElement != null) out.amplifyByElement[tier.amplifyElement] = (out.amplifyByElement[tier.amplifyElement] || 0) + tier.amplify;
            else if (tier.amplifySkillType) out.amplifyByType[tier.amplifySkillType] = (out.amplifyByType[tier.amplifySkillType] || 0) + tier.amplify;
            else out.amplifyAll += tier.amplify;
        }
    }
    return out;
}

/**
 * Incoming-resonator transfer (P13 Team Effect Model — incomingResonator scope).
 * Some sonatas hand a buff to the NEXT resonator on swap, e.g. Wishes of Quiet
 * Snowfall: "Casting Outro Skill … grants 25% Glacio DMG Bonus to the incoming
 * Resonator." The transfer is owned by the WIELDER and gated on the wielder's own
 * activation (they gained the state by inflicting the status themselves — a SELF
 * gate, own kit only, never team-satisfied). The team sim applies the returned
 * bundle to the member who swaps IN after this one.
 *
 * @param {object} [derivedSources] — raw attribute values for grants the game
 *        states as a FORMULA (external-buffs.js derivedGrantValue). Pact of
 *        Neonlight Leap's second half scales off the INCOMING resonator's Tune
 *        Break Boost, so the value belongs to the recipient, not the wielder,
 *        and only the team sim knows who that is.
 * @returns {object} an emptyContribution()-shaped bundle (dmgByElement / amplify
 *          / atk …) the incoming resonator receives.
 */
// Mirrors sim.js ECHO_STEP_KEY, kept as a literal for the same reason
// rotation-graph.js does: sim.js imports THIS module, so a back-import would
// create a cycle.
const ECHO_STEP_KEY = '__echo__';

export function incomingResonatorContribution(build, dataset, resonator, derivedSources = {}) {
    const out = emptyContribution();
    // WHERE EACH PIECE CAME FROM. The buckets below are sums, and a receiver
    // routinely gets one element bonus from two unrelated places — Chromatic
    // Foam's 25% Fusion and a Reminiscence: Denia echo's 12% arrive as a single
    // "+37% Fusion DMG" with nothing to say which set to credit or which piece
    // to swap. `sources` keeps the addends next to the sum; it is display-only
    // and never read by the damage model, which reads the buckets.
    const sources = [];
    const credit = (label, bucket, key, value) => {
        if (value > 0) sources.push({ label, bucket, key, value });
    };

    // The equipped ECHO can hand the incoming resonator a buff too, and four do
    // — Glommoth and Reminiscence: Denia (12% element DMG Bonus), Hyvatia (10%
    // All-Attribute) and Voidwing Moth (12% ATK). None was modelled, because the
    // only echo buff the pipeline read was the TEAM-wide `DMG Boost` shape.
    //
    // Only SLOT 0 counts: the echo skill a rotation casts is the slot-0 echo's
    // (sim.js resolveEchoSkill), so an echo sitting in slots 1-4 grants nothing.
    // And the transfer is gated on the wielder actually CASTING it — the clause
    // reads "casting Outro Skill within Ns AFTER summoning", so a rotation with
    // no echo step never opens the window.
    const slotZero = build?.echoes?.[0];
    const echoDef = slotZero?.id != null
        ? dataset?.echoes?.find(echo => echo.id === slotZero.id) : null;
    const incomingBuff = echoDef?.activeSkill?.incomingBuff;
    if (incomingBuff && (build?.rotation ?? []).includes(ECHO_STEP_KEY)) {
        const value = Number(incomingBuff.value) || 0;
        const label = `${echoDef.name} (Echo)`;
        if (incomingBuff.bucket === 'atkRatio') {
            out.atkRatio += value;
            credit(label, 'atkRatio', null, value);
        } else if (incomingBuff.bucket === 'dmgAll') {
            // Scoped to nothing, so every element reads it.
            for (let element = 1; element <= 6; element++) {
                out.dmgByElement[element] = (out.dmgByElement[element] ?? 0) + value;
                credit(label, 'dmgByElement', element, value);
            }
        } else if (incomingBuff.bucket === 'dmgElement' && incomingBuff.elementId != null) {
            out.dmgByElement[incomingBuff.elementId] =
                (out.dmgByElement[incomingBuff.elementId] ?? 0) + value;
            credit(label, 'dmgByElement', incomingBuff.elementId, value);
        }
    }

    const counts = {};
    for (const echo of build?.echoes ?? []) if (echo?.sonataId != null) counts[echo.sonataId] = (counts[echo.sonataId] || 0) + 1;
    for (const [idStr, count] of Object.entries(counts)) {
        const sonata = dataset?.sonatas?.find(sonata => sonata.id === Number(idStr));
        if (!sonata) continue;
        for (const tier of sonata.tiers ?? []) {
            if (count < tier.pieces) continue;
            // SELF gate: the wielder must be able to satisfy the activation (their
            // own state) — own kit only, no team statuses.
            if (!canSatisfyCondition(resonator, dataset, tier.effect)) continue;

            // DATA FIRST. The game marks this transfer itself: the grant sits
            // behind an `AddBuffTrigger` whose EventType is the Outro→Intro
            // handoff and whose TargetType is the event's counterparty — which,
            // for that event, is the resonator swapping IN
            // (`RoleQteComponent` → `RoleElementComponent.TriggerEvents`).
            // Reading it from the tables rather than from the sentence is what
            // finally pays Chromatic Foam's 25%: its text writes the value
            // BEFORE the stat ("grants the incoming Resonator 25% Fusion DMG
            // Bonus"), and `extractClause` only ever matched "…by 25%".
            const incoming = (sonataExternalGrants(dataset, sonata.id, tier.pieces) ?? [])
                .filter(grant => grant.recipient === 'incoming');
            if (incoming.length) {
                const folded = foldExternalGrants(incoming, undefined, derivedSources);
                const label = `${sonata.name} (${tier.pieces}pc)`;
                for (const bucket of ['atkRatio', 'critRate', 'critDmg', 'energyRegen', 'amplifyAll']) {
                    out[bucket] += folded[bucket];
                    credit(label, bucket, null, folded[bucket]);
                }
                for (const [element, value] of Object.entries(folded.dmgByElement)) {
                    out.dmgByElement[element] = (out.dmgByElement[element] ?? 0) + value;
                    credit(label, 'dmgByElement', Number(element), value);
                }
                for (const [type, value] of Object.entries(folded.dmgBySkillType)) {
                    out.dmgBySkillType[type] = (out.dmgBySkillType[type] ?? 0) + value;
                    credit(label, 'dmgBySkillType', type, value);
                }
                continue;   // this tier is answered — do not also read the text
            }

            const text = String(tier.effect ?? '').replace(/\bCrit\.\s*/gi, 'Crit ');
            for (const sentence of text.split(/(?<=[.!])\s+/)) {
                if (!/\b(incoming|next)\s+resonator\b/i.test(sentence)) continue;
                // The text path writes straight into `out`, so the addends are
                // recovered by DIFFING the bundle either side of the call —
                // cheaper and less error-prone than teaching extractClause to
                // report, and it cannot disagree with what was actually added.
                const before = bucketSnapshot(out);
                extractClause(sentence, 1, out);
                for (const [bucket, key, value] of bucketDelta(before, out)) {
                    credit(`${sonata.name} (${tier.pieces}pc)`, bucket, key, value);
                }
            }
        }
    }
    out.sources = sources;
    return out;
}

// Flat {bucket, key} → value view of the buckets an incoming transfer can fill.
const TRANSFER_SCALARS = ['atkRatio', 'critRate', 'critDmg', 'energyRegen', 'amplifyAll'];
const TRANSFER_MAPS = ['dmgByElement', 'dmgBySkillType'];

function bucketSnapshot(bundle) {
    const out = new Map();
    for (const bucket of TRANSFER_SCALARS) out.set(`${bucket}|`, bundle[bucket] ?? 0);
    for (const bucket of TRANSFER_MAPS) {
        for (const [key, value] of Object.entries(bundle[bucket] ?? {})) out.set(`${bucket}|${key}`, value);
    }
    return out;
}

function bucketDelta(before, bundle) {
    const out = [];
    const after = bucketSnapshot(bundle);
    for (const [id, value] of after) {
        const gained = value - (before.get(id) ?? 0);
        if (gained <= 0) continue;
        const [bucket, key] = id.split('|');
        out.push([bucket, key === '' ? null : (bucket === 'dmgByElement' ? Number(key) : key), gained]);
    }
    return out;
}
