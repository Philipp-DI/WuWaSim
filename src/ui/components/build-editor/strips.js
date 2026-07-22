// src/ui/components/build-editor/strips.js — the two scroll-persistent HUD
// strips that flank the build editor: a top strip with per-ability average
// damage (Basic / Skill / Liberation) and a bottom strip with the build's most
// important stats (ATK / CR / CD / Elemental DMG / ER).
//
// The strips repaint with the rest of the page (index.js paint()), so they
// always mirror the current build and the Ability Damage Overview's enemy
// level/RES target. The bottom strip is display-only; the top strip also carries
// the undo/redo controls (data-act wired in bind.js, keyboard in index.js).
import { ELEM, formatNumber, formatPercent, makeDmgTarget, resonatorOf } from "./shared.js";
import { api } from "./state.js";
import { effectiveSkillMap } from "../../../core/sim.js";
import { esc } from "../../dom.js";
import { resolveSkill } from "../../../core/skill.js";
import { resolveTotalStats } from "../../../core/stats.js";

// Per-hit average expected damage for the three headline ability categories,
// grouped by the mechanical node skillType (Basic Attack, Resonance Skill,
// Resonance Liberation). "All instances" = every damaging hit across every
// skillMap entry of that type; the value returned is their mean expected
// (crit-weighted) damage. Uses the SAME stats/target the Ability Damage
// Overview card resolves with, so the strip and the card never disagree.
//
// Returns { basic, skill, liberation, overall } where each is a number or null
// (null = no damaging instances resolved, e.g. a support-only skill or missing
// map). `overall` is the mean across EVERY hit instance in the kit (all skill
// types, not just the three headline categories); the three category means bucket
// only their own type. One pass, each skill resolved once.
export function abilityAverages() {
  const skillMap = effectiveSkillMap(api.dataset, api.build.resonatorId);
  if (!skillMap) return null;
  const stats = resolveTotalStats(api.build, api.dataset);
  const target = makeDmgTarget(api.build, api.dmgTarget);

  const buckets = { basic: [0, 0], skill: [0, 0], liberation: [0, 0] };
  let allSum = 0,
    allCount = 0;
  for (const [key, def] of Object.entries(skillMap)) {
    if (key.startsWith("_")) continue;
    const computed = resolveSkill({
      skillDef: def,
      build: api.build,
      dataset: api.dataset,
      stats,
      target,
    });
    if (!computed) continue;
    const bucket = buckets[def.skillType];
    for (const hit of computed.hits) {
      allSum += hit.result.expected;
      allCount += 1;
      if (bucket) {
        bucket[0] += hit.result.expected;
        bucket[1] += 1;
      }
    }
  }
  const mean = ([sum, count]) => (count > 0 ? sum / count : null);
  return {
    basic: mean(buckets.basic),
    skill: mean(buckets.skill),
    liberation: mean(buckets.liberation),
    overall: allCount > 0 ? allSum / allCount : null,
  };
}

function hudCell(label, value, color, title) {
  return `<div class="bv2-hud__cell" title="${esc(title)}">
      ${label ? `<span class="bv2-hud__label">${esc(label)}</span>` : ""}
      <span class="bv2-hud__val" style="color:${color};">${esc(value)}</span>
    </div>`;
}

// TOP STRIP — average per-hit damage for Basic / Skill / Liberation. Sits
// directly below the header at the scroll top and (via sticky top:0 + a higher
// z-index than the header) rises to cover it once the header scrolls away.
export function renderTopStrip() {
  const avgs = abilityAverages();
  const fmt = (value) => (value == null ? "—" : formatNumber(value));
  const resonator = resonatorOf();
  const el = ELEM[resonator?.element] ?? { name: "—", c: "var(--acc)" };
  const cells = [
    ["", resonator?.name ?? "—", el.c, `${resonator?.name ?? "Resonator"} — ${el.name}`],
    ["BASIC AVG", fmt(avgs?.basic), "var(--dmg-basic)", "Average expected damage per Basic Attack hit instance"],
    ["SKILL AVG", fmt(avgs?.skill), "var(--dmg-skill)", "Average expected damage per Resonance Skill hit instance"],
    ["LIB AVG", fmt(avgs?.liberation), "var(--dmg-liberation)", "Average expected damage per Resonance Liberation hit instance"],
    ["OVERALL AVG", fmt(avgs?.overall), "var(--txt)", "Average expected damage across every hit instance in the kit"],
  ]
    .map(([label, value, color, title]) => hudCell(label, value, color, title))
    .join("");
  const canUndo = api.history?.canUndo() ?? false;
  const canRedo = api.history?.canRedo() ?? false;
  const tools = `<div class="bv2-hud__tools">
      <button class="bv2-hud__btn" data-act="undo" ${canUndo ? "" : "disabled"} title="Undo (Ctrl+Z)" aria-label="Undo">↶</button>
      <button class="bv2-hud__btn" data-act="redo" ${canRedo ? "" : "disabled"} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">↷</button>
    </div>`;
  return `<div class="bv2-hud bv2-hud--top"><div class="bv2-hud__inner">${tools}${cells}</div></div>`;
}

// BOTTOM STRIP — the build's headline stats. Uses includeConditionals:false so
// it matches the stowed-screen TOTAL STATS card on the same page. Sticky
// bottom:0, so it stays pinned to the viewport bottom while scrolling.
export function renderBottomStrip() {
  const resonator = resonatorOf();
  const stats = resolveTotalStats(api.build, api.dataset, null, null, {
    includeConditionals: false,
  });
  const el = ELEM[resonator?.element] ?? { name: "—", c: "var(--acc)" };
  const elemDmg = (stats.dmgBonusByElement?.[resonator?.element] ?? 0) * 100;
  const cells = [
    ["ATK", formatNumber(stats.atk), "var(--acc)", "Attack"],
    ["CR", formatPercent(stats.critRate * 100), "var(--acc)", "Crit Rate"],
    ["CD", formatPercent(stats.critDmg * 100), "var(--acc)", "Crit DMG"],
    [`${el.name.toUpperCase()} DMG`, formatPercent(elemDmg), el.c, `${el.name} DMG Bonus`],
    ["ER", formatPercent(stats.energyRegen * 100), "var(--dim)", "Energy Regen"],
  ]
    .map(([label, value, color, title]) => hudCell(label, value, color, title))
    .join("");
  return `<div class="bv2-hud bv2-hud--bottom"><div class="bv2-hud__inner">${cells}</div></div>`;
}
