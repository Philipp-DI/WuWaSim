// src/ui/components/build-editor/stat-priority.js — P12 Stat Priority panel + live per-roll weights.
// Split from the monolithic build-editor-v2.js (Simplification Plan S4.2).
import { SOLO_MODES, erStatus, isFarFromAnchor, statPriority } from "../../../core/stat-ranking.js";
import { api } from "./state.js";
import { dominantSonataId } from "./echoes.js";
import { echoUpgradeRanking } from "../../../core/live-weights.js";
import { esc } from "../../dom.js";
import { isEmptyBuild } from "./suggested-teams-panel.js";
import { metaFor, suggestedBuildFor } from "../../../data/meta-loader.js";
import { resolveTotalStats } from "../../../core/stats.js";
import { makeDmgTarget, simBuild } from "./shared.js";

export const MODE_LABELS = {
  dmgFocus: "DMG Focus",
  balanced: "Balanced",
  erFocus: "ER Focus",
};

export const MODE_TIPS = {
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
export let _liveCache = { build: undefined, result: null };

export function liveAnalysis() {
  // Key on the SIM build (persisted build + sonata preview): simBuild() returns
  // a stable reference until the build or the override actually changes, so the
  // memo stays valid across repaints yet re-sims when the preview toggles.
  const build = simBuild();
  if (_liveCache.build === build) return _liveCache.result;
  let result;
  try {
    // Same enemy level/RES the Ability Damage card and the top strip use, so
    // the kit-average fallback below is literally the strip's OVERALL AVG
    // rather than merely the same kind of number. Only the ranking is shown, so
    // this cannot move a bar on its own — a target is a flat per-hit multiplier.
    const target = api.dmgTarget ? makeDmgTarget(build, api.dmgTarget) : undefined;
    result = echoUpgradeRanking(build, api.dataset, target);
  } catch (err) {
    // A thrown sim renders identically to "not simmable yet" — an empty panel.
    // Log it so a real failure is diagnosable instead of looking like an empty
    // build (2026-07-31).
    console.error("live stat weights failed for this build:", err);
    result = null;
  }
  _liveCache = { build, result };
  return result;
}

// Map of weight-key → live normalized per-roll value (0..100) for the current
// build, or null when not simmable. Used to colour the substat palette + panel.
export function liveValueMap() {
  const live = liveAnalysis()?.live;
  if (!live) return null;
  return new Map(live.values.map((value) => [value.key, value.normalized]));
}

// Why a rollable stat is worth exactly nothing at this build. The core module
// reports the CODE (it has no business phrasing UI copy); the sentence lives
// here. Never rendered as a silent omission — see liveSubstatValues.
export function zeroReasonText(value, critCapped) {
  if (value.zeroReason === "critCap") {
    const share = Math.round((critCapped ?? 1) * 100);
    return `already at the 100% Crit Rate cap${share < 100 ? ` on ${share}% of your damage` : ""} — another roll adds nothing`;
  }
  if (value.key === "energyRegen") {
    return "adds no damage here — ER decides whether Liberation is ready, see the line above";
  }
  return "nothing in this rotation scales with it";
}

// What a build still needs before liveSubstatValues() can rank anything.
// Empty list = it should already be simmable (so an empty panel is a real
// failure, not an unfinished build).
export function missingForLivePanel(build) {
  const missing = [];
  if (!(build?.echoes ?? []).some(Boolean)) missing.push("equip an echo");
  if (!(build?.rotation ?? []).length) missing.push("add rotation steps");
  return missing;
}

function valueRowHtml(value) {
  const pct = Math.max(2, value.normalized ?? 0);
  return `<div style="display:flex;align-items:center;gap:10px;padding:5px 0;">
        <span style="font-family:var(--font-body);font-weight:700;font-size:12.5px;color:var(--txt);min-width:150px;">${esc(value.label)}</span>
        <div style="flex:1;height:8px;border-radius:5px;background:var(--node);overflow:hidden;"><div style="width:${pct}%;height:100%;background:var(--acc);"></div></div>
        <span style="font-family:var(--font-display);font-size:10px;color:var(--dim);min-width:28px;text-align:right;">${(value.normalized ?? 0).toFixed(0)}</span>
      </div>`;
}

function zeroValueRowHtml(value, critCapped) {
  return `<div style="display:flex;align-items:center;gap:10px;padding:5px 0;">
        <span style="font-family:var(--font-body);font-weight:700;font-size:12.5px;color:var(--dim);min-width:150px;">${esc(value.label)}</span>
        <span style="flex:1;font-family:var(--font-body);font-size:11px;color:var(--faint);">${esc(zeroReasonText(value, critCapped))}</span>
        <span style="font-family:var(--font-display);font-size:10px;color:var(--faint);min-width:28px;text-align:right;">0</span>
      </div>`;
}

export function renderStatPriority() {
  return statPriorityPanelHtml({
    meta: api.meta,
    build: simBuild(), // ER line + meta lookup follow the sonata preview
    dataset: api.dataset,
    statMode: api.statMode,
    live: liveAnalysis(),
  });
}

// The live stat-priority panel: per-roll substat values computed at the user's
// ACTUAL current stats (not a frozen anchor), plus the worst-echo callout. This
// is the primary "what should I roll next" view. Pure markup.
export function liveStatPanelHtml({ b, dataset, analysis, meta }) {
  const live = analysis.live;
  const onKit = live.measure === "kit";
  const header = `<div style="display:flex;align-items:center;gap:10px;padding:13px 18px;border-bottom:1px solid var(--bd);">
        <span style="font-family:var(--font-display);font-size:11px;letter-spacing:1.5px;color:var(--txt);">STAT PRIORITY</span>
        <span style="font-family:var(--font-body);font-size:10px;color:var(--acc);">⚡ live · ${onKit ? "kit average" : "your rotation"}</span>
      </div>`;

  const rows = live.values
    .map((value) =>
      value.zeroReason ?
        zeroValueRowHtml(value, live.critCapped)
      : valueRowHtml(value),
    )
    .join("");

  const erLine = energyRegenLineHtml(b, dataset, meta);

  // Worst-echo callout — the slot with the most upgrade headroom.
  const worst = analysis.worstSlot;
  const worstLine =
    worst != null ?
      `<div style="font-family:var(--font-body);font-size:12px;color:var(--warn);font-weight:600;">↑ Echo slot ${worst + 1} has the most upgrade headroom — its substats add the least; re-roll it first.</div>`
    : "";

  return `<div class="bv2-card" style="background:var(--card);border:1px solid var(--bd);border-radius:10px;overflow:hidden;">
      ${header}
      <div style="padding:14px 18px 16px 18px;display:flex;flex-direction:column;gap:10px;">
        ${assumedLine(live)}
        ${erLine}
        <div style="display:flex;flex-direction:column;">${rows}</div>
        ${worstLine}
        <div style="font-family:var(--font-body);font-size:10.5px;color:var(--faint);border-top:1px solid var(--bd);padding-top:8px;">
          Value = extra ${onKit ? "average damage per hit" : "rotation damage"} per +1 substat roll, at your current stats. Recomputed live as you change the build. The echo editor highlights the recommended substats.
        </div>
      </div>
    </div>`;
}

// Current Energy Regen (informational — energy availability, not damage).
function energyRegenLineHtml(build, dataset, meta) {
  const erPct = Math.round((resolveTotalStats(build, dataset).energyRegen ?? 0) * 100);
  const erMeta =
    meta ?
      metaFor(meta, build.resonatorId, build.chain, dominantSonataId(build.echoes))
    : null;
  const erTarget =
    erMeta?.erMode?.libCostKnown ?
      Math.round((erMeta.erMode.balancedTarget ?? 1.25) * 100)
    : null;
  if (erTarget == null) {
    return `<div style="font-family:var(--font-body);font-size:12px;color:var(--faint);">Energy Regen ${erPct}%</div>`;
  }
  const below = erPct < erTarget;
  return `<div style="font-family:var(--font-body);font-size:12px;color:${below ? "var(--warn)" : "var(--dim)"};">Energy Regen ${erPct}%${below ? ` → aim for ~${erTarget}% so Liberation is ready` : ` ✓ (target ~${erTarget}%)`}</div>`;
}

// What the ranking was measured against, when it wasn't the user's own
// rotation. This changes what the numbers MEAN, so it is stated up front rather
// than buried in the footnote — the panel is only trustworthy if it admits what
// it measured.
function assumedLine(live) {
  const notes = [];
  if (live.measure === "kit") {
    notes.push(
      "your rotation deals no damage yet, so stats are ranked by average damage per hit across the whole kit — the OVERALL AVG reading in the top bar",
    );
  }
  if (live.assumedEcho) notes.push("one empty echo slot is assumed, since none are equipped");
  if (!notes.length) return "";
  return `<div style="font-family:var(--font-body);font-size:11.5px;color:var(--acc);background:color-mix(in srgb, var(--acc) 9%, transparent);border:1px solid color-mix(in srgb, var(--acc) 28%, transparent);border-radius:7px;padding:7px 10px;line-height:1.45;">
      ↻ ${esc(notes.join("; "))}. Add rotation steps and these numbers follow it instead.
    </div>`;
}

const FROZEN_HEADER = `<div style="display:flex;align-items:center;gap:10px;padding:13px 18px;border-bottom:1px solid var(--bd);">
        <span style="font-family:var(--font-display);font-size:11px;letter-spacing:1.5px;color:var(--txt);">STAT PRIORITY</span>
        <span style="font-family:var(--font-body);font-size:10px;color:var(--faint);">precomputed · per sequence + sonata</span>
      </div>`;

// The one-click starting point for a covered character whose build is still
// empty. "" when it doesn't apply.
const nameById = (list, id, fallback) =>
  list?.find((item) => item.id === id)?.name ?? fallback;

function suggestionLabels(suggestion, dataset, current) {
  return {
    weapon: suggestion.weaponName ?? nameById(dataset.weapons, suggestion.weaponId, "weapon"),
    sonata: suggestion.sonataName ?? nameById(dataset.sonatas, suggestion.sonataId, `set ${suggestion.sonataId}`),
    resonator: nameById(dataset.resonators, current.resonatorId, "this resonator"),
    steps: (suggestion.referenceRotation ?? []).length,
  };
}

function suggestedBuildCardHtml({ meta, dataset, current, header }) {
  const suggestion = meta ? suggestedBuildFor(meta, current.resonatorId) : null;
  if (!suggestion || !isEmptyBuild(current)) return "";
  const label = suggestionLabels(suggestion, dataset, current);
  return `<div class="bv2-card" style="background:var(--card);border:1px solid var(--bd);border-radius:10px;overflow:hidden;">
          ${header}
          <div style="padding:16px 18px;display:flex;flex-direction:column;gap:12px;">
            <div style="font-family:var(--font-body);font-size:12.5px;color:var(--dim);line-height:1.5;">
              Suggested starting build for <b style="color:var(--txt);">${esc(label.resonator)}</b> — best sonata + weapon found by simming the reference rotation.
            </div>
            <div style="display:flex;flex-direction:column;gap:6px;font-family:var(--font-body);font-size:12.5px;color:var(--txt);">
              <div>🜲 <b>Sonata:</b> ${esc(label.sonata)} ×5</div>
              <div>⚔ <b>Weapon:</b> ${esc(label.weapon)}</div>
              <div>↻ <b>Rotation:</b> ${label.steps} steps (kit-faithful reference)</div>
            </div>
            <button data-act="apply-suggested" style="align-self:flex-start;font-family:var(--font-display);font-weight:600;font-size:11px;letter-spacing:.7px;border-radius:8px;padding:9px 16px;cursor:pointer;background:var(--acc);color:var(--on-acc);border:none;">APPLY SUGGESTED BUILD</button>
            <div style="font-family:var(--font-body);font-size:10.5px;color:var(--faint);">Equips the set + weapon + recommended main stats and the reference rotation. Substats are left for you to roll.</div>
          </div>
        </div>`;
}

// Nothing measurable and nothing precomputed. Reached only when even the
// reference-rotation fallback couldn't produce damage — the three resonators
// with no curated rotation (Suisui, Rover: Electro, Yangyang: Xuanling), or a
// build whose every step resolves to nothing.
function noEntryPanelHtml({ current, sonataId, header }) {
  const missing = missingForLivePanel(current);
  const body =
    missing.length ?
      `Stat priority is ranked by simming a rotation, and nothing here can be simmed yet — ${esc(missing.join(" and "))}.`
    : `No precomputed suggestion available for this configuration${sonataId == null ? "" : " (sequence / sonata not covered yet)"}.
          <span style="color:var(--faint);">The Rotation and Ability Damage panels below run the live sim on your actual build.</span>`;
  return `<div class="bv2-card" style="background:var(--card);border:1px solid var(--bd);border-radius:10px;overflow:hidden;">
        ${header}
        <div style="padding:16px 18px;font-family:var(--font-body);font-size:12.5px;color:var(--dim);line-height:1.5;">
          ${body}
        </div>
      </div>`;
}

// Pure panel markup (testable in isolation — no module state, no DOM).
// `live` is the echoUpgradeRanking() result for the current build (or null).
export function statPriorityPanelHtml({ meta, build, dataset, statMode, live }) {
  const current = build;

  // LIVE panel — the primary view whenever anything can be simmed. Per-roll
  // values are computed at the user's CURRENT stats, so the ranking reflects
  // real diminishing returns, not a frozen anchor. Works for covered AND
  // uncovered characters (no meta needed).
  const livePanel =
    live?.live?.values?.length ?
      liveStatPanelHtml({ b: current, dataset, analysis: live, meta })
    : "";

  // A covered character on a still-empty build keeps its one-click starting
  // point, ABOVE the ranking. Since the weights now fall back to the reference
  // rotation they render for empty builds too, and they must not displace the
  // offer that actually fills the build in (2026-07-31).
  const suggestionCard = suggestedBuildCardHtml({ meta, dataset, current, header: FROZEN_HEADER });
  if (suggestionCard) return suggestionCard + livePanel;
  if (livePanel) return livePanel;

  // No meta loaded at all (file missing/stale) → omit the panel silently; the
  // Rotation + Ability Damage panels already ARE the live sim (§9.4 fallback).
  if (!meta) return "";
  const sonataId = dominantSonataId(current.echoes);
  const entry =
    sonataId == null ? null : metaFor(meta, current.resonatorId, current.chain, sonataId);

  if (!entry) return noEntryPanelHtml({ current, sonataId, header: FROZEN_HEADER });
  return frozenPanelHtml({ current, dataset, statMode, entry, sonataId });
}

// The precomputed panel for a covered sequence × sonata: mode toggle, ER gate
// advice and the frozen weight bars.
function frozenPanelHtml({ current, dataset, statMode, entry, sonataId }) {
  const header = FROZEN_HEADER;

  const mode = statMode;
  const status = erStatus(current, entry, dataset);
  const priority = statPriority(entry, mode, dataset.statRanges);
  const far = isFarFromAnchor(current, entry, dataset);

  // Mode toggle.
  const modeBtns = SOLO_MODES.map((soloMode) => {
    const onSel = soloMode === mode;
    return `<button data-act="stat-mode" data-mode="${soloMode}" data-tip-desc="${esc(MODE_TIPS[soloMode])}" style="flex:1 1 0;border:none;border-radius:6px;cursor:pointer;font-family:var(--font-body);font-weight:600;font-size:11px;padding:7px 4px;transition:all .14s;${onSel ? "background:var(--acc);color:var(--on-acc);box-shadow:0 1px 6px color-mix(in srgb, var(--acc) 40%, transparent);" : "background:transparent;color:var(--dim);"}">${MODE_LABELS[soloMode]}</button>`;
  }).join("");

  // ER status line. The scaling / not-energy-gated facts show in every mode;
  // the "reach the target" gate advice is suppressed in DMG Focus, which by
  // definition ignores ER.
  let erLine;
  if (status.scalesWithEr) {
    erLine = `<div style="font-family:var(--font-body);font-size:12px;color:var(--acc);">⚡ Energy Regen scales this character's damage — more is better.</div>`;
  } else if (!status.libCostKnown) {
    erLine = `<div style="font-family:var(--font-body);font-size:12px;color:var(--faint);">Liberation isn't energy-gated for this resonator — Energy Regen isn't required.</div>`;
  } else if (mode === "dmgFocus") {
    erLine = `<div style="font-family:var(--font-body);font-size:11px;color:var(--faint);">DMG Focus ignores Energy Regen — switch to Balanced for the ER target.</div>`;
  } else if (status.belowTarget) {
    erLine = `<div style="font-family:var(--font-body);font-size:12.5px;color:var(--warn);font-weight:600;">Energy Regen ${(status.current * 100).toFixed(0)}% → aim for ~${(status.target * 100).toFixed(0)}%. Below this, your Liberation may not be ready in time.</div>`;
  } else {
    erLine = `<div style="font-family:var(--font-body);font-size:12px;color:var(--dim);">Energy Regen ${(status.current * 100).toFixed(0)}% ✓ (target ~${(status.target * 100).toFixed(0)}%)</div>`;
  }

  // Priority list with relative weight bars.
  const rows = priority
    .map((priority) => {
      if (priority.key === "energyRegen") {
        return `<div style="display:flex;align-items:center;gap:10px;padding:5px 0;">
                <span style="font-family:var(--font-body);font-weight:700;font-size:12.5px;color:var(--txt);min-width:150px;">${esc(priority.label)}</span>
                <span style="font-family:var(--font-body);font-size:11px;color:var(--faint);">${priority.gate ? esc(priority.note ?? "") : esc(priority.note ?? "")}</span>
              </div>`;
      }
      const pct = Math.max(2, priority.normalized ?? 0);
      return `<div style="display:flex;align-items:center;gap:10px;padding:5px 0;">
            <span style="font-family:var(--font-body);font-weight:700;font-size:12.5px;color:var(--txt);min-width:150px;">${esc(priority.label)}</span>
            <div style="flex:1;height:8px;border-radius:5px;background:var(--node);overflow:hidden;"><div style="width:${pct}%;height:100%;background:var(--acc);"></div></div>
            <span style="font-family:var(--font-display);font-size:10px;color:var(--dim);min-width:28px;text-align:right;">${(priority.normalized ?? 0).toFixed(0)}</span>
          </div>`;
    })
    .join("");

  const sonataName =
    dataset.sonatas?.find((sonata) => sonata.id === sonataId)?.name ?? `set ${sonataId}`;
  const caveat =
    far ?
      `<div style="font-family:var(--font-body);font-size:11px;color:var(--faint);padding-top:8px;">Assumes a well-invested build; your priorities may differ until your crit / ATK are closer to endgame.</div>`
    : "";

  return `<div class="bv2-card" style="background:var(--card);border:1px solid var(--bd);border-radius:10px;overflow:hidden;">
      ${header}
      <div style="display:flex;gap:6px;padding:12px 18px 0 18px;">${modeBtns}</div>
      <div style="padding:12px 18px 16px 18px;display:flex;flex-direction:column;gap:10px;">
        ${erLine}
        <div style="display:flex;flex-direction:column;">${rows}</div>
        <div style="font-family:var(--font-body);font-size:10.5px;color:var(--faint);border-top:1px solid var(--bd);padding-top:8px;">
          For S${current.chain} · ${esc(sonataName)}. ${esc(MODE_TIPS[mode])}
        </div>
        ${caveat}
      </div>
    </div>`;
}
