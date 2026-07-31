// src/ui/components/build-editor/ability-overview.js — per-skill Ability Damage Overview table.
// Split from the monolithic build-editor-v2.js (Simplification Plan S4.2).
import { api } from "./state.js";
import { effectiveSkillMap } from "../../../core/sim.js";
import { esc } from "../../dom.js";
import { extractSkillSection, formatTimingFacts } from "../../tip-format.js";
import { formatNumber, makeDmgTarget, resonatorOf, simBuild } from "./shared.js";
import { resolveSkill, resolveSupport } from "../../../core/skill.js";
import { resolveTotalStats } from "../../../core/stats.js";

// Hover-box body for one ability: the measured timing facts first, then the
// part of the description that applies to this key. Same order as the rotation
// palette, so the two hover boxes read identically.
const abilityTipDesc = (key, def) =>
  [formatTimingFacts(def), extractSkillSection(def.desc, key, def.skillType)]
    .filter(Boolean)
    .join("\n\n");

// Ability / damage overview — the second handoff gap the maintainer flagged.
// Per-skill expected damage (resolveSkill, same math simulateRotation uses
// internally) with an expandable hit-by-hit breakdown.
export function renderAbilityDamageRow(key, def, computed) {
  const isOpen = api.dmgExpanded.has(key);
  const total = computed.totalExpected;
  const support = computed.supportOutput ?? null;
  const healTotal =
    support ?
      support
        .filter((row) => row.rowType === "heal")
        .reduce((total, row) => total + row.value, 0)
    : 0;
  const shieldTotal =
    support ?
      support
        .filter((row) => row.rowType === "shield")
        .reduce((total, row) => total + row.value, 0)
    : 0;

  const hitsHtml = computed.hits
    .map((hit, i) => {
      const result = hit.result,
        breakdown = result.breakdown;
      return `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:5px 0;font-family:var(--font-body);font-size:10.5px;">
          <span style="color:var(--faint);">Hit ${i + 1} · ${(breakdown.multiplier * 100).toFixed(1)}% ATK</span>
          <span style="color:var(--dim);">non-crit ${esc(formatNumber(result.nonCrit))}</span>
          <span style="color:var(--acc);">crit ${esc(formatNumber(result.crit))}</span>
          <span style="color:var(--txt);font-weight:600;">avg ${esc(formatNumber(result.expected))}</span>
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
        ${healTotal > 0 ? `<span style="color:var(--heal);" title="Heal per cast">♥ ${esc(formatNumber(healTotal))}</span>` : ""}
        ${shieldTotal > 0 ? `<span style="color:var(--shield);" title="Shield per cast">◆ ${esc(formatNumber(shieldTotal))}</span>` : ""}
      </div>`
    : "";

  return `<div style="border:1px solid var(--bd);border-radius:10px;background:var(--inp);overflow:hidden;">
      <div data-act="toggle-dmg-row" data-key="${esc(key)}" data-tip-title="${esc(def.label)}" data-tip-desc="${esc(abilityTipDesc(key, def))}" style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 13px;cursor:pointer;">
        <div>
          <div style="font-family:var(--font-body);font-weight:700;font-size:12.5px;color:var(--txt);">${esc(def.label)}</div>
          <div style="font-family:var(--font-display);font-size:9px;letter-spacing:.6px;color:var(--faint);">LV ${computed.skillLv} · ${computed.hits.length} HIT${computed.hits.length === 1 ? "" : "S"}</div>
        </div>
        <div style="display:flex;align-items:center;gap:12px;">
          ${supportHtml}
          ${total > 0 ? `<span style="font-family:var(--font-display);font-weight:700;font-size:15px;color:var(--acc);">${esc(formatNumber(total))}</span>` : ""}
          <span style="color:var(--faint);transition:transform .14s;transform:rotate(${isOpen ? 90 : 0}deg);">▸</span>
        </div>
      </div>
      ${isOpen ? `<div style="padding:0 13px 12px;">${hitsHtml}${envHtml}</div>` : ""}
    </div>`;
}

export function renderAbilityDamageOverview() {
  const resonator = resonatorOf();
  const skillMap = effectiveSkillMap(api.dataset, api.build.resonatorId);
  if (!skillMap) {
    return `<div class="bv2-card"><span class="bv2-card__stripe"></span>
          <div class="bv2-card__head"><div class="bv2-title"><span class="bv2-title__bar"></span><span class="bv2-title__txt">ABILITY DAMAGE OVERVIEW</span></div></div>
          <div class="bv2-stub">${esc(resonator?.name ?? "This resonator")} has no curated skill map yet, so per-ability damage is unavailable.</div>
        </div>`;
  }
  const build = simBuild(); // reflect the sonata quick-switch preview
  const stats = resolveTotalStats(build, api.dataset);
  const target = makeDmgTarget(build, api.dmgTarget);
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
        build,
        dataset: api.dataset,
        stats,
        target,
      });
      if (computed) return renderAbilityDamageRow(key, def, computed);
      if (def.supportIds?.length) {
        const supportRows = resolveSupport({
          skillDef: def,
          build,
          dataset: api.dataset,
          stats,
        });
        const healTotal = supportRows
          .filter((row) => row.rowType === "heal")
          .reduce((total, row) => total + row.value, 0);
        const shieldTotal = supportRows
          .filter((row) => row.rowType === "shield")
          .reduce((total, row) => total + row.value, 0);
        if (healTotal === 0 && shieldTotal === 0) return "";
        const skillLv =
          api.build.skillLevels?.[
            SKILL_LV_KEY[def.skillType] ?? def.skillType
          ] ?? 10;
        return `<div style="border:1px solid var(--bd);border-radius:10px;background:var(--inp);padding:10px 13px;display:flex;align-items:center;justify-content:space-between;gap:12px;" data-tip-title="${esc(def.label)}" data-tip-desc="${esc(abilityTipDesc(key, def))}">
              <div><div style="font-family:var(--font-body);font-weight:700;font-size:12.5px;color:var(--txt);">${esc(def.label)}</div><div style="font-family:var(--font-display);font-size:9px;letter-spacing:.6px;color:var(--faint);">LV ${skillLv} · SUPPORT</div></div>
              <div style="display:flex;gap:10px;font-family:var(--font-display);font-weight:700;font-size:13px;">
                ${healTotal > 0 ? `<span style="color:var(--heal);">♥ ${esc(formatNumber(healTotal))}</span>` : ""}
                ${shieldTotal > 0 ? `<span style="color:var(--shield);">◆ ${esc(formatNumber(shieldTotal))}</span>` : ""}
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
