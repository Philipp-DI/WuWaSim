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

function actionableAtFromTiming(timing) {
    const raw = timing.actionable_at_s ?? timing.skill_end_s ?? null;
    return clampNegative(raw);
}

const actionableTimes = {};
const coverage = {};   // rid -> { total, resolved, unresolved: [key,...] }
let totalKeys = 0, resolvedKeys = 0;

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
    return path.replace(/^.*\//, '').replace(/\.uasset$/, '');
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
function chooseCandidate(distinct, rowAssets, pinned) {
    if (pinned) {
        const match = distinct.find(source => source.montage === pinned.montage);
        // A pin that matches nothing is a stale curated entry, not a silent
        // no-op: report it rather than falling back and hiding the drift.
        if (!match) pinFailures.push(pinned);
        else return { chosen: match, byPin: true };
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
        actionableAt: clampNegative(actionableAtFromTiming(toTiming(source))),
        cancelWindowOpensAt: clampNegative(source.cancel_window_opens_s),
        cancelWindowDuration: source.cancel_window_dur_s ?? null,
        skillEnd: clampNegative(source.skill_end_s),
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
        actionableAtFromTiming(toTiming(left)) - actionableAtFromTiming(toTiming(right))
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
 * `actionableAtSpread` are recorded so the rare wide-spread entry — genuinely
 * different moves sharing a damage id, e.g. air vs ground variants — stays
 * visible for review instead of being silently averaged.
 */
function bulletChainEntry(hitIds, rid, skillKey) {
    const candidates = [];
    for (const hitId of hitIds) candidates.push(...montagesForDamageId(hitId));
    const usable = candidates.filter(source => actionableAtFromTiming(toTiming(source)) != null);
    if (!usable.length) return null;
    const rowAssets = rowMontageAssets(hitIds);

    const byMontage = new Map();
    for (const candidate of usable) {
        if (!byMontage.has(candidate.montage)) byMontage.set(candidate.montage, candidate);
    }
    const all = [...byMontage.values()];
    const { ranked: distinct, hasTerminal } = rankCandidates(all);
    const pinned = overrides.pinnedMontage?.[rid]?.[skillKey];
    const { chosen, bySkillRow, byPin } = chooseCandidate(distinct, rowAssets, pinned);
    const timing = toTiming(chosen);
    const times = distinct.map(source => actionableAtFromTiming(toTiming(source)));
    const leadIn = leadInPhase(chosen, all);

    return {
        ...leadInFields(timing, leadIn),
        ...timingFields(timing, chosen),
        ...selectionFields({ chosen, distinct, times, hasTerminal, bySkillRow, byPin }),
        needsStateModel: overrides.needsStateModel?.[rid]?.[skillKey],
        freezeClass: freezeClassFor(rid, skillKey),
        route: 'bulletChain',
        provenance: byPin ? 'curated' : 'extracted',
    };
}

/**
 * actionableAt, plus the split-action wind-up folded into it.
 *
 * leadInPhaseMontage/Length are present only when the action is split; the
 * phase's full length is already included in actionableAt.
 */
function leadInFields(timing, leadIn) {
    const leadInLength = leadIn ? (leadIn.sequence_length_s ?? 0) : 0;
    return {
        actionableAt: +(actionableAtFromTiming(timing) + leadInLength).toFixed(4),
        leadInPhaseMontage: leadIn ? leadIn.montage : undefined,
        leadInPhaseLength: leadIn ? leadInLength : undefined,
    };
}

/** How the chosen candidate was picked, and what it was picked from. */
function selectionFields({ chosen, distinct, times, hasTerminal, bySkillRow, byPin }) {
    return {
        isPhaseOnly: hasTerminal ? undefined : true,
        disambiguatedBySkillRow: bySkillRow || undefined,
        pinnedByOverride: byPin || undefined,
        genderMirroredFrom: chosen.genderMirroredFrom,
        sourceBulletId: chosen.bulletId,
        sourceMontage: chosen.montage,
        montageCandidates: distinct.length,
        actionableAtSpread: distinct.length > 1
            ? +(Math.max(...times) - Math.min(...times)).toFixed(4)
            : undefined,
        variants: variantsOf(distinct, chosen),
    };
}

function timingFields(timing, chosen) {
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
        cancelWindowOpensAt: clampNegative(timing.cancel_window_opens_s),
        cancelWindowDuration: timing.cancel_window_dur_s ?? null,
        skillEnd: clampNegative(timing.skill_end_s),
        sequenceLength: chosen.sequence_length_s ?? null,
        hitTimes: timing.hit_times_s ?? null,
        hitCount: timing.hit_count ?? null,
        firesAt: clampNegative(chosen.fire_time_s),
    };
}

/** Adapt a bullet-timings source record to the montage-timeline field names. */
function toTiming(source) {
    return {
        actionable_at_s: source.actionable_at_s,
        skill_end_s: source.skill_end_s,
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
        actionableAt: actionableAtFromTiming(row.timing),
        freezeTime: row.timing.freeze_combat_clock_s ?? null,
        cancelWindowOpensAt: clampNegative(row.timing.cancel_window_opens_s),
        cancelWindowDuration: row.timing.cancel_window_dur_s ?? null,
        skillEnd: clampNegative(row.timing.skill_end_s),
        sequenceLength: row.montages?.[0]?.sequence_length_s ?? null,
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
        if (!row.timing || actionableAtFromTiming(row.timing) == null) continue;
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
    gapLines.push(`- **${nameOf(rid)}** \`${key}\` — ${entry.actionableAt}s ` +
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
    gapLines.push(`- **${nameOf(rid)}** \`${key}\` — ${entry.actionableAt}s ` +
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
        actionableAtRule: 'actionable_at_s (post-cancel-window; when the player regains control), falling ' +
            'back to skill_end_s -- NEVER sequence_length_s, which includes idle-return padding ' +
            '(TIMING-EXTRACTION-HANDOVER.md §3). Negative raw offsets clamped to 0. Named actionableAt, ' +
            'not castTime -- WuWa abilities activate on press, not on a spell-cast delay; the value is ' +
            'when the player regains control, not when a hit lands (see hitTimes).',
        freezeTimeNote: 'The TsAnimNotifyStateTimeStopRequest window ONLY. The shipped client ' +
            'JavaScript names that notify "instance timer and all combat units buffs + skill ' +
            'cooldowns freeze" -- exactly the freeze the sim models. The other freeze notify, ' +
            'TsAnimNotifyStateAbsoluteTimeStop, is named "animation and bullet freeze": it holds ' +
            'the animation without stopping any clock, so it is EXCLUDED and reported separately ' +
            'as freezeAnimationTime. Supersedes the HARDCODED_FREEZE_FRACTIONS estimate in sim.js ' +
            'for entries present here.',
        cancelWindowNote: 'cancelWindowOpensAt is the TsAnimNotifyStateNextAtt open time (== actionableAt\'s ' +
            'source when actionable_at_s came from the cancel window, not the skill_end_s fallback); ' +
            'cancelWindowDuration is how long that window then stays open. hitTimes is the raw ' +
            'TsAnimNotifyReSkillEvent instants -- separate from actionableAt, since a hit can land before ' +
            'or after the point the player regains control.',
        sequenceLengthNote: 'sequenceLength is the montage\'s full authored length, generally NOT the ' +
            'skill\'s effective duration -- WuWa follows every action with an idle-return tail (the ' +
            'TsAnimNotifyFightStand notify marks where it starts) when nothing cancels it, so the gap ' +
            'between skillEnd/actionableAt and sequenceLength is that return-to-idle animation, not a ' +
            'measurement error. Kept for provenance only; never used as a duration.',
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
