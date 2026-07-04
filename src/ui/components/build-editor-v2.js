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

import { html, raw, render, on, esc } from "../dom.js";
import * as modal from "./modal-picker.js";
import * as echoPicker from "./echo-picker-v2.js";
import { resolveTotalStats } from "../../core/stats.js";
import { resolveSkill, resolveSupport } from "../../core/skill.js";
import {
  setLevel,
  setChain,
  setResonanceMode,
  setName,
  setWeapon,
  setWeaponLevel,
  setWeaponRank,
  setSkillLevel,
  setInherentSkill,
  setStatNode,
  SKILL_KEYS,
  SKILL_LABELS,
  setEcho,
  ECHO_SLOTS,
  appendRotationStep,
  removeRotationStep,
  moveRotationStep,
  clearRotation,
} from "../../core/build.js";
import {
  mainStatsForCost,
  subMainStatFor,
  unlockedSubStatCount,
  snapLevel,
  possibleRollsFor,
  mainStatValueFor,
  totalEchoCost,
  COST_BUDGET,
} from "../../core/echo-rules.js";
import { suggestEchoSubstats } from "../../core/echo-optimizer.js";
import {
  simulateRotation,
  resolveCastTime,
  effectiveSkillMap,
  ECHO_STEP_KEY,
} from "../../core/sim.js";
import { validateRotation, parseStage } from "../../core/rotation-graph.js";
import {
  rulesForResonator,
  stateDefsForResonator,
} from "../../core/rotation-rules.js";
import { proposeTriggeredInsert } from "../../core/rotation-triggers.js";
import { iconHtml, dynamicIconHtml } from "../icons.js";
import { formatTipDesc, extractSkillSection } from "../tip-format.js";
import { renderBuffBar } from "./buff-bar.js";
import { renderSuggestedTeams } from "./suggested-teams.js";
import { renderV2Header, getV2Theme } from "./v2-header.js";
import { hideTooltip, bindTooltipHover } from "../tooltip.js";
import {
  metaFor,
  suggestedBuildFor,
  suggestedTeamsFor,
} from "../../data/meta-loader.js";
import {
  listRotationPresets,
  saveRotationPreset,
  deleteRotationPreset,
} from "../../data/storage.js";
import {
  statPriority,
  erStatus,
  isFarFromAnchor,
  SOLO_MODES,
} from "../../core/stat-ranking.js";
import { echoUpgradeRanking, substatKeyOf } from "../../core/live-weights.js";

let api = null; // { root, dataset, build, onChange, theme }

// Element id → { name, colour, glyph } using the handoff's palette.
// Per-element colours — single source: styles/tokens.css --el-*.
// var() resolves in inline styles and SVG fill= alike; alpha tints use color-mix.
const ELEM = {
  1: { name: "Glacio", c: "var(--el-glacio)", g: "G" },
  2: { name: "Fusion", c: "var(--el-fusion)", g: "F" },
  3: { name: "Electro", c: "var(--el-electro)", g: "E" },
  4: { name: "Aero", c: "var(--el-aero)", g: "A" },
  5: { name: "Spectro", c: "var(--el-spectro)", g: "S" },
  6: { name: "Havoc", c: "var(--el-havoc)", g: "H" },
};
const GOLD = "var(--tip-gold)";

const fN = (n) => Math.round(n).toLocaleString("en-US");
const fP = (n) => (Math.round(n * 10) / 10).toFixed(1) + "%";
const pct1to90 = (v) =>
  Math.round(((Math.max(1, Math.min(90, v)) - 1) / 89) * 100) + "%";
const pct1to10 = (v) =>
  Math.round(((Math.max(1, Math.min(10, v)) - 1) / 9) * 100) + "%";
const STAT_NODE_COLS = SKILL_KEYS.filter((k) => k !== "forte");

// Short abbreviation for the 13 real echo substat names (dataset.echoSubStats).
const SUBSTAT_ABBR = {
  HP: "HP",
  ATK: "ATK",
  DEF: "DEF",
  "HP%": "HP%",
  "ATK%": "ATK%",
  "DEF%": "DEF%",
  "Resonance Skill DMG Bonus": "SK",
  "Basic Attack DMG Bonus": "BA",
  "Heavy Attack DMG Bonus": "HA",
  "Resonance Liberation DMG Bonus": "LB",
  "Crit. Rate": "CR",
  "Crit. DMG": "CD",
  "Energy Regen": "ER",
};
// Row label (+ optional sub-label) for the SUBSTATS editor's grouped roll
// rows — echopanel-v2 handoff. Keyed by the same dataset.echoSubStats name
// as SUBSTAT_ABBR above.
const SUBSTAT_ROW_META = {
  HP: { label: "HP" },
  ATK: { label: "ATK" },
  DEF: { label: "DEF" },
  "HP%": { label: "HP%" },
  "ATK%": { label: "ATK%" },
  "DEF%": { label: "DEF%" },
  "Crit. Rate": { label: "CR%", sub: "CRIT. RATE" },
  "Crit. DMG": { label: "CD%", sub: "CRIT. DMG" },
  "Basic Attack DMG Bonus": { label: "Basic", sub: "DMG BONUS" },
  "Heavy Attack DMG Bonus": { label: "Heavy", sub: "DMG BONUS" },
  "Resonance Skill DMG Bonus": { label: "Skill", sub: "DMG BONUS" },
  "Resonance Liberation DMG Bonus": { label: "Liber.", sub: "DMG BONUS" },
  "Energy Regen": { label: "ER%", sub: "ENERGY REGEN" },
};
// Fixed substat group order for the SUBSTATS editor — do not resort (P13
// echopanel-v2 handoff). CRIT + DMG BONUS sit side by side (flex 1 / 2); DMG
// BONUS uses auto-fit (not a fixed 2-col grid) so it falls back to one
// column instead of overflowing when squeezed.
const SUBSTAT_GROUPS = [
  {
    label: "FLAT ROLLS",
    keys: ["ATK", "HP", "DEF"],
    flexBasis: "1 1 100%",
    cols: "repeat(auto-fit,minmax(255px,1fr))",
  },
  {
    label: "MAIN STAT %",
    keys: ["ATK%", "HP%", "DEF%"],
    flexBasis: "1 1 100%",
    cols: "repeat(auto-fit,minmax(255px,1fr))",
  },
  {
    label: "CRIT",
    keys: ["Crit. Rate", "Crit. DMG"],
    flexBasis: "1 1 0",
    cols: "1fr",
    minWidth: 240,
  },
  {
    label: "DMG BONUS",
    keys: [
      "Basic Attack DMG Bonus",
      "Heavy Attack DMG Bonus",
      "Resonance Skill DMG Bonus",
      "Resonance Liberation DMG Bonus",
    ],
    flexBasis: "2 1 0",
    cols: "repeat(auto-fit,minmax(216px,1fr))",
    minWidth: 240,
  },
  { label: "UTILITY", keys: ["Energy Regen"], flexBasis: "1 1 100%", cols: "1fr" },
];
// Roll-quality colour scale (low → max), 8 steps. Generic over the roll
// count for a stat (4 for flat ATK/DEF, 8 for everything else).
const rollTint = (n, pct) =>
  `color-mix(in srgb, var(--roll-${n}) ${pct}%, transparent)`;
const ROLL_SCALE = [
  { c: "var(--roll-1)", bg: rollTint(1, 16) },
  { c: "var(--roll-2)", bg: rollTint(2, 13) },
  { c: "var(--roll-3)", bg: rollTint(3, 17) },
  { c: "var(--roll-4)", bg: rollTint(4, 18) },
  { c: "var(--roll-5)", bg: rollTint(5, 20) },
  { c: "var(--roll-6)", bg: rollTint(6, 18) },
  { c: "var(--roll-max-ink)", bg: "var(--grad-roll-silver)" },
  { c: "var(--roll-max-ink)", bg: "var(--grad-roll-rainbow)" },
];
function rollColorFor(idx, count) {
  if (count <= 1) return ROLL_SCALE[7];
  return ROLL_SCALE[Math.min(Math.round((idx / (count - 1)) * 7), 7)];
}
const fmtSub = (v, isPercent) =>
  Math.round(v * 10) / 10 + (isPercent ? "%" : "");

// Colour/abbreviation per real rotation-step skillType (superset of the
// handoff's BA/HA/SK/LB/EC — our engine also emits intro/outro/unknown).
const stepTint = (t) => `color-mix(in srgb, var(--dmg-${t}) 13%, transparent)`;
const STEP_TYPE = {
  basic: { abbr: "BA", c: "var(--dmg-basic)", bg: stepTint("basic") },
  heavy: { abbr: "HA", c: "var(--dmg-heavy)", bg: stepTint("heavy") },
  skill: { abbr: "SK", c: "var(--dmg-skill)", bg: stepTint("skill") },
  liberation: {
    abbr: "LB",
    c: "var(--dmg-liberation)",
    bg: stepTint("liberation"),
  },
  intro: { abbr: "IN", c: "var(--dmg-intro)", bg: stepTint("intro") },
  outro: { abbr: "OU", c: "var(--dmg-outro)", bg: stepTint("outro") },
  echo: { abbr: "EC", c: "var(--dmg-echo)", bg: stepTint("echo") },
};
function stepTypeInfo(t) {
  return (
    STEP_TYPE[t] ?? {
      abbr: (t || "?").slice(0, 2).toUpperCase(),
      c: "var(--warn)",
      bg: "color-mix(in srgb, var(--warn) 13%, transparent)",
    }
  );
}
const TYPE_LABEL = {
  basic: "Basic Attack",
  heavy: "Heavy Attack",
  skill: "Resonance Skill",
  liberation: "Resonance Liberation",
  intro: "Intro Skill",
  outro: "Outro Skill",
  echo: "Echo Skill",
};
const fmtTime = (s) => (Number.isFinite(s) ? `${s.toFixed(1)}s` : "—");
const fmtDps = (v) => (Number.isFinite(v) && v > 0 ? fN(v) : "—");

function echoDefOf(echo) {
  return echo ?
      (api.dataset.echoes.find((e) => e.id === echo.id) ?? null)
    : null;
}
function sonataOf(id) {
  return id == null ? null : (
      (api.dataset.sonatas.find((s) => s.id === id) ?? null)
    );
}

// Real sonata crest, rendered bare (no swatch box/border) at native colour.
function sonataIconHtml(sonataId, size) {
  const so = sonataOf(sonataId);
  return iconHtml("sonata", so?.name, { label: so?.name, size });
}

