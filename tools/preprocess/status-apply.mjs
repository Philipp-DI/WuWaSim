/**
 * WHICH casts inflict a negative status, derived from the kit's own text
 * (OPEN-ITEMS #29).
 *
 * Without this every damaging step counted as an application, which over-applies
 * by the ratio of a rotation's damaging steps to its real inflicting ones. The
 * kits state the rule outright — "Basic Attack Stage 4 inflicts 1 stack of
 * [Aero Erosion]", "inflicting [Glacio Chafe] on the target 1 time on hit" —
 * so the rule is derivable rather than hand-curatable.
 *
 * ## Why the text and not the game's own tables
 *
 * The ConfigDB DOES define the appliers: 73 buffs carry `ExtraEffectID 5`
 * (apply-buff) naming one of the six system status buffs, and their third
 * parameter IS the stack count (`data/status-appliers.json`, committed as the
 * corroborating source — `tools/extract/extract_status_appliers.py`). What it
 * does NOT contain is the link from a SKILL to those buffs: `db_skill` holds
 * 562 exploration rows, not character skills, and an ASCII sweep of all 482
 * `db_*.db` files finds each applier referenced only from `db_buff` itself.
 * The skill→buff grant lives in the ability blueprints, outside the ConfigDB.
 * So the count is data, the skill list is text, and `assertCountsAgainstGame`
 * checks the text-derived counts against the game's own numbers.
 *
 * ## Scoping — the part that is easy to get wrong
 *
 * A skill's description section is the whole FAMILY, so a clause reading
 * "Basic Attack Stage 4 inflicts 1 stack" is inherited by stages 1-3 unless it
 * is gated. Two gates do that, and both must pass:
 *
 *   - **stage** — a clause naming "Stage N" only attaches to the key whose own
 *     trailing index is N (Ciaccona, Cartethyia, Suisui each over-applied 3-4x
 *     without this).
 *   - **named skill** — a clause naming bracketed skills only attaches to a key
 *     matching one of them, and only when some key in the map matches at all
 *     (Lucilla's "While casting [Spotlight]" sits in the section shared with
 *     Phantom Frame). Names that resolve to nothing — "[Sword of Divinity's
 *     Shadow]" — leave the gate open rather than dropping the clause.
 *
 * Four rejections keep clauses that are ABOUT a status but do not apply one:
 * negations ("does not inflict [Havoc Bane]" — Yangyang: Xuanling's whole set),
 * conversions (Hiyuki's Glacio Chafe → Glacio Bite), cap raises ("increases the
 * max stack limit"), and observer clauses whose subject is a teammate ("when
 * Resonators in the team inflict …" — Aemeath, Zani, Yangyang).
 *
 * A resonator whose text yields no rule keeps the every-damaging-step fallback.
 * That is still an approximation, but an explicit one.
 */
import { extractSkillSection } from '../../src/ui/tip-format.js';
import { STATUS_KEYS, statusSpaceForm, statusesInflictedBy } from '../../src/core/enemy-status.js';

/** Sentence-ish units: the game separates clauses by newline as often as by a period. */
const splitClauses = (text) => String(text ?? '')
    .split(/\n+|(?<=[.!?])\s+/)
    .map(clause => clause.trim())
    .filter(Boolean);

/** A clause that mentions a status without the caster applying one HERE. */
const REJECTIONS = [
    { name: 'negated', test: /\bnot\s+inflict/i },
    { name: 'converted', test: /\bconverted\s+(?:to|into)\b|\bconverts?\s+[^.]*\binto\b/i },
    { name: 'capRaise', test: /max(?:imum)?\s+stack\s+limit/i },
    { name: 'observer', test: /\b(?:nearby\s+)?Resonators?\b[^.]*\binflicts?\b/i },
    // "Lynae can inflict [Tune Rupture - Shifting] or [Tune Strain - Shifting]"
    // states a capability, not a cast that applies one.
    { name: 'capability', test: /\bcan\s+inflict/i },
    // "inflict X when the following skills deal damage" defers to a list this
    // clause does not contain — Aemeath's Forte, which is why she is curated.
    { name: 'deferred', test: /\bthe\s+following\s+skills?\b/i },
    // "inflicts 2 stacks ... every 2s, lasting for 24s" is a periodic array, not
    // a per-cast application; one cast seeds up to duration/period of them.
    // Modelling that needs periodic rules, so leave these on the fallback.
    { name: 'periodic', test: /\bevery\s+[\d.]+\s*s\b/i },
];

const WORD_COUNTS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5 };
const countOf = (token) => (/^\d+$/.test(token) ? Number(token) : (WORD_COUNTS[token.toLowerCase()] ?? 1));

