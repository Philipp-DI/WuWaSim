// src/ui/components/build-editor/bind.js — delegated event wiring, modal pickers, rotation drag-and-drop.
// Split from the monolithic build-editor-v2.js (Simplification Plan S4.2).
import * as echoPicker from "../echo-picker-v2.js";
import * as modal from "../modal-picker.js";
import { ECHO_SLOTS, appendRotationStep, clearRotation, moveRotationStep, removeRotationStep, setChain, setEcho, setEffectStacks, setInherentSkill, setLevel, setName, setResonanceMode, setSkillLevel, setStatNode, setWeapon, setWeaponLevel, setWeaponRank } from "../../../core/build.js";
import { api } from "./state.js";
import { applyAutoTrigger, applyFix } from "./rotation.js";
import { applySuggestion, loadTeamIntoSim } from "./suggested-teams-panel.js";
import { bindTooltipHover } from "../../tooltip.js";
import { underivableStacks } from "../../../core/buffs.js";
import { closeEchoLoadMenu, closeRotLoadMenu, closeSonataMenu, openEchoLoadMenu, openRotLoadMenu, openSonataMenu } from "./menus.js";
import { openSonataQuickswitch } from "../sonata-quickswitch.js";
import { commit, paint, redo, setSonataOverride, showToast, undo } from "./index.js";
import { normalizeSonataOverride } from "../../../core/sonata-override.js";
import { echoActiveSkillDesc, pct1to10, pct1to90, referenceRotationFor, resonatorOf, setAllSkillNodes, sonataElementId, sonataTooltipDesc, tier } from "./shared.js";
import { esc, on } from "../../dom.js";
import { listBuilds, listEchoPresets, listRotationPresets, saveEchoPreset, saveRotationPreset } from "../../../data/storage.js";
import { mainStatValueFor, mainStatsForCost, possibleRollsFor, snapLevel, unlockedSubStatCount } from "../../../core/echo-rules.js";
import { openWeaponPicker as openWeaponPickerModal } from "../weapon-picker.js";
import { suggestedBuildFor } from "../../../data/meta-loader.js";

// =============================================================================
// Events
// =============================================================================

