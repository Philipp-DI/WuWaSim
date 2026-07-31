// src/ui/components/build-editor/stats-panel.js — the "show your math" total-stats panel.
// Split from the monolithic build-editor-v2.js (Simplification Plan S4.2).
import { ELEM, formatNumber, formatPercent, resonatorOf, simBuild } from "./shared.js";
import { api } from "./state.js";
import { esc } from "../../dom.js";
import { liveAnalysis } from "./stat-priority.js";
import { resolveTotalStats } from "../../../core/stats.js";

// The number on this tile is the SHEET crit rate. Mid-rotation buffs are not in
// it, so a build reading 97.8% here can still spend the whole rotation clamped
// at the formula's 100% cap — which is what makes further Crit Rate worth
// nothing while the tile still looks like it has room (2026-07-31).
function critCapNote() {
  const share = liveAnalysis()?.live?.critCapped ?? 0;
  if (!(share > 0)) return "";
  const pct = Math.round(share * 100);
  return `<div style="color:var(--warn);">⚠ In combat, buffs hit the 100% cap on ${pct}% of your damage — more Crit Rate adds nothing there.</div>`;
}

// "Echoes 60.0% + Sonata Set Bonus 10.0%" — lists every nonzero source that
// feeds a purely-additive % stat (crit/healing/energy-regen/element-or-skill
// DMG bonus), in the same order they're summed in stats.js.
export function pctBreakdown(parts) {
  const nonZero = parts.filter((part) => Math.abs(part.value) > 0.0005);
  if (nonZero.length === 0) return "Base 0%";
  return nonZero
    .map((part, i) =>
      i === 0 ?
        `${esc(part.label)} ${formatPercent(part.value * 100)}`
      : `<span style="color:var(--acc);"> + ${esc(part.label)} ${formatPercent(part.value * 100)}</span>`,
    )
    .join("");
}

// ATK/HP/DEF are multiplicative (flatBase × (1 + ratioBonus)), so the
// breakdown shows the flat additions (Echoes/Sonata flat stats) separately
// from the % ratio modifiers (Skill Tree/Echoes/Sonata ratio bonuses) —
// flatBase × (1 + Σratio) + Σflat reconstructs the displayed total exactly.
// When `base` is provided (> 0), each ratio part also shows its flat equivalent
// so the user can see actual ATK numbers alongside the source percentage.
export function statLine(flatBase, flatParts, ratioParts, base = 0) {
  let out = `Base ${formatNumber(flatBase)}`;
  for (const part of flatParts) {
    if (Math.abs(part.value) > 0.5)
      out += `<span style="color:var(--acc);"> + ${esc(part.label)} +${formatNumber(part.value)}</span>`;
  }
  for (const part of ratioParts) {
    if (Math.abs(part.value) > 0.0005) {
      const pctStr = formatPercent(part.value * 100);
      const flatStr =
        base > 0 ? `+${formatNumber(part.value * base)} (${pctStr})` : `+${pctStr}`;
      out += `<span style="color:var(--acc);"> + ${esc(part.label)} ${flatStr}</span>`;
    }
  }
  return out;
}