// Small chevron marking the sonata icon as clickable — only rendered when an
// echo actually has more than one valid sonata set (sonata-menu quick-switch).
const SONATA_SWITCH_ARROW = `<svg width="7" height="7" viewBox="0 0 8 8" style="flex:none;opacity:.65;"><path d="M1 2.5L4 5.5L7 2.5" stroke="var(--dim)" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// Hover-box tooltip (the handoff's fixed-position hover card) — showTooltip/
// hideTooltip/bindTooltipHover live in ../tooltip.js, shared with the team
// and compare pages. Hoverable elements carry data-tip-title/data-tip-desc
// instead of a native title attribute.

// Sonata quick-switch menu — same body-appended pattern as the tooltip above
// (survives outside the repainted .bv2 subtree), but interactive: clicking an
// option re-assigns the slot's sonataId among the echo's valid sets without
// opening the full echo picker. Quick fix ahead of the redesigned picker.
function ensureSonataMenuEl() {
  if (api.sonataMenuEl) return api.sonataMenuEl;
  const el = document.createElement("div");
  el.className = "bv2-sonata-menu";
  document.body.appendChild(el);
  api.sonataMenuEl = el;
  return el;
}
function closeSonataMenu() {
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
function openSonataMenu(slotIndex, anchorEl) {
  const echo = api.build.echoes[slotIndex];
  const def = echoDefOf(echo);
  const choices = (def?.sonataIds ?? []).filter((id) => id != null);
  if (!echo || choices.length < 2) return;
  closeSonataMenu();

  const el = ensureSonataMenuEl();
  el.innerHTML = choices
    .map((id) => {
      const s = sonataOf(id);
      if (!s) return "";
      const active = id === echo.sonataId;
      // Body-appended menu (outside .bv2) — theme-independent literals, not var(--acc).
      return `<button type="button" class="bv2-sonata-menu__opt" data-sonata-id="${id}" data-slot="${slotIndex}" style="display:flex;align-items:center;gap:8px;width:100%;border:none;background:${active ? "color-mix(in srgb, var(--accent) 14%, transparent)" : "transparent"};padding:6px 10px;border-radius:7px;cursor:pointer;text-align:left;color:${active ? "var(--accent)" : "var(--popover-ink)"};font:inherit;font-size:12px;font-weight:600;">${sonataIconHtml(id, 20)}<span>${esc(s.name)}</span></button>`;
    })
    .join("");
  el.classList.add("is-open");

  const r = anchorEl.getBoundingClientRect();
  const margin = 12;
  const overflowsRight = r.left + el.offsetWidth > window.innerWidth - margin;
  el.style.left =
    Math.round(
      overflowsRight ? Math.max(margin, r.right - el.offsetWidth) : r.left,
    ) + "px";
  el.style.top = Math.round(r.bottom + 6) + "px";

  const onOptClick = (e) => {
    const btn = e.target.closest(".bv2-sonata-menu__opt");
    if (!btn) return;
    const slot = Number(btn.dataset.slot);
    const newSonataId = Number(btn.dataset.sonataId);
    const cur = api.build.echoes[slot];
    closeSonataMenu();
    if (cur)
      commit(setEcho(api.build, slot, { ...cur, sonataId: newSonataId }));
  };
  const onOutside = (e) => {
    if (el.contains(e.target) || anchorEl.contains(e.target)) return;
    closeSonataMenu();
  };
  const onKey = (e) => {
    if (e.key === "Escape") closeSonataMenu();
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

function ensureRotLoadMenuEl() {
  if (api.rotLoadMenuEl) return api.rotLoadMenuEl;
  const el = document.createElement("div");
  el.className = "bv2-sonata-menu"; // reuse the same float-menu style
  document.body.appendChild(el);
  api.rotLoadMenuEl = el;
  return el;
}

function closeRotLoadMenu() {
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

function renderRotLoadMenuContent(resonatorId) {
  const presets = listRotationPresets(resonatorId);
  if (!presets.length) {
    return `<div style="padding:10px 12px;font-family:var(--font-body);font-size:12px;color:var(--faint);">No saved rotations yet.</div>`;
  }
  return presets
    .map(
      (p) => `
      <div style="display:flex;align-items:center;gap:6px;padding:5px 8px;border-radius:7px;" data-preset-row>
        <div style="flex:1;min-width:0;">
          <div style="font-family:var(--font-body);font-weight:600;font-size:12px;color:var(--popover-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(p.name)}</div>
          <div style="font-family:var(--font-display);font-size:9px;color:var(--dim);">${p.rotation.length} step${p.rotation.length === 1 ? "" : "s"}</div>
        </div>
        <button data-act="rot-load-apply" data-preset-id="${esc(p.id)}" style="font-family:var(--font-display);font-weight:700;font-size:9.5px;letter-spacing:.5px;padding:4px 9px;border-radius:6px;cursor:pointer;background:var(--acc);border:none;color:var(--on-acc);">APPLY</button>
        <button data-act="rot-load-delete" data-preset-id="${esc(p.id)}" style="font-family:var(--font-display);font-size:11px;padding:4px 7px;border-radius:6px;cursor:pointer;background:transparent;border:1px solid color-mix(in srgb, var(--warn) 40%, transparent);color:var(--warn);">✕</button>
      </div>`,
    )
    .join("");
}

function openRotLoadMenu(anchorEl) {
  closeRotLoadMenu();
  const el = ensureRotLoadMenuEl();
  const resonatorId = api.build.resonatorId;

  function refresh() {
    el.innerHTML = renderRotLoadMenuContent(resonatorId);
  }
  refresh();
  el.classList.add("is-open");

  const r = anchorEl.getBoundingClientRect();
  const margin = 12;
  const overflowsRight = r.left + el.offsetWidth > window.innerWidth - margin;
  el.style.left =
    Math.round(
      overflowsRight ? Math.max(margin, r.right - el.offsetWidth) : r.left,
    ) + "px";
  el.style.top = Math.round(r.bottom + 6) + "px";

  const onClick = (e) => {
    const applyBtn = e.target.closest('[data-act="rot-load-apply"]');
    const deleteBtn = e.target.closest('[data-act="rot-load-delete"]');
    if (applyBtn) {
      const presets = listRotationPresets(resonatorId);
      const preset = presets.find((p) => p.id === applyBtn.dataset.presetId);
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
  const onOutside = (e) => {
    if (el.contains(e.target) || anchorEl.contains(e.target)) return;
    closeRotLoadMenu();
  };
  const onKey = (e) => {
    if (e.key === "Escape") closeRotLoadMenu();
  };
  el.addEventListener("click", onClick);
  document.addEventListener("mousedown", onOutside, true);
  document.addEventListener("keydown", onKey, true);
  api.rotLoadMenuAnchor = anchorEl;
  api.rotLoadMenuClickHandler = onClick;
  api.rotLoadMenuOutsideHandler = onOutside;
  api.rotLoadMenuKeyHandler = onKey;
}

// Reference rotation for a resonator — checks the P12 meta first (covered seed
// chars), then falls back to the runtime-loaded reference-rotations.json (all 54).
function referenceRotationFor(resonatorId) {
  const metaChar = api.meta?.characters?.[String(resonatorId)];
  if (metaChar?.referenceRotation?.length) return metaChar.referenceRotation;
  return api.referenceRotations?.[String(resonatorId)]?.rotation ?? null;
}

// Set-bonus text for a sonata's hover-box (shared by the echo slot card's
// sonata dot, the sonata strip, and the echo picker's filter chips). Renders
// EVERY tier the set defines — classic sets are 2PC/5PC, but the newer sets are
// single 3PC bonuses, which an earlier 2/5-only lookup silently dropped.
function sonataTooltipDesc(sonataId) {
  const so = sonataOf(sonataId);
  if (!so?.tiers?.length) return "";
  return so.tiers
    .slice()
    .sort((a, b) => a.pieces - b.pieces)
    .filter((t) => t.effect)
    .map((t) => `${t.pieces}PC — ${t.effect}`)
    .join("\n");
}

// Derive a sonata's element id (1–6) from its bonus text, or null for
// non-elemental/support sets. The dataset carries no element field on sonatas,
// but elemental sets name their element in the bonus ("Glacio DMG +10%",
// "Havoc Bane", "Fusion DMG Bonus"). Used to group the echo picker's sonata
// filter by element.
const SONATA_ELEMENT_NAME_TO_ID = {
  Glacio: 1,
  Fusion: 2,
  Electro: 3,
  Aero: 4,
  Spectro: 5,
  Havoc: 6,
};
function sonataElementId(sonataId) {
  const so = sonataOf(sonataId);
  const text = (so?.tiers ?? []).map((t) => t.effect ?? "").join(" ");
  for (const [name, id] of Object.entries(SONATA_ELEMENT_NAME_TO_ID)) {
    if (text.includes(name)) return id;
  }
  return null;
}

// Active-skill desc carries unsubstituted {n} param placeholders straight from
// the source data (only resonator-facing descs get param-substituted at
// preprocess time) — fill them in from the max-level params here for display.
function echoActiveSkillDesc(def) {
  const a = def?.activeSkill;
  if (!a?.desc) return "";
  const params = a.params?.[a.params.length - 1] ?? [];
  return a.desc
    .replace(/\{(\d+)\}/g, (m, i) => params[Number(i)] ?? m)
    .replace(/\{[A-Za-z][^}]*\}/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Single source for "what does this step's move actually do" — used by
// every rotation-facing hover-box (rotation chips, the line-chart's dots).
// Echo steps source their desc from the equipped echo's own activeSkill
// text since echoes aren't part of the resonator's skillMap.
function skillDescFor(skillKey, skillMap) {
  if (skillKey === ECHO_STEP_KEY) {
    const echoDef = echoDefOf(api.build.echoes?.[0]);
    return echoDef ? echoActiveSkillDesc(echoDef) : "";
  }
  const def = skillMap?.[skillKey];
  return def ? extractSkillSection(def.desc, skillKey, def.skillType) : "";
}

const WEAPON_STAT_KEY = {
  ATK: "atk",
  HP: "hp",
  DEF: "def",
  "Crit. Rate": "critRate",
  "Crit. DMG": "critDmg",
  "Energy Regen": "energyRegen",
  "ATK%": "atkPct",
  "HP%": "hpPct",
  "DEF%": "defPct",
};

// "ATK 587 · Crit. Rate 24.3%" — the weapon's resolved main/sub stat at its
// current level, read straight off the pre-resolved statsByLevel table.
function weaponStatsLine(wpn, level) {
  const byLevel = wpn?.statsByLevel;
  if (!byLevel) return "";
  const lv = byLevel[level] ? level : 90;
  const s = byLevel[lv];
  if (!s) return "";
  const parts = [`ATK ${Math.round(s.atk ?? 0)}`];
  const subKey = WEAPON_STAT_KEY[wpn.subStatName];
  if (subKey && s[subKey] != null) {
    const isFlat = subKey === "atk" || subKey === "hp" || subKey === "def";
    parts.push(
      `${wpn.subStatName} ${isFlat ? Math.round(s[subKey]) : Math.round(s[subKey] * 1000) / 10 + "%"}`,
    );
  }
  return parts.join(" · ");
}

// Passive effect desc carries unsubstituted {n} placeholders filled per
// refinement rank (effectParams[n] is a 5-entry [R1..R5] array).
function weaponEffectDesc(wpn, rank) {
  if (!wpn?.effect) return "";
  const idx = Math.max(0, Math.min(4, (rank ?? 1) - 1));
  const filled = wpn.effect.replace(
    /\{(\d+)\}/g,
    (m, i) => wpn.effectParams?.[Number(i)]?.[idx] ?? m,
  );
  return wpn.effectName ? `${wpn.effectName} — ${filled}` : filled;
}

function weaponTooltipDesc(wpn, build) {
  const statsLine = weaponStatsLine(wpn, build?.weapon?.level ?? 1);
  const effectLine = weaponEffectDesc(wpn, build?.weapon?.rank ?? 1);
  return [statsLine, effectLine].filter(Boolean).join("\n\n");
}

// Reset/max all 5 skill levels + every forte/stat node this resonator
// actually has (data-driven — node counts vary per resonator, never assumed).
function setAllSkillNodes(build, active, level) {
  const reso = api.dataset.resonators.find((r) => r.id === build.resonatorId);
  let b = build;
  for (const key of SKILL_KEYS) b = setSkillLevel(b, key, level);
  for (const col of STAT_NODE_COLS) {
    for (const node of reso?.statNodeBonuses?.[col] ?? [])
      b = setStatNode(b, col, node.tier - 1, active);
  }
  (reso?.inherentSkills ?? []).forEach((_, i) => {
    b = setInherentSkill(b, i, active);
  });
  return b;
}
// Tiered toggle: clicking node n steps down when it's already the top, else raises to n.
const tier = (cur, n, min) => (n === cur ? Math.max(min, n - 1) : n);

const resonatorOf = () =>
  api.dataset.resonators.find((r) => r.id === api.build.resonatorId) ?? null;
const weaponOf = () =>
  api.build.weapon ?
    api.dataset.weapons.find((w) => w.id === api.build.weapon.id)
  : null;

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
  api = {
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
    optimizerResult: null,
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
  };
  paint();
  if (toastOnMount) showToast(toastOnMount);
  // Guard: bind once per root. Handlers close over the module-level `api`,
  // which mount() reassigns each time, so re-mounting (navigating back here)
  // must not restack delegated listeners on the persistent #main root. The
  // shared header's nav/theme controls are bound once by app.js, not here.
  if (!root.__bv2Bound) {
    root.__bv2Bound = true;
    bind();
    // Connector ("neck") corner-squaring depends on real layout (which rail
    // slot is selected, viewport width) — re-measure on resize. The listener
    // reads api.root at fire-time, so it stays correct across remounts (see
    // the bind() guard comment above: api is reassigned, not this closure).
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

function commit(next) {
  api.build = next;
  api.onChange?.(next);
  // Any build mutation can invalidate a previous "optimize substats" run
  // (it suggested stats for a since-changed rotation) — drop it rather
  // than show stale advice. echoes-optimize itself bypasses commit().
  api.optimizerResult = null;
  paint();
}

// =============================================================================
// Render
// =============================================================================

function paint() {
  hideTooltip();
  closeSonataMenu();
  closeRotLoadMenu();
  render(api.root, renderPage());
  requestAnimationFrame(() => squareEchoFrameCorners(api.root));
}

// Echoes panel connector ("neck") geometry — echopanel-v2 handoff. The gap
// between the fixed-width rail and the flexible editor frame is a constant
// (set on the row in renderEchoes), so the neck's own width is a fixed CSS
// value (.bv2-echo-neck), but WHICH of the frame's left corners should square
// off depends on which rail slot is selected relative to the frame's actual
// height — that can only be known from real layout, not static CSS. Runs in
// a rAF after every repaint (DOM must be attached for getBoundingClientRect)
// and again on window resize.
function squareEchoFrameCorners(root) {
  const frame = root?.querySelector(".bv2-echo-frame");
  const neck = root?.querySelector(".bv2-echo-neck");
  if (!frame || !neck) return;
  const f = frame.getBoundingClientRect(),
    n = neck.getBoundingClientRect();
  frame.style.borderTopLeftRadius =
    Math.abs(n.top - f.top) < 15 ? "0px" : "14px";
  frame.style.borderBottomLeftRadius =
    Math.abs(n.bottom - f.bottom) < 15 ? "0px" : "14px";
}

function renderPage() {
  return html`
    <div
      class="bv2"
      data-theme="${api.theme}"
    >
      ${raw(renderHeader())}
      <div
        style="display:flex;flex-direction:column;padding:24px;gap:16px;max-width:1240px;margin:0 auto;"
      >
        ${raw(renderResonatorCard())} ${raw(renderSkillLevels())}
        ${raw(renderEchoes())} ${raw(renderStats())}
        ${raw(renderStatPriority())} ${raw(renderSuggestedTeamsPanel())}
        ${raw(renderRotation())} ${raw(renderAbilityDamageOverview())}
      </div>
      ${raw(renderToast())}
    </div>
  `;
}

// "Saved" confirmation toast — mirrors team-editor-v2.js's bv2-party-toast
// pattern (fixed bottom-center, auto-dismiss), fired on every successful
// save (manual Save click or debounced autosave via notifySaved()).
function renderToast() {
  if (!api.toast) return "";
  return `
      <div class="bv2-build-toast" style="position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:50;display:flex;align-items:center;gap:8px;padding:10px 18px;border-radius:10px;background:var(--card2);border:1px solid var(--acc);box-shadow:0 10px 30px -10px rgba(var(--shadow-rgb),.6);">
        <span style="width:7px;height:7px;border-radius:50%;background:var(--acc);box-shadow:0 0 8px var(--acc);flex:none;"></span>
        <span style="font-family:var(--font-display);font-size:11.5px;letter-spacing:.4px;color:var(--txt);">${esc(api.toast)}</span>
      </div>`;
}

function showToast(msg) {
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

function renderHeader() {
  return renderV2Header({ active: "build", theme: api.theme });
}

function starRow(rarity, size = 13) {
  return [0, 1, 2, 3, 4]
    .map(
      (i) =>
        `<span style="color:${i < rarity ? GOLD : "var(--nodebd)"};font-size:${size}px;line-height:1;filter:drop-shadow(0 0 3px rgba(var(--shadow-rgb),.75));">◆</span>`,
    )
    .join("");
}

function levelTicks(val) {
  return [1, 20, 40, 60, 80, 90]
    .map((m) => {
      const on = val >= m;
      return `<div style="display:flex;flex-direction:column;align-items:center;gap:3px;">
            <span style="width:1px;height:5px;background:${on ? "var(--acc)" : "var(--nodebd)"};"></span>
            <span style="font-family:var(--font-body);font-size:8px;color:${on ? "var(--dim)" : "var(--faint)"};">${m}</span></div>`;
    })
    .join("");
}

// tipFor(n, active) lets callers override the hover-box per node (used by
// Sequence to surface each chain node's real name+desc — see §I gap).
// Returns { title, desc } — desc is optional.
function tierNodes(count, cur, min, prefix, act, tipFor) {
  const base =
    "position:relative;flex:1 1 0;min-width:0;height:32px;border-radius:8px;cursor:pointer;font-family:var(--font-body);font-weight:600;font-size:14px;display:flex;align-items:center;justify-content:center;transition:all .14s;";
  return Array.from({ length: count }, (_, i) => {
    const n = i + 1,
      active = n <= cur,
      isTop = n === cur;
    const style =
      base +
      (active ?
        `background:linear-gradient(180deg,color-mix(in srgb, var(--acc) 28%, transparent),color-mix(in srgb, var(--acc) 12%, transparent));border:1.5px solid var(--acc);color:var(--acc);box-shadow:${isTop ? "0 0 12px color-mix(in srgb, var(--acc) 45%, transparent)" : "none"};`
      : "background:var(--node);border:1.5px solid var(--nodebd);color:var(--faint);");
    const tip =
      tipFor ?
        tipFor(n, active)
      : { title: `${active ? "Active" : "Locked"} · ${prefix}${n}` };
    return `<button class="bv2-node" data-act="${act}" data-n="${n}" data-tip-title="${esc(tip.title)}" ${tip.desc ? `data-tip-desc="${esc(tip.desc)}"` : ""} style="${style}">${prefix}${n}</button>`;
  }).join("");
}

function renderResonatorCard() {
  const b = api.build;
  const reso = resonatorOf();
  const el = ELEM[reso?.element] ?? { name: "—", c: "var(--acc)", g: "?" };
  const wpn = weaponOf();
  const hasWeapon = !!b.weapon;
  const modes = reso?.resonanceModes ?? [];

  const charPortrait = `
      <div style="flex:none;width:140px;display:flex;flex-direction:column;gap:5px;">
        <button class="bv2-portrait" data-act="pick-build-resonator" title="Switch Build / Resonator" style="position:relative;width:100%;height:140px;border:1.5px solid var(--bd2);border-radius:12px;background:radial-gradient(120% 90% at 75% 0%,color-mix(in srgb, ${el.c}, transparent),transparent 80%),var(--node);display:flex;align-items:center;justify-content:center;overflow:hidden;cursor:pointer;padding:0;transition:border-color .14s,box-shadow .14s;">
          <span style="position:absolute;top:6px;left:9px;font-family:var(--font-display);font-size:9px;letter-spacing:1.5px;color:var(--acc);">RESONATOR</span>
          ${
            reso?.iconUrl ?
              `<img src="${esc(reso.iconUrl)}" alt="${esc(reso.name)}" style="width:100%;height:100%;object-fit:cover;">`
            : `<div style="font-family:var(--font-display);font-weight:700;font-size:34px;color:${el.c};">${el.g}</div>`
          }
          <div style="position:absolute;left:0;right:0;bottom:0;display:flex;justify-content:center;gap:3px;padding:10px 0 8px;background:linear-gradient(transparent,rgba(var(--scrim-rgb),.62));">${starRow(reso?.rarity ?? 5)}</div>
        </button>
        <div style="text-align:center;font-family:var(--font-display);font-weight:700;font-size:12px;color:var(--txt);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(reso?.name ?? "—")}</div>
        <div style="display:flex;align-items:center;gap:9px;background:var(--inp);border:1px solid var(--bd);border-radius:10px;padding:5px 7px;">
          ${iconHtml("element", reso?.element, { label: el.name, size: 26 })}
          <div style="min-width:0;">
            <div style="font-family:var(--font-display);font-size:7px;letter-spacing:1.4px;color:var(--faint);">ELEMENT</div>
            <div style="font-family:var(--font-body);font-weight:600;font-size:13.5px;color:${el.c};">${esc(el.name)}</div>
          </div>
        </div>
      </div>`;

  const divider = `<span style="width:1px;background:var(--bd);margin:2px 10px;flex:none;"></span>`;

  const levelCol = `
      <div style="flex:1.05;min-width:0;display:flex;flex-direction:column;gap:20px;justify-content:center;">
        <div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <label style="font-family:var(--font-display);font-size:10px;letter-spacing:1.6px;color:var(--faint);">RESONATOR LEVEL</label>
            <div style="display:flex;align-items:baseline;gap:3px;">
              <span data-disp="res-level" style="font-family:var(--font-body);font-weight:700;font-size:20px;color:var(--acc);">${b.level}</span>
              <span style="font-family:var(--font-body);font-size:12px;color:var(--faint);">/ 90</span>
            </div>
          </div>
          <input class="bv2-slider" type="range" min="1" max="90" value="${b.level}" data-act="res-level" style="--pct:${pct1to90(b.level)};">
          <div style="display:flex;justify-content:space-between;margin-top:5px;padding:0 1px;">${levelTicks(b.level)}</div>
        </div>
        <div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;overflow:hidden;">
            <label style="font-family:var(--font-display);font-size:10px;letter-spacing:1.6px;color:var(--faint);">RESONANCE CHAIN - SEQUENCE</label>
          </div>
          <div style="display:flex;gap:6px;">${tierNodes(
            6,
            b.chain,
            0,
            "S",
            "seq",
            (n, active) => {
              const node = reso?.resonanceChain?.[n - 1];
              if (!node)
                return {
                  title: `${active ? "Active" : "Locked"} · S${n}`,
                };
              return {
                title: `${active ? "Active" : "Locked"} · S${n} ${node.name}`,
                desc: node.desc,
              };
            },
          )}</div>
        </div>
      </div>`;

  const modeControl =
    modes.length ?
      `<div style="display:flex;gap:3px;background:var(--node);border-radius:7px;padding:3px;">
             ${modes
               .map((m) => {
                 const on = (b.resonanceMode ?? modes[0].key) === m.key;
                 return `<button data-act="mode" data-mode="${esc(m.key)}" data-tip-title="${esc(m.name)}" ${m.desc ? `data-tip-desc="${esc(m.desc)}"` : ""} style="flex:1 1 0;border:none;border-radius:5px;cursor:pointer;font-family:var(--font-body);font-weight:600;font-size:11px;padding:8px 4px;transition:all .14s;${on ? "background:var(--acc);color:var(--on-acc);box-shadow:0 1px 6px color-mix(in srgb, var(--acc) 40%, transparent);" : "background:transparent;color:var(--dim);"}">${esc(m.name)}</button>`;
               })
               .join("")}
           </div>`
    : `<div style="font-family:var(--font-body);font-size:11px;color:var(--faint);padding:6px 3px;">No Resonance Mode for this resonator.</div>`;

  const buildActions = `
      <div style="display:flex;gap:7px;">
        <button class="bv2-action-btn" data-act="duplicate-build" title="Create a duplicate of this build" style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px;font-family:var(--font-display);font-weight:600;font-size:11px;letter-spacing:.5px;padding:8px 4px;border-radius:7px;cursor:pointer;background:var(--node);border:1px solid var(--bd2);color:var(--dim);transition:all .12s;">DUPLICATE</button>
        <button class="bv2-action-btn-danger" data-act="delete-build" title="Delete this build" style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px;font-family:var(--font-display);font-weight:600;font-size:11px;letter-spacing:.5px;padding:8px 4px;border-radius:7px;cursor:pointer;background:color-mix(in srgb, var(--warn) 8%, transparent);border:1px solid color-mix(in srgb, var(--warn) 30%, transparent);color:var(--warn);transition:all .12s;">DELETE</button>
      </div>`;

  const buildCol = `
      <div style="flex:1.1;min-width:0;display:flex;flex-direction:column;gap:16px;justify-content:center;">
        <div>
          <label style="display:block;font-family:var(--font-display);font-size:10px;letter-spacing:1.6px;color:var(--faint);margin-bottom:5px;">BUILD NAME</label>
          <input class="bv2-text" type="text" value="${esc(b.name ?? "")}" data-act="build-name" placeholder="e.g. Hypercarry…" style="width:100%;background:var(--inp);border:1px solid var(--bd);border-radius:9px;padding:10px 12px;font-size:14px;color:var(--txt);">
        </div>
        ${buildActions}
        <div style="background:var(--inp);border:1px solid var(--bd);border-radius:10px;padding:8px 10px;">
          <div style="font-family:var(--font-display);font-size:8.5px;letter-spacing:1.4px;color:var(--faint);margin:1px 0 6px 3px;">RESONANCE MODE</div>
          ${modeControl}
        </div>
      </div>`;

  const weaponCol = `
      <div style="flex:1.05;min-width:0;display:flex;flex-direction:column;gap:20px;justify-content:center;">
        <div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <label style="font-family:var(--font-display);font-size:10px;letter-spacing:1.6px;color:var(--faint);">WEAPON REFINEMENT</label>
          </div>
          <div style="display:flex;gap:6px;${hasWeapon ? "" : "opacity:.4;pointer-events:none;"}">${tierNodes(5, b.weapon?.rank ?? 1, 1, "R", "refine")}</div>
          <div style="font-family:var(--font-body);font-size:9.5px;color:var(--faint);margin-top:6px;">${hasWeapon ? "" : "Pick a weapon to set refinement."}</div>
        </div>
        <div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <label style="font-family:var(--font-display);font-size:10px;letter-spacing:1.6px;color:var(--faint);">WEAPON LEVEL</label>
            <div style="display:flex;align-items:baseline;gap:3px;">
              <span data-disp="weapon-level" style="font-family:var(--font-body);font-weight:700;font-size:20px;color:var(--acc);">${b.weapon?.level ?? 1}</span>
              <span style="font-family:var(--font-body);font-size:12px;color:var(--faint);">/ 90</span>
            </div>
          </div>
          <input class="bv2-slider" type="range" min="1" max="90" value="${b.weapon?.level ?? 1}" data-act="weapon-level" ${hasWeapon ? "" : "disabled"} style="--pct:${pct1to90(b.weapon?.level ?? 1)};${hasWeapon ? "" : "opacity:.4;"}">
          <div style="display:flex;justify-content:space-between;margin-top:5px;padding:0 1px;">${levelTicks(b.weapon?.level ?? 1)}</div>
        </div>
      </div>`;

  const weaponPortrait = `
      <div style="flex:none;width:140px;display:flex;flex-direction:column;gap:5px;">
        <button class="bv2-portrait" data-act="pick-weapon" ${
          hasWeapon ?
            `data-tip-title="${esc(wpn.name)}" data-tip-desc="${esc(weaponTooltipDesc(wpn, b))}"`
          : `title="Choose weapon"`
        } style="position:relative;width:100%;height:140px;border:1.5px solid var(--bd2);border-radius:12px;background:radial-gradient(120% 90% at 75% 0%,color-mix(in srgb, ${el.c}, transparent),transparent 80%),var(--node);display:flex;align-items:center;justify-content:center;overflow:hidden;cursor:pointer;padding:0;transition:border-color .14s,box-shadow .14s;">
          <span style="position:absolute;top:6px;left:9px;font-family:var(--font-display);font-size:9px;letter-spacing:1.5px;color:var(--acc);">WEAPON</span>
          ${
            wpn?.iconUrl ?
              `<img src="${esc(wpn.iconUrl)}" alt="${esc(wpn.name)}" style="width:100%;height:100%;object-fit:cover;">`
            : `<div style="display:flex;flex-direction:column;align-items:center;gap:7px;color:var(--faint);"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"></path></svg><span style="font-family:var(--font-display);font-size:9.5px;letter-spacing:1px;">CHOOSE</span></div>`
          }
          ${hasWeapon ? `<div style="position:absolute;left:0;right:0;bottom:0;display:flex;justify-content:center;gap:3px;padding:10px 0 8px;background:linear-gradient(transparent,rgba(var(--scrim-rgb),.62));">${starRow(wpn?.rarity ?? 4)}</div>` : ""}
        </button>
        <div style="text-align:center;font-family:var(--font-display);font-weight:700;font-size:12px;color:var(--txt);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(wpn?.name ?? "No weapon")}</div>
        <div style="display:flex;align-items:center;gap:9px;background:var(--inp);border:1px solid var(--bd);border-radius:10px;padding:5px 7px;">
          ${iconHtml("weaponType", reso?.weaponType, { label: reso?.weaponTypeName, size: 28, tint: "--dim" })}
          <div style="min-width:0;">
            <div style="font-family:var(--font-display);font-size:7px;letter-spacing:1.4px;color:var(--faint);">WEAPON TYPE</div>
            <div style="font-family:var(--font-body);font-weight:600;font-size:13.5px;color:var(--txt);">${esc(reso?.weaponTypeName ?? "—")}</div>
          </div>
        </div>
      </div>`;

  return `
      <div class="bv2-card">
        <span class="bv2-card__stripe"></span>
        <div style="display:flex;align-items:stretch;padding:10px;">
          ${charPortrait}${divider}${levelCol}${divider}${buildCol}${divider}${weaponCol}${divider}${weaponPortrait}
        </div>
      </div>`;
}

// Short label for a stat-node's full name (e.g. "Crit. Rate+" → "CR") — the
// node button is too small (36px) for the full dataset string.
function statAbbr(name) {
  if (/Crit\.?\s*Rate/i.test(name)) return "CR";
  if (/Crit\.?\s*DMG/i.test(name)) return "CD";
  if (/Healing/i.test(name)) return "HEAL";
  if (/^ATK/i.test(name)) return "ATK";
  if (/^DEF/i.test(name)) return "DEF";
  if (/^HP/i.test(name)) return "HP";
  const dmg = name.match(/^(\w+)\s+DMG/i);
  if (dmg) return dmg[1].slice(0, 3).toUpperCase();
  return name
    .replace(/[+\s.]/g, "")
    .slice(0, 4)
    .toUpperCase();
}

// Forte (diamond) or stat (circle) node button. Tiered exactly like
// Sequence/Refinement: the left node is the root (t1) of the right one (t2) —
// clicking t2 activates both, clicking the topmost active node drops it down
// one level, clicking a lower node while a higher one is active drops back
// down to that level. The engine's setStatNode/setInherentSkill still take
// each index independently; the cascade is enforced here in the click handler
// via the shared tier() helper.
function skillNode({ active, abbr, isForte, tip, dataAttrs }) {
  const shape =
    isForte ?
      "border-radius:6px;transform:rotate(45deg) scale(0.88);"
    : "border-radius:50%;";
  const style =
    `width:36px;height:36px;${shape}cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .10s;padding:0;flex:none;` +
    (active ?
      "border:2px solid var(--acc);background:radial-gradient(circle at 50% 50%,color-mix(in srgb, var(--acc) 70%, transparent),color-mix(in srgb, var(--acc) 20%, transparent));box-shadow:0 0 11px color-mix(in srgb, var(--acc) 65%, transparent);"
    : "border:2px dashed var(--nodebd);background:var(--node);");
  const innerStyle =
    `font-family:var(--font-display);font-weight:700;font-size:9.5px;color:${active ? "var(--on-acc-soft)" : "var(--faint)"};` +
    (isForte ? "transform:rotate(-45deg);" : "");
  return `<button class="bv2-node" ${dataAttrs} data-tip-title="${esc(tip.title)}" ${tip.desc ? `data-tip-desc="${esc(tip.desc)}"` : ""} style="${style}"><span style="${innerStyle}">${esc(abbr)}</span></button>`;
}

function skillLevelDots(level) {
  return Array.from(
    { length: 10 },
    (_, i) =>
      `<span style="width:3px;height:3px;border-radius:50%;background:${i < level ? "var(--acc)" : "var(--nodebd)"};"></span>`,
  ).join("");
}

function renderSkillLevels() {
  const b = api.build;
  const reso = resonatorOf();
  const inherentSkills = reso?.inherentSkills ?? [];
  const statNodeBonuses = reso?.statNodeBonuses ?? {};
  const inherentActive = b.inherentSkillsActive ?? [true, true];
  const statActive = b.statNodesActive ?? {};

  const columns = SKILL_KEYS.map((key) => {
    const isForte = key === "forte";
    const level = b.skillLevels[key];

    const nodesHtml =
      isForte ?
        (() => {
          const curTier =
            inherentActive[1] !== false ? 2
            : inherentActive[0] !== false ? 1
            : 0;
          return inherentSkills
            .map((sk, i) => {
              const n = i + 1,
                active = n <= curTier;
              return skillNode({
                active,
                abbr: `IH${n}`,
                isForte: true,
                tip: {
                  title: `${active ? "Active" : "Locked"} · IH${n} ${sk.name}`,
                  desc: sk.desc,
                },
                dataAttrs: `data-act="inherent-node" data-n="${n}"`,
              });
            })
            .join("");
        })()
      : (() => {
          const nodes = (statNodeBonuses[key] ?? [])
            .slice()
            .sort((a, z) => a.tier - z.tier);
          const arr = statActive[key];
          const curTier =
            arr?.[1] !== false ? 2
            : arr?.[0] !== false ? 1
            : 0;
          return nodes
            .map((node, i) => {
              const n = i + 1,
                active = n <= curTier;
              const pctStr = (node.value * 100)
                .toFixed(2)
                .replace(/\.?0+$/, "");
              return skillNode({
                active,
                abbr: statAbbr(node.name),
                isForte: false,
                tip: {
                  title: `${active ? "Active" : "Locked"} · ${node.name.replace("+", "")} +${pctStr}%`,
                },
                dataAttrs: `data-act="stat-node" data-col="${esc(key)}" data-n="${n}"`,
              });
            })
            .join("");
        })();

    return `
          <div style="background:var(--inp);border:1px solid var(--bd);border-radius:10px;padding:6px 6px;display:flex;flex-direction:column;align-items:center;gap:10px;min-width:0;">
            <div style="font-family:var(--font-display);font-weight:600;font-size:12px;color:var(--txt);text-align:center;line-height:1.2;min-height:20px;display:flex;align-items:center;justify-content:center;">${esc(SKILL_LABELS[key])}</div>
            <div style="display:flex;align-items:center;justify-content:center;gap:12px;min-height:24px;">${nodesHtml || `<span style="font-family:var(--font-body);font-size:10px;color:var(--faint);">No nodes</span>`}</div>
            <div style="width:100%;background:var(--node);border:1px solid var(--bd);border-radius:8px;padding:2px 6px 8px 6px;">
              <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:6px;">
                <span style="font-family:var(--font-display);font-size:8.5px;letter-spacing:1.3px;padding:0 0 0 2px;color:var(--faint);">LEVEL</span>
                <span data-disp="skill-level:${key}" style="font-family:var(--font-body);font-weight:700;font-size:19px;color:var(--acc);">${level}<span style="font-size:10px;color:var(--faint);font-weight:400;"> /10</span></span>
              </div>
              <input class="bv2-slider" type="range" min="1" max="10" value="${level}" data-act="skill-level" data-key="${esc(key)}" style="--pct:${pct1to10(level)};">
              <div style="display:flex;justify-content:space-between;margin-top:0px;padding:0 3px;">${skillLevelDots(level)}</div>
            </div>
          </div>`;
  }).join("");

  return `
      <div class="bv2-card">
        <span class="bv2-card__stripe"></span>
        <div class="bv2-card__head">
          <div class="bv2-title"><span class="bv2-title__bar"></span><span class="bv2-title__txt">SKILL LEVELS</span></div>
          <div style="display:flex;gap:8px;">
            <button data-act="skills-reset" style="font-family:var(--font-display);font-weight:600;font-size:10.5px;letter-spacing:1px;color:var(--dim);background:var(--inp);border:1px solid var(--bd);border-radius:8px;padding:8px 10px;cursor:pointer;">RESET ALL</button>
            <button data-act="skills-max" style="font-family:var(--font-display);font-weight:700;font-size:10.5px;letter-spacing:1px;color:var(--on-acc);background:var(--acc);border:1px solid var(--acc);border-radius:8px;padding:8px 10px;cursor:pointer;box-shadow:0 1px 8px color-mix(in srgb, var(--acc) 35%, transparent);">MAX ALL</button>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;padding:10px;">${columns}</div>
      </div>`;
}

// Left-rail echo slot card (echopanel-v2 handoff). Collapsed cards show the
// icon/name/main-stat chip + slotted substat chips + a "+level · n/5" footer;
// the SELECTED card instead grows its icon and shows a live level slider,
// plus the connector ("neck") bridging it into the editor frame on its right
// — see squareEchoFrameCorners() for the runtime corner-squaring this needs.
function renderEchoSlotCard(i, echo) {
  const isMain = i === 0;
  const targetCost =
    i === 0 ? 4
    : i <= 2 ? 3
    : 1;
  const accent = isMain ? GOLD : "var(--acc)";
  const tag = isMain ? "MAIN ECHO" : `SLOT ${i + 1}`;
  const tagStyle = `font-family:var(--font-display);font-size:8.5px;letter-spacing:1.4px;color:${isMain ? GOLD : "var(--faint)"};padding-left:2px;`;

  if (!echo) {
    return `<div style="display:flex;flex-direction:column;gap:6px;"><span style="${tagStyle}">${tag}</span>
          <button data-act="pick-echo" data-slot="${i}" data-cost="${targetCost}" style="width:100%;min-height:72px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;cursor:pointer;border-radius:12px;border:1.5px dashed var(--bd2);background:var(--node);">
            <span style="font-size:24px;font-weight:300;line-height:1;color:var(--faint);">+</span>
            <span style="font-family:var(--font-display);font-size:9px;letter-spacing:1px;color:var(--faint);">ADD ECHO · ${targetCost}c</span>
          </button>
        </div>`;
  }

  const def = echoDefOf(echo);
  const so = sonataOf(echo.sonataId);
  const sonataClickable =
    (def?.sonataIds ?? []).filter((id) => id != null).length > 1;
  const unlocked = unlockedSubStatCount(echo.level);
  const mainOpt = mainStatsForCost(echo.cost, api.dataset).find(
    (o) =>
      echo.mainStat &&
      o.propId === echo.mainStat.propId &&
      o.addType === echo.mainStat.addType,
  );
  const mainLabel = mainOpt?.name ?? echo.mainStat?.name ?? "— no main stat";
  const mainVal =
    echo.mainStat ? fmtSub(echo.mainStat.value, echo.mainStat.isPercent) : "";
  const sel = api.echoSlot === i;
  const iconSize = sel ? 66 : 66;

  const subChips = (echo.subStats ?? [])
    .map((s, si) => {
      const flagged = si >= unlocked;
      const rolls = possibleRollsFor(s, api.dataset.statRanges);
      const idx = rolls.indexOf(s.value);
      const col = idx >= 0 ? rollColorFor(idx, rolls.length) : ROLL_SCALE[0];
      return `<span title="${esc(s.name)} +${esc(fmtSub(s.value, s.isPercent))}" style="font-family:var(--font-display);font-weight:700;font-size:9px;border-radius:5px;padding:2px 6px;color:${flagged ? "var(--warn)" : col.c};background:${flagged ? "color-mix(in srgb, var(--gold) 14%, transparent)" : col.bg};">${esc(SUBSTAT_ABBR[s.name] ?? s.name.slice(0, 3))}</span>`;
    })
    .join("");

  const skillDesc = echoActiveSkillDesc(def);
  // Flag the echo with the most upgrade headroom (lowest-value substats) so the
  // user can see at a glance which one to re-roll first.
  const isWorst = liveAnalysis()?.worstSlot === i;
  const worstBadge =
    isWorst ?
      `<span title="Most upgrade headroom — its substats add the least damage." style="font-family:var(--font-display);font-weight:700;font-size:8px;letter-spacing:.6px;color:var(--warn);border:1px solid var(--warn);border-radius:4px;padding:1px 4px;margin-left:6px;">↑ MOST TO GAIN</span>`
    : "";
  const cardClass = `bv2-echo-card${sel ? (isMain ? " is-selected-main" : " is-selected") : ""}`;

  return `<div style="display:flex;flex-direction:column;gap:6px;"><span style="${tagStyle}">${tag}${worstBadge}</span>
      <div class="${cardClass}" data-act="select-echo" data-slot="${i}" role="button" tabindex="0" title="${esc(def?.name || "Unknown echo")}">
        ${sel ? `<span class="bv2-echo-neck" style="--ec:${accent};"></span>` : ""}
        <div style="position:absolute;top:0;right:9px;transform:translateY(-50%);display:flex;gap:4px;z-index:2;">
          <span data-act="remove-echo" data-slot="${i}" title="Remove echo" role="button" style="width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;font-size:9px;border-radius:5px;border:1px solid var(--warn);background:var(--card2);color:var(--warn);flex:none;cursor:pointer;box-shadow:0 1px 5px rgba(var(--shadow-rgb),.5);">✕</span>
        </div>
        <div style="display:flex;align-items:flex-start;gap:6px;min-width:0;">
          <span data-act="switch-echo" data-slot="${i}" data-tip-title="${esc(def?.name || "Unknown echo")}" data-tip-desc="${esc(skillDesc ? `Active Skill: ${skillDesc}` : "")}" style="width:${iconSize}px;height:${iconSize}px;flex:none;border-radius:8px;border:1px solid var(--bd2);overflow:hidden;display:inline-flex;align-items:center;justify-content:center;background:var(--node);cursor:pointer;transition:width .14s,height .14s;">${dynamicIconHtml(def?.iconUrl, { label: def?.name, size: iconSize })}</span>
          <div style="display:flex;flex-direction:row;align-items:flex-start;gap:8px;min-width:0;">
            <span style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;flex:none;border-radius:6px;font-family:var(--font-display);font-weight:700;font-size:12px;border:1.5px solid ${isMain ? GOLD : "var(--bd2)"};color:${isMain ? GOLD : "var(--dim)"};background:${isMain ? "color-mix(in srgb, var(--gold) 12%, transparent)" : "var(--node)"};">${echo.cost}</span>
            ${so ? `<span ${sonataClickable ? `data-act="sonata-menu" data-slot="${i}"` : ""} data-tip-title="${esc(so.name)}" data-tip-desc="${esc(sonataTooltipDesc(echo.sonataId))}" style="display:inline-flex;align-items:center;justify-content:center;gap:1px;height:26px;flex:none;cursor:${sonataClickable ? "pointer" : "default"};">${sonataIconHtml(echo.sonataId, 24)}${sonataClickable ? SONATA_SWITCH_ARROW : ""}</span>` : ""}
          </div>
        </div>
        <div style="min-width:0;font-family:var(--font-display);font-weight:700;font-size:12px;color:var(--txt);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(def?.name || "Unknown echo")}</div>
        <div style="font-family:var(--font-display);font-weight:700;font-size:12px;color:${accent};background:${isMain ? "color-mix(in srgb, var(--gold) 10%, transparent)" : "color-mix(in srgb, var(--acc) 10%, transparent)"};border:1px solid ${isMain ? "color-mix(in srgb, var(--gold) 40%, transparent)" : "color-mix(in srgb, var(--acc) 35%, transparent)"};border-radius:7px;padding:5px 8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(mainLabel)}<span style="color:var(--faint);font-weight:400;"> ${esc(mainVal)}</span></div>
        ${
          sel ?
            `<div style="display:flex;align-items:center;gap:8px;">
               <span style="font-family:var(--font-display);font-size:9px;letter-spacing:1px;color:var(--faint);">LV</span>
               <input class="bv2-slider" type="range" min="0" max="25" step="5" value="${echo.level}" data-act="echo-level" data-slot="${i}" style="--pct:${Math.round((echo.level / 25) * 100)}%;flex:1;">
               <span data-disp="echo-level:${i}" style="font-family:var(--font-display);font-weight:700;font-size:13px;color:var(--acc);min-width:36px;text-align:right;">${echo.level}<span style="font-size:9px;color:var(--faint);font-weight:400;">/25</span></span>
             </div>`
          : `<div style="display:flex;flex-direction:column;gap:6px;width:100%;">
               <div style="display:flex;flex-wrap:wrap;gap:4px;min-height:18px;">${subChips}</div>
               <span style="font-family:var(--font-display);font-size:9.5px;color:var(--faint);">+${echo.level} · ${(echo.subStats ?? []).length}/5</span>
             </div>`
        }
      </div>
    </div>`;
}

function renderSubstatTally() {
  const totals = new Map();
  for (const e of api.build.echoes) {
    for (const s of e?.subStats ?? [])
      totals.set(s.name, (totals.get(s.name) ?? 0) + s.value);
  }
  if (totals.size === 0) return "";
  const ORDER = [
    "Crit. Rate",
    "Crit. DMG",
    "ATK%",
    "ATK",
    "HP%",
    "HP",
    "DEF%",
    "DEF",
    "Energy Regen",
    "Basic Attack DMG Bonus",
    "Heavy Attack DMG Bonus",
    "Resonance Skill DMG Bonus",
    "Resonance Liberation DMG Bonus",
  ];
  const chips = [...totals.entries()]
    .sort((a, b) => ORDER.indexOf(a[0]) - ORDER.indexOf(b[0]))
    .map(([name, tot]) => {
      const opt = api.dataset.echoSubStats.find((s) => s.name === name);
      const rolls = opt ? possibleRollsFor(opt, api.dataset.statRanges) : [];
      const maxTotal = (rolls[rolls.length - 1] ?? 0) * 5;
      const ratio = maxTotal > 0 ? Math.min(tot / maxTotal, 1) : 0;
      const col = rollColorFor(Math.round(ratio * 7), 8);
      const isPercent = opt?.isPercent ?? false;
      return `<span style="font-family:var(--font-display);font-weight:700;font-size:10px;border-radius:6px;padding:3px 8px;background:${col.bg};color:${col.c};white-space:nowrap;">${esc(SUBSTAT_ABBR[name] ?? name)} ${fmtSub(tot, isPercent)} / ${fmtSub(maxTotal, isPercent)}</span>`;
    })
    .join("");
  return `<div style="padding:7px 18px;border-top:1px solid var(--bd);display:flex;align-items:center;gap:7px;flex-wrap:wrap;background:var(--node);">
      <span style="font-family:var(--font-display);font-size:8px;letter-spacing:1.5px;color:var(--faint);flex:none;margin-right:2px;">SUBSTATS</span>${chips}
    </div>`;
}

// =============================================================================
// Stat Priority panel (P12 §9) — frozen optimizer weights applied to this build
// =============================================================================

// The build's dominant ("active set") sonata — the id appearing on the most
// echoes. Used to look up the meta entry; if it isn't a computed set, the
// lookup returns null and the panel shows the "no suggestion" fallback.
function dominantSonataId(echoes) {
  const counts = new Map();
  for (const e of echoes ?? []) {
    if (e?.sonataId != null)
      counts.set(e.sonataId, (counts.get(e.sonataId) ?? 0) + 1);
  }
  let best = null,
    bestN = 0;
  for (const [id, n] of counts)
    if (n > bestN) {
      best = id;
      bestN = n;
    }
  return best;
}

const MODE_LABELS = {
  dmgFocus: "DMG Focus",
  balanced: "Balanced",
  erFocus: "ER Focus",
};
const MODE_TIPS = {
  dmgFocus: "Pure solo DPS — Energy Regen ignored entirely.",
  balanced:
    "Reach a target Energy Regen (default ~125%), then prioritize damage.",
  erFocus:
    "Energy Regen ranked for ER-scaling kits; otherwise the solo ER breakpoint depends on team/multi-cycle energy.",
};

// Live per-roll substat values + per-echo upgrade headroom for the CURRENT
// build, memoized by build identity (commit() makes a new build object on every
// change, so identity equality is a correct cache key). Recomputes ~9 sims; only
// when the build actually changes.
let _liveCache = { build: undefined, result: null };
function liveAnalysis() {
  if (_liveCache.build === api.build) return _liveCache.result;
  let result = null;
  try {
    result = echoUpgradeRanking(api.build, api.dataset);
  } catch {
    result = null;
  }
  _liveCache = { build: api.build, result };
  return result;
}

// Map of weight-key → live normalized per-roll value (0..100) for the current
// build, or null when not simmable. Used to colour the substat palette + panel.
function liveValueMap() {
  const live = liveAnalysis()?.live;
  if (!live) return null;
  return new Map(live.values.map((v) => [v.key, v.normalized]));
}

function renderStatPriority() {
  return statPriorityPanelHtml({
    meta: api.meta,
    build: api.build,
    dataset: api.dataset,
    statMode: api.statMode,
    live: liveAnalysis(),
  });
}

// P13 — Suggested Teams panel (curated META comps + sim alternatives). Omitted
// entirely when the character has no suggestions, so uncovered builds show no
// empty-state noise (the component's empty-state line is for explicit callers).
function renderSuggestedTeamsPanel() {
  if (!api.meta) return "";
  if (!suggestedTeamsFor(api.meta, api.build.resonatorId).length) return "";
  return `<div class="bv2-card" style="background:var(--card);border:1px solid var(--bd);border-radius:14px;overflow:hidden;">
        ${renderSuggestedTeams(api.meta, api.dataset, api.build.resonatorId)}
    </div>`;
}

// True when a build is "empty" enough to offer the suggested default — no weapon
// and no echoes equipped (a fresh roster pick).
function isEmptyBuild(build) {
  return !build.weapon && !(build.echoes ?? []).some(Boolean);
}

// Pick a concrete echo id for a slot: a real echo of the right cost that can
// carry the suggested sonata, preferring one whose Echo-Skill element matches the
// resonator (the 4-cost main echo's active skill is element-typed). Returns null
// only when no such echo exists (→ "choose an echo" placeholder, not a crash).
function pickEchoId(dataset, sonataId, cost, element) {
  const cands = (dataset?.echoes ?? []).filter(
    (e) => e.name && e.cost === cost && (e.sonataIds ?? []).includes(sonataId),
  );
  if (cands.length === 0) return null;
  const elementOf = (e) =>
    e.activeSkill?.element ?? e.elementTypes?.[0] ?? null;
  return (cands.find((e) => elementOf(e) === element) ?? cands[0]).id;
}

/**
 * Apply a suggested build (best sonata × weapon + reference rotation) onto a
 * build: equips the weapon, fills the 5 echo slots with REAL echoes of the
 * suggested sonata + the recommended main stats (substats left empty for the
 * user to roll), and sets the reference rotation. Pure — returns a new build.
 * `dataset` is needed to resolve concrete echoes; omit it only in unit tests
 * that don't care about echo identity. Exported for tests.
 */
function applySuggestion(build, suggestion, dataset) {
  let b = build;
  if (suggestion.weaponId != null) b = setWeapon(b, suggestion.weaponId);
  const element =
    dataset?.resonators?.find((r) => r.id === build.resonatorId)?.element ??
    null;
  const mains = suggestion.templateStats?.mains ?? [];
  mains.forEach((m, i) => {
    b = setEcho(b, i, {
      id: pickEchoId(dataset, suggestion.sonataId, m.cost, element),
      cost: m.cost,
      level: 25,
      starLevel: 5,
      sonataId: suggestion.sonataId,
      mainStat: {
        propId: m.propId,
        addType: m.addType,
        value: m.value,
        isPercent: m.isPercent,
      },
      subStats: [],
    });
  });
  const rot = (suggestion.referenceRotation ?? []).slice();
  return { ...b, rotation: rot, rotationMeta: rot.map(() => ({})) };
}

// The live stat-priority panel: per-roll substat values computed at the user's
// ACTUAL current stats (not a frozen anchor), plus the worst-echo callout. This
// is the primary "what should I roll next" view. Pure markup.
function liveStatPanelHtml({ b, dataset, analysis, meta }) {
  const live = analysis.live;
  const header = `<div style="display:flex;align-items:center;gap:10px;padding:13px 18px;border-bottom:1px solid var(--bd);">
        <span style="font-family:var(--font-display);font-size:11px;letter-spacing:1.5px;color:var(--txt);">STAT PRIORITY</span>
        <span style="font-family:var(--font-body);font-size:10px;color:var(--acc);">⚡ live · your current stats</span>
      </div>`;

  const rows = live.values
    .map((v) => {
      const pct = Math.max(2, v.normalized ?? 0);
      return `<div style="display:flex;align-items:center;gap:10px;padding:5px 0;">
            <span style="font-family:var(--font-body);font-weight:700;font-size:12.5px;color:var(--txt);min-width:150px;">${esc(v.label)}</span>
            <div style="flex:1;height:8px;border-radius:5px;background:var(--node);overflow:hidden;"><div style="width:${pct}%;height:100%;background:var(--acc);"></div></div>
            <span style="font-family:var(--font-display);font-size:10px;color:var(--dim);min-width:28px;text-align:right;">${(v.normalized ?? 0).toFixed(0)}</span>
          </div>`;
    })
    .join("");

  // Current Energy Regen (informational — energy availability, not damage).
  const erPct = Math.round(
    (resolveTotalStats(b, dataset).energyRegen ?? 0) * 100,
  );
  const erMeta =
    meta ?
      metaFor(meta, b.resonatorId, b.chain, dominantSonataId(b.echoes))
    : null;
  const erTarget =
    erMeta?.erMode?.libCostKnown ?
      Math.round((erMeta.erMode.balancedTarget ?? 1.25) * 100)
    : null;
  const erLine =
    erTarget != null ?
      `<div style="font-family:var(--font-body);font-size:12px;color:${erPct < erTarget ? "var(--warn)" : "var(--dim)"};">Energy Regen ${erPct}%${erPct < erTarget ? ` → aim for ~${erTarget}% so Liberation is ready` : ` ✓ (target ~${erTarget}%)`}</div>`
    : `<div style="font-family:var(--font-body);font-size:12px;color:var(--faint);">Energy Regen ${erPct}%</div>`;

  // Worst-echo callout — the slot with the most upgrade headroom.
  const worst = analysis.worstSlot;
  const worstLine =
    worst != null ?
      `<div style="font-family:var(--font-body);font-size:12px;color:var(--warn);font-weight:600;">↑ Echo slot ${worst + 1} has the most upgrade headroom — its substats add the least; re-roll it first.</div>`
    : "";

  return `<div class="bv2-card" style="background:var(--card);border:1px solid var(--bd);border-radius:14px;overflow:hidden;">
      ${header}
      <div style="padding:14px 18px 16px 18px;display:flex;flex-direction:column;gap:10px;">
        ${erLine}
        <div style="display:flex;flex-direction:column;">${rows}</div>
        ${worstLine}
        <div style="font-family:var(--font-body);font-size:10.5px;color:var(--faint);border-top:1px solid var(--bd);padding-top:8px;">
          Value = extra rotation damage per +1 substat roll, at your current stats. Recomputed live as you change the build. The echo editor highlights the recommended substats.
        </div>
      </div>
    </div>`;
}

// Pure panel markup (testable in isolation — no module state, no DOM).
// `live` is the echoUpgradeRanking() result for the current build (or null).
function statPriorityPanelHtml({ meta, build, dataset, statMode, live }) {
  const b = build;

  // LIVE panel — the primary view whenever the build is simmable (echoes + a
  // rotation). Per-roll values are computed at the user's CURRENT stats, so the
  // ranking reflects real diminishing returns, not a frozen anchor. Works for
  // covered AND uncovered characters (no meta needed).
  if (live?.live?.values?.length) {
    return liveStatPanelHtml({ b, dataset, analysis: live, meta });
  }

  // No meta loaded at all (file missing/stale) → omit the panel silently; the
  // Rotation + Ability Damage panels already ARE the live sim (§9.4 fallback).
  if (!meta) return "";
  const sonataId = dominantSonataId(b.echoes);
  const entry =
    sonataId == null ? null : metaFor(meta, b.resonatorId, b.chain, sonataId);

  const header = `<div style="display:flex;align-items:center;gap:10px;padding:13px 18px;border-bottom:1px solid var(--bd);">
        <span style="font-family:var(--font-display);font-size:11px;letter-spacing:1.5px;color:var(--txt);">STAT PRIORITY</span>
        <span style="font-family:var(--font-body);font-size:10px;color:var(--faint);">precomputed · per sequence + sonata</span>
      </div>`;

  if (!entry) {
    // Covered character on an empty/unmatched build → offer the suggested
    // best-in-slot default (sonata × weapon + reference rotation) one-click.
    const suggestion = suggestedBuildFor(meta, b.resonatorId);
    if (suggestion && isEmptyBuild(b)) {
      const weaponLabel =
        suggestion.weaponName ??
        dataset.weapons?.find((w) => w.id === suggestion.weaponId)?.name ??
        "weapon";
      const sonataLabel =
        suggestion.sonataName ??
        dataset.sonatas?.find((s) => s.id === suggestion.sonataId)?.name ??
        `set ${suggestion.sonataId}`;
      const steps = (suggestion.referenceRotation ?? []).length;
      return `<div class="bv2-card" style="background:var(--card);border:1px solid var(--bd);border-radius:14px;overflow:hidden;">
              ${header}
              <div style="padding:16px 18px;display:flex;flex-direction:column;gap:12px;">
                <div style="font-family:var(--font-body);font-size:12.5px;color:var(--dim);line-height:1.5;">
                  Suggested starting build for <b style="color:var(--txt);">${esc(dataset.resonators?.find((r) => r.id === b.resonatorId)?.name ?? "this resonator")}</b> — best sonata + weapon found by simming the reference rotation.
                </div>
                <div style="display:flex;flex-direction:column;gap:6px;font-family:var(--font-body);font-size:12.5px;color:var(--txt);">
                  <div>🜲 <b>Sonata:</b> ${esc(sonataLabel)} ×5</div>
                  <div>⚔ <b>Weapon:</b> ${esc(weaponLabel)}</div>
                  <div>↻ <b>Rotation:</b> ${steps} steps (kit-faithful reference)</div>
                </div>
                <button data-act="apply-suggested" style="align-self:flex-start;font-family:var(--font-display);font-weight:600;font-size:11px;letter-spacing:.7px;border-radius:8px;padding:9px 16px;cursor:pointer;background:var(--acc);color:var(--on-acc);border:none;">APPLY SUGGESTED BUILD</button>
                <div style="font-family:var(--font-body);font-size:10.5px;color:var(--faint);">Equips the set + weapon + recommended main stats and the reference rotation. Substats are left for you to roll.</div>
              </div>
            </div>`;
    }
    return `<div class="bv2-card" style="background:var(--card);border:1px solid var(--bd);border-radius:14px;overflow:hidden;">
          ${header}
          <div style="padding:16px 18px;font-family:var(--font-body);font-size:12.5px;color:var(--dim);line-height:1.5;">
            No precomputed suggestion available for this configuration${sonataId == null ? "" : " (sequence / sonata not covered yet)"}.
            <span style="color:var(--faint);">The Rotation and Ability Damage panels below run the live sim on your actual build.</span>
          </div>
        </div>`;
  }

  const mode = statMode;
  const er = erStatus(b, entry, dataset);
  const priority = statPriority(entry, mode);
  const far = isFarFromAnchor(b, entry, dataset);

  // Mode toggle.
  const modeBtns = SOLO_MODES.map((m) => {
    const onSel = m === mode;
    return `<button data-act="stat-mode" data-mode="${m}" data-tip-desc="${esc(MODE_TIPS[m])}" style="flex:1 1 0;border:none;border-radius:6px;cursor:pointer;font-family:var(--font-body);font-weight:600;font-size:11px;padding:7px 4px;transition:all .14s;${onSel ? "background:var(--acc);color:var(--on-acc);box-shadow:0 1px 6px color-mix(in srgb, var(--acc) 40%, transparent);" : "background:transparent;color:var(--dim);"}">${MODE_LABELS[m]}</button>`;
  }).join("");

  // ER status line. The scaling / not-energy-gated facts show in every mode;
  // the "reach the target" gate advice is suppressed in DMG Focus, which by
  // definition ignores ER.
  let erLine = "";
  if (er.scalesWithEr) {
    erLine = `<div style="font-family:var(--font-body);font-size:12px;color:var(--acc);">⚡ Energy Regen scales this character's damage — more is better.</div>`;
  } else if (!er.libCostKnown) {
    erLine = `<div style="font-family:var(--font-body);font-size:12px;color:var(--faint);">Liberation isn't energy-gated for this resonator — Energy Regen isn't required.</div>`;
  } else if (mode === "dmgFocus") {
    erLine = `<div style="font-family:var(--font-body);font-size:11px;color:var(--faint);">DMG Focus ignores Energy Regen — switch to Balanced for the ER target.</div>`;
  } else if (er.belowTarget) {
    erLine = `<div style="font-family:var(--font-body);font-size:12.5px;color:var(--warn);font-weight:600;">Energy Regen ${(er.current * 100).toFixed(0)}% → aim for ~${(er.target * 100).toFixed(0)}%. Below this, your Liberation may not be ready in time.</div>`;
  } else {
    erLine = `<div style="font-family:var(--font-body);font-size:12px;color:var(--dim);">Energy Regen ${(er.current * 100).toFixed(0)}% ✓ (target ~${(er.target * 100).toFixed(0)}%)</div>`;
  }

  // Priority list with relative weight bars.
  const rows = priority
    .map((p) => {
      if (p.key === "energyRegen") {
        return `<div style="display:flex;align-items:center;gap:10px;padding:5px 0;">
                <span style="font-family:var(--font-body);font-weight:700;font-size:12.5px;color:var(--txt);min-width:150px;">${esc(p.label)}</span>
                <span style="font-family:var(--font-body);font-size:11px;color:var(--faint);">${p.gate ? esc(p.note ?? "") : esc(p.note ?? "")}</span>
              </div>`;
      }
      const pct = Math.max(2, p.normalized ?? 0);
      return `<div style="display:flex;align-items:center;gap:10px;padding:5px 0;">
            <span style="font-family:var(--font-body);font-weight:700;font-size:12.5px;color:var(--txt);min-width:150px;">${esc(p.label)}</span>
            <div style="flex:1;height:8px;border-radius:5px;background:var(--node);overflow:hidden;"><div style="width:${pct}%;height:100%;background:var(--acc);"></div></div>
            <span style="font-family:var(--font-display);font-size:10px;color:var(--dim);min-width:28px;text-align:right;">${(p.normalized ?? 0).toFixed(0)}</span>
          </div>`;
    })
    .join("");

  const sonataName =
    dataset.sonatas?.find((s) => s.id === sonataId)?.name ?? `set ${sonataId}`;
  const caveat =
    far ?
      `<div style="font-family:var(--font-body);font-size:11px;color:var(--faint);padding-top:8px;">Assumes a well-invested build; your priorities may differ until your crit / ATK are closer to endgame.</div>`
    : "";

  return `<div class="bv2-card" style="background:var(--card);border:1px solid var(--bd);border-radius:14px;overflow:hidden;">
      ${header}
      <div style="display:flex;gap:6px;padding:12px 18px 0 18px;">${modeBtns}</div>
      <div style="padding:12px 18px 16px 18px;display:flex;flex-direction:column;gap:10px;">
        ${erLine}
        <div style="display:flex;flex-direction:column;">${rows}</div>
        <div style="font-family:var(--font-body);font-size:10.5px;color:var(--faint);border-top:1px solid var(--bd);padding-top:8px;">
          For S${b.chain} · ${esc(sonataName)}. ${esc(MODE_TIPS[mode])}
        </div>
        ${caveat}
      </div>
    </div>`;
}