export function bind() {
  const root = api.root;

  on(root, "click", '[data-act="pick-build-resonator"]', () =>
    openResonatorPicker(),
  );

  // Save is almost decorative (autosave already runs on every change via
  // onChange) — it just force-flushes immediately and confirms via toast.
  on(root, "click", '[data-act="save-build"]', () => api.onSave?.());

  // Duplicate is guardrailed app-side (max count + cooldown); a blocked
  // attempt surfaces its reason via alert rather than failing silently.
  on(root, "click", '[data-act="duplicate-build"]', () => {
    const result = api.onDuplicate?.();
    if (result && result.ok === false) alert(result.reason);
  });
  on(root, "click", '[data-act="delete-build"]', () => {
    if (confirm(`Delete "${api.build.name}"? This cannot be undone.`))
      api.onDelete?.();
  });

  // Undo / redo the build (HUD-strip buttons; also Ctrl+Z / Ctrl+Shift+Z — see
  // handleUndoRedoKey in index.js). Disabled buttons never fire.
  on(root, "click", '[data-act="undo"]', () => undo());
  on(root, "click", '[data-act="redo"]', () => redo());

  // Stat Priority panel (P12): switch the solo mode (view-only, no build
  // mutation — set directly and repaint rather than via commit()).
  on(root, "click", '[data-act="stat-mode"]', (event, el) => {
    const mode = el.dataset.mode;
    if (mode && mode !== api.statMode) {
      api.statMode = mode;
      paint();
    }
  });

  on(root, "click", '[data-act="apply-suggested"]', () => {
    const suggestion = suggestedBuildFor(api.meta, api.build.resonatorId);
    if (suggestion) commit(applySuggestion(api.build, suggestion, api.dataset));
  });

  // §8a — suggested-teams "OPEN IN TEAM SIM" (rendered by suggested-teams.js).
  on(root, "click", '[data-act="load-team"]', (event, el) => {
    const members = String(el.dataset.members ?? "")
      .split(",")
      .map(Number)
      .filter(Number.isFinite);
    if (members.length) loadTeamIntoSim(members);
  });

  // §8b — appears-in-teams anchor links: jump to that resonator's build page
  // (their most recent build when one exists, else a fresh one via #new).
  on(root, "click", '[data-act="open-build"]', (event, el) => {
    const rid = Number(el.dataset.resonator);
    if (!Number.isFinite(rid)) return;
    const existing = listBuilds({ dataset: api.dataset })
      .filter((build) => build.resonatorId === rid)
      .sort((buildA, buildB) => (buildB.updatedAt ?? 0) - (buildA.updatedAt ?? 0))[0];
    location.hash = existing ? `#edit2/${existing.id}` : `#new/${rid}`;
  });

  // Hover-box tooltip (see ../tooltip.js for the delegation details).
  bindTooltipHover(root, on);

  // Live slider feedback (no build mutation until release).
  on(root, "input", ".bv2-slider", (event, el) => {
    const value = Number(el.value);
    const act = el.dataset.act;
    const pct =
      act === "skill-level" ? pct1to10(value)
      : act === "echo-level" ? Math.round((value / 25) * 100) + "%"
      : pct1to90(value);
    el.style.setProperty("--pct", pct);
    const dispKey =
      act === "skill-level" ? `${act}:${el.dataset.key}`
      : act === "echo-level" ? `${act}:${el.dataset.slot}`
      : act;
    const disp = root.querySelector(`[data-disp="${dispKey}"]`);
    if (disp) disp.firstChild.textContent = String(value);
  });
  on(root, "change", ".bv2-slider", (event, el) => {
    const value = Number(el.value);
    if (el.dataset.act === "res-level") commit(setLevel(api.build, value));
    else if (el.dataset.act === "weapon-level")
      commit(setWeaponLevel(api.build, value));
    else if (el.dataset.act === "skill-level")
      commit(setSkillLevel(api.build, el.dataset.key, value));
  });

  on(root, "click", '[data-act="seq"]', (event, el) =>
    commit(setChain(api.build, tier(api.build.chain, Number(el.dataset.n), 0))),
  );
  on(root, "click", '[data-act="refine"]', (event, el) => {
    if (!api.build.weapon) return;
    commit(
      setWeaponRank(
        api.build,
        tier(api.build.weapon.rank ?? 1, Number(el.dataset.n), 1),
      ),
    );
  });
  on(root, "click", '[data-act="mode"]', (event, el) =>
    commit(setResonanceMode(api.build, el.dataset.mode)),
  );
  on(root, "change", '[data-act="build-name"]', (event, el) =>
    commit(setName(api.build, el.value)),
  );

  on(root, "click", '[data-act="pick-weapon"]', () => openWeaponPicker());

  on(root, "click", '[data-act="stat-node"]', (event, el) => {
    const col = el.dataset.col,
      tierIndex = Number(el.dataset.n);
    const tiers = api.build.statNodesActive?.[col];
    const current =
      tiers?.[1] !== false ? 2
      : tiers?.[0] !== false ? 1
      : 0;
    const next = tier(current, tierIndex, 0);
    let build = setStatNode(api.build, col, 0, next >= 1);
    build = setStatNode(build, col, 1, next >= 2);
    commit(build);
  });
  on(root, "click", '[data-act="inherent-node"]', (event, el) => {
    const tierIndex = Number(el.dataset.n);
    const flags = api.build.inherentSkillsActive ?? [true, true];
    const current =
      flags[1] !== false ? 2
      : flags[0] !== false ? 1
      : 0;
    const next = tier(current, tierIndex, 0);
    let build = setInherentSkill(api.build, 0, next >= 1);
    build = setInherentSkill(build, 1, next >= 2);
    commit(build);
  });
  // Stack stepper (rotation.js renderStackStepper): the user's own count for an
  // effect whose stacks the rotation cannot derive. Stepping from the ASSUMED
  // state starts at the assumed 1, so "+" reads as 2 rather than jumping. RESET
  // clears the entry entirely, which is distinct from setting 0 — cleared hands
  // the count back to the engine, 0 asserts there are genuinely no stacks.
  const stepStacks = (el, delta) => {
    const key = el.dataset.key;
    const row = underivableStacks(api.build, resonatorOf()).find((x) => x.key === key);
    if (!row) return;
    const cap = row.maxStacks ?? Infinity;
    const next = Math.max(0, Math.min(cap, row.stacks + delta));
    commit(setEffectStacks(api.build, key, next));
  };
  on(root, "click", '[data-act="stacks-inc"]', (event, el) => stepStacks(el, +1));
  on(root, "click", '[data-act="stacks-dec"]', (event, el) => stepStacks(el, -1));
  on(root, "click", '[data-act="stacks-clear"]', (event, el) =>
    commit(setEffectStacks(api.build, el.dataset.key, null)),
  );

  on(root, "click", '[data-act="skills-reset"]', () =>
    commit(setAllSkillNodes(api.build, false, 1)),
  );
  on(root, "click", '[data-act="skills-max"]', () =>
    commit(setAllSkillNodes(api.build, true, 10)),
  );

  // switch-echo/remove-echo/the level slider are nested inside the
  // select-echo card — event.target.closest() matches the outer card
  // regardless of stopPropagation (delegation walks the DOM tree, not the
  // propagation path), so select-echo's handler must explicitly ignore
  // those clicks (the slider is already the selected slot, so reselecting
  // it would just cause a redundant repaint on every drag).
  on(root, "click", '[data-act="select-echo"]', (event, el) => {
    if (
      event.target.closest(
        '[data-act="switch-echo"],[data-act="remove-echo"],[data-act="sonata-menu"],[data-act="echo-level"],[data-act="set-echo-main"]',
      )
    )
      return;
    api.echoSlot = Number(el.dataset.slot);
    paint();
  });
  on(root, "click", '[data-act="pick-echo"]', (event, el) => {
    closeSonataMenu();
    openEchoPicker(Number(el.dataset.slot));
  });
  on(root, "click", '[data-act="switch-echo"]', (event, el) => {
    closeSonataMenu();
    openEchoPicker(Number(el.dataset.slot));
  });
  on(root, "click", '[data-act="sonata-menu"]', (event, el) => {
    if (
      api.sonataMenuAnchor === el &&
      api.sonataMenuEl?.classList.contains("is-open")
    ) {
      closeSonataMenu();
      return;
    }
    openSonataMenu(Number(el.dataset.slot), el);
  });
  on(root, "click", '[data-act="remove-echo"]', (event, el) => {
    closeSonataMenu();
    commit(setEcho(api.build, Number(el.dataset.slot), null));
  });

  // Sonata quick-switch (header chip) — PREVIEW a different set in this chip's
  // place. `data-orig` is the ORIGINAL set id(s) feeding the chip (so re-swaps
  // and resets remap by a stable key even after the effective set changed);
  // `data-eff` is the currently-shown (previewed) set, highlighted in the menu.
  on(root, "click", '[data-act="sonata-quickswitch"]', (event, el) => {
    const effId = Number(el.dataset.eff);
    const origins = (el.dataset.orig || "").split(",").filter(Boolean).map(Number);
    const override = api.sonataOverride ?? null;
    openSonataQuickswitch({
      anchorEl: el,
      sonatas: api.dataset.sonatas,
      currentId: effId,
      canReset: origins.some((orig) => override && override[orig] != null),
      onPick: (picked) => {
        const next = { ...(override ?? {}) };
        for (const orig of origins) {
          if (picked === orig) delete next[orig];
          else next[orig] = picked;
        }
        setSonataOverride(normalizeSonataOverride(next));
      },
      onReset: () => {
        const next = { ...(override ?? {}) };
        for (const orig of origins) delete next[orig];
        setSonataOverride(normalizeSonataOverride(next));
      },
    });
  });
  on(root, "click", '[data-act="sonata-reset-all"]', () => setSonataOverride(null));

  on(root, "click", '[data-act="echoes-remove-all"]', () => {
    const equipped = api.build.echoes.filter(Boolean).length;
    if (!equipped) return;
    if (
      !confirm(
        `Remove all ${equipped} equipped echo${equipped === 1 ? "" : "es"}? Their levels, main stats and substats are lost.`,
      )
    )
      return;
    let build = api.build;
    for (let i = 0; i < ECHO_SLOTS; i++) build = setEcho(build, i, null);
    commit(build);
  });
  on(root, "click", '[data-act="echoes-save"]', () => {
    const echoes = api.build.echoes;
    if (!echoes.some(Boolean)) return;
    const presets = listEchoPresets(api.build.resonatorId);
    const name = `Preset ${presets.length + 1}`;
    saveEchoPreset(api.build.resonatorId, name, echoes);
    showToast(`Echo loadout saved as "${name}"`);
    paint();
  });
  on(root, "click", '[data-act="echoes-load"]', (event, el) => {
    if (
      api.echoLoadMenuAnchor === el &&
      api.echoLoadMenuEl?.classList.contains("is-open")
    ) {
      closeEchoLoadMenu();
      return;
    }
    openEchoLoadMenu(el);
  });

  // Main stat dropdown (a native <select> on each rail card). Its value encodes
  // "propId:addType"; on change we resolve the option and store the level-scaled
  // value. (Was a grid of buttons in the editor frame — see echoes.js.)
  on(root, "change", '[data-act="set-echo-main"]', (event, el) => {
    const slot = Number(el.dataset.slot),
      echo = api.build.echoes[slot];
    if (!echo) return;
    const [propId, addType] = String(el.value).split(":").map(Number);
    const opt = mainStatsForCost(echo.cost, api.dataset).find(
      (option) => option.propId === propId && option.addType === addType,
    );
    if (!opt) return;
    const value =
      mainStatValueFor(
        opt,
        echo.cost,
        echo.starLevel ?? 5,
        echo.level,
        api.dataset,
      ) ?? 0;
    commit(
      setEcho(api.build, slot, {
        ...echo,
        mainStat: {
          propId: opt.propId,
          addType: opt.addType,
          name: opt.name,
          isPercent: opt.isPercent,
          value,
        },
      }),
    );
  });

  // Direct roll picker (echopanel-v2 handoff point 1) — replaces the old
  // toggle-then-cycle flow. Tapping a roll value: slots it if the stat isn't
  // active yet (capped at the level's unlocked count), re-rolls into it if a
  // DIFFERENT value for the same stat is already active, or clears the stat
  // if its own currently-active value is tapped again.
  on(root, "click", '[data-act="pick-echo-roll"]', (event, el) => {
    const slot = Number(el.dataset.slot),
      echo = api.build.echoes[slot];
    if (!echo) return;
    const propId = Number(el.dataset.prop),
      addType = Number(el.dataset.addtype),
      rollIdx = Number(el.dataset.roll);
    const opt = api.dataset.echoSubStats.find(
      (sub) => sub.propId === propId && sub.addType === addType,
    );
    if (!opt) return;
    const rolls = possibleRollsFor(opt, api.dataset.statRanges);
    if (!rolls.length || rollIdx < 0 || rollIdx >= rolls.length) return;

    const subs = [...(echo.subStats ?? [])];
    const existingIndex = subs.findIndex(
      (sub) => sub.propId === propId && sub.addType === addType,
    );
    if (existingIndex >= 0) {
      if (rolls.indexOf(subs[existingIndex].value) === rollIdx) {
        subs.splice(existingIndex, 1);
      } else {
        subs[existingIndex] = { ...subs[existingIndex], value: rolls[rollIdx] };
      }
    } else {
      if (subs.length >= unlockedSubStatCount(echo.level)) return;
      subs.push({
        propId: opt.propId,
        addType: opt.addType,
        name: opt.name,
        isPercent: opt.isPercent,
        value: rolls[rollIdx],
      });
    }
    commit(setEcho(api.build, slot, { ...echo, subStats: subs }));
  });

  on(root, "click", '[data-act="reset-echo-stats"]', (event, el) => {
    const slot = Number(el.dataset.slot),
      echo = api.build.echoes[slot];
    if (!echo) return;
    commit(
      setEcho(api.build, slot, {
        ...echo,
        subStats: [],
        mainStat: null,
        level: 25,
      }),
    );
  });

  on(root, "click", '[data-act="add-step"]', (event, el) => {
    let build = appendRotationStep(api.build, el.dataset.key);
    build = applyAutoTrigger(build, build.rotation.length - 1);
    commit(build);
  });
  on(root, "click", '[data-act="remove-step"]', (event, el) => {
    commit(removeRotationStep(api.build, Number(el.dataset.index)));
  });
  on(root, "click", '[data-act="rot-clear"]', () => {
    if (!api.build.rotation?.length) return;
    if (!confirm("Clear all rotation steps?")) return;
    commit(clearRotation(api.build));
  });
  on(root, "click", '[data-act="rot-template"]', () => {
    const rot = referenceRotationFor(api.build.resonatorId);
    if (!rot?.length) return;
    if (
      api.build.rotation?.length &&
      !confirm("Replace current rotation with the Prydwen template?")
    )
      return;
    commit({
      ...api.build,
      rotation: [...rot],
      rotationMeta: rot.map(() => ({})),
    });
  });
  on(root, "click", '[data-act="rot-save"]', () => {
    const rotation = api.build.rotation;
    if (!rotation?.length) return;
    const presets = listRotationPresets(api.build.resonatorId);
    const name = `Preset ${presets.length + 1}`;
    saveRotationPreset(api.build.resonatorId, name, rotation);
    showToast(`Rotation saved as "${name}"`);
    paint();
  });
  on(root, "click", '[data-act="rot-load"]', (event, el) => {
    if (
      api.rotLoadMenuAnchor === el &&
      api.rotLoadMenuEl?.classList.contains("is-open")
    ) {
      closeRotLoadMenu();
      return;
    }
    openRotLoadMenu(el);
  });
  bindRotationDragAndDrop(root);

  on(root, "click", '[data-act="dismiss-auto-notice"]', () => {
    api.autoInsertNotice = null;
    paint();
  });
  on(root, "click", '[data-act="fix-warning"]', (event, el) => {
    const warning = api.lastWarnings?.[Number(el.dataset.warnIndex)];
    if (!warning) return;
    commit(applyFix(api.build, warning));
  });
  on(root, "click", '[data-act="toggle-rot-hits"]', (event, el) => {
    const index = Number(el.dataset.index);
    api.rotStepExpanded = api.rotStepExpanded === index ? null : index;
    paint();
  });

  on(root, "click", '[data-act="toggle-dmg-row"]', (event, el) => {
    const key = el.dataset.key;
    if (api.dmgExpanded.has(key)) api.dmgExpanded.delete(key);
    else api.dmgExpanded.add(key);
    paint();
  });
  // 'change' (not 'input') — this is a full-page repaint, so committing on
  // every keystroke would blow away focus mid-type. Same reasoning as the
  // build-name field above.
  on(root, "change", '[data-act="dmg-enemy-level"]', (event, el) => {
    const value = Number(el.value);
    if (Number.isFinite(value) && value >= 1 && value <= 120) {
      api.dmgTarget.level = value;
      paint();
    }
  });
  on(root, "change", '[data-act="dmg-enemy-res"]', (event, el) => {
    const value = Number(el.value);
    if (Number.isFinite(value) && value >= -1 && value <= 2) {
      api.dmgTarget.res = value;
      paint();
    }
  });

  on(root, "change", '[data-act="echo-level"]', (event, el) => {
    const slot = Number(el.dataset.slot),
      echo = api.build.echoes[slot];
    if (!echo) return;
    const snapped = snapLevel(Number(el.value));
    let updated = { ...echo, level: snapped };
    if (updated.mainStat) {
      const value =
        mainStatValueFor(
          updated.mainStat,
          updated.cost,
          updated.starLevel ?? 5,
          snapped,
          api.dataset,
        ) ?? 0;
      updated = { ...updated, mainStat: { ...updated.mainStat, value } };
    }
    // Mirrors the classic editor: a lowered level can un-unlock substat
    // slots — trim from the end rather than leaving stale, uncounted-for
    // entries (the engine sums every subStats entry with no level check).
    const unlocked = unlockedSubStatCount(snapped);
    if ((updated.subStats?.length ?? 0) > unlocked)
      updated = {
        ...updated,
        subStats: updated.subStats.slice(0, unlocked),
      };
    commit(setEcho(api.build, slot, updated));
  });
}

