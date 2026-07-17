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
  if (_liveCache.build === api.build) return _liveCache.result;
  let result;
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
export function liveValueMap() {
  const live = liveAnalysis()?.live;
  if (!live) return null;
  return new Map(live.values.map((value) => [value.key, value.normalized]));
}

export function renderStatPriority() {
  return statPriorityPanelHtml({
    meta: api.meta,
    build: api.build,
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
  const header = `<div style="display:flex;align-items:center;gap:10px;padding:13px 18px;border-bottom:1px solid var(--bd);">
        <span style="font-family:var(--font-display);font-size:11px;letter-spacing:1.5px;color:var(--txt);">STAT PRIORITY</span>
        <span style="font-family:var(--font-body);font-size:10px;color:var(--acc);">⚡ live · your current stats</span>
      </div>`;

  const rows = live.values
    .map((value) => {
      const pct = Math.max(2, value.normalized ?? 0);
      return `<div style="display:flex;align-items:center;gap:10px;padding:5px 0;">
            <span style="font-family:var(--font-body);font-weight:700;font-size:12.5px;color:var(--txt);min-width:150px;">${esc(value.label)}</span>
            <div style="flex:1;height:8px;border-radius:5px;background:var(--node);overflow:hidden;"><div style="width:${pct}%;height:100%;background:var(--acc);"></div></div>
            <span style="font-family:var(--font-display);font-size:10px;color:var(--dim);min-width:28px;text-align:right;">${(value.normalized ?? 0).toFixed(0)}</span>
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

  return `<div class="bv2-card" style="background:var(--card);border:1px solid var(--bd);border-radius:10px;overflow:hidden;">
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
export function statPriorityPanelHtml({ meta, build, dataset, statMode, live }) {
  const current = build;

  // LIVE panel — the primary view whenever the build is simmable (echoes + a
  // rotation). Per-roll values are computed at the user's CURRENT stats, so the
  // ranking reflects real diminishing returns, not a frozen anchor. Works for
  // covered AND uncovered characters (no meta needed).
  if (live?.live?.values?.length) {
    return liveStatPanelHtml({ b: current, dataset, analysis: live, meta });
  }

  // No meta loaded at all (file missing/stale) → omit the panel silently; the
  // Rotation + Ability Damage panels already ARE the live sim (§9.4 fallback).
  if (!meta) return "";
  const sonataId = dominantSonataId(current.echoes);
  const entry =
    sonataId == null ? null : metaFor(meta, current.resonatorId, current.chain, sonataId);

  const header = `<div style="display:flex;align-items:center;gap:10px;padding:13px 18px;border-bottom:1px solid var(--bd);">
        <span style="font-family:var(--font-display);font-size:11px;letter-spacing:1.5px;color:var(--txt);">STAT PRIORITY</span>
        <span style="font-family:var(--font-body);font-size:10px;color:var(--faint);">precomputed · per sequence + sonata</span>
      </div>`;

  if (!entry) {
    // Covered character on an empty/unmatched build → offer the suggested
    // best-in-slot default (sonata × weapon + reference rotation) one-click.
    const suggestion = suggestedBuildFor(meta, current.resonatorId);
    if (suggestion && isEmptyBuild(current)) {
      const weaponLabel =
        suggestion.weaponName ??
        dataset.weapons?.find((weapon) => weapon.id === suggestion.weaponId)?.name ??
        "weapon";
      const sonataLabel =
        suggestion.sonataName ??
        dataset.sonatas?.find((sonata) => sonata.id === suggestion.sonataId)?.name ??
        `set ${suggestion.sonataId}`;
      const steps = (suggestion.referenceRotation ?? []).length;
      return `<div class="bv2-card" style="background:var(--card);border:1px solid var(--bd);border-radius:10px;overflow:hidden;">
              ${header}
              <div style="padding:16px 18px;display:flex;flex-direction:column;gap:12px;">
                <div style="font-family:var(--font-body);font-size:12.5px;color:var(--dim);line-height:1.5;">
                  Suggested starting build for <b style="color:var(--txt);">${esc(dataset.resonators?.find((resonator) => resonator.id === current.resonatorId)?.name ?? "this resonator")}</b> — best sonata + weapon found by simming the reference rotation.
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
    return `<div class="bv2-card" style="background:var(--card);border:1px solid var(--bd);border-radius:10px;overflow:hidden;">
          ${header}
          <div style="padding:16px 18px;font-family:var(--font-body);font-size:12.5px;color:var(--dim);line-height:1.5;">
            No precomputed suggestion available for this configuration${sonataId == null ? "" : " (sequence / sonata not covered yet)"}.
            <span style="color:var(--faint);">The Rotation and Ability Damage panels below run the live sim on your actual build.</span>
          </div>
        </div>`;
  }

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