function renderSonataStrip() {
  const counts = new Map();
  for (const e of api.build.echoes) {
    if (e?.sonataId != null)
      counts.set(e.sonataId, (counts.get(e.sonataId) ?? 0) + 1);
  }

  const pcStyle = (on) =>
    `font-family:var(--font-display);font-weight:700;font-size:8.5px;letter-spacing:.5px;border-radius:5px;padding:4px 6px 2px 6px;border:1px solid ${on ? "var(--acc)" : "var(--bd)"};color:${on ? "var(--acc)" : "var(--faint)"};background:${on ? "color-mix(in srgb, var(--acc) 12%, transparent)" : "transparent"};`;
  const groups = [...counts.entries()]
    .filter(([, c]) => c >= 2)
    .map(([sonataId, c]) => {
      const so = sonataOf(sonataId);
      if (!so) return "";
      const has5 = c >= 5;
      return `<div style="display:flex;align-items:center;gap:14px;background:var(--inp);border:1px solid var(--bd);border-radius:9px;padding:6px 13px;flex-wrap:wrap;">
          <div style="display:flex;align-items:center;gap:8px;">
            <span data-tip-title="${esc(so.name)}" data-tip-desc="${esc(sonataTooltipDesc(sonataId))}" style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;flex:none;cursor:default;">${sonataIconHtml(sonataId, 22)}</span>
            <span style="font-family:var(--font-body);font-weight:700;font-size:12px;color:var(--txt);white-space:nowrap;">${esc(so.name)} ×${c}</span>
          </div>
          <div style="display:flex;align-items:center;gap:7px;"><span style="${pcStyle(true)}">2PC</span></div>
          <div style="display:flex;align-items:center;gap:7px;"><span style="${pcStyle(has5)}">5PC</span></div>
        </div>`;
    })
    .join("");

  return `<div style="display:flex;align-items:center;gap:11px;flex-wrap:wrap;padding:11px 18px;border-top:1px solid var(--bd);border-bottom:1px solid var(--bd);background:var(--node);">
      <span style="font-family:var(--font-display);font-size:9px;letter-spacing:1.5px;color:var(--faint);">SONATA</span>
      ${groups || `<span style="font-family:var(--font-body);font-size:11px;color:var(--faint);">No set bonus yet — slot matching echoes.</span>`}
    </div>`;
}

