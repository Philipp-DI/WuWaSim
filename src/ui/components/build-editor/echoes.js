// src/ui/components/build-editor/echoes.js — echo rail, echo editor, substat rows/groups, sonata strip.
// Split from the monolithic build-editor-v2.js (Simplification Plan S4.2).
import { COST_BUDGET, mainStatValueFor, mainStatsForCost, possibleRollsFor, subMainStatFor, totalEchoCost, unlockedSubStatCount } from "../../../core/echo-rules.js";
import { ECHO_SLOTS } from "../../../core/build.js";
import { GOLD, ROLL_SCALE, SONATA_SWITCH_ARROW, SUBSTAT_ABBR, SUBSTAT_GROUPS, SUBSTAT_ROW_META, echoActiveSkillDesc, echoDefOf, fmtSub, rollColorFor, sonataIconHtml, sonataOf, sonataTooltipDesc } from "./shared.js";
import { api } from "./state.js";
import { dynamicIconHtml } from "../../icons.js";
import { esc } from "../../dom.js";
import { listEchoPresets } from "../../../data/storage.js";
import { liveAnalysis, liveValueMap } from "./stat-priority.js";
import { substatKeyOf } from "../../../core/live-weights.js";

// Left-rail echo slot card (echopanel-v2 handoff). Collapsed cards show the
// icon/name/main-stat chip + slotted substat chips + a "+level · n/5" footer;
// the SELECTED card instead grows its icon and shows a live level slider,
// plus the connector ("neck") bridging it into the editor frame on its right
// — see squareEchoFrameCorners() for the runtime corner-squaring this needs.
export function renderEchoSlotCard(i, echo) {
  const isMain = i === 0;
  const targetCost =
    i === 0 ? 4
    : i <= 2 ? 3
    : 1;
  const accent = isMain ? GOLD : "var(--acc)";
  const tag = isMain ? "MAIN ECHO" : `SLOT ${i + 1}`;
  const tagStyle = `font-family:var(--font-body);font-size:8px;letter-spacing:1.4px;color:${isMain ? GOLD : "var(--faint)"};padding-left:2px;`;

  if (!echo) {
    return `<div style="display:flex;flex-direction:column;gap:6px;"><span style="${tagStyle}">${tag}</span>
          <button data-act="pick-echo" data-slot="${i}" data-cost="${targetCost}" style="width:100%;min-height:72px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;cursor:pointer;border-radius:12px;border:1.5px dashed var(--bd2);background:var(--node);">
            <span style="font-size:24px;font-weight:300;line-height:1;color:var(--faint);">+</span>
            <span style="font-family:var(--font-display);font-size:9px;letter-spacing:1px;color:var(--faint);">ADD ECHO</span>
          </button>
        </div>`;
  }

  const def = echoDefOf(echo);
  const sonata = sonataOf(echo.sonataId);
  const sonataClickable =
    (def?.sonataIds ?? []).filter((id) => id != null).length > 1;
  const unlocked = unlockedSubStatCount(echo.level);
  const mainOpt = mainStatsForCost(echo.cost, api.dataset).find(
    (option) =>
      echo.mainStat &&
      option.propId === echo.mainStat.propId &&
      option.addType === echo.mainStat.addType,
  );
  const mainLabel = mainOpt?.name ?? echo.mainStat?.name ?? "— no main stat";
  const mainVal =
    echo.mainStat ? fmtSub(echo.mainStat.value, echo.mainStat.isPercent) : "";
  const sel = api.echoSlot === i;
  const iconSize = sel ? 48 : 48;

  const subChips = (echo.subStats ?? [])
    .map((sub, subIndex) => {
      const flagged = subIndex >= unlocked;
      const rolls = possibleRollsFor(sub, api.dataset.statRanges);
      const index = rolls.indexOf(sub.value);
      const col = index >= 0 ? rollColorFor(index, rolls.length) : ROLL_SCALE[0];
      return `<span title="${esc(sub.name)} +${esc(fmtSub(sub.value, sub.isPercent))}" style="font-family:var(--font-display);font-weight:700;font-size:9px;border-radius:5px;padding:2px 6px;color:${flagged ? "var(--warn)" : col.c};background:${flagged ? "color-mix(in srgb, var(--gold) 14%, transparent)" : col.bg};">${esc(SUBSTAT_ABBR[sub.name] ?? sub.name.slice(0, 3))}</span>`;
    })
    .join("");

  const skillDesc = echoActiveSkillDesc(def);
  // Flag the echo with the most upgrade headroom (lowest-value substats) so the
  // user can see at a glance which one to re-roll first.
  const isWorst = liveAnalysis()?.worstSlot === i;
  const worstBadge =
    isWorst ?
      `<span title="Most upgrade headroom — its substats add the least damage." style="font-family:var(--font-body);font-weight:500;font-size:9px;letter-spacing:.6px;color:var(--warn);border:1px solid var(--warn);border-radius:4px;padding:0px 4px;margin-left:2px;">↑ MOST TO GAIN</span>`
    : "";
  const cardClass = `bv2-echo-card${sel ? (isMain ? " is-selected-main" : " is-selected") : ""}`;

  return `<div style="display:flex;flex-direction:column;gap:2px;">
      <div class="${cardClass}" data-act="select-echo" data-slot="${i}" role="button" tabindex="0" title="${esc(def?.name || "Unknown echo")}">
        ${sel ? `<span class="bv2-echo-neck" style="--ec:${accent};"></span>` : ""}
        <div style="position:absolute;top:9px;right:9px;display:flex;gap:4px;z-index:2;">
          <span data-act="remove-echo" data-slot="${i}" title="Remove Echo" role="button" style="width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;font-size:9px;border-radius:5px;border:1px solid var(--warn);background:var(--card2);color:var(--warn);flex:none;cursor:pointer;">✕</span>
        </div>
        <div style="display:flex;align-items:flex-start;gap:6px;min-width:0;">
          <span data-act="switch-echo" data-slot="${i}" data-tip-title="${esc(def?.name || "Unknown echo")}" data-tip-desc="${esc(skillDesc ? `Active Skill: ${skillDesc}` : "")}" style="width:${iconSize}px;height:${iconSize}px;flex:none;border-radius:8px;border:1px solid var(--bd2);overflow:hidden;display:inline-flex;align-items:center;justify-content:center;background:var(--node);cursor:pointer;transition:width .14s,height .14s;">${dynamicIconHtml(def?.iconUrl, { label: def?.name, size: iconSize })}</span>
          <div style="display:flex;flex-direction:column;gap:4px;min-width:0;flex:1;">
            <div style="display:flex;flex-direction:row;align-items:center;gap:8px;min-width:0;">
              <span style="display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;flex:none;border-radius:25%;font-family:var(--font-display);font-weight:700;font-size:12px;border:2.5px solid ${isMain ? GOLD : "var(--bd2)"};color:${isMain ? GOLD : "var(--dim)"};background:${isMain ? "color-mix(in srgb, var(--gold) 12%, transparent)" : "var(--node)"};">${echo.cost}</span>
              ${sonata ? `<span ${sonataClickable ? `data-act="sonata-menu" data-slot="${i}"` : ""} data-tip-title="${esc(sonata.name)}" data-tip-desc="${esc(sonataTooltipDesc(echo.sonataId))}" style="display:inline-flex;align-items:center;justify-content:center;gap:1px;height:26px;flex:none;cursor:${sonataClickable ? "pointer" : "default"};">${sonataIconHtml(echo.sonataId, 26)}${sonataClickable ? SONATA_SWITCH_ARROW : ""}</span>` : ""}
              <span>${worstBadge}</span>
            </div>
            <div style="position:relative;min-width:0;font-family:var(--font-display);font-weight:700;font-size:12px;color:var(--txt);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(def?.name || "Unknown echo")}
              <span style="position:absolute;bottom:0;right:0;font-family:var(--font-display);font-size:10px;text-align:right;color:var(--faint);">+${echo.level} · ${(echo.subStats ?? []).length}/5</span>
            </div>
          </div>
        </div>
        <div style="font-family:var(--font-body);font-weight:700;font-size:12px;color:${accent};background:${isMain ? "color-mix(in srgb, var(--gold) 10%, transparent)" : "color-mix(in srgb, var(--acc) 10%, transparent)"};border:1px solid ${isMain ? "color-mix(in srgb, var(--gold) 40%, transparent)" : "color-mix(in srgb, var(--acc) 35%, transparent)"};border-radius:7px;padding:5px 8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(mainLabel)}<span style="color:var(--faint);font-weight:400;"> ${esc(mainVal)}</span></div>
        ${
          sel ?
            `<div style="display:flex;align-items:center;gap:8px;">
               <span style="font-family:var(--font-display);font-size:9px;letter-spacing:1px;color:var(--faint);">LVL</span>
               <input class="bv2-slider" type="range" min="0" max="25" step="5" value="${echo.level}" data-act="echo-level" data-slot="${i}" style="--pct:${Math.round((echo.level / 25) * 100)}%;flex:1;">
               <span data-disp="echo-level:${i}" style="font-family:var(--font-body);font-weight:700;font-size:14px;color:var(--acc);min-width:28px;text-align:right;">${echo.level}<span style="font-size:9px;color:var(--faint);font-weight:400;">/25</span></span>
             </div>`
          : `<div style="display:flex;flex-direction:column;gap:6px;width:100%;">
               <div style="display:flex;flex-wrap:wrap;gap:4px;min-height:18px;">${subChips}</div>
             </div>`
        }
      </div>
    </div>`;
}

