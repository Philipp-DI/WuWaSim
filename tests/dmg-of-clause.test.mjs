/**
 * "increases the DMG of X by N%" — the third phrasing of a DMG increase
 * (2026-10-04).
 *
 *   node tests/dmg-of-clause.test.mjs
 *
 * The game states a DMG increase three ways and only two were read. "X deals N%
 * more DMG" has its own branch, "N% DMG Bonus" has the bonus branches, and
 * "increases the DMG of X by N%" had NOTHING — no "amplif", no "DMG Bonus", and
 * not the deals-more shape. Three clauses roster-wide state it and all three were
 * silently unread.
 *
 * THE LARGEST WAS ALREADY ANSWERED BY THE GAME'S OWN DATA, which is what made the
 * gap worth closing rather than curating: Xiangli Yao S3's "+63% to the following
 * Resonance Skill moves" sat on a node holding ZERO effects, while
 * `buff-facts.json` had already filed both its bucket (`additive`) AND its exact
 * four-key scope under the value 0.63 — one of the orphaned ConfigDB scopes that
 * nothing joined. Emitting the effect is all it took for the data to land on it,
 * because `applyBuffFacts` runs BEFORE `bindSkillScopes`. Measured +34.34% on his
 * own reference rotation at S3.
 *
 * TWO BLOCKERS HAD TO GO, and the second was one character. The parser had no
 * branch for the shape; and `bindSkillScopes` could not scope what it emitted,
 * because `OF_TAIL_FORM` reads the names with `[^.;]` and so CANNOT CROSS THE
 * DECIMAL POINT in the clause's own "1.5%". `OF_BY_FORM` stops at the stated value
 * instead of at the end of the clause, which also means it needs no
 * `trimNameTail` — the capture never includes the tail.
 *
 * `dmgBonus` is the DEFAULT bucket and not a reading of the sentence: which bucket
 * a value lands in is not recoverable from wording (CLAUDE.md), so buff-facts
 * corrects it from the game's tables. `needsScope` is the last gate — an unscoped,
 * always-on DMG bonus is inflation, and these clauses carry their conditions in
 * prose the classifier does not read.
 *
 * THE CEILING→COUNT DERIVATION IS DELIBERATELY NARROW. "up to 60%" at 1.5% per
 * point is 40, which is exactly Afterflame's own cap, so the kit states one limit
 * twice and the division is a cross-check. But EXACT DIVISION IS NOT ENOUGH:
 * Jingran's "For every 1000 points of Max HP … 0.05% …, up to 2.5% FOR EACH STACK"
 * also divides tidily, to 50, and 50 is not a stack count at all — it is how many
 * 1000-HP units fit under a per-stack ceiling. Measured: the unrestricted version
 * set his cap to 50. So the derivation only runs for a RESOURCE shape, where the
 * counted thing is the gauge the clause itself names.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { ceilingStacks, PER_RESOURCE_HELD_RE, parseEffectsFromDesc } from '../tools/preprocess/effects.mjs';
import { targetNamesInClause, resolveNameToKeys } from '../tools/preprocess/skill-scope.mjs';
import { stateDefsForResonator } from '../src/core/rotation-rules.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataset = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));
const buffFacts = JSON.parse(readFileSync(resolve(__dirname, '../data/buff-facts.json'), 'utf8')).facts;

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

// ── The binder form: bounded by the value, not by the clause end ────────────
{
    const keysOf = (rid) => Object.keys(dataset.autoSkillMap[String(rid)] ?? {});

    // Galbrena's Forte clause — five bracketed names, and a decimal in its own value.
    const galbrena = 'While in [Demon Hypostasis], every point of [Afterflame] increases the DMG of '
        + '[Basic Attack - Seraphic Execution], [Heavy Attack - Flamewing Verdict], '
        + '[Mid-air Attack - Hellsent Barrage], [Resonance Skill - Ravage], and '
        + '[Dodge Counter - Purgatory Scourge] by 1.5%, up to 60%, which is removed upon exiting '
        + '[Demon Hypostasis].';
    const names = targetNamesInClause(galbrena, 'dmgBonus');
    assert(`her five names are read (got ${names.length})`, names.length === 5);
    const bound = [...new Set(names.flatMap(name => resolveNameToKeys(name, keysOf(1208))))];
    assert(`they resolve to her eleven keys (got ${bound.length})`, bound.length === 11);
    assert('and every one is a real key of hers',
        bound.every(key => dataset.autoSkillMap['1208'][key]));
    // The decimal point is the whole reason the older form failed; keep a case
    // with no decimal too, so the new form is not accidentally decimal-specific.
    const whole = 'Casting X increases the DMG of Runic Outburst by 30% for 10s.';
    assert('a whole-number value reads the same way',
        JSON.stringify(targetNamesInClause(whole, 'dmgBonus')) === JSON.stringify(['Runic Outburst']));

    // Mortefi — "the next <name>" still resolves, the noise words being stripped.
    const mortefi = 'During Resonance Liberation Burning Rhapsody, each hit of Resonance Liberation '
        + 'Marcato will increase the DMG of the next Resonance Liberation Marcato by 1.5%, which can '
        + 'be triggered once every 0.35s, stacking up to 50 times.';
    assert('Mortefi resolves to his Marcato',
        JSON.stringify(resolveNameToKeys(targetNamesInClause(mortefi, 'dmgBonus')[0] ?? '', keysOf(1204)))
            === JSON.stringify(['liberation_marcato_damage']));

    // It must NOT swallow the multiplierUp lane: "the DMG Multiplier of X" keeps
    // its own forms, because `the DMG of` needs DMG and `of` adjacent.
    const multiplier = 'The DMG Multiplier of Resonance Liberation Unmovable is increased by 50%.';
    const viaMultiplier = targetNamesInClause(multiplier, 'multiplierUp');
    assert('a DMG Multiplier clause still reads its own name',
        viaMultiplier.length === 1 && /Unmovable/.test(viaMultiplier[0]));
}

// ── ceilingStacks: exact division only, and only where it means a count ─────
{
    assert('60% at 1.5% per unit is 40', ceilingStacks('… by 1.5%, up to 60% …', 0.015) === 40);
    assert('35% at 0.875% per unit is 40', ceilingStacks('… up to 35% …', 0.00875) === 40);
    assert('a ceiling that does not divide exactly returns null',
        ceilingStacks('… by 1.5%, up to 55% …', 0.015) === null);
    assert('no ceiling returns null', ceilingStacks('… by 1.5% …', 0.015) === null);
    assert('a zero or absent per-unit returns null',
        ceilingStacks('up to 60%', 0) === null && ceilingStacks('up to 60%', undefined) === null);
    // A ceiling equal to the per-unit value is one "stack" — not a cap worth
    // asserting, and treating it as one would claim a limit the kit never stated.
    assert('a ceiling equal to the per-unit value is not a cap',
        ceilingStacks('… by 1.5%, up to 1.5% …', 0.015) === null);
}

// ── The HELD resource shape, and the bracket that makes it safe ─────────────
{
    assert('it reads a bracketed gauge',
        PER_RESOURCE_HELD_RE.exec('every point of [Afterflame] increases')?.[1] === 'Afterflame');
    assert('"each point of" reads too',
        PER_RESOURCE_HELD_RE.exec('each point of [Afterflame] grants')?.[1] === 'Afterflame');
    // THE BRACKET IS THE DISCRIMINATOR — these three are STATS, not gauges, and
    // sweeping them in would attach a resource stackTrigger to an attribute.
    assert('an unbracketed stat is refused: Max HP',
        !PER_RESOURCE_HELD_RE.test('For every 1000 points of Max HP, Jingran gains'));
    assert('an unbracketed stat is refused: Tune Break Boost',
        !PER_RESOURCE_HELD_RE.test('every 10 points of Tune Break Boost he has'));
}

// ── Live dataset: exactly the three clauses, each with its own outcome ──────
{
    const effectAt = (rid, lane, ni, ei) => dataset.resonators
        .find(entry => entry.id === rid)?.[lane]?.[ni]?.effects?.[ei] ?? null;

    // Xiangli Yao: the game supplied bucket AND scope once an effect existed.
    const yao = effectAt(1305, 'resonanceChain', 2, 0);
    assert('Xiangli Yao S3 now carries an effect at all', !!yao);
    assert('…worth 63%, in the additive bucket the game states',
        yao?.stat === 'dmgBonus' && Math.abs(yao.value - 0.63) < 1e-9);
    assert('…scoped by the GAME, not by the text',
        yao?.scopeSource === 'configdb' && yao.skillKeys?.length === 4);
    assert('…and buff-facts really is where that scope comes from',
        JSON.stringify(buffFacts['1305']?.['0.63']?.scopeByFamily?.damage?.slice().sort())
            === JSON.stringify(yao.skillKeys.slice().sort()));
    assert('it is NOT stackable — "triggered up to 5 times" is a usage cap, not stacks',
        !yao?.stackable);

    // Galbrena: the per-point HELD shape, scoped by name, capped by the ceiling.
    const galbrena = effectAt(1208, 'skillNodeEffects', 1, 0);
    assert('Galbrena\'s Forte clause now carries an effect',
        galbrena?.stat === 'dmgBonus' && Math.abs(galbrena.perStack - 0.015) < 1e-9);
    assert('…reading Afterflame HELD',
        galbrena?.stackTrigger?.type === 'resource'
        && galbrena.stackTrigger.resource === 'Afterflame' && !galbrena.stackTrigger.consumed);
    assert('…capped at 40, which is the gauge\'s own cap stated a second way',
        galbrena?.maxStacks === 40);
    assert('…scoped to her eleven Demon Hypostasis keys', galbrena?.skillKeys?.length === 11);
    // Gated on the state its own clause names — and she has NO STATE_DEFS entry,
    // so it resolves OFF. That hold is deliberate: the clause and its scope are
    // landed and verified (8 Afterflame is +6.74% on one pass, 24 is +12.22%), but
    // enabling the state made her geared meta team rise 30.61%, implying a gauge
    // near its cap of 40 for reasons measurement has not yet accounted for. See
    // the struck-through STATE_DEFS note in rotation-rules.js.
    assert('…and gated on the state its clause names',
        /demon hypostasis/i.test(JSON.stringify(galbrena?.window ?? '')));
    assert('that state is NOT modelled, so the effect is held OFF for now',
        stateDefsForResonator(1208).length === 0);

    // Mortefi: correctly scoped and deliberately OFF — his stack source is a HIT
    // count, which nothing models, so one stack understates rather than asserting
    // the 50 the clause allows.
    const mortefi = effectAt(1204, 'inherentSkills', 1, 0);
    assert('Mortefi\'s clause is read and bound to his Marcato',
        mortefi?.stat === 'dmgBonus' && JSON.stringify(mortefi.skillKeys) === '["liberation_marcato_damage"]');
    assert('…and is not stackable, because a hit count is not modelled',
        !mortefi?.stackable);

    // THE GUARD: Jingran must NOT have gained a cap of 50 from his per-stack
    // ceiling. This is the regression the narrowed derivation exists for.
    const jingran = effectAt(1212, 'skillNodeEffects', 0, 0);
    assert('Jingran keeps no derived cap — his ceiling is PER STACK, not a count',
        jingran?.maxStacks == null);
    assert('…and he is still stackable with his own per-stack value',
        jingran?.stackable === true && Math.abs(jingran.perStack - 0.0005) < 1e-9);
}

// ── Nothing unscoped slipped through ───────────────────────────────────────
{
    // Every effect this branch emits carries `needsScope`, so the binder either
    // scoped it or dropped it. An unscoped survivor would be an always-on DMG
    // bonus on the whole kit.
    const SHAPE = /increases?\s+the\s+DMG\s+of\s+/i;
    const unscoped = [];
    for (const resonator of dataset.resonators) {
        for (const nodes of [resonator.resonanceChain, resonator.inherentSkills, resonator.skillNodeEffects]) {
            for (const node of nodes ?? []) {
                for (const effect of node.effects ?? []) {
                    if (effect.stat !== 'dmgBonus' || !SHAPE.test(node.desc ?? '')) continue;
                    if (!effect.skillKeys?.length && !effect.teamWide) {
                        unscoped.push(`${resonator.id} ${effect.value}`);
                    }
                }
            }
        }
    }
    assert(`no "increases the DMG of" effect survives unscoped (${unscoped.join(', ') || 'none'})`,
        unscoped.length === 0);
    assert('needsScope is stripped once the binder has run',
        dataset.resonators.every(resonator => [resonator.resonanceChain, resonator.inherentSkills,
            resonator.skillNodeEffects].every(nodes => (nodes ?? []).every(node =>
            (node.effects ?? []).every(effect => effect.needsScope === undefined)))));
}

// ── The parser emits all three from their own descriptions ──────────────────
{
    const parsed = parseEffectsFromDesc('Casting Resonance Liberation Cogitation Model increases the '
        + 'DMG of the following Resonance Skill moves by 63% for 24s: Decipher, Deduction, '
        + 'Divergence, and Law of Reigns. This effect can be triggered up to 5 times.');
    const bonus = parsed.find(effect => effect.stat === 'dmgBonus');
    assert('parse: the clause emits a dmgBonus', !!bonus);
    assert('parse: at the stated 63%', Math.abs((bonus?.value ?? 0) - 0.63) < 1e-9);
    assert('parse: carrying needsScope, so an unscopable one is dropped', bonus?.needsScope === true);
}

console.log(`\ndmg-of-clause: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
