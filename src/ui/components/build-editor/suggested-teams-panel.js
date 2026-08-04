// src/ui/components/build-editor/suggested-teams-panel.js — P13 suggested-teams panel + team materialization into the sim.
// Split from the monolithic build-editor-v2.js (Simplification Plan S4.2).
import { TEAM_SLOTS, createTeam, setTeamSlot } from "../../../core/team.js";
import { api } from "./state.js";
import { createBuild, pickEchoId, setEcho, setName, setWeapon } from "../../../core/build.js";
import { listBuilds, listTeams, saveBuild, saveTeam, setCurrentTeamId } from "../../../data/storage.js";
import { referenceRotationFor } from "./shared.js";
import { renderAppearsInTeams, renderSuggestedTeams } from "../suggested-teams.js";
import { resolveReferenceRotation, suggestedBuildFor, suggestedTeamsFor, teamMemberBuildFor } from "../../../data/meta-loader.js";

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
  };
}

/**
 * §8a — materialize a suggested team into a saved Team and open the team-sim
 * screen (#party/<id>). Slot resolution per member:
 *   - the anchor (this page's resonator) → THIS build (saved eagerly: the
 *     autosave is debounced, and navigating away would drop a pending write),
 *   - a resonator the user already owns a REAL (non-template) build for →
 *     their most recent one,
 *   - a resonator with an existing TEMPLATE build already materialized from a
 *     prior click → reuse it (no duplicate template builds pile up),
 *   - otherwise → materialize the team pass's exact build recipe
 *     (teamMemberBuildFor — same real echoes/substats/weapon/sonata/mode/
 *     rotation the "INSPECT BUILDS" panel showed), or fall back to the solo
 *     suggestion/reference rotation for a character the team pass doesn't
 *     cover. New builds/teams are tagged template:true — hidden from My
 *     Builds/My Teams until the user explicitly saves them (never
 *     auto-saved as real user data).
 * Re-clicking a suggestion reuses the existing team (same slots, including a
 * still-unsaved template team) instead of accumulating duplicates.
 */
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

  const buildIdFor = (rid) => {
    const forRid = saved
      .filter((candidate) => candidate.resonatorId === rid)
      .sort((buildA, buildB) => (buildB.updatedAt ?? 0) - (buildA.updatedAt ?? 0));
    const existingTemplate = forRid.find((candidate) => candidate.template);

    if (rid === api.build.resonatorId) {
      // The page's own build IS itself a previously-materialized suggestion
      // (not the user's deliberate work) — always refresh it to the CURRENT
      // recipe rather than silently keeping stale content.
      if (api.build.template) return materializeTemplate(rid, api.build);

      // A real, already-saved build with actual content differs from the
      // team pass's pre-computed recipe whenever the user has edited it —
      // carrying over the wrong one silently is the bug the maintainer
      // flagged: give the user the choice instead of guessing. An
      // empty/untouched build has nothing to lose, so only ask when there's
      // something real to choose between.
      const recipe = teamMemberBuildFor(api.meta, rid);
      if (recipe && hasContent(api.build)) {
        const resoName =
          api.dataset.resonators.find((candidate) => candidate.id === rid)?.name ?? `#${rid}`;
        const useSuggested = confirm(
          `${resoName}: this suggested team has its own pre-built weapon, echoes, and rotation — different from your current editor build.\n\nOK — use the suggested build (kept separately; your current build is untouched)\nCancel — keep your current editor build`,
        );
        if (useSuggested) return materializeTemplate(rid, existingTemplate);
      }
      // A never-saved, empty build has nothing worth promoting to a
      // permanent "My Builds" entry — persisting it unconditionally here
      // was silently polluting My Builds every time a suggested team was
      // opened from a fresh/untouched page (2026-07-11). Only save as the
      // user's own real build when it's already persisted or has real
      // content; otherwise materialize the recipe (or tag template) so it
      // stays out of My Builds until the user deliberately saves/edits it.
      const alreadyPersisted = saved.some((candidate) => candidate.id === api.build.id);
      if (alreadyPersisted || hasContent(api.build)) {
        saveBuild(api.build, { dataset: api.dataset });
        return api.build.id;
      }
      if (recipe) return materializeTemplate(rid, existingTemplate);
      const untouched = { ...api.build, template: true };
      saveBuild(untouched, { dataset: api.dataset });
      return untouched.id;
    }

    const existingReal = forRid.find((candidate) => !candidate.template);
    if (existingReal) return existingReal.id;
    return materializeTemplate(rid, existingTemplate);
  };

  let team = createTeam(
    memberIds
      .map(
        (rid) =>
          api.dataset.resonators.find((candidate) => candidate.id === rid)?.name ?? `#${rid}`,
      )
      .join(" · "),
  );
  memberIds.slice(0, TEAM_SLOTS).forEach((rid, i) => {
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
