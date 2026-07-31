/**
 * Joins the raw extraction onto the sim's own skillMap keys (basic_1,
 * heavy_heavy_attack, skill, ...) and writes the curated, provenance-tagged
 * data/actionable-times.json.
 *
 * The join key is data/hit-map.json: preprocess.mjs already records, for every
 * autoSkillMap entry, the game's own per-hit BinData damage ids it matched
 * (verified identical to the raw game ids roster-wide — see docs/HISTORY.md
 * "Forte extraction root-cause fix"). There are two independent ways to get
 * from such a damage id to a real animation, and they are tried in this order:
 *
 * 1. THE BULLET CHAIN (data/bullet-timings.json, scan_bullet_timings.py).
 *    Follows the link the game itself stores: an animation's notify names the
 *    bullet it fires, and the bullet's table row names the damage ids it
 *    applies. Exact id identity at every hop — nothing decomposed or guessed —
 *    so it lands on the ONE animation that produces this exact damage instance.
 *
 * 2. THE SKILL ROW (data/timing-data.json, extract_timings.py). Recovers a
 *    DT_SkillInfo row by longest exact prefix match of the damage id against
 *    that resonator's known row ids, then reads the montages that row
 *    references.
 *
 * Route 1 wins because route 2 is systematically COARSER: distinct abilities
 * frequently share one skill row (30.6% of route-2 keys share their row with
 * another key), so route 2 hands them all one merged number — it gave Camellya
 * the same actionable time for heavy_heavy_attack and liberation, and Baizhi
 * one number for all four basics. Route 1 separates them per animation. Route 2
 * still resolves keys route 1 cannot, so it stays as the fallback.
 *
 * A key neither route resolves is left out rather than guessed — it keeps its
 * fabricated-default actionable-at time downstream, and is listed with its
 * diagnosis in docs/timing-gaps-report.md.
 *
 * Run: node tools/extract/map-timings.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '../../data');

const timingData = JSON.parse(readFileSync(resolve(DATA_DIR, 'timing-data.json'), 'utf8'));
const bulletTimings = JSON.parse(readFileSync(resolve(DATA_DIR, 'bullet-timings.json'), 'utf8'));
const hitMap = JSON.parse(readFileSync(resolve(DATA_DIR, 'hit-map.json'), 'utf8')).map;
const dataset = JSON.parse(readFileSync(resolve(DATA_DIR, 'wuwa-data.json'), 'utf8'));

// Animations belonging to a non-combat game mode. Their rows reuse the same
// bullet ids with mode-specific tuning, so a Rogue/photo-mode montage must
// never supply a combat timing. Matched against the montage's export-relative
// path, which is where the mode always shows up (".../Rogue/AM_QTE_Rogue").
const NON_COMBAT_MONTAGE = /rogue|rouge|photos|mainline|maintask|towerdefense|performance|juqing|quest|xcz|testmodel|_story/i;

const overrides = JSON.parse(readFileSync(resolve(DATA_DIR, 'timing-overrides.json'), 'utf8'));

// Rover ships a male and a female build of every element (MaleM/*Nanzhu vs
// FemaleM/*Nvzhu) with separate bullet id blocks that apply the SAME damage ids,
// so both genders' animations become candidates for one dataset key and the pick
// was effectively arbitrary — 40 keys across all four elements had landed on the
// male build. The two are meant to mirror each other and the dataset models one
// Rover per element, so the female build is used throughout (maintainer call,
// 2026-07-29). Timings are near-identical but not bit-identical (AM_Attack04:
// male 0.800 vs female 0.770), so this is a substitution onto the female asset
// at the mirrored path, not merely a preference — that also covers the 5 Spectro
// keys whose damage ids reach ONLY male bullets, which a filter would have lost.
const MALE_ROVER = /(^|\/)MaleM\/[A-Za-z]*Nanzhu\//;
function femaleRoverPath(path) {
    return path.replace('MaleM/', 'FemaleM/').replace('Nanzhu', 'Nvzhu');
}

// montage path -> one timing record, for resolving a mirrored path back to data.
const timingByMontage = new Map();
for (const sources of Object.values(bulletTimings.bulletTimings)) {
    for (const source of sources) {
        if (!timingByMontage.has(source.montage)) timingByMontage.set(source.montage, source);
    }
}

// damage id -> the bullets that apply it (reverse of bulletDamageIds).
const bulletsByDamageId = new Map();
for (const [bulletId, damageIds] of Object.entries(bulletTimings.bulletDamageIds)) {
    for (const damageId of damageIds) {
        if (!bulletsByDamageId.has(damageId)) bulletsByDamageId.set(damageId, []);
        bulletsByDamageId.get(damageId).push(bulletId);
    }
}

// montage rel path -> per-animation facts (gameplay tags). Absent on an older
// artifact, so every read must tolerate an empty index.
const montageMeta = bulletTimings.montageMeta ?? {};

// "<rawRid>|<assetName>" -> the DT_SkillInfo rows that reference that montage.
// Stamina and interrupt level are row properties, not animation properties, and
// one animation is regularly reached from SEVERAL rows — see unanimousField.
const rowsByAsset = new Map();
for (const [rawRid, resonator] of Object.entries(timingData.resonators)) {
    for (const [rowId, row] of Object.entries(resonator.skills)) {
        for (const montage of row.montages ?? []) {
            if (!montage.resolved || !montage.asset) continue;
            const indexKey = `${rawRid}|${montage.asset}`;
            if (!rowsByAsset.has(indexKey)) rowsByAsset.set(indexKey, []);
            rowsByAsset.get(indexKey).push({ rowId, ...row });
        }
    }
}

/**
 * Every instant THIS key's damage lands, inside the chosen animation.
 *
 * Neither existing field is that quantity, and they err in opposite directions:
 *
 *   hitTimes  -- over-inclusive. It filters by notify CLASS
 *                (TsAnimNotifyReSkillEvent) so it collects every bullet spawn in
 *                the montage regardless of which bullet. Two keys sharing a
 *                montage each get the other's hits (Sanhua's `skill` was handed
 *                `forte_heavy_ice_prism_burst_damage`'s 0.3003), and a
 *                non-damaging probe counts as a hit (Qiuyuan's basic_1 picked up
 *                子弹1411001000 "普攻-目押判定", a just-frame INPUT DETECTOR with
 *                no damage ids at all). It is also under-inclusive in the other
 *                axis: bullets fired by SkillBehavior / StateBulletDuration /
 *                子弹id数组 are not role 'hit', so channelled and condition-gated
 *                damage is missing entirely.
 *   firesAt   -- under-inclusive. A single fire_time_s off the ONE chosen
 *                candidate record, so repeat fires of the correct bullet are
 *                dropped (373 keys have more than one instant).
 *
 * This takes the intersection: fire times of the bullets that carry this key's
 * damage ids, restricted to the animation we resolved to. 883 of 1,023 keys
 * resolve one; 312 of them differ from hitTimes. Keys on the skillRow fallback
 * get null -- that route recovers a table row, not a bullet, so it has no
 * instants to offer and must not fabricate any.
 */