export function renderStats() {
  const build = simBuild(); // reflect the sonata quick-switch preview
  const resonator = resonatorOf();
  // includeConditionals:false → match the in-game stowed stat screen (no active
  // combat buffs). Weapon/sonata conditional buffs are still applied at full
  // uptime in the sim; they just don't inflate the display panel.
  const totalStats = resolveTotalStats(build, api.dataset, null, null, {
    includeConditionals: false,
  });
  const el = ELEM[resonator?.element] ?? { name: "—", c: "var(--acc)" };
  const acc = "var(--acc)",
    dim = "var(--dim)";
  const breakdown = totalStats.breakdown ?? {};
  const resonatorBase = breakdown.resonatorBase ?? {},
    weaponBase = breakdown.weaponBase ?? {},
    weaponPassive = breakdown.weaponPassive ?? {};
  const tree = breakdown.skillTree ?? {},
    echoes = breakdown.echoes ?? {},
    son = breakdown.sonataStats ?? {};

  const elemDmg = (totalStats.dmgBonusByElement?.[resonator?.element] ?? 0) * 100;
  const typeBonus = totalStats.dmgBonusBySkillType ?? {};

  const skillTypeLine = (key) =>
    pctBreakdown([
      { label: "Weapon Passive", value: weaponPassive.dmgBySkillType?.[key] ?? 0 },
      { label: "Echoes", value: echoes.dmgBySkillType?.[key] ?? 0 },
      {
        label: "Sonata Set Bonus",
        value: son.dmgBySkillType?.[key] ?? 0,
      },
    ]);

  const tiles = [
    [
      "ATK",
      formatNumber(totalStats.atk),
      acc,
      "24px",
      statLine(
        (resonatorBase.atk ?? 0) + (weaponBase.atk ?? 0),
        [
          { label: "Echoes", value: echoes.atkFlat ?? 0 },
          { label: "Sonata Set Bonus", value: son.atkFlat ?? 0 },
        ],
        [
          { label: "Skill Tree", value: tree.atkRatio ?? 0 },
          { label: "Echoes", value: echoes.atkRatio ?? 0 },
          { label: "Sonata Set Bonus", value: son.atkRatio ?? 0 },
          { label: "Weapon Passive", value: weaponPassive.atkRatio ?? 0 },
        ],
        breakdown.atkBase,
      ),
    ],
    [
      "HP",
      formatNumber(totalStats.hp),
      dim,
      "20px",
      statLine(
        (resonatorBase.hp ?? 0) + (weaponBase.hp ?? 0),
        [
          { label: "Echoes", value: echoes.hpFlat ?? 0 },
          { label: "Sonata Set Bonus", value: son.hpFlat ?? 0 },
        ],
        [
          { label: "Skill Tree", value: tree.hpRatio ?? 0 },
          { label: "Echoes", value: echoes.hpRatio ?? 0 },
          { label: "Sonata Set Bonus", value: son.hpRatio ?? 0 },
          { label: "Weapon Passive", value: weaponPassive.hpRatio ?? 0 },
        ],
        breakdown.hpBase,
      ),
    ],
    [
      "DEF",
      formatNumber(totalStats.def),
      dim,
      "20px",
      statLine(
        (resonatorBase.def ?? 0) + (weaponBase.def ?? 0),
        [
          { label: "Echoes", value: echoes.defFlat ?? 0 },
          { label: "Sonata Set Bonus", value: son.defFlat ?? 0 },
        ],
        [
          { label: "Skill Tree", value: tree.defRatio ?? 0 },
          { label: "Echoes", value: echoes.defRatio ?? 0 },
          { label: "Sonata Set Bonus", value: son.defRatio ?? 0 },
          { label: "Weapon Passive", value: weaponPassive.defRatio ?? 0 },
        ],
        breakdown.defBase,
      ),
    ],
    [
      "HEALING BONUS",
      formatPercent(totalStats.healingBonus * 100),
      dim,
      "18px",
      pctBreakdown([
        { label: "Skill Tree", value: tree.healingBonus ?? 0 },
        { label: "Echoes", value: echoes.healingBonus ?? 0 },
        { label: "Sonata Set Bonus", value: son.healingBonus ?? 0 },
      ]),
    ],
    [
      "CRIT RATE",
      formatPercent(totalStats.critRate * 100),
      acc,
      "24px",
      pctBreakdown([
        { label: "Base", value: resonatorBase.critRate ?? 0.05 },
        { label: "Weapon", value: weaponBase.critRate ?? 0 },
        { label: "Weapon Passive", value: weaponPassive.critRate ?? 0 },
        { label: "Skill Tree", value: tree.critRate ?? 0 },
        { label: "Echoes", value: echoes.critRate ?? 0 },
        { label: "Sonata Set Bonus", value: son.critRate ?? 0 },
      ]) + critCapNote(),
    ],
    [
      "CRIT DMG",
      formatPercent(totalStats.critDmg * 100),
      acc,
      "24px",
      pctBreakdown([
        { label: "Base", value: resonatorBase.critDmg ?? 1.5 },
        { label: "Weapon", value: weaponBase.critDmg ?? 0 },
        { label: "Weapon Passive", value: weaponPassive.critDmg ?? 0 },
        { label: "Skill Tree", value: tree.critDmg ?? 0 },
        { label: "Echoes", value: echoes.critDmg ?? 0 },
        { label: "Sonata Set Bonus", value: son.critDmg ?? 0 },
      ]),
    ],
    [
      `${el.name.toUpperCase()} DMG`,
      formatPercent(elemDmg),
      el.c,
      "20px",
      pctBreakdown([
        {
          label: "Weapon Passive",
          value: weaponPassive.dmgByElement?.[resonator?.element] ?? 0,
        },
        {
          label: "Skill Tree",
          value: tree.dmgByElement?.[resonator?.element] ?? 0,
        },
        {
          label: "Echoes",
          value: echoes.dmgByElement?.[resonator?.element] ?? 0,
        },
        {
          label: "Sonata Set Bonus",
          value: son.dmgByElement?.[resonator?.element] ?? 0,
        },
      ]),
    ],
    [
      "ENERGY REGEN",
      formatPercent(totalStats.energyRegen * 100),
      dim,
      "20px",
      pctBreakdown([
        { label: "Base", value: resonatorBase.energyRegen ?? 1.0 },
        { label: "Weapon", value: weaponBase.energyRegen ?? 0 },
        { label: "Weapon Passive", value: weaponPassive.energyRegen ?? 0 },
        { label: "Echoes", value: echoes.energyRegen ?? 0 },
        { label: "Sonata Set Bonus", value: son.energyRegen ?? 0 },
      ]),
    ],
    [
      "BASIC ATK DMG",
      formatPercent((typeBonus.basic ?? 0) * 100),
      dim,
      "18px",
      skillTypeLine("basic"),
    ],
    [
      "HEAVY ATK DMG",
      formatPercent((typeBonus.heavy ?? 0) * 100),
      dim,
      "18px",
      skillTypeLine("heavy"),
    ],
    [
      "SKILL DMG",
      formatPercent((typeBonus.skill ?? 0) * 100),
      dim,
      "18px",
      skillTypeLine("skill"),
    ],
    [
      "LIBERATION DMG",
      formatPercent((typeBonus.liberation ?? 0) * 100),
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
          <span class="bv2-meta">Computed live from this build · Lv ${build.level}</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--bd);">${grid}</div>
      </div>`;
}
