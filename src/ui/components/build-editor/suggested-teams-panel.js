// src/ui/components/build-editor/suggested-teams-panel.js — P13 suggested-teams panel + team materialization into the sim.
// Split from the monolithic build-editor-v2.js (Simplification Plan S4.2).
import { TEAM_SLOTS, createTeam, setTeamSlot } from "../../../core/team.js";
import { api } from "./state.js";
import { createBuild, pickEchoId, setEcho, setName, setWeapon } from "../../../core/build.js";
import { listBuilds, listTeams, saveBuild, saveTeam, setCurrentTeamId } from "../../../data/storage.js";
import { referenceRotationFor } from "./shared.js";
import { renderAppearsInTeams, renderSuggestedTeams } from "../suggested-teams.js";
import { resolveOpenerRotation, resolveReferenceRotation, suggestedBuildFor, suggestedTeamsFor, teamMemberBuildFor } from "../../../data/meta-loader.js";

// P13 — Suggested Teams panel (curated META comps + sim alternatives) plus the
// §8b "appears in teams" reverse lookup. Supports without their own suggestions
// still get the appears-in line; the card is omitted only when the character
// has neither, so uncovered builds show no empty-state noise.
export function renderSuggestedTeamsPanel() {
  if (!api.meta) return "";
  const hasTeams =
    suggestedTeamsFor(api.meta, api.build.resonatorId).length > 0;
  const appearsIn = renderAppearsInTeams(
    api.meta,
    api.dataset,
    api.build.resonatorId,
  );
  if (!hasTeams && !appearsIn) return "";
  return `<div class="bv2-card" style="background:var(--card);border:1px solid var(--bd);border-radius:10px;overflow:hidden;">
        ${hasTeams ? renderSuggestedTeams(api.meta, api.dataset, api.build.resonatorId) : ""}
        ${appearsIn}
    </div>`;
}

// True when a build is "empty" enough to offer the suggested default — no weapon
// and no echoes equipped (a fresh roster pick).
export function isEmptyBuild(build) {
  return !build.weapon && !(build.echoes ?? []).some(Boolean);
}

/**
 * Populate a brand-new, empty build with sensible defaults so a fresh
 * resonator never opens to a blank page:
 *   - echoes (+ mode): PREFER the P13 team pass's per-member recipe
 *     (teamMemberBuildFor — real echo ids, REAL co-optimized substats, not
 *     blank ovals) since it's roster-wide (53/56, every resonator with a role
 *     tag that appears in some team, not just an anchor); fall back to the
 *     P12 solo suggestion (suggestedBuildFor/applySuggestion — 6 anchors
 *     only, substats deliberately left blank there for the user to roll,
 *     since THAT path also serves the manual "APPLY SUGGESTED BUILD" button)
 *     when no recipe exists.
 *   - rotation: whichever of the two above supplied one; else the reference
 *     rotation (resolveReferenceRotation — the P12 meta's synthesized one
 *     when covered, else the hand-curated reference-rotations.json).
 *   - weapon: the resonator's own SIGNATURE weapon (nanoka's `recommend`
 *     list, resonator.signatureWeaponId — see tools/preprocess.mjs), which
 *     always wins over whatever the recipe/suggestion equipped — both
 *     optimize for damage, but a fresh default should read as "their own
 *     weapon", not a min-maxed pick.
 * Every field is best-effort/independent — a resonator missing one kind of
 * data still gets the others. Pure; call once at build CREATION (app.js's
 * showEditorForNew) — an already-existing build (even one the user emptied
 * back out) is left alone, since RESET is the explicit re-apply action.
 */
export function defaultFreshBuild(build, resonator, dataset, meta, referenceRotations) {
  let updated = build;
  const recipe = teamMemberBuildFor(meta, resonator.id);
  if (recipe) {
    updated = applyTeamRecipe(updated, recipe);
  } else {
    const suggestion = suggestedBuildFor(meta, resonator.id);
    if (suggestion) updated = applySuggestion(updated, suggestion, dataset);
  }
  if (!updated.rotation?.length) {
    const rotation = resolveReferenceRotation(meta, referenceRotations, resonator.id);
    if (rotation) updated = { ...updated, rotation: [...rotation], rotationMeta: rotation.map(() => ({})) };
  }
  // Independent of the branch above: a recipe already carries the opener, but
  // the solo-suggestion path does not, and neither does a rotation that came
  // from the P12 meta's synthesized loop.
  if (!updated.openerRotation?.length) {
    const opener = resolveOpenerRotation(referenceRotations, resonator.id);
    if (opener) updated = { ...updated, openerRotation: [...opener] };
  }
  if (resonator.signatureWeaponId != null) updated = setWeapon(updated, resonator.signatureWeaponId);
  return updated;
}