/** How many stacks a clause says it inflicts. Null when it does not inflict this status at all. */
function stacksInClause(clause, label) {
    const status = label.replace(/ /g, '\\s+');
    const ofForm = new RegExp(
        `inflict(?:s|ing)?\\s+(?:(\\d+|an?|one|two|three|four|five)\\s+)?(?:extra\\s+)?(?:stacks?\\s+)?of\\s+\\[?${status}`, 'i');
    const timesForm = new RegExp(
        `inflict(?:s|ing)?\\s+\\[?${status}[^.]*?\\b(\\d+|an?|one|two|three|four|five)\\s+times?\\b`, 'i');
    const bareForm = new RegExp(`inflict(?:s|ing)?\\s+(?:the\\s+)?\\[?${status}`, 'i');

    const times = clause.match(timesForm);
    if (times) return countOf(times[1]);
    const counted = clause.match(ofForm);
    if (counted) return counted[1] ? countOf(counted[1]) : 1;
    return bareForm.test(clause) ? 1 : null;
}

/** Stage numbers a clause names — "Stage 3 & 4" and "Stage 3 and 4" both yield [3, 4]. */
function stagesInClause(clause) {
    const stages = [];
    const head = /\bStage\s+(\d+)/gi;
    for (let match = head.exec(clause); match; match = head.exec(clause)) {
        stages.push(Number(match[1]));
        const tail = /^\s*(?:&|and|,|\/)\s*(\d+)/y;
        tail.lastIndex = head.lastIndex;
        for (let more = tail.exec(clause); more; more = tail.exec(clause)) stages.push(Number(more[1]));
    }
    return stages;
}

/** A skill key's own stage — the trailing index the row labels carry. */
const stageOfKey = (key) => {
    const match = /_(\d+)$/.exec(key);
    return match ? Number(match[1]) : null;
};

const CATEGORY_LEAD = /^(?:basic attack|heavy attack|mid-?air attack|resonance skill|resonance liberation|intro skill|outro skill|forte circuit|resonance mode|dodge counter)\s*[-:–]\s*/i;
const NAME_STOPWORDS = new Set(['stage', 'the', 'a', 'an', 'of', 'and', 'or', 'to', 'in', 'on', 'for', 'attack', 'skill']);

/**
 * Distinctive tokens of a bracketed skill name, in key form.
 *
 * `stripCategory` is on by default because the game files most skills under a
 * category the key does not carry ("[Resonance Skill - Sync Strike]" →
 * `skill_sync_strike_…`, no "resonance"). For a few families the category IS
 * part of the key's identity ("Heavy Attack - Aemeath" → `heavy_aemeath_…`,
 * where dropping it widens the name to every skill she has), so skill-scope.mjs
 * asks for the un-stripped tokens first and falls back to these.
 */
export function nameTokens(name, { stripCategory = true } = {}) {
    return (stripCategory ? name.toLowerCase().replace(CATEGORY_LEAD, '') : name.toLowerCase())
        .split(/[^a-z0-9]+/)
        .filter(token => token && !NAME_STOPWORDS.has(token));
}

/** Every bracketed name in a clause that is not itself a status or a mode. */
function skillNamesInClause(clause, statusLabels) {
    const names = [];
    for (const match of clause.matchAll(/\[([^\]]+)\]/g)) {
        const name = match[1];
        const lower = name.toLowerCase();
        if (statusLabels.some(label => lower.includes(label))) continue;
        if (nameTokens(name).length) names.push(name);
    }
    return names;
}

/**
 * A key matches a name only when it carries ALL of the name's distinctive
 * tokens, and only when at least one of them is a word: "[Basic Attack Stage 4]"
 * reduces to the single token "4", which every fourth stage in the kit carries.
 */
export const keyMatchesName = (key, name, options) => {
    const tokens = nameTokens(name, options);
    return tokens.some(token => /[a-z]/.test(token)) && tokens.every(token => key.includes(token));
};

/**
 * Derive the apply rules for one resonator.
 *
 * @param {object} resonator          — projected resonator (id, element)
 * @param {object} skillMap           — autoSkillMap[resonatorId]
 * @param {Set<string>} statuses      — status keys this resonator can inflict
 * @returns {Array<{status, key, stacks, quote}>} — empty when nothing is derivable
 */
