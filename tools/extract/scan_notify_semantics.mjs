#!/usr/bin/env node
/**
 * Authoritative notify inventory, read from the game's own shipped JavaScript.
 *
 *   node tools/extract/scan_notify_semantics.mjs <exportRoot> [--json out.json]
 *
 * The client ships every `Ts*` notify class as minified JS under
 * `Content/Aki/JavaScript/Game/AnimNotify{,State}/`. Each class implements
 * `GetNotifyName()` returning the designer-facing Chinese label, which states
 * what the notify actually DOES. That label — not the class name — is the
 * authority.
 *
 * Misreadings that came from inferring semantics off a class name:
 *   - `TsAnimNotifyStateAbsoluteTimeStop` sounded like the sim's freeze; its
 *     label is "动画和子弹冻结" (animation + bullet only) and it stops no clock.
 *   - `TsAnimNotifyStateSoftLock` sounded like an action/commitment lock; it is
 *     "开启镜头软锁" — CAMERA lock-on, gameplay-irrelevant. The real commitment
 *     data is DT_SkillInfo.InterruptLevel + TsAnimNotifyChangeSkillPriority
 *     ("修改技能优先级", body calls SetSkillPriority).
 *   - `TsAnimNotifyStateChangeSlot` is "切换组件到指定插槽" (attach a sub-mesh to a
 *     socket), so the MECHANISM is cosmetic — but reading only that far was also
 *     a mistake: which prop it attaches is a faithful SIGNAL of a weapon/stance
 *     change (Rebecca's two Intros target WeaponProp01 pistol vs WeaponProp02
 *     shotgun). A cosmetic mechanism can still be the best available marker.
 *
 * So this reports, per class: the label, the declared properties (the fields a
 * designer can set), and which of them the notify body actually READS. That
 * last column is what caught AbsoluteTimeStop's three dead properties.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'fs';
import { resolve, join } from 'path';

const root = process.argv[2];
if (!root) {
    console.error('usage: node scan_notify_semantics.mjs <exportRoot> [--json out.json]');
    process.exit(2);
}
const jsonIndex = process.argv.indexOf('--json');
const jsonOut = jsonIndex > 0 ? process.argv[jsonIndex + 1] : null;

const base = resolve(root, 'Content/Aki/JavaScript/Game');
const dirs = ['AnimNotify', 'AnimNotifyState'];

// `this.Foo=void 0` in the constructor declares an editable property.
const DECLARED = /this\.([A-Za-z_一-鿿][\w一-鿿]*)\s*=\s*void 0/g;
// `this.Foo` anywhere outside that constructor line is a real read.
const USED = /this\.([A-Za-z_一-鿿][\w一-鿿]*)/g;
const NAME = /GetNotifyName\(\)\s*\{\s*return\s*"([^"]*)"/;
// Calls that reveal what subsystem the notify touches.
const CALLS = /(?:\.|\b)([A-Z][A-Za-z0-9_]{3,})\s*\(/g;

const rows = [];
for (const dir of dirs) {
    const path = join(base, dir);
    if (!existsSync(path)) { console.error(`missing: ${path}`); continue; }
    for (const file of readdirSync(path)) {
        if (!file.endsWith('.js')) continue;
        const src = readFileSync(join(path, file), 'utf8');
        const cls = file.replace(/\.js$/, '');

        const label = (src.match(NAME) ?? [])[1] ?? null;

        const declared = new Set();
        for (const match of src.matchAll(DECLARED)) declared.add(match[1]);

        // Strip the constructor's declaration run before counting reads, so a
        // property that is only ever declared shows up as unused (dead).
        const body = src.replace(/this\.[A-Za-z_一-鿿][\w一-鿿]*\s*=\s*void 0\s*,?/g, '');
        const used = new Set();
        for (const match of body.matchAll(USED)) if (declared.has(match[1])) used.add(match[1]);

        const calls = new Set();
        for (const match of src.matchAll(CALLS)) calls.add(match[1]);

        rows.push({
            notify: cls,
            kind: dir === 'AnimNotifyState' ? 'state' : 'instant',
            label,
            declared: [...declared],
            used: [...used],
            dead: [...declared].filter(prop => !used.has(prop)),
            calls: [...calls].filter(call => !/^(Notify|Constructor|GetNotifyName|GetOwner|K2_Notify|K2_NotifyBegin|K2_NotifyEnd|K2_NotifyTick|Object|String|Number)$/.test(call)).slice(0, 12),
            bytes: src.length,
        });
    }
}
rows.sort((left, right) => left.notify.localeCompare(right.notify));

if (jsonOut) {
    writeFileSync(jsonOut, JSON.stringify({
        _meta: {
            source: `${base} (shipped client JavaScript)`,
            generatedAt: new Date().toISOString(),
            note: 'GetNotifyName() is the designer-facing label and the authority on what a notify does. `dead` lists declared-but-never-read properties — do not classify on those.',
            count: rows.length,
        },
        notifies: rows,
    }, null, 1));
    console.error(`wrote ${jsonOut} (${rows.length} notify classes)`);
}

const filter = process.argv.find(arg => arg.startsWith('--grep='));
const pattern = filter ? new RegExp(filter.slice(7), 'i') : null;
for (const row of rows) {
    if (pattern && !pattern.test(row.notify) && !pattern.test(row.label ?? '')) continue;
    console.log(`${row.notify}  [${row.kind}]`);
    console.log(`    label   ${row.label ?? '(none — abstract/base?)'}`);
    if (row.declared.length) console.log(`    props   ${row.used.join(', ') || '(none read)'}${row.dead.length ? `   DEAD: ${row.dead.join(', ')}` : ''}`);
    if (row.calls.length) console.log(`    calls   ${row.calls.join(', ')}`);
}
console.error(`\n${rows.length} notify classes scanned`);
