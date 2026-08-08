/**
 * A `multiplierUp` effect that is always on and scoped to NOTHING inflates
 * every hit its wielder lands.
 *
 *   node tests/multiplier-scope.test.mjs
 *
 * `multiplierUp` is the skill's own RATE, and `resolveChainInherentContext`
 * adds it to `ctxNode.multiplierUp` for a hit whenever the effect names no
 * skill keys AND states no category (src/core/buffs.js:347). Combined with
 * `defaultActive` and `window.type === 'always'` that is a permanent, silent
 * multiplier on the whole kit: a Cantarella S2 build resolved `multiplierUp`
 * 2.45 on `basic_1` — every unrelated hit multiplied 3.45x — from a clause that
 * says only "The DMG Multiplier of Jolt … is increased by 245%".
 *
 * Six shipped that way, and the direction is what makes it dangerous: this is
 * INFLATION, so the affected resonators simply looked better than they are.
 *
 * Two guards, both roster-wide:
 *   1. no `multiplierUp` effect may be always-on with no scope at all;
 *   2. a clause whose skill names RESOLVE must be bound to them — which fails
 *      if `bindSkillScopes` stops running, or runs in the wrong order.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { splitClauses } from '../tools/preprocess/effects.mjs';
import { targetNamesInClause, subjectNamesInClause, bulletNamesInClause, resolveNameToKeys }
    from '../tools/preprocess/skill-scope.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataset = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

/** [slot, effect, node] for every chain and inherent effect a resonator carries. */
function effectsOf(resonator) {
    const nodes = [
        ...(resonator.resonanceChain ?? []).map(node => [`S${node.level}`, node]),
        ...(resonator.inherentSkills ?? []).map((node, index) => [`IH${index}`, node]),
    ];
    return nodes.flatMap(([slot, node]) =>
        (node.effects ?? []).map((effect, index) => [`${slot}.${index}`, effect, node]));
}

// ── The clause shapes the six defects were written in ────────────────────────
{
    // The game pluralises the stat when it lists skills, and then says "are".
    // `DMG\s*Multiplier` without the `s?` matched none of these at all.
    assert('a plural "DMG Multipliers of A, B and C are increased" names three skills',
        targetNamesInClause('The DMG Multipliers of Sawring - Blitz, Chainsaw Mode - Dodge Counter'
            + ' and Sawring - Eradication are increased by 120%.').length === 3);

    // The name is followed by prose that is not part of it.
    assert('"of Jolt triggered by <wielder>" is the skill Jolt',
        targetNamesInClause('The DMG Multiplier of Jolt triggered by Cantarella is increased by 245%.')
            .join('|') === 'Jolt');
    assert('a trailing "by N%" is not part of the name',
        targetNamesInClause('Aftersound now additionally increases the DMG Multiplier of Scarlet Coda by 75%.')
            .join('|') === 'Scarlet Coda');
    assert('a trailing "is additionally" is not part of the name',
        targetNamesInClause("The DMG Multiplier of Forte Circuit's Sweet Dream is additionally increased by 150%.")
            .join('|') === "Forte Circuit's Sweet Dream");
    assert('a trailing "within Ns" is not part of the name',
        targetNamesInClause('DMG of the next Heavy Attack Detonate within 5s is increased by 120%.')
            .join('|') === 'the next Heavy Attack Detonate');

    // The stat's own adjective ("Hack DMG Multiplier"), the one shape with no
    // "of" and no possessive to hang a name on.
    // …and only for the multiplier, since the same sentence grants an amplify
    // that "Hack" does not scope.
    const lucy = 'Network Backdoor Grants 10% All DMG Amplification and 10% additional Hack DMG Multiplier.';
    assert('a name in front of the stat is read', targetNamesInClause(lucy, 'multiplierUp').join('|') === 'Hack');
    assert('…and scopes that stat only', targetNamesInClause(lucy, 'amplify').length === 0);

    // The two prepositions the game writes in place of "of".
    // The " and " in this one joins a GRANTING skill to another granting skill,
    // not a second target — the trailing "granted by …" is cut from the first
    // name and the second names no key, so only the real target survives.
    assert('"DMG Multiplier for X … is increased" names X',
        targetNamesInClause('The bonus DMG Multiplier for Sawring - Eradication granted by Sawring- Blitz'
            + ' and Chainsaw Mode - Dodge Counter when Ring of Chainsaw is consumed is increased by 120%.')[0]
            === 'Sawring - Eradication');
    assert('"X has its DMG Multiplier increased" names X',
        targetNamesInClause('Resonance Skill Golden Reflux has its DMG Multiplier increased by 50%'
            + ' and Cooldown reduced by 2s, and gains 1 more charge.')
            .join('|') === 'Resonance Skill Golden Reflux');

    // A bare CATEGORY is not a name: it is the weaker restatement the category
    // scope already carries, and resolving it by token would reach every key
    // that merely shares the word ("Heavy Attack" → Cartethyia's forte mid-airs).
    assert('a bare category is not a skill name',
        targetNamesInClause("Mid-air Attack's DMG Multiplier is increased by 30%.").length === 0
        && targetNamesInClause('Resonance Liberation DMG Multiplier is increased by 130%.').length === 0);
}

