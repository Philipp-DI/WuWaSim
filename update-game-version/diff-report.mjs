#!/usr/bin/env node
// update-game-version/diff-report.mjs — step 4: what the target version
// changes, on BOTH halves (the Arikatsu diff alone once reported that a patch
// changed nothing while nanoka had reworded three kits).
//
//   node update-game-version/diff-report.mjs --version 3.7
//
// → reports/<version>/diff.md (for the review gate) and diff.json.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ARIKATSU_TABLES, COMMITTED_BINDATA, ROOT, flag, reportsDir, stagingDir } from './sources.mjs';
import { isPlayable, projectNanokaCharacterFull } from '../tools/preprocess/resonators.mjs';

const ROLE_TABLE = 'BinData/role/roleinfo.json';
const LIST_LIMIT = 20;

const readJson = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null);

// The field that names a row: `Id`, or `ItemId` on phantomitem and weaponconf.
const ROW_KEY_FIELDS = ['Id', 'ItemId'];

/** The id field every row of every table carries, or null: rows then match by position. */
function rowKeyField(...tables) {
    return ROW_KEY_FIELDS.find(field => tables.every(table => Array.isArray(table) && table.every(row => row?.[field] != null))) ?? null;
}

// A table's rows by `keyField`; null keys an array by position.
function rowsById(table, keyField) {
    const rows = new Map();
    if (!Array.isArray(table)) {
        for (const [key, row] of Object.entries(table ?? {})) rows.set(key, row);
        return rows;
    }
    table.forEach((row, index) => {
        let key = keyField ? String(row[keyField]) : String(index);
        while (rows.has(key)) key = `${key}#`;
        rows.set(key, row);
    });
    return rows;
}

function countChangedFields(old, row, counts) {
    for (const field of new Set([...Object.keys(old ?? {}), ...Object.keys(row ?? {})])) {
        if (JSON.stringify(old?.[field]) !== JSON.stringify(row?.[field])) counts[field] = (counts[field] ?? 0) + 1;
    }
}

/** Added/removed/changed row ids, new top-level fields, which fields changed how often, and whether rows matched by position. */
export function diffTable(before, after) {
    const keyField = rowKeyField(before, after);
    const beforeRows = rowsById(before, keyField), afterRows = rowsById(after, keyField);
    const added = [], removed = [], changed = [];
    const changedFields = {};
    const fieldsBefore = new Set([...beforeRows.values()].flatMap(row => Object.keys(row ?? {})));
    const fieldsAfter = new Set([...afterRows.values()].flatMap(row => Object.keys(row ?? {})));
    for (const [key, row] of afterRows) {
        if (!beforeRows.has(key)) { added.push(key); continue; }
        const old = beforeRows.get(key);
        if (JSON.stringify(old) === JSON.stringify(row)) continue;
        changed.push(key);
        countChangedFields(old, row, changedFields);
    }
    for (const key of beforeRows.keys()) if (!afterRows.has(key)) removed.push(key);
    return {
        added, removed, changed, changedFields,
        newFields: [...fieldsAfter].filter(field => !fieldsBefore.has(field)),
        byPosition: Array.isArray(after) && keyField === null,
    };
}

function changeKind(path, value) {
    if (path.split('.').some(segment => segment === 'param' || segment === 'params')) return 'param';
    if (typeof value === 'string' && value.startsWith('/Game/')) return 'asset';
    return typeof value === 'string' ? 'text' : 'value';
}

/** Every leaf that differs, as { path, kind, before, after }. */
export function leafChanges(before, after, path = '') {
    const bothObjects = before && after && typeof before === 'object' && typeof after === 'object'
        && Array.isArray(before) === Array.isArray(after);
    if (!bothObjects) {
        if (JSON.stringify(before) === JSON.stringify(after)) return [];
        return [{ path, kind: changeKind(path, after ?? before), before, after }];
    }
    const changes = [];
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
        changes.push(...leafChanges(before[key], after[key], path ? `${path}.${key}` : key));
    }
    return changes;
}

// Relative paths of every nanoka JSON except the manifest, which moves on
// every CDN build and says nothing about content.
function nanokaFiles(dir) {
    if (!existsSync(dir)) return [];
    const files = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            for (const name of readdirSync(join(dir, entry.name))) if (name.endsWith('.json')) files.push(`${entry.name}/${name}`);
        } else if (entry.name.endsWith('.json') && entry.name !== 'manifest.json') files.push(entry.name);
    }
    return files.sort();
}

function diffNanoka(beforeDir, afterDir) {
    const results = [];
    for (const file of [...new Set([...nanokaFiles(beforeDir), ...nanokaFiles(afterDir)])].sort()) {
        const before = readJson(join(beforeDir, file)), after = readJson(join(afterDir, file));
        if (before == null) results.push({ file, status: 'added', changes: [] });
        else if (after == null) results.push({ file, status: 'removed', changes: [] });
        else {
            const changes = leafChanges(before, after);
            if (changes.length) results.push({ file, status: 'changed', changes });
        }
    }
    return results;
}

