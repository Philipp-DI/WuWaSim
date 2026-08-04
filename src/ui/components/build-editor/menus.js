// src/ui/components/build-editor/menus.js — the three floating pickers: sonata menu, rotation-load menu, echo-load menu.
// Split from the monolithic build-editor-v2.js (Simplification Plan S4.2).
import { api } from "./state.js";
import { commit } from "./index.js";
import { deleteEchoPreset, deleteRotationPreset, listEchoPresets, listRotationPresets } from "../../../data/storage.js";
import { echoDefOf, sonataIconHtml, sonataOf } from "./shared.js";
import { esc } from "../../dom.js";
import { setEcho } from "../../../core/build.js";
import { closeSonataQuickswitch } from "../sonata-quickswitch.js";
import { hideTooltip } from "../../tooltip.js";

// Hover-box tooltip (the handoff's fixed-position hover card) — showTooltip/
// hideTooltip/bindTooltipHover live in ../tooltip.js, shared with the team
// and compare pages. Hoverable elements carry data-tip-title/data-tip-desc
// instead of a native title attribute.

/**
 * Close every body-appended floating layer this page can open.
 *
 * They all live OUTSIDE the repainted `.bv2` subtree by design, so a repaint
 * cannot take them down — which means every repaint has to close them by hand.
 * `paint()` used to list them one by one and had missed the echo-load menu, so
 * it survived repaints as a `position:fixed; z-index:9999` panel anchored over
 * the echo rail, holding a stale anchor node. Its own outside-click guard then
 * counted clicks that landed on it as "inside" and swallowed them, which is
 * what made the main-stat dropdown under it stop opening.
 *
 * ONE list, so adding a floating layer cannot silently miss the teardown again.
 */
export function closeFloatingMenus() {
  hideTooltip();
  closeSonataMenu();
  closeSonataQuickswitch();
  closeRotLoadMenu();
  closeEchoLoadMenu();
  closeResetMenu();
  closeSaveDialog();
}

// Sonata quick-switch menu — same body-appended pattern as the tooltip above
// (survives outside the repainted .bv2 subtree), but interactive: clicking an
// option re-assigns the slot's sonataId among the echo's valid sets without
// opening the full echo picker. Quick fix ahead of the redesigned picker.
export function ensureSonataMenuEl() {
  if (api.sonataMenuEl) return api.sonataMenuEl;
  const el = document.createElement("div");
  el.className = "bv2-sonata-menu";
  document.body.appendChild(el);
  api.sonataMenuEl = el;
  return el;
}

export function closeSonataMenu() {
  if (!api.sonataMenuEl) return;
  api.sonataMenuEl.classList.remove("is-open");
  api.sonataMenuAnchor = null;
  if (api.sonataMenuClickHandler) {
    api.sonataMenuEl.removeEventListener("click", api.sonataMenuClickHandler);
    api.sonataMenuClickHandler = null;
  }
  if (api.sonataMenuOutsideHandler) {
    document.removeEventListener(
      "mousedown",
      api.sonataMenuOutsideHandler,
      true,
    );
    api.sonataMenuOutsideHandler = null;
  }
  if (api.sonataMenuKeyHandler) {
    document.removeEventListener("keydown", api.sonataMenuKeyHandler, true);
    api.sonataMenuKeyHandler = null;
  }
}