// SUBSTATS box header: title + chosen/cap counter + hint (over-cap/full/
// unlocked) + reset — replaces the old instructional subtext (echopanel-v2
// handoff point 3).
function renderSubstatsHeader(echo, slotIndex) {
  const chosen = (echo.subStats ?? []).length;
  const unlocked = unlockedSubStatCount(echo.level);
  const full = chosen >= 5;
  const over = chosen > unlocked;
  const counterColor = over ? "var(--warn)" : full ? "var(--acc)" : "var(--txt)";
  const hint =
    over ?
      `${chosen - unlocked} over the +${echo.level} cap — ${unlocked} unlocked`
    : full ? "all slots used — tap an active roll to clear it"
    : `${unlocked}/5 unlocked at Lv${echo.level}`;
  return `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;flex-wrap:wrap;">
      <div style="display:flex;align-items:baseline;gap:9px;flex-wrap:wrap;">
        <span style="font-family:var(--font-display);font-size:9px;letter-spacing:1.5px;color:var(--faint);">SUBSTATS</span>
        <span style="font-family:var(--font-display);font-weight:700;font-size:12px;color:${counterColor};">${chosen}<span style="color:var(--faint);font-weight:400;"> / 5</span></span>
        <span style="font-family:var(--font-body);font-size:10px;color:${over ? "var(--warn)" : "var(--faint)"};">${esc(hint)}</span>
      </div>
      <button data-act="reset-echo-stats" data-slot="${slotIndex}" style="font-family:var(--font-display);font-weight:600;font-size:9.5px;letter-spacing:.8px;color:var(--dim);background:var(--node);border:1px solid var(--bd);border-radius:7px;padding:6px 11px;cursor:pointer;">RESET STATS</button>
    </div>`;
}

