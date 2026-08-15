/**
 * Build Page v2 — implementation of docs/design_handoff_wuwa_sim.
 *
 * The build page. Mounted by app.js on the #new/<id> and #edit2/<id> routes.
 * Wires the handoff's panels to the real engine (resolveTotalStats, build
 * mutators, simulateRotation). Visual tokens come from the single source-of-
 * truth token file (styles/tokens.css); the `.bv2` scope carries the surface
 * palette + active theme.
 *
 *   mount(root, {
 *     dataset, build, onChange,
 *     onSave, onSaveAndAdd,                  // Save / "Save & add to My Builds" buttons
 *     listBuilds, onPickBuild, onPickNewResonator, // resonator-icon picker
 *     toastOnMount,                          // one-shot toast (e.g. post-save)
 *   }) → { update(next), notifySaved(msg) }
 * (The shared v2 header's nav/theme are bound once by app.js, not here.)
 *
 * Status: all 6 handoff panels are wired (Header, Resonator Card, Skill Levels,
 * Echoes, Stats, Rotation), plus the two gaps flagged in the handoff itself:
 * Sequence Node Descriptions (Resonator Card) and an Ability Damage Overview
 * card (per-skill resolveSkill breakdown, below Rotation).
 */

import { api, setApi } from "./state.js";
import { createHistory } from "../../history.js";
import { DEFAULT_ENEMY_LEVEL, DEFAULT_ENEMY_RES } from "../../../core/target.js";
import { applyFix, computeFixTarget, groupPaletteEntries, renderRotation } from "./rotation.js";
import { applySuggestion, defaultFreshBuild, isEmptyBuild, renderSuggestedTeamsPanel } from "./suggested-teams-panel.js";
import { bind } from "./bind.js";
import { closeFloatingMenus } from "./menus.js";
import { dominantSonataId, renderEchoes } from "./echoes.js";
import { esc, html, raw, render } from "../../dom.js";
import { formatTipDesc } from "../../tip-format.js";
import { getV2Theme, renderV2Header } from "../v2-header.js";
import { renderAbilityDamageOverview } from "./ability-overview.js";
import { renderResonatorCard, renderSkillLevels } from "./resonator-card.js";
import { renderBottomStrip, renderTopStrip } from "./strips.js";
import { renderStatPriority, statPriorityPanelHtml } from "./stat-priority.js";
import { renderStats } from "./stats-panel.js";

export function mount(
  root,
  {
    dataset,
    meta,
    referenceRotations,
    build,
    onChange,
    onSave,
    onSaveAndAdd,
    listBuilds,
    onPickBuild,
    onPickNewResonator,
    toastOnMount,
  },
) {
  setApi({
    root,
    dataset,
    meta: meta ?? null,
    referenceRotations: referenceRotations ?? null,
    build,
    onChange,
    // Undo/redo stack of build snapshots — fresh per mount (opening a build
    // starts with an empty history). commit() records; undo()/redo() walk it.
    history: createHistory(),
    theme: getV2Theme(),
    onSave,
    onSaveAndAdd,
    listBuilds,
    onPickBuild,
    onPickNewResonator,
    echoSlot:
      build.echoes.findIndex(Boolean) === -1 ?
        0
      : build.echoes.findIndex(Boolean),
    // Transient sonata quick-switch preview (origSonataId → newSonataId), or
    // null. NEVER persisted or in undo history — a preview to gauge damage, not
    // an edit (see core/sonata-override.js, shared.js simBuild).
    sonataOverride: null,
    statMode: "balanced", // P12 Stat Priority panel: solo mode toggle
    dmgExpanded: new Set(),
    dmgTarget: { level: DEFAULT_ENEMY_LEVEL, res: DEFAULT_ENEMY_RES },
    autoInsertNotice: null,
    rotStepExpanded: null,
    toast: null,
    toastTimer: null,
    rotLoadMenuEl: null,
    rotLoadMenuAnchor: null,
    rotLoadMenuClickHandler: null,
    rotLoadMenuOutsideHandler: null,
    rotLoadMenuKeyHandler: null,
    echoLoadMenuEl: null,
    echoLoadMenuAnchor: null,
    echoLoadMenuClickHandler: null,
    echoLoadMenuOutsideHandler: null,
    echoLoadMenuKeyHandler: null,
    resetMenuEl: null,
    resetMenuAnchor: null,
    resetMenuClickHandler: null,
    resetMenuOutsideHandler: null,
    resetMenuKeyHandler: null,
    saveDialogEl: null,
    saveDialogKeyHandler: null,
  });
  paint();
  if (toastOnMount) showToast(toastOnMount);
  // Guard: bind once per root. Handlers close over the module-level `api`,
  // which mount() reassigns each time, so re-mounting (navigating back here)
  // must not restack delegated listeners on the persistent #main root. The
  // shared header's nav/theme controls are bound once by app.js, not here.
  if (!root.__bv2Bound) {
    root.__bv2Bound = true;
    bind();
    // The echoes coherent-form outline (card + substat box, one SVG path) is
    // traced from real layout (which slot is selected, viewport width) — so it
    // must re-measure on resize. Reads api.root at fire-time, so it stays
    // correct across remounts.
    window.addEventListener("resize", () => computeEchoOutline(api.root));
    window.addEventListener("keydown", handleUndoRedoKey);
  }
  return {
    update(next) {
      api.build = next;
      api.sonataOverride = null; // a different build: drop any stale preview
      paint();
    },
    notifySaved(msg = "Saved") {
      showToast(msg);
    },
  };
}