function damageInstants(candidates, chosen) {
    const instants = new Set();
    for (const source of candidates) {
        if (source.montage !== chosen.montage) continue;
        const instant = clampNegative(source.fire_time_s);
        if (typeof instant === 'number') instants.add(instant);
    }
    return [...instants].sort((earlier, later) => earlier - later);
}

/** Every combat animation that fires a bullet applying this damage id. */
function montagesForDamageId(damageId) {
    const timings = bulletTimings.bulletTimings;
    // The bullet table is the game's own statement of which bullet applies which
    // damage, so it WINS. A damage id is usually also a bullet id applying its
    // own damage, which makes the identity shortcut look equivalent — but the two
    // are different namespaces and they collide: Jianxin has a bullet numbered
    // 1405003001 fired from AM_Burst01, while damage 1405003001 (her basic 3) is
    // applied by bullet 1405001005 "普攻3" from AM_Attack03. Taking identity first
    // gave her basic attack a Liberation animation. It disagrees on 4 of the 1,220
    // ids where both routes resolve, and identity is wrong in all 4. Identity is
    // kept only as the fallback for a damage id no bullet row declares.
    const declaredByTable = (bulletsByDamageId.get(damageId) ?? []).filter(id => timings[id]);
    const bulletIds = declaredByTable.length
        ? declaredByTable
        : (timings[damageId] ? [damageId] : []);
    const out = [];
    for (const bulletId of bulletIds) {
        for (const source of timings[bulletId]) {
            if (NON_COMBAT_MONTAGE.test(source.montage)) continue;
            out.push({ ...toFemaleRover(source), bulletId });
        }
    }
    return out;
}

function toFemaleRover(source) {
    if (!MALE_ROVER.test(source.montage)) return source;
    const mirrored = timingByMontage.get(femaleRoverPath(source.montage));
    return mirrored ? { ...mirrored, genderMirroredFrom: source.montage } : source;
}

function resolveSkillId(hitId, knownRowIds) {
    for (let len = hitId.length; len >= 4; len--) {
        const candidate = hitId.slice(0, len);
        if (knownRowIds.has(candidate)) return candidate;
    }
    // Some resonators (confirmed: Chixia/1202, under her internal codename
    // "Maxiaofang") use a raw row-id skill-index shorter than nanoka's fixed
    // 3-digit zero-padded one -- e.g. hit id "1202001001" (rid "1202" + index
    // "001" + hit "001") has no row matching any length-prefix of itself,
    // because her actual row is "120201" (rid + bare index "01", no padding).
    // If nothing matched by length alone, de-zero-pad the 3 digits right
    // after the 4-digit resonator prefix and retry at plausible bare widths.
    if (hitId.length >= 7) {
        const ridPrefix = hitId.slice(0, 4);
        const bareIndex = String(Number(hitId.slice(4, 7)));
        for (const width of [2, 1, 3]) {
            const candidate = ridPrefix + bareIndex.padStart(width, '0');
            if (knownRowIds.has(candidate)) return candidate;
        }
    }
    return null;
}

// Negative trigger times (e.g. -0.0001) are authored offsets meaning "at
// montage start" (TIMING-EXTRACTION-HANDOVER.md §7) -- clamp to 0.
function clampNegative(value) {
    if (value == null) return null;
    return value < 0 ? 0 : value;
}

function animationDurationFromTiming(timing) {
    const raw = timing.actionable_at_s ?? timing.skill_end_s ?? null;
    return clampNegative(raw);
}

/**
 * WHICH marker produced the step duration.
 *
 * montage_timeline.py cascades NextAtt -> EndSkill -> FightStand -> the
 * montage's authored length. Only the first is a measurement of when the player
 * may act; the rest are progressively weaker stand-ins, and the last is the
 * idle-return-inclusive length that must never be read as a duration. Emitting
 * the rule beside the number is what stops the weakest rung from being
 * indistinguishable from the strongest — the failure `actionableAt` had, where
 * one name covered all four.
 */
function stepDurationRuleOf(timing) {
    if (timing.cancel_window_opens_s != null) return 'nextAtt';
    if (timing.skill_end_s != null) return 'skillEnd';
    if (timing.idle_return_s != null) return 'idleReturn';
    return 'sequenceLength';
}

/**
 * The DT_SkillInfo rows describing this key, and how they were found.
 *
 * Two paths, because neither alone covers the roster: the chosen montage is
 * named by a row for 735 of 1,023 keys, and the hit id's own prefix recovers a
 * row for 247 more (982 total, 41 unreachable). The montage path is preferred
 * because it identifies the rows for the animation we actually resolved to;
 * the prefix path is the same coarse match the skillRow route uses.
 */
// A hit id's own leading 4 digits are the game's resonator id, which is not
// always the dataset's rid (Rover ships separate per-gender id blocks).
function rawRidOf(hitIds, rid) {
    return hitIds[0]?.slice(0, 4) ?? rid;
}

function rowsForKey(rawRid, hitIds, chosenMontage) {
    if (chosenMontage) {
        const byAsset = rowsByAsset.get(`${rawRid}|${assetNameOf(chosenMontage)}`);
        if (byAsset?.length) return { rows: byAsset, via: 'montage' };
    }
    for (const hitId of hitIds) {
        const idRid = hitId.slice(0, 4);
        const knownRowIds = knownRowIdsFor(idRid);
        if (!knownRowIds) continue;
        const rowId = resolveSkillId(hitId, knownRowIds);
        if (rowId) return { rows: [{ rowId, ...timingData.resonators[idRid].skills[rowId] }], via: 'hitId' };
    }
    return { rows: [], via: null };
}

