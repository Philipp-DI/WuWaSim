/**
 * The version-update folder (docs/specs/VERSION-UPDATE-SPEC.md §9).
 *
 *   node tests/update-game-version.test.mjs
 *
 * steps.json is the procedure, so its shape is checked like code: every
 * command exists, every output is a known file, and no step reads what a later
 * step writes (the hit-map cycle is the one declared exception). The pure parts
 * of status, diff and the orchestrator run on throwaway trees built here.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { ROOT, nanokaVersionFor, readGameVersion, ARIKATSU_TABLES, COMMITTED_BINDATA } from '../update-game-version/sources.mjs';
import { readInstall, readExportBuild } from '../update-game-version/status.mjs';
import { diffTable, diffTrees, renderReport } from '../update-game-version/diff-report.mjs';
import { loadSteps, expand, firstUnfinished, recordFinished, gateDecision } from '../update-game-version/update.mjs';

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

const scratch = mkdtempSync(join(tmpdir(), 'wuwa-update-'));
const write = (path, value) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value, null, 2));
};

// ── steps.json schema ────────────────────────────────────────────────────────
const { steps, hotfix, cycles } = loadSteps();
const ids = steps.map(step => step.id);
assert('steps.json lists the 14 spec steps in run order', ids.join(',') === [
    'status', 'stage-arikatsu', 'stage-nanoka', 'diff', 'review', 'install', 'export',
    'check-export', 'extract', 'compile', 'assets', 'verify', 'in-game', 'record'].join(','));
assert('every step is AUTO, USER or GATE', steps.every(step => ['AUTO', 'USER', 'GATE'].includes(step.kind)));
assert('the hotfix path is steps 7–12', hotfix.join(',') === ids.slice(6, 12).join(','));

const context = { version: '9.9', exportRoot: 'EXPORT_ROOT' };
const readme = readFileSync(resolve(ROOT, 'update-game-version/README.md'), 'utf8');
for (const step of steps) {
    if (step.kind === 'AUTO' && step.pendingPhase == null) {
        assert(`${step.id}: an AUTO step has a command`, step.run?.length > 0);
        for (const command of step.run ?? []) {
            const script = expand(command, context).split(/\s+/)[1];
            assert(`${step.id}: command script exists (${script})`, existsSync(resolve(ROOT, script)));
        }
    }
    if (step.pendingPhase != null) assert(`${step.id}: a pending step has no command yet`, !step.run?.length);
    if (step.kind !== 'AUTO') assert(`${step.id}: README has its instructions section`, readme.includes(`### ${step.id}\n`));
    for (const output of step.outputs ?? []) {
        const path = expand(output, context);
        const scratchOutput = path.startsWith('update-game-version/staging/9.9') || path.startsWith('update-game-version/reports/9.9');
        assert(`${step.id}: output is a known file (${path})`, scratchOutput || existsSync(resolve(ROOT, path)));
    }
}
for (const [index, step] of steps.entries()) {
    const later = new Set(steps.slice(index + 1).flatMap(laterStep => laterStep.outputs ?? []));
    for (const input of step.inputs ?? []) {
        const declared = cycles.some(cycle => cycle.path === input);
        assert(`${step.id}: reads no later step's output (${input})`, declared || !later.has(input));
    }
}
assert('the only declared cycle is the hit-map one', cycles.map(cycle => cycle.path).join(',') === 'data/hit-map.json');

// ── moved scripts: no old path left ─────────────────────────────────────────
for (const old of ['fetch-nanoka-chars', 'fetch-nanoka-echoes', 'fetch-nanoka-weapons']) {
    assert(`tools/${old}.mjs is gone`, !existsSync(resolve(ROOT, `tools/${old}.mjs`)));
}
const grep = spawnSync('git', ['grep', '-n', '-E', 'fetch-nanoka-(chars|echoes|weapons|\\*)', '--',
    '.', ':!docs/history/**', ':!docs/specs/VERSION-UPDATE-SPEC.md',
    ':!tests/update-game-version.test.mjs'], { cwd: ROOT, encoding: 'utf8' });
assert(`git grep finds no reference to the old fetchers${grep.stdout ? `:\n${grep.stdout}` : ''}`, grep.stdout === '');

// ── sources ─────────────────────────────────────────────────────────────────
const pinned = readGameVersion();
assert('data/game-version.json names both halves', typeof pinned.arikatsu === 'string' && typeof pinned.nanoka === 'string');
assert('preprocess reads its pin from data/game-version.json',
    /game-version\.json/.test(readFileSync(resolve(ROOT, 'tools/preprocess.mjs'), 'utf8')));
assert('every committed bindata table is staged', Object.values(COMMITTED_BINDATA).every(path => ARIKATSU_TABLES.includes(path)));
assert('nanoka: an exact version wins', nanokaVersionFor(['3.7', '3.7.1'], '3.7') === '3.7');
assert('nanoka: a lone patch build stands in for the version', nanokaVersionFor(['3.6', '3.7.0'], '3.7') === '3.7.0');
assert('nanoka: two patch builds are ambiguous', nanokaVersionFor(['3.7.0', '3.7.1'], '3.7') === null);
assert('nanoka: a missing version is null', nanokaVersionFor(['3.6'], '3.7') === null);
assert('nanoka: 3.70 is not 3.7', nanokaVersionFor(['3.70'], '3.7') === null);

// ── status on a fake install tree ───────────────────────────────────────────
const install = join(scratch, 'install');
for (const dir of ['Video/3.6.0', '3.6.0/Resource/3.6.15', '3.7.0/Resource/3.7.2', '3.7.0/Resource/3.7.15']) {
    mkdirSync(join(install, 'Client/Saved/Resources', dir), { recursive: true });
}
const installed = readInstall(install);
assert('status: newest resource version, "Video" ignored', installed.resources === '3.7.0');
assert('status: newest hotfix lane by number, not by text', installed.hotfix === '3.7.15');
assert('status: a missing install reads as nulls', readInstall(join(scratch, 'nowhere')).resources === null);
const exportRoot = join(scratch, 'export');
write(join(exportRoot, 'Content/Aki/ConfigDB/Misc/BuildInfo.txt'), 'Stream=branch_3.6_final\nChangelist=1\nPatchVersion=3.6.15\n');
assert('status: the export BuildInfo is read', readExportBuild(exportRoot).patchVersion === '3.6.15');
assert('status: no export reads as null', readExportBuild(join(scratch, 'nowhere')).patchVersion === null);

// ── diff-report on two tiny trees ───────────────────────────────────────────
// A real character file, so the effect-slot keys come from the real projection.
const sanhua = JSON.parse(readFileSync(resolve(ROOT, 'data/extracted-nanoka/characters/1102.json'), 'utf8'));
const role = (id, extra = {}) => ({ Id: id, RoleType: 1, QualityId: 5, IsTrial: false, ...extra });
const tree = (name) => ({ arikatsu: join(scratch, name, 'arikatsu'), nanoka: join(scratch, name, 'nanoka') });
const before = tree('before'), after = tree('after');
write(join(before.arikatsu, 'BinData/role/roleinfo.json'), [role(1102), role(1105, { Name: 'old' })]);
write(join(after.arikatsu, 'BinData/role/roleinfo.json'), [role(1102), role(1105, { Name: 'new', Fresh: 1 }), role(1999)]);
write(join(before.nanoka, 'character.json'), { 1102: { en: 'Sanhua' }, 1105: { en: 'Zhezhi' } });
write(join(after.nanoka, 'character.json'), { 1102: { en: 'Sanhua' }, 1105: { en: 'Zhezhi' } });
write(join(before.nanoka, 'characters/1102.json'), sanhua);
write(join(before.nanoka, 'characters/1105.json'), { id: 1105, name: 'Zhezhi', desc: 'old text' });
const changed = structuredClone(sanhua);
changed.chains['1'].param = ['20%', '10'];
changed.chains['4'].desc += ' ATK is increased by 10%.';
write(join(after.nanoka, 'characters/1102.json'), changed);
write(join(after.nanoka, 'characters/1105.json'), { id: 1105, name: 'Zhezhi', desc: 'new text' });

const summary = diffTrees({ before, after, overrides: { 1102: { 'S1.0': { window: { type: 'persist' } } } } });
const roleTable = summary.tables.find(table => table.path === 'BinData/role/roleinfo.json');
assert('diff: an added row id', roleTable?.added.join(',') === '1999');
assert('diff: a changed row id', roleTable?.changed.join(',') === '1105');
assert('diff: a new field', roleTable?.newFields.join(',') === 'Fresh');
const sanhuaFile = summary.nanoka.find(file => file.file === 'characters/1102.json');
assert('diff: a nanoka param change', sanhuaFile?.changes.some(change => change.kind === 'param' && change.path === 'chains.1.param.0'));
assert('diff: a nanoka text change', summary.nanoka.find(file => file.file === 'characters/1105.json')?.changes.some(change => change.kind === 'text' && change.after === 'new text'));
const slots = summary.effectSlots.find(entry => entry.id === 1102);
assert('diff: a re-pointed effect-slot key', slots?.repointed.includes('S1.0'));
assert('diff: an overridden key is flagged', slots?.overridden.includes('S1.0'));
assert('diff: an added effect-slot key', slots?.added.join(',') === 'S4.1');
assert('diff: a shell (Arikatsu without nanoka)', summary.shells.after.arikatsuOnly.join(',') === '1999');
assert('diff: no shell before', summary.shells.before.arikatsuOnly.length === 0);
const markdown = renderReport(summary, { version: '9.9', baseline: '9.8' });
assert('report: names the shell', markdown.includes('1999'));
assert('report: names the re-pointed key', markdown.includes('S1.0'));
assert('report: quotes the new text', markdown.includes('new text'));

// phantomitem and weaponconf carry `ItemId`, not `Id`: matched by position, a
// row inserted mid-table reads as a change to every row after it (3.7 did that).
const items = diffTable(
    [{ ItemId: 10, SkillId: 1 }, { ItemId: 20, SkillId: 2 }],
    [{ ItemId: 10, SkillId: 1 }, { ItemId: 15, SkillId: 9 }, { ItemId: 20, SkillId: 2, FetterGroup: [37] }]);
assert('diff: an ItemId table is not matched by position', items.byPosition === false);
assert('diff: a row inserted mid-table is one added row', items.added.join(',') === '15' && items.removed.length === 0);
assert('diff: rows after the insertion change only where they changed',
    items.changed.join(',') === '20' && JSON.stringify(items.changedFields) === '{"FetterGroup":1}');
const positional = diffTable([{ Level: 1 }], [{ Level: 2 }]);
assert('diff: a table with no id field falls back to position', positional.byPosition && positional.changed.join(',') === '0');
const positionalReport = renderReport({ ...summary, tables: [{ path: 'BinData/x.json', ...positional }] }, { version: '9.9', baseline: '9.8' });
assert('report: says when a table was matched by position', positionalReport.includes('`BinData/x.json` (by position)'));

// ── orchestrator state ──────────────────────────────────────────────────────
const state = { steps: {} };
recordFinished(state, steps, 'status', 'h1');
recordFinished(state, steps, 'stage-arikatsu', 'h2');
recordFinished(state, steps, 'stage-nanoka', 'h3');
assert('state: the next step is the first unfinished one', firstUnfinished(steps, state, ids)?.id === 'diff');
recordFinished(state, steps, 'stage-arikatsu', 'h2b');
assert('state: re-running a step invalidates every later one', !state.steps['stage-nanoka'] && state.steps.status);
assert('gate: no review file is closed', !gateDecision(null, 'abc').open);
assert('gate: a pending decision is closed', !gateDecision('diff: abc\ndecision: pending\n', 'abc').open);
assert('gate: a stale review is closed', !gateDecision('diff: old\ndecision: install\n', 'abc').open);
assert('gate: install on the current diff opens', gateDecision('diff: abc\ndecision: install\n', 'abc').open);

// ── privacy: local-only files stay out of git ───────────────────────────────
const ignored = spawnSync('git', ['check-ignore', 'update-game-version/local.json',
    'update-game-version/staging/x', 'update-game-version/reports/x'], { cwd: ROOT, encoding: 'utf8' });
assert('local.json, staging/ and reports/ are gitignored', ignored.stdout.trim().split('\n').length === 3);
assert('local.example.json carries no real path', !/[A-Za-z]:[\\/]/.test(readFileSync(resolve(ROOT, 'update-game-version/local.example.json'), 'utf8')));

rmSync(scratch, { recursive: true, force: true });
console.log(`\nupdate-game-version: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
