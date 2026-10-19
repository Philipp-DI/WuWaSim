/**
 * The targeted-export manifest must keep listing what the extractors read.
 *
 *   node tests/export-manifest.test.mjs
 *
 * The manifest exists so a game patch needs ~16 MB of FModel export instead of
 * the ~1 GB ConfigDB tree. That saving is only safe while the list is COMPLETE:
 * an extractor that grows a new table, and a manifest that does not mention it,
 * produces a targeted export that silently yields a smaller JSON — a buff that
 * quietly stopped existing, which is this project's recurring failure mode. So
 * the manifest is checked against the extractor sources themselves.
 */
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { selectionRegex } from '../tools/extract/export-selection.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(resolve(here, '../tools/extract/export-manifest.json'), 'utf8'));

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

const extractDir = resolve(here, '../tools/extract');
const sources = readdirSync(extractDir)
    .filter(name => name.endsWith('.py') || name.endsWith('.mjs'))
    .map(name => ({ name, text: readFileSync(resolve(extractDir, name), 'utf8') }));

const listed = new Set(manifest.groups.configdb.paths.map(entry => entry.path.split('/').pop().replace('.db', '')));

// Every db_<X> named in an extractor must be in the manifest. configdb.py is
// excluded as the library: its docstring names db_buff only as a usage example.
const referenced = new Map();
for (const { name, text } of sources) {
    if (name === 'configdb.py') continue;
    for (const match of text.matchAll(/['"](db_[A-Za-z_]+)['"]/g)) {
        if (!referenced.has(match[1])) referenced.set(match[1], new Set());
        referenced.get(match[1]).add(name);
    }
}
for (const [table, users] of referenced) {
    assert(`manifest lists ${table} (read by ${[...users].join(', ')})`, listed.has(table));
}
assert('the manifest found some tables to check at all', referenced.size > 0);

// Every listed table needs its JS accessor, or configdb.py cannot type it.
const accessors = new Set(manifest.groups.accessors.paths.map(entry => entry.path.split('/').pop()));
const ACCESSOR_FOR = {
    db_buff: ['Buff.js'], db_PassiveSkill: ['PassiveSkill.js'],
    db_weapon: ['WeaponConf.js', 'WeaponReson.js'],
    db_phantom: ['PhantomFetter.js', 'PhantomSkill.js'],
    db_damage: ['Damage.js'], db_AbnormalDamage: ['AbnormalDamageConfig.js'],
    db_property: ['PropertyIndex.js'], db_resonate_chain: ['ResonantChain.js'],
};
for (const table of listed) {
    for (const accessor of ACCESSOR_FOR[table] ?? []) {
        assert(`${table} has its accessor ${accessor} listed`, accessors.has(accessor));
    }
}

// The run order must mention every extractor that writes a committed data file,
// so nobody has to reconstruct the sequence from scratch after a patch.
const order = manifest.runOrder.join('\n');
for (const name of ['extract_external_buffs.py', 'extract_gauge_income.py', 'extract_status_damage.py',
    'extract_status_appliers.py', 'extract_abnormal_damage.py', 'extract_affliction_damage.py',
    'extract_buff_facts.py', 'extract_extra_effects.py', 'scan_notify_semantics.mjs']) {
    assert(`run order includes ${name}`, order.includes(name));
}

// preprocess must come FIRST: extract_buff_facts reads data/hit-map.json, which
// preprocess.mjs writes. Getting this backwards reads a stale map.
assert('preprocess runs before extract_buff_facts',
    order.indexOf('preprocess.mjs') < order.indexOf('extract_buff_facts.py'));

// The Arikatsu/nanoka half must stay documented as NOT needing an export — it is
// the reason a version bump is usually cheap.
assert('the manifest records what needs no export at all',
    manifest.notInExport.some(note => note.includes('bindata') && note.includes('nanoka')));

// The FModel Search regex (tools/extract/export-selection.mjs) must select
// exactly the manifest: every listed file and directory, none of their
// neighbours. FModel matches it against the path it lists, which carries the
// "Client/" root, so the test does too.
{
    const assetDirs = ['FemaleXL/Xinyuehu', 'FemaleS/Suoming'];
    const pattern = new RegExp(selectionRegex(manifest, assetDirs), 'i');
    const entries = Object.values(manifest.groups).flatMap(group => group.paths ?? []);
    for (const entry of entries) {
        const sample = entry.kind === 'dir' ? `${entry.path}/AN_Example.js` : entry.path;
        assert(`the selection regex matches ${sample}`, pattern.test(`Client/${sample}`));
    }
    for (const dir of assetDirs) {
        assert(`it matches files under the asset dir ${dir}`,
            pattern.test(`Client/Content/Aki/Character/Role/${dir}/Animation/AM_Attack01.uasset`));
    }
    for (const neighbour of ['Content/Aki/ConfigDB/db_buffeffect.db', 'Content/Aki/ConfigDB/db_damage_text.db',
        'Content/Aki/ConfigDB/db_weapon_visible.db', 'Content/Aki/JavaScript/Game/AnimNotifyEvents/X.js',
        'Content/Aki/Character/Role/FemaleXL/XinyuehuShen/AM_Attack01.uasset',
        'Content/Aki/JavaScript/Core/Define/Config/BuffEffect.js']) {
        assert(`it does not match the neighbour ${neighbour}`, !pattern.test(`Client/${neighbour}`));
    }
    assert('a second asset dir is its own entry, not a prefix match',
        new RegExp(selectionRegex(manifest, ['FemaleXL/XinyuehuShen']), 'i')
            .test('Client/Content/Aki/Character/Role/FemaleXL/XinyuehuShen/AM_Attack01.uasset'));
}

console.log(`\nexport-manifest: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