// Same fixed target the classic editor's "Optimize echoes" button uses
// (Phase 5/6 scope: lv90 enemy, flat 10% RES) — kept identical so results
// are comparable between the classic and v2 pages.
export function defaultSimTarget(build) {
  return {
    level: 90,
    atkLv: build.level ?? 90,
    resistances: { 0: 0, 1: 0.1, 2: 0.1, 3: 0.1, 4: 0.1, 5: 0.1, 6: 0.1 },
  };
}

// Opens the v2 echo picker (docs/design_handoff_wuwa_sim/echo picker). Maps the
// dataset's echoes into the picker's presentation-only item shape and keeps the
// existing selection contract (fresh echo at lv25, first sonata, empty stats).
// Removal lives on the slot card's ✕, so the picker offers no unequip option.
export function openEchoPicker(slotIndex) {
  const items = api.dataset.echoes
    .filter((echo) => echo.name)
    .map((echo) => ({
      id: echo.id,
      name: echo.name,
      cost: echo.cost,
      elem: echo.activeSkill?.element ?? echo.elementTypes?.[0] ?? null,
      sonataIds: echo.sonataIds ?? [],
      iconUrl: echo.iconUrl,
      skill: echo.activeSkill?.name ?? "",
      desc: echoActiveSkillDesc(echo),
      starLevel: echo.starLevel ?? 5,
    }));

  // Sonata chips: only sets that actually appear among the echoes, sorted by
  // id. `desc` (2PC/5PC bonuses) drives the chip's set-detail hover-box.
  const presentSonataIds = new Set();
  for (const item of items)
    for (const sid of item.sonataIds) presentSonataIds.add(sid);
  const sonatas = (api.dataset.sonatas ?? [])
    .filter((sonata) => sonata.name && presentSonataIds.has(sonata.id))
    .sort((sonataA, sonataB) => sonataA.id - sonataB.id)
    .map((sonata) => ({
      id: sonata.id,
      name: sonata.name,
      desc: sonataTooltipDesc(sonata.id),
      elem: sonataElementId(sonata.id),
    }));

  echoPicker.open({
    slotIndex,
    theme: api.theme,
    items,
    sonatas,
    onPick: (item, { sonataFilter = null } = {}) => {
      // SWITCHING an existing echo keeps the user's rolled stats — only the
      // echo identity changes. Main stat carries over when the cost matches
      // (its options are cost-specific); substats + level always carry over.
      const prev = api.build.echoes[slotIndex];
      const sameCost = prev && prev.cost === item.cost;
      // If the grid was narrowed to ONE set, the user picked this echo *for*
      // that set — so equip it with that set rather than the echo's first.
      const sonataIds = item.sonataIds ?? [];
      const sonataId =
        sonataFilter != null && sonataIds.includes(sonataFilter) ?
          sonataFilter
        : (sonataIds[0] ?? null);
      const newEcho = {
        id: item.id,
        cost: item.cost,
        level: prev?.level ?? 25,
        starLevel: item.starLevel ?? 5,
        mainStat: sameCost ? (prev?.mainStat ?? null) : null,
        subStats: prev?.subStats ?? [],
        sonataId,
      };
      api.echoSlot = slotIndex;
      commit(setEcho(api.build, slotIndex, newEcho));
    },
  });
}