// One substat row: label (+ live-priority badge) + every possible roll value
// as a tappable button (echopanel-v2 handoff point 1) — tap a value to slot
// it, tap the active one again to clear it, tap a different value in the
// same row to re-roll into it. Replaces the old toggle-then-cycle flow.
function renderSubstatRow(echo, opt, slotIndex, unlocked, liveMap) {
  const meta = SUBSTAT_ROW_META[opt.name] ?? { label: opt.name };
  const subs = echo.subStats ?? [];
  const at = subs.findIndex(
    (s) => s.propId === opt.propId && s.addType === opt.addType,
  );
  const active = at >= 0;
  const rolls = possibleRollsFor(opt, api.dataset.statRanges);
  const activeIdx = active ? rolls.indexOf(subs[at].value) : -1;
  const canAdd = active || subs.length < unlocked;

  // Recommendation: live per-roll value for this stat at the current build.
  const liveKey = liveMap ? substatKeyOf(opt.propId) : null;
  const lv = liveKey != null ? (liveMap.get(liveKey) ?? 0) : null;
  const recCol =
    lv == null ? null
    : lv >= 70 ? "var(--acc)"
    : lv >= 35 ? "color-mix(in srgb, var(--acc) 55%, transparent)"
    : null;

  const boxes = rolls
    .map((v, idx) => {
      const isOn = active && idx === activeIdx;
      const disabled = !active && !canAdd;
      const col = rollColorFor(idx, rolls.length);
      const style =
        isOn ?
          `background:${col.bg};color:${col.c};border-color:${col.c};`
        : "";
      return `<button class="bv2-echo-roll${disabled ? " is-disabled" : ""}${isOn ? " is-active" : ""}" data-act="pick-echo-roll" data-slot="${slotIndex}" data-prop="${opt.propId}" data-addtype="${opt.addType}" data-roll="${idx}" title="${esc(opt.name)} +${esc(fmtSub(v, opt.isPercent))}" style="${style}" ${disabled ? "disabled" : ""}>${fmtSub(v, opt.isPercent)}</button>`;
    })
    .join("");

  return `<div class="bv2-echo-stat-row">
      <div class="bv2-echo-stat-row__label">
        <div style="font-family:var(--font-body);font-weight:700;font-size:13px;color:${active ? "var(--txt)" : "var(--dim)"};">${esc(meta.label)}</div>
        ${meta.sub ? `<div style="font-family:var(--font-display);font-size:7px;letter-spacing:.8px;color:var(--faint);">${meta.sub}</div>` : ""}
        ${lv != null && lv > 1 ? `<div title="Live value at this build: ${lv.toFixed(0)} / 100" style="font-family:var(--font-display);font-weight:700;font-size:8.5px;color:${recCol ?? "var(--faint)"};">${lv.toFixed(0)}</div>` : ""}
      </div>
      <div class="bv2-echo-stat-row__grid">${boxes}</div>
    </div>`;
}

// The 5 fixed-order substat group boxes (echopanel-v2 handoff point 2):
// FLAT ROLLS, MAIN STAT %, CRIT, DMG BONUS, UTILITY.
function renderSubstatGroups(echo, slotIndex) {
  const unlocked = unlockedSubStatCount(echo.level);
  const liveMap = liveValueMap();
  const groups = SUBSTAT_GROUPS.map((g) => {
    const rows = g.keys
      .map((name) => {
        const opt = api.dataset.echoSubStats.find((s) => s.name === name);
        return opt ?
            renderSubstatRow(echo, opt, slotIndex, unlocked, liveMap)
          : "";
      })
      .join("");
    return `<div class="bv2-echo-group" style="flex:${g.flexBasis};${g.minWidth ? `min-width:${g.minWidth}px;` : ""}">
        <span class="bv2-echo-group__label">${g.label}</span>
        <div class="bv2-echo-group__grid" style="grid-template-columns:${g.cols};">${rows}</div>
      </div>`;
  }).join("");
  return `<div class="bv2-echo-groups">${groups}</div>`;
}

// Editor frame — MAIN STAT box + SUBSTATS box for the currently selected rail
// slot. The frame's accent (--ea) and left-corner radii are shared with the
// connector bridging it to the selected rail card (see renderEchoSlotCard's
// .bv2-echo-neck and squareEchoFrameCorners()).
function renderEchoEditor() {
  const i = api.echoSlot;
  const echo = api.build.echoes[i];
  const isMain = i === 0;
  const accent = isMain ? GOLD : "var(--acc)";
  const cost =
    echo?.cost ??
    (i === 0 ? 4
    : i <= 2 ? 3
    : 1);

  if (!echo) {
    return `<div class="bv2-echo-frame" style="--ea:${accent};align-items:center;justify-content:center;">
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:36px 0;">
          <div style="font-family:var(--font-body);font-size:14px;color:var(--dim);">Slot ${i + 1} is empty.</div>
          <button data-act="pick-echo" data-slot="${i}" data-cost="${cost}" style="font-family:var(--font-display);font-weight:700;font-size:11px;letter-spacing:1px;color:var(--on-acc);background:var(--acc);border:none;border-radius:9px;padding:10px 18px;cursor:pointer;">+ ADD ECHO</button>
        </div>
      </div>`;
  }

  const subMain = subMainStatFor(echo.cost, echo.level);
  const mainOptions = mainStatsForCost(echo.cost, api.dataset)
    .map((o) => {
      const on =
        echo.mainStat &&
        o.propId === echo.mainStat.propId &&
        o.addType === echo.mainStat.addType;
      const val =
        mainStatValueFor(
          o,
          echo.cost,
          echo.starLevel ?? 5,
          echo.level,
          api.dataset,
        ) ?? 0;
      return `<button data-act="set-echo-main" data-slot="${i}" data-prop="${o.propId}" data-addtype="${o.addType}" style="display:inline-flex;align-items:center;font-family:var(--font-body);font-weight:600;font-size:11.5px;cursor:pointer;border-radius:8px;padding:7px 11px;border:1px solid ${on ? accent : "var(--bd)"};background:${on ? accent : "var(--node)"};color:${on ? "var(--on-acc)" : "var(--dim)"};">${esc(o.name)}<span style="margin-left:6px;font-weight:400;color:${on ? "color-mix(in srgb, var(--on-acc) 70%, transparent)" : "var(--faint)"};">${fmtSub(val, o.isPercent)}</span></button>`;
    })
    .join("");

  return `<div class="bv2-echo-frame" style="--ea:${accent};">
      <div style="background:var(--inp);border:1px solid var(--bd);border-radius:12px;padding:13px 14px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;flex-wrap:wrap;">
          <div style="display:flex;align-items:baseline;gap:10px;">
            <span style="font-family:var(--font-display);font-size:9px;letter-spacing:1.5px;color:var(--faint);">MAIN STAT</span>
            <span style="font-family:var(--font-body);font-size:10px;color:var(--dim);">tap to select · scales with level</span>
          </div>
          ${
            subMain ?
              `<div style="display:flex;align-items:center;gap:6px;font-family:var(--font-display);font-size:11px;">
              <span style="color:var(--faint);letter-spacing:.5px;">2ND</span>
              <span style="font-weight:600;color:var(--dim);">${esc(subMain.name)}</span>
              <span style="font-weight:700;color:var(--dim);">${fmtSub(subMain.value, subMain.isPercent)}</span>
              <span style="color:var(--faint);font-family:var(--font-body);font-size:9px;">auto</span>
            </div>`
            : ""
          }
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;">
          ${mainOptions}
        </div>
      </div>

      <div style="background:var(--inp);border:1px solid var(--bd);border-radius:12px;padding:13px 14px;">
        ${renderSubstatsHeader(echo, i)}
        ${renderSubstatGroups(echo, i)}
      </div>
    </div>`;
}

function renderEchoOptimizerResults() {
  const result = api.optimizerResult;
  if (!result?.slots?.length) return "";
  const rows = result.slots
    .map((s) => {
      const pctGain =
        s.dpsBaseline > 0 ?
          `+${((s.dpsOptimized / s.dpsBaseline - 1) * 100).toFixed(1)}%`
        : "";
      const mainLine =
        s.suggestedMain ?
          `<span style="color:var(--acc);font-weight:600;">${esc(s.suggestedMain.name)}</span> `
        : "";
      const subLines = s.suggestedSubs
        .map(
          (sub, idx) =>
            `<span style="color:var(--dim);">${idx + 1}. ${esc(sub.name)}</span>`,
        )
        .join(" ");
      return `<div style="display:flex;flex-wrap:wrap;align-items:baseline;gap:8px;padding:8px 0;border-top:1px solid var(--bd);font-family:var(--font-body);font-size:11.5px;">
          <span style="font-family:var(--font-display);font-weight:700;font-size:10px;letter-spacing:.6px;color:var(--faint);flex:none;">SLOT ${s.slotIndex + 1}</span>
          <span style="color:var(--acc);font-weight:700;flex:none;">${esc(pctGain)}</span>
          <span>${mainLine}${subLines}</span>
        </div>`;
    })
    .join("");
  return `<div style="padding:14px 18px;border-top:1px solid var(--bd);">
      <div style="font-family:var(--font-display);font-size:9px;letter-spacing:1.5px;color:var(--faint);margin-bottom:4px;">SUBSTAT SUGGESTIONS (MAX ROLL)</div>
      ${rows}
    </div>`;
}

function renderEchoes() {
  const slots = Array.from({ length: ECHO_SLOTS }, (_, i) =>
    renderEchoSlotCard(i, api.build.echoes[i]),
  ).join("");
  const cost = totalEchoCost(api.build.echoes);
  const overBudget = cost > COST_BUDGET;
  const costColor =
    overBudget ? "var(--warn)"
    : cost === COST_BUDGET ? "var(--acc)"
    : "var(--gold)";
  return `
      <div class="bv2-card">
        <span class="bv2-card__stripe"></span>
        <div class="bv2-card__head">
          <div class="bv2-title"><span class="bv2-title__bar"></span><span class="bv2-title__txt">ECHOES</span>
            <span style="font-family:var(--font-display);font-weight:700;font-size:13px;color:${costColor};">${cost}<span style="color:var(--faint);font-weight:400;font-size:11px;"> / ${COST_BUDGET}</span></span>
          </div>
          <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;">
            <button data-act="echoes-remove-all" style="font-family:var(--font-display);font-weight:600;font-size:10px;letter-spacing:.7px;border-radius:8px;padding:8px 12px;cursor:pointer;background:var(--inp);border:1px solid var(--bd);color:var(--dim);">REMOVE ALL</button>
            <button data-act="echoes-optimize" style="font-family:var(--font-display);font-weight:600;font-size:10px;letter-spacing:.7px;border-radius:8px;padding:8px 12px;cursor:pointer;background:var(--acc);border:1px solid var(--acc);color:var(--on-acc);box-shadow:0 1px 8px color-mix(in srgb, var(--acc) 35%, transparent);">OPTIMIZE SUBSTATS</button>
          </div>
        </div>
        <div style="padding:16px 18px;display:flex;align-items:flex-start;gap:16px;">
          <div style="width:270px;flex:none;display:flex;flex-direction:column;gap:9px;">${slots}</div>
          ${renderEchoEditor()}
        </div>
        ${renderSubstatTally()}
        ${renderSonataStrip()}
        ${renderEchoOptimizerResults()}
      </div>`;
}

// SVG donut arc path, generic trig (no game data) — sa/ea in radians,
// oR/iR are outer/inner radius fractions of the viewBox.
function arcPath(sa, ea, oR = 0.82, iR = 0.5) {
  const gap = 0.018,
    s = sa + gap,
    e = Math.max(ea - gap, s + 0.001);
  const f = (n) => n.toFixed(4);
  const x1 = oR * Math.cos(s),
    y1 = oR * Math.sin(s);
  const x2 = oR * Math.cos(e),
    y2 = oR * Math.sin(e);
  const x3 = iR * Math.cos(e),
    y3 = iR * Math.sin(e);
  const x4 = iR * Math.cos(s),
    y4 = iR * Math.sin(s);
  const largeArc = e - s > Math.PI ? 1 : 0;
  return `M${f(x1)} ${f(y1)} A${oR} ${oR} 0 ${largeArc} 1 ${f(x2)} ${f(y2)} L${f(x3)} ${f(y3)} A${iR} ${iR} 0 ${largeArc} 0 ${f(x4)} ${f(y4)}Z`;
}

// §E — family label per skillType for palette grouping, mirroring
// tools/preprocess.mjs's CATEGORY_PREFIX (kept local — v2 owns its own
// scoped display maps per the file header comment).
const PALETTE_FAMILY_LABEL = {
  basic: "Basic Attack",
  midair: "Basic Attack",
  heavy: "Heavy Attack",
  skill: "Resonance Skill",
  liberation: "Resonance Liberation",
  intro: "Intro Skill",
  outro: "Outro Skill",
  forte_basic: "Basic Attack (Forte)",
  forte_heavy: "Heavy Attack (Forte)",
  forte: "Forte Circuit",
  echo: "Echo Skill",
};
const PALETTE_FAMILY_ORDER = [
  "basic",
  "midair",
  "heavy",
  "forte_basic",
  "forte_heavy",
  "forte",
  "skill",
  "liberation",
  "intro",
  "outro",
  "echo",
];

const PALETTE_BTN_STYLE =
  "font-family:var(--font-body);font-weight:600;font-size:11px;border-radius:8px;padding:7px 11px;cursor:grab;border:1px solid var(--bd);background:var(--inp);color:var(--dim);display:flex;align-items:center;gap:7px;";
function renderPaletteButton(key, def) {
  const t = stepTypeInfo(def.skillType ?? "basic");
  const castTime = resolveCastTime(def, api.dataset);
  const desc = [
    `${TYPE_LABEL[def.skillType] ?? def.skillType} · Cast ${fmtTime(castTime)}`,
    extractSkillSection(def.desc, key, def.skillType),
  ]
    .filter(Boolean)
    .join("\n\n");
  return `<button data-act="add-step" data-key="${esc(key)}" draggable="true" data-tip-title="${esc(def.label)}" data-tip-desc="${esc(desc)}" style="${PALETTE_BTN_STYLE}">
      <span style="font-family:var(--font-display);font-weight:700;font-size:9.5px;border-radius:4px;padding:2px 6px;background:${t.bg};color:${t.c};letter-spacing:.3px;flex:none;">${t.abbr}</span>${esc(def.label)}
    </button>`;
}

// Group palette entries by skill family (header = family, body = pickable
// stages) — amends P11-ADDENDUM.md §E. Splits a family further when a stage
// key's remainder (after stripping the skillType prefix) names one of the
// resonator's STATE_DEFS states (e.g. Hiyuki's Present/Foreclaimed Self) —
// reuses existing curated data, no new table. Reuses the stage-family parser
// (parseStage) from rotation-graph.js, the same logic P11 §6a's stage-order
// validator uses.
function groupPaletteEntries(entries, resonatorId) {
  const states = stateDefsForResonator(resonatorId);
  const groups = new Map(); // groupKey -> { label, order, items }
  for (const entry of entries) {
    const [key, def] = entry;
    const skillType = def.skillType ?? "basic";
    const baseLabel =
      PALETTE_FAMILY_LABEL[skillType] ?? TYPE_LABEL[skillType] ?? skillType;
    const familyPrefix = parseStage(key)?.family ?? key;
    const remainder = familyPrefix.replace(new RegExp(`^${skillType}_?`), "");
    let groupKey = baseLabel,
      label = baseLabel;
    if (remainder && states.length) {
      const tokens = remainder.split("_").filter(Boolean);
      const state = states.find((s) =>
        tokens.some((tok) => s.name.toLowerCase().includes(tok)),
      );
      if (state) {
        groupKey = `${baseLabel}::${state.name}`;
        label = `${baseLabel} — ${state.name}`;
      }
    }
    const order = PALETTE_FAMILY_ORDER.indexOf(skillType);
    if (!groups.has(groupKey))
      groups.set(groupKey, { label, order, items: [] });
    else
      groups.get(groupKey).order = Math.min(groups.get(groupKey).order, order);
    groups.get(groupKey).items.push(entry);
  }
  return [...groups.values()].sort((a, b) => a.order - b.order);
}

function renderPaletteGroup(label, buttonsHtml) {
  return `<div style="display:flex;flex-direction:column;gap:6px;">
      <span style="font-family:var(--font-display);font-size:8.5px;letter-spacing:1.2px;color:var(--faint);">${esc(label.toUpperCase())}</span>
      <div style="display:flex;flex-wrap:wrap;gap:6px;">${buttonsHtml}</div>
    </div>`;
}

function renderRotationPalette() {
  const skillMap = effectiveSkillMap(api.dataset, api.build.resonatorId);
  const entries =
    skillMap ?
      Object.entries(skillMap).filter(
        ([k, def]) => !k.startsWith("_") && def.paletteInclude !== false,
      )
    : [];
  const slot0 = api.build.echoes?.[0];
  const echoDef = slot0 ? echoDefOf(slot0) : null;
  const hasEchoSkill = echoDef?.activeSkill?.rateByLevel?.length;

  if (entries.length === 0 && !hasEchoSkill) {
    return `<div style="font-family:var(--font-body);font-size:11.5px;color:var(--faint);">No curated skill map for this resonator yet — rotation building is unavailable.</div>`;
  }

  const groups = groupPaletteEntries(entries, api.build.resonatorId);
  const groupsHtml = groups.map((g) =>
    renderPaletteGroup(
      g.label,
      g.items.map(([key, def]) => renderPaletteButton(key, def)).join(""),
    ),
  );

  if (hasEchoSkill) {
    const t = stepTypeInfo("echo");
    const echoDesc = ["Echo Skill", echoActiveSkillDesc(echoDef)]
      .filter(Boolean)
      .join("\n");
    const echoBtn = `<button data-act="add-step" data-key="${esc(ECHO_STEP_KEY)}" draggable="true" data-tip-title="${esc(echoDef.name)}" data-tip-desc="${esc(echoDesc)}" style="${PALETTE_BTN_STYLE}">
          <span style="font-family:var(--font-display);font-weight:700;font-size:9.5px;border-radius:4px;padding:2px 6px;background:${t.bg};color:${t.c};letter-spacing:.3px;flex:none;">${t.abbr}</span>Echo: ${esc(echoDef.name)}
        </button>`;
    groupsHtml.push(renderPaletteGroup("Echo Skill", echoBtn));
  }

  return `<div style="display:flex;flex-direction:column;gap:10px;">${groupsHtml.join("")}</div>`;
}

function renderRotationSequence(sim) {
  if (sim.steps.length === 0) {
    return `<div class="rot2-seq" style="display:flex;align-items:center;min-height:40px;padding:0 12px;font-family:var(--font-body);font-size:11.5px;color:var(--faint);white-space:nowrap;">Click a skill above, or drag it here, to start building the rotation.</div>`;
  }
  const skillMap = effectiveSkillMap(api.dataset, api.build.resonatorId);
  const chips = sim.steps.map((step) => {
    const t = stepTypeInfo(step.skillType);
    const statLines =
      step.missing ?
        [`Unmapped skill key — no skill-map entry for "${step.skillKey}".`]
      : [
          `${TYPE_LABEL[step.skillType] ?? step.skillType} · Cast ${fmtTime(step.castTime)}`,
          step.hitCount ?
            `${step.hitCount} hit${step.hitCount === 1 ? "" : "s"} · Crit ${fN(step.stepCrit ?? 0)} / Non-crit ${fN(step.stepNonCrit ?? 0)}`
          : "",
          `Step DMG ${fN(step.stepDamage ?? 0)}${step.buffed ? " (buffed)" : ""} · Running total ${fN(step.cumulativeDamage ?? 0)}`,
        ].filter(Boolean);
    const descLines = [
      statLines.join("\n"),
      step.missing ? "" : skillDescFor(step.skillKey, skillMap),
    ].filter(Boolean);
    // §9e — auto-inserted-step badge (rotation-triggers.js follow-up).
    const autoInserted = api.build.rotationMeta?.[step.index]?.autoInserted;
    const autoBadge =
      autoInserted ?
        `<span title="Auto-inserted by trigger" style="font-size:10px;line-height:1;color:${GOLD};flex:none;">⚡</span>`
      : "";
    // §9b — collapsible hit breakdown toggle, only when there's more than
    // one hit to break down (single-hit steps don't need expansion).
    const expandBtn =
      (step.hitCount ?? 0) > 1 ?
        `<button data-act="toggle-rot-hits" data-index="${step.index}" title="Show hit breakdown" aria-expanded="${api.rotStepExpanded === step.index}" style="width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;border:none;background:transparent;color:var(--faint);cursor:pointer;font-size:10px;padding:0;transform:rotate(${api.rotStepExpanded === step.index ? 180 : 0}deg);transition:transform .14s;">▾</button>`
      : "";
    return `<div class="rot2-chip" data-index="${step.index}" draggable="true" data-tip-title="${esc(step.label)}" data-tip-desc="${esc(descLines.join("\n\n"))}" style="display:flex;flex-direction:column;gap:6px;border-radius:10px;padding:9px 11px;border:1.5px solid ${autoInserted ? "color-mix(in srgb, var(--tip-gold) 50%, transparent)" : "var(--bd)"};background:var(--inp);min-width:76px;cursor:grab;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:5px;">
            <span style="font-family:var(--font-display);font-weight:700;font-size:9.5px;border-radius:4px;padding:2px 6px;background:${t.bg};color:${t.c};letter-spacing:.3px;flex:none;">${t.abbr}</span>
            ${autoBadge}
            <span style="flex:1;"></span>
            ${expandBtn}
            <button data-act="remove-step" data-index="${step.index}" title="Remove" style="width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;border:none;background:transparent;color:var(--faint);cursor:pointer;font-size:13px;padding:0;">×</button>
          </div>
          <div style="font-family:var(--font-body);font-weight:600;font-size:11px;color:${step.missing ? "var(--warn)" : "var(--txt)"};white-space:nowrap;">${esc(step.missing ? "?" + step.skillKey : step.label)}</div>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
            <span style="font-family:var(--font-display);font-size:9px;color:var(--faint);">${esc(fmtTime(step.castTime))}</span>
            <span style="font-family:var(--font-display);font-weight:700;font-size:12px;color:${
              step.stepDamage > 0 ?
                step.buffed ?
                  GOLD
                : "var(--acc)"
              : "var(--faint)"
            };">${step.stepDamage > 0 ? fN(step.stepDamage) : "—"}</span>
          </div>
        </div>`;
  });
  return `<div class="rot2-seq" style="display:flex;align-items:stretch;gap:8px;min-width:max-content;">${chips.join("")}</div>`;
}

