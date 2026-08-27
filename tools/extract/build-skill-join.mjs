/**
 * Joins the game's own DT_SkillInfo skill ids onto the sim's rotation-step keys
 * (basic_1, liberation, forte_heavy_sawring_eradication, ...) and writes the
 * committed data/skill-join.json.
 *
 * WHY IT IS NEEDED. Several extractions are keyed by DT_SkillInfo skill id and
 * nothing else: data/gauge-income.json states every resource grant and spend
 * that way, and the sim addresses casts by skill key. There are TWO id spaces
 * and they only sometimes coincide — a damage id is usually its owning skill
 * row's id plus a hit index (1508404 -> 15084040010), but Chisa's Intro damage
 * is 1508008xxx while the row that grants her gauge is 1508600. Without a join
 * table each consumer re-invents a prefix match and gets a different answer.
 *
 * INPUT NOTE, same arrangement as data/actionable-times.json: the DT_SkillInfo
 * side (data/timing-data.json) is gitignored — multi-MB and regenerable only
 * from the raw asset export in docs-local/. The OUTPUT is committed so the
 * build never depends on that export.
 *
 * THREE ROUTES, in precedence order. Each is exact identity, not similarity:
 *
 * 1. `damageId` — the key's own raw hit ids (data/hit-map.json) resolved to a
 *    row by longest exact prefix match (tools/extract/skill-row-id.mjs, the
 *    same primitive map-timings.mjs uses). Strongest: it is id identity at
 *    both ends.
 *
 * 2. `montage` — the row's animation asset matched against the animation
 *    data/actionable-times.json chose for a key. Accepted ONLY when it lands
 *    on exactly one key AND route 1 found nothing, because a montage is
 *    many-to-one against skill rows: measured against route 1 on the rows both
 *    reach, it disagreed 6 times and was wrong all 6 (it swapped Lupa's
 *    1207513/1207612, which route 1 separates by exact id).
 *
 * 3. `genreSingleton` — for the two genre buckets that are clean (see below),
 *    a row whose category the resonator has exactly ONE key for is forced onto
 *    that key. This is the only route that reasons from a category rather than
 *    an id, so it is restricted to Intro and Liberation, requires the key to be
 *    unclaimed by route 1, and is tagged in the output so a reader can discount
 *    it.
 *
 * SkillGenre IS NOT SkillType, and the ordinals differ from the damage-type
 * tag's — see GENRE_CATEGORY. Cross-checked against the resolved keys' own
 * mechanical skillType, `intro` (42/44) and `liberation` (55/58) are clean but
 * `basic` (269 of 458) is not: the game files a move under the input that casts
 * it, so genre restates the same LABEL-vs-TYPE split the dataset already
 * handles. That is why genre is recorded as provenance and never used as a
 * type.
 *
 * A row no route resolves is REFUSED, not guessed, and listed with its reason
 * in docs/skill-join-report.md.
 *
 * Run: node tools/extract/build-skill-join.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveSkillId } from './skill-row-id.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '../../data');
const load = name => JSON.parse(readFileSync(resolve(DATA_DIR, name), 'utf8'));

const timingPath = resolve(DATA_DIR, 'timing-data.json');
if (!existsSync(timingPath)) {
    console.error('data/timing-data.json is missing. It is gitignored and comes from');
    console.error('tools/extract/extract_timings.py over the raw export in docs-local/.');
    console.error('data/skill-join.json is committed; rebuild it only with that export present.');
    process.exit(1);
}

const timingResonators = load('timing-data.json').resonators;
const hitMap = load('hit-map.json').map;
const actionableTimes = load('actionable-times.json').actionableTimes;
const dataset = load('wuwa-data.json');
const gaugeIncome = load('gauge-income.json').resonators;

/**
 * DT_SkillInfo's own SkillGenre enum, decoded from the row names it labels
 * (0 基础普攻 basic, 3 大招 ultimate, 4 QTE, 13 延奏技能 outro, 14 破弱 Tune Break).
 *
 * NOT the damage-type tag skill.damage[*].type uses, which is
 * {0 basic, 1 heavy, 2 liberation, 3 intro, 4 skill, 5 echo}. The two agree on
 * 0 and 1 and diverge from 2 on, so reading one as the other silently swaps
 * skill and liberation.
 */
const GENRE_CATEGORY = {
    0: 'basic', 1: 'heavy', 2: 'skill', 3: 'liberation', 4: 'intro',
    5: 'dodgeCounter', 6: 'dodge', 7: 'perfectDodge', 8: 'passive',
    9: 'transform', 10: 'sprint', 11: 'airDodge', 12: 'stance',
    13: 'outro', 14: 'tuneBreak',
};
/** The genre buckets whose mapping onto a mechanical skillType is clean enough to force. */
const SINGLETON_GENRES = { intro: 'intro', liberation: 'liberation' };