// Drag-and-drop reorder for rotation chips. Drop directly onto a target chip
// moves the dragged step to that chip's current index — simpler than the
// handoff's gap-based insertion zones, same end capability.
// Drag source is either an existing chip (reorder, dragSrcIndex set) or a
// palette button (insert-new, paletteDragKey set) — never both at once.
export function bindRotationDragAndDrop(root) {
  let dragSrcIndex = null;
  let paletteDragKey = null;
  let indicatorChip = null,
    indicatorSide = null;
  let indicatorSeq = null;

  function clearIndicator() {
    if (indicatorChip) indicatorChip.style.boxShadow = "";
    if (indicatorSeq) indicatorSeq.style.boxShadow = "";
    indicatorChip = null;
    indicatorSide = null;
    indicatorSeq = null;
  }

  root.addEventListener("dragstart", (event) => {
    const paletteBtn = event.target.closest('[data-act="add-step"]');
    if (paletteBtn) {
      paletteDragKey = paletteBtn.dataset.key;
      event.dataTransfer.effectAllowed = "copy";
      try {
        event.dataTransfer.setData("text/plain", paletteDragKey);
      } catch {}
      return;
    }
    const chip = event.target.closest(".rot2-chip");
    if (!chip) return;
    dragSrcIndex = Number(chip.dataset.index);
    chip.style.opacity = ".3";
    event.dataTransfer.effectAllowed = "move";
    try {
      event.dataTransfer.setData("text/plain", String(dragSrcIndex));
    } catch {}
  });
  root.addEventListener("dragend", (event) => {
    const chip = event.target.closest(".rot2-chip");
    if (chip) chip.style.opacity = "1";
    clearIndicator();
    dragSrcIndex = null;
    paletteDragKey = null;
  });
  root.addEventListener("dragover", (event) => {
    if (dragSrcIndex == null && paletteDragKey == null) return;
    const chip = event.target.closest(".rot2-chip");
    if (chip) {
      event.preventDefault();
      event.dataTransfer.dropEffect = dragSrcIndex != null ? "move" : "copy";
      const rect = chip.getBoundingClientRect();
      const side = event.clientX - rect.left < rect.width / 2 ? "left" : "right";
      if (chip !== indicatorChip || side !== indicatorSide) {
        clearIndicator();
        indicatorChip = chip;
        indicatorSide = side;
        chip.style.boxShadow =
          side === "left" ?
            "inset 3px 0 0 0 var(--acc), 0 0 8px color-mix(in srgb, var(--acc) 50%, transparent)"
          : "inset -3px 0 0 0 var(--acc), 0 0 8px color-mix(in srgb, var(--acc) 50%, transparent)";
      }
      return;
    }
    // Dropping on empty space within the sequence area (or the empty-rotation
    // placeholder) — only meaningful for a palette insert, which appends.
    const seq = event.target.closest(".rot2-seq");
    if (seq && paletteDragKey != null) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      if (seq !== indicatorSeq) {
        clearIndicator();
        indicatorSeq = seq;
        seq.style.boxShadow = "inset 0 0 0 1.5px var(--acc)";
      }
    }
  });
  root.addEventListener("dragleave", (event) => {
    if (
      indicatorChip &&
      event.target.closest(".rot2-chip") === indicatorChip &&
      !indicatorChip.contains(event.relatedTarget)
    )
      clearIndicator();
    if (
      indicatorSeq &&
      event.target.closest(".rot2-seq") === indicatorSeq &&
      !indicatorSeq.contains(event.relatedTarget)
    )
      clearIndicator();
  });
  root.addEventListener("drop", (event) => {
    const chip = event.target.closest(".rot2-chip");
    const seq = event.target.closest(".rot2-seq");
    const side = indicatorSide;
    clearIndicator();
    if (chip) {
      event.preventDefault();
      const toIndex = Number(chip.dataset.index);
      if (dragSrcIndex != null) {
        if (toIndex !== dragSrcIndex)
          commit(moveRotationStep(api.build, dragSrcIndex, toIndex));
      } else if (paletteDragKey != null) {
        let build = appendRotationStep(api.build, paletteDragKey);
        const target = side === "right" ? toIndex + 1 : toIndex;
        build = moveRotationStep(build, build.rotation.length - 1, target);
        build = applyAutoTrigger(build, target);
        commit(build);
      }
    } else if (seq && paletteDragKey != null) {
      event.preventDefault();
      let build = appendRotationStep(api.build, paletteDragKey);
      build = applyAutoTrigger(build, build.rotation.length - 1);
      commit(build);
    }
    dragSrcIndex = null;
    paletteDragKey = null;
  });
}

