/**
 * Effect-parser COVERAGE: a kit clause that states a damage-affecting
 * percentage must produce an effect, or be on the list of clauses we have
 * decided not to read — and that list is pinned here, one entry at a time.
 *
 *   node tests/effect-coverage.test.mjs
 *
 * WHY THIS EXISTS. The parser fails SILENTLY: a clause it cannot read produces
 * no effect, no warning, and no diff — the buff simply is not there. Measured
 * 2026-08-07 against the Aemeath/Denia/Chisa benchmark, 109 of 324 clauses that
 * state a buff percentage parsed to NOTHING, including Denia's team-wide +30%
 * Fusion DMG Bonus and Chisa's team-wide +50% All-Attribute DMG Bonus. Nothing
 * in the suite noticed, because every test asserted what the parser DID produce.
 *
 * So this file asserts the complement: what it FAILED to produce. A new
 * resonator whose kit uses a phrasing the parser has never seen lands in
 * UNREAD below and fails the run, instead of quietly costing that character
 * damage nobody can account for.
 *
 * HOW TO REACT TO A FAILURE. A clause listed as newly unread is one of two
 * things. Either it is a real buff in a word order the parser cannot read yet —
 * fix `tools/preprocess/effects.mjs`, which is the point — or it is a clause
 * this bucket must not hold, in which case add it to UNREAD with the reason.
 * Do NOT relax the vocabulary to make a clause disappear from the scan; that
 * hides the next one too.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { splitClauses, parseEffectsFromDesc } from '../tools/preprocess/effects.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataset = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

// A clause is in scope when it carries a percentage AND names a stat this
// engine has a bucket for. Keep this list in terms of what the GAME writes, not
// of what the parser happens to match — the gap between the two is the finding.
const BUFF_VOCABULARY = [
    /DMG\s*Bonus/i,
    /Amplif/i,
    /DMG\s*Multiplier|Multiplier\s+is\s+increas/i,
    /(?:DMG|damage)[^.]{0,90}?\b(?:is\s+)?increased?\s+by\s+[\d.]+\s*%/i,
    /Crit\.?\s*(?:Rate|DMG)/i,
    /\bATK\b[^.]{0,60}?increased?\s+by\s+[\d.]+\s*%/i,
    /deals?\s+[\d.]+\s*%\s+more\s+DMG/i,
];

// Clauses deliberately left unread, each with the reason. Keyed by a distinctive
// fragment so the entry survives re-wording of the surrounding sentence.
// Anything here is a KNOWN understatement of that character, not a solved case.
const UNREAD = [
    { id: 1108, match: 'Crit. DMG of Foreclaiming',
        why: 'Names two skills whose kit names share no token with their keys ("Foreclaiming: Inward Vision" → liberation_inward_vision), so skill-scope.mjs cannot bind them. 500% Crit. DMG applied unscoped would hit every attack she throws.' },
    { id: 1110, match: 'Crit. DMG of Intro Skill - Tinkling Jade',
        why: 'Same shape as Hiyuki S6: one of the two names resolves, the other does not, and a partial bind on a 500% value is worse than none.' },
    { id: 1505, match: "increases Shorekeeper's Crit. DMG by 500%",
        why: 'Genuinely global to herself, but 500% is beyond the branch bound that keeps unscopable crit clauses out. Understates Shorekeeper S6.' },
    { id: 1108, match: 'Glacio Bite DMG taken by targets',
        why: "The TARGET's side of the amplify bucket, and scoped to a status name the skill map has no key for. dmgTakenEffect handles the 'takes N% more DMG' phrasing only." },
    { id: 1210, match: 'DMG Multiplier of Fusion Burst triggered by',
        why: 'Multiplies the NEGATIVE STATUS\'s damage, not Aemeath\'s hits — a separate formula (enemy-status.js) with no crit and no gear stat. Belongs to the affliction lane.' },
    { id: 1210, match: 'DMG Multiplier increase to Fusion Burst',
        why: 'Same status lane as the sibling clause above.' },
    { id: 1303, match: "increased by 20% of Yuanwu's DEF",
        why: 'A DEF-scaled FLAT add, not a percentage increase. Reading it as one would put +20% on every Thunder Wedge tick.' },
    { id: 1305, match: "8% of the skill's DMG Multiplier",
        why: 'Six extra damage INSTANCES each worth 8% of the parent skill, not an 8% increase to it. Needs an added-instance shape the damage table has no room for.' },
    { id: 1603, match: 'is increased to 250%',
        why: 'A SET to an absolute value, which multiplierUp (an increment) cannot hold without knowing the base.' },
];

// ── Scan ─────────────────────────────────────────────────────────────────────
const unread = [];
let inScope = 0;
for (const resonator of dataset.resonators) {
    const nodes = [
        ...(resonator.inherentSkills ?? []).map((node, i) => [`IH${i}`, node.desc]),
        ...(resonator.resonanceChain ?? []).map(chain => [`S${chain.level}`, chain.desc]),
    ];
    for (const [slot, desc] of nodes) {
        for (const clause of splitClauses(desc)) {
            if (!/[\d.]+\s*%/.test(clause)) continue;
            if (!BUFF_VOCABULARY.some(pattern => pattern.test(clause))) continue;
            inScope++;
            if (parseEffectsFromDesc(clause, resonator.name).length === 0) {
                unread.push({ id: resonator.id, name: resonator.name, slot, clause: clause.replace(/\s+/g, ' ') });
            }
        }
    }
}

// ── The gate ─────────────────────────────────────────────────────────────────
{
    const accounted = (row) => UNREAD.some(known => known.id === row.id && row.clause.includes(known.match));
    const surprises = unread.filter(row => !accounted(row));
    for (const row of surprises) {
        console.error(`  ✗ UNREAD: ${row.name} ${row.slot} — ${row.clause.slice(0, 150)}`);
    }
    assert(`every buff clause is read or listed (${surprises.length} unaccounted of ${inScope} in scope)`,
        surprises.length === 0);

    // The reverse direction: an UNREAD entry that no longer matches anything is
    // either fixed (delete it) or the kit text moved (re-anchor it). Left in
    // place it silently licenses whatever clause drifts into its wording next.
    for (const known of UNREAD) {
        assert(`UNREAD entry still matches a real clause: ${known.id} "${known.match}"`,
            unread.some(row => row.id === known.id && row.clause.includes(known.match)));
    }

    // A ratchet on the total. 109 of 324 were unread before this pass; the list
    // above is 9. It may only ever shrink — a rise means a new kit phrasing went
    // in unnoticed, which is the exact failure this file exists to catch.
    assert(`unread buff clauses have not grown past 9 (got ${unread.length})`, unread.length <= 9);
    assert('the scan still sees the whole roster (>= 300 buff clauses in scope)', inScope >= 300);
}

// ── Named regressions: one per phrasing family the pass taught the parser ─────
// Each was measured as producing ZERO effects before 2026-08-07.
{
    const one = (text, name = null) => parseEffectsFromDesc(text, name);

    const backward = one('All Resonators in the team gain 30% Fusion DMG Bonus.');
    assert('backward order: "gain 30% Fusion DMG Bonus" reads 30% Fusion',
        backward.length === 1 && backward[0].stat === 'elementBonus'
        && Math.abs(backward[0].value - 0.30) < 1e-9 && backward[0].element === 2);
    assert('…and is recognised as granted TO the team', backward[0]?.teamWide === true);

    const grantVerb = one('Casting Everblooming gives all team members 25% Basic Attack DMG Bonus for 30s.');
    assert('grant verb in front of the team phrase is still a team buff', grantVerb[0]?.teamWide === true);

    const dealt = one("Damage dealt by Sanhua's Resonance Skill increased by 20% for 8s after casting her Intro Skill.");
    assert('"Damage dealt by X increased by N%" reads as a multiplier increase',
        dealt.some(e => e.stat === 'multiplierUp' && Math.abs(e.value - 0.20) < 1e-9 && e.skillType === 'skill'));

    const named = one('The DMG of Resonance Liberation Final Act - Stagecraft Form is increased by 100%.');
    assert('"The DMG of <skill> is increased by N%" reads 100% multiplierUp',
        named.some(e => e.stat === 'multiplierUp' && Math.abs(e.value - 1.0) < 1e-9));

    const increases = one('The DMG Multiplier of Intro Skill Nowhere to Run! increases by 100%.');
    assert('"increases by" (not "increased by") is read',
        increases.some(e => e.stat === 'multiplierUp' && Math.abs(e.value - 1.0) < 1e-9));

    const gainedMult = one('Rebecca\'s Resonance Liberation - Party \'til Dawn! gain 60% DMG Multiplier increase.');
    assert('"gain 60% DMG Multiplier increase" reads the value in front of the stat',
        gainedMult.some(e => e.stat === 'multiplierUp' && Math.abs(e.value - 0.60) < 1e-9));

    // The scope must come from the sentence's SUBJECT, not from the cast that
    // merely triggers it — the trigger is what the game names first.
    const triggerFirst = one("After casting Intro Skill Applaud for Me!, Brant's DMG dealt is increased by 20% for 5s.");
    assert('a leading trigger does not become the buff\'s scope',
        triggerFirst.some(e => e.stat === 'multiplierUp' && e.skillType === null));
    const statScope = one('Casting Heavy Attack Mercy gives Calcharo 10% Resonance Liberation DMG Bonus for 15s.');
    assert('the stat phrase owns the scope, not the trigger list',
        statScope.some(e => e.stat === 'skillTypeBonus' && e.skillType === 'liberation'));

    // Exclusions: each of these used to be, or would become, a wrong effect.
    assert('"increased to N%" (a SET) produces no increment',
        one('The bonus DMG Multiplier granted by Sweet Dream is increased to 250%.').length === 0);
    assert('"N% of <stat>" is not a percentage increase',
        one("When the Coordinated Attacks hit a target, the damage is additionally increased by 20% of Yuanwu's DEF.").length === 0);
    assert('a per-stack value is not read as its own ceiling',
        one('Each stack additionally grants Runic Outburst 15% DMG Amplification, up to 60%.')
            .some(e => e.stat === 'amplify' && Math.abs(e.perStack - 0.15) < 1e-9));
    assert('a clause gated on target HP is conditional, not an always-on buff',
        one("Sanhua's damage dealt is increased by 35% against targets with HP below 70%.")
            .every(e => e.conditionKind === 'situational' && e.defaultActive === false));
}

console.log(`effect-coverage: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