// §9b — hit-by-hit breakdown panel for the currently expanded rotation step.
// Mirrors renderAbilityDamageRow's hit list, restyled to sit below the
// horizontally-scrolling chip rail (a single expanded detail at a time keeps
// this from fighting the chip row's own scroll position).
function renderRotStepDetail(sim) {
  if (api.rotStepExpanded == null) return "";
  const step = sim.steps.find((s) => s.index === api.rotStepExpanded);
  const hits = step?.resolved?.hits;
  if (!hits?.length || hits.length <= 1) return "";
  const hitsHtml = hits
    .map((h, i) => {
      const r = h.result,
        bd = r.breakdown;
      return `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:5px 0;font-family:var(--font-body);font-size:10.5px;${i ? "border-top:1px solid var(--bd);" : ""}">
          <span style="color:var(--faint);">Hit ${i + 1} · ${(bd.multiplier * 100).toFixed(1)}% ATK</span>
          <span style="color:var(--dim);">non-crit ${esc(fN(r.nonCrit))}</span>
          <span style="color:var(--acc);">crit ${esc(fN(r.crit))}</span>
          <span style="color:var(--txt);font-weight:600;">avg ${esc(fN(r.expected))}</span>
        </div>`;
    })
    .join("");
  return `<div style="margin-top:9px;border:1px solid var(--bd);border-radius:9px;background:var(--inp);padding:9px 12px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
        <span style="font-family:var(--font-display);font-size:9px;letter-spacing:1.2px;color:var(--faint);">HIT BREAKDOWN — ${esc(step.label)}</span>
        <button data-act="toggle-rot-hits" data-index="${step.index}" style="border:none;background:transparent;color:var(--faint);cursor:pointer;font-size:11px;line-height:1;">✕</button>
      </div>
      ${hitsHtml}
    </div>`;
}

function renderRotationLineChart(sim) {
  if (sim.steps.length === 0) return "";
  const W = 680,
    H = 150,
    padTop = 14;
  const totalTime = Math.max(sim.totals.time, 0.01);
  const totalDmg = Math.max(sim.totals.damage, 1);
  const toX = (t) => (t / totalTime) * W;
  const toY = (d) => H - (d / totalDmg) * H;
  const skillMap = effectiveSkillMap(api.dataset, api.build.resonatorId);

  let tAcc = 0,
    dAcc = 0,
    areaD = `M0 ${H}`,
    lineD = `M0 ${H}`;
  const dots = [];
  for (const step of sim.steps) {
    const xEnd = Math.round(toX(tAcc + step.castTime));
    dAcc += Math.max(step.stepDamage, 0);
    const y = Math.round(toY(dAcc));
    areaD += ` H${xEnd} V${y}`;
    lineD += ` H${xEnd} V${y}`;
    if (step.stepDamage > 0) {
      const t = stepTypeInfo(step.skillType);
      // Custom hover-box, not a native <title>, matching the rest of the
      // page (see ensureTooltipEl's comment) — Element.closest works on
      // SVG elements, so the same mouseover delegation picks this up.
      const tipDesc = [
        `${fN(step.stepDamage)} · running total ${fN(dAcc)}`,
        skillDescFor(step.skillKey, skillMap),
      ]
        .filter(Boolean)
        .join("\n\n");
      dots.push(
        `<circle cx="${xEnd}" cy="${y}" r="4.5" fill="${t.c}" stroke="var(--card)" stroke-width="2" data-tip-title="${esc(step.label)}" data-tip-desc="${esc(tipDesc)}"></circle>`,
      );
    }
    tAcc += step.castTime;
  }
  areaD += ` H${W} V${H} H0 Z`;
  lineD += ` H${W}`;

  const tickN = Math.min(8, Math.max(2, Math.ceil(totalTime / 2)));
  const ticks = Array.from({ length: tickN + 1 }, (_, i) => {
    const t = (i / tickN) * totalTime;
    return `<line x1="${((i / tickN) * W).toFixed(0)}" y1="${H}" x2="${((i / tickN) * W).toFixed(0)}" y2="${H + 6}" stroke="var(--bd2)" stroke-width="1"></line>
                <text x="${((i / tickN) * W).toFixed(0)}" y="${H + 18}" text-anchor="middle" font-size="9" fill="var(--faint)" font-family="'Chakra Petch',monospace">${t.toFixed(0)}s</text>`;
  }).join("");

  return `<div style="position:relative;">
      <div style="position:absolute;top:0;left:0;font-family:var(--font-display);font-size:9px;color:var(--faint);">${esc(fN(totalDmg))}</div>
      <svg width="100%" viewBox="0 -${padTop} ${W} ${H + 30}" style="display:block;overflow:visible;">
        <line x1="0" y1="${H * 0.25}" x2="${W}" y2="${H * 0.25}" stroke="var(--bd)" stroke-width="1" stroke-dasharray="4,4"></line>
        <line x1="0" y1="${H * 0.5}" x2="${W}" y2="${H * 0.5}" stroke="var(--bd)" stroke-width="1" stroke-dasharray="4,4"></line>
        <line x1="0" y1="${H * 0.75}" x2="${W}" y2="${H * 0.75}" stroke="var(--bd)" stroke-width="1" stroke-dasharray="4,4"></line>
        <defs><linearGradient id="bv2-rot-grad" x1="0" y1="0" x2="0" y2="${H}" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="var(--acc)" stop-opacity="0.28"></stop>
          <stop offset="100%" stop-color="var(--acc)" stop-opacity="0.02"></stop>
        </linearGradient></defs>
        <path d="${areaD}" fill="url(#bv2-rot-grad)"></path>
        <path d="${lineD}" fill="none" stroke="var(--acc)" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter"></path>
        <line x1="0" y1="${H}" x2="${W}" y2="${H}" stroke="var(--bd2)" stroke-width="1"></line>
        ${dots.join("")}
        ${ticks}
      </svg>
    </div>`;
}

const BUFF_TRIGGER_LABEL = {
  basic: "Basic Attack",
  heavy: "Heavy Attack",
  skill: "Resonance Skill",
  liberation: "Resonance Liberation",
  intro: "Intro Skill",
  outro: "Outro Skill",
  healing: "Healing",
  unknown: "Passive",
};

// Buff Windows — timed conditional sonata buffs (sim.buffWindows; trigger ×
// duration, computed by computeBuffWindows in sim.js) plotted on the same
// time axis as the line chart above. Unconditional (always-on) sonata stats
// have no start/end and are baked into Total Stats directly — they never
// appear here, by design, not by omission. Strip rendering/lane-packing is
// shared with the Teams page's per-member buff bar via buff-bar.js (P11 §8).
// Turn a stacking buff window's per-step stack counts into height-encoded bands
// (fractions relative to the strip's own [winStart, winEnd] span). Adjacent
// equal-stack steps merge into one band; `level` is stacks / maxStacks (0..1).
function stackBandsFor(w, steps, winStart, winEnd) {
  const span = winEnd - winStart;
  if (!(span > 0)) return null;
  const maxStacks = Math.max(0, ...Object.values(w.stacksByStepIndex));
  const merged = [];
  for (const s of steps) {
    const a = Math.max(s.startTime, winStart);
    const b = Math.min(s.endTime, winEnd);
    if (b <= a) continue; // outside the rendered span
    const lvl = w.stacksByStepIndex[s.index] ?? 0;
    const last = merged[merged.length - 1];
    if (last && last.lvl === lvl && Math.abs(last.b - a) < 1e-6) last.b = b;
    else merged.push({ a, b, lvl });
  }
  return merged.map((m) => ({
    startFrac: (m.a - winStart) / span,
    widthFrac: (m.b - m.a) / span,
    level: maxStacks > 0 ? m.lvl / maxStacks : 0,
  }));
}

function renderBuffWindows(sim) {
  const totalTime = Math.max(sim.totals.time, 0.01);
  const windows = (sim.buffWindows ?? []).filter((w) => w.bonusPct > 0);
  if (windows.length === 0) return "";

  const strips = windows.map((w) => {
    const end = Math.min(w.end, totalTime);
    const clipped = w.end > totalTime;
    const durLabel = (clipped ? "> " : "") + fmtTime(w.end - w.start);

    // Stack ramp (Phase A): a stacking buff carries per-step stack counts.
    // Turn them into height-encoded time bands + a ramped-range label so the
    // ramp/decay is visible instead of a flat "+10%" block.
    const maxStacks =
      w.stacksByStepIndex ?
        Math.max(0, ...Object.values(w.stacksByStepIndex))
      : 1;
    const stacking = maxStacks > 1;
    const stackBands =
      stacking ? stackBandsFor(w, sim.steps, w.start, end) : null;
    let name = w.label;
    let meta = durLabel;
    if (stacking) {
      const perPct = Math.round(w.bonusPct * 100);
      const maxPct = Math.round(w.bonusPct * maxStacks * 100);
      // Rewrite the leading "+10%" headline into a "+10→30%" range.
      name = w.label.replace(/^\+?\d+(?:\.\d+)?\s*%/, `+${perPct}→${maxPct}%`);
      meta = `×${maxStacks} · ${durLabel}`;
    }
    return {
      name,
      start: w.start,
      end,
      stackBands,
      // Mirror shortBuffLabel's precedence (sim.js): a buff whose headline
      // number is ATK/element-scoped is labelled (and coloured) as that,
      // even if its raw text also mentions an unrelated dmg-type phrase
      // elsewhere (e.g. Lingering Tunes' "+5% ATK ... Outro Skill DMG +60%").
      elementColor:
        w.bonusKind === "element" && w.element ? ELEM[w.element]?.c : null,
      dmgType: w.bonusKind === "atk" ? null : (w.dmgType ?? null),
      eyebrow: `${BUFF_TRIGGER_LABEL[w.trigger] ?? "Effect"} — ${w.sonataName}`,
      meta,
      tipTitle: `${BUFF_TRIGGER_LABEL[w.trigger] ?? "Effect"} — ${w.sonataName}`,
      tipDesc: `${name} · ${meta}\n${w.raw ?? ""}`,
    };
  });

  const bar = renderBuffBar(strips, totalTime, { rowH: 34, gap: 5 });
  return `<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--bd);">
      <div style="font-family:var(--font-display);font-size:8px;letter-spacing:1.5px;color:var(--faint);margin-bottom:7px;">BUFF WINDOWS</div>
      ${bar}
    </div>`;
}

function renderRotationDonut(sim) {
  const totals = new Map();
  for (const step of sim.steps) {
    if (step.stepDamage > 0)
      totals.set(
        step.skillType,
        (totals.get(step.skillType) ?? 0) + step.stepDamage,
      );
  }
  const totalDmg = sim.totals.damage || 1;
  let other = 0;
  const segs = [];
  for (const [type, dmg] of totals) {
    const pct = dmg / totalDmg;
    if (pct < 0.04) {
      other += dmg;
      continue;
    }
    segs.push({ type, dmg, pct, ...stepTypeInfo(type) });
  }
  if (other > 0)
    segs.push({
      type: "other",
      dmg: other,
      pct: other / totalDmg,
      abbr: "OT",
      c: "var(--faint)",
    });
  segs.sort((a, b) => b.dmg - a.dmg);

  let acc = -Math.PI / 2;
  const arcs = segs
    .map((seg) => {
      const span = seg.pct * Math.PI * 2;
      const d = arcPath(acc, acc + span);
      acc += span;
      const label =
        TYPE_LABEL[seg.type] ?? (seg.type === "other" ? "Other" : seg.type);
      return `<path d="${d}" fill="${seg.c}" opacity="0.88" data-tip-title="${esc(label)}" data-tip-desc="${esc(`${Math.round(seg.pct * 100)}% · ${fN(seg.dmg)} damage`)}" style="cursor:default;"></path>`;
    })
    .join("");

  return `<div style="padding:16px 18px 18px;display:flex;flex-direction:column;align-items:center;gap:10px;">
      <span style="font-family:var(--font-display);font-size:9px;letter-spacing:1.5px;color:var(--faint);align-self:flex-start;">DMG BREAKDOWN</span>
      <svg width="220" height="220" viewBox="-1.1 -1.1 2.2 2.2" style="display:block;">${arcs}</svg>
      <div style="text-align:center;">
        <div style="font-family:var(--font-display);font-weight:700;font-size:17px;color:var(--txt);line-height:1.1;">${esc(fN(sim.totals.damage))}</div>
        <div style="font-family:var(--font-display);font-size:9px;letter-spacing:1px;color:var(--faint);margin-top:2px;">TOTAL · ${esc(fmtDps(sim.totals.dps))}/s</div>
      </div>
      <span style="font-family:var(--font-body);font-size:10px;color:var(--faint);text-align:center;">Hover segments for breakdown</span>
    </div>`;
}

// §7b — dismissible notice for the most recent auto-triggered insert.
function renderAutoInsertNotice() {
  const n = api.autoInsertNotice;
  if (!n) return "";
  return `<div style="display:flex;align-items:center;gap:8px;background:color-mix(in srgb, var(--acc) 10%, transparent);border:1px solid color-mix(in srgb, var(--acc) 35%, transparent);border-radius:8px;padding:7px 10px;margin-bottom:9px;">
      <span style="color:var(--acc);font-size:12px;flex:none;">⚡</span>
      <span style="font-family:var(--font-body);font-size:10.5px;color:var(--acc);flex:1;min-width:0;">Auto-inserted: ${esc(n.label)}. ${esc(n.note)}</span>
      <button data-act="dismiss-auto-notice" title="Dismiss" style="border:none;background:transparent;color:var(--acc);cursor:pointer;font-size:13px;line-height:1;flex:none;">×</button>
    </div>`;
}

// §9d — per-warning "Fix it" banner (replaces the old generic warning count).
function renderValidationBanner(warnings) {
  if (!warnings.length) return "";
  const items = warnings
    .map(
      (w, i) => `
      <div style="display:flex;align-items:center;gap:8px;${i ? "margin-top:6px;padding-top:6px;border-top:1px solid color-mix(in srgb, var(--gold) 25%, transparent);" : ""}">
        <span style="color:var(--warn);font-size:12px;flex:none;">⚠</span>
        <span style="font-family:var(--font-body);font-size:10.5px;color:var(--warn);flex:1;min-width:0;">${esc(w.note)}</span>
        <button data-act="fix-warning" data-warn-idx="${i}" title="Reorder to resolve this warning" style="font-family:var(--font-display);font-weight:700;font-size:9.5px;letter-spacing:.6px;color:var(--on-warn);background:var(--warn);border:none;border-radius:6px;padding:5px 10px;cursor:pointer;flex:none;">FIX</button>
      </div>`,
    )
    .join("");
  return `<div style="background:color-mix(in srgb, var(--gold) 10%, transparent);border:1px solid color-mix(in srgb, var(--gold) 40%, transparent);border-radius:8px;padding:7px 10px;margin-bottom:9px;">${items}</div>`;
}

// §7b — after appending/moving a step into `rotation` at `addedIndex`, check
// rotation-triggers.js for a forced follow-up and insert it (tagged
// autoInserted in rotationMeta) immediately after. No-op when no rule matches.
function applyAutoTrigger(build, addedIndex) {
  const prop = proposeTriggeredInsert(
    build.resonatorId,
    build.rotation,
    addedIndex,
  );
  if (!prop) return build;
  let b = appendRotationStep(build, prop.skillKey, { autoInserted: true });
  b = moveRotationStep(b, b.rotation.length - 1, prop.insertAt);
  const skillMap = effectiveSkillMap(api.dataset, build.resonatorId);
  api.autoInsertNotice = {
    label: skillMap?.[prop.skillKey]?.label ?? prop.skillKey,
    note: prop.note,
  };
  return b;
}

// §9d — compute what a warning's "Fix" button should do: move the flagged
// step to just after its first already-present requirement, or (if no
// requirement is present anywhere in the rotation yet) insert the first
// missing one immediately before the flagged step. Stage-ordering warnings
// (gate:'sequence') carry no `requires` — derive the needed prior stage key
// from the flagged key itself via the same stage parser used elsewhere.
function computeFixTarget(build, warning) {
  let neededKey = null;
  if (warning.requires?.length) {
    const present = warning.requires.find((req) =>
      build.rotation.includes(req),
    );
    if (present) return { mode: "move", afterKey: present };
    neededKey = warning.requires[0];
  } else {
    const p = parseStage(warning.skillKey);
    if (p && p.stage > 1) neededKey = `${p.family}_${p.stage - 1}`;
  }
  if (!neededKey) return null;
  return build.rotation.includes(neededKey) ?
      { mode: "move", afterKey: neededKey }
    : { mode: "insert", key: neededKey };
}

function applyFix(build, warning) {
  const target = computeFixTarget(build, warning);
  if (!target) return build;
  if (target.mode === "move") {
    // The warning guarantees afterKey's only occurrence is later than
    // warning.index — moveRotationStep's target index is read against the
    // post-removal array, so the original index of afterKey lands the
    // flagged step immediately after it (see build.js moveRotationStep).
    const afterIdx = build.rotation.indexOf(target.afterKey);
    return moveRotationStep(build, warning.index, afterIdx);
  }
  let b = appendRotationStep(build, target.key, { autoInserted: false });
  return moveRotationStep(b, b.rotation.length - 1, warning.index);
}

