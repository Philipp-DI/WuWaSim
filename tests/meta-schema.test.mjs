/**
 * Tests for the committed data/wuwa-meta.json (P12 §10 meta-schema).
 *
 *   node tests/meta-schema.test.mjs
 *
 * Covers: schema conformance, every covered character has the required fields,
 * the reference rotation validates with zero warnings, weights are finite, and
 * — the strong staleness guard — the committed meta's engineHash matches the
 * CURRENT engine recomputed from src/core (catches a meta not regenerated after
 * an engine change).
 */

import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const ls = new Map();
globalThis.localStorage = { getItem: k => ls.get(k) ?? null, setItem: (k, v) => ls.set(k, v), removeItem: k => ls.delete(k) };

const { validateRotation } = await import('../src/core/rotation-graph.js');
const { rulesForResonator } = await import('../src/core/rotation-rules.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const meta = JSON.parse(readFileSync(resolve(root, 'data/wuwa-meta.json'), 'utf8'));
const d = JSON.parse(readFileSync(resolve(root, 'data/wuwa-data.json'), 'utf8'));

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

// ── Top-level schema ─────────────────────────────────────────────────────────
{
    assert('metaVersion is a number', typeof meta.metaVersion === 'number');
    assert('gameVersion present', typeof meta.gameVersion === 'string');
    assert('generatedAt is ISO-ish', typeof meta.generatedAt === 'string' && !Number.isNaN(Date.parse(meta.generatedAt)));
    assert('engineHash present', typeof meta.engineHash === 'string' && meta.engineHash.length === 64);
    assert('erModel documents the deviation', meta.erModel === 'mode-based-v1');
    assert('characters is a non-empty object', meta.characters && Object.keys(meta.characters).length > 0);
}

// ── Per-character conformance ────────────────────────────────────────────────
for (const [id, c] of Object.entries(meta.characters)) {
    assert(`${c.name}: has referenceRotation`, Array.isArray(c.referenceRotation) && c.referenceRotation.length > 0);
    assert(`${c.name}: has templateStats`, c.templateStats && Array.isArray(c.templateStats.mains));
    assert(`${c.name}: has anchorStats`, c.anchorStats && typeof c.anchorStats.critRate === 'number');
    assert(`${c.name}: has at least S0`, c.bySequence && c.bySequence['0']);
    assert(`${c.name}: has all sequences S0..S6`, [0,1,2,3,4,5,6].every(s => c.bySequence[String(s)]));

    // referenceRotation must validate with zero prerequisite warnings (§10).
    const warns = validateRotation(c.referenceRotation, rulesForResonator(Number(id)), d.autoSkillMap[id]);
    assert(`${c.name}: referenceRotation has zero validateRotation warnings`, warns.length === 0);

    // Every scenario carries finite weights + a well-formed erMode.
    for (const [seq, bySeq] of Object.entries(c.bySequence)) {
        for (const [sonataId, entry] of Object.entries(bySeq.bySonata)) {
            const label = `${c.name} S${seq}/${sonataId}`;
            assert(`${label}: weights finite`, entry.weights && Object.values(entry.weights).every(Number.isFinite));
            assert(`${label}: erMode well-formed`, entry.erMode && typeof entry.erMode.scalesWithEr === 'boolean' && typeof entry.erMode.libCostKnown === 'boolean');
            assert(`${label}: conditionalThresholds is an array`, Array.isArray(entry.conditionalThresholds));
        }
    }
}

// ── P13 teams section (§10) ──────────────────────────────────────────────────
{
    assert('meta.teams present', meta.teams && typeof meta.teams === 'object');
    assert('teams.byCharacter is an object', meta.teams.byCharacter && typeof meta.teams.byCharacter === 'object');
    assert('teams.appearsIn is an object', meta.teams.appearsIn && typeof meta.teams.appearsIn === 'object');
    const exists = (id) => d.resonators.some(r => r.id === id);

    for (const [anchor, teams] of Object.entries(meta.teams.byCharacter)) {
        assert(`teams[${anchor}] is a non-empty array`, Array.isArray(teams) && teams.length > 0);
        for (const t of teams) {
            assert(`teams[${anchor}]: 3 members`, Array.isArray(t.members) && t.members.length === 3);
            assert(`teams[${anchor}]: all members exist`, t.members.every(exists));
            assert(`teams[${anchor}]: anchor is a member`, t.members.includes(Number(anchor)));
            assert(`teams[${anchor}]: score in [0,1]`, typeof t.score === 'number' && t.score >= 0 && t.score <= 1);
            assert(`teams[${anchor}]: erOverride covers every member`, t.erOverride && t.members.every(m => t.erOverride[String(m)] && typeof t.erOverride[String(m)].recommended === 'number'));
            assert(`teams[${anchor}]: roles aligns with members`, Array.isArray(t.roles) && t.roles.length === 3);
            // Transparency fields — the AVERAGE PASS of the openers-ON
            // multi-pass run, which is also what `score` ranks on.
            assert(`teams[${anchor}]: teamDamage > 0`, typeof t.teamDamage === 'number' && t.teamDamage > 0);
            assert(`teams[${anchor}]: teamTime > 0`, typeof t.teamTime === 'number' && t.teamTime > 0);
            assert(`teams[${anchor}]: teamDps > 0`, typeof t.teamDps === 'number' && t.teamDps > 0);
            assert(`teams[${anchor}]: perMember covers every member`, Array.isArray(t.perMember) && t.perMember.length === 3 && t.members.every(m => t.perMember.some(p => p.id === m)));
            // The passes behind the average, so the card can show its working.
            assert(`teams[${anchor}]: passes carries one entry per pass`,
                Array.isArray(t.passes) && t.passes.length === 3
                && t.passes.every(p => typeof p.damage === 'number' && typeof p.time === 'number'));
            // rankingDamage was the SECOND measurement — the bar's, separate
            // from the card's. There is only one now, and it must stay that way.
            assert(`teams[${anchor}]: rankingDamage is gone (one measurement, not two)`, !('rankingDamage' in t));
        }
        // THE BAR IS THE DPS. `score` normalizes teamDps against the best team
        // on the page, so ordering by score and ordering by the displayed DPS
        // are the same ordering. A card showing a higher DPS at a lower
        // percentage is the exact defect this replaced, and it is now
        // structurally impossible rather than merely unlikely.
        {
            const ranked = teams.filter(t => !t.curated);
            for (let i = 1; i < ranked.length; i++) {
                assert(`teams[${anchor}]: DPS never rises as the bar falls (${ranked[i - 1].teamDps} → ${ranked[i].teamDps})`,
                    ranked[i].teamDps <= ranked[i - 1].teamDps + 1);
            }
        }
        // curated team pinned first
        assert(`teams[${anchor}]: any curated team is pinned ahead of non-curated`,
            (() => { let seenNon = false; for (const t of teams) { if (!t.curated) seenNon = true; else if (seenNon) return false; } return true; })());
    }

    // memberBuilds: every team member has an inspectable build summary.
    assert('teams.memberBuilds is an object', meta.teams.memberBuilds && typeof meta.teams.memberBuilds === 'object');
    for (const teams of Object.values(meta.teams.byCharacter)) {
        for (const t of teams) {
            for (const mid of t.members) {
                const mb = meta.teams.memberBuilds[String(mid)];
                assert(`memberBuilds[${mid}] exists for team member`, !!mb);
                assert(`memberBuilds[${mid}] has weapon + sonata + stats + rotation`, mb && mb.weaponName !== undefined && mb.sonataName !== undefined && mb.stats && typeof mb.stats.atk === 'number' && Array.isArray(mb.rotation));
            }
        }
    }

    // appearsIn is consistent with byCharacter (every appearance is reverse-indexed).
    for (const [anchor, teams] of Object.entries(meta.teams.byCharacter)) {
        for (const t of teams) {
            for (const mid of t.members) {
                if (String(mid) === anchor) continue;
                const apps = meta.teams.appearsIn[String(mid)] ?? [];
                assert(`appearsIn[${mid}] includes anchor ${anchor}`, apps.some(a => a.anchor === Number(anchor) && a.members.join('+') === t.members.join('+')));
            }
        }
    }
}

// ── Engine-hash staleness guard (the strong check) ───────────────────────────
{
    // Paths are src/-relative (not src/core/) — see tools/optimize.mjs.
    const ENGINE_FILES = ['core/formula.js', 'core/stats.js', 'core/skill.js', 'core/sim.js', 'core/buffs.js', 'core/buffs/buff-windows.js',
    'core/buffs/buff-timeline.js', 'core/buffs/sonata-buffs.js', 'core/buffs/weapon-buffs.js', 'core/buffs/conditional-buffs.js', 'core/buffs/external-buffs.js', 'core/stat-priority.js',
        'core/team-sim.js', 'core/team-energy.js', 'core/enemy-status.js', 'core/triggerability.js', 'core/off-field.js',
        'core/cooldowns.js', 'core/opener.js',
        'core/rotation-rules.js', 'core/rotation-state.js', 'core/rotation-resources.js', 'core/tune-break.js',
        'data/loader.js'];   // keep in sync with tools/optimize.mjs ENGINE_FILES
    const h = createHash('sha256');
    for (const f of ENGINE_FILES) h.update(readFileSync(resolve(root, 'src', f)));
    const current = h.digest('hex');
    assert('committed meta engineHash matches the current engine (regenerate via node tools/optimize.mjs)', meta.engineHash === current);
}

console.log(`\nmeta-schema: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
