// src/ui/components/build-editor/rotation.js — rotation palette, sequence, line chart, buff windows, donut, banners.
// Split from the monolithic build-editor-v2.js (Simplification Plan S4.2).
import { ECHO_STEP_KEY, effectiveSkillMap, resolveStepDuration, simulateRotation } from "../../../core/sim.js";
import { ELEM, GOLD, TYPE_LABEL, echoActiveSkillDesc, echoDefOf, formatNumber, fmtDps, fmtTime, referenceRotationFor, resonatorOf, simBuild, skillDescFor, stepTypeInfo, titleCase } from "./shared.js";
import { analyzeRotation, parseStage } from "../../../core/rotation-graph.js";
import { api } from "./state.js";
import { appendRotationStep, moveRotationStep } from "../../../core/build.js";
import { defaultSimTarget } from "./bind.js";
import { esc } from "../../dom.js";
import { extractSkillSection, formatTimingFacts } from "../../tip-format.js";
import { fmtPctTrim, renderBuffBar, stackBandsFromSamples } from "../buff-bar.js";
import { listRotationPresets } from "../../../data/storage.js";
import { proposeTriggeredInsert } from "../../../core/rotation-triggers.js";
import { resourceDefsForResonator, rulesForResonator, stageGrantsForResonator, stateDefsForResonator, swapInEntryForResonator } from "../../../core/rotation-rules.js";
import { underivableStacks } from "../../../core/buffs.js";

// SVG donut arc path, generic trig (no game data) — sa/ea in radians,
// oR/iR are outer/inner radius fractions of the viewBox.
export function arcPath(startAngle, endAngle, outerRadius = 0.82, innerRadius = 0.5) {
  const gap = 0.018,
    start = startAngle + gap,
    end = Math.max(endAngle - gap, start + 0.001);
  const fmt = (number) => number.toFixed(4);
  const outerStartX = outerRadius * Math.cos(start),
    outerStartY = outerRadius * Math.sin(start);
  const outerEndX = outerRadius * Math.cos(end),
    outerEndY = outerRadius * Math.sin(end);
  const innerEndX = innerRadius * Math.cos(end),
    innerEndY = innerRadius * Math.sin(end);
  const innerStartX = innerRadius * Math.cos(start),
    innerStartY = innerRadius * Math.sin(start);
  const largeArc = end - start > Math.PI ? 1 : 0;
  return `M${fmt(outerStartX)} ${fmt(outerStartY)} A${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${fmt(outerEndX)} ${fmt(outerEndY)} L${fmt(innerEndX)} ${fmt(innerEndY)} A${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${fmt(innerStartX)} ${fmt(innerStartY)}Z`;
}