function renderRotation() {
  const reso = resonatorOf();
  const skillMap = effectiveSkillMap(api.dataset, api.build.resonatorId);
  if (!skillMap) {
    return `<div class="bv2-card"><span class="bv2-card__stripe"></span>
          <div class="bv2-card__head"><div class="bv2-title"><span class="bv2-title__bar"></span><span class="bv2-title__txt">ROTATION</span></div></div>
          <div class="bv2-stub">${esc(reso?.name ?? "This resonator")} has no curated skill map yet, so rotation simulation is unavailable.</div>
        </div>`;
  }

  const sim = simulateRotation({
    build: api.build,
    dataset: api.dataset,
    target: defaultSimTarget(api.build),
  });
  api.lastSim = sim;
  const warnings = validateRotation(
    api.build.rotation ?? [],
    rulesForResonator(api.build.resonatorId),
    skillMap,
  );
  api.lastWarnings = warnings;

  return `
      <div class="bv2-card">
        <span class="bv2-card__stripe"></span>
        <div class="bv2-card__head">
          <div class="bv2-title"><span class="bv2-title__bar"></span><span class="bv2-title__txt">ROTATION</span><span style="width:1px;height:16px;background:var(--bd);margin:0 4px;"></span><span style="font-family:var(--font-body);font-size:13px;font-weight:600;color:var(--dim);">${esc(reso?.name ?? "—")}</span></div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <div style="display:flex;gap:5px;">
              <div style="background:var(--inp);border:1px solid var(--bd);border-radius:8px;padding:5px 12px;display:flex;flex-direction:column;align-items:center;gap:1px;"><span style="font-family:var(--font-display);font-size:8px;letter-spacing:1px;color:var(--faint);">TIME</span><span style="font-family:var(--font-display);font-weight:700;font-size:14px;color:var(--txt);">${esc(fmtTime(sim.totals.time))}</span></div>
              <div style="background:var(--inp);border:1px solid var(--bd);border-radius:8px;padding:5px 12px;display:flex;flex-direction:column;align-items:center;gap:1px;"><span style="font-family:var(--font-display);font-size:8px;letter-spacing:1px;color:var(--faint);">ROTATION DMG</span><span style="font-family:var(--font-display);font-weight:700;font-size:14px;color:var(--acc);">${esc(fN(sim.totals.damage))}</span></div>
              <div style="background:var(--inp);border:1px solid var(--bd);border-radius:8px;padding:5px 12px;display:flex;flex-direction:column;align-items:center;gap:1px;"><span style="font-family:var(--font-display);font-size:8px;letter-spacing:1px;color:var(--faint);">AVG DPS</span><span style="font-family:var(--font-display);font-weight:700;font-size:14px;color:var(--acc);">${esc(fmtDps(sim.totals.dps))}</span></div>
            </div>
            ${sim.steps.length ? `<button data-act="rot-clear" style="font-family:var(--font-display);font-weight:600;font-size:10px;letter-spacing:.7px;border-radius:8px;padding:8px 13px;cursor:pointer;background:var(--inp);border:1px solid var(--bd);color:var(--dim);">CLEAR</button>` : ""}
          </div>
        </div>

        <div style="padding:13px 18px 14px;border-bottom:1px solid var(--bd);">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
            <span style="font-family:var(--font-display);font-size:9px;letter-spacing:1.5px;color:var(--faint);">ABILITY PALETTE</span>
            <span style="font-family:var(--font-body);font-size:10px;color:var(--faint);">click to append, or drag into the sequence below</span>
          </div>
          ${renderRotationPalette()}
        </div>

        <div style="padding:13px 18px 14px;border-bottom:1px solid var(--bd);">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
            <span style="font-family:var(--font-display);font-size:9px;letter-spacing:1.5px;color:var(--faint);">ROTATION SEQUENCE</span>
            <div style="display:flex;align-items:center;gap:7px;">
              <span style="font-family:var(--font-body);font-size:11px;color:var(--dim);">${sim.steps.length} action${sim.steps.length === 1 ? "" : "s"} · drag to reorder</span>
              ${(() => {
                const refRot = referenceRotationFor(api.build.resonatorId);
                const presets = listRotationPresets(api.build.resonatorId);
                const hasRot = (api.build.rotation?.length ?? 0) > 0;
                const btnStyle =
                  "font-family:var(--font-display);font-weight:600;font-size:9.5px;letter-spacing:.6px;border-radius:7px;padding:5px 10px;cursor:pointer;border:1px solid var(--bd);transition:all .12s;";
                return [
                  refRot ?
                    `<button data-act="rot-template" style="${btnStyle}background:var(--inp);color:var(--dim);" title="Apply Prydwen reference rotation">TEMPLATE</button>`
                  : "",
                  `<button data-act="rot-save" ${hasRot ? "" : "disabled"} style="${btnStyle}background:var(--inp);color:${hasRot ? "var(--dim)" : "var(--faint)"};${hasRot ? "" : "opacity:.5;cursor:not-allowed;"}" title="Save current rotation as a preset">SAVE</button>`,
                  `<button data-act="rot-load" style="${btnStyle}background:var(--inp);color:var(--dim);" title="Load a saved rotation preset">LOAD${presets.length ? ` <span style="color:var(--acc);font-weight:700;">(${presets.length})</span>` : ""}</button>`,
                ].join("");
              })()}
            </div>
          </div>
          ${renderAutoInsertNotice()}
          ${renderValidationBanner(warnings)}
          <div style="overflow-x:auto;">${renderRotationSequence(sim)}</div>
          ${renderRotStepDetail(sim)}
        </div>

        ${
          sim.steps.length ?
            `<div style="display:grid;grid-template-columns:1fr 290px;align-items:start;">
          <div style="padding:16px 18px 18px;border-right:1px solid var(--bd);">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;"><span style="font-family:var(--font-display);font-size:9px;letter-spacing:1.5px;color:var(--faint);">CUMULATIVE DAMAGE OVER TIME</span></div>
            ${renderRotationLineChart(sim)}
            ${renderBuffWindows(sim)}
          </div>
          ${renderRotationDonut(sim)}
        </div>`
          : `<div style="padding:40px 18px;text-align:center;font-family:var(--font-body);font-size:13px;color:var(--faint);">Build your rotation above — charts appear here.</div>`
        }
        <div style="padding:9px 18px;border-top:1px solid var(--bd);font-family:var(--font-body);font-size:10px;color:var(--faint);line-height:1.5;">
          Template rotations sourced from <a href="https://www.prydwen.gg/wuthering-waves/" target="_blank" rel="noopener" style="color:var(--acc);text-decoration:none;">Prydwen.gg</a> · Save/Load stores presets per resonator in your browser.
        </div>
      </div>`;
}

// Ability / damage overview — the second handoff gap the maintainer flagged.
// Per-skill expected damage (resolveSkill, same math simulateRotation uses
// internally) with an expandable hit-by-hit breakdown.
function renderAbilityDamageRow(key, def, computed) {
  const isOpen = api.dmgExpanded.has(key);
  const total = computed.totalExpected;
  const support = computed.supportOutput ?? null;
  const healTotal =
    support ?
      support
        .filter((r) => r.rowType === "heal")
        .reduce((t, r) => t + r.value, 0)
    : 0;
  const shieldTotal =
    support ?
      support
        .filter((r) => r.rowType === "shield")
        .reduce((t, r) => t + r.value, 0)
    : 0;

  const hitsHtml = computed.hits
    .map((h, i) => {
      const r = h.result,
        bd = r.breakdown;
      return `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:5px 0;font-family:var(--font-body);font-size:10.5px;">
          <span style="color:var(--faint);">Hit ${i + 1} · ${(bd.multiplier * 100).toFixed(1)}% ATK</span>
          <span style="color:var(--dim);">non-crit ${esc(fN(r.nonCrit))}</span>
          <span style="color:var(--acc);">crit ${esc(fN(r.crit))}</span>
          <span style="color:var(--txt);font-weight:600;">avg ${esc(fN(r.expected))}</span>
        </div>`;
    })
    .join("");
  const env = computed.hits[0]?.result?.breakdown;
  const envHtml =
    env ?
      `<div style="display:flex;gap:14px;margin-top:6px;padding-top:6px;border-top:1px solid var(--bd);font-family:var(--font-body);font-size:10px;color:var(--faint);">
        <span>DEF× ${env.defMult.toFixed(3)}</span><span>RES× ${env.resMult.toFixed(3)}</span><span>DMG× ${env.bonusMult.toFixed(3)}</span>
      </div>`
    : "";
  const supportHtml =
    healTotal > 0 || shieldTotal > 0 ?
      `<div style="display:flex;gap:10px;font-family:var(--font-display);font-weight:700;font-size:11px;">
        ${healTotal > 0 ? `<span style="color:var(--heal);" title="Heal per cast">♥ ${esc(fN(healTotal))}</span>` : ""}
        ${shieldTotal > 0 ? `<span style="color:var(--shield);" title="Shield per cast">◆ ${esc(fN(shieldTotal))}</span>` : ""}
      </div>`
    : "";

  return `<div style="border:1px solid var(--bd);border-radius:10px;background:var(--inp);overflow:hidden;">
      <div data-act="toggle-dmg-row" data-key="${esc(key)}" data-tip-title="${esc(def.label)}" data-tip-desc="${esc(extractSkillSection(def.desc, key, def.skillType))}" style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 13px;cursor:pointer;">
        <div>
          <div style="font-family:var(--font-body);font-weight:700;font-size:12.5px;color:var(--txt);">${esc(def.label)}</div>
          <div style="font-family:var(--font-display);font-size:9px;letter-spacing:.6px;color:var(--faint);">LV ${computed.skillLv} · ${computed.hits.length} HIT${computed.hits.length === 1 ? "" : "S"}</div>
        </div>
        <div style="display:flex;align-items:center;gap:12px;">
          ${supportHtml}
          ${total > 0 ? `<span style="font-family:var(--font-display);font-weight:700;font-size:15px;color:var(--acc);">${esc(fN(total))}</span>` : ""}
          <span style="color:var(--faint);transition:transform .14s;transform:rotate(${isOpen ? 90 : 0}deg);">▸</span>
        </div>
      </div>
      ${isOpen ? `<div style="padding:0 13px 12px;">${hitsHtml}${envHtml}</div>` : ""}
    </div>`;
}

function renderAbilityDamageOverview() {
  const reso = resonatorOf();
  const skillMap = effectiveSkillMap(api.dataset, api.build.resonatorId);
  if (!skillMap) {
    return `<div class="bv2-card"><span class="bv2-card__stripe"></span>
          <div class="bv2-card__head"><div class="bv2-title"><span class="bv2-title__bar"></span><span class="bv2-title__txt">ABILITY DAMAGE OVERVIEW</span></div></div>
          <div class="bv2-stub">${esc(reso?.name ?? "This resonator")} has no curated skill map yet, so per-ability damage is unavailable.</div>
        </div>`;
  }
  const stats = resolveTotalStats(api.build, api.dataset);
  const target = {
    level: api.dmgTarget.level,
    atkLv: api.build.level,
    resistances: {
      0: 0,
      1: api.dmgTarget.res,
      2: api.dmgTarget.res,
      3: api.dmgTarget.res,
      4: api.dmgTarget.res,
      5: api.dmgTarget.res,
      6: api.dmgTarget.res,
    },
  };
  const SKILL_LV_KEY = {
    basic: "normal",
    heavy: "normal",
    midair: "normal",
    forte_basic: "forte",
    forte_heavy: "forte",
    skill: "skill",
    liberation: "liberation",
    intro: "intro",
    outro: "intro",
  };
  const rows = Object.entries(skillMap)
    .filter(([k]) => !k.startsWith("_"))
    .map(([key, def]) => {
      const computed = resolveSkill({
        skillDef: def,
        build: api.build,
        dataset: api.dataset,
        stats,
        target,
      });
      if (computed) return renderAbilityDamageRow(key, def, computed);
      if (def.supportIds?.length) {
        const supportRows = resolveSupport({
          skillDef: def,
          build: api.build,
          dataset: api.dataset,
          stats,
        });
        const healTotal = supportRows
          .filter((r) => r.rowType === "heal")
          .reduce((t, r) => t + r.value, 0);
        const shieldTotal = supportRows
          .filter((r) => r.rowType === "shield")
          .reduce((t, r) => t + r.value, 0);
        if (healTotal === 0 && shieldTotal === 0) return "";
        const skillLv =
          api.build.skillLevels?.[
            SKILL_LV_KEY[def.skillType] ?? def.skillType
          ] ?? 10;
        return `<div style="border:1px solid var(--bd);border-radius:10px;background:var(--inp);padding:10px 13px;display:flex;align-items:center;justify-content:space-between;gap:12px;" data-tip-title="${esc(def.label)}" data-tip-desc="${esc(extractSkillSection(def.desc, key, def.skillType))}">
              <div><div style="font-family:var(--font-body);font-weight:700;font-size:12.5px;color:var(--txt);">${esc(def.label)}</div><div style="font-family:var(--font-display);font-size:9px;letter-spacing:.6px;color:var(--faint);">LV ${skillLv} · SUPPORT</div></div>
              <div style="display:flex;gap:10px;font-family:var(--font-display);font-weight:700;font-size:13px;">
                ${healTotal > 0 ? `<span style="color:var(--heal);">♥ ${esc(fN(healTotal))}</span>` : ""}
                ${shieldTotal > 0 ? `<span style="color:var(--shield);">◆ ${esc(fN(shieldTotal))}</span>` : ""}
              </div>
            </div>`;
      }
      return "";
    })
    .join("");

  return `
      <div class="bv2-card">
        <span class="bv2-card__stripe"></span>
        <div class="bv2-card__head">
          <div class="bv2-title"><span class="bv2-title__bar"></span><span class="bv2-title__txt">ABILITY DAMAGE OVERVIEW</span></div>
          <div style="display:flex;align-items:center;gap:10px;">
            <label style="display:flex;align-items:center;gap:5px;font-family:var(--font-display);font-size:9px;letter-spacing:.8px;color:var(--faint);">ENEMY LV
              <input type="number" min="1" max="120" value="${api.dmgTarget.level}" data-act="dmg-enemy-level" style="width:48px;background:var(--inp);border:1px solid var(--bd);border-radius:6px;padding:4px 6px;color:var(--txt);font-family:var(--font-display);font-size:11px;">
            </label>
            <label style="display:flex;align-items:center;gap:5px;font-family:var(--font-display);font-size:9px;letter-spacing:.8px;color:var(--faint);">RES
              <input type="number" min="-1" max="2" step="0.05" value="${api.dmgTarget.res}" data-act="dmg-enemy-res" style="width:48px;background:var(--inp);border:1px solid var(--bd);border-radius:6px;padding:4px 6px;color:var(--txt);font-family:var(--font-display);font-size:11px;">
            </label>
          </div>
        </div>
        <div style="padding:14px 18px;display:flex;flex-direction:column;gap:8px;">${rows || `<div style="font-family:var(--font-body);font-size:11.5px;color:var(--faint);">No damaging or supporting abilities resolved for the current level/stats.</div>`}</div>
        <div style="padding:0 18px 14px;font-family:var(--font-body);font-size:10px;color:var(--faint);">Per-ability expected damage at the level/RES above — independent of the Rotation panel's fixed lv90/10% target. Click a row to expand its hit-by-hit breakdown.</div>
      </div>`;
}

// "Echoes 60.0% + Sonata Set Bonus 10.0%" — lists every nonzero source that
// feeds a purely-additive % stat (crit/healing/energy-regen/element-or-skill
// DMG bonus), in the same order they're summed in stats.js.
function pctBreakdown(parts) {
  const nz = parts.filter((p) => Math.abs(p.value) > 0.0005);
  if (nz.length === 0) return "Base 0%";
  return nz
    .map((p, i) =>
      i === 0 ?
        `${esc(p.label)} ${fP(p.value * 100)}`
      : `<span style="color:var(--acc);"> + ${esc(p.label)} ${fP(p.value * 100)}</span>`,
    )
    .join("");
}

// ATK/HP/DEF are multiplicative (flatBase × (1 + ratioBonus)), so the
// breakdown shows the flat additions (Echoes/Sonata flat stats) separately
// from the % ratio modifiers (Skill Tree/Echoes/Sonata ratio bonuses) —
// flatBase × (1 + Σratio) + Σflat reconstructs the displayed total exactly.
// When `base` is provided (> 0), each ratio part also shows its flat equivalent
// so the user can see actual ATK numbers alongside the source percentage.
function statLine(flatBase, flatParts, ratioParts, base = 0) {
  let out = `Base ${fN(flatBase)}`;
  for (const p of flatParts) {
    if (Math.abs(p.value) > 0.5)
      out += `<span style="color:var(--acc);"> + ${esc(p.label)} +${fN(p.value)}</span>`;
  }
  for (const p of ratioParts) {
    if (Math.abs(p.value) > 0.0005) {
      const pctStr = fP(p.value * 100);
      const flatStr =
        base > 0 ? `+${fN(p.value * base)} (${pctStr})` : `+${pctStr}`;
      out += `<span style="color:var(--acc);"> + ${esc(p.label)} ${flatStr}</span>`;
    }
  }
  return out;
}

function renderStats() {
  const b = api.build;
  const reso = resonatorOf();
  // includeConditionals:false → match the in-game stowed stat screen (no active
  // combat buffs). Weapon/sonata conditional buffs are still applied at full
  // uptime in the sim; they just don't inflate the display panel.
  const st = resolveTotalStats(b, api.dataset, null, null, {
    includeConditionals: false,
  });
  const el = ELEM[reso?.element] ?? { name: "—", c: "var(--acc)" };
  const acc = "var(--acc)",
    dim = "var(--dim)";
  const bk = st.breakdown ?? {};
  const rb = bk.resonatorBase ?? {},
    wb = bk.weaponBase ?? {},
    wp = bk.weaponPassive ?? {};
  const tree = bk.skillTree ?? {},
    ec = bk.echoes ?? {},
    son = bk.sonataStats ?? {};

  const elemDmg = (st.dmgBonusByElement?.[reso?.element] ?? 0) * 100;
  const T = st.dmgBonusBySkillType ?? {};

  const skillTypeLine = (key) =>
    pctBreakdown([
      { label: "Weapon Passive", value: wp.dmgBySkillType?.[key] ?? 0 },
      { label: "Echoes", value: ec.dmgBySkillType?.[key] ?? 0 },
      {
        label: "Sonata Set Bonus",
        value: son.dmgBySkillType?.[key] ?? 0,
      },
    ]);

  const tiles = [
    [
      "ATK",
      fN(st.atk),
      acc,
      "24px",
      statLine(
        (rb.atk ?? 0) + (wb.atk ?? 0),
        [
          { label: "Echoes", value: ec.atkFlat ?? 0 },
          { label: "Sonata Set Bonus", value: son.atkFlat ?? 0 },
        ],
        [
          { label: "Skill Tree", value: tree.atkRatio ?? 0 },
          { label: "Echoes", value: ec.atkRatio ?? 0 },
          { label: "Sonata Set Bonus", value: son.atkRatio ?? 0 },
          { label: "Weapon Passive", value: wp.atkRatio ?? 0 },
        ],
        bk.atkBase,
      ),
    ],
    [
      "HP",
      fN(st.hp),
      dim,
      "20px",
      statLine(
        (rb.hp ?? 0) + (wb.hp ?? 0),
        [
          { label: "Echoes", value: ec.hpFlat ?? 0 },
          { label: "Sonata Set Bonus", value: son.hpFlat ?? 0 },
        ],
        [
          { label: "Skill Tree", value: tree.hpRatio ?? 0 },
          { label: "Echoes", value: ec.hpRatio ?? 0 },
          { label: "Sonata Set Bonus", value: son.hpRatio ?? 0 },
          { label: "Weapon Passive", value: wp.hpRatio ?? 0 },
        ],
        bk.hpBase,
      ),
    ],
    [
      "DEF",
      fN(st.def),
      dim,
      "20px",
      statLine(
        (rb.def ?? 0) + (wb.def ?? 0),
        [
          { label: "Echoes", value: ec.defFlat ?? 0 },
          { label: "Sonata Set Bonus", value: son.defFlat ?? 0 },
        ],
        [
          { label: "Skill Tree", value: tree.defRatio ?? 0 },
          { label: "Echoes", value: ec.defRatio ?? 0 },
          { label: "Sonata Set Bonus", value: son.defRatio ?? 0 },
          { label: "Weapon Passive", value: wp.defRatio ?? 0 },
        ],
        bk.defBase,
      ),
    ],
    [
      "HEALING BONUS",
      fP(st.healingBonus * 100),
      dim,
      "18px",
      pctBreakdown([
        { label: "Skill Tree", value: tree.healingBonus ?? 0 },
        { label: "Echoes", value: ec.healingBonus ?? 0 },
        { label: "Sonata Set Bonus", value: son.healingBonus ?? 0 },
      ]),
    ],
    [
      "CRIT RATE",
      fP(st.critRate * 100),
      acc,
      "24px",
      pctBreakdown([
        { label: "Base", value: rb.critRate ?? 0.05 },
        { label: "Weapon", value: wb.critRate ?? 0 },
        { label: "Weapon Passive", value: wp.critRate ?? 0 },
        { label: "Skill Tree", value: tree.critRate ?? 0 },
        { label: "Echoes", value: ec.critRate ?? 0 },
        { label: "Sonata Set Bonus", value: son.critRate ?? 0 },
      ]),
    ],
    [
      "CRIT DMG",
      fP(st.critDmg * 100),
      acc,
      "24px",
      pctBreakdown([
        { label: "Base", value: rb.critDmg ?? 1.5 },
        { label: "Weapon", value: wb.critDmg ?? 0 },
        { label: "Weapon Passive", value: wp.critDmg ?? 0 },
        { label: "Skill Tree", value: tree.critDmg ?? 0 },
        { label: "Echoes", value: ec.critDmg ?? 0 },
        { label: "Sonata Set Bonus", value: son.critDmg ?? 0 },
      ]),
    ],
    [
      `${el.name.toUpperCase()} DMG`,
      fP(elemDmg),
      el.c,
      "20px",
      pctBreakdown([
        {
          label: "Weapon Passive",
          value: wp.dmgByElement?.[reso?.element] ?? 0,
        },
        {
          label: "Skill Tree",
          value: tree.dmgByElement?.[reso?.element] ?? 0,
        },
        {
          label: "Echoes",
          value: ec.dmgByElement?.[reso?.element] ?? 0,
        },
        {
          label: "Sonata Set Bonus",
          value: son.dmgByElement?.[reso?.element] ?? 0,
        },
      ]),
    ],
    [
      "ENERGY REGEN",
      fP(st.energyRegen * 100),
      dim,
      "20px",
      pctBreakdown([
        { label: "Base", value: rb.energyRegen ?? 1.0 },
        { label: "Weapon", value: wb.energyRegen ?? 0 },
        { label: "Weapon Passive", value: wp.energyRegen ?? 0 },
        { label: "Echoes", value: ec.energyRegen ?? 0 },
        { label: "Sonata Set Bonus", value: son.energyRegen ?? 0 },
      ]),
    ],
    [
      "BASIC ATK DMG",
      fP((T.basic ?? 0) * 100),
      dim,
      "18px",
      skillTypeLine("basic"),
    ],
    [
      "HEAVY ATK DMG",
      fP((T.heavy ?? 0) * 100),
      dim,
      "18px",
      skillTypeLine("heavy"),
    ],
    [
      "SKILL DMG",
      fP((T.skill ?? 0) * 100),
      dim,
      "18px",
      skillTypeLine("skill"),
    ],
    [
      "LIBERATION DMG",
      fP((T.liberation ?? 0) * 100),
      dim,
      "18px",
      skillTypeLine("liberation"),
    ],
  ];

  const grid = tiles
    .map(
      ([label, value, color, size, line]) =>
        ` <div
          style="background:var(--inp);padding:16px 18px 15px;display:flex;flex-direction:column;gap:4px;"
        >
          <div
            style="font-family:var(--font-display);font-size:8.5px;letter-spacing:1.5px;color:var(--faint);"
          >
            ${esc(label)}
          </div>
          <div
            style="font-family:var(--font-display);font-weight:700;font-size:${size};color:${color};line-height:1.1;"
          >
            ${esc(value)}
          </div>
          <div
            style="font-family:var(--font-body);font-size:10px;color:var(--faint);line-height:1.4;"
          >
            ${line}
          </div>
        </div>`,
    )
    .join("");

  return `
      <div class="bv2-card">
        <span class="bv2-card__stripe"></span>
        <div class="bv2-card__head">
          <div class="bv2-title"><span class="bv2-title__bar"></span><span class="bv2-title__txt">TOTAL STATS</span></div>
          <span class="bv2-meta">Computed live from this build · Lv ${b.level}</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--bd);">${grid}</div>
      </div>`;
}