export function openSonataMenu(slotIndex, anchorEl) {
  const echo = api.build.echoes[slotIndex];
  const def = echoDefOf(echo);
  const choices = (def?.sonataIds ?? []).filter((id) => id != null);
  if (!echo || choices.length < 2) return;
  closeSonataMenu();

  const el = ensureSonataMenuEl();
  el.innerHTML = choices
    .map((id) => {
      const sonata = sonataOf(id);
      if (!sonata) return "";
      const active = id === echo.sonataId;
      // Body-appended menu (outside .bv2) — theme-independent literals, not var(--acc).
      return `<button type="button" class="bv2-sonata-menu__opt" data-sonata-id="${id}" data-slot="${slotIndex}" style="display:flex;align-items:center;gap:8px;width:100%;border:none;background:${active ? "color-mix(in srgb, var(--accent) 14%, transparent)" : "transparent"};padding:6px 10px;border-radius:7px;cursor:pointer;text-align:left;color:${active ? "var(--accent)" : "var(--popover-ink)"};font:inherit;font-size:12px;font-weight:600;">${sonataIconHtml(id, 20)}<span>${esc(sonata.name)}</span></button>`;
    })
    .join("");
  el.classList.add("is-open");

  const rect = anchorEl.getBoundingClientRect();
  const margin = 12;
  const overflowsRight = rect.left + el.offsetWidth > window.innerWidth - margin;
  el.style.left =
    Math.round(
      overflowsRight ? Math.max(margin, rect.right - el.offsetWidth) : rect.left,
    ) + "px";
  el.style.top = Math.round(rect.bottom + 6) + "px";

  const onOptClick = (event) => {
    const btn = event.target.closest(".bv2-sonata-menu__opt");
    if (!btn) return;
    const slot = Number(btn.dataset.slot);
    const newSonataId = Number(btn.dataset.sonataId);
    const current = api.build.echoes[slot];
    closeSonataMenu();
    if (current)
      commit(setEcho(api.build, slot, { ...current, sonataId: newSonataId }));
  };
  const onOutside = (event) => {
    if (el.contains(event.target) || anchorEl.contains(event.target)) return;
    closeSonataMenu();
  };
  const onKey = (event) => {
    if (event.key === "Escape") closeSonataMenu();
  };
  el.addEventListener("click", onOptClick);
  document.addEventListener("mousedown", onOutside, true);
  document.addEventListener("keydown", onKey, true);
  api.sonataMenuAnchor = anchorEl;
  api.sonataMenuClickHandler = onOptClick;
  api.sonataMenuOutsideHandler = onOutside;
  api.sonataMenuKeyHandler = onKey;
}

// =============================================================================
// Rotation load menu — body-appended dropdown of saved rotation presets.
// Pattern mirrors the sonata quick-switch menu above.
// =============================================================================

export function ensureRotLoadMenuEl() {
  if (api.rotLoadMenuEl) return api.rotLoadMenuEl;
  const el = document.createElement("div");
  el.className = "bv2-sonata-menu"; // reuse the same float-menu style
  document.body.appendChild(el);
  api.rotLoadMenuEl = el;
  return el;
}

export function closeRotLoadMenu() {
  if (!api.rotLoadMenuEl) return;
  api.rotLoadMenuEl.classList.remove("is-open");
  api.rotLoadMenuAnchor = null;
  if (api.rotLoadMenuClickHandler) {
    api.rotLoadMenuEl.removeEventListener("click", api.rotLoadMenuClickHandler);
    api.rotLoadMenuClickHandler = null;
  }
  if (api.rotLoadMenuOutsideHandler) {
    document.removeEventListener(
      "mousedown",
      api.rotLoadMenuOutsideHandler,
      true,
    );
    api.rotLoadMenuOutsideHandler = null;
  }
  if (api.rotLoadMenuKeyHandler) {
    document.removeEventListener("keydown", api.rotLoadMenuKeyHandler, true);
    api.rotLoadMenuKeyHandler = null;
  }
}