export function commit(next) {
  // Record the state this edit replaces so undo/redo can walk build history.
  // Skip no-op commits (a mutator that returned the same reference) so they
  // don't leave dead undo steps.
  if (next !== api.build) api.history?.record(api.build);
  api.build = next;
  api.onChange?.(next);
  paint();
}

// Undo/redo restore a prior build snapshot. They bypass commit()'s record (which
// would push the just-undone state back and wipe the redo branch) — the history
// stack itself stashes the current state for the opposite move. onChange keeps
// the autosave in sync with whatever was restored.
export function undo() {
  const restored = api.history?.undo(api.build);
  if (restored == null) return;
  api.build = restored;
  api.onChange?.(restored);
  paint();
}
export function redo() {
  const restored = api.history?.redo(api.build);
  if (restored == null) return;
  api.build = restored;
  api.onChange?.(restored);
  paint();
}

// Ctrl/Cmd+Z = undo, Ctrl/Cmd+Shift+Z or Ctrl+Y = redo. Bound once on window
// (see mount); reads the live `api`, so it follows whichever build is mounted.
// No-ops off the build-editor routes and while a text field is focused (leaving
// that field's native text undo intact).
function handleUndoRedoKey(event) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
  const key = event.key.toLowerCase();
  if (key !== "z" && key !== "y") return;
  const hash = location.hash;
  if (!hash.startsWith("#edit2") && !hash.startsWith("#new")) return;
  if (
    event.target?.matches?.(
      'input[type="text"], input[type="search"], input[type="number"], input:not([type]), textarea, [contenteditable="true"]',
    )
  )
    return;
  event.preventDefault();
  if (key === "y" || event.shiftKey) redo();
  else undo();
}

// =============================================================================
// Render
// =============================================================================

export function paint() {
  closeFloatingMenus();
  render(api.root, renderPage());
  requestAnimationFrame(() => computeEchoOutline(api.root));
}

// Set the transient sonata preview (or null to clear it) and repaint. Unlike
// commit(), this does NOT touch onChange/autosave or undo history — the preview
// is not an edit. simBuild()'s cache keys on the override object identity, so
// passing a fresh (normalized) object here re-sims every panel.
export function setSonataOverride(next) {
  api.sonataOverride = next ?? null;
  paint();
}