/**
 * A row field's value, but ONLY when every row reaching this animation agrees.
 *
 * One montage is regularly shared by rows that disagree about the field, and
 * picking one would be a coin flip presented as a fact. Camellya is the case
 * that forced this: every Form B basic ships as a ground row (0 stamina) and an
 * air row (5 stamina) pointing at the SAME montage, so "the waltz costs 5
 * stamina" is true only in the air. Confirmed in-game — the ground spin costs
 * nothing, contradicting the ability description. 11 keys disagree on stamina,
 * 24 on interrupt level; all of them report null rather than a guess.
 */
function unanimousField(rows, field) {
    if (!rows.length) return null;
    const values = new Set(rows.map(row => row[field]));
    return values.size === 1 ? [...values][0] : null;
}

// The chain position the game itself authors, e.g. "普攻4" -> stage 4. The
// segment before it varies by character (技能ID / 技能 / 技能标识 / 动作标识, and
// 10 rows use a hash), so the segment is matched as a wildcard rather than
// enumerated.
//
// The optional 空中 ("aerial") prefix is deliberately NOT reported. It is not
// trustworthy: Camellya's GROUND Form B rows carry 技能标识.空中普攻3循环 while
// her air rows carry the same tag, so the marker survives as copy-paste and
// says nothing about which context the row is for. Ground vs air is legible
// from the row name suffix (-空中) and the stamina-regen-block tag instead.
const CHAIN_STAGE = /\.[^.]+\.(?:空中)?普攻(\d+)$/;
function chainStageOf(rows) {
    for (const row of rows) {
        for (const tag of row.skill_tags ?? []) {
            const match = tag.match(CHAIN_STAGE);
            if (match) return { stage: Number(match[1]) };
        }
    }
    return null;
}

// Authored switch behaviour, as WINDOWS. Both are AddTag state notifies with a
// start and a duration, so neither is a property of the whole animation:
// Camellya's AM_Attack04 only ends on switch from t=1.2 onward, not from 0.
const ENDS_ON_SWITCH = /切人结束技能/;
const CANNOT_SWITCH = /不能切人/;
function switchBehaviorOf(montagePath) {
    const tags = montageMeta[montagePath]?.gameplay_tags ?? [];
    const windows = (test) => tags
        .filter(entry => test.test(entry.tag ?? ''))
        .map(entry => ({ from: clampNegative(entry.t), duration: entry.dur ?? null }));
    const endsOnSwitch = windows(ENDS_ON_SWITCH);
    const cannotSwitch = windows(CANNOT_SWITCH);
    if (!endsOnSwitch.length && !cannotSwitch.length) return undefined;
    return {
        endsOnSwitch: endsOnSwitch.length ? endsOnSwitch : undefined,
        cannotSwitch: cannotSwitch.length ? cannotSwitch : undefined,
    };
}

/**
 * Whether this key's animation is a held LOOP, which makes its measured times
 * per-ITERATION rather than per-action.
 *
 * Convention-based, and it has to be: the montage carries no loop signal at
 * all. Camellya's AM_Attack03_Ex_Loop has one CompositeSection whose
 * NextSectionName is "None", and its PositionBranchTarget notify is
 * 位移吸附到目标位置 — position snapping, not an animation branch. The repeat is
 * driven by gameplay code, so the asset name and the row's 循环 label are the
 * only evidence the export offers. Flagged, never used to compute a duration.
 */
function isLoopOf(chosenMontage, rows) {
    const asset = chosenMontage ? assetNameOf(chosenMontage) : '';
    if (/_Loop\d*$/i.test(asset)) return true;
    // 循环结束 is the loop's EXIT montage (Rebecca's 手枪重击循环结束 ->
    // AM_Attack_Hold01_S_End), which terminates normally and must not be
    // flagged as repeating.
    return rows.some(row => /循环(?!结束)/.test(row.skill_name ?? '')) || undefined;
}

const actionableTimes = {};
const coverage = {};   // rid -> { total, resolved, unresolved: [key,...] }
let totalKeys = 0, resolvedKeys = 0;

/**
 * The keys that are the HOLD half of a tap/hold pair, as `rid|skillKey`.
 *
 * A hold and its tap are authored with the SAME damage ids and differ only in
 * how many times the repeating one appears, so the bullet chain hands both the
 * same candidate animations and the ranking gives both the shorter one — the
 * tap's. Camellya is the readable case: Vining Waltz Stage 3 is
 * `1603103001` + `1603103003`x5, Blazing Waltz is the same pair with the tick
 * x18, and the kit says outright that holding at Stage 3 casts Blazing Waltz.
 *
 * Detection is only half the answer: this marks which key is the hold, and
 * chooseCandidate then moves it onto a loop animation IF one is among its
 * candidates. Three groups exist roster-wide and two of them (Rebecca's
 * Huntress pair, Chisa's chainsaw pair) have no montage candidates at all, so
 * the reassignment is a no-op there rather than a guess.
 */
const holdKeys = new Set();
for (const [rid, keys] of Object.entries(hitMap)) {
    const bySignature = new Map();
    for (const [skillKey, damageIds] of Object.entries(keys)) {
        if (!Array.isArray(damageIds) || !damageIds.length) continue;
        const signature = [...new Set(damageIds)].sort().join(',');
        if (!bySignature.has(signature)) bySignature.set(signature, []);
        bySignature.get(signature).push({ skillKey, hits: damageIds.length });
    }
    for (const group of bySignature.values()) {
        if (group.length < 2) continue;
        const most = Math.max(...group.map(member => member.hits));
        if (group.every(member => member.hits === most)) continue;
        for (const member of group) {
            if (member.hits === most) holdKeys.add(`${rid}|${member.skillKey}`);
        }
    }
}

// A hit id's own leading 4 digits are the game's resonator id (TIMING-EXTRACTION-
// HANDOVER.md §4) -- which is NOT always the same as our dataset's rid. Rover is
// the confirmed case: the raw client keeps separate id blocks per gender (1501 =
// male "Nanzhu", 1502 = female "Nvzhu"), while the dataset merges each element
// into one display id backed by a specific gender's content (hit-map.json already
// encodes which one). Deriving the raw table from the hit id itself, instead of
// assuming it equals the outer rid, makes that join automatic instead of needing
// a hardcoded per-character remap table.
const knownRowIdsByRawRid = new Map();
function knownRowIdsFor(rawRid) {
    if (!knownRowIdsByRawRid.has(rawRid)) {
        const resTiming = timingData.resonators[rawRid];
        knownRowIdsByRawRid.set(rawRid, resTiming ? new Set(Object.keys(resTiming.skills)) : null);
    }
    return knownRowIdsByRawRid.get(rawRid);
}