// Pick a concrete echo id for a slot: a real echo of the right cost that can
// carry the suggested sonata, preferring one whose Echo-Skill element matches the
// resonator (the 4-cost main echo's active skill is element-typed). Returns null
// only when no such echo exists (→ "choose an echo" placeholder, not a crash).
/**
 * Apply a suggested build (best sonata × weapon + reference rotation) onto a
 * build: equips the weapon, fills the 5 echo slots with REAL echoes of the
 * suggested sonata + the recommended main stats (substats left empty for the
 * user to roll), and sets the reference rotation. Pure — returns a new build.
 * `dataset` is needed to resolve concrete echoes; omit it only in unit tests
 * that don't care about echo identity. Exported for tests.
 */
export function applySuggestion(build, suggestion, dataset) {
  let updated = build;
  if (suggestion.weaponId != null) updated = setWeapon(updated, suggestion.weaponId);
  const element =
    dataset?.resonators?.find((candidate) => candidate.id === build.resonatorId)?.element ??
    null;
  const mains = suggestion.templateStats?.mains ?? [];
  const usedEchoIds = new Set();
  mains.forEach((main, i) => {
    const echoId = pickEchoId(dataset, suggestion.sonataId, main.cost, element, usedEchoIds);
    if (echoId != null) usedEchoIds.add(echoId);
    updated = setEcho(updated, i, {
      id: echoId,
      cost: main.cost,
      level: 25,
      starLevel: 5,
      sonataId: suggestion.sonataId,
      mainStat: {
        propId: main.propId,
        addType: main.addType,
        value: main.value,
        isPercent: main.isPercent,
      },
      subStats: [],
    });
  });
  const rot = (suggestion.referenceRotation ?? []).slice();
  return { ...updated, rotation: rot, rotationMeta: rot.map(() => ({})) };
}

/**
 * Materialize a team-pass build recipe (meta-loader.teamMemberBuildFor) onto
 * a build EXACTLY as computed — real echo ids + mainStat + the co-optimized
 * subStats already resolved by the offline search, so the result is byte-
 * identical to what the suggested-team "INSPECT BUILDS" panel displayed.
 * Unlike applySuggestion (the solo empty-build flow, substats deliberately
 * left for the user to roll), nothing here is left blank — a team
 * suggestion's whole point is a complete, immediately-simmable build.
 */
export function applyTeamRecipe(build, recipe) {
  let updated = build;
  if (recipe.weaponId != null) updated = setWeapon(updated, recipe.weaponId);
  (recipe.echoes ?? []).forEach((echo, i) => {
    updated = setEcho(updated, i, {
      id: echo.id,
      cost: echo.cost,
      level: 25,
      starLevel: 5,
      sonataId: recipe.sonataId,
      mainStat: echo.mainStat ? { ...echo.mainStat } : null,
      subStats: (echo.subStats ?? []).map((sub) => ({ ...sub })),
    });
  });
  const rot = (recipe.rotation ?? []).slice();
  return {
    ...updated,
    resonanceMode: recipe.mode ?? updated.resonanceMode,
    rotation: rot,
    rotationMeta: rot.map(() => ({})),
    // The optional curated opening pass. `[]` for most resonators — see
    // core/build.js's openerRotation note for why it is curated, not derived.
    openerRotation: (recipe.openerRotation ?? []).slice(),
  };
}

