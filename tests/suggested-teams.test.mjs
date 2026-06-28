/**
 * P13 §8 — Suggested Teams UI component (pure render).
 *
 *   node tests/suggested-teams.test.mjs
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const ls = new Map();
globalThis.localStorage = { getItem: k => ls.get(k) ?? null, setItem: (k, v) => ls.set(k, v), removeItem: k => ls.delete(k) };

const { renderSuggestedTeams, renderAppearsInTeams } = await import('../src/ui/components/suggested-teams.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const meta = JSON.parse(readFileSync(resolve(root, 'data/wuwa-meta.json'), 'utf8'));
const d = JSON.parse(readFileSync(resolve(root, 'data/wuwa-data.json'), 'utf8'));

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

// ── covered anchor (Hiyuki) renders the panel with her curated META team ─────
{
    const html = renderSuggestedTeams(meta, d, 1108);
    assert('renders SUGGESTED TEAMS header', html.includes('SUGGESTED TEAMS'));
    assert('shows a META badge (curated pinned)', html.includes('META · Glacio Chafe'));
    assert('shows member names (Lucilla)', html.includes('Lucilla'));
    assert('has a score bar', html.includes('%'));
    // Transparency: actual team numbers visible at a glance.
    assert('shows team DMG number', /[\d,]+<span[^>]*> dmg/.test(html));
    assert('shows DPS', html.includes('DPS'));
    assert('shows sim time (s)', />s<\/span>/.test(html));
    // Inspectable builds: weapon + sonata + rotation behind the number.
    assert('has an INSPECT BUILDS expander', html.includes('INSPECT BUILDS'));
    assert('shows Hiyuki\'s weapon (Frostburn)', html.includes('Frostburn'));
    assert('shows resolved stats (ATK/CR/CD)', html.includes('ATK ') && html.includes('CR ') && html.includes('CD '));
    assert('shows the rotation', html.includes('Rotation:'));
}

// ── uncovered anchor → quiet empty state, no fabricated team ──────────────────
{
    const html = renderSuggestedTeams(meta, d, 99999);
    assert('uncovered → empty-state message', html.includes('No team suggestions available'));
    assert('uncovered → no member chips', !html.includes('<img'));
}

// ── appears-in reverse lookup (Lucilla appears in Hiyuki et al.) ──────────────
{
    const html = renderAppearsInTeams(meta, d, 1109);
    assert('appears-in lists anchor(s)', html.includes('Appears in suggested teams for'));
    assert('appears-in is empty for a char in no teams', renderAppearsInTeams(meta, d, 99999) === '');
}

// ── no crash on missing meta ─────────────────────────────────────────────────
{
    assert('null meta → empty state, no throw', renderSuggestedTeams(null, d, 1108).includes('No team suggestions'));
}

console.log(`\nsuggested-teams: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