// §E — family label per skillType for palette grouping, mirroring
// tools/preprocess.mjs's CATEGORY_PREFIX (kept local — v2 owns its own
// scoped display maps per the file header comment).
export const PALETTE_FAMILY_LABEL = {
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

export const PALETTE_FAMILY_ORDER = [
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

export const PALETTE_BTN_STYLE =
  "font-family:var(--font-body);font-weight:600;font-size:11px;border-radius:8px;padding:7px 11px;cursor:grab;border:1px solid var(--bd);background:var(--inp);color:var(--dim);display:flex;align-items:center;gap:7px;";

// Where a step's Cast time came from, so a measured animation time never looks
// the same as a per-type fallback (docs/TIMING_MODEL.md's required `source`).
// Silent for the common, unremarkable case — a clean extracted value.
const TIMING_PROVENANCE = {
  estimated: "estimated (no animation data — summon/DoT/field damage)",
  curated: "curated (maintainer pin, data/timing-overrides.json)",
};
const TIMING_PROVISIONAL = {
  state: "provisional — depends on a character state the sim does not track yet",
  phaseOnly: "provisional — measures one phase of the action, so it is understated",
  loop: "provisional — a held loop, so this measures ONE iteration, not the full hold",
};
function timingNote(source, provisional) {
  const note = TIMING_PROVISIONAL[provisional] ?? TIMING_PROVENANCE[source];
  return note ? `Cast time ${note}` : "";
}

export function renderPaletteButton(key, def) {
  const info = stepTypeInfo(def.skillType ?? "basic");
  const stepDuration = resolveStepDuration(def, api.dataset);
  const desc = [
    `${TYPE_LABEL[def.skillType] ?? def.skillType} · Cast ${fmtTime(stepDuration)}`,
    formatTimingFacts(def),
    timingNote(def.timingSource ?? "estimated", def.timingProvisional),
    extractSkillSection(def.desc, key, def.skillType),
  ]
    .filter(Boolean)
    .join("\n\n");
  return `<button data-act="add-step" data-key="${esc(key)}" draggable="true" data-tip-title="${esc(def.label)}" data-tip-desc="${esc(desc)}" style="${PALETTE_BTN_STYLE}">
      <span style="font-family:var(--font-display);font-weight:700;font-size:9.5px;border-radius:4px;padding:2px 6px;background:${info.bg};color:${info.c};letter-spacing:.3px;flex:none;">${info.abbr}</span>${esc(def.label)}
    </button>`;
}

// Group palette entries by skill family (header = family, body = pickable
// stages) — amends P11-ADDENDUM.md §E. Splits a family further when a stage
// key's remainder (after stripping the skillType prefix) names one of the
// resonator's STATE_DEFS states (e.g. Hiyuki's Present/Foreclaimed Self) —
// reuses existing curated data, no new table. Reuses the stage-family parser
// (parseStage) from rotation-graph.js, the same logic P11 §6a's stage-order
// validator uses.
export function groupPaletteEntries(entries, resonatorId) {
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
      const state = states.find((candidate) =>
        tokens.some((tok) => candidate.name.toLowerCase().includes(tok)),
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
  return [...groups.values()].sort((groupA, groupB) => groupA.order - groupB.order);
}

export function renderPaletteGroup(label, buttonsHtml) {
  return `<div style="display:flex;flex-direction:column;gap:6px;">
      <span style="font-family:var(--font-display);font-size:8.5px;letter-spacing:1.2px;color:var(--faint);">${esc(label.toUpperCase())}</span>
      <div style="display:flex;flex-wrap:wrap;gap:6px;">${buttonsHtml}</div>
    </div>`;
}

export function renderRotationPalette() {
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
  const groupsHtml = groups.map((group) =>
    renderPaletteGroup(
      group.label,
      group.items.map(([key, def]) => renderPaletteButton(key, def)).join(""),
    ),
  );

  if (hasEchoSkill) {
    const info = stepTypeInfo("echo");
    const echoDesc = ["Echo Skill", echoActiveSkillDesc(echoDef)]
      .filter(Boolean)
      .join("\n");
    const echoBtn = `<button data-act="add-step" data-key="${esc(ECHO_STEP_KEY)}" draggable="true" data-tip-title="${esc(echoDef.name)}" data-tip-desc="${esc(echoDesc)}" style="${PALETTE_BTN_STYLE}">
          <span style="font-family:var(--font-display);font-weight:700;font-size:9.5px;border-radius:4px;padding:2px 6px;background:${info.bg};color:${info.c};letter-spacing:.3px;flex:none;">${info.abbr}</span>Echo: ${esc(echoDef.name)}
        </button>`;
    groupsHtml.push(renderPaletteGroup("Echo Skill", echoBtn));
  }

  return `<div style="display:flex;flex-direction:column;gap:10px;">${groupsHtml.join("")}</div>`;
}

// Human copy for grant-chip kinds (analyzeRotation chips).
export const GRANT_KIND_LABEL = {
  rule: "gate met",
  after: "chained from",
  state: "licensed by",
  resource: "resource",
  swapIn: "swap-in entry",
  free: "direct entry",
  chainTag: "chain slot filled by",
};

export function renderRotationSequence(sim, grantChipByIndex = new Map()) {
  if (sim.steps.length === 0) {
    return `<div class="rot2-seq" style="display:flex;align-items:center;min-height:40px;padding:0 12px;font-family:var(--font-body);font-size:11.5px;color:var(--faint);white-space:nowrap;">Click a skill above, or drag it here, to start building the rotation.</div>`;
  }
  const skillMap = effectiveSkillMap(api.dataset, api.build.resonatorId);
  const chips = sim.steps.map((step) => {
    const info = stepTypeInfo(step.skillType);
    const statLines =
      step.missing ?
        [`Unmapped skill key — no skill-map entry for "${step.skillKey}".`]
      : [
          `${TYPE_LABEL[step.skillType] ?? step.skillType} · Cast ${fmtTime(step.stepDuration)}`
            + (step.freezeTime > 0 ? ` · Freezes the clock for ${fmtTime(step.freezeTime)}` : ""),
          formatTimingFacts(skillMap?.[step.skillKey] ?? step),
          timingNote(step.timingSource, step.timingProvisional),
          step.hitCount ?
            `${step.hitCount} hit${step.hitCount === 1 ? "" : "s"} · Crit ${formatNumber(step.stepCrit ?? 0)} / Non-crit ${formatNumber(step.stepNonCrit ?? 0)}`
          : "",
          `Step DMG ${formatNumber(step.stepDamage ?? 0)}${step.buffed ? " (buffed)" : ""} · Running total ${formatNumber(step.cumulativeDamage ?? 0)}`,
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
    // Grant chip (2026-07-05): a satisfied gate shows WHY the step is legal
    // ("chained from Intro Skill") instead of staying silent — analyzeRotation
    // chips over the curated grants/states/resources in rotation-rules.js.
    const grant = grantChipByIndex.get(step.index);
    const grantBadge =
      grant ?
        `<span data-tip-title="${esc(`${GRANT_KIND_LABEL[grant.kind] ?? "granted"}: ${grant.source}`)}" data-tip-desc="${esc(grant.note || "")}" style="font-size:10px;line-height:1;color:var(--acc);flex:none;cursor:default;">⤷</span>`
      : "";
    // Cooldown badge (2026-07-12): this cast re-fires its skill/echo group
    // before the game-data cooldown is ready (sim.js cooldown overlay).
    const cdBadge =
      step.cd?.violated ?
        `<span data-tip-title="Cooldown not ready" data-tip-desc="${esc(`Re-cast ${step.cd.deficit.toFixed(1)}s before the ${step.cd.cooldown}s cooldown is ready (blocked until ${fmtTime(step.cd.blockedUntil)}).`)}" style="font-size:10px;line-height:1;color:var(--warn);flex:none;cursor:default;">⏱</span>`
      : "";
    // §9b — collapsible hit breakdown toggle, only when there's more than
    // one hit to break down (single-hit steps don't need expansion).
    const expandBtn =
      (step.hitCount ?? 0) > 1 ?
        `<button data-act="toggle-rot-hits" data-index="${step.index}" title="Show hit breakdown" aria-expanded="${api.rotStepExpanded === step.index}" style="width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;border:none;background:transparent;color:var(--faint);cursor:pointer;font-size:10px;padding:0;transform:rotate(${api.rotStepExpanded === step.index ? 180 : 0}deg);transition:transform .14s;">▾</button>`
      : "";
    return `<div class="rot2-chip" data-index="${step.index}" draggable="true" data-tip-title="${esc(step.label)}" data-tip-desc="${esc(descLines.join("\n\n"))}" style="display:flex;flex-direction:column;gap:6px;border-radius:10px;padding:9px 11px;border:1.5px solid ${autoInserted ? "color-mix(in srgb, var(--tip-gold) 50%, transparent)" : "var(--bd)"};background:var(--inp);min-width:76px;cursor:grab;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:5px;">
            <span style="font-family:var(--font-display);font-weight:700;font-size:9.5px;border-radius:4px;padding:2px 6px;background:${info.bg};color:${info.c};letter-spacing:.3px;flex:none;">${info.abbr}</span>
            ${autoBadge}${grantBadge}${cdBadge}
            <span style="flex:1;"></span>
            ${expandBtn}
            <button data-act="remove-step" data-index="${step.index}" title="Remove" style="width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;border:none;background:transparent;color:var(--faint);cursor:pointer;font-size:13px;padding:0;">×</button>
          </div>
          <div style="font-family:var(--font-body);font-weight:600;font-size:11px;color:${step.missing ? "var(--warn)" : "var(--txt)"};white-space:nowrap;">${esc(step.missing ? "?" + step.skillKey : step.label)}</div>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
            <span style="font-family:var(--font-display);font-size:9px;color:var(--faint);">${esc(fmtTime(step.stepDuration))}</span>
            <span style="font-family:var(--font-display);font-weight:700;font-size:12px;color:${
              step.stepDamage > 0 ?
                step.buffed ?
                  GOLD
                : "var(--acc)"
              : "var(--faint)"
            };">${step.stepDamage > 0 ? formatNumber(step.stepDamage) : "—"}</span>
          </div>
        </div>`;
  });
  return `<div class="rot2-seq" style="display:flex;align-items:stretch;gap:8px;min-width:max-content;">${chips.join("")}</div>`;
}

// §9b — hit-by-hit breakdown panel for the currently expanded rotation step.
// Mirrors renderAbilityDamageRow's hit list, restyled to sit below the
// horizontally-scrolling chip rail (a single expanded detail at a time keeps
// this from fighting the chip row's own scroll position).
export function renderRotStepDetail(sim) {
  if (api.rotStepExpanded == null) return "";
  const step = sim.steps.find((candidate) => candidate.index === api.rotStepExpanded);
  const hits = step?.resolved?.hits;
  if (!hits?.length || hits.length <= 1) return "";
  const hitsHtml = hits
    .map((hit, i) => {
      const result = hit.result,
        breakdown = result.breakdown;
      return `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:5px 0;font-family:var(--font-body);font-size:10.5px;${i ? "border-top:1px solid var(--bd);" : ""}">
          <span style="color:var(--faint);">Hit ${i + 1} · ${(breakdown.multiplier * 100).toFixed(1)}% ATK</span>
          <span style="color:var(--dim);">non-crit ${esc(formatNumber(result.nonCrit))}</span>
          <span style="color:var(--acc);">crit ${esc(formatNumber(result.crit))}</span>
          <span style="color:var(--txt);font-weight:600;">avg ${esc(formatNumber(result.expected))}</span>
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

export function renderRotationLineChart(sim) {
  if (sim.steps.length === 0) return "";
  const chartWidth = 680,
    chartHeight = 150,
    padTop = 14;
  const totalTime = Math.max(sim.totals.time, 0.01);
  const totalDmg = Math.max(sim.totals.damage, 1);
  const toX = (time) => (time / totalTime) * chartWidth;
  const toY = (damage) => chartHeight - (damage / totalDmg) * chartHeight;
  const skillMap = effectiveSkillMap(api.dataset, api.build.resonatorId);

  let tAcc = 0,
    dAcc = 0,
    areaD = `M0 ${chartHeight}`,
    lineD = `M0 ${chartHeight}`;
  const dots = [];
  for (const step of sim.steps) {
    const xEnd = Math.round(toX(tAcc + step.stepDuration));
    dAcc += Math.max(step.stepDamage, 0);
    const y = Math.round(toY(dAcc));
    areaD += ` H${xEnd} V${y}`;
    lineD += ` H${xEnd} V${y}`;
    if (step.stepDamage > 0) {
      const info = stepTypeInfo(step.skillType);
      // Custom hover-box, not a native <title>, matching the rest of the
      // page (see ensureTooltipEl's comment) — Element.closest works on
      // SVG elements, so the same mouseover delegation picks this up.
      const tipDesc = [
        `${formatNumber(step.stepDamage)} · running total ${formatNumber(dAcc)}`,
        skillDescFor(step.skillKey, skillMap),
      ]
        .filter(Boolean)
        .join("\n\n");
      dots.push(
        `<circle cx="${xEnd}" cy="${y}" r="4.5" fill="${info.c}" stroke="var(--card)" stroke-width="2" data-tip-title="${esc(step.label)}" data-tip-desc="${esc(tipDesc)}"></circle>`,
      );
    }
    tAcc += step.stepDuration;
  }
  areaD += ` H${chartWidth} V${chartHeight} H0 Z`;
  lineD += ` H${chartWidth}`;

  const tickN = Math.min(8, Math.max(2, Math.ceil(totalTime / 2)));
  const ticks = Array.from({ length: tickN + 1 }, (_, i) => {
    const time = (i / tickN) * totalTime;
    return `<line x1="${((i / tickN) * chartWidth).toFixed(0)}" y1="${chartHeight}" x2="${((i / tickN) * chartWidth).toFixed(0)}" y2="${chartHeight + 6}" stroke="var(--bd2)" stroke-width="1"></line>
                <text x="${((i / tickN) * chartWidth).toFixed(0)}" y="${chartHeight + 18}" text-anchor="middle" font-size="9" fill="var(--faint)" font-family="'Chakra Petch',monospace">${time.toFixed(0)}s</text>`;
  }).join("");

  return `<div style="position:relative;">
      <div style="position:absolute;top:0;left:0;font-family:var(--font-display);font-size:9px;color:var(--faint);">${esc(formatNumber(totalDmg))}</div>
      <svg width="100%" viewBox="0 -${padTop} ${chartWidth} ${chartHeight + 30}" style="display:block;overflow:visible;">
        <line x1="0" y1="${chartHeight * 0.25}" x2="${chartWidth}" y2="${chartHeight * 0.25}" stroke="var(--bd)" stroke-width="1" stroke-dasharray="4,4"></line>
        <line x1="0" y1="${chartHeight * 0.5}" x2="${chartWidth}" y2="${chartHeight * 0.5}" stroke="var(--bd)" stroke-width="1" stroke-dasharray="4,4"></line>
        <line x1="0" y1="${chartHeight * 0.75}" x2="${chartWidth}" y2="${chartHeight * 0.75}" stroke="var(--bd)" stroke-width="1" stroke-dasharray="4,4"></line>
        <defs><linearGradient id="bv2-rot-grad" x1="0" y1="0" x2="0" y2="${chartHeight}" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="var(--acc)" stop-opacity="0.28"></stop>
          <stop offset="100%" stop-color="var(--acc)" stop-opacity="0.02"></stop>
        </linearGradient></defs>
        <path d="${areaD}" fill="url(#bv2-rot-grad)"></path>
        <path d="${lineD}" fill="none" stroke="var(--acc)" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter"></path>
        <line x1="0" y1="${chartHeight}" x2="${chartWidth}" y2="${chartHeight}" stroke="var(--bd2)" stroke-width="1"></line>
        ${dots.join("")}
        ${ticks}
      </svg>
    </div>`;
}

export const BUFF_TRIGGER_LABEL = {
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
// Adapts a rich window's per-step stacksByStepIndex map (keyed by sim.steps'
// own index) into the {start,end,stacks} sample shape stackBandsFromSamples
// (buff-bar.js, shared with team-editor-v2.js) expects.
export function stackBandsFor(window, steps, winStart, winEnd) {
  const samples = steps.map((step) => ({ start: step.startTime, end: step.endTime, stacks: window.stacksByStepIndex[step.index] ?? 0 }));
  return stackBandsFromSamples(samples, winStart, winEnd);
}

// Short display label for a chain/inherent effect ("+60% ATK", "+30% Glacio DMG").
export const EFFECT_STAT_LABEL = {
  dmgBonus: "DMG Bonus",
  amplify: "Amplify",
  deepen: "DMG Deepen",
  atkRatio: "ATK",
  critRate: "Crit Rate",
  critDmg: "Crit DMG",
  healingBonus: "Healing Bonus",
  multiplierUp: "Multiplier",
};

export function effectStripLabel(effect) {
  if (!effect) return "Effect";
  const pct = `+${(Math.round((effect.value ?? 0) * 1000) / 10).toFixed(0)}%`;
  if (effect.stat === "elementBonus" && effect.element) {
    return `${pct} ${ELEM[effect.element]?.name ?? "Element"} DMG`;
  }
  if (effect.stat === "skillTypeBonus" && effect.skillType) {
    return `${pct} ${TYPE_LABEL[effect.skillType] ?? effect.skillType} DMG`;
  }
  return `${pct} ${EFFECT_STAT_LABEL[effect.stat] ?? effect.stat}`;
}

export function renderBuffWindows(sim) {
  const totalTime = Math.max(sim.totals.time, 0.01);
  const windows = (sim.buffWindows ?? []).filter((window) => window.bonusPct > 0);
  const effectWins = sim.effectWindows ?? [];
  const stateWins = sim.stateWindows ?? [];
  if (windows.length === 0 && effectWins.length === 0 && stateWins.length === 0)
    return "";

  const strips = windows.map((window) => {
    const end = Math.min(window.end, totalTime);
    const clipped = window.end > totalTime;
    const durLabel = (clipped ? "> " : "") + fmtTime(window.end - window.start);

    // Stack ramp (Phase A): a stacking buff carries per-step stack counts.
    // Turn them into height-encoded time bands + a ramped-range label so the
    // ramp/decay is visible instead of a flat "+10%" block.
    const maxStacks =
      window.stacksByStepIndex ?
        Math.max(0, ...Object.values(window.stacksByStepIndex))
      : 1;
    const stacking = maxStacks > 1;
    const stackBands =
      stacking ? stackBandsFor(window, sim.steps, window.start, end) : null;
    let name = window.label;
    let meta = durLabel;
    if (stacking) {
      const perPct = fmtPctTrim(window.bonusPct * 100);
      const maxPct = fmtPctTrim(window.bonusPct * maxStacks * 100);
      // Rewrite the leading "+10%" headline into a "+10→30%" range.
      name = window.label.replace(/^\+?\d+(?:\.\d+)?\s*%/, `+${perPct}→${maxPct}%`);
      meta = `×${maxStacks} · ${durLabel}`;
    }
    return {
      name,
      start: window.start,
      end,
      stackBands,
      // Mirror shortBuffLabel's precedence (sim.js): a buff whose headline
      // number is ATK/element-scoped is labelled (and coloured) as that,
      // even if its raw text also mentions an unrelated dmg-type phrase
      // elsewhere (e.g. Lingering Tunes' "+5% ATK ... Outro Skill DMG +60%").
      elementColor:
        window.bonusKind === "element" && window.element ? ELEM[window.element]?.c : null,
      dmgType: window.bonusKind === "atk" ? null : (window.dmgType ?? null),
      eyebrow: `${BUFF_TRIGGER_LABEL[window.trigger] ?? "Effect"} — ${window.sonataName}`,
      meta,
      tipTitle: `${BUFF_TRIGGER_LABEL[window.trigger] ?? "Effect"} — ${window.sonataName}`,
      tipDesc: `${name} · ${meta}\n${window.raw ?? ""}`,
    };
  });

  // Kit-effect strips (2026-07-05): conditional chain/inherent effect windows
  // from the sim (trigger × window model) — each names its slot key and how it
  // ended ('consumed' / 'expired' / …), so conditions are VISIBLE, not silent.
  const skillMapForLabels = effectiveSkillMap(api.dataset, api.build.resonatorId);
  const keyLabel = (k) => skillMapForLabels?.[k]?.label ?? k;
  for (const window of effectWins) {
    const end = Math.min(window.end, totalTime);
    const slot = String(window.key).startsWith("S") ?
        `Chain ${String(window.key).split(".")[0]}`
      : "Inherent";
    strips.push({
      name: effectStripLabel(window.effect),
      start: window.start,
      end,
      elementColor: window.effect?.element ? ELEM[window.effect.element]?.c : null,
      dmgType: window.effect?.skillType ?? null,
      eyebrow: `KIT · ${slot}`,
      meta: `${fmtTime(end - window.start)} · ${window.endReason}`,
      tipTitle: `${slot} effect — ${effectStripLabel(window.effect)}`,
      tipDesc: `${window.effect?.condition ?? ""}\nWindow: steps ${window.startStep + 1}–${window.endStep + 1} · ${window.endReason}`,
    });
  }

  // State strips: stances/licenses with their CONSUMER named ("consumed by
  // Final Act — Breakdown Form"), the piece that makes state flow inspectable.
  for (const window of stateWins) {
    const end = Math.min(window.end, totalTime);
    const endLabel =
      window.consumedBy ? `consumed by ${keyLabel(window.consumedBy)}` : window.endReason;
    strips.push({
      name: titleCase(window.name),
      start: window.start,
      end,
      elementColor: GOLD,
      eyebrow: "STATE",
      meta: `${fmtTime(end - window.start)} · ${endLabel}`,
      tipTitle: `State — ${titleCase(window.name)}`,
      tipDesc: `Active steps ${window.startStep + 1}–${window.endStep + 1}\n${endLabel}`,
    });
  }

  const bar = renderBuffBar(strips, totalTime, { rowH: 34, gap: 5 });
  return `<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--bd);">
      <div style="font-family:var(--font-display);font-size:8px;letter-spacing:1.5px;color:var(--faint);margin-bottom:7px;">BUFF WINDOWS · KIT EFFECTS · STATES</div>
      ${bar}
    </div>`;
}

// Stack counts the rotation cannot derive (buffs.js underivableStacks): a Havoc
// Bane count on the target, how many distinct teammates cast an Echo Skill, a
// gauge with no curated definition. The sim credits ONE stack for these and says
// so here rather than silently assuming a number — the row exists so the user
// can supply the real count, which then outranks everything (scaleEffect §1).
export function renderStackStepper() {
  const rows = underivableStacks(api.build, resonatorOf());
  if (rows.length === 0) return "";

  const cells = rows
    .map((row) => {
      const capLabel = row.maxStacks != null ? `/ ${row.maxStacks}` : "";
      const atMax = row.maxStacks != null && row.stacks >= row.maxStacks;
      const total = effectStripLabel({ ...row, value: row.perStack * row.stacks });
      const per = effectStripLabel({ ...row, value: row.perStack });
      const assumed = row.stacksSource === "unknown";
      return `
        <div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-top:1px solid var(--bd);">
          <div style="min-width:0;flex:1;">
            <div style="font-family:var(--font-body);font-size:11px;color:var(--txt);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              ${esc(total)}
              <span style="color:var(--faint);"> · ${esc(per)} per stack</span>
            </div>
            <div style="font-family:var(--font-body);font-size:10px;color:var(--faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${esc(row.condition)}">
              ${esc(row.key)} — ${esc(row.condition)}
            </div>
          </div>
          ${
            assumed ?
              `<span style="font-family:var(--font-display);font-size:8px;letter-spacing:1px;color:var(--faint);border:1px solid var(--bd);border-radius:4px;padding:2px 5px;white-space:nowrap;" title="The rotation does not describe this stack count. The sim is crediting one stack.">ASSUMED 1</span>`
            : ""
          }
          <div style="display:flex;align-items:center;gap:4px;">
            <button data-act="stacks-dec" data-key="${esc(row.key)}" ${row.stacks <= 0 ? "disabled" : ""}
              style="width:20px;height:20px;border:1px solid var(--bd);border-radius:4px;background:var(--inp);color:var(--dim);font-size:12px;line-height:1;cursor:pointer;${row.stacks <= 0 ? "opacity:.4;cursor:not-allowed;" : ""}" title="One fewer stack">−</button>
            <span style="font-family:var(--font-display);font-size:11px;color:${assumed ? "var(--faint)" : "var(--acc)"};min-width:34px;text-align:center;">${row.stacks}${esc(capLabel)}</span>
            <button data-act="stacks-inc" data-key="${esc(row.key)}" ${atMax ? "disabled" : ""}
              style="width:20px;height:20px;border:1px solid var(--bd);border-radius:4px;background:var(--inp);color:var(--dim);font-size:12px;line-height:1;cursor:pointer;${atMax ? "opacity:.4;cursor:not-allowed;" : ""}" title="One more stack">+</button>
            <button data-act="stacks-clear" data-key="${esc(row.key)}" ${assumed ? "disabled" : ""}
              style="margin-left:2px;border:1px solid var(--bd);border-radius:4px;background:var(--inp);color:var(--dim);font-family:var(--font-display);font-size:8px;letter-spacing:1px;padding:3px 5px;cursor:pointer;${assumed ? "opacity:.4;cursor:not-allowed;" : ""}" title="Clear your count and let the engine decide again">RESET</button>
          </div>
        </div>`;
    })
    .join("");

  return `<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--bd);">
      <div style="font-family:var(--font-display);font-size:8px;letter-spacing:1.5px;color:var(--faint);margin-bottom:2px;">STACK COUNTS THE ROTATION CAN'T DERIVE</div>
      <div style="font-family:var(--font-body);font-size:10px;color:var(--faint);line-height:1.5;margin-bottom:4px;">
        These stacks come from something the rotation doesn't describe — an enemy's status count, which teammates you brought, or a gauge with no definition yet. One stack is assumed until you set a count.
      </div>
      ${cells}
    </div>`;
}

export function renderRotationDonut(sim) {
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
  segs.sort((segmentA, segmentB) => segmentB.dmg - segmentA.dmg);

  let acc = -Math.PI / 2;
  const arcs = segs
    .map((segment) => {
      const span = segment.pct * Math.PI * 2;
      const path = arcPath(acc, acc + span);
      acc += span;
      const label =
        TYPE_LABEL[segment.type] ?? (segment.type === "other" ? "Other" : segment.type);
      return `<path d="${path}" fill="${segment.c}" opacity="0.88" data-tip-title="${esc(label)}" data-tip-desc="${esc(`${Math.round(segment.pct * 100)}% · ${formatNumber(segment.dmg)} damage`)}" style="cursor:default;"></path>`;
    })
    .join("");

  return `<div style="padding:16px 18px 18px;display:flex;flex-direction:column;align-items:center;gap:10px;">
      <span style="font-family:var(--font-display);font-size:9px;letter-spacing:1.5px;color:var(--faint);align-self:flex-start;">DMG BREAKDOWN</span>
      <svg width="220" height="220" viewBox="-1.1 -1.1 2.2 2.2" style="display:block;">${arcs}</svg>
      <div style="text-align:center;">
        <div style="font-family:var(--font-display);font-weight:700;font-size:17px;color:var(--txt);line-height:1.1;">${esc(formatNumber(sim.totals.damage))}</div>
        <div style="font-family:var(--font-display);font-size:9px;letter-spacing:1px;color:var(--faint);margin-top:2px;">TOTAL · ${esc(fmtDps(sim.totals.dps))}/s</div>
      </div>
      <span style="font-family:var(--font-body);font-size:10px;color:var(--faint);text-align:center;">Hover segments for breakdown</span>
    </div>`;
}

// §7b — dismissible notice for the most recent auto-triggered insert.
export function renderAutoInsertNotice() {
  const notice = api.autoInsertNotice;
  if (!notice) return "";
  return `<div style="display:flex;align-items:center;gap:8px;background:color-mix(in srgb, var(--acc) 10%, transparent);border:1px solid color-mix(in srgb, var(--acc) 35%, transparent);border-radius:8px;padding:7px 10px;margin-bottom:9px;">
      <span style="color:var(--acc);font-size:12px;flex:none;">⚡</span>
      <span style="font-family:var(--font-body);font-size:10.5px;color:var(--acc);flex:1;min-width:0;">Auto-inserted: ${esc(notice.label)}. ${esc(notice.note)}</span>
      <button data-act="dismiss-auto-notice" title="Dismiss" style="border:none;background:transparent;color:var(--acc);cursor:pointer;font-size:13px;line-height:1;flex:none;">×</button>
    </div>`;
}

// §9d — per-warning "Fix it" banner (replaces the old generic warning count).
export function renderValidationBanner(warnings) {
  if (!warnings.length) return "";
  const items = warnings
    .map(
      (warning, i) => `
      <div style="display:flex;align-items:center;gap:8px;${i ? "margin-top:6px;padding-top:6px;border-top:1px solid color-mix(in srgb, var(--gold) 25%, transparent);" : ""}">
        <span style="color:var(--warn);font-size:12px;flex:none;">⚠</span>
        <span style="font-family:var(--font-body);font-size:10.5px;color:var(--warn);flex:1;min-width:0;">${esc(warning.note)}</span>
        <button data-act="fix-warning" data-warn-index="${i}" title="Reorder to resolve this warning" style="font-family:var(--font-display);font-weight:700;font-size:9.5px;letter-spacing:.6px;color:var(--on-warn);background:var(--warn);border:none;border-radius:6px;padding:5px 10px;cursor:pointer;flex:none;">FIX</button>
      </div>`,
    )
    .join("");
  return `<div style="background:color-mix(in srgb, var(--gold) 10%, transparent);border:1px solid color-mix(in srgb, var(--gold) 40%, transparent);border-radius:8px;padding:7px 10px;margin-bottom:9px;">${items}</div>`;
}

// Cooldown-violation banner (2026-07-12): casts that re-fire a skill/echo
// group before its game-data cooldown is ready (sim.js cooldown overlay).
// No FIX action — resolving means re-spacing or removing casts, a judgment
// call left to the user; the per-chip ⏱ badge marks the exact step.
export function renderCooldownBanner(violations) {
  if (!violations?.length) return "";
  const items = violations
    .map(
      (violation, i) => `
      <div style="display:flex;align-items:center;gap:8px;${i ? "margin-top:6px;padding-top:6px;border-top:1px solid color-mix(in srgb, var(--gold) 25%, transparent);" : ""}">
        <span style="color:var(--warn);font-size:12px;flex:none;">⏱</span>
        <span style="font-family:var(--font-body);font-size:10.5px;color:var(--warn);flex:1;min-width:0;">${esc(`${violation.label} (step ${violation.index + 1}) re-casts ${violation.deficit.toFixed(1)}s before its cooldown is ready`)}</span>
      </div>`,
    )
    .join("");
  return `<div style="background:color-mix(in srgb, var(--gold) 10%, transparent);border:1px solid color-mix(in srgb, var(--gold) 40%, transparent);border-radius:8px;padding:7px 10px;margin-bottom:9px;">${items}</div>`;
}

// §7b — after appending/moving a step into `rotation` at `addedIndex`, check
// rotation-triggers.js for a forced follow-up and insert it (tagged
// autoInserted in rotationMeta) immediately after. No-op when no rule matches.
export function applyAutoTrigger(build, addedIndex) {
  const prop = proposeTriggeredInsert(
    build.resonatorId,
    build.rotation,
    addedIndex,
  );
  if (!prop) return build;
  let updated = appendRotationStep(build, prop.skillKey, { autoInserted: true });
  updated = moveRotationStep(updated, updated.rotation.length - 1, prop.insertAt);
  const skillMap = effectiveSkillMap(api.dataset, build.resonatorId);
  api.autoInsertNotice = {
    label: skillMap?.[prop.skillKey]?.label ?? prop.skillKey,
    note: prop.note,
  };
  return updated;
}

// §9d — compute what a warning's "Fix" button should do: move the flagged
// step to just after its first already-present requirement, or (if no
// requirement is present anywhere in the rotation yet) insert the first
// missing one immediately before the flagged step. Stage-ordering warnings
// (gate:'sequence') carry no `requires` — derive the needed prior stage key
// from the flagged key itself via the same stage parser used elsewhere.
export function computeFixTarget(build, warning) {
  let neededKey = null;
  if (warning.requires?.length) {
    const present = warning.requires.find((req) =>
      build.rotation.includes(req),
    );
    if (present) return { mode: "move", afterKey: present };
    neededKey = warning.requires[0];
  } else {
    const stage = parseStage(warning.skillKey);
    if (stage && stage.stage > 1) neededKey = `${stage.family}_${stage.stage - 1}`;
  }
  if (!neededKey) return null;
  return build.rotation.includes(neededKey) ?
      { mode: "move", afterKey: neededKey }
    : { mode: "insert", key: neededKey };
}

export function applyFix(build, warning) {
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
  let updated = appendRotationStep(build, target.key, { autoInserted: false });
  return moveRotationStep(updated, updated.rotation.length - 1, warning.index);
}

export function renderRotation() {
  const resonator = resonatorOf();
  const skillMap = effectiveSkillMap(api.dataset, api.build.resonatorId);
  if (!skillMap) {
    return `<div class="bv2-card"><span class="bv2-card__stripe"></span>
          <div class="bv2-card__head"><div class="bv2-title"><span class="bv2-title__bar"></span><span class="bv2-title__txt">ROTATION</span></div></div>
          <div class="bv2-stub">${esc(resonator?.name ?? "This resonator")} has no curated skill map yet, so rotation simulation is unavailable.</div>
        </div>`;
  }

  const sim = simulateRotation({
    build: simBuild(), // reflect the sonata quick-switch preview
    dataset: api.dataset,
    target: defaultSimTarget(api.build),
  });
  api.lastSim = sim;
  // Grant-aware analysis: warnings for genuinely un-gated steps, chips naming
  // WHY a satisfied gate is legal (curated grants / states / resources /
  // swap-in entry — rotation-rules.js).
  const rid = api.build.resonatorId;
  const { warnings, chips: grantChips } = analyzeRotation(
    api.build.rotation ?? [],
    {
      rules: rulesForResonator(rid),
      skillMap,
      grants: stageGrantsForResonator(rid),
      swapInEntry: swapInEntryForResonator(rid),
      resourceDefs: resourceDefsForResonator(rid),
      stateDefs: stateDefsForResonator(rid),
    },
  );
  api.lastWarnings = warnings;
  const grantChipByIndex = new Map(grantChips.map((chip) => [chip.index, chip]));

  return `
      <div class="bv2-card">
        <span class="bv2-card__stripe"></span>
        <div class="bv2-card__head">
          <div class="bv2-title"><span class="bv2-title__bar"></span><span class="bv2-title__txt">ROTATION</span><span style="width:1px;height:16px;background:var(--bd);margin:0 4px;"></span><span style="font-family:var(--font-body);font-size:13px;font-weight:600;color:var(--dim);">${esc(resonator?.name ?? "—")}</span></div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <div style="display:flex;gap:5px;">
              <div style="background:var(--inp);border:1px solid var(--bd);border-radius:8px;padding:5px 12px;display:flex;flex-direction:column;align-items:center;gap:1px;"><span style="font-family:var(--font-display);font-size:8px;letter-spacing:1px;color:var(--faint);">TIME</span><span style="font-family:var(--font-display);font-weight:700;font-size:14px;color:var(--txt);">${esc(fmtTime(sim.totals.time))}</span></div>
              <div style="background:var(--inp);border:1px solid var(--bd);border-radius:8px;padding:5px 12px;display:flex;flex-direction:column;align-items:center;gap:1px;"><span style="font-family:var(--font-display);font-size:8px;letter-spacing:1px;color:var(--faint);">ROTATION DMG</span><span style="font-family:var(--font-display);font-weight:700;font-size:14px;color:var(--acc);">${esc(formatNumber(sim.totals.damage))}</span></div>
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
          ${renderCooldownBanner(sim.cooldownViolations)}
          <div style="overflow-x:auto;">${renderRotationSequence(sim, grantChipByIndex)}</div>
          ${renderRotStepDetail(sim)}
        </div>

        ${
          sim.steps.length ?
            `<div style="display:grid;grid-template-columns:1fr 290px;align-items:start;">
          <div style="padding:16px 18px 18px;border-right:1px solid var(--bd);">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;"><span style="font-family:var(--font-display);font-size:9px;letter-spacing:1.5px;color:var(--faint);">CUMULATIVE DAMAGE OVER TIME</span></div>
            ${renderRotationLineChart(sim)}
            ${renderBuffWindows(sim)}
            ${renderStackStepper()}
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