/**
 * Strip a phase suffix to the action's base asset name, so the two montages of
 * a split action can be recognised as belonging together.
 *
 * This is the ONE place the pipeline relies on a naming convention, and only
 * because nothing else in the data carries the relationship: DT_SkillInfo rows
 * do not group the pair (zero rows roster-wide list both a `_Start` and an
 * `_End`; Changli's skill row names only `AM_Skill01_Start`), and bullet ids
 * cannot distinguish "two sequential phases" from "two mutually-exclusive state
 * variants" — Denia's `AM_AirAttackII_04_Start` and `AM_AttackII_04` are the
 * air and ground versions of one attack, not phases of it, and only their
 * differing base names say so.
 */
function montageParts(path) {
    // A trailing 4+ digit group is an alternate-model copy of the same montage
    // (AM_Attack03_End_20011), identical in timing; normalise it away so it
    // cannot hide the phase suffix underneath it.
    const stem = path.replace(/\.uasset$/, '').replace(/_\d{4,}$/, '');
    const match = stem.match(/^(.*)_(Start|End)$/);
    return match
        ? { base: match[1], phase: match[2] }
        : { base: stem, phase: null };
}

/**
 * A `X_Start` phase immediately preceding a chosen `X_End`, or null.
 *
 * A phase montage has no cancel window at all, so the player provably cannot
 * act during it: the action's true actionable time is the phase's full length
 * plus the follow-up's. Verified against the one control the export offers —
 * Camellya ships BOTH a split pair and a monolithic `AM_Attack05` of the same
 * attack: 0.6167 (`_Start` length) + 0.69 (`_End` cancel) = 1.307 against the
 * monolithic's own 1.34, and the monolithic's hit instants line up with the
 * two phases' hits offset the same way.
 */
function leadInPhase(chosen, candidates) {
    const target = montageParts(chosen.montage);
    if (chosen.is_phase || target.phase !== 'End') return null;
    return candidates.find(source => {
        const parts = montageParts(source.montage);
        return source.is_phase && parts.phase === 'Start' && parts.base === target.base;
    }) ?? null;
}

/**
 * The montage assets the DT_SkillInfo row for these hit ids references.
 *
 * Used only to DISAMBIGUATE between bullet-chain candidates, never to supply a
 * timing. One damage id is sometimes dealt by several genuinely different
 * actions — Sanhua's skill damage is also dealt by her enhanced basics, so her
 * `skill` key had five candidate animations spanning 0.33s–1.00s. The bullet
 * chain cannot tell those apart (all five really do apply that damage), but the
 * skill row names which animation belongs to the ability, which picks the right
 * one. This is the row route's one genuine advantage over the chain, so the two
 * are combined rather than ranked.
 */
function rowMontageAssets(hitIds) {
    const assets = new Set();
    for (const hitId of hitIds) {
        const rawRid = hitId.slice(0, 4);
        const knownRowIds = knownRowIdsFor(rawRid);
        if (!knownRowIds) continue;
        const rowId = resolveSkillId(hitId, knownRowIds);
        if (!rowId) continue;
        for (const montage of timingData.resonators[rawRid].skills[rowId].montages ?? []) {
            if (montage.asset) assets.add(montage.asset);
        }
    }
    return assets;
}

