/**
 * PROVENANCE LEDGER — every number in the engine that is not extracted data.
 *
 *   node tests/provenance.test.mjs
 *
 * WHY THIS EXISTS. The standing rule is that extracted game data is the single
 * source of truth, and that a number which is neither in the data nor
 * maintainer-verified must be surfaced rather than quietly relied on. Nothing
 * enforced that. Every audit so far has begun by re-deriving, from scratch,
 * which constants are real and which are placeholders — and the answer lived
 * only in comments, which no run checks.
 *
 * WHAT IT DOES. A scanner finds every module-level numeric parameter in
 * src/core — a bare number, or an object literal whose every value is a number
 * — and requires each one to be REGISTERED below with a status and a reason.
 * Three things then fail the run:
 *
 *   1. A new numeric parameter that nobody classified.
 *   2. A registered constant that vanished or was renamed.
 *   3. A registered constant whose VALUE moved. The fingerprint is the sorted
 *      list of numbers in its initializer, so retuning 0.55 → 0.60 inside a map
 *      fails even though the shape is unchanged.
 *
 * THE RATCHET. `invented` + `assumed` may only shrink (RATCHET below). That is
 * the number this file exists to drive down; the others are here for the audit
 * trail, not as debt.
 *
 * STATUSES, strictest first:
 *   game        the game states it — a rule, an attribute id, a cap.
 *   verified    maintainer-confirmed in game, but not present in the extract.
 *   derived     computed from measured/extracted data (a median, a fallback
 *               that real data supersedes everywhere).
 *   convention  a deliberate modelling choice the maintainer has ruled on. It
 *               is not a claim about the game, so it cannot be "wrong" — but it
 *               must be stated once and shared, never re-invented per module.
 *   technical   epsilons, schema versions, enum tables. Not model parameters.
 *   assumed     stated as probable and NOT confirmed. Counts against the ratchet.
 *   invented    a plausible placeholder with no cited source. The real debt.
 *
 * SCOPE LIMIT, stated plainly: this covers NAMED module-level constants. A bare
 * numeric literal inside a function body is not caught. Named constants are the
 * project's convention for model parameters, so this is where they live — but
 * the ledger is a floor on what is known, not a proof that nothing else exists.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

// ── The ledger ───────────────────────────────────────────────────────────────
// `why` is the entry's justification, in the terms the status demands: for
// `game`/`verified` it names the source, for `invented` it says what would
// replace it.
const REGISTRY = [
    // ── invented: no cited source. THIS IS THE DEBT. ─────────────────────────
    { file: 'src/core/sim.js', name: 'HARDCODED_STEP_DURATIONS', values: [0.55, 0.6, 0.8, 0.8, 1, 1.2, 1.3, 1.4, 1.6, 1.8], status: 'invented',
      why: 'Per-skill-type fallback animation lengths, its own comment saying "tuned to roughly match in-game animation lengths". Reached by the ~11% of curated-rotation steps that report timingSource "estimated"; the other 88% carry a measured duration. Replaced by finishing the timing extraction.' },
    { file: 'src/core/sim.js', name: 'ECHO_CAST_TIME', values: [1.2], status: 'invented',
      why: '"Typical echo-skill animation length". Every echo cast in every rotation uses it — there is no measured echo timing at all (OPEN-ITEMS 23, wants the Monster-tree export).' },
    { file: 'src/core/team-sim.js', name: 'OUTRO_CAST_TIME', values: [1], status: 'invented',
      why: 'Time allotted to the Outro animation. Every swap in every team sim pays it, and it sits in the DPS denominator. No measurement behind it.' },
    { file: 'src/core/team-energy.js', name: 'OFF_FIELD_SHARE', values: [0.5], status: 'invented',
      why: 'Fraction of an on-field cast\'s Resonance energy credited to off-field members. Feeds erModel and every minimum-viable-ER figure. The module documents its algebra carefully and says nothing about where 0.5 came from.' },
    { file: 'src/core/substat-allocate.js', name: 'FLAT_ROLL', values: [45, 55, 470], status: 'invented',
      why: 'Flat ATK/HP/DEF magnitudes for "one mid roll", stated as matching the template package rather than the game\'s roll table. data/stat-ranges.json holds the real discrete rolls for every other stat.' },
    { file: 'src/core/stat-priority.js', name: 'DEFAULT_ROLL_VALUE', values: [9], status: 'invented',
      why: 'Defensive floor for a roll key with no range data. Its own comment says it should be unreachable once statRanges is loaded — so the honest fix is to fail loudly instead of substituting a number.' },
    { file: 'src/core/stat-ranking.js', name: 'ANCHOR_FAR_THRESHOLD', values: [0.5], status: 'invented',
      why: 'Distance past which a build gets the "your priorities may differ" caveat, "tuned so a roughly-endgame build clears it". UI copy only — it moves no damage — but it is still a chosen number.' },

    // ── assumed: stated as probable, not confirmed. Also debt. ───────────────
    { file: 'src/core/enemy-status.js', name: 'TUNE_AMP', values: [16], status: 'assumed',
      why: 'Tune Break damage AMP, carried as universal on the maintainer\'s "most likely a constant". Scales every Tune Break number in the app. Confirming or replacing it is a single in-game measurement.' },
    { file: 'src/core/enemy-status.js', name: 'NS_LEVEL_MODIFIER', values: [716.22, 716.22, 3674], status: 'assumed',
      why: 'The VALUES are pinned (glacio_chafe 3674 by three worked examples, tune 716.22 maintainer-confirmed). What is assumed is the SCOPE: the file states the modifier is "ASSUMED to also hold for other inflicters of the same status until disproven".' },

    // ── verified: maintainer-confirmed, absent from the extract ──────────────
    { file: 'src/core/sim.js', name: 'HARDCODED_FREEZE_FRACTIONS', values: [1], status: 'verified',
      why: 'A Liberation freezes its whole animation — maintainer-confirmed 2026-07-23 (docs/TIMING_MODEL.md). Most Liberations now carry a measured freeze instead; this covers what extraction could not reach.' },
    { file: 'src/core/enemy-status.js', name: 'ENEMY_TYPE_MULTIPLIER', values: [1, 3, 14, 14], status: 'verified',
      why: 'Enemy class → Tune Break multiplier, maintainer-confirmed; the overlord 14 matches the one verified worked example.' },

    // ── derived: computed from measured data ─────────────────────────────────
    { file: 'src/core/sim.js', name: 'TUNE_BREAK_CAST_TIME', values: [1.51], status: 'derived',
      why: 'The measured median of the 56/56 extracted Tune Break animations, reached only by a caller holding no resonator.' },

    // ── convention: a maintainer-ruled modelling choice ──────────────────────
    { file: 'src/core/target.js', name: 'DEFAULT_ENEMY_LEVEL', values: [90], status: 'convention',
      why: 'The ToA convention the whole app reports against. core/target.js exists precisely so this is defined once — the app previously shipped two different enemies.' },
    { file: 'src/core/target.js', name: 'DEFAULT_ENEMY_RES', values: [0.1], status: 'convention',
      why: '10% elemental RES, the value every UI surface has always used. A reporting baseline, not a claim about any specific enemy.' },

    // ── game: the game states it ─────────────────────────────────────────────
    { file: 'src/core/team-sim.js', name: 'CONCERTO_MAX', values: [100], status: 'game',
      why: 'The Concerto (swap) gauge is 100.' },
    { file: 'src/core/echo-rules.js', name: 'COST_BUDGET', values: [12], status: 'game',
      why: 'Echo cost budget per build.' },
    { file: 'src/core/echo-rules.js', name: 'MAX_ECHO_LEVEL', values: [25], status: 'game', why: 'An echo levels to 25, which is what every build in the app equips.' },
    { file: 'src/core/echo-rules.js', name: 'ECHO_LEVEL_STEP', values: [5], status: 'game', why: 'Echoes gain a substat every 5 levels.' },
    { file: 'src/core/build.js', name: 'ECHO_SLOTS', values: [5], status: 'game', why: 'Five echo slots per build.' },
    { file: 'src/core/team.js', name: 'TEAM_SLOTS', values: [3], status: 'game', why: 'Three members per team.' },
    { file: 'src/core/stat-priority.js', name: 'MAIN_STAT_ROLL_VALUE', values: [30], status: 'game',
      why: 'A cost-4 echo\'s element DMG main stat is 30%.' },
    { file: 'src/core/buffs/external-buffs.js', name: 'DERIVED_SOURCE_DEFAULTS', values: [10000], status: 'game',
      why: 'Off-Tune Buildup Rate reads 10000 (100%) on all 2,740 baseproperty rows — see the CLAUDE.md invariant on attribute 141.' },

    // ── technical: enum tables, ids, epsilons, schema versions ───────────────
    { file: 'src/core/stats.js', name: 'PROP', values: [0, 2, 7, 8, 9, 10, 11, 14, 17, 18, 19, 21, 21, 35, 10002, 10007, 10010], status: 'technical',
      why: 'The game\'s own property ids.' },
    { file: 'src/core/buffs/external-buffs.js', name: 'CALCULATION_POLICY', values: [0, 1, 5, 6, 7], status: 'technical',
      why: 'Slot indices into the game\'s CalculationPolicy array.' },
    { file: 'src/core/buffs/external-buffs.js', name: 'DERIVED_SOURCE', values: [11, 141, 142], status: 'technical',
      why: 'The game\'s attribute ids for the derived-magnitude sources.' },
    { file: 'src/core/buffs/external-buffs.js', name: 'ELEMENT_DMG_BASE', values: [21], status: 'technical', why: 'Attribute-id base for per-element DMG bonus.' },
    { file: 'src/core/buffs/external-buffs.js', name: 'ELEMENT_RES_BASE', values: [28], status: 'technical', why: 'Attribute-id base for per-element resistance.' },
    { file: 'src/core/buffs/external-buffs.js', name: 'ELEMENT_RES_IGNORE_BASE', values: [100], status: 'technical', why: 'Attribute-id base for per-element RES ignore.' },
    { file: 'src/core/buffs/external-buffs.js', name: 'SCALE_BASE_POLICY', values: [9], status: 'technical', why: 'CalculationPolicy mode 9 (scale base).' },
    { file: 'src/core/buffs/conditional-buffs.js', name: 'ELEMENT_NAMES', values: [1, 2, 3, 4, 5, 6], status: 'technical', why: 'Element name → the game\'s element id.' },
    { file: 'src/core/buffs/sonata-buffs.js', name: 'ELEMENT_NAMES', values: [1, 2, 3, 4, 5, 6], status: 'technical', why: 'Element name → the game\'s element id.' },
    { file: 'src/core/buffs/weapon-buffs.js', name: 'ELEMENT_NAMES', values: [1, 2, 3, 4, 5, 6], status: 'technical', why: 'Element name → the game\'s element id.' },
    { file: 'src/core/enemy-status.js', name: 'ELEMENT_ID_BY_NAME', values: [1, 2, 3, 4, 5, 6], status: 'technical', why: 'Element name → the game\'s element id.' },
    { file: 'src/core/enemy-status.js', name: 'EVENT_ORDER', values: [0, 1, 2, 2], status: 'technical',
      why: 'Explicit ordering for same-instant status events — see the CLAUDE.md invariant on why an epsilon offset cannot encode this.' },
    { file: 'src/core/build.js', name: 'BUILD_VERSION', values: [2], status: 'technical', why: 'Saved-build schema version.' },
    { file: 'src/core/buffs/buff-timeline.js', name: 'EPS', values: [0.000001], status: 'technical', why: 'Float comparison epsilon.' },
    { file: 'src/core/cooldowns.js', name: 'EPS', values: [0.000001], status: 'technical', why: 'Float comparison epsilon.' },
    { file: 'src/core/opener.js', name: 'EPS', values: [0.000001], status: 'technical', why: 'Float comparison epsilon.' },
    { file: 'src/core/target-stacks.js', name: 'EPS', values: [0.000001], status: 'technical', why: 'Float comparison epsilon.' },
    { file: 'src/core/stat-priority.js', name: 'NEAR_ZERO', values: [0.000001], status: 'technical', why: 'Weights below this are treated as zero.' },
];

// The ratchet. Lower it when a number moves out of `invented`/`assumed`; never
// raise it to make a run pass — a new placeholder is exactly what this catches.
const RATCHET = 9;

const STATUSES = new Set(['game', 'verified', 'derived', 'convention', 'technical', 'assumed', 'invented']);

// ── Scanner ──────────────────────────────────────────────────────────────────
function walk(dir, out = []) {
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path, out);
        else if (name.endsWith('.js')) out.push(path);
    }
    return out;
}

/** The const's initializer text: everything up to the `;` at brace depth 0. */
function initializerAt(source, from) {
    let depth = 0;
    for (let i = from; i < source.length; i++) {
        const char = source[i];
        if (char === '{' || char === '(' || char === '[') depth++;
        else if (char === '}' || char === ')' || char === ']') depth--;
        else if (char === ';' && depth === 0) return source.slice(from, i);
    }
    return source.slice(from);
}