// `S{level}.{index}` / `IH{node}.{index}` → what the effect grants, from the
// real projection. These are the keys BEFORE bindSkillScopes, which can drop
// more at compile time; step 10's LOCK A diff shows the rest.
function effectSlots(character) {
    const slots = new Map();
    if (!character) return slots;
    const projected = projectNanokaCharacterFull(character);
    const signature = ({ stat, value, skillType, element }) => JSON.stringify({ stat, value, skillType, element });
    for (const node of projected.resonanceChain ?? []) {
        (node.effects ?? []).forEach((effect, index) => slots.set(`S${node.level}.${index}`, signature(effect)));
    }
    (projected.inherentSkills ?? []).forEach((node, nodeIndex) => {
        (node.effects ?? []).forEach((effect, index) => slots.set(`IH${nodeIndex}.${index}`, signature(effect)));
    });
    return slots;
}

function diffEffectSlots(beforeDir, afterDir, overrides) {
    const ids = new Set([...nanokaFiles(beforeDir), ...nanokaFiles(afterDir)]
        .filter(file => file.startsWith('characters/')).map(file => Number(file.slice(11, -5))));
    const results = [];
    for (const id of [...ids].sort((left, right) => left - right)) {
        const beforeChar = readJson(join(beforeDir, `characters/${id}.json`));
        const afterChar = readJson(join(afterDir, `characters/${id}.json`));
        if (JSON.stringify(beforeChar) === JSON.stringify(afterChar)) continue;
        const before = effectSlots(beforeChar), after = effectSlots(afterChar);
        const added = [...after.keys()].filter(key => !before.has(key));
        const removed = [...before.keys()].filter(key => !after.has(key));
        const repointed = [...after.keys()].filter(key => before.has(key) && before.get(key) !== after.get(key));
        if (!added.length && !removed.length && !repointed.length) continue;
        const curated = Object.keys(overrides[id] ?? {});
        const overridden = [...added, ...removed, ...repointed].filter(key => curated.includes(key));
        results.push({ id, name: afterChar?.name ?? beforeChar?.name, added, removed, repointed, overridden });
    }
    return results;
}

// A resonator in one half only ships as a SHELL: a name with no kit to cast.
function shells(tree) {
    const roles = readJson(join(tree.arikatsu, ROLE_TABLE)) ?? [];
    const playable = new Set(roles.filter(isPlayable).map(role => role.Id));
    const index = Object.keys(readJson(join(tree.nanoka, 'character.json')) ?? {}).map(Number);
    const details = new Set(nanokaFiles(tree.nanoka).filter(file => file.startsWith('characters/')).map(file => Number(file.slice(11, -5))));
    return {
        arikatsuOnly: [...playable].filter(id => !details.has(id)).sort((left, right) => left - right),
        nanokaOnly: [...new Set([...index, ...details])].filter(id => !playable.has(id)).sort((left, right) => left - right),
    };
}

/** Both halves, before vs after. Trees are `{ arikatsu, nanoka }` directories. */
export function diffTrees({ before, after, overrides = {} }) {
    const tables = [];
    for (const path of ARIKATSU_TABLES) {
        const old = readJson(join(before.arikatsu, path)), current = readJson(join(after.arikatsu, path));
        if (old == null && current == null) continue;
        if (old == null || current == null) { tables.push({ path, missing: old == null ? 'before' : 'after' }); continue; }
        tables.push({ path, ...diffTable(old, current) });
    }
    return {
        tables,
        nanoka: diffNanoka(before.nanoka, after.nanoka),
        effectSlots: diffEffectSlots(before.nanoka, after.nanoka, overrides),
        shells: { before: shells(before), after: shells(after) },
    };
}

const list = (items) => (items.length > LIST_LIMIT ? `${items.slice(0, LIST_LIMIT).join(', ')} … (+${items.length - LIST_LIMIT})` : items.join(', '));
const quote = (value) => (value === undefined ? '—' : `\`${JSON.stringify(value)}\``);

function renderNanoka(files, lines) {
    lines.push('## nanoka files', '');
    const counts = (status) => files.filter(file => file.status === status).length;
    lines.push(`${counts('changed')} changed, ${counts('added')} added, ${counts('removed')} removed.`, '');
    for (const file of files) {
        if (file.status !== 'changed') { lines.push(`- **${file.status}** \`${file.file}\``); continue; }
        const semantic = file.changes.filter(change => change.kind !== 'asset');
        const assets = file.changes.length - semantic.length;
        lines.push(`### \`${file.file}\``, '');
        if (assets) lines.push(`- ${assets} asset path(s) changed`);
        for (const change of semantic) lines.push(`- ${change.kind} \`${change.path}\`: ${quote(change.before)} → ${quote(change.after)}`);
        lines.push('');
    }
}