function genreCategoryOf(genre) {
    const ordinal = String(genre ?? '').match(/(\d+)$/);
    return ordinal ? GENRE_CATEGORY[Number(ordinal[1])] ?? null : null;
}

/** "/Game/.../FemaleM/Qianxia/CommonAnim/AM_Burst01.AM_Burst01" and
 *  "FemaleM/Qianxia/CommonAnim/AM_Burst01.uasset" name the same animation. */
function normalizeMontage(path) {
    if (!path) return null;
    let value = String(path).split('\\').join('/').replace(/\.uasset$/i, '');
    const dot = value.lastIndexOf('.');
    if (dot > value.lastIndexOf('/')) value = value.slice(0, dot);
    const underRole = value.match(/Role\/(.+)$/i);
    return (underRole ? underRole[1] : value).toLowerCase();
}

const rosterIds = Object.values(dataset.resonators).map(resonator => String(resonator.id));

// Route 1 — every key's raw hit ids, resolved to their owning DT_SkillInfo row.
function rowKeysByDamageId(rid) {
    const knownRowIds = new Set(Object.keys(timingResonators[rid]?.skills ?? {}));
    const index = {};
    for (const [key, hitIds] of Object.entries(hitMap[rid] ?? {})) {
        for (const hitId of hitIds) {
            const rowId = resolveSkillId(String(hitId), knownRowIds);
            if (rowId) (index[rowId] ??= new Set()).add(key);
        }
    }
    return index;
}

// Route 2 — the animation each key was measured on.
function keysByMontage(rid) {
    const index = {};
    for (const [key, record] of Object.entries(actionableTimes[rid] ?? {})) {
        const assets = new Set([record.sourceMontage, ...(record.variants ?? []).map(variant => variant.montage)]);
        for (const asset of assets) {
            const normalized = normalizeMontage(asset);
            if (normalized) (index[normalized] ??= new Set()).add(key);
        }
    }
    return index;
}

const join = {};
const refusals = [];
const routeCounts = { damageId: 0, montage: 0, genreSingleton: 0 };
let rowsSeen = 0;

for (const rid of rosterIds) {
    const skills = timingResonators[rid]?.skills;
    if (!skills) continue;
    const byDamageId = rowKeysByDamageId(rid);
    const byMontage = keysByMontage(rid);
    const skillMap = dataset.autoSkillMap?.[rid] ?? {};
    const claimed = new Set(Object.values(byDamageId).flatMap(keys => [...keys]));
    const perResonator = {};

    for (const [skillId, row] of Object.entries(skills)) {
        rowsSeen++;
        const category = genreCategoryOf(row.genre);
        const base = { name: row.skill_name ?? null, genre: category, genreRaw: row.genre ?? null };

        const exact = [...(byDamageId[skillId] ?? [])].sort();
        if (exact.length) {
            perResonator[skillId] = { ...base, keys: exact, route: 'damageId' };
            routeCounts.damageId++;
            continue;
        }

        const montageKeys = new Set();
        for (const montage of row.montages ?? []) {
            const normalized = normalizeMontage(montage.game_path ?? montage.asset);
            for (const key of byMontage[normalized] ?? []) montageKeys.add(key);
        }
        if (montageKeys.size === 1) {
            perResonator[skillId] = { ...base, keys: [...montageKeys], route: 'montage' };
            routeCounts.montage++;
            continue;
        }

        const singletonType = SINGLETON_GENRES[category];
        if (singletonType) {
            const candidates = Object.keys(skillMap)
                .filter(key => skillMap[key].skillType === singletonType && !claimed.has(key));
            if (candidates.length === 1) {
                perResonator[skillId] = { ...base, keys: candidates, route: 'genreSingleton' };
                routeCounts.genreSingleton++;
                continue;
            }
        }

        refusals.push({
            rid, skillId, ...base,
            reason: montageKeys.size > 1 ? 'montage names several keys'
                : row.montages?.length ? 'no key owns this row\'s ids or animation'
                    : 'row has no animation and no damage ids',
            candidates: [...montageKeys].sort(),
        });
    }
    if (Object.keys(perResonator).length) join[rid] = perResonator;
}

// Coverage is reported against the consumer that exists today: the gauge-income
// CAST rows, which are the ones RESOURCE_DEFS has to attach to a rotation step.
const gaugeRows = new Set();
for (const [rid, record] of Object.entries(gaugeIncome))
    for (const row of record.cast ?? []) gaugeRows.add(rid + ':' + row.skillId);

