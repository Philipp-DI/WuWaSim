/**
 * An Outro grant whose scope has no home is REFUSED, never widened to All DMG
 * (roadmap step 0, #88).
 *
 *   node tests/outro-scope-refusal.test.mjs
 *
 * Youhu's Outro reads "The incoming Resonator has their Coordinated Attack DMG
 * Amplified by 100% for 28s". Pattern A matches the scoped label, but
 * "Coordinated Attack" has no skill type in the formula lens (Coordinated
 * Attacks are off-field actions), so the label resolves to no scope. The
 * unscoped fallback (Pattern D) then read the bare "DMG Amplified by 100%" as
 * All DMG and doubled every hit of the incoming member: 21–45 % of team damage.
 *
 * The fallback now runs only when NO scoped pattern matched in the segment. A
 * matched label that resolves to no scope lands in `outroBuffRefusals` with a
 * reason code, and the Outro node's own text stays out of `skillNodeEffects`
 * exactly as it does when `outroBuffs` carries the grant.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { projectNanokaCharacterFull } from '../tools/preprocess/resonators.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataset = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));
const YOUHU_ID = 1106;

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

// ── The parser, on the shipped nanoka source ─────────────────────────────────
{
    const source = JSON.parse(readFileSync(
        resolve(__dirname, `../data/extracted-nanoka/characters/${YOUHU_ID}.json`), 'utf8'));
    const projected = projectNanokaCharacterFull(source);
    assert(`Youhu's parsed outroBuffs are empty (got ${JSON.stringify(projected.outroBuffs)})`,
        projected.outroBuffs.length === 0);
    const refusal = projected.outroBuffRefusals?.[0];
    assert(`Youhu's grant is refused once (got ${JSON.stringify(projected.outroBuffRefusals)})`,
        projected.outroBuffRefusals?.length === 1);
    assert('the refusal names the label the game wrote', /Coordinated\s+Attack\s+DMG/i.test(refusal?.label ?? ''));
    assert('the refusal keeps the value and duration', refusal?.value === 1 && refusal?.duration === 28);
    assert('the refusal carries the reason code', refusal?.reason === 'outroScopeUnmapped');
}

// ── The compiled dataset ─────────────────────────────────────────────────────
{
    const youhu = dataset.resonators.find(resonator => resonator.id === YOUHU_ID);
    assert('Youhu ships no outroBuffs', !youhu.outroBuffs?.length);
    assert('Youhu ships the refusal', youhu.outroBuffRefusals?.[0]?.reason === 'outroScopeUnmapped');
    // The refused Outro text must not come back as a self-targeted node effect.
    const outroNodeEffects = (youhu.skillNodeEffects ?? [])
        .filter(node => /incoming Resonator/i.test(node.desc ?? ''))
        .flatMap(node => node.effects ?? []);
    assert(`Youhu's Outro node carries no skill-node effects (got ${outroNodeEffects.length})`,
        outroNodeEffects.length === 0);

    // Roster-wide: every refusal carries a reason the UI can word. Exactly two
    // resonators refuse today: Youhu (no Coordinated Attack skill type) and
    // Aemeath (her "All-DMG Amplification" label maps to nothing; #91, step 15).
    const refusing = dataset.resonators.filter(resonator => resonator.outroBuffRefusals?.length)
        .map(resonator => resonator.id).sort();
    assert(`the refusing resonators are Youhu and Aemeath (got ${refusing})`,
        JSON.stringify(refusing) === '[1106,1210]');
    for (const resonator of dataset.resonators) {
        for (const refused of resonator.outroBuffRefusals ?? []) {
            assert(`${resonator.name}: every refusal carries a reason`, typeof refused.reason === 'string');
        }
    }
}

console.log(`outro-scope-refusal: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