// The selected echo card + substat box read as ONE coherent form, and its
// entire outline is a SINGLE SVG path. Drawing it as one element (rather than
// three overlapping 1px borders) is what makes it robust to fractional-zoom
// device-pixel rounding — every edge rounds together, so no seam jumps or
// stubs. The path is a rounded box with a notch on its left where the selected
// card's tab plugs in; the notch's Y range comes from the card's real position,
// so it's measured after layout (rAF after paint + on resize), not static CSS.
export function computeEchoOutline(root) {
  const body = root?.querySelector(".bv2-echo-body");
  const path = body?.querySelector(".bv2-echo-outline path");
  const frame = body?.querySelector(".bv2-echo-frame");
  if (!body || !path) return;
  if (!frame) {
    path.setAttribute("d", "");
    return;
  }
  const origin = body.getBoundingClientRect();
  const rel = (element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left - origin.left,
      top: rect.top - origin.top,
      right: rect.right - origin.left,
      bottom: rect.bottom - origin.top,
    };
  };
  const card = body.querySelector(
    ".bv2-echo-card.is-selected, .bv2-echo-card.is-selected-main",
  );
  const box = rel(frame);
  const tab = card ? rel(card) : null;
  path.setAttribute("d", echoOutlinePath(box, tab));

  // Square ONLY the box corner that is actually flush with the selected card
  // (same test as echoOutlinePath) so the fill meets the card cleanly there, and
  // keep it ROUNDED otherwise. This is driven by measured geometry, NOT the slot
  // index: a narrow width can wrap the substat groups taller and grow the box
  // BELOW the last card, at which point that corner is no longer flush and a
  // static square would jut a sharp corner into the rail's empty tail.
  const BOX_RADIUS = 14; // must match echoOutlinePath + .bv2-echo-frame border-radius
  const topFlush = tab != null && tab.top - box.top <= BOX_RADIUS + 1;
  const botFlush = tab != null && box.bottom - tab.bottom <= BOX_RADIUS + 1;
  frame.style.borderTopLeftRadius = topFlush ? "0px" : "";
  frame.style.borderBottomLeftRadius = botFlush ? "0px" : "";

  // Drop the WHOLE active-skill section (heading included) when the box is too
  // cramped to show a useful amount — otherwise a lone "ACTIVE SKILL" title
  // lingers over no text. visibility (not display) keeps the element's measured
  // height stable, so this can never feed back into the height it reads.
  const skilldesc = frame.querySelector(".bv2-echo-skilldesc");
  if (skilldesc) skilldesc.style.visibility = skilldesc.clientHeight < 34 ? "hidden" : "";
}

// Build the coherent-form outline path. `box` is the substat frame; `tab` is the
// selected card (or null for an empty slot → plain rounded box). The tab plugs
// into the box's LEFT side; when it reaches the box's top/bottom the shared
// corner is the tab's (flush), otherwise the box's left border notches around
// it. Coordinates are snapped to pixel centres (x.5) so the 1px stroke is crisp.
export function echoOutlinePath(box, tab) {
  const snap = (value) => Math.round(value) + 0.5;
  // MUST match the elements' own border-radius (.bv2-echo-frame 14px,
  // .bv2-echo-card 12px) — the path traces their border-box edge, so a smaller
  // radius here lets the fill bulge outside the stroke at every corner.
  const boxRadius = 14;
  const left = snap(box.left),
    top = snap(box.top),
    right = snap(box.right),
    bottom = snap(box.bottom);
  if (!tab) {
    return (
      `M ${left + boxRadius} ${top} L ${right - boxRadius} ${top} A ${boxRadius} ${boxRadius} 0 0 1 ${right} ${top + boxRadius}` +
      ` L ${right} ${bottom - boxRadius} A ${boxRadius} ${boxRadius} 0 0 1 ${right - boxRadius} ${bottom}` +
      ` L ${left + boxRadius} ${bottom} A ${boxRadius} ${boxRadius} 0 0 1 ${left} ${bottom - boxRadius}` +
      ` L ${left} ${top + boxRadius} A ${boxRadius} ${boxRadius} 0 0 1 ${left + boxRadius} ${top} Z`
    );
  }
  const tabRadius = 12;
  const tabLeft = snap(tab.left),
    tabTop = snap(tab.top),
    tabBottom = snap(tab.bottom);
  const topFlush = tab.top - box.top <= boxRadius + 1;
  const botFlush = box.bottom - tab.bottom <= boxRadius + 1;
  const parts = [];
  // Top edge (clockwise): starts at the tab's top-left when the tab is flush
  // with the box top, else at the box's own top-left corner.
  parts.push(
    topFlush ?
      `M ${tabLeft + tabRadius} ${top} L ${right - boxRadius} ${top} A ${boxRadius} ${boxRadius} 0 0 1 ${right} ${top + boxRadius}`
    : `M ${left + boxRadius} ${top} L ${right - boxRadius} ${top} A ${boxRadius} ${boxRadius} 0 0 1 ${right} ${top + boxRadius}`,
  );
  // Right edge + bottom edge down to the bottom-left corner.
  parts.push(`L ${right} ${bottom - boxRadius} A ${boxRadius} ${boxRadius} 0 0 1 ${right - boxRadius} ${bottom}`);
  if (botFlush) {
    // Tab reaches the bottom: bottom-left corner is the tab's.
    parts.push(`L ${tabLeft + tabRadius} ${bottom} A ${tabRadius} ${tabRadius} 0 0 1 ${tabLeft} ${bottom - tabRadius}`);
  } else {
    // Box bottom-left corner, up the box's left edge to the tab, then the tab's
    // bottom edge + bottom-left corner (the lower half of the notch).
    parts.push(`L ${left + boxRadius} ${bottom} A ${boxRadius} ${boxRadius} 0 0 1 ${left} ${bottom - boxRadius}`);
    parts.push(`L ${left} ${tabBottom} L ${tabLeft + tabRadius} ${tabBottom} A ${tabRadius} ${tabRadius} 0 0 1 ${tabLeft} ${tabBottom - tabRadius}`);
  }
  // Up the tab's left edge; then either close at the tab top (flush) or trace
  // the upper half of the notch and up the box's left edge to the top-left.
  if (topFlush) {
    parts.push(`L ${tabLeft} ${top + tabRadius} A ${tabRadius} ${tabRadius} 0 0 1 ${tabLeft + tabRadius} ${top} Z`);
  } else {
    parts.push(`L ${tabLeft} ${tabTop + tabRadius} A ${tabRadius} ${tabRadius} 0 0 1 ${tabLeft + tabRadius} ${tabTop}`);
    parts.push(`L ${left} ${tabTop} L ${left} ${top + boxRadius} A ${boxRadius} ${boxRadius} 0 0 1 ${left + boxRadius} ${top} Z`);
  }
  return parts.join(" ");
}