export function renderRotLoadMenuContent(resonatorId) {
  const presets = listRotationPresets(resonatorId);
  if (!presets.length) {
    return `<div style="padding:10px 12px;font-family:var(--font-body);font-size:12px;color:var(--faint);">No saved rotations yet.</div>`;
  }
  return presets
    .map(
      (preset) => `
      <div style="display:flex;align-items:center;gap:6px;padding:5px 8px;border-radius:7px;" data-preset-row>
        <div style="flex:1;min-width:0;">
          <div style="font-family:var(--font-body);font-weight:600;font-size:12px;color:var(--popover-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(preset.name)}</div>
          <div style="font-family:var(--font-display);font-size:9px;color:var(--dim);">${preset.rotation.length} step${preset.rotation.length === 1 ? "" : "s"}</div>
        </div>
        <button data-act="rot-load-apply" data-preset-id="${esc(preset.id)}" style="font-family:var(--font-display);font-weight:700;font-size:9.5px;letter-spacing:.5px;padding:4px 9px;border-radius:6px;cursor:pointer;background:var(--acc);border:none;color:var(--on-acc);">APPLY</button>
        <button data-act="rot-load-delete" data-preset-id="${esc(preset.id)}" style="font-family:var(--font-display);font-size:11px;padding:4px 7px;border-radius:6px;cursor:pointer;background:transparent;border:1px solid color-mix(in srgb, var(--warn) 40%, transparent);color:var(--warn);">✕</button>
      </div>`,
    )
    .join("");
}

export function openRotLoadMenu(anchorEl) {
  closeRotLoadMenu();
  const el = ensureRotLoadMenuEl();
  const resonatorId = api.build.resonatorId;

  function refresh() {
    el.innerHTML = renderRotLoadMenuContent(resonatorId);
  }
  refresh();
  el.classList.add("is-open");

  const rect = anchorEl.getBoundingClientRect();
  const margin = 12;
  const overflowsRight = rect.left + el.offsetWidth > window.innerWidth - margin;
  el.style.left =
    Math.round(
      overflowsRight ? Math.max(margin, rect.right - el.offsetWidth) : rect.left,
    ) + "px";
  el.style.top = Math.round(rect.bottom + 6) + "px";

  const onClick = (event) => {
    const applyBtn = event.target.closest('[data-act="rot-load-apply"]');
    const deleteBtn = event.target.closest('[data-act="rot-load-delete"]');
    if (applyBtn) {
      const presets = listRotationPresets(resonatorId);
      const preset = presets.find((candidate) => candidate.id === applyBtn.dataset.presetId);
      if (!preset) return;
      closeRotLoadMenu();
      commit({
        ...api.build,
        rotation: [...preset.rotation],
        rotationMeta: preset.rotation.map(() => ({})),
      });
    } else if (deleteBtn) {
      deleteRotationPreset(resonatorId, deleteBtn.dataset.presetId);
      refresh();
    }
  };
  const onOutside = (event) => {
    if (el.contains(event.target) || anchorEl.contains(event.target)) return;
    closeRotLoadMenu();
  };
  const onKey = (event) => {
    if (event.key === "Escape") closeRotLoadMenu();
  };
  el.addEventListener("click", onClick);
  document.addEventListener("mousedown", onOutside, true);
  document.addEventListener("keydown", onKey, true);
  api.rotLoadMenuAnchor = anchorEl;
  api.rotLoadMenuClickHandler = onClick;
  api.rotLoadMenuOutsideHandler = onOutside;
  api.rotLoadMenuKeyHandler = onKey;
}

// =============================================================================
// Echo load menu — body-appended dropdown of saved echo loadout presets.
// Pattern mirrors the rotation load menu above.
// =============================================================================

export function ensureEchoLoadMenuEl() {
  if (api.echoLoadMenuEl) return api.echoLoadMenuEl;
  const el = document.createElement("div");
  el.className = "bv2-sonata-menu"; // reuse the same float-menu style
  document.body.appendChild(el);
  api.echoLoadMenuEl = el;
  return el;
}

export function closeEchoLoadMenu() {
  if (!api.echoLoadMenuEl) return;
  api.echoLoadMenuEl.classList.remove("is-open");
  api.echoLoadMenuAnchor = null;
  if (api.echoLoadMenuClickHandler) {
    api.echoLoadMenuEl.removeEventListener(
      "click",
      api.echoLoadMenuClickHandler,
    );
    api.echoLoadMenuClickHandler = null;
  }
  if (api.echoLoadMenuOutsideHandler) {
    document.removeEventListener(
      "mousedown",
      api.echoLoadMenuOutsideHandler,
      true,
    );
    api.echoLoadMenuOutsideHandler = null;
  }
  if (api.echoLoadMenuKeyHandler) {
    document.removeEventListener("keydown", api.echoLoadMenuKeyHandler, true);
    api.echoLoadMenuKeyHandler = null;
  }
}