function renderTables(tables, lines) {
    lines.push('## Arikatsu tables', '', '| Table | Added | Removed | Changed | New fields | Changed fields (rows) |', '| --- | --- | --- | --- | --- | --- |');
    for (const table of tables) {
        if (table.missing) { lines.push(`| \`${table.path}\` | missing ${table.missing} | | | | |`); continue; }
        const fields = Object.entries(table.changedFields).sort((left, right) => right[1] - left[1]).map(([field, count]) => `${field} (${count})`);
        const byPosition = table.byPosition ? ' (by position)' : '';
        lines.push(`| \`${table.path}\`${byPosition} | ${table.added.length} | ${table.removed.length} | ${table.changed.length} | ${table.newFields.join(', ')} | ${list(fields)} |`);
    }
    lines.push('');
    for (const table of tables.filter(entry => !entry.missing && (entry.added.length || entry.removed.length))) {
        lines.push(`- \`${table.path}\`: added [${list(table.added)}]${table.removed.length ? `; removed [${list(table.removed)}]` : ''}`);
    }
    lines.push('');
}

/** The review document's source: Markdown, most decision-relevant first. */
export function renderReport(summary, { version, baseline, nanokaBaseline = null, nanokaVersion = null, drift = [] }) {
    const lines = [`# Version diff ${baseline} → ${version}`, ''];
    if (nanokaVersion) lines.push(`nanoka ${nanokaBaseline ?? '?'} → ${nanokaVersion}. Before = committed data plus Arikatsu ${baseline}; after = staging.`, '');
    if (drift.length) lines.push(`**Committed copies differ from Arikatsu ${baseline}:** ${drift.join(', ')}`, '');

    lines.push('## Shells (a resonator in one half only)', '');
    for (const side of ['before', 'after']) {
        const { arikatsuOnly, nanokaOnly } = summary.shells[side];
        lines.push(`- ${side}: Arikatsu only [${arikatsuOnly.join(', ')}]; nanoka only [${nanokaOnly.join(', ')}]`);
    }
    lines.push('', '## Effect-slot keys (CLAUDE.md, "Effect-slot keys are FROZEN…")', '',
        'Projection-level keys, before `bindSkillScopes`; an **overridden** key is one `data/effect-overrides.json` addresses.', '');
    if (!summary.effectSlots.length) lines.push('No resonator\'s keys moved.');
    for (const entry of summary.effectSlots) {
        const parts = [['added', entry.added], ['removed', entry.removed], ['re-pointed', entry.repointed], ['**overridden**', entry.overridden]]
            .filter(([, keys]) => keys.length).map(([label, keys]) => `${label} ${keys.join(', ')}`);
        lines.push(`- ${entry.id} ${entry.name ?? ''}: ${parts.join('; ')}`);
    }
    lines.push('');
    renderNanoka(summary.nanoka, lines);
    renderTables(summary.tables, lines);
    return `${lines.join('\n')}\n`;
}

async function main() {
    const version = flag(process.argv, '--version');
    if (!version) {
        console.error('Usage: node update-game-version/diff-report.mjs --version <x.y>');
        process.exit(2);
    }
    const staging = stagingDir(version);
    const before = { arikatsu: resolve(staging, 'baseline'), nanoka: resolve(ROOT, 'data/extracted-nanoka') };
    const after = { arikatsu: resolve(staging, 'arikatsu'), nanoka: resolve(staging, 'nanoka') };
    const overrides = readJson(resolve(ROOT, 'data/effect-overrides.json'))?.overrides ?? {};
    const summary = diffTrees({ before, after, overrides });
    // The committed BinData copies must BE the pinned branch, or "before" lies.
    const drift = Object.entries(COMMITTED_BINDATA)
        .filter(([name, path]) => readFileSync(resolve(ROOT, 'data/bindata', name), 'utf8') !== readFileSync(resolve(before.arikatsu, path), 'utf8'))
        .map(([name]) => `data/bindata/${name}`);
    const meta = {
        version,
        baseline: readJson(`${before.arikatsu}.source.json`)?.ref,
        nanokaBaseline: readJson(resolve(ROOT, 'data/game-version.json'))?.nanoka,
        nanokaVersion: readJson(`${after.nanoka}.source.json`)?.nanoka,
        drift,
    };
    mkdirSync(reportsDir(version), { recursive: true });
    writeFileSync(resolve(reportsDir(version), 'diff.md'), renderReport(summary, meta));
    writeFileSync(resolve(reportsDir(version), 'diff.json'), `${JSON.stringify({ ...meta, ...summary }, null, 1)}\n`);
    const changedFiles = summary.nanoka.length, movedKeys = summary.effectSlots.length;
    console.log(`nanoka: ${changedFiles} file(s) differ; effect-slot keys moved on ${movedKeys} resonator(s); `
        + `shells after: ${summary.shells.after.arikatsuOnly.length + summary.shells.after.nanokaOnly.length}; drift: ${drift.length}`);
    console.log(`Wrote ${resolve(reportsDir(version), 'diff.md')}`);
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) await main();