function assetNameOf(path) {
    return path.replace(/^.*\//, '').replace(/\.(uasset|[^./]+)$/, '');
}

// A DT_SkillInfo row names its montage as a UE object path
// ("/Game/Aki/Character/Role/FemaleM/Chun/CommonAnim/AM_Attack04.AM_Attack04");
// montageMeta is keyed by the scanner's asset-root-relative path. Convert so
// the row route can read the same per-animation facts as the bullet route.
function relFromGamePath(gamePath) {
    const match = String(gamePath ?? '').match(/\/Role\/(.+?)\.[^./]+$/);
    return match ? `${match[1]}.uasset` : null;
}

/**
 * Whether this key's measured freeze is the MAJOR kind the sim models.
 *
 * WuWa has two freezes and the asset does not say which (see timingFields).
 * Default: only a Liberation freezes the world; every other type is the minor,
 * enemy-only freeze and must contribute zero. Confirmed exceptions — enhanced
 * intros, Jiyan's second Liberation cast, Lucy's enhanced Skill — are curated in
 * data/timing-overrides.json, as are the cases where the freeze really belongs
 * to a Liberation whose montage the key merely shares.
 */
function freezeClassFor(rid, skillKey) {
    const pinned = overrides.freezeClass?.[rid]?.[skillKey]?.class;
    if (pinned) return pinned;
    return dataset.autoSkillMap?.[rid]?.[skillKey]?.skillType === 'liberation'
        ? 'major' : 'minor';
}

/**
 * Pick one candidate, preferring the one the skill row names.
 *
 * Only a UNIQUE row match is trusted. Zero matches means the row names an
 * animation the chain never offered — often the `_Start` phase deliberately
 * filtered out — which is not evidence against the ranked pick.
 */
function chooseCandidate(distinct, rowAssets, pinned, isHold) {
    if (pinned) {
        const match = distinct.find(source => source.montage === pinned.montage);
        // A pin that matches nothing is a stale curated entry, not a silent
        // no-op: report it rather than falling back and hiding the drift.
        if (!match) pinFailures.push(pinned);
        else return { chosen: match, byPin: true };
    }
    // The hold half of a tap/hold pair belongs on the loop animation, not on
    // the entry the ranking would otherwise give it (see holdKeys). Ranked
    // below a curated pin, above the row hint: the row names ONE montage per
    // row and both halves of the pair share the row, so it cannot separate them.
    if (isHold) {
        const loop = distinct.find(source => /_Loop\d*$/i.test(assetNameOf(source.montage)));
        if (loop) return { chosen: loop, byHold: true };
    }
    const namedByRow = distinct.filter(
        source => rowAssets.has(assetNameOf(source.montage)));
    return namedByRow.length === 1
        ? { chosen: namedByRow[0], bySkillRow: distinct.length > 1 }
        : { chosen: distinct[0], bySkillRow: false };
}

const pinFailures = [];

/** Every candidate animation, so a state model can select between them later. */
function variantsOf(distinct, chosen) {
    if (distinct.length < 2) return undefined;
    return distinct.map(source => ({
        montage: source.montage,
        stepDuration: clampNegative(animationDurationFromTiming(toTiming(source))),
        nextAttAt: clampNegative(source.cancel_window_opens_s),
        nextAttDuration: source.cancel_window_dur_s ?? null,
        skillEndAt: clampNegative(source.skill_end_s),
        freezeTime: source.freeze_combat_clock_s ?? null,
        hitTimes: source.hit_times_s ?? null,
        bulletId: source.bulletId,
        bulletName: bulletTimings.bulletNames[source.bulletId] ?? null,
        chosen: source.montage === chosen.montage ? true : undefined,
    }));
}

/**
 * The candidates to choose between, best first.
 *
 * Phases are excluded unless nothing else exists — their length is a lead-in,
 * not an actionable time. Ties are broken toward the shorter asset path so the
 * canonical montage wins over an alternate-model copy of it.
 */
function rankCandidates(all) {
    const terminal = all.filter(source => !source.is_phase);
    const ranked = terminal.length ? terminal : all;
    ranked.sort((left, right) =>
        animationDurationFromTiming(toTiming(left)) - animationDurationFromTiming(toTiming(right))
        || left.montage.length - right.montage.length
        || left.montage.localeCompare(right.montage));
    return { ranked, hasTerminal: terminal.length > 0 };
}

/**
 * Route 1 — the bullet chain. Picks the single animation the damage id is
 * actually fired from.
 *
 * Candidates that are PHASES (no cancel window and no skill-end notify — the
 * action does not complete there) are never chosen as the answer: their length
 * is a lead-in, not an actionable time. Where the phase is the `_Start` of the
 * chosen `_End`, it is added instead (see leadInPhase).
 *
 * Among the remaining terminal candidates, several firing one damage id are
 * usually authored variants of one move (AM_Attack02 / _plus / _LimitDodge),
 * agreeing to within a few frames; the earliest actionable time is taken,
 * matching the min() the skill-row route already uses. `montageCandidates`/
 * `stepDurationSpread` are recorded so the rare wide-spread entry — genuinely
 * different moves sharing a damage id, e.g. air vs ground variants — stays
 * visible for review instead of being silently averaged.
 */
function bulletChainEntry(hitIds, rid, skillKey) {
    const candidates = [];
    for (const hitId of hitIds) candidates.push(...montagesForDamageId(hitId));
    const usable = candidates.filter(source => animationDurationFromTiming(toTiming(source)) != null);
    if (!usable.length) return null;
    const rowAssets = rowMontageAssets(hitIds);

    const byMontage = new Map();
    for (const candidate of usable) {
        if (!byMontage.has(candidate.montage)) byMontage.set(candidate.montage, candidate);
    }
    const all = [...byMontage.values()];
    const { ranked: distinct, hasTerminal } = rankCandidates(all);
    const pinned = overrides.pinnedMontage?.[rid]?.[skillKey];
    const isHold = holdKeys.has(`${rid}|${skillKey}`);
    const { chosen, bySkillRow, byPin, byHold } = chooseCandidate(distinct, rowAssets, pinned, isHold);
    const timing = toTiming(chosen);
    const times = distinct.map(source => animationDurationFromTiming(toTiming(source)));
    const leadIn = leadInPhase(chosen, all);
    const damageAt = damageInstants(candidates, chosen);
    const { rows } = rowsForKey(rawRidOf(hitIds, rid), hitIds, chosen.montage);

    return {
        ...leadInFields(timing, leadIn),
        ...timingFields(timing, chosen, damageAt),
        ...abilityFields(rows, chosen.montage),
        ...selectionFields({ chosen, distinct, times, hasTerminal, bySkillRow, byPin, byHold }),
        tapHoldRole: isHold ? 'hold' : undefined,
        needsStateModel: overrides.needsStateModel?.[rid]?.[skillKey],
        freezeClass: freezeClassFor(rid, skillKey),
        route: 'bulletChain',
        provenance: byPin ? 'curated' : 'extracted',
    };
}

/**
 * The step's duration, the rule that produced it, and the split-action wind-up
 * folded into it.
 *
 * leadInPhaseMontage/Length are present only when the action is split; the
 * phase's full length is already included in stepDuration.
 */
function leadInFields(timing, leadIn) {
    const leadInLength = leadIn ? (leadIn.sequence_length_s ?? 0) : 0;
    return {
        stepDuration: +(animationDurationFromTiming(timing) + leadInLength).toFixed(4),
        stepDurationRule: stepDurationRuleOf(timing),
        leadInPhaseMontage: leadIn ? leadIn.montage : undefined,
        leadInPhaseLength: leadIn ? leadInLength : undefined,
    };
}

/** How the chosen candidate was picked, and what it was picked from. */
function selectionFields({ chosen, distinct, times, hasTerminal, bySkillRow, byPin, byHold }) {
    return {
        isPhaseOnly: hasTerminal ? undefined : true,
        disambiguatedBySkillRow: bySkillRow || undefined,
        pinnedByOverride: byPin || undefined,
        chosenAsHoldLoop: byHold || undefined,
        genderMirroredFrom: chosen.genderMirroredFrom,
        sourceBulletId: chosen.bulletId,
        sourceMontage: chosen.montage,
        montageCandidates: distinct.length,
        stepDurationSpread: distinct.length > 1
            ? +(Math.max(...times) - Math.min(...times)).toFixed(4)
            : undefined,
        variants: variantsOf(distinct, chosen),
    };
}

function timingFields(timing, chosen, damageAt = null) {
    return {
        // freezeTime is the TimeStopRequest window only — the game's own
        // description of that notify is "instance timer and ALL combat units'
        // buffs and skill cooldowns freeze", which is exactly the sim's freeze
        // semantics. The other freeze notify, AbsoluteTimeStop, is "animation
        // and bullet freeze": it holds the animation without stopping any clock,
        // so it must never contribute. freezeAnimationTime keeps it for
        // provenance. Settled from the shipped client JavaScript, see
        // montage_timeline.py.
        freezeTime: timing.freeze_combat_clock_s ?? null,
        freezeAnimationTime: timing.freeze_total_s ?? null,
        // The MARKERS, under the game's own names. StateNextAtt is 下一个技能
        // and its begin calls SetSkillAcceptInput(true) + CallAnimBreakPoint():
        // it is when the next skill can be QUEUED, which is not the same as the
        // player being free, and calling it a "cancel window" said otherwise.
        nextAttAt: clampNegative(timing.cancel_window_opens_s),
        nextAttDuration: timing.cancel_window_dur_s ?? null,
        skillEndAt: clampNegative(timing.skill_end_s),
        idleReturnAt: clampNegative(timing.idle_return_s),
        sequenceLength: chosen.sequence_length_s ?? null,
        // MONTAGE-WIDE CONTEXT, not this key's damage -- see damageInstants().
        // Kept because it is real data and useful for eyeballing an animation,
        // but never use it to decide when a key's damage lands.
        hitTimes: timing.hit_times_s ?? null,
        hitCount: timing.hit_count ?? null,
        // THIS KEY's damage instants, and when it has fully resolved. Absent a
        // player cancel an ability resolves its whole scope, so resolvesAt is
        // the earliest a step can end without losing damage.
        damageAt: damageAt && damageAt.length ? damageAt : null,
        resolvesAt: damageAt && damageAt.length ? damageAt[damageAt.length - 1] : null,
        // First damage instant. Was a scalar read off the chosen candidate,
        // which is not necessarily the earliest; now anchored to damageAt so the
        // two can never disagree.
        firstDamageAt: damageAt && damageAt.length ? damageAt[0] : clampNegative(chosen.fire_time_s),
    };
}

/**
 * Facts about the ability that are not timings: what the game charges for it,
 * how committed the player is, where it sits in a chain, and what a resonator
 * switch does to it. Emitted for display and for later engine work; nothing
 * here feeds stepDuration.
 */
function abilityFields(rows, chosenMontage) {
    const staminaRaw = unanimousField(rows, 'stamina_cost');
    return {
        // Negative and x100 in the source ("Heavy Attack STA Cost: 20" is
        // -2000); normalised to a positive STA figure. Null when the rows
        // reaching this animation disagree — see unanimousField.
        staminaCost: staminaRaw ? Math.abs(staminaRaw) / 100 : (staminaRaw === 0 ? 0 : null),
        interruptLevel: unanimousField(rows, 'interrupt_level'),
        chainStage: chainStageOf(rows) ?? undefined,
        switchBehavior: switchBehaviorOf(chosenMontage),
        isLoop: isLoopOf(chosenMontage, rows),
    };
}

/** Adapt a bullet-timings source record to the montage-timeline field names. */
function toTiming(source) {
    return {
        actionable_at_s: source.actionable_at_s,
        skill_end_s: source.skill_end_s,
        idle_return_s: source.idle_return_s,
        cancel_window_opens_s: source.cancel_window_opens_s,
        cancel_window_dur_s: source.cancel_window_dur_s,
        freeze_total_s: source.freeze_total_s,
        freeze_combat_clock_s: source.freeze_combat_clock_s,
        hit_times_s: source.hit_times_s,
        hit_count: source.hit_count,
    };
}

function rowEntry(row, rowId, rawRid, rid, skillKey) {
    return {
        stepDuration: animationDurationFromTiming(row.timing),
        stepDurationRule: stepDurationRuleOf(row.timing),
        freezeTime: row.timing.freeze_combat_clock_s ?? null,
        nextAttAt: clampNegative(row.timing.cancel_window_opens_s),
        nextAttDuration: row.timing.cancel_window_dur_s ?? null,
        skillEndAt: clampNegative(row.timing.skill_end_s),
        idleReturnAt: clampNegative(row.timing.idle_return_s),
        sequenceLength: row.montages?.[0]?.sequence_length_s ?? null,
        ...abilityFields([{ rowId, ...row }],
            relFromGamePath(row.montages?.find(montage => montage.resolved)?.game_path)),
        hitTimes: row.timing.hit_times_s ?? null,
        hitCount: row.timing.hit_count ?? null,
        sourceResonatorId: rawRid !== rid ? rawRid : undefined,
        sourceSkillId: rowId,
        sourceSkillName: row.skill_name ?? null,
        freezeClass: freezeClassFor(rid, skillKey),
        route: 'skillRow',
        provenance: 'extracted',
    };
}

/** Route 2 — the DT_SkillInfo row recovered by longest exact prefix match. */
function skillRowEntry(hitIds, rid, skillKey) {
    for (const hitId of hitIds) {
        const rawRid = hitId.slice(0, 4);
        const knownRowIds = knownRowIdsFor(rawRid);
        if (!knownRowIds) continue;
        const rowId = resolveSkillId(hitId, knownRowIds);
        if (!rowId) continue;
        const row = timingData.resonators[rawRid].skills[rowId];
        if (!row.timing || animationDurationFromTiming(row.timing) == null) continue;
        return rowEntry(row, rowId, rawRid, rid, skillKey);
    }
    return null;
}

const routeCounts = { bulletChain: 0, skillRow: 0 };

for (const [rid, skillMap] of Object.entries(hitMap)) {
    const cov = coverage[rid] = { total: 0, resolved: 0, unresolved: [] };
    const out = {};

    for (const [skillKey, hitIds] of Object.entries(skillMap)) {
        totalKeys++;
        cov.total++;
        const entry = bulletChainEntry(hitIds, rid, skillKey) ?? skillRowEntry(hitIds, rid, skillKey);
        if (entry) {
            out[skillKey] = entry;
            resolvedKeys++;
            routeCounts[entry.route]++;
            cov.resolved++;
        } else {
            cov.unresolved.push(skillKey);
        }
    }
    if (Object.keys(out).length) actionableTimes[rid] = out;
}

const datasetResonatorIds = new Set(Object.keys(dataset.baseStats || {}));
const missingResonators = [...datasetResonatorIds].filter(rid => !timingData.resonators[rid]).sort();

// -- gaps report: everything still on the fabricated-default fallback -------
// A hunt-list for closing coverage further: per resonator, per unresolved
// skillMap key, the raw hit-map ids that failed to join (a starting point for
// searching the asset tree by hand, the same way Chixia/Aemeath were found).
function nameOf(rid) {
    return dataset.resonators?.find(res => String(res.id) === rid)?.name ?? rid;
}
function folderOf(rid) {
    const table = timingData.resonators[rid]?.source_table?.[0];
    if (!table) return null;
    const match = table.match(/^([^/]+\/[^/]+)\//);
    return match ? match[1] : null;
}

/**
 * Diagnose one unresolved damage id, using the game's own bullet label.
 *
 * The label is the decisive evidence for triage: it says, in the designer's
 * words, whether the thing is a player swing that we failed to find an
 * animation for, or a turret/DoT/field tick that HAS no player animation and
 * therefore correctly has no timing to extract.
 */
function diagnose(damageId) {
    const owners = bulletsByDamageId.get(damageId) ?? [];
    if (!owners.length) return 'no bullet row for this id anywhere in the export';
    const labelled = owners.map(bulletId => {
        const label = bulletTimings.bulletNames[bulletId];
        return `\`${bulletId}\`${label ? ` “${label}”` : ''}`;
    });
    const anyMontage = owners.some(bulletId => bulletTimings.bulletTimings[bulletId]);
    const why = anyMontage
        ? 'only fired by non-combat-mode animations'
        : 'no animation fires this bullet (summon / DoT / field tick?)';
    return `${why} — bullets: ${labelled.join(', ')}`;
}

/** Every resolved entry carrying `flag`, as [rid, key, entry] rows. */
function entriesFlagged(flag) {
    const rows = [];
    for (const [rid, keys] of Object.entries(actionableTimes)) {
        for (const [key, entry] of Object.entries(keys)) {
            if (entry[flag]) rows.push([rid, key, entry]);
        }
    }
    return rows;
}

const unresolvedCount = totalKeys - resolvedKeys;
const unresolvedPct = +(100 * unresolvedCount / totalKeys).toFixed(1);
const stateGated = entriesFlagged('needsStateModel');
const phaseOnly = entriesFlagged('isPhaseOnly');

const gapLines = [
    '# Timing data quality — gaps and provisional values',
    '',
    'Generated by `node tools/extract/map-timings.mjs`; regenerate after any extraction, ',
    'join or `data/timing-overrides.json` change. Three sections, worst first:',
    '',
    `1. **Unresolved — ${unresolvedCount}/${totalKeys} keys (${unresolvedPct}%)** still on the ` +
        'fabricated per-type default. Most are not closable (see below).',
    `2. **State-gated — ${stateGated.length} keys** resolved to a real animation, but which ` +
        'animation is correct depends on a character state the sim does not model yet.',
    `3. **Phase-only — ${phaseOnly.length} keys** whose completing montage fires no bullet, so ` +
        'the value is a lead-in length and UNDERSTATES the action.',
    '',
    'Everything else — ' + (resolvedKeys - stateGated.length - phaseOnly.length) +
        ' keys — is a measured value with no known caveat.',
    '',
    '---',
    '',
    `## 1. Unresolved (${unresolvedCount})`,
    '',
    'Each key lists the `hit-map.json` damage ids that failed to join, and for each the bullet ' +
        'that applies it under the designer\'s own label. **A label naming a summon, field or ' +
        'damage-over-time tick means there is no player animation to find** — the fabricated ' +
        'default is the honest answer, not a gap to close. A label naming a real swing means an ' +
        'animation exists and the link to it is still missing.',
    '',
];

for (const [rid, cov] of Object.entries(coverage).sort((entryA, entryB) => Number(entryA[0]) - Number(entryB[0]))) {
    if (!cov.unresolved.length) continue;
    const folder = folderOf(rid);
    gapLines.push(`### ${nameOf(rid)} (${rid})${folder ? ` — \`${folder}\`` : ' — *no folder found at all*'}`);
    gapLines.push('', `${cov.resolved}/${cov.total} resolved`, '');
    for (const key of cov.unresolved) {
        gapLines.push(`- \`${key}\``);
        for (const damageId of [...new Set(hitMap[rid][key])]) {
            gapLines.push(`    - \`${damageId}\` — ${diagnose(damageId)}`);
        }
    }
    gapLines.push('');
}

