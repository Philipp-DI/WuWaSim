/**
 * Saved-data sanity pass (housekeeping H5) — codified as a smoke test so the
 * H1 (weapon trim migration) and H3 (pristine detection) edge cases stay
 * covered rather than relying on a one-off manual inspection.
 *
 *   node test/saved-data-migration.test.mjs
 *
 * Exercises the real storage layer against the real dataset:
 *   - a saved build referencing an absent (trimmed) weapon id loads cleanly:
 *     slot cleared, one notice fired, the rest of the build preserved
 *   - a saved build with a valid 4–5★ weapon survives load untouched
 *   - isPristineBuild flags an untouched build and clears once edited
 *   - teams still resolve their member builds after a member's weapon is trimmed
 *   - no orphaned weapon references remain in any listed build
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const ls = new Map();
globalThis.localStorage = {
    getItem: k => (ls.has(k) ? ls.get(k) : null),
    setItem: (k, v) => ls.set(k, String(v)),
    removeItem: k => ls.delete(k),
};

const storage = await import('../src/data/storage.js');
const { createBuild, isPristineBuild, normalizeBuild, setWeapon } = await import('../src/core/build.js');
const { createTeam, setTeamSlot } = await import('../src/core/team.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

const resonator = d.resonators[0];
const validWeapon = d.weapons.find(w => (w.rarity ?? 0) >= 4);
const ABSENT_WEAPON_ID = 99999999;   // stands in for any trimmed/removed weapon

// ── H1: a build referencing a trimmed weapon loads with the slot cleared ────
{
    let build = createBuild(resonator);
    build = setWeapon(build, validWeapon.id);
    build = { ...build, weapon: { ...build.weapon, id: ABSENT_WEAPON_ID } };  // simulate a now-trimmed id
    build = { ...build, rotation: ['skill'], chain: 2 };                       // some real config to preserve

    let notice = null;
    const loaded = normalizeBuild(build, { dataset: d, onNotice: m => { notice = m; } });

    assert('trimmed weapon → slot cleared', loaded.weapon === null);
    assert('trimmed weapon → notice fired', /no longer available/i.test(notice ?? ''));
    assert('trimmed weapon → build preserved (rotation)', loaded.rotation.length === 1);
    assert('trimmed weapon → build preserved (chain)', loaded.chain === 2);
    assert('trimmed weapon → never throws', !!loaded.id);
}

// ── H1: a valid 4–5★ weapon survives load untouched, no notice ──────────────
{
    let build = setWeapon(createBuild(resonator), validWeapon.id);
    let notice = null;
    const loaded = normalizeBuild(build, { dataset: d, onNotice: m => { notice = m; } });
    assert('valid weapon survives load', loaded.weapon?.id === validWeapon.id);
    assert('valid weapon → no notice', notice === null);
}

// ── H1: no dataset → cannot validate → weapon kept (defensive) ──────────────
{
    const build = { ...setWeapon(createBuild(resonator), validWeapon.id), weapon: { id: ABSENT_WEAPON_ID, level: 90, rank: 1 } };
    const loaded = normalizeBuild(build);   // no dataset passed
    assert('no dataset → weapon not cleared', loaded.weapon?.id === ABSENT_WEAPON_ID);
}

// ── H3: pristine detection ──────────────────────────────────────────────────
{
    const fresh = createBuild(resonator);
    assert('fresh build is pristine', isPristineBuild(fresh, d) === true);

    const edited = setWeapon(fresh, validWeapon.id);
    assert('edited build is not pristine', isPristineBuild(edited, d) === false);

    const renamedOnly = { ...fresh, name: 'My Custom Name' };
    assert('rename alone stays pristine (name excluded)', isPristineBuild(renamedOnly, d) === true);

    assert('unknown resonator → not pristine', isPristineBuild({ ...fresh, resonatorId: -1 }, d) === false);
}

// ── H5: full round-trip through storage + teams ─────────────────────────────
{
    storage.clearAllBuilds();
    storage.clearAllTeams();

    // Member build with a now-trimmed weapon, saved raw to storage.
    const memberRaw = { ...setWeapon(createBuild(resonator), validWeapon.id), name: 'Member' };
    memberRaw.weapon = { id: ABSENT_WEAPON_ID, level: 90, rank: 1 };
    const saved = storage.saveBuild(memberRaw, { dataset: d });

    // Build a team that references the saved member.
    let team = setTeamSlot(createTeam('T1'), 0, saved.id);
    const savedTeam = storage.saveTeam(team);

    const readTeam = storage.readTeam(savedTeam.id);
    assert('team persists its member slot', readTeam.slots[0] === saved.id);

    const member = storage.readBuild(readTeam.slots[0], { dataset: d });
    assert('team member build resolves', member != null && member.id === saved.id);
    assert('member weapon was migrated on load', member.weapon === null);

    // No orphaned weapon references across all listed builds.
    const validIds = new Set(d.weapons.map(w => w.id));
    const orphans = storage.listBuilds({ dataset: d })
        .filter(b => b.weapon && !validIds.has(b.weapon.id));
    assert('no orphaned weapon references after migration', orphans.length === 0);
}

console.log(`\nsaved-data-migration: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