/**
 * §8a — materialize a suggested team into a saved Team and open the team-sim
 * screen (#party/<id>).
 *
 * ONE question decides the whole team: where the user owns a real build AND the
 * team pass has a recipe, they choose which to run, and the answer applies to
 * every such slot. ~~The question was asked for the page's own resonator only
 * and its answer applied only there~~, so accepting "use the suggested build"
 * loaded the suggested ANCHOR beside the user's own teammates — silently, since
 * the other slots were never mentioned.
 *
 * Slot resolution per member:
 *   - the user's own build, when they chose to keep it, or when the team pass
 *     has no recipe to offer instead (the anchor's is saved eagerly: its
 *     autosave is debounced, and navigating away would drop a pending write),
 *   - otherwise the team pass's exact build recipe (teamMemberBuildFor — the
 *     same real echoes/substats/weapon/sonata/mode/rotation the "INSPECT
 *     BUILDS" panel showed), reusing an existing TEMPLATE build's id so
 *     re-clicking never piles up duplicates, and falling back to the solo
 *     suggestion/reference rotation for a character the team pass doesn't
 *     cover. New builds/teams are tagged template:true — hidden from My
 *     Builds/My Teams until the user explicitly saves them (never
 *     auto-saved as real user data).
 * Re-clicking a suggestion reuses the existing team (same slots, including a
 * still-unsaved template team) instead of accumulating duplicates.
 */
/**
 * Which slots have a real choice to make, and — once it is answered — which
 * keep the user's own build.
 *
 * CONTESTED means both options exist: the team pass has a recipe for that
 * resonator AND the user owns a build of their own. Everything else has nothing
 * to choose between, so it is never raised and never governed by the answer.
 *
 * The answer applies to EVERY contested slot. It used to be asked about the
 * page's own resonator alone and applied there alone, which meant accepting
 * "use the suggested build" loaded the suggested anchor beside the user's own
 * teammates, without those slots ever being mentioned.
 *
 * A slot with an own build but NO recipe keeps the own build regardless: no
 * choice was put to the user about it, so consent cannot be assumed either way,
 * and the recipe that would replace it does not exist.
 *
 * Pure — exported for tests.
 *
 * @param {number[]} memberIds
 * @param {{ownBuildFor: (rid:number)=>object|null, hasRecipe: (rid:number)=>boolean}} lookups
 * @returns {{contested: number[], keepOwn: (rid:number, useSuggested:boolean)=>boolean}}
 */
export function planSuggestedTeamSlots(memberIds, { ownBuildFor, hasRecipe }) {
  const contested = (memberIds ?? []).filter((rid) => hasRecipe(rid) && ownBuildFor(rid));
  const contestedSet = new Set(contested);
  return {
    contested,
    keepOwn: (rid, useSuggested) =>
      !!ownBuildFor(rid) && (!contestedSet.has(rid) || !useSuggested),
  };
}

