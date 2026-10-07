/**
 * Instruction files — CLAUDE.md and .claude/rules/ stay loadable and lean.
 *
 *   node tests/instruction-files.test.mjs
 *
 * Claude Code loads CLAUDE.md in every session, but a .claude/rules/ file only
 * when it reads, edits or writes a file matching that rule's `paths:` globs.
 * This guards the ways that layout rots silently:
 *   1. a glob stops matching (a file was renamed), so its rule never loads again;
 *   2. a frontmatter Claude Code cannot parse makes it load the rule in EVERY
 *      session, quietly undoing the split;
 *   3. CLAUDE.md regrows (it was split once on 2026-07-17 and was 107 KB again
 *      by 2026-10-05);
 *   4. invariant titles collide, or a title quoted in a code comment
 *      (`CLAUDE.md, "<title>"`) stops resolving to exactly one invariant;
 *   5. an agent or skill file Claude Code would skip without a word (missing
 *      name/description, unknown model or effort), or a skill pointing at one
 *      of its own files that doesn't exist;
 *   6. history creeping back into instruction files (struck-through text,
 *      rows that grow into incident logs), or a `History:` pointer that leads
 *      nowhere. Instruction files state current truth; history lives in
 *      docs/history/rules/.
 */

import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, relative, resolve } from 'path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SELF = 'tests/instruction-files.test.mjs';
const RULES_DIR = '.claude/rules';
const ROOT_MAX_LINES = 200;
const ROOT_MAX_BYTES = 15000;
// Local-only paths (see .gitignore): a glob must match a COMMITTED file, so a
// match that only exists on one machine must not count.
const SKIP_DIRS = new Set(['.git', 'node_modules', '.venv', '.p3', '.assets_raw',
    'templates', 'docs-local', '__pycache__']);
const SKIP_PATHS = new Set(['docs/uml', '.claude/worktrees']);

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

const toPosix = (path) => path.split('\\').join('/');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const lineCount = (text) => text.split(/\r?\n/).length - (text.endsWith('\n') ? 1 : 0);

function walk(dir, out = []) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const rel = toPosix(relative(ROOT, join(dir, entry.name)));
        if (SKIP_DIRS.has(entry.name) || SKIP_PATHS.has(rel)) continue;
        if (entry.isDirectory()) walk(join(dir, entry.name), out);
        else out.push(rel);
    }
    return out;
}

// `a/{b,c}/*.{js,mjs}` → four patterns. Each alternative is checked on its
// own, so a typo inside a brace group cannot hide behind a sibling that matches.
function expandBraces(pattern) {
    const group = pattern.match(/\{([^{}]*)\}/);
    if (!group) return [pattern];
    return group[1].split(',').flatMap(alt => expandBraces(pattern.replace(group[0], alt)));
}

function globToRegExp(glob) {
    let out = '';
    for (let i = 0; i < glob.length; i++) {
        const char = glob[i];
        if (char === '*' && glob[i + 1] === '*') {
            const slashAfter = glob[i + 2] === '/';
            out += slashAfter ? '(?:.*/)?' : '.*';
            i += slashAfter ? 2 : 1;
        } else if (char === '*') out += '[^/]*';
        else if (char === '?') out += '[^/]';
        else out += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp(`^${out}$`);
}

// The house format: a quoted YAML list under `paths:`. Anything else is
// rejected, because a frontmatter Claude Code fails to parse loads ALWAYS.
function parseRule(text) {
    const lines = text.split(/\r?\n/);
    if (lines[0] !== '---' || lines[1] !== 'paths:') return null;
    const paths = [];
    let idx = 2;
    for (; idx < lines.length && lines[idx] !== '---'; idx++) {
        const item = lines[idx].match(/^ {2}- "([^"]+)"$/);
        if (!item) return null;
        paths.push(item[1]);
    }
    return lines[idx] === '---' && paths.length > 0 ? paths : null;
}

function invariantTitles(text) {
    const titles = [];
    let inTable = false;
    for (const row of text.split(/\r?\n/)) {
        if (row === '| Invariant | Detail |') { inTable = true; continue; }
        if (!inTable || row === '| --- | --- |') continue;
        if (!row.startsWith('| ')) { inTable = false; continue; }
        titles.push(row.slice(2).split(' | ')[0].trim());
    }
    return titles;
}

const files = walk(ROOT);
let ruleFiles = [];
try {
    ruleFiles = readdirSync(join(ROOT, RULES_DIR)).filter(name => name.endsWith('.md'));
} catch { /* missing directory is reported below */ }