export function renderEchoLoadMenuContent(resonatorId) {
  const presets = listEchoPresets(resonatorId);
  if (!presets.length) {
    return `<div style="padding:10px 12px;font-family:var(--font-body);font-size:12px;color:var(--faint);">No saved echo loadouts yet.</div>`;
  }
  return presets
    .map((preset) => {
      const count = preset.echoes.filter(Boolean).length;
      return `
      <div style="display:flex;align-items:center;gap:6px;padding:5px 8px;border-radius:7px;" data-preset-row>
        <div style="flex:1;min-width:0;">
          <div style="font-family:var(--font-body);font-weight:600;font-size:12px;color:var(--popover-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(preset.name)}</div>
          <div style="font-family:var(--font-display);font-size:9px;color:var(--dim);">${count} echo${count === 1 ? "" : "es"}</div>
        </div>
        <button data-act="echo-load-apply" data-preset-id="${esc(preset.id)}" style="font-family:var(--font-display);font-weight:700;font-size:9.5px;letter-spacing:.5px;padding:4px 9px;border-radius:6px;cursor:pointer;background:var(--acc);border:none;color:var(--on-acc);">APPLY</button>
        <button data-act="echo-load-delete" data-preset-id="${esc(preset.id)}" style="font-family:var(--font-display);font-size:11px;padding:4px 7px;border-radius:6px;cursor:pointer;background:transparent;border:1px solid color-mix(in srgb, var(--warn) 40%, transparent);color:var(--warn);">✕</button>
      </div>`;
    })
    .join("");
}

export function openEchoLoadMenu(anchorEl) {
  closeEchoLoadMenu();
  const el = ensureEchoLoadMenuEl();
  const resonatorId = api.build.resonatorId;

  function refresh() {
    el.innerHTML = renderEchoLoadMenuContent(resonatorId);
  }
  refresh();
  el.classList.add("is-open");

  const rect = anchorEl.getBoundingClientRect();
  const margin = 12;
  const overflowsRight = rect.left + el.offsetWidth > window.innerWidth - margin;
  el.style.left =
    Math.round(
      overflowsRight ? Math.max(margin, rect.right - el.offsetWidth) : rect.left,
    ) + "px";
  el.style.top = Math.round(rect.bottom + 6) + "px";

  const onClick = (event) => {
    const applyBtn = event.target.closest('[data-act="echo-load-apply"]');
    const deleteBtn = event.target.closest('[data-act="echo-load-delete"]');
    if (applyBtn) {
      const presets = listEchoPresets(resonatorId);
      const preset = presets.find((candidate) => candidate.id === applyBtn.dataset.presetId);
      if (!preset) return;
      closeEchoLoadMenu();
      commit({
        ...api.build,
        echoes: preset.echoes.map((echo) => (echo ? { ...echo } : null)),
      });
    } else if (deleteBtn) {
      deleteEchoPreset(resonatorId, deleteBtn.dataset.presetId);
      refresh();
    }
  };
  const onOutside = (event) => {
    if (el.contains(event.target) || anchorEl.contains(event.target)) return;
    closeEchoLoadMenu();
  };
  const onKey = (event) => {
    if (event.key === "Escape") closeEchoLoadMenu();
  };
  el.addEventListener("click", onClick);
  document.addEventListener("mousedown", onOutside, true);
  document.addEventListener("keydown", onKey, true);
  api.echoLoadMenuAnchor = anchorEl;
  api.echoLoadMenuClickHandler = onClick;
  api.echoLoadMenuOutsideHandler = onOutside;
  api.echoLoadMenuKeyHandler = onKey;
}