export function deriveStatusApplyRules(resonator, skillMap, statuses) {
    if (!skillMap || !statuses?.size) return [];
    const keys = Object.keys(skillMap);
    const statusLabels = STATUS_KEYS.map(statusSpaceForm);
    const byKeyStatus = new Map();

    // The keys a clause is IN are the ones it could belong to, and that is the
    // scope the name gate resolves inside. A name resolving to a key whose own
    // section does not carry this clause is not its subject: Luuk's intro
    // "Hurl out an [Ichor Blade] and inflict [Tune Strain]" names his Forte's
    // blade, and gating on it would drop the intro that throws it.
    const clausesByKey = new Map(keys.map(key => [key, splitClauses(
        extractSkillSection(skillMap[key].desc ?? '', key, skillMap[key].skillType))]));
    const holdersOf = (clause) => keys.filter(key => clausesByKey.get(key).includes(clause));

    for (const key of keys) {
        for (const clause of clausesByKey.get(key)) {
            if (!/inflict/i.test(clause)) continue;
            if (REJECTIONS.some(rejection => rejection.test.test(clause))) continue;

            // A clause naming itself ("Casting this skill …", "The skill
            // inflicts …") belongs to its section however many other things it
            // brackets — Suisui's Awakening Spring sends her into [Drizzle
            // Stance], which is a stance, not the skill doing the inflicting.
            if (!/\bth(?:is|e)\s+skill\b/i.test(clause)) {
                const holders = holdersOf(clause);
                const subjects = skillNamesInClause(clause, statusLabels)
                    .filter(name => holders.some(other => keyMatchesName(other, name)));
                if (subjects.length && !subjects.some(name => keyMatchesName(key, name))) continue;
            }

            const stages = stagesInClause(clause);
            if (stages.length && !stages.includes(stageOfKey(key))) continue;

            for (const status of statuses) {
                const stacks = stacksInClause(clause, statusSpaceForm(status));
                if (!stacks) continue;
                const id = key + '|' + status;
                const seen = byKeyStatus.get(id);
                if (!seen || stacks > seen.stacks) byKeyStatus.set(id, { status, key, stacks, quote: clause });
            }
        }
    }

    return [...byKeyStatus.values()].sort((left, right) =>
        left.status.localeCompare(right.status) || keys.indexOf(left.key) - keys.indexOf(right.key));
}

/**
 * Every status a resonator can inflict in ANY of its Resonance Modes — a mode
 * named after a status inflicts it, and the mode is a build-level toggle, so the
 * rules have to cover both branches. `applicationsFromSteps` intersects with the
 * statuses the CHOSEN mode actually inflicts.
 */
function statusesAcrossModes(resonator, dataset) {
    const out = statusesInflictedBy(resonator, dataset, null);
    for (const mode of resonator.resonanceModes ?? []) {
        for (const status of statusesInflictedBy(resonator, dataset, mode.key)) out.add(status);
    }
    return out;
}

/**
 * Roster-wide derivation, in the shape `applicationsFromSteps` consumes:
 * one rule per distinct clause, carrying the keys it attaches to.
 *
 * @param {Array} resonators
 * @param {object} autoSkillMap
 * @param {object|null} appliers — data/status-appliers.json, for the count check
 * @returns {Record<string, Array<{status, stacks, icdSeconds, keys, derivedFrom}>>}
 */
export function buildStatusApplyRules(resonators, autoSkillMap, appliers = null) {
    const dataset = { autoSkillMap };
    const out = {};
    for (const resonator of resonators) {
        const skillMap = autoSkillMap[String(resonator.id)];
        const derived = deriveStatusApplyRules(
            resonator, skillMap, statusesAcrossModes(resonator, dataset));
        if (!derived.length) continue;

        const byClause = new Map();
        for (const rule of derived) {
            const id = `${rule.status}|${rule.stacks}|${rule.quote}`;
            if (!byClause.has(id)) {
                byClause.set(id, {
                    status: rule.status,
                    stacks: rule.stacks,
                    icdSeconds: 0,          // no derived kit states one; Aemeath's 3s is curated
                    keys: [],
                    derivedFrom: rule.quote,
                });
            }
            byClause.get(id).keys.push(rule.key);
        }
        out[String(resonator.id)] = [...byClause.values()];
    }

    const problems = assertCountsAgainstGame(out, appliers);
    if (problems.length) {
        const detail = problems.map(problem =>
            `${problem.resonatorId} ${problem.key} ${problem.stacks}x ${problem.status} > game max ${problem.gameMax}`);
        throw new Error(`status apply derivation exceeds the game's own stack counts:\n  ${detail.join('\n  ')}`);
    }
    return out;
}

/**
 * Cross-check derived stack counts against the game's own applier buffs.
 * A resonator may not derive a count larger than the largest the ConfigDB
 * defines for that status — the text would then be saying more than the data.
 * Returns the disagreements; an empty array is the pass.
 */
export function assertCountsAgainstGame(rulesByResonator, appliers) {
    const ceilings = new Map();
    for (const [buffId, entry] of Object.entries(appliers?.appliers ?? {})) {
        const resonatorId = Number(String(buffId).slice(0, 4));
        const id = `${resonatorId} ${entry.status}`;
        ceilings.set(id, Math.max(ceilings.get(id) ?? 0, entry.stacks ?? 1));
    }
    const problems = [];
    for (const [resonatorId, rules] of Object.entries(rulesByResonator)) {
        for (const rule of rules) {
            const ceiling = ceilings.get(`${Number(resonatorId)} ${rule.status}`);
            if (ceiling != null && rule.stacks > ceiling) {
                problems.push({ resonatorId: Number(resonatorId), ...rule, gameMax: ceiling });
            }
        }
    }
    return problems;
}
