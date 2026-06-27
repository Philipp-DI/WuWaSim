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

const { referenceBuild, synthesizeReferenceRotation, templateStats, standardSonatasFor, scalingStatFor, withTotalEr, representativeWeaponId } = await import('./optimize/reference-build.js');
const { computeWeights } = await import('./optimize/weights.js');
const { resolveTotalStats } = await import('../src/core/stats.js');
const { analyzeErMode, detectConditionalThresholds, BALANCED_ER_TARGET } = await import('./optimize/breakpoints.js');
const { buildValidationReport } = await import('./optimize/validation-report.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const META_VERSION = 1;

// Coverage scope (§5b): the curated seed — the six P10-ruled characters. Expand
// later; uncovered characters simply have no meta entry (runtime falls back).
const COVERED_IDS = [1107, 1108, 1304, 1205, 1506, 1607];

// Engine files whose content defines the damage math; their hash lets the
// runtime detect a meta computed against a different engine (§5a/§7).
const ENGINE_FILES = ['formula.js', 'stats.js', 'skill.js', 'sim.js', 'buffs.js', 'stat-priority.js'];

function engineHash() {
    const h = createHash('sha256');
    for (const f of ENGINE_FILES) h.update(readFileSync(resolve(root, 'src/core', f)));
    return h.digest('hex');
}

// Compact, transparent template descriptor for the meta (§2b).
function templateDescriptor(template, anchorEr) {
    return {
        mains: template.map(e => ({ cost: e.cost, propId: e.mainStat.propId, value: e.mainStat.value })),
        subStatRolls: template.flatMap(e => e.subStats).reduce((acc, s) => {
            const k = `${s.propId}:${s.addType}`;
            acc[k] = (acc[k] ?? 0) + s.value;
            return acc;
        }, {}),
        anchorEr,
    };
}

function run() {
    const dataset = JSON.parse(readFileSync(resolve(root, 'data/wuwa-data.json'), 'utf8'));
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
        const sonatas = standardSonatasFor(resonator);
        const weaponId = representativeWeaponId(resonator, dataset);
        const weaponName = dataset.weapons.find(w => w.id === weaponId)?.name ?? null;

        // Anchor's resolved stats (S0, balanced ER) — the reference point the
        // runtime uses for anchorDistance ("is this user's build well-invested
        // enough for the weights to apply?"). Base stats don't vary by sequence.
        const anchorBuild = withTotalEr(referenceBuild({ resonator, dataset, sequenceLevel: 0, sonataId: sonatas[0], rotation, template, weaponId }), dataset, BALANCED_ER_TARGET);
        const aStats = resolveTotalStats(anchorBuild, dataset);

        const cEntry = {
            name: resonator.name,
            element: resonator.element,
            scalingStat: scalingStatFor(resonator),
            referenceRotation: rotation,
            referenceWeapon: { id: weaponId, name: weaponName },
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

    writeFileSync(resolve(root, 'data/wuwa-meta.json'), JSON.stringify(meta, null, 2) + '\n', 'utf8');
    writeFileSync(resolve(root, 'docs/meta-validation.md'), buildValidationReport(meta), 'utf8');

    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    process.stdout.write(`optimize: ${Object.keys(meta.characters).length} characters, ${scenarios} scenarios in ${secs}s\n`);
    process.stdout.write(`Wrote data/wuwa-meta.json + docs/meta-validation.md\n`);
}

run();
