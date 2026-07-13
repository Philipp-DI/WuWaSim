/**
 * Buff stack timeline — ramp / decay / cap / multi-trigger grouping (Phase A).
 *
 *   node tests/buff-timeline.test.mjs
 */

import { stackTimeline, groupStackingBuffs } from '../src/core/buff-timeline.js';

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

// Synthetic steps: each 1s long, back-to-back. skillType drives stack gains.
function mkSteps(types) {
    let t = 0;
    return types.map((skillType, index) => {
        const startTime = t, endTime = t + 1;
        t = endTime;
        return { index, skillType, startTime, endTime };
    });
}

// ── ramp: stacks build up one per qualifying cast, capped ────────────────────
{
    // basic at steps 0,1,2,3; cap 3; long duration so nothing decays.
    const steps = mkSteps(['basic', 'basic', 'basic', 'basic', 'skill']);
    const { byStepIndex } = stackTimeline(steps, { triggerTypes: ['basic'], maxStacks: 3, duration: 100 });
    // Step 0 starts at t=0; the first gain is at t=1 (end of step 0) → 0 stacks yet.
    assert('step 0 sees 0 stacks (cast buffs later steps)', byStepIndex[0] === 0);
    assert('step 1 sees 1 stack', byStepIndex[1] === 1);
    assert('step 2 sees 2 stacks', byStepIndex[2] === 2);
    assert('step 3 sees 3 stacks (ramp)', byStepIndex[3] === 3);
    assert('step 4 capped at 3 (4 gains, cap 3)', byStepIndex[4] === 3);
}

// ── decay: a stack expires `duration` after it was gained ────────────────────
{
    // one basic at step 0 (gain at t=1, duration 2 → expires at t=3).
    const steps = mkSteps(['basic', 'skill', 'skill', 'skill']);
    const { byStepIndex } = stackTimeline(steps, { triggerTypes: ['basic'], maxStacks: 3, duration: 2 });
    assert('step 1 (t=1) within lifetime → 1 stack', byStepIndex[1] === 1);
    assert('step 2 (t=2) still within (gain+2=3 > 2) → 1 stack', byStepIndex[2] === 1);
    assert('step 3 (t=3) expired (3 > gain+2=3 boundary) → 0 stacks', byStepIndex[3] === 0);
}

// ── multi-trigger union: Basic OR Heavy both grant a stack ───────────────────
{
    const steps = mkSteps(['basic', 'heavy', 'skill']);
    const { byStepIndex } = stackTimeline(steps, { triggerTypes: ['basic', 'heavy'], maxStacks: 3, duration: 100 });
    assert('step 2 counts both basic+heavy gains → 2 stacks', byStepIndex[2] === 2);
}

// ── 'healing' trigger matches step.stepHeal, not step.skillType (2026-07-14) ─
// Sonatas like Rejuvenating Glow ("Increases ATK of all party members by 15%
// … upon healing allies") parse a 'healing' trigger — but 'healing' isn't a
// mechanical skillType, so before this fix `triggers.has(s.skillType)` could
// NEVER match any step and the buff silently never gained a single stack.
{
    const steps = mkSteps(['basic', 'liberation', 'basic']).map((s, i) => ({ ...s, stepHeal: i === 1 ? 500 : 0 }));
    const tl = stackTimeline(steps, { triggerTypes: ['healing'], maxStacks: 3, duration: 100 });
    assert('a step with real heal output grants a stack to LATER steps', tl.byStepIndex[2] === 1);
    assert('the healing step itself sees 0 stacks (buffs later steps)', tl.byStepIndex[1] === 0);
    assert('a non-healing rotation never gains a stack', stackTimeline(mkSteps(['basic', 'liberation']).map(s => ({ ...s, stepHeal: 0 })), { triggerTypes: ['healing'], maxStacks: 3, duration: 100 }).gains.length === 0);
}

// ── no qualifying casts → empty timeline, no active span ─────────────────────
{
    const steps = mkSteps(['skill', 'liberation']);
    const tl = stackTimeline(steps, { triggerTypes: ['basic'], maxStacks: 3, duration: 100 });
    assert('no gains → empty byStepIndex', Object.keys(tl.byStepIndex).length === 0);
    assert('no gains → start/end both 0', tl.start === 0 && tl.end === 0);
}

// ── groupStackingBuffs merges same-clause buffs, unions triggers ─────────────
{
    const raw = 'Basic or Heavy Attack grants +10% Glacio DMG, stacking up to 3 times.';
    const buffs = [
        { sonataId: 1, raw, trigger: 'basic', bonusPct: 0.1, stacks: 3 },
        { sonataId: 1, raw, trigger: 'heavy', bonusPct: 0.1, stacks: 3 },
        { sonataId: 2, raw: 'other', trigger: 'skill', bonusPct: 0.2, stacks: 1 },
    ];
    const grouped = groupStackingBuffs(buffs);
    assert('two clauses → two groups (no cross-merge)', grouped.length === 2);
    const g1 = grouped.find(g => g.sonataId === 1);
    assert('same-clause basic+heavy merged into one group', g1.triggerTypes.length === 2 && g1.triggerTypes.includes('basic') && g1.triggerTypes.includes('heavy'));
    assert('shared bonus preserved on the merged group', g1.bonusPct === 0.1 && g1.stacks === 3);
}

console.log(`\nbuff-timeline: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
