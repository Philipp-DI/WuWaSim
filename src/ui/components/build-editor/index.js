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
 *     onSave, onDuplicate, onDelete,         // Save/Duplicate/Delete buttons
 *     listBuilds, onPickBuild, onPickNewResonator, // resonator-icon picker
 *     toastOnMount,                          // one-shot toast (e.g. post-duplicate)
 *   }) → { update(next), notifySaved(msg) }
 * (The shared v2 header's nav/theme are bound once by app.js, not here.)
 *
 * Status: all 6 handoff panels are wired (Header, Resonator Card, Skill Levels,
 * Echoes, Stats, Rotation), plus the two gaps flagged in the handoff itself:
 * Sequence Node Descriptions (Resonator Card) and an Ability Damage Overview
 * card (per-skill resolveSkill breakdown, below Rotation).
 */

import { api, setApi } from "./state.js";
import { applyFix, computeFixTarget, groupPaletteEntries, renderRotation } from "./rotation.js";
import { applySuggestion, isEmptyBuild, renderSuggestedTeamsPanel } from "./suggested-teams-panel.js";
import { bind } from "./bind.js";
import { closeRotLoadMenu, closeSonataMenu } from "./menus.js";
import { dominantSonataId, renderEchoes } from "./echoes.js";
import { esc, html, raw, render } from "../../dom.js";
import { formatTipDesc } from "../../tip-format.js";
import { getV2Theme, renderV2Header } from "../v2-header.js";
import { hideTooltip } from "../../tooltip.js";
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
    onDuplicate,
    onDelete,
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
    theme: getV2Theme(),
    onSave,
    onDuplicate,
    onDelete,
    listBuilds,
    onPickBuild,
    onPickNewResonator,
    echoSlot:
      build.echoes.findIndex(Boolean) === -1 ?
        0
      : build.echoes.findIndex(Boolean),
    statMode: "balanced", // P12 Stat Priority panel: solo mode toggle
    dmgExpanded: new Set(),
    dmgTarget: { level: 90, res: 0.1 },
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
    // The neutral connector between the selected echo card and the substat box
    // squares the box's matching left corner from real layout (which slot is
    // selected, viewport width) — re-measure on resize. Reads api.root at
    // fire-time, so it stays correct across remounts.
    window.addEventListener("resize", () => squareEchoFrameCorners(api.root));
  }
  return {
    update(next) {
      api.build = next;
      paint();
    },
    notifySaved(msg = "Saved") {
      showToast(msg);
    },
  };
}

export function commit(next) {
  api.build = next;
  api.onChange?.(next);
  paint();
}

// =============================================================================
// Render
// =============================================================================

export function paint() {
  hideTooltip();
  closeSonataMenu();
  closeRotLoadMenu();
  render(api.root, renderPage());
  requestAnimationFrame(() => squareEchoFrameCorners(api.root));
}

// The selected echo card bridges into the substat box via a neutral connector
// (.bv2-echo-neck). WHERE the box's left corners should square off depends on
// which rail slot is selected relative to the box's real height, so it's
// measured after layout (rAF after paint + on resize), not via static CSS.
export function squareEchoFrameCorners(root) {
  const frame = root?.querySelector(".bv2-echo-frame");
  const neck = root?.querySelector(".bv2-echo-neck");
  if (!frame || !neck) return;
  const frameRect = frame.getBoundingClientRect(),
    neckRect = neck.getBoundingClientRect();
  frame.style.borderTopLeftRadius =
    Math.abs(neckRect.top - frameRect.top) < 15 ? "0px" : "14px";
  frame.style.borderBottomLeftRadius =
    Math.abs(neckRect.bottom - frameRect.bottom) < 15 ? "0px" : "14px";
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
        style="display:flex;flex-direction:column;padding:24px;gap:16px;max-width:1240px;margin:0 auto;"
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
};