// ── 1 + 2. Every rule has a parseable `paths:` list, every glob matches ──────
{
    assert(`${RULES_DIR}/ exists and holds rules`, ruleFiles.length > 0);
    for (const name of ruleFiles) {
        const paths = parseRule(read(`${RULES_DIR}/${name}`));
        assert(`${name}: frontmatter is a quoted \`paths:\` list (unscoped rules belong in CLAUDE.md, which is budgeted)`, paths !== null);
        for (const glob of paths ?? []) {
            for (const pattern of expandBraces(glob)) {
                const regex = globToRegExp(pattern);
                assert(`${name}: "${pattern}" matches at least one committed file`, files.some(file => regex.test(file)));
            }
        }
    }
}

// ── 3. Root CLAUDE.md stays within budget ────────────────────────────────────
{
    const text = read('CLAUDE.md');
    const lines = lineCount(text), bytes = Buffer.byteLength(text);
    assert(`CLAUDE.md is ${lines} lines (budget ${ROOT_MAX_LINES}): move area-specific rules into ${RULES_DIR}/`, lines <= ROOT_MAX_LINES);
    assert(`CLAUDE.md is ${bytes} bytes (budget ${ROOT_MAX_BYTES}): move area-specific rules into ${RULES_DIR}/`, bytes <= ROOT_MAX_BYTES);
}

// ── 4. Invariant titles are unique, and quoted citations resolve ─────────────
const allTitles = ['CLAUDE.md', ...ruleFiles.map(name => `${RULES_DIR}/${name}`)]
    .flatMap(rel => invariantTitles(read(rel)));
{
    const seen = new Set();
    for (const title of allTitles) {
        assert(`invariant title is unique: "${title}"`, !seen.has(title));
        seen.add(title);
    }
}

const words = (text) => text.toLowerCase().replace(/[`"“”\\]/g, '').match(/[a-z0-9][a-z0-9'_-]*/g) ?? [];
function inOrder(needle, haystack) {
    let pos = 0;
    for (const word of haystack) if (word === needle[pos]) pos++;
    return pos === needle.length;
}
// `CLAUDE.md, "Gauge income is readable ON A CAST"`, possibly wrapped across
// comment lines or escaped inside a string literal. Cited words must appear,
// in order, in exactly one title (citations abbreviate and drop backticks).
const CITATION = /CLAUDE\.md[^"“\n]{0,40}?\\?["“]((?:[^"”\\]|\\(?!["”]))+?)\\?["”]/g;
{
    const titleWords = allTitles.map(words);
    const sources = files.filter(file => /^(src|tools|tests)\/.*\.(js|mjs|py)$/.test(file) && file !== SELF);
    let citations = 0;
    for (const file of sources) {
        for (const match of read(file).matchAll(CITATION)) {
            const phrase = match[1].replace(/\n\s*(?:\/\/|\*|#)?\s*/g, ' ').trim();
            const hits = titleWords.filter(title => inOrder(words(phrase), title)).length;
            citations++;
            assert(`${file}: cited invariant "${phrase}" resolves to exactly one title (found ${hits})`, hits === 1);
        }
    }
    assert('at least one quoted invariant citation was found (the scanner still works)', citations > 0);
}

// ── 5. Agents and skills load, and skills' own references resolve ───────────
const MODELS = new Set(['sonnet', 'opus', 'haiku', 'fable', 'inherit']);
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

/** Top-level `key: value` pairs of a frontmatter that starts on line 1, or null. */
function frontmatterOf(text) {
    const lines = text.split(/\r?\n/);
    if (lines[0] !== '---') return null;
    const end = lines.indexOf('---', 1);
    if (end < 0) return null;
    const fields = {};
    for (const line of lines.slice(1, end)) {
        const field = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
        if (field) fields[field[1]] = field[2].replace(/^["']|["']$/g, '').trim();
    }
    return fields;
}

const agentFiles = files.filter(file => /^\.claude\/agents\/.+\.md$/.test(file));
{
    const names = new Set();
    for (const file of agentFiles) {
        const fields = frontmatterOf(read(file)) ?? {};
        assert(`${file}: has name and description (Claude Code skips it silently otherwise)`, Boolean(fields.name && fields.description));
        assert(`${file}: name has no ':' and doesn't start with '-'`, !/:|^-/.test(fields.name ?? ''));
        assert(`${file}: model "${fields.model}" is an alias, a claude-* id or absent`, !fields.model || MODELS.has(fields.model) || /^claude-[\w.-]+$/.test(fields.model));
        assert(`${file}: effort "${fields.effort}" is a known level or absent`, !fields.effort || EFFORTS.has(fields.effort));
        assert(`${file}: agent name "${fields.name}" is unique`, !names.has(fields.name));
        names.add(fields.name);
    }
}

