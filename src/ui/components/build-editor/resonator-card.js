// src/ui/components/build-editor/resonator-card.js — portrait card, level/chain dials, skill levels + stat-node grid.
// Split from the monolithic build-editor-v2.js (Simplification Plan S4.2).
import { ELEM, GOLD, pct1to10, pct1to90, resonatorOf, statAbbr, weaponOf } from "./shared.js";
import { SKILL_KEYS, SKILL_LABELS } from "../../../core/build.js";
import { api } from "./state.js";
import { esc } from "../../dom.js";
import { iconHtml } from "../../icons.js";
import { weaponTooltipDesc } from "../weapon-picker.js";

export function starRow(rarity, size = 13) {
  return [0, 1, 2, 3, 4]
    .map(
      (i) =>
        `<span style="color:${i < rarity ? GOLD : "var(--nodebd)"};font-size:${size}px;line-height:1;filter:drop-shadow(0 0 3px rgba(var(--shadow-rgb),.75));">◆</span>`,
    )
    .join("");
}

export function levelTicks(val) {
  return [1, 20, 40, 60, 80, 90]
    .map((milestone) => {
      const on = val >= milestone;
      return `<div style="display:flex;flex-direction:column;align-items:center;gap:3px;">
            <span style="width:1px;height:5px;background:${on ? "var(--acc)" : "var(--nodebd)"};"></span>
            <span style="font-family:var(--font-body);font-size:8px;color:${on ? "var(--dim)" : "var(--faint)"};">${milestone}</span></div>`;
    })
    .join("");
}

// tipFor(n, active) lets callers override the hover-box per node (used by
// Sequence to surface each chain node's real name+desc — see §I gap).
// Returns { title, desc } — desc is optional.
export function tierNodes(count, current, min, prefix, act, tipFor) {
  const base =
    "position:relative;flex:1 1 0;min-width:0;height:32px;border-radius:8px;cursor:pointer;font-family:var(--font-body);font-weight:600;font-size:14px;display:flex;align-items:center;justify-content:center;transition:all .14s;";
  return Array.from({ length: count }, (_, i) => {
    const number = i + 1,
      active = number <= current,
      isTop = number === current;
    const style =
      base +
      (active ?
        `background:linear-gradient(180deg,color-mix(in srgb, var(--acc) 28%, transparent),color-mix(in srgb, var(--acc) 12%, transparent));border:1.5px solid var(--acc);color:var(--acc);box-shadow:${isTop ? "0 0 12px color-mix(in srgb, var(--acc) 45%, transparent)" : "none"};`
      : "background:var(--node);border:1.5px solid var(--nodebd);color:var(--faint);");
    const tip =
      tipFor ?
        tipFor(number, active)
      : { title: `${active ? "Active" : "Locked"} · ${prefix}${number}` };
    return `<button class="bv2-node" data-act="${act}" data-n="${number}" data-tip-title="${esc(tip.title)}" ${tip.desc ? `data-tip-desc="${esc(tip.desc)}"` : ""} style="${style}">${prefix}${number}</button>`;
  }).join("");
}