// =============================================================================
// Reset menu — small anchored dropdown for the RESET action (replaces the old
// destructive Delete button on the build editor; deleting a build outright is
// now exclusively a My Builds page action). Offers a 3-way choice: reset back
// to the template defaults, reset to a fully empty build, or cancel. Pattern
// mirrors the sonata quick-switch menu above.
// =============================================================================

export function ensureResetMenuEl() {
  if (api.resetMenuEl) return api.resetMenuEl;
  const el = document.createElement("div");
  el.className = "bv2-sonata-menu"; // reuse the same float-menu style
  document.body.appendChild(el);
  api.resetMenuEl = el;
  return el;
}

export function closeResetMenu() {
  if (!api.resetMenuEl) return;
  api.resetMenuEl.classList.remove("is-open");
  api.resetMenuAnchor = null;
  if (api.resetMenuClickHandler) {
    api.resetMenuEl.removeEventListener("click", api.resetMenuClickHandler);
    api.resetMenuClickHandler = null;
  }
  if (api.resetMenuOutsideHandler) {
    document.removeEventListener("mousedown", api.resetMenuOutsideHandler, true);
    api.resetMenuOutsideHandler = null;
  }
  if (api.resetMenuKeyHandler) {
    document.removeEventListener("keydown", api.resetMenuKeyHandler, true);
    api.resetMenuKeyHandler = null;
  }
}

const RESET_OPT_STYLE = "display:flex;align-items:center;width:100%;border:none;background:transparent;padding:7px 10px;border-radius:7px;cursor:pointer;text-align:left;color:var(--popover-ink);font:inherit;font-size:12px;font-weight:600;";
const RESET_CANCEL_STYLE = "display:flex;align-items:center;width:100%;border:none;background:transparent;padding:7px 10px;border-radius:7px;cursor:pointer;text-align:left;color:var(--dim);font:inherit;font-size:11.5px;font-weight:600;";

// onTemplate/onEmpty are called with no args — the caller (bind.js) already
// has the resonator/build context to compute the replacement content.
export function openResetMenu(anchorEl, { onTemplate, onEmpty }) {
  closeResetMenu();
  const el = ensureResetMenuEl();

  el.innerHTML = `
      <button type="button" class="bv2-sonata-menu__opt" data-reset-act="template" style="${RESET_OPT_STYLE}">Reset to Template</button>
      <button type="button" class="bv2-sonata-menu__opt" data-reset-act="empty" style="${RESET_OPT_STYLE}">Reset to Empty</button>
      <div style="height:1px;background:var(--popover-border);margin:4px 2px;"></div>
      <button type="button" class="bv2-sonata-menu__opt" data-reset-act="cancel" style="${RESET_CANCEL_STYLE}">Cancel</button>`;
  el.classList.add("is-open");

  const rect = anchorEl.getBoundingClientRect();
  const margin = 12;
  const overflowsRight = rect.left + el.offsetWidth > window.innerWidth - margin;
  el.style.left =
    Math.round(
      overflowsRight ? Math.max(margin, rect.right - el.offsetWidth) : rect.left,
    ) + "px";
  el.style.top = Math.round(rect.bottom + 6) + "px";

  const onOptClick = (event) => {
    const btn = event.target.closest("[data-reset-act]");
    if (!btn) return;
    const act = btn.dataset.resetAct;
    closeResetMenu();
    if (act === "template") onTemplate?.();
    else if (act === "empty") onEmpty?.();
    // "cancel" (or anything else): no-op, already closed.
  };
  const onOutside = (event) => {
    if (el.contains(event.target) || anchorEl.contains(event.target)) return;
    closeResetMenu();
  };
  const onKey = (event) => {
    if (event.key === "Escape") closeResetMenu();
  };
  el.addEventListener("click", onOptClick);
  document.addEventListener("mousedown", onOutside, true);
  document.addEventListener("keydown", onKey, true);
  api.resetMenuAnchor = anchorEl;
  api.resetMenuClickHandler = onOptClick;
  api.resetMenuOutsideHandler = onOutside;
  api.resetMenuKeyHandler = onKey;
}