const skillFiles = files.filter(file => /^\.claude\/skills\/[^/]+\/SKILL\.md$/.test(file));
{
    for (const file of skillFiles) {
        const folder = file.slice(0, -'/SKILL.md'.length);
        const fields = frontmatterOf(read(file)) ?? {};
        assert(`${file}: has name and description`, Boolean(fields.name && fields.description));
        assert(`${file}: name matches its folder`, fields.name === folder.split('/').pop());
        for (const [, ref] of read(file).matchAll(/(?:^|[\s`(])((?:references|scripts|assets)\/[\w.-]+\.\w+)/g)) {
            assert(`${file}: its reference ${ref} exists`, files.includes(`${folder}/${ref}`));
        }
    }
}

// ── 6. Instruction files state current truth; history lives in docs/history/rules/ ──
// Work queues for the condensation pass (decided 2026-10-06). Remove an entry
// once its file or row states current truth only. An entry that is already
// done fails, so the queues can't go stale.
const PENDING_STRIKETHROUGH = new Set([
    '.claude/rules/data-pipeline.md',
    '.claude/rules/invariants-damage.md',
    '.claude/rules/invariants-optimizer.md',
    '.claude/rules/invariants-resources.md',
]);
const MAX_ROW_CHARS = 1500;
const PENDING_LONG_ROWS = new Set([
    'A scoped AMPLIFY has a per-hit home, and a CAP branch is not a grant',
    'A SCOPED crit value is not a build stat, and a scope it cannot honour is REFUSED',
    'A kit\'s OWN DEF ignore is an EFFECT, and unscoped it is inflation',
    'A clause that NAMES its skills is scoped by the NAMES',
    'The game states a DMG increase THREE ways, and the third was unread',
    'A NEGATIVE STATUS\'S OWN DAMAGE is not the wielder\'s, and reading it as such INFLATES',
    '`SkillGenre` is a THIRD enum, and its ordinals are not the damage type\'s',
    'A gauge does not necessarily START empty, and a chain node moves start and cap TOGETHER',
    'A gauge tick is a CLOCK, and the gate withholds the EFFECT not the CLOCK',
    'A missing STATE is not one missing clause, and an aggregate is not a cause',
    'A stack whose applications are RATE-LIMITED belongs on the TARGET, and the limit is per SOURCE SKILL',
    'A tier\'s SECOND grant needs its own group key',
]);
const HISTORY_POINTER = /History: `(docs\/history\/rules\/[\w.-]+\.md)`/;

function invariantRows(text) {
    const rows = [];
    let inTable = false;
    for (const row of text.split(/\r?\n/)) {
        if (row === '| Invariant | Detail |') { inTable = true; continue; }
        if (!inTable || row === '| --- | --- |') continue;
        if (!row.startsWith('| ')) { inTable = false; continue; }
        rows.push({ title: row.slice(2).split(' | ')[0].trim(), row });
    }
    return rows;
}

{
    const instructionFiles = files.filter(file => file === 'CLAUDE.md' || /^\.claude\/(rules|agents|skills)\/.+\.md$/.test(file));
    for (const file of instructionFiles) {
        const struck = read(file).includes('~~');
        if (PENDING_STRIKETHROUGH.has(file)) assert(`${file} has no struck text left: remove it from PENDING_STRIKETHROUGH`, struck);
        else assert(`${file}: no struck-through text (instruction files state current truth; move it to docs/history/rules/)`, !struck);
    }
    for (const file of PENDING_STRIKETHROUGH) assert(`PENDING_STRIKETHROUGH entry ${file} exists`, files.includes(file));
}

{
    const seenTitles = new Set();
    for (const file of ['CLAUDE.md', ...ruleFiles.map(name => `${RULES_DIR}/${name}`)]) {
        for (const { title, row } of invariantRows(read(file))) {
            seenTitles.add(title);
            if (PENDING_LONG_ROWS.has(title)) assert(`"${title}" is condensed: remove it from PENDING_LONG_ROWS`, row.length > MAX_ROW_CHARS);
            else assert(`${file}: "${title}" is at most ${MAX_ROW_CHARS} characters (it is ${row.length}); move its history to docs/history/rules/`, row.length <= MAX_ROW_CHARS);
            const pointer = row.match(HISTORY_POINTER);
            if (!pointer) continue;
            const exists = files.includes(pointer[1]);
            assert(`${file}: "${title}" points to ${pointer[1]}, which exists`, exists);
            assert(`${pointer[1]} has a "## ${title}" section`, exists && read(pointer[1]).split(/\r?\n/).includes(`## ${title}`));
        }
    }
    for (const title of PENDING_LONG_ROWS) assert(`PENDING_LONG_ROWS entry "${title}" exists`, seenTitles.has(title));
}

console.log(`\ninstruction-files: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
