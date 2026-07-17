// src/ui/components/build-editor/menus.js — the three floating pickers: sonata menu, rotation-load menu, echo-load menu.
// Split from the monolithic build-editor-v2.js (Simplification Plan S4.2).
import { api } from "./state.js";
import { commit } from "./index.js";
import { deleteEchoPreset, deleteRotationPreset, listEchoPresets, listRotationPresets } from "../../../data/storage.js";
import { echoDefOf, sonataIconHtml, sonataOf } from "./shared.js";
import { esc } from "../../dom.js";
import { setEcho } from "../../../core/build.js";

// Hover-box tooltip (the handoff's fixed-position hover card) — showTooltip/
// hideTooltip/bindTooltipHover live in ../tooltip.js, shared with the team
// and compare pages. Hoverable elements carry data-tip-title/data-tip-desc
// instead of a native title attribute.

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