export function openWeaponPicker() {
  const resonator = resonatorOf();
  if (!resonator) return;
  openWeaponPickerModal({
    dataset: api.dataset,
    resonator: resonator,
    currentWeaponId: api.build.weapon?.id,
    onPick: (weapon) => commit(setWeapon(api.build, weapon ? weapon.id : null)),
  });
}

// Floating builds/resonator selector — same "old style" modal-picker the
// Party page uses on its resonator icon (openSlotPicker in team-editor-v2.js),
// reused here as a placeholder for switching the build page to a different
// saved build, or starting a fresh one for any roster resonator.
export function openResonatorPicker() {
  const builds = (api.listBuilds?.() ?? []).filter(
    (build) => build.id !== api.build.id,
  );
  const buildItems = builds.map((build) => {
    const resonator = api.dataset.resonators.find((x) => x.id === build.resonatorId);
    return {
      kind: "build",
      build: build,
      resonator: resonator,
      name: build.name,
      resoName: resonator?.name ?? "",
    };
  });
  const rosterItems = api.dataset.resonators.map((resonator) => ({
    kind: "roster",
    resonator: resonator,
    name: resonator.name,
    resoName: resonator.name,
  }));

  modal.open({
    title: "Switch build / resonator",
    items: [...buildItems, ...rosterItems],
    searchFields: ["name", "resoName"],
    filters: [
      {
        kind: "source",
        label: "Source",
        options: [
          {
            value: "build",
            label: "Saved builds",
            test: (item) => item.kind === "build",
          },
          {
            value: "roster",
            label: "Roster",
            test: (item) => item.kind === "roster",
          },
        ],
      },
    ],
    renderRow: (item) => {
      const resonator = item.resonator;
      const icon =
        resonator?.iconUrl ?
          `<img class="option__icon" src="${esc(resonator.iconUrl)}" alt="" loading="lazy" onerror="this.style.display='none'">`
        : `<span class="option__icon option__icon--missing"></span>`;
      const sub =
        item.kind === "build" ?
          `Saved build · Lv ${item.build.level}`
        : "Roster · new build";
      const badge = item.kind === "build" ? "B" : "R";
      return `${icon}
              <div class="option__body">
                <span class="option__name">${esc(item.name)}</span>
                <span class="option__sub">${esc(sub)}</span>
              </div>
              <span class="option__badge">${badge}</span>`;
    },
    onPick: (item) => {
      if (!item) return;
      if (item.kind === "build") api.onPickBuild?.(item.build.id);
      else api.onPickNewResonator?.(item.resonator.id);
    },
  });
}
