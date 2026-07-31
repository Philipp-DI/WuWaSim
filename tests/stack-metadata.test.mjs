/**
 * Stack metadata: description-scoped cap + gain-trigger recovery
 * (tools/preprocess/effects.mjs descStackCap / descStackGain), 2026-07-31.
 *
 * The game authors a stack's CAP and its GAIN TRIGGER in the sentence that
 * GRANTS the stack, while the per-stack VALUE lives in a later "Each stack …"
 * sentence. The parser used to read both from the value clause alone, so 11 of
 * 14 stackable effects shipped with `maxStacks: null` (silently credited ONE
 * stack) and 13 with an unknown stack trigger.
 *
 * Runs against the real compiled dataset — the unit assertions below pin the
 * two resolvers' refusal rules, the live ones pin the roster-wide outcome.
 *
 *   node tests/stack-metadata.test.mjs
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { descStackCap, descStackGain, parseEffectsFromDesc } from '../tools/preprocess/effects.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataset = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

// Every stackable effect in the dataset, keyed "<resonatorId> <slotKey>".
const stackables = new Map();
for (const resonator of dataset.resonators) {
    const visit = (node, prefix) => (node.effects ?? []).forEach((effect, i) => {
        if (effect.stackable) stackables.set(`${resonator.id} ${prefix}.${i}`, { effect, resonator });
    });
    for (const chain of resonator.resonanceChain ?? []) visit(chain, `S${chain.level}`);
    (resonator.inherentSkills ?? []).forEach((node, nodeIndex) => visit(node, `IH${nodeIndex}`));
}

// ── descStackCap: reads across clauses, refuses to guess ─────────────────────
{
    assert('cap from a sibling clause ("stackable up to 4 times." / "Each stack …")',
        descStackCap(['When casting Resonance Skill X, gain 1 stack of Sky Blue, stackable up to 4 times, lasting for 7s.',
            "Each stack increases Youhu's Crit. DMG by 15%."]) === 4);

    assert('cap from the "up to N stacks" phrasing',
        descStackCap(['Sigrika gains a stack of Blessing of Runes, up to 6 stacks.']) === 6);

    assert('cap from "max stack … is increased to N" (a node RAISING a cap)',
        descStackCap(['- The max stack of Crown of Wills is increased to 2.']) === 2);

    assert('TWO different caps in one description → null, never a guess',
        descStackCap(['gain 1 stack of A, up to 3 stacks.', 'gain 1 stack of B, up to 7 stacks.']) === null);

    assert('no cap stated → null',
        descStackCap(['Each stack of Enflamement will increase Fusion DMG Bonus by 5%.']) === null);

    // A percentage ceiling is NOT a stack count: "up to 120%" with a 40%/stack
    // value means 3 stacks, but "up to 100%" on Phrolova's SEPARATE post-max
    // clause means nothing about her 2.5%/stack count. Deriving one from the
    // other was measured as 1-of-5 correct, so the parser never tries.
    assert('a "up to N%" value ceiling is not read as a stack count',
        descStackCap(['Each stack grants 40% DMG Bonus, up to 120%.']) === null);
}

// ── descStackGain: only the wielder's own, single, identifiable cast ─────────
{
    assert('gain clause "When casting Resonance Skill X" → skill',
        descStackGain(['When casting Resonance Skill Antique Appraisal, gain 1 stack of Sky Blue, stackable up to 4 times, lasting for 7s.',
            "Each stack increases Youhu's Crit. DMG by 15%."])?.skillType === 'skill');

    assert('gain clause "after casting Intro Skill X" → intro',
        descStackGain(["Jinhsi gains one stack of Immortal's Descendancy after casting Intro Skill Loong's Halo.",
            "Each stack of Immortal's Descendancy increases Jinhsi's ATK by 25%."])?.skillType === 'intro');

    assert('the granting clause also yields the per-stack lifetime',
        descStackGain(['When casting Resonance Skill X, gain 1 stack of Sky Blue, lasting for 7s.'])?.seconds === 7);

    assert('TEAMMATES as the actor → null (team-composition counter, not a self cast)',
        descStackGain(['When any nearby Resonators in the team cast Echo Skill, Sigrika gains a stack of Blessing of Runes, up to 6 stacks.']) === null);

    assert('a granting clause listing MANY skills → null (no single trigger)',
        descStackGain(['1 stack of Fated End is inflicted on the target when the following skills hit: Intro Skill, Basic Attack, Heavy Attack - Volley of Death, Resonance Skill - Encroach and Resonance Liberation, up to 4 stacks.']) === null);

    assert('TWO granting clauses → null (Lynae states two income rates)',
        descStackGain(['While Lynae is in combat, when Lumiflow is at least 120 points, gain 1 stack of Premixed Hue every 1s, up to 25 stacks.',
            'While Lynae is out of combat, with at least 120 points of Lumiflow, gain 1 stack of Premixed Hue every 0.5s;']) === null);

    assert('a non-cast grant ("upon entering battle") → null',
        descStackGain(['Obtain 10 stacks of Aftersound upon entering battle.']) === null);

    assert('no granting clause at all → null',
        descStackGain(['Each stack of Enflamement will increase Fusion DMG Bonus by 5%.']) === null);
}

// ── End-to-end through parseEffectsFromDesc ─────────────────────────────────
{
    const effects = parseEffectsFromDesc(
        'When casting Resonance Skill Antique Appraisal, gain 1 stack of Sky Blue, stackable up to 4 times, lasting for 7s. '
        + "Each stack increases Youhu's Crit. DMG by 15%.");
    const stacked = effects.find(effect => effect.stackable);
    assert('parse: the value clause emits a stackable effect', !!stacked);
    assert('parse: cap comes from the granting clause', stacked?.maxStacks === 4);
    assert('parse: trigger comes from the granting clause', stacked?.stackTrigger?.skillType === 'skill');
    assert('parse: per-stack lifetime carried as stackSeconds', stacked?.stackSeconds === 7);
    assert('parse: per-stack VALUE still comes from the value clause', stacked?.perStack === 0.15);
}

// ── Live dataset: the roster-wide outcome ────────────────────────────────────
{
    assert('the dataset still holds exactly 14 stackable effects', stackables.size === 14);

    // Each entry below was hand-checked against the kit text in wuwa-data.json.
    const expected = {
        '1106 S6.0':  { max: 4,    perStack: 0.15,  trigger: 'skill' },   // Youhu — Sky Blue
        '1203 S1.0':  { max: 4,    perStack: 0.03,  trigger: 'basic' },   // Encore — curated override
        '1203 S6.0':  { max: 5,    perStack: 0.05,  trigger: null    },   // Encore — Lost Lamb (hit-count in a state)
        '1205 IH0.0': { max: null, perStack: 0.05,  trigger: null    },   // Changli — Enflamement (resource gauge)
        '1208 IH0.0': { max: 4,    perStack: 0.05,  trigger: null    },   // Galbrena — Fated End (enemy debuff, 11 skills)
        '1304 S3.0':  { max: 2,    perStack: 0.25,  trigger: 'intro' },   // Jinhsi — Immortal's Descendancy
        '1306 S1.0':  { max: 2,    perStack: 0.15,  trigger: null    },   // Augusta — Crown of Wills
        '1306 S2.0':  { max: 2,    perStack: 0.2,   trigger: null    },   // Augusta — cap from sibling node S1 (override)
        '1412 IH1.0': { max: 6,    perStack: 0.03,  trigger: null    },   // Sigrika — Blessing of Runes (team composition)
        '1509 S3.1':  { max: 25,   perStack: 0.55,  trigger: null    },   // Lynae — Premixed Hue (time tick, gauge-gated)
        '1510 S6.0':  { max: 3,    perStack: 0.4,   trigger: null    },   // Luuk Herssen — Endnotes (override: pctNear read the ceiling)
        '1608 IH1.0': { max: null, perStack: 0.025, trigger: null    },   // Phrolova — Aftersound (10 on battle entry)
        '1610 IH0.0': { max: 3,    perStack: 0.1,   trigger: null    },   // Yangyang: Xuanling — Havoc Bane 1-3 (override)
        '1610 IH0.1': { max: 3,    perStack: 0.12,  trigger: null    },   // Yangyang: Xuanling — Havoc Bane 4-6 (override)
    };

    for (const [key, want] of Object.entries(expected)) {
        const entry = stackables.get(key);
        assert(`${key}: still present in the dataset`, !!entry);
        if (!entry) continue;
        const { effect } = entry;
        assert(`${key}: maxStacks === ${want.max}`, (effect.maxStacks ?? null) === want.max);
        assert(`${key}: perStack === ${want.perStack}`, Math.abs(effect.perStack - want.perStack) < 1e-9);
        const trigger = effect.stackTrigger?.type === 'castMatch' ? effect.stackTrigger.skillType : null;
        assert(`${key}: stack trigger === ${want.trigger}`, trigger === want.trigger);
    }

    // The headline regression guards. Before this change: 3 real caps, 1 real
    // trigger. A drop below these means the desc-scoped lookup broke.
    const withCap = [...stackables.values()].filter(x => x.effect.maxStacks != null).length;
    const withTrigger = [...stackables.values()].filter(x => x.effect.stackTrigger?.type === 'castMatch').length;
    assert(`at least 12 stackable effects carry a real cap (got ${withCap})`, withCap >= 12);
    assert(`at least 3 stackable effects carry a resolvable trigger (got ${withTrigger})`, withTrigger >= 3);

    // No stackable effect may carry a cap of 0 or a negative/absent per-stack
    // value — either would silently zero a buff.
    for (const [key, { effect }] of stackables) {
        assert(`${key}: cap is null or a positive integer`,
            effect.maxStacks == null || (Number.isInteger(effect.maxStacks) && effect.maxStacks > 0));
        assert(`${key}: perStack is a positive number`, typeof effect.perStack === 'number' && effect.perStack > 0);
    }
}

console.log(`stack-metadata: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