// =============================================================================
// Save-name dialog — a small centered modal for "Save & add to My Builds",
// replacing window.prompt(). Native prompt()/confirm()/alert() render as a
// silent no-op (returns null immediately, no dialog ever shown) in several
// embedded/sandboxed browser contexts — e.g. VS Code's Simple Browser — which
// makes a button that depends on prompt() read as completely non-functional
// there while working fine in a standalone browser. Body-appended, same
// pattern as the other floating layers; unlike the small anchored menus above
// this is a centered backdrop overlay (a name entry is a modal action, not a
// quick anchored choice).
// =============================================================================

export function ensureSaveDialogEl() {
  if (api.saveDialogEl) return api.saveDialogEl;
  const el = document.createElement("div");
  document.body.appendChild(el);
  api.saveDialogEl = el;
  return el;
}

export function closeSaveDialog() {
  if (!api.saveDialogEl) return;
  api.saveDialogEl.innerHTML = "";
  if (api.saveDialogKeyHandler) {
    document.removeEventListener("keydown", api.saveDialogKeyHandler, true);
    api.saveDialogKeyHandler = null;
  }
}

/**
 * Open the save-name dialog. `onConfirm(name)` fires with the trimmed value
 * (falling back to `defaultName` if cleared blank) when the user confirms via
 * the Save button or Enter; Cancel/Escape/backdrop-click close with no call.
 */
export function openSaveDialog({ title, defaultName, confirmLabel = "Save", onConfirm }) {
  closeSaveDialog();
  const el = ensureSaveDialogEl();

  el.innerHTML = `
      <div data-save-dialog="backdrop" style="position:fixed;inset:0;z-index:10000;background:rgba(var(--scrim-rgb),.75);display:flex;align-items:center;justify-content:center;padding:24px;">
        <div data-save-dialog="panel" style="width:min(380px,100%);background:var(--popover-bg);border:1px solid var(--popover-border);border-radius:14px;padding:18px 20px;box-shadow:0 24px 60px rgba(var(--shadow-rgb),.7);">
          <div style="font-family:var(--font-display);font-weight:700;font-size:13px;letter-spacing:.5px;color:var(--popover-title);margin-bottom:12px;">${esc(title)}</div>
          <input type="text" data-save-dialog="input" value="${esc(defaultName)}" style="width:100%;background:var(--inp);border:1px solid var(--bd);border-radius:9px;padding:9px 11px;font-family:var(--font-body);font-size:13px;color:var(--txt);outline:none;box-sizing:border-box;">
          <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;">
            <button type="button" data-save-dialog="cancel" style="font-family:var(--font-display);font-weight:700;font-size:11px;letter-spacing:.5px;padding:8px 14px;border-radius:7px;cursor:pointer;background:var(--btn);border:1px solid var(--btnbd);color:var(--dim);">CANCEL</button>
            <button type="button" data-save-dialog="confirm" style="font-family:var(--font-display);font-weight:700;font-size:11px;letter-spacing:.5px;padding:8px 14px;border-radius:7px;cursor:pointer;background:var(--acc);border:none;color:var(--on-acc);">${esc(confirmLabel.toUpperCase())}</button>
          </div>
        </div>
      </div>`;

  const input = el.querySelector('[data-save-dialog="input"]');
  const submit = () => {
    const value = input.value.trim() || defaultName;
    closeSaveDialog();
    onConfirm?.(value);
  };
  el.addEventListener("click", (event) => {
    const target = event.target.closest("[data-save-dialog]");
    if (!target) return;
    const which = target.dataset.saveDialog;
    if (which === "confirm") submit();
    else if (which === "cancel" || which === "backdrop") closeSaveDialog();
    // "panel"/"input": inside the dialog, no action.
  });
  const onKey = (event) => {
    if (event.key === "Escape") closeSaveDialog();
    else if (event.key === "Enter") submit();
  };
  document.addEventListener("keydown", onKey, true);
  api.saveDialogKeyHandler = onKey;

  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
}