export function renderPage() {
  return html`
    <div
      class="bv2"
      data-theme="${api.theme}"
    >
      ${raw(renderHeader())}
      ${raw(renderTopStrip())}
      <div
        style="display:flex;flex-direction:column;padding:24px 24px 76px;gap:16px;max-width:1240px;margin:0 auto;"
      >
        ${raw(renderResonatorCard())} ${raw(renderSkillLevels())}
        ${raw(renderEchoes())} ${raw(renderStats())}
        ${raw(renderStatPriority())} ${raw(renderSuggestedTeamsPanel())}
        ${raw(renderRotation())} ${raw(renderAbilityDamageOverview())}
      </div>
      ${raw(renderBottomStrip())}
      ${raw(renderToast())}
    </div>
  `;
}

// "Saved" confirmation toast — mirrors team-editor-v2.js's bv2-party-toast
// pattern (fixed bottom-center, auto-dismiss), fired on every successful
// save (manual Save click or debounced autosave via notifySaved()).
export function renderToast() {
  if (!api.toast) return "";
  return `
      <div class="bv2-build-toast" style="position:fixed;left:50%;bottom:56px;transform:translateX(-50%);z-index:50;display:flex;align-items:center;gap:8px;padding:10px 18px;border-radius:10px;background:var(--card2);border:1px solid var(--acc);box-shadow:0 10px 30px -10px rgba(var(--shadow-rgb),.6);">
        <span style="width:7px;height:7px;border-radius:50%;background:var(--acc);box-shadow:0 0 8px var(--acc);flex:none;"></span>
        <span style="font-family:var(--font-display);font-size:11.5px;letter-spacing:.4px;color:var(--txt);">${esc(api.toast)}</span>
      </div>`;
}

export function showToast(msg) {
  api.toast = msg;
  clearTimeout(api.toastTimer);
  // `api` is reassigned on every mount() (navigating to a different build
  // re-mounts this module). Without pinning the instance this timer fires
  // against, navigating away (e.g. Duplicate -> new build -> back) within
  // the 2.2s window would clear/repaint a build page the user already left.
  const self = api;
  api.toastTimer = setTimeout(() => {
    if (api !== self) return;
    api.toast = null;
    paint();
  }, 2200);
  paint();
}

export function renderHeader() {
  // Not sticky here: the top HUD strip (renderTopStrip) is sticky at top:0 and
  // takes over the top edge as the header scrolls away — a seamless handoff
  // instead of the strip overlapping a pinned header (which would leave the
  // header's active-tab glow bleeding below the strip).
  return renderV2Header({ active: "build", theme: api.theme, sticky: false });
}

// Pure helpers exposed for unit testing (tests/build-editor-v2.test.mjs). These
// take all inputs as arguments and never touch module `api` state, so they are
// safe to import and exercise without a DOM. UI-bound code (paint/bind/commit)
// is deliberately not exported.
export const __test__ = {
  formatTipDesc,
  groupPaletteEntries,
  computeFixTarget,
  applyFix,
  dominantSonataId,
  statPriorityPanelHtml,
  applySuggestion,
  isEmptyBuild,
  defaultFreshBuild,
};
