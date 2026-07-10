/**
 * P13 §1d — suggested-team "template" builds/teams: hidden from
 * listBuilds()/listTeams() by default (never auto-saved as real user data),
 * selectable when includeTemplates:true is passed (the Compare page picker).
 *
 *   node tests/storage-templates.test.mjs
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const ls = new Map();
globalThis.localStorage = {
    getItem: k => ls.get(k) ?? null,
    setItem: (k, v) => ls.set(k, v),
    removeItem: k => ls.delete(k),
};

const { saveBuild, listBuilds, saveTeam, listTeams } = await import('../src/data/storage.js');
const { createBuild } = await import('../src/core/build.js');
const { createTeam, setTeamSlot } = await import('../src/core/team.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const d = JSON.parse(readFileSync(resolve(root, 'data/wuwa-data.json'), 'utf8'));

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

const carlotta = d.resonators.find(r => r.id === 1107);

// ── Builds: template hidden by default, visible with includeTemplates ───────
{
    const real = saveBuild(createBuild(carlotta), { dataset: d });
    const template = saveBuild({ ...createBuild(carlotta), template: true }, { dataset: d });

    assert('normalizeBuild preserves template:true', template.template === true);
    assert('normalizeBuild defaults template to false', real.template === false);

    const defaultList = listBuilds({ dataset: d });
    assert('default listBuilds excludes the template build', !defaultList.some(b => b.id === template.id));
    assert('default listBuilds includes the real build', defaultList.some(b => b.id === real.id));

    const withTemplates = listBuilds({ dataset: d, includeTemplates: true });
    assert('includeTemplates:true reveals the template build', withTemplates.some(b => b.id === template.id));
    assert('includeTemplates:true still includes the real build', withTemplates.some(b => b.id === real.id));
}

// ── Teams: same contract ─────────────────────────────────────────────────────
{
    const realBuild = saveBuild(createBuild(carlotta), { dataset: d });
    const realTeam = saveTeam(setTeamSlot(createTeam('Real Team'), 0, realBuild.id));
    const templateTeam = saveTeam({ ...setTeamSlot(createTeam('Template Team'), 0, realBuild.id), template: true });

    assert('normalizeTeam preserves template:true', templateTeam.template === true);
    assert('normalizeTeam defaults template to false', realTeam.template === false);

    const defaultTeams = listTeams();
    assert('default listTeams excludes the template team', !defaultTeams.some(t => t.id === templateTeam.id));
    assert('default listTeams includes the real team', defaultTeams.some(t => t.id === realTeam.id));

    const withTemplates = listTeams({ includeTemplates: true });
    assert('includeTemplates:true reveals the template team', withTemplates.some(t => t.id === templateTeam.id));
}

console.log(`\nstorage-templates: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