gapLines.push('---', '', `## 2. State-gated (${stateGated.length})`, '',
    'Resolved to a real animation, but the character has two authorings and which one applies ' +
    'depends on an unmodelled state. The value below is provisional and correct for ONE branch; ' +
    'every alternative is preserved in the entry\'s `variants` array, so wiring a state model is ' +
    'a selection problem, not a re-derivation. Declared in `data/timing-overrides.json`.', '');
for (const [rid, key, entry] of stateGated) {
    const candidateCount = entry.montageCandidates ?? 1;
    gapLines.push(`- **${nameOf(rid)}** \`${key}\` — ${entry.stepDuration}s ` +
        `(\`${assetNameOf(entry.sourceMontage ?? '')}\`, ${candidateCount} ` +
        `candidate${candidateCount === 1 ? '' : 's'})`);
    gapLines.push(`    - ${entry.needsStateModel}`);
}

gapLines.push('', '---', '', `## 3. Phase-only (${phaseOnly.length})`, '',
    'Every candidate animation is an uncancellable PHASE — no cancel window and no skill-end ' +
    'notify — because the montage that completes the action fires no bullet and so cannot be ' +
    'reached from a damage id. The value is that phase\'s length, which understates the action ' +
    'by however long the unreachable completion runs.', '');
for (const [rid, key, entry] of phaseOnly.sort((left, right) => Number(left[0]) - Number(right[0]))) {
    gapLines.push(`- **${nameOf(rid)}** \`${key}\` — ${entry.stepDuration}s ` +
        `(\`${assetNameOf(entry.sourceMontage ?? '')}\`)`);
}
gapLines.push('');

