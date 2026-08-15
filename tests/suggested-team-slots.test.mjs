/**
 * Which build each slot of a suggested team runs — src/ui/components/
 * build-editor/suggested-teams-panel.js planSuggestedTeamSlots.
 *
 *   node tests/suggested-team-slots.test.mjs
 *
 * Opening a suggested team has to reconcile two sources per slot: the team
 * pass's own recipe (what the card's numbers were measured with) and whatever
 * build the user already owns for that resonator.
 *
 * ~~The question was asked about the page's OWN resonator only, and its answer
 * applied only there.~~ Accepting "use the suggested build" therefore loaded the
 * suggested ANCHOR beside the user's own teammates — and those slots were never
 * mentioned, so the team quietly ran rotations the card never advertised
 * (maintainer report, 2026-08-15: picking the template still left Denia on a
 * different chain).
 *
 * The rule under test: ONE answer, applied to EVERY slot where both options
 * actually exist.
 */

import { planSuggestedTeamSlots } from '../src/ui/components/build-editor/suggested-teams-panel.js';

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

const CHISA = 1508, DENIA = 1211, AEMEATH = 1210;
const MEMBERS = [CHISA, DENIA, AEMEATH];

// Build a plan from two simple sets: who the user owns a build for, and who the
// team pass has a recipe for.
const plan = (owned, recipes) => planSuggestedTeamSlots(MEMBERS, {
    ownBuildFor: (rid) => (owned.includes(rid) ? { id: `own_${rid}` } : null),
    hasRecipe: (rid) => recipes.includes(rid),
});

// ── CONTESTED: both options exist ───────────────────────────────────────────
{
    const all = plan(MEMBERS, MEMBERS);
    assert('every slot with both a recipe and an own build is contested',
        all.contested.join() === MEMBERS.join());

    const none = plan([], MEMBERS);
    assert('no own build → nothing to ask about', none.contested.length === 0);

    const noRecipes = plan(MEMBERS, []);
    assert('no recipe → nothing to ask about', noRecipes.contested.length === 0);

    const one = plan([DENIA], MEMBERS);
    assert('only the slots with a real choice are contested', one.contested.join() === String(DENIA));
    assert('contested preserves slot order', plan([AEMEATH, CHISA], MEMBERS).contested.join()
        === [CHISA, AEMEATH].join());
}

// ── THE HEADLINE: one answer governs every contested slot ───────────────────
{
    const all = plan(MEMBERS, MEMBERS);
    assert('accepting the suggestion replaces EVERY contested slot, not just the anchor',
        MEMBERS.every(rid => all.keepOwn(rid, true) === false));
    assert('declining keeps every contested slot',
        MEMBERS.every(rid => all.keepOwn(rid, false) === true));
}

// ── Slots the question did not cover ────────────────────────────────────────
{
    // An own build with NO recipe: nothing was offered instead and nothing was
    // asked, so it is kept whichever way the answer went. Assuming consent from
    // an answer about OTHER slots is exactly the bug being fixed, inverted.
    const mixed = plan(MEMBERS, [CHISA]);
    assert('an own build with no recipe is kept when the suggestion is accepted',
        mixed.keepOwn(DENIA, true) === true && mixed.keepOwn(AEMEATH, true) === true);
    assert('…and kept when it is declined', mixed.keepOwn(DENIA, false) === true);
    assert('…while the contested slot still follows the answer',
        mixed.keepOwn(CHISA, true) === false && mixed.keepOwn(CHISA, false) === true);

    // No own build → the recipe runs, and the answer is irrelevant.
    const noneOwned = plan([], MEMBERS);
    assert('a slot with no own build never keeps one',
        MEMBERS.every(rid => !noneOwned.keepOwn(rid, true) && !noneOwned.keepOwn(rid, false)));
}

// ── Degenerate input ────────────────────────────────────────────────────────
{
    const empty = planSuggestedTeamSlots(undefined, { ownBuildFor: () => null, hasRecipe: () => true });
    assert('no members → no contested slots', empty.contested.length === 0);
    assert('…and keepOwn still answers', empty.keepOwn(CHISA, true) === false);
}

console.log(`suggested-team-slots: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
