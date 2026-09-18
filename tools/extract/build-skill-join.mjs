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

/**
 * The DT_SkillInfo rid that OWNS a dataset id's damage ids.
 *
 * Usually the dataset id itself. Not for Spectro Rover: the dataset ships 1501
 * (the male-bodied id, which won `preprocess.mjs`'s dedupe) while every one of
 * her 17 hit ids is 1502-prefixed, because the damage table the game files for
 * Spectro lives under the FEMALE id. Resolving those against 1501's rows
 * matched 0 of 17 where 1502's rows match 14, so route 1 — the strongest, the
 * one that reasons from exact id identity — was entirely dead for her: 3 joined
 * rows against 29/15/21 for the other three Rovers, and her `基础普攻1..4`,
 * `蓄力1` and Liberation rows all refused as "no key owns this row's ids".
 *
 * ~~A remap here would double-count rather than recover data.~~ That is true of
 * `gauge-income.json`, whose male and female rows are a pure mirror (identical
 * `buffId` included), and FALSE of the id space — which is what item 38 named.
 * The prefix must be UNANIMOUS across the key's ids; a mixed set means the
 * assumption does not hold and the dataset rid is kept, because a partial remap
 * would join half a resonator against a stranger's rows.
 */
function rowSourceRidOf(rid) {
    const prefixes = new Set(Object.values(hitMap[rid] ?? {}).flat().map(id => String(id).slice(0, 4)));
    if (prefixes.size !== 1) return rid;
    const [prefix] = prefixes;
    return timingResonators[prefix]?.skills ? prefix : rid;
}