writeFileSync(resolve(__dirname, '../../docs/timing-gaps-report.md'), gapLines.join('\n') + '\n');

const result = {
    _meta: {
        source: 'tools/extract/scan_bullet_timings.py + extract_timings.py — offline raw-asset ' +
            'parse (no FModel JSON export step)',
        assetRoot: 'docs-local/Role (user-provided, gitignored — not redistributed)',
        generatedAt: new Date().toISOString(),
        join: 'Two routes, in precedence order, both keyed on the hitMap[rid][skillKey] BinData ' +
            'damage id. route="bulletChain": damage id -> the bullet(s) applying it (bullet table ' +
            '伤害ID/多伤害ID, transitively through child bullets) -> the animation whose notify fires ' +
            'that bullet. Exact id identity at every hop, and it resolves to the ONE animation ' +
            'producing this exact damage instance. route="skillRow": the older DT_SkillInfo join -- ' +
            'raw resonator id from the hit id\'s own leading 4 digits (not assumed equal to rid, see ' +
            'Rover), longest exact-prefix match against that resonator\'s row ids, then the row\'s ' +
            'merged montages. Coarser (distinct abilities often share one row, so they share one ' +
            'number), so it is only the fallback. sourceResonatorId is present on a skillRow entry ' +
            'only when it differs from the dataset\'s own rid.',
        routeCounts,
        stepDurationRule: 'stepDuration is the montage-derived length of the step, and ' +
            'stepDurationRule NAMES the marker it came from: "nextAtt" (TsAnimNotifyStateNextAtt ' +
            'opening -- the only rung that is a measurement of when the player may act), then ' +
            '"skillEnd" (TsAnimNotifyEndSkill), "idleReturn" (TsAnimNotifyFightStand), and finally ' +
            '"sequenceLength", the montage\'s authored length INCLUDING the idle-return tail, which ' +
            'is not a duration at all and is only defensible for a phase montage that has no tail. ' +
            'The rule ships beside the number because the previous single name (actionableAt) made ' +
            'the weakest rung indistinguishable from the strongest. Negative raw offsets clamp to 0. ' +
            'Damage is NOT part of this: see damageAt / resolvesAt.',
        freezeTimeNote: 'The TsAnimNotifyStateTimeStopRequest window ONLY. The shipped client ' +
            'JavaScript names that notify "instance timer and all combat units buffs + skill ' +
            'cooldowns freeze" -- exactly the freeze the sim models. The other freeze notify, ' +
            'TsAnimNotifyStateAbsoluteTimeStop, is named "animation and bullet freeze": it holds ' +
            'the animation without stopping any clock, so it is EXCLUDED and reported separately ' +
            'as freezeAnimationTime. Supersedes the HARDCODED_FREEZE_FRACTIONS estimate in sim.js ' +
            'for entries present here.',
        nextAttNote: 'nextAttAt is the TsAnimNotifyStateNextAtt open time and nextAttDuration is how ' +
            'long it stays open. The shipped client names that notify 下一个技能 ("next skill") and its ' +
            'begin calls SetSkillAcceptInput(true) + CallAnimBreakPoint(), so it is when the next ' +
            'skill can be QUEUED -- input pressed earlier is buffered and executes when the window ' +
            'opens. It is NOT "the player is free": dodges and swaps are not gated by it. It was ' +
            'called cancelWindowOpensAt, which said the opposite.',
        damageNote: 'damageAt is every instant THIS key\'s damage lands in the chosen animation, ' +
            'firstDamageAt and resolvesAt its ends. Absent a player cancel an ability resolves its ' +
            'whole scope, so resolvesAt -- not nextAttAt -- is the earliest a step can end without ' +
            'losing damage. hitTimes is montage-WIDE and wrong for this: it filters by notify class, ' +
            'so it collects other keys\' bullets and non-damaging probes while missing bullets fired ' +
            'via SkillBehavior / StateBulletDuration / 子弹id数组.',
        sequenceLengthNote: 'sequenceLength is the montage\'s full authored length, generally NOT the ' +
            'skill\'s effective duration -- WuWa follows every action with an idle-return tail (the ' +
            'TsAnimNotifyFightStand notify marks where it starts) when nothing cancels it, so the gap ' +
            'between skillEndAt/stepDuration and sequenceLength is that return-to-idle animation, not ' +
            'a measurement error. Kept for provenance; reachable as a duration only via ' +
            'stepDurationRule="sequenceLength", which says so.',
        abilityFieldsNote: 'staminaCost (positive STA; the source is negative and x100) and ' +
            'interruptLevel are DT_SkillInfo ROW properties, and one animation is regularly reached ' +
            'from several rows. Both are null unless every such row agrees -- Camellya ships every ' +
            'Form B basic as a ground row (0 STA) and an air row (5 STA) pointing at the SAME ' +
            'montage, confirmed in-game as free on the ground. chainStage is the game\'s own 普攻N ' +
            'tag. switchBehavior holds WINDOWS, not flags: 切人结束技能 ("switching ends the skill") ' +
            'and 不能切人 ("cannot switch out") are timed AddTag states. isLoop is convention-based ' +
            '(asset _Loop / row 循环) because the montage carries no loop signal at all -- it flags ' +
            'that the measured times are per-ITERATION and must not be read as the whole action.',
        coverage: { totalSkillMapKeys: totalKeys, resolved: resolvedKeys, resolvedPct: +(100 * resolvedKeys / totalKeys).toFixed(1) },
        resonatorsInDatasetNotInExtraction: missingResonators,
    },
    actionableTimes,
};