let gaugeResolved = 0, gaugeUnique = 0;
const gaugeRefused = [];
for (const signature of gaugeRows) {
    const [rid, skillId] = signature.split(':');
    const entry = join[rid]?.[skillId];
    if (!entry) {
        const refusal = refusals.find(item => item.rid === rid && item.skillId === skillId);
        gaugeRefused.push(refusal ?? { rid, skillId, reason: 'no DT_SkillInfo row for this resonator' });
        continue;
    }
    gaugeResolved++;
    if (entry.keys.length === 1) gaugeUnique++;
}

const coverage = {
    skillRowsSeen: rowsSeen,
    resolved: routeCounts.damageId + routeCounts.montage + routeCounts.genreSingleton,
    byRoute: routeCounts,
    refused: refusals.length,
    gaugeIncomeCastRows: gaugeRows.size,
    gaugeIncomeResolved: gaugeResolved,
    gaugeIncomeUniqueKey: gaugeUnique,
    gaugeIncomeRefused: gaugeRefused.length,
};

const output = {
    _doc: 'DT_SkillInfo skill id -> sim rotation-step key(s), per resonator. `route` records how ' +
        'the join was made: "damageId" = the key\'s own raw hit ids resolve to this row by longest ' +
        'exact prefix (strongest); "montage" = the row\'s animation is the one actionable-times ' +
        'measured for exactly one key; "genreSingleton" = an Intro/Liberation row forced onto the ' +
        'resonator\'s only unclaimed key of that type (weakest — it reasons from a category). ' +
        '`keys` may hold several: one skill row can produce several display rows. `genre` is ' +
        'DT_SkillInfo\'s own SkillGenre, recorded as provenance and NEVER used as a skillType — ' +
        'its ordinals are not the damage-type tag\'s, and it restates the label, not the mechanic. ' +
        'Rows no route resolves are refused, not guessed: see docs/skill-join-report.md. ' +
        'Generated by tools/extract/build-skill-join.mjs; do not hand-edit.',
    generatedAt: new Date().toISOString(),
    genreCategories: GENRE_CATEGORY,
    coverage,
    resonators: join,
};
writeFileSync(resolve(DATA_DIR, 'skill-join.json'), JSON.stringify(output, null, 2) + '\n');

const report = ['# Skill-join gaps', '',
    'Generated by `tools/extract/build-skill-join.mjs`. Every DT_SkillInfo row below is one no',
    'route could tie to a rotation-step key, listed rather than guessed.', '',
    `- skill rows seen: **${rowsSeen}**, resolved **${coverage.resolved}**, refused **${refusals.length}**`,
    `- by route: damageId ${routeCounts.damageId}, montage ${routeCounts.montage}, genreSingleton ${routeCounts.genreSingleton}`,
    `- gauge-income cast rows: **${gaugeResolved}/${gaugeRows.size}** resolved, ` +
    `${gaugeUnique} to a single key, **${gaugeRefused.length}** refused`, '',
    '## Refused rows with a gauge-income consumer', '',
    '| rid | skillId | name | genre | reason |', '| --- | --- | --- | --- | --- |'];
for (const item of gaugeRefused)
    report.push(`| ${item.rid} | ${item.skillId} | ${item.name ?? ''} | ${item.genre ?? ''} | ${item.reason} |`);
report.push('', '## All other refused rows', '',
    '| rid | skillId | name | genre | reason |', '| --- | --- | --- | --- | --- |');
const gaugeRefusedIds = new Set(gaugeRefused.map(item => item.rid + ':' + item.skillId));
for (const item of refusals) {
    if (gaugeRefusedIds.has(item.rid + ':' + item.skillId)) continue;
    report.push(`| ${item.rid} | ${item.skillId} | ${item.name ?? ''} | ${item.genre ?? ''} | ${item.reason} |`);
}
writeFileSync(resolve(__dirname, '../../docs/skill-join-report.md'), report.join('\n') + '\n');

console.log(`skill rows ${rowsSeen} | resolved ${coverage.resolved} ` +
    `(damageId ${routeCounts.damageId}, montage ${routeCounts.montage}, genreSingleton ${routeCounts.genreSingleton})` +
    ` | refused ${refusals.length}`);
console.log(`gauge-income cast rows ${gaugeResolved}/${gaugeRows.size} resolved, ` +
    `${gaugeUnique} unique, ${gaugeRefused.length} refused`);
console.log('wrote data/skill-join.json + docs/skill-join-report.md');