// Route 1 — every key's raw hit ids, resolved to their owning DT_SkillInfo row.
function rowKeysByDamageId(rid, sourceRid = rid) {
    const knownRowIds = new Set(Object.keys(timingResonators[sourceRid]?.skills ?? {}));
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
//
// `genderMirroredFrom` is indexed alongside `sourceMontage` because the two
// sides of this join read DIFFERENT artifacts: the row cites its own montage
// from `timing-data.json` (for Rover, the MALE path, since the dataset's rid is
// the male-bodied one) while `actionable-times.json` has been substituted onto
// the female asset. Yesterday's gender fix therefore desynchronised them and
// silently cost Aero Rover's `heavy_heavy_attack` both of its joined rows
// (`1406009 长按-极限闪避反击`, `1406101 重击`) — a regression that only appeared
// when the join was rebuilt, because the committed artifact predated it.
// The mirrored-from path is exactly the male path the row cites, so indexing it
// restores the match without loosening anything.
function keysByMontage(rid) {
    const index = {};
    for (const [key, record] of Object.entries(actionableTimes[rid] ?? {})) {
        const assets = new Set([record.sourceMontage, record.genderMirroredFrom,
            ...(record.variants ?? []).map(variant => variant.montage)]);
        for (const asset of assets) {
            const normalized = normalizeMontage(asset);
            if (normalized) (index[normalized] ??= new Set()).add(key);
        }
    }
    return index;
}

const join = {};
const refusals = [];
/**
 * A montage join that CONTRADICTS a clean genre, demoted to the genre singleton.
 *
 * The montage route's "exactly one key" guard is necessary but NOT sufficient: a
 * montage can be unique for a key and still be the wrong row, when the row's
 * real key is absent from actionable-times.json altogether. Denia's `1211053`
 * (二形态-终结技大招, genre liberation) landed on a forte_heavy per-tick key
 * while `liberation_final_act_breakdown_form` sat unclaimed — and that row is
 * the one carrying her Final Act spend, on two channels at once.
 *
 * Deliberately narrow, and MEASURED at exactly one row roster-wide:
 *  - only the two clean genre buckets (intro 42/44, liberation 55/58);
 *  - only the MONTAGE route, because a damageId join is exact identity and
 *    outranks a category every time — Calcharo's `1301410` is a QTE that
 *    genuinely owns liberation damage ids, and Jiyan's `1404304` is a
 *    Liberation that genuinely lives under a `forte_heavy_` key. Both are the
 *    LABEL-vs-TYPE split, not errors, and both must survive this;
 *  - only when EXACTLY ONE key of that type is left unclaimed, so an ambiguous
 *    case (Jianxin's two liberation keys) refuses rather than guessing.
 *
 * @returns {string|null} the key to use instead, or null to keep the montage join
 */
function demoteToGenreSingleton({ skillId, montageKey, category, skillMap, damageClaimed, soleMontageKey }) {
    const wanted = SINGLETON_GENRES[category];
    if (!wanted) return null;
    if (skillMap[montageKey]?.skillType === wanted) return null;   // consistent — keep it
    const takenElsewhere = new Set(damageClaimed);
    for (const [otherId, key] of soleMontageKey) if (otherId !== skillId) takenElsewhere.add(key);
    const free = Object.keys(skillMap).filter(key => !key.startsWith('_')
        && skillMap[key]?.skillType === wanted && !takenElsewhere.has(key));
    return free.length === 1 ? free[0] : null;
}

const routeCounts = { damageId: 0, montage: 0, genreSingleton: 0 };
let rowsSeen = 0;

for (const rid of rosterIds) {
    const sourceRid = rowSourceRidOf(rid);
    const skills = timingResonators[sourceRid]?.skills;
    if (!skills) continue;
    const byDamageId = rowKeysByDamageId(rid, sourceRid);
    const byMontage = keysByMontage(rid);
    const skillMap = dataset.autoSkillMap?.[rid] ?? {};
    const claimed = new Set(Object.values(byDamageId).flatMap(keys => [...keys]));
    const perResonator = {};

    const montageKeysOf = (row) => {
        const keys = new Set();
        for (const montage of row.montages ?? []) {
            const normalized = normalizeMontage(montage.game_path ?? montage.asset);
            for (const key of byMontage[normalized] ?? []) keys.add(key);
        }
        return keys;
    };
    // Precomputed so the demotion can ask what the OTHER rows already claim
    // without depending on the order Object.entries happens to walk.
    const soleMontageKey = new Map();
    for (const [skillId, row] of Object.entries(skills)) {
        if ([...(byDamageId[skillId] ?? [])].length) continue;
        const keys = montageKeysOf(row);
        if (keys.size === 1) soleMontageKey.set(skillId, [...keys][0]);
    }

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

        const montageKeys = montageKeysOf(row);
        if (montageKeys.size === 1) {
            const [montageKey] = [...montageKeys];
            const demoted = demoteToGenreSingleton({
                skillId, montageKey, category, skillMap, damageClaimed: claimed, soleMontageKey,
            });
            if (demoted) {
                perResonator[skillId] = { ...base, keys: [demoted], route: 'genreSingleton' };
                routeCounts.genreSingleton++;
                continue;
            }
            perResonator[skillId] = { ...base, keys: [montageKey], route: 'montage' };
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

// A gauge row's rid is a DT_SkillInfo rid, which is not always a DATASET rid:
// `gauge-income.json` carries both genders of every Rover, and the join is keyed
// by whichever id space owns the damage ids (`rowSourceRidOf`). So 1502's rows
// are looked up under the dataset's 1501 — the remap item 38 asked for, which
// RECOVERS here instead of double-counting precisely because the join is keyed
// in the 1502 space and 1501's own rows are no longer walked.
const datasetRidOf = new Map();
for (const rid of rosterIds) {
    const sourceRid = rowSourceRidOf(rid);
    if (sourceRid !== rid) datasetRidOf.set(sourceRid, rid);
}

let gaugeResolved = 0, gaugeUnique = 0;
const gaugeRefused = [];
for (const signature of gaugeRows) {
    const [rid, skillId] = signature.split(':');
    const lookupRid = join[rid]?.[skillId] ? rid : (datasetRidOf.get(rid) ?? rid);
    const entry = join[lookupRid]?.[skillId];
    if (!entry) {
        const refusal = refusals.find(item => item.rid === lookupRid && item.skillId === skillId);
        // ~~"no DT_SkillInfo row for this resonator"~~ was false for all 11 rows
        // it labelled: every one EXISTS in timing-data.json. The join is built
        // over the dataset roster while this loop walks every gauge-income rid,
        // so a non-roster rid fell to a hardcoded else-branch that stated a
        // cause nobody had checked. Say what is actually true instead.
        gaugeRefused.push(refusal ?? {
            rid, skillId,
            reason: rosterIds.includes(rid)
                ? 'row not joined for this resonator'
                : 'rid is not a dataset resonator (the other gender of a Rover)',
        });
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