writeFileSync(resolve(DATA_DIR, 'actionable-times.json'), JSON.stringify(result, null, 2) + '\n');

// -- console coverage report --------------------------------------------
process.stderr.write(`resolved ${resolvedKeys}/${totalKeys} skillMap keys (${result._meta.coverage.resolvedPct}%)\n`);
if (missingResonators.length) {
    process.stderr.write(`dataset resonators with NO extraction data at all: ${missingResonators.join(', ')}\n`);
}
const worst = Object.entries(coverage)
    .filter(([, cov]) => cov.total > 0)
    .sort((entryA, entryB) => (entryA[1].resolved / entryA[1].total) - (entryB[1].resolved / entryB[1].total))
    .slice(0, 10);
process.stderr.write('lowest-coverage resonators (rid: resolved/total, unresolved keys):\n');
for (const [rid, cov] of worst) {
    process.stderr.write(`  ${rid}: ${cov.resolved}/${cov.total}  [${cov.unresolved.join(', ')}]\n`);
}
if (pinFailures.length) {
    process.stderr.write(`\nERROR: ${pinFailures.length} timing-overrides.json pin(s) matched no candidate montage:\n`);
    for (const failure of pinFailures) process.stderr.write(`  ${failure.montage}\n`);
    process.exitCode = 1;
}
process.stderr.write(`wrote data/actionable-times.json\n`);