const NUMBER_RE = /^-?\d+(?:\.\d+)?(?:e-?\d+)?$/i;
const stripComments = (text) => text.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

/** 'scalar' | 'numericMap' | null — is this a numeric MODEL parameter? */
function numericShape(raw) {
    let body = stripComments(raw).trim().replace(/^Object\.freeze\(([\s\S]*)\)$/, '$1').trim();
    if (NUMBER_RE.test(body)) return 'scalar';
    const asObject = body.match(/^\{([\s\S]*)\}$/);
    if (!asObject) return null;
    const inner = asObject[1].trim();
    if (!inner) return null;
    const values = [];
    for (const pair of inner.split(',').map(part => part.trim()).filter(Boolean)) {
        const keyed = pair.match(/^(?:'[^']*'|"[^"]*"|\[[^\]]*\]|[A-Za-z_$][\w$]*)\s*:\s*(.+)$/);
        if (!keyed) return null;
        values.push(keyed[1].trim());
    }
    return values.every(value => NUMBER_RE.test(value)) ? 'numericMap' : null;
}

const fingerprint = (raw) =>
    (stripComments(raw).match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/gi) ?? []).map(Number).sort((left, right) => left - right);

const scanned = [];
for (const path of walk(resolve(ROOT, 'src/core'))) {
    const source = readFileSync(path, 'utf8');
    const file = path.slice(ROOT.length + 1).replace(/\\/g, '/');
    const declaration = /^(?:export )?const ([A-Z][A-Z0-9_]*)\s*=\s*/gm;
    let match;
    while ((match = declaration.exec(source)) !== null) {
        const raw = initializerAt(source, match.index + match[0].length);
        if (!numericShape(raw)) continue;
        scanned.push({ file, name: match[1], values: fingerprint(raw) });
    }
}