export function renderSubstatTally() {
  const totals = new Map();
  for (const echo of api.build.echoes) {
    for (const sub of echo?.subStats ?? [])
      totals.set(sub.name, (totals.get(sub.name) ?? 0) + sub.value);
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
    .sort((entryA, entryB) => ORDER.indexOf(entryA[0]) - ORDER.indexOf(entryB[0]))
    .map(([name, tot]) => {
      const opt = api.dataset.echoSubStats.find((candidate) => candidate.name === name);
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
export function dominantSonataId(echoes) {
  const counts = new Map();
  for (const echo of echoes ?? []) {
    if (echo?.sonataId != null)
      counts.set(echo.sonataId, (counts.get(echo.sonataId) ?? 0) + 1);
  }
  let best = null,
    bestN = 0;
  for (const [id, count] of counts)
    if (count > bestN) {
      best = id;
      bestN = count;
    }
  return best;
}

// Tier-driven, like the stats engine and sonataTooltipDesc: a chip per tier
// the SET defines, lit when the equipped count satisfies it. Handles classic
// 2PC/5PC sets, the 3PC-only sets, and the 1PC collab set (Shadow of Shattered
// Dreams) — a hardcoded 2/5 layout mislit 3PC sets and hid the 1PC set.
export function renderSonataStrip() {
  // Piece-count credit requires DISTINCT echo species within the set (real
  // game rule, maintainer-confirmed 2026-07-12) — mirrors stats.js's
  // sonataCounts so the strip never shows a tier lit that the sim doesn't
  // actually grant.
  const counts = new Map();
  const seenBySonata = new Map();
  for (const echo of api.build.echoes) {
    if (echo?.sonataId == null) continue;
    const seen = seenBySonata.get(echo.sonataId) ?? new Set();
    seenBySonata.set(echo.sonataId, seen);
    if (echo.id == null || !seen.has(echo.id)) {
      counts.set(echo.sonataId, (counts.get(echo.sonataId) ?? 0) + 1);
      if (echo.id != null) seen.add(echo.id);
    }
  }

  const pcStyle = (on) =>
    `font-family:var(--font-display);font-weight:700;font-size:8.5px;letter-spacing:.5px;border-radius:5px;padding:4px 6px 2px 6px;border:1px solid ${on ? "var(--acc)" : "var(--bd)"};color:${on ? "var(--acc)" : "var(--faint)"};background:${on ? "color-mix(in srgb, var(--acc) 12%, transparent)" : "transparent"};`;
  const groups = [...counts.entries()]
    .map(([sonataId, count]) => {
      const sonata = sonataOf(sonataId);
      const tiers = (sonata?.tiers ?? [])
        .slice()
        .sort((tierA, tierB) => tierA.pieces - tierB.pieces);
      // Quiet until the set's lowest tier is reached (2 for classic sets,
      // 3 for the 3PC-only sets, 1 for the collab set).
      if (!tiers.length || count < tiers[0].pieces) return "";
      const chips = tiers
        .map(
          (tier) =>
            `<div style="display:flex;align-items:center;gap:7px;"><span style="${pcStyle(count >= tier.pieces)}">${tier.pieces}PC</span></div>`,
        )
        .join("");
      return `<div style="display:flex;align-items:center;gap:14px;background:var(--inp);border:1px solid var(--bd);border-radius:9px;padding:6px 13px;flex-wrap:wrap;">
          <div style="display:flex;align-items:center;gap:8px;">
            <span data-tip-title="${esc(sonata.name)}" data-tip-desc="${esc(sonataTooltipDesc(sonataId))}" style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;flex:none;cursor:default;">${sonataIconHtml(sonataId, 22)}</span>
            <span style="font-family:var(--font-body);font-weight:700;font-size:12px;color:var(--txt);white-space:nowrap;">${esc(sonata.name)} ×${count}</span>
          </div>
          ${chips}
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
export function renderSubstatsHeader(echo, slotIndex) {
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
export function renderSubstatRow(echo, opt, slotIndex, unlocked, liveMap) {
  const meta = SUBSTAT_ROW_META[opt.name] ?? { label: opt.name };
  const subs = echo.subStats ?? [];
  const existingIndex = subs.findIndex(
    (candidate) => candidate.propId === opt.propId && candidate.addType === opt.addType,
  );
  const active = existingIndex >= 0;
  const rolls = possibleRollsFor(opt, api.dataset.statRanges);
  const activeIdx = active ? rolls.indexOf(subs[existingIndex].value) : -1;
  const canAdd = active || subs.length < unlocked;

  // Recommendation: live per-roll value for this stat at the current build.
  const liveKey = liveMap ? substatKeyOf(opt.propId) : null;
  const liveValue = liveKey != null ? (liveMap.get(liveKey) ?? 0) : null;
  const recCol =
    liveValue == null ? null
    : liveValue >= 70 ? "var(--acc)"
    : liveValue >= 35 ? "color-mix(in srgb, var(--acc) 55%, transparent)"
    : null;

  const boxes = rolls
    .map((value, index) => {
      const isOn = active && index === activeIdx;
      const disabled = !active && !canAdd;
      const col = rollColorFor(index, rolls.length);
      const style =
        isOn ?
          `background:${col.bg};color:${col.c};border-color:${col.c};`
        : "";
      return `<button class="bv2-echo-roll${disabled ? " is-disabled" : ""}${isOn ? " is-active" : ""}" data-act="pick-echo-roll" data-slot="${slotIndex}" data-prop="${opt.propId}" data-addtype="${opt.addType}" data-roll="${index}" title="${esc(opt.name)} +${esc(fmtSub(value, opt.isPercent))}" style="${style}" ${disabled ? "disabled" : ""}>${fmtSub(value, opt.isPercent)}</button>`;
    })
    .join("");

  return `<div class="bv2-echo-stat-row">
      <div class="bv2-echo-stat-row__label">
        <div style="font-family:var(--font-body);font-weight:700;font-size:13px;color:${active ? "var(--txt)" : "var(--dim)"};">${esc(meta.label)}</div>
        ${meta.sub ? `<div style="font-family:var(--font-display);font-size:7px;letter-spacing:.8px;color:var(--faint);">${meta.sub}</div>` : ""}
        ${liveValue != null && liveValue > 1 ? `<div title="Live value at this build: ${liveValue.toFixed(0)} / 100" style="font-family:var(--font-display);font-weight:700;font-size:8.5px;color:${recCol ?? "var(--faint)"};">${liveValue.toFixed(0)}</div>` : ""}
      </div>
      <div class="bv2-echo-stat-row__grid">${boxes}</div>
    </div>`;
}

// The 5 fixed-order substat group boxes (echopanel-v2 handoff point 2):
// FLAT ROLLS, MAIN STAT %, CRIT, DMG BONUS, UTILITY.
export function renderSubstatGroups(echo, slotIndex) {
  const unlocked = unlockedSubStatCount(echo.level);
  const liveMap = liveValueMap();
  const groups = SUBSTAT_GROUPS.map((group) => {
    const rows = group.keys
      .map((name) => {
        const opt = api.dataset.echoSubStats.find((candidate) => candidate.name === name);
        return opt ?
            renderSubstatRow(echo, opt, slotIndex, unlocked, liveMap)
          : "";
      })
      .join("");
    return `<div class="bv2-echo-group" style="flex:${group.flexBasis};${group.minWidth ? `min-width:${group.minWidth}px;` : ""}">
        <span class="bv2-echo-group__label">${group.label}</span>
        <div class="bv2-echo-group__grid" style="grid-template-columns:${group.cols};">${rows}</div>
      </div>`;
  }).join("");
  return `<div class="bv2-echo-groups">${groups}</div>`;
}

// Editor frame — MAIN STAT box + SUBSTATS box for the currently selected rail
// slot. The frame's accent (--ea) and left-corner radii are shared with the
// connector bridging it to the selected rail card (see renderEchoSlotCard's
// .bv2-echo-neck and squareEchoFrameCorners()).
export function renderEchoEditor() {
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
    .map((option) => {
      const on =
        echo.mainStat &&
        option.propId === echo.mainStat.propId &&
        option.addType === echo.mainStat.addType;
      const val =
        mainStatValueFor(
          option,
          echo.cost,
          echo.starLevel ?? 5,
          echo.level,
          api.dataset,
        ) ?? 0;
      return `<button data-act="set-echo-main" data-slot="${i}" data-prop="${option.propId}" data-addtype="${option.addType}" style="display:inline-flex;align-items:center;font-family:var(--font-body);font-weight:600;font-size:11.5px;cursor:pointer;border-radius:8px;padding:7px 11px;border:1px solid ${on ? accent : "var(--bd)"};background:${on ? accent : "var(--node)"};color:${on ? "var(--on-acc)" : "var(--dim)"};">${esc(option.name)}<span style="margin-left:6px;font-weight:400;color:${on ? "color-mix(in srgb, var(--on-acc) 70%, transparent)" : "var(--faint)"};">${fmtSub(val, option.isPercent)}</span></button>`;
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

export function renderEchoes() {
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
            <div style="position:relative;left:55px;">
              <span style="font-family:var(--font-display);font-weight:400;font-size:8px;letter-spacing:.8px;color:var(--acc);">COST </span><span style="font-family:var(--font-display);font-weight:700;font-size:13px;color:${costColor};">${cost}<span style="color:var(--faint);font-weight:400;font-size:11px;"> / ${COST_BUDGET}</span></span>
              </div>
            </div>
          <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;">
            <button data-act="echoes-remove-all" style="font-family:var(--font-display);font-weight:600;font-size:10px;letter-spacing:.7px;border-radius:6px;padding:4px 8px;cursor:pointer;background:var(--inp);border:1px solid var(--bd);color:var(--dim);">REMOVE ALL</button>
            ${(() => {
              const presets = listEchoPresets(api.build.resonatorId);
              const hasEchoes = api.build.echoes.some(Boolean);
              const btnStyle =
                "font-family:var(--font-display);font-weight:600;font-size:10px;letter-spacing:.7px;border-radius:6px;padding:4px 8px;cursor:pointer;border:1px solid var(--bd);";
              return [
                `<button data-act="echoes-save" ${hasEchoes ? "" : "disabled"} style="${btnStyle}background:var(--inp);color:${hasEchoes ? "var(--dim)" : "var(--faint)"};${hasEchoes ? "" : "opacity:.5;cursor:not-allowed;"}" title="Save current echo loadout as a preset">SAVE</button>`,
                `<button data-act="echoes-load" style="${btnStyle}background:var(--inp);color:var(--dim);" title="Load a saved echo loadout">LOAD${presets.length ? ` <span style="color:var(--acc);font-weight:700;">(${presets.length})</span>` : ""}</button>`,
              ].join("");
            })()}
          </div>
        </div>
        <div style="padding:16px 18px;display:flex;align-items:stretch;gap:16px;">
          <div style="width:270px;flex:none;display:flex;flex-direction:column;gap:9px;">${slots}</div>
          ${renderEchoEditor()}
        </div>
        ${renderSubstatTally()}
        ${renderSonataStrip()}
      </div>`;
}