function stubCard(title, note) {
  return `
      <div class="bv2-card">
        <span class="bv2-card__stripe"></span>
        <div class="bv2-card__head">
          <div class="bv2-title"><span class="bv2-title__bar"></span><span class="bv2-title__txt">${esc(title.toUpperCase())}</span></div>
          <span class="bv2-meta">Beta · use Classic view for this panel</span>
        </div>
        <div class="bv2-stub">${esc(note)}</div>
      </div>`;
}

// =============================================================================
// Events
// =============================================================================

function bind() {
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

  // Stat Priority panel (P12): switch the solo mode (view-only, no build
  // mutation — set directly and repaint rather than via commit()).
  on(root, "click", '[data-act="stat-mode"]', (e, el) => {
    const m = el.dataset.mode;
    if (m && m !== api.statMode) {
      api.statMode = m;
      paint();
    }
  });

  on(root, "click", '[data-act="apply-suggested"]', () => {
    const suggestion = suggestedBuildFor(api.meta, api.build.resonatorId);
    if (suggestion) commit(applySuggestion(api.build, suggestion, api.dataset));
  });

  // Hover-box tooltip (see ../tooltip.js for the delegation details).
  bindTooltipHover(root, on);

  // Live slider feedback (no build mutation until release).
  on(root, "input", ".bv2-slider", (e, el) => {
    const v = Number(el.value);
    const act = el.dataset.act;
    const pct =
      act === "skill-level" ? pct1to10(v)
      : act === "echo-level" ? Math.round((v / 25) * 100) + "%"
      : pct1to90(v);
    el.style.setProperty("--pct", pct);
    const dispKey =
      act === "skill-level" ? `${act}:${el.dataset.key}`
      : act === "echo-level" ? `${act}:${el.dataset.slot}`
      : act;
    const disp = root.querySelector(`[data-disp="${dispKey}"]`);
    if (disp) disp.firstChild.textContent = String(v);
  });
  on(root, "change", ".bv2-slider", (e, el) => {
    const v = Number(el.value);
    if (el.dataset.act === "res-level") commit(setLevel(api.build, v));
    else if (el.dataset.act === "weapon-level")
      commit(setWeaponLevel(api.build, v));
    else if (el.dataset.act === "skill-level")
      commit(setSkillLevel(api.build, el.dataset.key, v));
  });

  on(root, "click", '[data-act="seq"]', (e, el) =>
    commit(setChain(api.build, tier(api.build.chain, Number(el.dataset.n), 0))),
  );
  on(root, "click", '[data-act="refine"]', (e, el) => {
    if (!api.build.weapon) return;
    commit(
      setWeaponRank(
        api.build,
        tier(api.build.weapon.rank ?? 1, Number(el.dataset.n), 1),
      ),
    );
  });
  on(root, "click", '[data-act="mode"]', (e, el) =>
    commit(setResonanceMode(api.build, el.dataset.mode)),
  );
  on(root, "change", '[data-act="build-name"]', (e, el) =>
    commit(setName(api.build, el.value)),
  );

  on(root, "click", '[data-act="pick-weapon"]', () => openWeaponPicker());

  on(root, "click", '[data-act="stat-node"]', (e, el) => {
    const col = el.dataset.col,
      n = Number(el.dataset.n);
    const arr = api.build.statNodesActive?.[col];
    const cur =
      arr?.[1] !== false ? 2
      : arr?.[0] !== false ? 1
      : 0;
    const next = tier(cur, n, 0);
    let b = setStatNode(api.build, col, 0, next >= 1);
    b = setStatNode(b, col, 1, next >= 2);
    commit(b);
  });
  on(root, "click", '[data-act="inherent-node"]', (e, el) => {
    const n = Number(el.dataset.n);
    const arr = api.build.inherentSkillsActive ?? [true, true];
    const cur =
      arr[1] !== false ? 2
      : arr[0] !== false ? 1
      : 0;
    const next = tier(cur, n, 0);
    let b = setInherentSkill(api.build, 0, next >= 1);
    b = setInherentSkill(b, 1, next >= 2);
    commit(b);
  });
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
  on(root, "click", '[data-act="select-echo"]', (e, el) => {
    if (
      e.target.closest(
        '[data-act="switch-echo"],[data-act="remove-echo"],[data-act="sonata-menu"],[data-act="echo-level"]',
      )
    )
      return;
    api.echoSlot = Number(el.dataset.slot);
    paint();
  });
  on(root, "click", '[data-act="pick-echo"]', (e, el) => {
    closeSonataMenu();
    openEchoPicker(Number(el.dataset.slot));
  });
  on(root, "click", '[data-act="switch-echo"]', (e, el) => {
    closeSonataMenu();
    openEchoPicker(Number(el.dataset.slot));
  });
  on(root, "click", '[data-act="sonata-menu"]', (e, el) => {
    if (
      api.sonataMenuAnchor === el &&
      api.sonataMenuEl?.classList.contains("is-open")
    ) {
      closeSonataMenu();
      return;
    }
    openSonataMenu(Number(el.dataset.slot), el);
  });
  on(root, "click", '[data-act="remove-echo"]', (e, el) => {
    closeSonataMenu();
    commit(setEcho(api.build, Number(el.dataset.slot), null));
  });

  on(root, "click", '[data-act="echoes-remove-all"]', () => {
    let b = api.build;
    for (let i = 0; i < ECHO_SLOTS; i++) b = setEcho(b, i, null);
    api.optimizerResult = null;
    commit(b);
  });
  on(root, "click", '[data-act="echoes-optimize"]', () => {
    api.optimizerResult = suggestEchoSubstats(
      api.build,
      api.dataset,
      defaultSimTarget(api.build),
    );
    paint();
  });

  on(root, "click", '[data-act="set-echo-main"]', (e, el) => {
    const slot = Number(el.dataset.slot),
      echo = api.build.echoes[slot];
    if (!echo) return;
    const opt = mainStatsForCost(echo.cost, api.dataset).find(
      (o) =>
        o.propId === Number(el.dataset.prop) &&
        o.addType === Number(el.dataset.addtype),
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
  on(root, "click", '[data-act="pick-echo-roll"]', (e, el) => {
    const slot = Number(el.dataset.slot),
      echo = api.build.echoes[slot];
    if (!echo) return;
    const propId = Number(el.dataset.prop),
      addType = Number(el.dataset.addtype),
      rollIdx = Number(el.dataset.roll);
    const opt = api.dataset.echoSubStats.find(
      (s) => s.propId === propId && s.addType === addType,
    );
    if (!opt) return;
    const rolls = possibleRollsFor(opt, api.dataset.statRanges);
    if (!rolls.length || rollIdx < 0 || rollIdx >= rolls.length) return;

    const subs = [...(echo.subStats ?? [])];
    const at = subs.findIndex(
      (s) => s.propId === propId && s.addType === addType,
    );
    if (at >= 0) {
      if (rolls.indexOf(subs[at].value) === rollIdx) {
        subs.splice(at, 1);
      } else {
        subs[at] = { ...subs[at], value: rolls[rollIdx] };
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

  on(root, "click", '[data-act="reset-echo-stats"]', (e, el) => {
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

  on(root, "click", '[data-act="add-step"]', (e, el) => {
    let b = appendRotationStep(api.build, el.dataset.key);
    b = applyAutoTrigger(b, b.rotation.length - 1);
    commit(b);
  });
  on(root, "click", '[data-act="remove-step"]', (e, el) => {
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
  on(root, "click", '[data-act="rot-load"]', (e, el) => {
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
  on(root, "click", '[data-act="fix-warning"]', (e, el) => {
    const w = api.lastWarnings?.[Number(el.dataset.warnIdx)];
    if (!w) return;
    commit(applyFix(api.build, w));
  });
  on(root, "click", '[data-act="toggle-rot-hits"]', (e, el) => {
    const idx = Number(el.dataset.index);
    api.rotStepExpanded = api.rotStepExpanded === idx ? null : idx;
    paint();
  });

  on(root, "click", '[data-act="toggle-dmg-row"]', (e, el) => {
    const key = el.dataset.key;
    if (api.dmgExpanded.has(key)) api.dmgExpanded.delete(key);
    else api.dmgExpanded.add(key);
    paint();
  });
  // 'change' (not 'input') — this is a full-page repaint, so committing on
  // every keystroke would blow away focus mid-type. Same reasoning as the
  // build-name field above.
  on(root, "change", '[data-act="dmg-enemy-level"]', (e, el) => {
    const v = Number(el.value);
    if (Number.isFinite(v) && v >= 1 && v <= 120) {
      api.dmgTarget.level = v;
      paint();
    }
  });
  on(root, "change", '[data-act="dmg-enemy-res"]', (e, el) => {
    const v = Number(el.value);
    if (Number.isFinite(v) && v >= -1 && v <= 2) {
      api.dmgTarget.res = v;
      paint();
    }
  });

  on(root, "change", '[data-act="echo-level"]', (e, el) => {
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
function defaultSimTarget(build) {
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
function openEchoPicker(slotIndex) {
  const items = api.dataset.echoes
    .filter((e) => e.name)
    .map((e) => ({
      id: e.id,
      name: e.name,
      cost: e.cost,
      elem: e.activeSkill?.element ?? e.elementTypes?.[0] ?? null,
      sonataIds: e.sonataIds ?? [],
      iconUrl: e.iconUrl,
      skill: e.activeSkill?.name ?? "",
      desc: echoActiveSkillDesc(e),
      starLevel: e.starLevel ?? 5,
    }));

  // Sonata chips: only sets that actually appear among the echoes, sorted by
  // id. `desc` (2PC/5PC bonuses) drives the chip's set-detail hover-box.
  const presentSonataIds = new Set();
  for (const it of items)
    for (const sid of it.sonataIds) presentSonataIds.add(sid);
  const sonatas = (api.dataset.sonatas ?? [])
    .filter((s) => s.name && presentSonataIds.has(s.id))
    .sort((a, b) => a.id - b.id)
    .map((s) => ({
      id: s.id,
      name: s.name,
      desc: sonataTooltipDesc(s.id),
      elem: sonataElementId(s.id),
    }));

  echoPicker.open({
    slotIndex,
    theme: api.theme,
    items,
    sonatas,
    onPick: (item) => {
      // SWITCHING an existing echo keeps the user's rolled stats — only the
      // echo identity changes. Main stat carries over when the cost matches
      // (its options are cost-specific); substats + level always carry over.
      const prev = api.build.echoes[slotIndex];
      const sameCost = prev && prev.cost === item.cost;
      const newEcho = {
        id: item.id,
        cost: item.cost,
        level: prev?.level ?? 25,
        starLevel: item.starLevel ?? 5,
        mainStat: sameCost ? (prev?.mainStat ?? null) : null,
        subStats: prev?.subStats ?? [],
        sonataId: item.sonataIds?.[0] ?? null,
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
function bindRotationDragAndDrop(root) {
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

  root.addEventListener("dragstart", (e) => {
    const paletteBtn = e.target.closest('[data-act="add-step"]');
    if (paletteBtn) {
      paletteDragKey = paletteBtn.dataset.key;
      e.dataTransfer.effectAllowed = "copy";
      try {
        e.dataTransfer.setData("text/plain", paletteDragKey);
      } catch {}
      return;
    }
    const chip = e.target.closest(".rot2-chip");
    if (!chip) return;
    dragSrcIndex = Number(chip.dataset.index);
    chip.style.opacity = ".3";
    e.dataTransfer.effectAllowed = "move";
    try {
      e.dataTransfer.setData("text/plain", String(dragSrcIndex));
    } catch {}
  });
  root.addEventListener("dragend", (e) => {
    const chip = e.target.closest(".rot2-chip");
    if (chip) chip.style.opacity = "1";
    clearIndicator();
    dragSrcIndex = null;
    paletteDragKey = null;
  });
  root.addEventListener("dragover", (e) => {
    if (dragSrcIndex == null && paletteDragKey == null) return;
    const chip = e.target.closest(".rot2-chip");
    if (chip) {
      e.preventDefault();
      e.dataTransfer.dropEffect = dragSrcIndex != null ? "move" : "copy";
      const rect = chip.getBoundingClientRect();
      const side = e.clientX - rect.left < rect.width / 2 ? "left" : "right";
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
    const seq = e.target.closest(".rot2-seq");
    if (seq && paletteDragKey != null) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      if (seq !== indicatorSeq) {
        clearIndicator();
        indicatorSeq = seq;
        seq.style.boxShadow = "inset 0 0 0 1.5px var(--acc)";
      }
    }
  });
  root.addEventListener("dragleave", (e) => {
    if (
      indicatorChip &&
      e.target.closest(".rot2-chip") === indicatorChip &&
      !indicatorChip.contains(e.relatedTarget)
    )
      clearIndicator();
    if (
      indicatorSeq &&
      e.target.closest(".rot2-seq") === indicatorSeq &&
      !indicatorSeq.contains(e.relatedTarget)
    )
      clearIndicator();
  });
  root.addEventListener("drop", (e) => {
    const chip = e.target.closest(".rot2-chip");
    const seq = e.target.closest(".rot2-seq");
    const side = indicatorSide;
    clearIndicator();
    if (chip) {
      e.preventDefault();
      const to = Number(chip.dataset.index);
      if (dragSrcIndex != null) {
        if (to !== dragSrcIndex)
          commit(moveRotationStep(api.build, dragSrcIndex, to));
      } else if (paletteDragKey != null) {
        let b = appendRotationStep(api.build, paletteDragKey);
        const target = side === "right" ? to + 1 : to;
        b = moveRotationStep(b, b.rotation.length - 1, target);
        b = applyAutoTrigger(b, target);
        commit(b);
      }
    } else if (seq && paletteDragKey != null) {
      e.preventDefault();
      let b = appendRotationStep(api.build, paletteDragKey);
      b = applyAutoTrigger(b, b.rotation.length - 1);
      commit(b);
    }
    dragSrcIndex = null;
    paletteDragKey = null;
  });
}

function openWeaponPicker() {
  const reso = resonatorOf();
  if (!reso) return;
  const weapons = api.dataset.weapons
    .filter((w) => w.type === reso.weaponType)
    .sort((a, b) => b.rarity - a.rarity || a.name.localeCompare(b.name));
  modal.open({
    title: `Choose a ${reso.weaponTypeName}`,
    items: weapons,
    searchFields: ["name"],
    allowUnequip: !!api.build.weapon,
    renderRow: (
      w,
    ) => `<div class="option__body"><span class="option__name">${esc(w.name)}</span>
            <span class="option__sub">${"★".repeat(w.rarity)} · ${esc(w.typeName ?? reso.weaponTypeName)}</span>
            <span class="option__sub">${esc(weaponStatsLine(w, 90))}</span></div>`,
    onPick: (w) => commit(setWeapon(api.build, w ? w.id : null)),
  });
}

// Floating builds/resonator selector — same "old style" modal-picker the
// Party page uses on its resonator icon (openSlotPicker in team-editor-v2.js),
// reused here as a placeholder for switching the build page to a different
// saved build, or starting a fresh one for any roster resonator.
function openResonatorPicker() {
  const builds = (api.listBuilds?.() ?? []).filter(
    (b) => b.id !== api.build.id,
  );
  const buildItems = builds.map((b) => {
    const r = api.dataset.resonators.find((x) => x.id === b.resonatorId);
    return {
      kind: "build",
      build: b,
      resonator: r,
      name: b.name,
      resoName: r?.name ?? "",
    };
  });
  const rosterItems = api.dataset.resonators.map((r) => ({
    kind: "roster",
    resonator: r,
    name: r.name,
    resoName: r.name,
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
            test: (it) => it.kind === "build",
          },
          {
            value: "roster",
            label: "Roster",
            test: (it) => it.kind === "roster",
          },
        ],
      },
    ],
    renderRow: (it) => {
      const r = it.resonator;
      const icon =
        r?.iconUrl ?
          `<img class="option__icon" src="${esc(r.iconUrl)}" alt="" loading="lazy" onerror="this.style.display='none'">`
        : `<span class="option__icon option__icon--missing"></span>`;
      const sub =
        it.kind === "build" ?
          `Saved build · Lv ${it.build.level}`
        : "Roster · new build";
      const badge = it.kind === "build" ? "B" : "R";
      return `${icon}
              <div class="option__body">
                <span class="option__name">${esc(it.name)}</span>
                <span class="option__sub">${esc(sub)}</span>
              </div>
              <span class="option__badge">${badge}</span>`;
    },
    onPick: (it) => {
      if (!it) return;
      if (it.kind === "build") api.onPickBuild?.(it.build.id);
      else api.onPickNewResonator?.(it.resonator.id);
    },
  });
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
