#!/usr/bin/env node
/**
 * P12 §5 — offline optimizer orchestrator.
 *
 * Iterates the covered resonators × sequence levels × sonata sets, computes the
 * marginal weights + ER-mode + conditional thresholds at each anchor, and emits
 * data/wuwa-meta.json (§6, adapted for the mode-based ER design) plus
 * docs/meta-validation.md (§7).
 *
 * Thin orchestrator: all real logic lives in tools/optimize/*. Deterministic —
 * same wuwa-data.json + same engine ⇒ byte-identical meta (modulo generatedAt).
 *
 * Usage: node tools/optimize.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// localStorage shim — core modules touch it transitively (storage.js) on import.
const __ls = new Map();
globalThis.localStorage ??= { getItem: k => __ls.get(k) ?? null, setItem: (k, v) => __ls.set(k, v), removeItem: k => __ls.delete(k) };

const { referenceBuild, synthesizeReferenceRotation, templateStats, candidateSonatasFor, scalingStatFor, withTotalEr } = await import('./optimize/reference-build.js');
const { pickBestBuild } = await import('./optimize/suggested-build.js');
const { computeWeights } = await import('./optimize/weights.js');
const { resolveTotalStats } = await import('../src/core/stats.js');
const { analyzeErMode, detectConditionalThresholds, BALANCED_ER_TARGET } = await import('./optimize/breakpoints.js');
const { buildValidationReport } = await import('./optimize/validation-report.js');
// P13 team pass
const { generateCandidates } = await import('./optimize/team-enum.js');
const { rankTeams, summarizeMemberBuild } = await import('./optimize/team-rank.js');
const { coveredCharacters, rolesOf } = await import('./optimize/synergy-hints.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const META_VERSION = 1;

// Coverage scope (§5b): the curated seed — the six P10-ruled characters. Expand
// later; uncovered characters simply have no meta entry (runtime falls back).
const COVERED_IDS = [1107, 1108, 1304, 1205, 1506, 1607];

// Engine files whose content defines the damage math; their hash lets the
// runtime detect a meta computed against a different engine (§5a/§7). Includes
// the team-sim path (P13) so a team-effect change busts the meta too.
const ENGINE_FILES = ['formula.js', 'stats.js', 'skill.js', 'sim.js', 'buffs.js', 'stat-priority.js',
    'team-sim.js', 'team-energy.js', 'enemy-status.js', 'triggerability.js', 'conditional-buffs.js', 'off-field.js'];

function engineHash() {
    const h = createHash('sha256');
    for (const f of ENGINE_FILES) h.update(readFileSync(resolve(root, 'src/core', f)));
    return h.digest('hex');
}

// Compact, transparent template descriptor for the meta (§2b).
function templateDescriptor(template, anchorEr) {
    return {
        mains: template.map(e => ({ cost: e.cost, propId: e.mainStat.propId, addType: e.mainStat.addType, value: e.mainStat.value, isPercent: e.mainStat.isPercent })),
        subStatRolls: template.flatMap(e => e.subStats).reduce((acc, s) => {
            const k = `${s.propId}:${s.addType}`;
            acc[k] = (acc[k] ?? 0) + s.value;
            return acc;
        }, {}),
        anchorEr,
    };
}

// P13 team pass: for every anchor with curated roles, generate pruned candidate
// teams, rank them via the team sim (L1–L3 team effects), and keep the top N.
// Then build the reverse `appearsIn` index. Deterministic (team-enum + team-rank
// are sorted). Anchors with no candidates are simply absent (runtime → "no
// suggestion available"). erOverride comes from the team-energy steady-state
// closed form (team-rank.js §5a.2). With per-hit generation extracted correctly
// (P13-fix 2026-07-02: roster base generation ~2× the collapsed extraction),
// most energy-gated members get real team-context targets (~1.3–1.8); kits
// that aren't energy-gated and requirements beyond the credibility gate stay
// on the provisional solo balanced fallback (never fabricate).
function runTeamPass(dataset) {
    const TOP_N = 8;
    const byCharacter = {};
    for (const anchor of coveredCharacters()) {
        const candidates = generateCandidates(anchor);
        if (candidates.length === 0) continue;
        const ranked = rankTeams(candidates, dataset);
        if (ranked.length === 0) continue;
        byCharacter[String(anchor)] = ranked.slice(0, TOP_N).map(r => ({
            members: r.members,
            score: Number((r.score ?? 0).toFixed(3)),
            roles: r.members.map(id => rolesOf(id)),
            curated: !!r.curated,
            archetype: r.archetype ?? null,
            reason: r.reason ?? null,
            modes: r.modes ?? {},
            erOverride: r.erOverride,
            // Transparent numbers (the actual sim result behind the rank).
            teamDamage: Math.round(r.teamDamage ?? 0),
            teamTime: Number((r.teamTime ?? 0).toFixed(2)),
            teamDps: Math.round(r.teamDps ?? 0),
            perMember: (r.perMember ?? []).map(m => ({ id: m.id, damage: Math.round(m.damage), dps: Math.round(m.dps) })),
        }));
    }
    // Reverse index: for each member, which suggested teams include them.
    const appearsIn = {};
    for (const [anchor, teams] of Object.entries(byCharacter)) {
        for (const t of teams) {
            for (const mid of t.members) {
                if (String(mid) === anchor) continue;
                (appearsIn[String(mid)] ??= []).push({ anchor: Number(anchor), members: t.members, score: t.score });
            }
        }
    }
    // Inspectable per-member builds (the exact builds the ranking used), deduped.
    const memberBuilds = {};
    const memberIds = new Set();
    for (const teams of Object.values(byCharacter)) for (const t of teams) for (const m of t.members) memberIds.add(m);
    for (const id of [...memberIds].sort((a, b) => a - b)) {
        memberBuilds[String(id)] = summarizeMemberBuild(dataset.resonators.find(r => r.id === id), dataset);
    }
    return { byCharacter, appearsIn, memberBuilds };
}

function run() {
    const dataset = JSON.parse(readFileSync(resolve(root, 'data/wuwa-data.json'), 'utf8'));
    // Mirrors src/data/loader.js's merge: stat-ranges.json is a separate file at
    // runtime, unwrapped from its "stat_ranges" key — real average roll values
    // (rollValueOf/allocateSubstats) need it, so replicate the merge here rather
    // than silently falling back to the default-roll-value guess offline.
    const statRangesRaw = JSON.parse(readFileSync(resolve(root, 'data/stat-ranges.json'), 'utf8'));
    dataset.statRanges = statRangesRaw?.stat_ranges ?? {};
    const t0 = Date.now();
    const meta = {
        metaVersion: META_VERSION,
        gameVersion: String(dataset.gameVersion ?? dataset.schemaVersion ?? 'unknown'),
        generatedAt: new Date().toISOString(),
        engineHash: engineHash(),
        erModel: 'mode-based-v1',           // documents the §3a deviation
        characters: {},
    };

    let scenarios = 0;
    for (const id of COVERED_IDS) {
        const resonator = dataset.resonators.find(r => r.id === id);
        if (!resonator) { process.stderr.write(`  skip ${id}: not in dataset\n`); continue; }

        const rotation = synthesizeReferenceRotation(resonator, dataset);
        const template = templateStats(resonator, dataset);

        // Suggested build: the best (sonata × weapon) for this rotation, picked
        // by simming the pruned candidate grid (§5b). Becomes both the empty-
        // build one-click default AND the anchor weapon (a realistic best-in-slot
        // build the weights are accurate for).
        const best = pickBestBuild({ resonator, dataset, rotation, template });
        const weaponId = best.weaponId;
        const weaponName = dataset.weapons.find(w => w.id === weaponId)?.name ?? null;
        const suggestedSonataName = dataset.sonatas.find(s => s.id === best.sonataId)?.name ?? null;

        // Coverage: compute weights for every candidate sonata (so a user who
        // equips any pruned set still gets a meta entry), the suggested one
        // included. Ordered with the suggested set first for a stable lookup.
        const sonatas = [best.sonataId, ...candidateSonatasFor(resonator, dataset).filter(s => s !== best.sonataId)];

        // Anchor's resolved stats (S0, balanced ER) — the reference point the
        // runtime uses for anchorDistance ("is this user's build well-invested
        // enough for the weights to apply?"). Base stats don't vary by sequence.
        const anchorBuild = withTotalEr(referenceBuild({ resonator, dataset, sequenceLevel: 0, sonataId: best.sonataId, rotation, template, weaponId }), dataset, BALANCED_ER_TARGET);
        const aStats = resolveTotalStats(anchorBuild, dataset);

        const cEntry = {
            name: resonator.name,
            element: resonator.element,
            scalingStat: scalingStatFor(resonator),
            referenceRotation: rotation,
            referenceWeapon: { id: weaponId, name: weaponName },
            suggested: {
                sonataId: best.sonataId, sonataName: suggestedSonataName,
                weaponId, weaponName,
                candidateSonatas: best.candidates.sonatas,
                candidateWeapons: best.candidates.weapons,
                // Phase C: per-set co-optimized substat target (fair comparison).
                substatTarget: best.substatTarget,
                substatCounts: best.substatCounts,
            },
            templateStats: templateDescriptor(template, BALANCED_ER_TARGET),
            anchorStats: { critRate: aStats.critRate, critDmg: aStats.critDmg, atk: aStats.atk, energyRegen: aStats.energyRegen },
            bySequence: {},
        };

        for (let seq = 0; seq <= 6; seq++) {
            const bySonata = {};
            for (const sonataId of sonatas) {
                const base = referenceBuild({ resonator, dataset, sequenceLevel: seq, sonataId, rotation, template, weaponId });
                const anchor = withTotalEr(base, dataset, BALANCED_ER_TARGET);
                const { weights, baseline } = computeWeights(anchor, dataset, resonator);
                const erMode = analyzeErMode({ resonator, dataset, erWeight: weights.energyRegen, baseline });
                const conditionalThresholds = detectConditionalThresholds(resonator);
                bySonata[sonataId] = { erMode, conditionalThresholds, weights };
                scenarios++;
            }
            cEntry.bySequence[String(seq)] = { bySonata };
        }
        meta.characters[String(id)] = cEntry;
        process.stderr.write(`  ${resonator.name}: ${sonatas.length} sonata(s) × 7 sequences\n`);
    }

    // ── P13 team pass (§5/§6): rank curated + enumerated teams per anchor ──────
    meta.teams = runTeamPass(dataset);
    process.stderr.write(`  teams: ${Object.keys(meta.teams.byCharacter).length} anchor(s), ${Object.keys(meta.teams.appearsIn).length} appearsIn entr(ies)\n`);

    const metaSerialized = JSON.stringify(meta, null, 2) + '\n';
    writeFileSync(resolve(root, 'data/wuwa-meta.json'), metaSerialized, 'utf8');
    writeFileSync(resolve(root, 'docs/meta-validation.md'), buildValidationReport(meta, dataset.statRanges), 'utf8');

    // Update the `meta` field of the shared cache-bust manifest (see
    // preprocess.mjs) so a meta-only regen still busts the runtime cache. Hash
    // excludes generatedAt so an unchanged meta keeps a stable version.
    const metaHashable = JSON.stringify({ ...meta, generatedAt: undefined });
    const metaVersion = createHash('sha256').update(metaHashable).digest('hex').slice(0, 12);
    const manifestPath = resolve(root, 'data/data-version.json');
    let manifest = {};
    try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); } catch { /* data not yet generated */ }
    manifest.meta = metaVersion;
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    process.stdout.write(`optimize: ${Object.keys(meta.characters).length} characters, ${scenarios} scenarios in ${secs}s\n`);
    process.stdout.write(`Wrote data/wuwa-meta.json + docs/meta-validation.md\n`);
}

run();