// ── A bulleted list is read only when the WHOLE list reads ───────────────────
{
    const keysOf = (name) => Object.keys(dataset.autoSkillMap[String(
        dataset.resonators.find(entry => entry.name === name).id)]);

    // The list runs PAST its own clause: the game ends a group with a period and
    // opens the next with a bullet, so `splitClauses` hands the effect only the
    // first four of Augusta's seven names. Read without the continuations, the
    // all-or-nothing gate passes on a list three members short.
    const augustaHead = 'The following skills have their DMG Multiplier increased by 25%:'
        + ' - Heavy Attack - Thunderoar: Backstep, Dodge Counter - Thunderoar: Backstep,'
        + ' Heavy Attack - Thunderoar: Spinslash, Heavy Attack - Thunderoar: Uppercut.';
    const augustaRest = ['- Resonance Skill - Undying Sunlight: Plunge.',
        '- Resonance Liberation - Sublime is the Sun: Sunborne,'
        + ' Resonance Liberation - Sublime is the Sun: Everbright Protector.'];
    assert('Augusta’s bulleted list is read across its continuation clauses',
        bulletNamesInClause(augustaHead, augustaRest, keysOf('Augusta')).length === 7);
    assert('…and a non-bullet clause ends the list',
        bulletNamesInClause(augustaHead, ['Something else entirely happens.'], keysOf('Augusta')).length === 4);

    // Rebecca's list reuses " - " as BOTH a name separator and a group
    // separator, so "Dodge Counter - Huntress - Basic Attack - Guts" is read as
    // one name and resolves to nothing. Six of seven is a list with a member
    // silently missing — leave the clause's category fallback in place instead.
    assert('Rebecca’s merged name sinks the whole list',
        bulletNamesInClause('The DMG Multipliers of the following skills are increased by 50%:'
            + ' - Basic Attack - Huntress, Heavy Attack - Huntress, Tactical Dodge - Huntress,'
            + ' and Dodge Counter - Huntress - Basic Attack - Guts, Tactical Dodge - Guts,'
            + ' Dodge Counter - Guts.', [], keysOf('Rebecca')).length === 0);
}

// ── The matcher: a name resolves only on ALL of its distinctive tokens ───────
{
    const chisa = Object.keys(dataset.autoSkillMap[String(
        dataset.resonators.find(entry => entry.name === 'Chisa').id)]);
    assert('"Sawring - Eradication" resolves to its own key only',
        resolveNameToKeys('Sawring - Eradication', chisa).join('|') === 'forte_heavy_sawring_eradication');
    assert('"Sawring - Blitz" resolves to every Blitz stage',
        resolveNameToKeys('Sawring - Blitz', chisa).length >= 3
        && resolveNameToKeys('Sawring - Blitz', chisa).every(key => key.includes('sawring_blitz')));
    assert('a name no key answers to resolves to nothing',
        resolveNameToKeys('Power Shift', chisa).length === 0);

    // The qualifiers the game writes in front of a name are dropped by the
    // loosest resolution attempt, not by the name reader — "the next Heavy
    // Attack Detonate" is Sanhua's `forte_heavy_detonate_damage`.
    const sanhua = Object.keys(dataset.autoSkillMap[String(
        dataset.resonators.find(entry => entry.name === 'Sanhua').id)]);
    assert('a leading qualifier does not stop a name resolving',
        resolveNameToKeys('the next Heavy Attack Detonate', sanhua).join('|') === 'forte_heavy_detonate_damage');
}

// ── Guard 1: no always-on multiplierUp may be scoped to nothing ──────────────
{
    const inflating = [];
    for (const resonator of dataset.resonators) {
        for (const [slot, effect] of effectsOf(resonator)) {
            if (effect.stat !== 'multiplierUp') continue;
            if (effect.skillKeys?.length || effect.skillType) continue;
            if (!effect.defaultActive || effect.window?.type !== 'always') continue;
            inflating.push(`${resonator.name} ${slot} +${(effect.value * 100).toFixed(0)}% — ${effect.condition}`);
        }
    }
    for (const row of inflating) console.error(`  · unscoped: ${row}`);
    assert(`no always-on multiplierUp effect is unscoped (got ${inflating.length})`, inflating.length === 0);
}

// ── Guard 2: a clause whose names resolve must carry them ───────────────────
// The binding pass has to run, and it has to run BEFORE anything keyed on an
// effect's slot (CLAUDE.md — effect-slot keys are frozen). Both failures look
// identical from the outside: the names simply are not there.
{
    const unread = [];
    for (const resonator of dataset.resonators) {
        const keys = Object.keys(dataset.autoSkillMap?.[String(resonator.id)] ?? {});
        if (!keys.length) continue;
        for (const [slot, effect, node] of effectsOf(resonator)) {
            if (effect.skillKeys?.length || effect.scopeSource === 'configdb') continue;
            const clause = splitClauses(node.desc ?? '')
                .find(part => part.trim().slice(0, 120) === effect.condition) ?? effect.condition;
            const names = targetNamesInClause(clause, effect.stat);
            const resolved = (names.length ? names : subjectNamesInClause(clause))
                .filter(name => name.trim().toLowerCase().replace(/(?:'s|s')$/i, '')
                    !== String(resonator.name ?? '').trim().toLowerCase())
                .flatMap(name => resolveNameToKeys(name, keys));
            if (resolved.length) unread.push(`${resonator.name} ${slot} ${effect.stat} → ${resolved.join(', ')}`);
        }
    }
    for (const row of unread) console.error(`  · names resolve but are not bound: ${row}`);
    assert(`every resolvable skill name is bound (got ${unread.length} unread)`, unread.length === 0);
}

console.log(`multiplier-scope: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
