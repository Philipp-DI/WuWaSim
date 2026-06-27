#!/usr/bin/env node
/**
 * Effect audit CLI (PRE-P12-DATA-QUALITY.md §2). Thin orchestrator — the
 * report logic lives in tools/effect-audit.js so it's importable by tests
 * without file I/O.
 *
 * Usage: node tools/audit-effects.mjs
 * Writes docs/effect-audit.md, prints a summary, exits 0 (the report is
 * informational — ⚠ entries are for the maintainer to triage via
 * data/effect-overrides.json, not a build failure).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAuditReport } from './effect-audit.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// P12 seed set (P12-INSTRUCTION-SET.md §5b) + the four Resonance Mode
// characters (PRE-P12-DATA-QUALITY.md §1) — the mandatory deep-audit targets.
const DEEP_AUDIT_IDS = [
    1107, // Carlotta
    1108, // Hiyuki
    1304, // Jinhsi
    1205, // Changli
    1506, // Phoebe
    1607, // Cantarella
    1109, // Lucilla
    1210, // Aemeath
    1211, // Denia
    1509, // Lynae
];

const dataset = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));
const overridesDoc = JSON.parse(readFileSync(resolve(__dirname, '../data/effect-overrides.json'), 'utf8'));
const report = buildAuditReport(dataset, { deepAuditIds: DEEP_AUDIT_IDS, deferred: overridesDoc.deferred ?? {} });

const outPath = resolve(__dirname, '../docs/effect-audit.md');
writeFileSync(outPath, report.markdown, 'utf8');

process.stdout.write(`Effect audit: ${report.totalEffects} effects, ${report.totalWarnings} ⚠ needing a decision `
    + `(${report.totalDeferred} deferred), ${report.deepAuditWarnings} ⚠ in the seed + mode set `
    + `(${report.deepAuditDeferred} deferred there).\n`);
process.stdout.write(`Written: docs/effect-audit.md\n`);
if (report.deepAuditWarnings > 0) {
    process.stdout.write(`GATE NOT CLEAR: fix ⚠ entries for the seed + mode set via data/effect-overrides.json.\n`);
}