// ── 1. Ledger hygiene ────────────────────────────────────────────────────────
{
    assert('every entry has a known status', REGISTRY.every(entry => STATUSES.has(entry.status)));
    assert('every entry states a reason', REGISTRY.every(entry => typeof entry.why === 'string' && entry.why.length > 20));
    const keys = REGISTRY.map(entry => `${entry.file}::${entry.name}`);
    assert('no duplicate ledger entries', new Set(keys).size === keys.length);
    assert('the scan found something (the scanner itself still works)', scanned.length > 20);
}

// ── 2. Nothing unclassified, nothing vanished, nothing silently retuned ──────
{
    const byKey = new Map(REGISTRY.map(entry => [`${entry.file}::${entry.name}`, entry]));
    const seen = new Set();
    const unregistered = [];
    const moved = [];
    for (const found of scanned) {
        const key = `${found.file}::${found.name}`;
        seen.add(key);
        const entry = byKey.get(key);
        if (!entry) { unregistered.push(`${key} = [${found.values.join(', ')}]`); continue; }
        if (entry.values.join(',') !== found.values.join(',')) {
            moved.push(`${key}: ledger [${entry.values.join(', ')}] vs source [${found.values.join(', ')}]`);
        }
    }
    assert(`no unclassified numeric parameter (${unregistered.join(' | ') || 'none'})`, unregistered.length === 0);
    assert(`no ledger value drifted from source (${moved.join(' | ') || 'none'})`, moved.length === 0);
    const gone = [...byKey.keys()].filter(key => !seen.has(key));
    assert(`no ledger entry lost its constant (${gone.join(', ') || 'none'})`, gone.length === 0);
}

// ── 3. THE RATCHET ───────────────────────────────────────────────────────────
{
    const debt = REGISTRY.filter(entry => entry.status === 'invented' || entry.status === 'assumed');
    assert(`invented + assumed is ${debt.length}, ratchet ${RATCHET} — may only shrink`, debt.length <= RATCHET);
    assert('the ratchet is not set above the real count (it would stop catching new ones)', RATCHET <= debt.length);
}

// ── Report ───────────────────────────────────────────────────────────────────
const tally = {};
for (const entry of REGISTRY) tally[entry.status] = (tally[entry.status] ?? 0) + 1;
console.log(`  ledger: ${REGISTRY.length} numeric parameters — `
    + Object.entries(tally).sort((left, right) => right[1] - left[1]).map(([status, count]) => `${status} ${count}`).join(', '));

console.log(`provenance: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