export function loadTeamIntoSim(memberIds) {
  const saved = listBuilds({ dataset: api.dataset, includeTemplates: true });
  // Has the user actually put anything into this build (weapon/echoes/
  // rotation)? A freshly-created empty build has nothing worth keeping over
  // the suggested team's recipe, so there's no real choice to offer.
  const hasContent = (candidate) =>
    (candidate.rotation?.length ?? 0) > 0 ||
    candidate.weapon != null ||
    (candidate.echoes ?? []).some((echo) => echo != null);

  // Materialize this resonator's team-pass recipe onto a template build —
  // reusing `existingTemplate`'s id/createdAt when one is given so re-clicking
  // the same suggestion never piles up duplicates. Content is ALWAYS
  // re-applied from the current recipe rather than left as whatever an
  // existing template happened to have: a template made before a meta regen
  // (or from a different suggested team) must not linger stale forever —
  // this was the "incomplete setup" / "current stats instead of the
  // template" bug (2026-07-11). Only the solo-suggestion fallback (for
  // characters the team pass doesn't cover) is skipped on refresh, since
  // there's no new recipe to re-apply in that case.
  const materializeTemplate = (rid, existingTemplate) => {
    const resonator = api.dataset.resonators.find((candidate) => candidate.id === rid);
    if (!resonator) return null;
    const recipe = teamMemberBuildFor(api.meta, rid);
    let template = existingTemplate ? { ...existingTemplate } : createBuild(resonator);
    if (recipe) {
      template = applyTeamRecipe(template, recipe);
    } else if (!existingTemplate) {
      const suggestion = suggestedBuildFor(api.meta, rid);
      if (suggestion) template = applySuggestion(template, suggestion, api.dataset);
      if (!template.rotation?.length) {
        const rot = referenceRotationFor(rid);
        if (rot)
          template = { ...template, rotation: [...rot], rotationMeta: rot.map(() => ({})) };
      }
    }
    template = setName(template, `${resonator.name} (team suggestion)`);
    template = { ...template, template: true };
    saveBuild(template, { dataset: api.dataset });
    return template.id;
  };

  const slots = memberIds.slice(0, TEAM_SLOTS);
  const nameOf = (rid) =>
    api.dataset.resonators.find((candidate) => candidate.id === rid)?.name ?? `#${rid}`;
  const savedFor = (rid) =>
    saved
      .filter((candidate) => candidate.resonatorId === rid)
      .sort((buildA, buildB) => (buildB.updatedAt ?? 0) - (buildA.updatedAt ?? 0));

  // The user's OWN build for a slot, or null. For the page's own resonator that
  // is the editor build; for the others, their most recent non-template save.
  // An empty one does not count — it has nothing to lose against the recipe,
  // and it would sim to nothing.
  const ownBuildFor = (rid) =>
    rid === api.build.resonatorId
      ? (!api.build.template && hasContent(api.build) ? api.build : null)
      : (savedFor(rid).find((candidate) => !candidate.template && hasContent(candidate)) ?? null);

  const { contested, keepOwn: keepOwnFor } = planSuggestedTeamSlots(slots, {
    ownBuildFor,
    hasRecipe: (rid) => !!teamMemberBuildFor(api.meta, rid),
  });

  // ONE prompt, for the WHOLE team.
  //
  // ~~Asked only for the page's own resonator, and its answer applied only to
  // that slot.~~ Choosing "use the suggested build" then loaded the suggested
  // ANCHOR and the user's own everything else — the other two slots fell
  // straight through to their saved builds without ever being mentioned. The
  // dialog says "this suggested team has its own pre-built … rotation", so a
  // user who accepts it means the TEAM, not one member of it (maintainer
  // report, 2026-08-15). Naming every affected resonator is also what makes the
  // choice answerable: the old text named one and silently decided the rest.
  const useSuggested =
    contested.length === 0 ||
    confirm(
      `This suggested team was measured with its own pre-built weapons, echoes and rotations.\n\n` +
        `You already have your own build for: ${contested.map(nameOf).join(", ")}.\n\n` +
        `OK — use the suggested team's builds for all of them (yours are kept, untouched)\n` +
        `Cancel — keep your own builds`,
    );
  const keepOwn = (rid) => keepOwnFor(rid, useSuggested);

  const buildIdFor = (rid) => {
    const existingTemplate = savedFor(rid).find((candidate) => candidate.template);

    if (keepOwn(rid)) {
      // The anchor's editor build is saved eagerly: its autosave is debounced,
      // and navigating to #party would drop a pending write.
      if (rid === api.build.resonatorId) {
        saveBuild(api.build, { dataset: api.dataset });
        return api.build.id;
      }
      return ownBuildFor(rid).id;
    }

    if (rid === api.build.resonatorId) {
      // The page's own build IS itself a previously-materialized suggestion
      // (not the user's deliberate work) — always refresh it to the CURRENT
      // recipe rather than silently keeping stale content.
      if (api.build.template) return materializeTemplate(rid, api.build);
      const recipe = teamMemberBuildFor(api.meta, rid);
      if (recipe) return materializeTemplate(rid, existingTemplate);
      // No recipe to prefer, so the editor build is the best we have — but a
      // never-saved, empty one has nothing worth promoting to a permanent "My
      // Builds" entry. Persisting it unconditionally was silently polluting My
      // Builds every time a suggested team was opened from a fresh page
      // (2026-07-11); it stays a template until the user deliberately edits it.
      const alreadyPersisted = saved.some((candidate) => candidate.id === api.build.id);
      if (alreadyPersisted || hasContent(api.build)) {
        saveBuild(api.build, { dataset: api.dataset });
        return api.build.id;
      }
      const untouched = { ...api.build, template: true };
      saveBuild(untouched, { dataset: api.dataset });
      return untouched.id;
    }

    return materializeTemplate(rid, existingTemplate);
  };

  let team = createTeam(slots.map(nameOf).join(" · "));
  slots.forEach((rid, i) => {
    const id = buildIdFor(rid);
    if (id) team = setTeamSlot(team, i, id);
  });

  const dupe = listTeams({ includeTemplates: true }).find(
    (candidate) => candidate.slots.join(",") === team.slots.join(","),
  );
  const target = dupe ?? team;
  if (!dupe) saveTeam({ ...team, template: true });
  setCurrentTeamId(target.id);
  location.hash = `#party/${target.id}`;
}
