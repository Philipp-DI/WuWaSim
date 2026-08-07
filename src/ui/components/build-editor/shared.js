// src/ui/components/build-editor/shared.js — formatters, colour scales, and tiny cross-panel lookups.
// Split from the monolithic build-editor-v2.js (Simplification Plan S4.2).
import { ECHO_STEP_KEY, TUNE_BREAK_STEP_KEY } from "../../../core/sim.js";
import { SKILL_KEYS, setInherentSkill, setSkillLevel, setStatNode } from "../../../core/build.js";
import { api } from "./state.js";
import { applySonataOverride } from "../../../core/sonata-override.js";
import { extractSkillSection } from "../../tip-format.js";
import { iconHtml } from "../../icons.js";
import { resolveReferenceRotation } from "../../../data/meta-loader.js";

// The build every SIM/stat read on the editor should use: the persisted build
// with the transient sonata quick-switch applied (relabels echo sets for a
// PREVIEW only — never saved; see core/sonata-override.js). `api.build` stays
// pristine for editing/undo/autosave. Memoized by [build, override] identity so
// panels that key their own caches on the sim build (e.g. liveAnalysis) stay
// stable across repaints; a real override change swaps in a fresh override
// object, invalidating the cache.
let _simBuildCache = { build: null, override: null, result: null };
export function simBuild() {
  const override = api.sonataOverride ?? null;
  if (_simBuildCache.build === api.build && _simBuildCache.override === override) {
    return _simBuildCache.result;
  }
  const result = applySonataOverride(api.build, override);
  _simBuildCache = { build: api.build, override, result };
  return result;
}

// Element id → { name, colour, glyph } using the handoff's palette.
// Per-element colours — single source: styles/tokens.css --el-*.
// var() resolves in inline styles and SVG fill= alike; alpha tints use color-mix.
export const ELEM = {
  1: { name: "Glacio", c: "var(--el-glacio)", g: "G" },
  2: { name: "Fusion", c: "var(--el-fusion)", g: "F" },
  3: { name: "Electro", c: "var(--el-electro)", g: "E" },
  4: { name: "Aero", c: "var(--el-aero)", g: "A" },
  5: { name: "Spectro", c: "var(--el-spectro)", g: "S" },
  6: { name: "Havoc", c: "var(--el-havoc)", g: "H" },
};

export const GOLD = "var(--tip-gold)";

export const formatNumber = (number) => Math.round(number).toLocaleString("en-US");

export const formatPercent = (number) => (Math.round(number * 10) / 10).toFixed(1) + "%";

export const pct1to90 = (value) =>
  Math.round(((Math.max(1, Math.min(90, value)) - 1) / 89) * 100) + "%";

export const pct1to10 = (value) =>
  Math.round(((Math.max(1, Math.min(10, value)) - 1) / 9) * 100) + "%";

export const STAT_NODE_COLS = SKILL_KEYS.filter((k) => k !== "forte");

