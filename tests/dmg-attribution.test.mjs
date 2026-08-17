/**
 * A hit's DMG-TYPE ATTRIBUTION — which bonus buckets it reads.
 *
 *   node tests/dmg-attribution.test.mjs
 *
 * What this pins, and why each one is worth a test:
 *
 *  1. The three questions stay apart. `skillType` is MECHANICAL, `formulaType`
 *     is one value because it is also the skill-LEVEL key, and the ATTRIBUTION
 *     is which single bonus bucket the hit reads. A regression that collapsed
 *     them would look plausible in every number it printed.
 *  2. An ALL-ECHO row reads the echo bucket and NOT its mechanical one. Both
 *     halves matter and both were wrong before: 24 rows collected a
 *     Basic/Heavy/Skill/Liberation DMG Bonus the game does not give them, and no
 *     Echo Skill DMG grant reached them — including the ones their own kits state.
 *  3. A row the game tags two ways is a BRANCH, not a mixture, and the build's
 *     Resonance Mode picks one. Never both: the client's
 *     `GetAttackTypeDamageBonus` is a switch with a single return, so no hit
 *     ever reads two attack-type buckets.
 *  4. An unreadable attribution FALLS BACK rather than guessing. The 7 rows with
 *     more than one distinct non-echo type keep the behaviour they had; changing
 *     them is a separate correction and must not ride along with this one.
 *  5. The kit lane, not just the gear lane. An "Echo Skill DMG Bonus" clause on a
 *     resonator's own node has to reach that resonator's own echo rows —
 *     Qiuyuan's whole node paid him nothing before.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { attributionOf } from '../src/core/dmg-attribution.js';
import { resolveChainInherentContext } from '../src/core/buffs.js';
import { targetModApplies } from '../src/core/buffs/external-buffs.js';
import { resolveSkill } from '../src/core/skill.js';
import { resolveTotalStats } from '../src/core/stats.js';
import { createBuild } from '../src/core/build.js';
import { makeTarget } from '../src/core/target.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataset = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

const resonatorNamed = (name) => dataset.resonators.find(one => one.name === name);
const rowsFor = (resonatorId) => dataset.damageTable?.[String(resonatorId)] ?? [];
const skillMapFor = (resonatorId) => dataset.autoSkillMap?.[String(resonatorId)] ?? {};
const rowsOfKey = (resonatorId, key) => {
    const ids = skillMapFor(resonatorId)[key]?.damageIds ?? [];
    return rowsFor(resonatorId).filter(row => ids.includes(row.id));
};

// ── 1. The helpers ───────────────────────────────────────────────────────────
{
    assert('a row stating no attribution falls back to its formulaType',
        attributionOf({}, 'heavy') === 'heavy' && attributionOf(null, 'skill') === 'skill');
    assert('an empty stated list is not an attribution either (falls back)',
        attributionOf({ dmgTypes: [] }, 'basic') === 'basic');
    assert('a single stated attribution wins over the fallback',
        attributionOf({ dmgTypes: ['echo'] }, 'liberation') === 'echo');

    // A BRANCH is resolved by the build's Resonance Mode, never summed — the
    // client reads exactly one attack-type bonus per instance.
    const MODES = [{ key: 'glacio_chafe' }, { key: 'echo' }];
    const branch = { dmgTypes: ['basic', 'echo'] };
    assert('a branch resolves to the type named by the chosen mode',
        attributionOf(branch, 'basic', { modes: MODES, resonanceMode: 'echo' }) === 'echo');
    assert('…and to the other branch under the other mode',
        attributionOf(branch, 'basic', { modes: MODES, resonanceMode: 'glacio_chafe' }) === 'basic');
    assert('a branch with no mode context falls back rather than guessing a half',
        attributionOf(branch, 'basic') === 'basic');
    assert('a branch whose modes name neither type falls back',
        attributionOf(branch, 'basic',
            { modes: [{ key: 'tune_rupture' }, { key: 'fusion_burst' }], resonanceMode: 'fusion_burst' }) === 'basic');
}

// ── 2. The roster's own shape ─────────────────────────────────────────────────
//
// Derived from the game's per-instance `type` tags at preprocess time. The counts
// are the contract: a new resonator shipping Echo Skill DMG changes them, and
// that should be a visible finding rather than a silent re-pricing.
{
    const echoOnly = [], branched = [], plain = [];
    for (const resonator of dataset.resonators) {
        for (const row of rowsFor(resonator.id)) {
            if (!row.dmgTypes) continue;
            if (row.dmgTypes.includes('echo')) {
                (row.dmgTypes.length === 1 ? echoOnly : branched).push(`${resonator.name}: ${row.name}`);
            } else plain.push(row);
        }
    }
    assert(`24 rows are attributed to echo ALONE (found ${echoOnly.length})`, echoOnly.length === 24);
    assert(`1 row BRANCHES between two attributions (found ${branched.length})`, branched.length === 1);
    assert('…and it is Lucilla\'s [Letting It Go] — one instance per Resonance Mode',
        branched[0]?.startsWith('Lucilla:') === true);

    const perResonator = {};
    for (const entry of echoOnly) {
        const who = entry.split(':')[0];
        perResonator[who] = (perResonator[who] ?? 0) + 1;
    }
    assert('the echo-only rows sit on exactly Sigrika 10 / Galbrena 6 / Phrolova 5 / Qiuyuan 3',
        perResonator.Sigrika === 10 && perResonator.Galbrena === 6
        && perResonator.Phrolova === 5 && perResonator.Qiuyuan === 3
        && Object.keys(perResonator).length === 4);

    // Every stated attribution is a real bucket name, and never `forte_*` —
    // Forte is provenance, not a damage type (the same boundary formulaType has).
    const VALID = new Set(['basic', 'heavy', 'liberation', 'intro', 'skill', 'echo']);
    const bad = [];
    for (const resonator of dataset.resonators) {
        for (const row of rowsFor(resonator.id)) {
            for (const type of row.dmgTypes ?? []) if (!VALID.has(type)) bad.push(`${resonator.name}: ${row.name} → ${type}`);
        }
    }
    assert(`every stated attribution is a real bucket (${bad.join(', ') || 'all valid'})`, bad.length === 0);

    // AMBIGUITY IS NEVER RESOLVED INTO A SET. A row may state one non-echo type,
    // optionally plus echo — never two non-echo types. Two would mean this pass
    // had started applying both buckets to hits whose split it cannot see, which
    // is the very thing `ambiguous` exists to refuse.
    const twoTypes = [];
    for (const resonator of dataset.resonators) {
        for (const row of rowsFor(resonator.id)) {
            const nonEcho = (row.dmgTypes ?? []).filter(type => type !== 'echo');
            if (nonEcho.length > 1) twoTypes.push(`${resonator.name}: ${row.name}`);
        }
    }
    assert(`no row states two non-echo attributions (${twoTypes.join(', ') || 'none'})`, twoTypes.length === 0);
}

// ── 2b. Why the set lives on the ROW and not on the skill entry ───────────────
//
// A skillMap key can gather several damage rows (`damageIds.push`) and they need
// not share an attribution. Calcharo's Heavy Attack is the proof: two rows, one
// tagged heavy and one tagged liberation. A key-level field would have to pick
// one and would then be wrong for the other hit — which is also why a row's
// attribution legitimately differs from its key's `formulaType`.
{
    const calcharo = resonatorNamed('Calcharo');
    const rows = rowsOfKey(calcharo.id, 'heavy_heavy_attack');
    const stated = rows.map(row => (row.dmgTypes ?? []).join('+'));
    assert('Calcharo heavy_heavy_attack gathers 2 rows', rows.length === 2);
    assert('…tagged differently from each other (heavy and liberation)',
        stated.includes('heavy') && stated.includes('liberation'));
    assert('…while the KEY still reports one formulaType, as its level key must',
        skillMapFor(calcharo.id).heavy_heavy_attack?.formulaType === 'heavy');
}

// ── 3. The AMBIGUOUS rows keep the behaviour they had ─────────────────────────
//
// >1 distinct non-echo type. preprocess logs them and applies nothing; stating
// their set here would start applying two buckets at once, which is a different
// correction and would arrive disguised as this one.
// The list is preprocess's own report ("Ambiguous rows … kept mechanical: 7").
// It is per ROW, which is not the same as per key: Calcharo's Heavy Attack looks
// ambiguous if you pool its two rows' hit ids, and neither row is (see 2b).
{
    const AMBIGUOUS = [
        ['Carlotta', 'heavy_heavy_attack'],
        ['Aemeath', 'skill_sync_strike_armament_merge'],
        ['Aemeath', 'skill_mech_4'],
        ['Denia', 'heavy_mid_air_heavy_attack_breakdown_form'],
        ['Yuanwu', 'forte_heavy_thunderweaver_damage'],
        ['Rover: Havoc', 'forte_heavy_umbra_thwackblade_damage'],
        ['Rover: Havoc', 'forte_heavy_umbra_lifetaker_damage'],
    ];
    let fellBack = 0, found = 0;
    for (const [name, key] of AMBIGUOUS) {
        const resonator = resonatorNamed(name);
        const rows = rowsOfKey(resonator?.id, key);
        if (rows.length) found++;
        if (rows.some(row => !row.dmgTypes)) fellBack++;
    }
    assert(`all 7 ambiguous keys still resolve (found ${found})`, found === AMBIGUOUS.length);
    assert(`…and every one keeps a row that states nothing (${fellBack}/7)`, fellBack === AMBIGUOUS.length);
}

// ── 3b. A row whose synthetic id is NaN — pinned, not fixed ───────────────────
//
// `synId = rid*1e7 + nodeId*1000 + Number(paramK)` is NaN when the source uses a
// SUFFIXED level-param key (`15_2`, `28_2`, `29_5` …), and NaN serialises to
// null. `resolveSkill` resolves a row by `find(row => row.id === id)`, so every
// key holding a null id lands on the FIRST null-id row of that resonator. Chisa
// has seven, so six of her keys read the wrong multiplier (two of them 0.1074
// read as 1.1936, ~11x). None is in a curated rotation, so nothing shipped moves.
// Pinned so the fix is visible when it lands — see OPEN-ITEMS 2g.
{
    let nullRows = 0, keysAffected = 0;
    for (const resonator of dataset.resonators) {
        nullRows += rowsFor(resonator.id).filter(row => row.id === null).length;
        keysAffected += Object.entries(skillMapFor(resonator.id))
            .filter(([key, def]) => !key.startsWith('_') && (def.damageIds ?? []).some(id => id === null)).length;
    }
    assert(`9 damage rows carry a NaN id (found ${nullRows}) — OPEN-ITEMS 2g`, nullRows === 9);
    assert(`9 keys point at one (found ${keysAffected}); only Chisa's 7 collide`, keysAffected === 9);
}

// ── 4. What a hit actually collects, through the real resolveSkill path ───────
{
    const target = makeTarget();
    const withBucket = (resonatorName, key, bucket, value) => {
        const resonator = resonatorNamed(resonatorName);
        const build = createBuild(resonator);
        const base = resolveTotalStats(build, dataset);
        const stats = { ...base, dmgBonusBySkillType: { ...base.dmgBonusBySkillType, [bucket]: value } };
        const skillDef = skillMapFor(resonator.id)[key];
        return resolveSkill({ skillDef, build, dataset, stats, target, skillKey: key })?.totalExpected ?? 0;
    };
    const responds = (resonatorName, key, bucket) => {
        const plain = withBucket(resonatorName, key, '__nothing__', 0);
        const boosted = withBucket(resonatorName, key, bucket, 0.5);
        return { plain, ratio: plain > 0 ? boosted / plain : 0 };
    };

    // An all-echo row: the echo bucket pays in full, the mechanical one not at all.
    for (const [who, key, mechanical] of [
        ['Sigrika', 'forte_heavy_runic_chain_whip', 'heavy'],
        ['Sigrika', 'liberation', 'liberation'],
        ['Qiuyuan', 'skill_undaunted_wayfarer', 'skill'],
        ['Phrolova', 'liberation_hecate_2', 'liberation'],
        ['Galbrena', 'basic_basic_attack_4', 'basic'],
    ]) {
        const mech = responds(who, key, mechanical);
        const echo = responds(who, key, 'echo');
        assert(`${who} ${key}: +50% ${mechanical} DMG Bonus does NOT reach it`,
            mech.plain > 0 && Math.abs(mech.ratio - 1) < 1e-9);
        assert(`${who} ${key}: +50% Echo Skill DMG Bonus DOES, in full`,
            Math.abs(echo.ratio - 1.5) < 1e-9);
    }

    // Lucilla's branch: exactly ONE bucket pays, and which one is her mode's
    // answer. Never both — the client's GetAttackTypeDamageBonus is a switch.
    // Read off the breakdown rather than a damage ratio, because her kit adds a
    // base dmgBonus of its own in Echo mode and a ratio would fold the two.
    const lettingItGo = (mode, bucket) => {
        const resonator = resonatorNamed('Lucilla');
        const build = { ...createBuild(resonator), resonanceMode: mode };
        const base = resolveTotalStats(build, dataset);
        const stats = { ...base, dmgBonusBySkillType: { ...base.dmgBonusBySkillType, [bucket]: 0.5 } };
        const skillDef = skillMapFor(resonator.id).liberation_letting_it_go;
        const hit = resolveSkill({ skillDef, build, dataset, stats, target, skillKey: 'liberation_letting_it_go' })?.hits?.[0];
        return { attribution: hit?.skill?.dmgType, typeDmg: hit?.result?.breakdown?.typeDmg };
    };
    const echoMode = lettingItGo('echo', 'echo');
    const glacioMode = lettingItGo('glacio_chafe', 'basic');
    assert('Lucilla in Resonance Mode - Echo: [Letting It Go] IS Echo Skill DMG',
        echoMode.attribution === 'echo' && Math.abs(echoMode.typeDmg - 0.5) < 1e-9);
    assert('…and the Basic bucket reaches it with nothing',
        lettingItGo('echo', 'basic').typeDmg === 0);
    assert('Lucilla in Resonance Mode - Glacio Chafe: the same row IS Basic Attack DMG',
        glacioMode.attribution === 'basic' && Math.abs(glacioMode.typeDmg - 0.5) < 1e-9);
    assert('…and the Echo bucket reaches it with nothing',
        lettingItGo('glacio_chafe', 'echo').typeDmg === 0);

    // The control: an ordinary row is untouched by all of this.
    assert('an ordinary Liberation row still takes the Liberation bucket',
        Math.abs(responds('Aemeath', 'liberation_heavenfall_edict_finale', 'liberation').ratio - 1.5) < 1e-9);
    assert('…and takes nothing from the echo bucket',
        Math.abs(responds('Aemeath', 'liberation_heavenfall_edict_finale', 'echo').ratio - 1) < 1e-9);
}

// ── 5. The kit lane and the target lane read the set too ─────────────────────
//
// Five places used to compare one formulaType. The gear bucket above is one;
// these are the chain/inherent/node lane and the per-hit target lane. The
// window lane (buff-windows.js) calls the same two helpers section 1 pins.
{
    const echoClause = [{ stat: 'skillTypeBonus', skillType: 'echo', value: 0.30 }];
    const onEcho = resolveChainInherentContext(echoClause, { element: 2, skillType: 'echo', skillKey: 'x' });
    const onLiberation = resolveChainInherentContext(echoClause, { element: 2, skillType: 'liberation', skillKey: 'x' });
    assert('an "Echo Skill DMG Bonus" clause reaches an all-echo hit (Qiuyuan\'s own node)',
        Math.abs(onEcho.dmgBonus - 0.30) < 1e-9);
    assert('…and not a Liberation-attributed hit of the same cast type',
        onLiberation.dmgBonus === 0);

    const echoAmplify = [{ stat: 'amplify', skillType: 'echo', value: 0.5 }];
    assert('an echo-scoped AMPLIFY behaves the same way',
        Math.abs(resolveChainInherentContext(echoAmplify, { element: 2, skillType: 'echo' }).amplify - 0.5) < 1e-9
        && resolveChainInherentContext(echoAmplify, { element: 2, skillType: 'basic' }).amplify === 0);

    // The NODE lens is fed the MECHANICAL type and must keep reading it —
    // multiplierUp matches the node, not the attribution.
    const nodeClause = [{ stat: 'skillTypeBonus', skillType: 'liberation', value: 0.2 }];
    assert('the node lens still compares a single mechanical type',
        Math.abs(resolveChainInherentContext(nodeClause, { element: 2, skillType: 'liberation' }).dmgBonus - 0.2) < 1e-9
        && resolveChainInherentContext(nodeClause, { element: 2, skillType: 'basic' }).dmgBonus === 0);

    // A DamageTypes-scoped target modifier (the game's own 0..5 tag → our types).
    const echoScoped = { scope: { skillTypes: ['echo'], elementIds: null }, defIgnore: 0.32 };
    assert('a DamageTypes:[5] target mod applies to an all-echo hit',
        targetModApplies(echoScoped, 'echo', 2) === true);
    assert('…and not to a Liberation-attributed hit',
        targetModApplies(echoScoped, 'liberation', 2) === false);
    assert('an unscoped target mod still applies to everything',
        targetModApplies({ scope: null, defIgnore: 0.1 }, 'basic', 2) === true);
}

console.log(`dmg-attribution: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