export function renderResonatorCard() {
  const build = api.build;
  const resonator = resonatorOf();
  const el = ELEM[resonator?.element] ?? { name: "—", c: "var(--acc)", g: "?" };
  const wpn = weaponOf();
  const hasWeapon = !!build.weapon;
  const modes = resonator?.resonanceModes ?? [];
  const roles = resonator?.roles ?? [];

  const charPortrait = `
      <div style="flex:none;width:140px;display:flex;flex-direction:column;gap:5px;">
        <button class="bv2-portrait" data-act="pick-build-resonator" title="Switch Build / Resonator" style="position:relative;width:100%;height:140px;border:1.5px solid var(--bd2);border-radius:12px;background:radial-gradient(120% 90% at 75% 0%,color-mix(in srgb, ${el.c}, transparent),transparent 80%),var(--node);display:flex;align-items:center;justify-content:center;overflow:hidden;cursor:pointer;padding:0;transition:border-color .14s,box-shadow .14s;">
          <span style="position:absolute;top:6px;left:9px;font-family:var(--font-display);font-size:9px;letter-spacing:1.5px;color:var(--acc);">RESONATOR</span>
          ${
            resonator?.iconUrl ?
              `<img src="${esc(resonator.iconUrl)}" alt="${esc(resonator.name)}" style="width:100%;height:100%;object-fit:cover;">`
            : `<div style="font-family:var(--font-display);font-weight:700;font-size:34px;color:${el.c};">${el.g}</div>`
          }
          <div style="position:absolute;left:0;right:0;bottom:0;display:flex;justify-content:center;gap:3px;padding:10px 0 8px;background:linear-gradient(transparent,rgba(var(--scrim-rgb),.62));">${starRow(resonator?.rarity ?? 5)}</div>
        </button>
        <div style="text-align:center;font-family:var(--font-display);font-weight:700;font-size:12px;color:var(--txt);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(resonator?.name ?? "—")}</div>
        <div style="display:flex;align-items:center;gap:9px;background:var(--inp);border:1px solid var(--bd);border-radius:10px;padding:5px 7px;">
          ${iconHtml("element", resonator?.element, { label: el.name, size: 26 })}
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
              <span data-disp="res-level" style="font-family:var(--font-body);font-weight:700;font-size:20px;color:var(--acc);">${build.level}</span>
              <span style="font-family:var(--font-body);font-size:12px;color:var(--faint);">/ 90</span>
            </div>
          </div>
          <input class="bv2-slider" type="range" min="1" max="90" value="${build.level}" data-act="res-level" style="--pct:${pct1to90(build.level)};">
          <div style="display:flex;justify-content:space-between;margin-top:5px;padding:0 1px;">${levelTicks(build.level)}</div>
        </div>
        <div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;overflow:hidden;">
            <label style="font-family:var(--font-display);font-size:10px;letter-spacing:1.6px;color:var(--faint);">RESONANCE CHAIN - SEQUENCE</label>
          </div>
          <div style="display:flex;gap:6px;">${tierNodes(
            6,
            build.chain,
            0,
            "S",
            "seq",
            (sequenceLevel, active) => {
              const node = resonator?.resonanceChain?.[sequenceLevel - 1];
              if (!node)
                return {
                  title: `${active ? "Active" : "Locked"} · S${sequenceLevel}`,
                };
              return {
                title: `${active ? "Active" : "Locked"} · S${sequenceLevel} ${node.name}`,
                desc: node.desc,
              };
            },
          )}</div>
        </div>
      </div>`;

  const modeControl = modes.length ?
    `<div style="display:flex;gap:3px;background:var(--node);border-radius:7px;padding:3px;">
             ${modes
               .map((mode) => {
                 const on = (build.resonanceMode ?? modes[0].key) === mode.key;
                 return `<button data-act="mode" data-mode="${esc(mode.key)}" data-tip-title="${esc(mode.name)}" ${mode.desc ? `data-tip-desc="${esc(mode.desc)}"` : ""} style="flex:1 1 0;border:none;border-radius:5px;cursor:pointer;font-family:var(--font-body);font-weight:600;font-size:11px;padding:8px 4px;transition:all .14s;${on ? "background:var(--acc);color:var(--on-acc);box-shadow:0 1px 6px color-mix(in srgb, var(--acc) 40%, transparent);" : "background:transparent;color:var(--dim);"}">${esc(mode.name)}</button>`;
               })
               .join("")}
           </div>` : "";

  // Role-label tags (P13) — placeholder glyph icons (icons.js 'role' kind) in
  // the resonator's own game-supplied colour, hover tooltip via the shared
  // data-tip-title/data-tip-desc pattern (bindTooltipHover is already wired
  // for this root). Shares the RESONANCE MODE box: for the ~49/53 resonators
  // with no Resonance Mode, roles fully take over that slot; for the 4 that
  // do (Lucilla, Aemeath, Denia, Lynae), the box auto-fits both — a roles row
  // above a thin divider, mode toggle unchanged below.
  const roleBadges = roles.length ?
    `<div style="display:flex;gap:5px;flex-wrap:wrap;">${roles
      .map((role) => {
        const color = role.color ? `#${role.color}` : null;
        return `<span data-tip-title="${esc(role.name)}" ${role.desc ? `data-tip-desc="${esc(role.desc)}"` : ""} style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:6px;background:var(--node);border:1px solid var(--bd2);cursor:default;">${iconHtml("role", role.id, { label: role.name, size: 15, tintColor: color })}</span>`;
      })
      .join("")}</div>` : "";

  const resonanceBoxLabel =
    roles.length && modes.length ? "RESONANCE MODE · ROLES"
    : modes.length ? "RESONANCE MODE"
    : roles.length ? "ROLES"
    : "RESONANCE MODE";
  const resonanceBoxContent =
    roles.length && modes.length ?
      `${roleBadges}<div style="height:1px;background:var(--bd);margin:7px 0;"></div>${modeControl}`
    : roles.length ? roleBadges
    : modes.length ? modeControl
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
          <input class="bv2-text" type="text" value="${esc(build.name ?? "")}" data-act="build-name" placeholder="e.g. Hypercarry…" style="width:100%;background:var(--inp);border:1px solid var(--bd);border-radius:9px;padding:10px 12px;font-size:14px;color:var(--txt);">
        </div>
        ${buildActions}
        <div style="background:var(--inp);border:1px solid var(--bd);border-radius:10px;padding:8px 10px;">
          <div style="font-family:var(--font-display);font-size:8.5px;letter-spacing:1.4px;color:var(--faint);margin:1px 0 6px 3px;">${resonanceBoxLabel}</div>
          ${resonanceBoxContent}
        </div>
      </div>`;

  const weaponCol = `
      <div style="flex:1.05;min-width:0;display:flex;flex-direction:column;gap:20px;justify-content:center;">
        <div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <label style="font-family:var(--font-display);font-size:10px;letter-spacing:1.6px;color:var(--faint);">WEAPON REFINEMENT</label>
          </div>
          <div style="display:flex;gap:6px;${hasWeapon ? "" : "opacity:.4;pointer-events:none;"}">${tierNodes(5, build.weapon?.rank ?? 1, 1, "R", "refine")}</div>
          <div style="font-family:var(--font-body);font-size:9.5px;color:var(--faint);margin-top:6px;">${hasWeapon ? "" : "Pick a weapon to set refinement."}</div>
        </div>
        <div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <label style="font-family:var(--font-display);font-size:10px;letter-spacing:1.6px;color:var(--faint);">WEAPON LEVEL</label>
            <div style="display:flex;align-items:baseline;gap:3px;">
              <span data-disp="weapon-level" style="font-family:var(--font-body);font-weight:700;font-size:20px;color:var(--acc);">${build.weapon?.level ?? 1}</span>
              <span style="font-family:var(--font-body);font-size:12px;color:var(--faint);">/ 90</span>
            </div>
          </div>
          <input class="bv2-slider" type="range" min="1" max="90" value="${build.weapon?.level ?? 1}" data-act="weapon-level" ${hasWeapon ? "" : "disabled"} style="--pct:${pct1to90(build.weapon?.level ?? 1)};${hasWeapon ? "" : "opacity:.4;"}">
          <div style="display:flex;justify-content:space-between;margin-top:5px;padding:0 1px;">${levelTicks(build.weapon?.level ?? 1)}</div>
        </div>
      </div>`;

  const weaponPortrait = `
      <div style="flex:none;width:140px;display:flex;flex-direction:column;gap:5px;">
        <button class="bv2-portrait" data-act="pick-weapon" ${
          hasWeapon ?
            `data-tip-title="${esc(wpn.name)}" data-tip-desc="${esc(weaponTooltipDesc(wpn, build))}"`
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
          ${iconHtml("weaponType", resonator?.weaponType, { label: resonator?.weaponTypeName, size: 30, tint: "--dim" })}
          <div style="min-width:0;">
            <div style="font-family:var(--font-display);font-size:7px;letter-spacing:1.4px;color:var(--faint);">WEAPON TYPE</div>
            <div style="font-family:var(--font-body);font-weight:600;font-size:13.5px;color:var(--txt);">${esc(resonator?.weaponTypeName ?? "—")}</div>
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

// Forte (diamond) or stat (circle) node button. Tiered exactly like
// Sequence/Refinement: the left node is the root (t1) of the right one (t2) —
// clicking t2 activates both, clicking the topmost active node drops it down
// one level, clicking a lower node while a higher one is active drops back
// down to that level. The engine's setStatNode/setInherentSkill still take
// each index independently; the cascade is enforced here in the click handler
// via the shared tier() helper.
export function skillNode({ active, abbr, isForte, tip, dataAttrs }) {
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

export function skillLevelDots(level) {
  return Array.from(
    { length: 10 },
    (_, i) =>
      `<span style="width:3px;height:3px;border-radius:50%;background:${i < level ? "var(--acc)" : "var(--nodebd)"};"></span>`,
  ).join("");
}

export function renderSkillLevels() {
  const build = api.build;
  const resonator = resonatorOf();
  const inherentSkills = resonator?.inherentSkills ?? [];
  const statNodeBonuses = resonator?.statNodeBonuses ?? {};
  const inherentActive = build.inherentSkillsActive ?? [true, true];
  const statActive = build.statNodesActive ?? {};

  const columns = SKILL_KEYS.map((key) => {
    const isForte = key === "forte";
    const level = build.skillLevels[key];

    const nodesHtml =
      isForte ?
        (() => {
          const curTier =
            inherentActive[1] !== false ? 2
            : inherentActive[0] !== false ? 1
            : 0;
          return inherentSkills
            .map((inherentSkill, i) => {
              const number = i + 1,
                active = number <= curTier;
              return skillNode({
                active,
                abbr: `IH${number}`,
                isForte: true,
                tip: {
                  title: `${active ? "Active" : "Locked"} · IH${number} ${inherentSkill.name}`,
                  desc: inherentSkill.desc,
                },
                dataAttrs: `data-act="inherent-node" data-n="${number}"`,
              });
            })
            .join("");
        })()
      : (() => {
          const nodes = (statNodeBonuses[key] ?? [])
            .slice()
            .sort((nodeA, nodeB) => nodeA.tier - nodeB.tier);
          const tiers = statActive[key];
          const curTier =
            tiers?.[1] !== false ? 2
            : tiers?.[0] !== false ? 1
            : 0;
          return nodes
            .map((node, i) => {
              const number = i + 1,
                active = number <= curTier;
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
                dataAttrs: `data-act="stat-node" data-col="${esc(key)}" data-n="${number}"`,
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
            <button data-act="skills-reset" style="font-family:var(--font-display);font-weight:600;font-size:9px;letter-spacing:1px;color:var(--dim);background:var(--inp);border:1px solid var(--bd);border-radius:6px;padding:4px 8px;cursor:pointer;">RESET ALL</button>
            <button data-act="skills-max" style="font-family:var(--font-display);font-weight:700;font-size:9px;letter-spacing:1px;color:var(--on-acc);background:var(--acc);border:1px solid var(--acc);border-radius:6px;padding:4px 8px;cursor:pointer;box-shadow:0 1px 8px color-mix(in srgb, var(--acc) 35%, transparent);">MAX ALL</button>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;padding:10px;">${columns}</div>
      </div>`;
}