// Short abbreviation for the 13 real echo substat names (dataset.echoSubStats).
export const SUBSTAT_ABBR = {
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
export const SUBSTAT_ROW_META = {
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
export const SUBSTAT_GROUPS = [
  {
    label: "FLAT ROLLS",
    keys: ["ATK", "HP", "DEF"],
    flexBasis: "1 1 100%",
    // 216px = the row's real minimum content width (58px label + 10px gap +
    // 4 roll buttons at 34px min + 3×4px gaps) — matches DMG BONUS below.
    // A higher floor here was wrapping to 2 columns before real overflow.
    cols: "repeat(auto-fit,minmax(216px,1fr))",
  },
  {
    label: "MAIN STAT %",
    keys: ["ATK%", "HP%", "DEF%"],
    flexBasis: "1 1 100%",
    cols: "repeat(auto-fit,minmax(216px,1fr))",
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
export const rollTint = (count, pct) =>
  `color-mix(in srgb, var(--roll-${count}) ${pct}%, transparent)`;

export const ROLL_SCALE = [
  { c: "var(--roll-1)", bg: rollTint(1, 16) },
  { c: "var(--roll-2)", bg: rollTint(2, 13) },
  { c: "var(--roll-3)", bg: rollTint(3, 17) },
  { c: "var(--roll-4)", bg: rollTint(4, 18) },
  { c: "var(--roll-5)", bg: rollTint(5, 20) },
  { c: "var(--roll-6)", bg: rollTint(6, 18) },
  { c: "var(--roll-max-ink)", bg: "var(--grad-roll-silver)" },
  { c: "var(--roll-max-ink)", bg: "var(--grad-roll-rainbow)" },
];

export function rollColorFor(index, count) {
  if (count <= 1) return ROLL_SCALE[7];
  return ROLL_SCALE[Math.min(Math.round((index / (count - 1)) * 7), 7)];
}

export const fmtSub = (value, isPercent) =>
  Math.round(value * 10) / 10 + (isPercent ? "%" : "");

// Colour/abbreviation per real rotation-step skillType (superset of the
// handoff's BA/HA/SK/LB/EC — our engine also emits intro/outro/unknown).
export const stepTint = (type) => `color-mix(in srgb, var(--dmg-${type}) 13%, transparent)`;

export const STEP_TYPE = {
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
  // Forte Circuit is the resonator's specialty gauge, not an attack input, so
  // both node variants share one badge — the basic/heavy split is mechanical
  // (multiplierUp matching) and says nothing about how the move is performed.
  // Without these the fallback painted every Forte step in the WARN colour.
  forte_basic: { abbr: "FC", c: "var(--dmg-forte)", bg: stepTint("forte") },
  forte_heavy: { abbr: "FC", c: "var(--dmg-forte)", bg: stepTint("forte") },
  forte: { abbr: "FC", c: "var(--dmg-forte)", bg: stepTint("forte") },
  // Tune Break is the TARGET's mechanic, responded to rather than cast off a
  // gauge of ours — its own hue so it never reads as one of the attack inputs.
  tuneBreak: { abbr: "TB", c: "var(--dmg-tuneBreak)", bg: stepTint("tuneBreak") },
};

export function stepTypeInfo(type) {
  return (
    STEP_TYPE[type] ?? {
      abbr: (type || "?").slice(0, 2).toUpperCase(),
      c: "var(--warn)",
      bg: "color-mix(in srgb, var(--warn) 13%, transparent)",
    }
  );
}

export const TYPE_LABEL = {
  basic: "Basic Attack",
  heavy: "Heavy Attack",
  skill: "Resonance Skill",
  liberation: "Resonance Liberation",
  intro: "Intro Skill",
  outro: "Outro Skill",
  echo: "Echo Skill",
  tuneBreak: "Tune Break",
  forte: "Forte Circuit",
  forte_basic: "Forte Circuit",
  forte_heavy: "Forte Circuit",
};

/**
 * The damage FAMILY a step belongs to, for anything that aggregates by type.
 *
 * `forte_basic` and `forte_heavy` are one family: the split is mechanical
 * (which `multiplierUp` a node matches) and says nothing about how the move is
 * performed, so both already share a label, a colour and a badge. Aggregating
 * on the raw node type instead drew TWO identical "Forte Circuit" slices for
 * the five resonators whose reference rotation uses both — and, worse, split
 * one contribution across two buckets that could each fall under the 4%
 * "Other" threshold the combined slice clears.
 */
export const damageFamily = (skillType) =>
  skillType === "forte_basic" || skillType === "forte_heavy" ? "forte" : skillType;

export const fmtTime = (seconds) => (Number.isFinite(seconds) ? `${seconds.toFixed(1)}s` : "—");

export const fmtDps = (value) => (Number.isFinite(value) && value > 0 ? formatNumber(value) : "—");

export function echoDefOf(echo) {
  return echo ?
      (api.dataset.echoes.find((candidate) => candidate.id === echo.id) ?? null)
    : null;
}

export function sonataOf(id) {
  return id == null ? null : (
      (api.dataset.sonatas.find((sonata) => sonata.id === id) ?? null)
    );
}

// Real sonata crest, rendered bare (no swatch box/border) at native colour.
export function sonataIconHtml(sonataId, size) {
  const sonata = sonataOf(sonataId);
  return iconHtml("sonata", sonata?.name, { label: sonata?.name, size });
}

// Small chevron marking the sonata icon as clickable — only rendered when an
// echo actually has more than one valid sonata set (sonata-menu quick-switch).
export const SONATA_SWITCH_ARROW = `<svg width="7" height="7" viewBox="0 0 8 8" style="flex:none;opacity:.65;"><path d="M1 2.5L4 5.5L7 2.5" stroke="var(--dim)" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// Reference rotation for a resonator — checks the P12 meta first (covered seed
// chars), then falls back to the runtime-loaded reference-rotations.json (all 54).
// Thin wrapper over the pure resolveReferenceRotation (meta-loader.js) bound to
// this page's own api singleton.
export function referenceRotationFor(resonatorId) {
  return resolveReferenceRotation(api.meta, api.referenceRotations, resonatorId);
}

// Set-bonus text for a sonata's hover-box (shared by the echo slot card's
// sonata dot, the sonata strip, and the echo picker's filter chips). Renders
// EVERY tier the set defines — classic sets are 2PC/5PC, but the newer sets are
// single 3PC bonuses, which an earlier 2/5-only lookup silently dropped.
export function sonataTooltipDesc(sonataId) {
  const sonata = sonataOf(sonataId);
  if (!sonata?.tiers?.length) return "";
  return sonata.tiers
    .slice()
    .sort((tierA, tierB) => tierA.pieces - tierB.pieces)
    .filter((tier) => tier.effect)
    .map((tier) => `${tier.pieces}PC — ${tier.effect}`)
    .join("\n");
}

// Derive a sonata's element id (1–6) from its bonus text, or null for
// non-elemental/support sets. The dataset carries no element field on sonatas,
// but elemental sets name their element in the bonus ("Glacio DMG +10%",
// "Havoc Bane", "Fusion DMG Bonus"). Used to group the echo picker's sonata
// filter by element.
export const SONATA_ELEMENT_NAME_TO_ID = {
  Glacio: 1,
  Fusion: 2,
  Electro: 3,
  Aero: 4,
  Spectro: 5,
  Havoc: 6,
};

export function sonataElementId(sonataId) {
  const sonata = sonataOf(sonataId);
  const text = (sonata?.tiers ?? []).map((tier) => tier.effect ?? "").join(" ");
  for (const [name, id] of Object.entries(SONATA_ELEMENT_NAME_TO_ID)) {
    if (text.includes(name)) return id;
  }
  return null;
}

// Active-skill desc carries unsubstituted {n} param placeholders straight from
// the source data (only resonator-facing descs get param-substituted at
// preprocess time) — fill them in from the max-level params here for display.
export function echoActiveSkillDesc(def) {
  const activeSkill = def?.activeSkill;
  if (!activeSkill?.desc) return "";
  const params = activeSkill.params?.[activeSkill.params.length - 1] ?? [];
  return activeSkill.desc
    .replace(/\{(\d+)\}/g, (match, i) => params[Number(i)] ?? match)
    .replace(/\{[A-Za-z][^}]*\}/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Single source for "what does this step's move actually do" — used by
// every rotation-facing hover-box (rotation chips, the line-chart's dots).
// Echo steps source their desc from the equipped echo's own activeSkill
// text since echoes aren't part of the resonator's skillMap.
export function skillDescFor(skillKey, skillMap) {
  if (skillKey === ECHO_STEP_KEY) {
    const echoDef = echoDefOf(api.build.echoes?.[0]);
    return echoDef ? echoActiveSkillDesc(echoDef) : "";
  }
  // Tune Break has no skillMap entry either — its node is the resonator's own
  // (`resonator.tuneBreak`), which is where the game states what responding does.
  if (skillKey === TUNE_BREAK_STEP_KEY) return resonatorOf()?.tuneBreak?.desc ?? "";
  const def = skillMap?.[skillKey];
  return def ? extractSkillSection(def.desc, skillKey, def.skillType) : "";
}

// Reset/max all 5 skill levels + every forte/stat node this resonator
// actually has (data-driven — node counts vary per resonator, never assumed).
export function setAllSkillNodes(build, active, level) {
  const resonator = api.dataset.resonators.find((resonator) => resonator.id === build.resonatorId);
  let updated = build;
  for (const key of SKILL_KEYS) updated = setSkillLevel(updated, key, level);
  for (const col of STAT_NODE_COLS) {
    for (const node of resonator?.statNodeBonuses?.[col] ?? [])
      updated = setStatNode(updated, col, node.tier - 1, active);
  }
  (resonator?.inherentSkills ?? []).forEach((_, i) => {
    updated = setInherentSkill(updated, i, active);
  });
  return updated;
}

// Tiered toggle: clicking node n steps down when it's already the top, else raises to n.
export const tier = (current, selected, min) => (selected === current ? Math.max(min, selected - 1) : selected);

export const resonatorOf = () =>
  api.dataset.resonators.find((resonator) => resonator.id === api.build.resonatorId) ?? null;

// Damage target used by the per-ability resolvers (Ability Damage Overview
// card + the top HUD strip). Enemy level/RES come from api.dmgTarget; the
// attacker level is the build's own level. Element 0 (physical) always sits at
// 0 RES; elements 1–6 share the panel's single RES value.
export function makeDmgTarget(build, dmgTarget) {
  return {
    level: dmgTarget.level,
    atkLv: build.level,
    resistances: {
      0: 0,
      1: dmgTarget.res,
      2: dmgTarget.res,
      3: dmgTarget.res,
      4: dmgTarget.res,
      5: dmgTarget.res,
      6: dmgTarget.res,
    },
  };
}

export const weaponOf = () =>
  api.build.weapon ?
    api.dataset.weapons.find((weapon) => weapon.id === api.build.weapon.id)
  : null;

// Short label for a stat-node's full name (e.g. "Crit. Rate+" → "CR") — the
// node button is too small (36px) for the full dataset string.
export function statAbbr(name) {
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

export const titleCase = (text) => String(text ?? "").replace(/\b\w/g, (character) => character.toUpperCase());
