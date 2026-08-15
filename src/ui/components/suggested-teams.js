// src/ui/components/suggested-teams.js
/**
 * Build-page "Suggested Teams" + "Appears In Teams" surfaces (P13 §8).
 *
 * Pure render functions over the meta team lookups. TRANSPARENT by design
 * (maintainer requirement): the actual team DMG / sim time / DPS are shown at a
 * glance, and every team is expandable to inspect each member's exact build —
 * weapon, sonata, resonance mode, resolved stats, echo mains, and rotation —
 * because a bare score is "baseless conjecture". Curated META teams (maintainer
 * known-good comps) pin first with a badge; sim alternatives follow.
 */

import { esc } from '../dom.js';
import { suggestedTeamsFor, appearsInTeams } from '../../data/meta-loader.js';

const nameOf = (dataset, id) => dataset?.resonators?.find(r => r.id === id)?.name ?? `#${id}`;
const iconOf = (dataset, id) => dataset?.resonators?.find(r => r.id === id)?.iconUrl ?? null;
const elemColorOf = (dataset, id) => dataset?.resonators?.find(r => r.id === id)?.elementColor ?? 'var(--acc)';

// Compact integer with thousands separators (the actual number, for trust).
const fmtN = (n) => Math.round(n ?? 0).toLocaleString();
const pctOf = (x) => `${Math.round((x ?? 0) * 100)}%`;

// Stat propId (+ addType where ambiguous, e.g. ATK ratio vs ATK flat share a
// propId) → short label. Matches src/core/stats.js's PROP constants.
const ELEMENT_LABEL = { 22: 'Glacio', 23: 'Fusion', 24: 'Electro', 25: 'Aero', 26: 'Spectro', 27: 'Havoc' };
function statLabel(s) {
    if (!s) return '—';
    if (ELEMENT_LABEL[s.propId]) return `${ELEMENT_LABEL[s.propId]} DMG`;
    switch (s.propId) {
        case 8: return 'Crit Rate';
        case 9: return 'Crit DMG';
        case 11: return 'Energy Regen';
        case 35: return 'Healing Bonus';
        case 14: return 'Skill DMG';
        case 17: return 'Basic Attack DMG';
        case 18: return 'Heavy Attack DMG';
        case 19: return 'Liberation DMG';
        case 10007: return s.addType === 2 ? 'ATK%' : 'ATK';
        case 10002: return s.addType === 2 ? 'HP%' : 'HP';
        case 10010: return s.addType === 2 ? 'DEF%' : 'DEF';
        default: return `#${s.propId}`;
    }
}
const mainLabel = statLabel;
const fmtStatValue = (s) => s.isPercent ? `${(s.value ?? 0).toFixed(1)}%` : Math.round(s.value ?? 0).toLocaleString();

function memberChip(dataset, id, isAnchor, dps) {
    const icon = iconOf(dataset, id);
    const ring = elemColorOf(dataset, id);
    const portrait = icon
        ? `<img src="${esc(icon)}" alt="${esc(nameOf(dataset, id))}" style="width:34px;height:34px;border-radius:50%;object-fit:cover;border:2px solid ${ring};">`
        : `<div style="width:34px;height:34px;border-radius:50%;border:2px solid ${ring};background:var(--node);"></div>`;
    const dpsLine = dps != null ? `<span style="font-family:var(--font-display);font-size:8px;color:var(--faint);">${fmtN(dps)}/s</span>` : '';
    return `<div style="display:flex;flex-direction:column;align-items:center;gap:2px;min-width:58px;">
        ${portrait}
        <span style="font-family:var(--font-body);font-size:9.5px;color:${isAnchor ? 'var(--acc)' : 'var(--dim)'};max-width:58px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${isAnchor ? 'font-weight:700;' : ''}">${esc(nameOf(dataset, id))}</span>
        ${dpsLine}
    </div>`;
}

// One echo chip: main stat + a hover tooltip listing its real co-optimized
// substats (real average-roll values, not a fabricated package — P13 fix).
function echoChip(e, i) {
    const main = mainLabel(e.mainStat);
    const subs = e.subStats ?? [];
    const tipDesc = subs.length
        ? subs.map(s => `${statLabel(s)} +${fmtStatValue(s)}`).join('\n')
        : 'No substats rolled for this echo.';
    return `<span data-tip-title="Echo ${i + 1} (${e.cost}-cost)" data-tip-desc="${esc(tipDesc)}" style="cursor:help;border-bottom:1px dotted var(--faint);">${e.cost}:${esc(main)}</span>`;
}

// A rotation step, named the way the rest of the app names it. The raw key with
// its underscores swapped for spaces ("forte heavy sawring blitz 2") is not a
// name — it is an identifier with the punctuation filed off, and it reads as
// stale debug output next to the real labels the timeline uses.
// Literals rather than an import of sim.js — this module otherwise pulls in
// nothing from the engine, and rotation-graph.js keeps the same two as literals
// for the same reason.
const ECHO_STEP_KEY = '__echo__';
const TUNE_BREAK_STEP_KEY = '__tunebreak__';

function stepLabel(dataset, resonatorId, key) {
    if (key === ECHO_STEP_KEY) return 'Echo Skill';
    if (key === TUNE_BREAK_STEP_KEY) return 'Tune Break';
    const skillDef = dataset?.autoSkillMap?.[String(resonatorId)]?.[key];
    const label = skillDef?.label ?? key.replace(/_/g, ' ');
    // An Intro/Outro in an authored rotation is NOT an on-field step: the team
    // sim drops it and fires the cast off the swap instead (team-sim.js
    // AUTO_CAST_SKILL_TYPES). Saying so here is what reconciles this list with
    // the team page's, which is one step shorter and starts on what looks like
    // an impossible mid-chain stage.
    return AUTO_CAST_SKILL_TYPES.has(skillDef?.skillType) ? `${label} [auto · on swap]` : label;
}

// Mirrors team-sim.js's set of the same name.
const AUTO_CAST_SKILL_TYPES = new Set(['intro', 'outro']);

// The inspectable per-member build row (weapon · sonata · mode · stats · echoes · rotation).
function buildInspectRow(dataset, mb, dmg, resonatorId) {
    if (!mb) return '';
    const s = mb.stats ?? {};
    const echoes = (mb.echoes ?? []).map(echoChip).join(' · ');
    const asSequence = (keys) => keys.map(key => stepLabel(dataset, resonatorId, key)).join(' → ');
    const rot = asSequence(mb.rotation ?? []);
    // The optional curated opening pass, when this resonator has one. Shown
    // ABOVE the loop and labelled, because it is what actually runs on pass 1 —
    // a card that lists only the loop describes a pass the sim never ran.
    const opener = (mb.openerRotation ?? []).length
        ? `<div style="margin-top:3px;color:var(--faint);line-height:1.4;"><span style="color:var(--acc);">Opening pass:</span> ${esc(asSequence(mb.openerRotation))}</div>`
        : '';
    const statTip = 'Resolved from the real build: base + weapon + echo mains + the real average-roll substats shown by hovering each echo below.';
    return `<div style="padding:8px 10px;border-top:1px solid var(--bd);font-family:var(--font-body);font-size:10.5px;color:var(--dim);">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span style="font-weight:700;color:var(--txt);">${esc(mb.name)}</span>
            ${dmg != null ? `<span style="color:var(--acc);">${fmtN(dmg)} dmg</span>` : ''}
            <span style="color:var(--faint);">·</span><span>${esc(mb.weaponName ?? '—')}</span>
            <span style="color:var(--faint);">·</span><span>${esc(mb.sonataName ?? '—')}</span>
            ${mb.mode ? `<span style="color:var(--faint);">·</span><span style="color:var(--gold);">${esc(mb.mode.replace(/_/g, ' '))}</span>` : ''}
        </div>
        <div data-tip-title="Resolved stats" data-tip-desc="${esc(statTip)}" style="margin-top:3px;color:var(--faint);cursor:help;">
            ATK ${fmtN(s.atk)} · CR ${pctOf(s.critRate)} · CD ${pctOf(s.critDmg)} · ER ${pctOf(s.energyRegen)}${s.healingBonus ? ` · Heal Bonus ${pctOf(s.healingBonus)}` : ''} &nbsp; | &nbsp; Echoes ${echoes}
        </div>
        ${opener}
        <div style="margin-top:3px;color:var(--faint);line-height:1.4;">${opener ? 'Loop (pass 2+)' : 'Rotation'}: ${esc(rot)}</div>
    </div>`;
}

function teamRow(dataset, anchorId, t, memberBuilds) {
    const pct = Math.max(3, Math.round((t.score ?? 0) * 100));
    // The bar IS the DPS beside it, relative to the best team on this page —
    // one measurement, so a longer bar always means a higher DPS.
    const barTip = `${pct}% of the best suggested team's DPS (${fmtN(t.teamDps)} DPS, averaged per pass)`;
    const badge = t.curated
        ? `<span style="font-family:var(--font-display);font-size:8px;letter-spacing:1px;color:var(--gold);border:1px solid color-mix(in srgb, var(--gold) 50%, transparent);border-radius:5px;padding:1px 6px;white-space:nowrap;">META · ${esc(t.archetype ?? 'Curated')}</span>`
        : `<span style="font-family:var(--font-display);font-size:8px;letter-spacing:1px;color:var(--faint);">SIM</span>`;
    const dpsById = Object.fromEntries((t.perMember ?? []).map(m => [m.id, m]));
    const chips = t.members.map(id => memberChip(dataset, id, id === anchorId, dpsById[id]?.dps)).join('');
    // ~~The curated one-line "reason".~~ DROPPED 2026-08-14 (maintainer): it was
    // authored per ARCHETYPE and then shown on every team carrying that
    // archetype tag, so a line like "Denia + Aemeath Fusion Burst carries with
    // Chisa enabler" rendered verbatim under comps containing neither Denia nor
    // Chisa. A blurb that is wrong for most of the teams it appears under is
    // worse than no blurb; the member chips and the numbers already say what
    // the team is. `reason` is still carried in the meta for whoever wants it.
    // At-a-glance actual numbers (the maintainer-required transparency), plus
    // the §8a load action — the click handler lives in the host page's bind()
    // (build-editor), same delegation contract as appears-in's open-build.
    // The headline is ONE PASS's worth, averaged over the three the sim ran —
    // the same measurement the bar above is scored on, so the two can never
    // disagree. `passes` shows the three it averaged, because an average with
    // no visible spread is just another opaque number: pass 1 carries the cold
    // start, passes 2-3 the settled loop, and the gap between them is the most
    // useful thing on the card.
    const passTip = (t.passes ?? []).length
        ? `Average of ${t.passes.length} passes · ` + t.passes
            .map(p => `pass ${p.pass}: ${fmtN(p.damage)} in ${(p.time ?? 0).toFixed(1)}s (${fmtN(p.dps)} DPS)`)
            .join(' · ')
        : 'Single pass';
    const passStrip = (t.passes ?? []).length > 1
        ? `<div style="display:flex;gap:6px;flex-wrap:wrap;font-family:var(--font-display);font-size:9px;color:var(--faint);" title="${esc(passTip)}">
            ${t.passes.map(p => `<span style="border:1px solid var(--bd);border-radius:4px;padding:1px 5px;">P${p.pass} <span style="color:var(--dim);">${fmtN(p.dps)}</span></span>`).join('')}
        </div>` : '';
    const numbers = `<div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;font-family:var(--font-display);" title="${esc(passTip)}">
        <span style="font-size:13px;color:var(--txt);font-weight:700;">${fmtN(t.teamDamage)}<span style="font-size:9px;color:var(--faint);font-weight:400;"> dmg/pass</span></span>
        <span style="font-size:13px;color:var(--txt);">${(t.teamTime ?? 0).toFixed(1)}<span style="font-size:9px;color:var(--faint);">s/pass</span></span>
        <span style="font-size:13px;color:var(--acc);">${fmtN(t.teamDps)}<span style="font-size:9px;color:var(--faint);"> DPS</span></span>
        ${passStrip}
        <span style="flex:1;"></span>
        <button data-act="load-team" data-members="${t.members.join(',')}" title="Load this team into the team simulator" style="font-family:var(--font-display);font-weight:700;font-size:9px;letter-spacing:.8px;padding:4px 10px;border-radius:6px;cursor:pointer;background:var(--acc);border:none;color:var(--on-acc);">OPEN IN TEAM SIM</button>
    </div>`;
    const inspect = `<details style="margin-top:2px;"><summary style="cursor:pointer;font-family:var(--font-display);font-size:9px;letter-spacing:1px;color:var(--faint);outline:none;">INSPECT BUILDS</summary>
        ${t.members.map(id => buildInspectRow(dataset, memberBuilds?.[String(id)], dpsById[id]?.damage, id)).join('')}
    </details>`;
    return `<div style="padding:11px 13px;border:1px solid var(--bd);border-radius:10px;background:var(--node);display:flex;flex-direction:column;gap:8px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
            ${badge}
            <div style="flex:1;height:6px;border-radius:4px;background:var(--inp);overflow:hidden;" title="${esc(barTip)}"><div style="width:${pct}%;height:100%;background:${t.curated ? 'var(--gold)' : 'var(--acc)'};"></div></div>
            <span style="font-family:var(--font-display);font-size:9px;color:var(--dim);min-width:30px;text-align:right;" title="${esc(barTip)}">${pct}%</span>
            ${t.openerCredible === false ? `<span title="No member can charge their first Liberation in less than one rotation, so this team's cold start is not credible. Kept because it is a curated META comp." style="font-family:var(--font-display);font-size:8px;color:var(--gold);">⚠ opener</span>` : ''}
        </div>
        ${numbers}
        <div style="display:flex;gap:8px;flex-wrap:wrap;">${chips}</div>
        ${inspect}
    </div>`;
}

/** The "Suggested Teams" panel for a resonator's build page. */
export function renderSuggestedTeams(meta, dataset, resonatorId) {
    const teams = suggestedTeamsFor(meta, resonatorId);
    const memberBuilds = meta?.teams?.memberBuilds ?? {};
    const header = `<div style="font-family:var(--font-display);font-size:9px;letter-spacing:1.5px;color:var(--faint);margin-bottom:9px;">SUGGESTED TEAMS</div>`;
    if (!teams.length) {
        return `<section style="padding:14px 16px;">${header}
            <div style="font-family:var(--font-body);font-size:11px;color:var(--faint);">No team suggestions available for this character yet.</div>
        </section>`;
    }
    const rows = teams.map(t => teamRow(dataset, resonatorId, t, memberBuilds)).join('');
    // ~~"one clean rotation, no derived opener"~~ — false since the card became
    // a 3-pass measurement, and doubly so since padding was retired (there is no
    // "derived opener" to have or not have any more). A footnote that describes
    // a model the app no longer runs is the thing that makes the numbers above
    // it look invented.
    const note = `<div style="font-family:var(--font-body);font-size:9.5px;color:var(--faint);margin-top:8px;">META = maintainer-curated meta comp. Numbers are a representative-build single-enemy team sim over THREE passes, reported as the average of one pass, on game time. Every fight starts on a full Resonance meter and each rotation runs exactly as authored. OPEN IN TEAM SIM reproduces these numbers against the same enemy; open INSPECT BUILDS to see each member's weapon, sonata, stats, and rotation.</div>`;
    return `<section style="padding:14px 16px;">${header}
        <div style="display:flex;flex-direction:column;gap:8px;">${rows}</div>
        ${note}
    </section>`;
}

/** The "Appears In Teams" compact list (reverse lookup) for a support's page. */
export function renderAppearsInTeams(meta, dataset, resonatorId) {
    const apps = appearsInTeams(meta, resonatorId);
    if (!apps.length) return '';
    const anchors = [...new Set(apps.map(a => a.anchor))];
    const links = anchors.map(id =>
        `<span data-act="open-build" data-resonator="${id}" style="font-family:var(--font-body);font-size:11px;color:var(--acc);cursor:pointer;">${esc(nameOf(dataset, id))}</span>`
    ).join('<span style="color:var(--faint);"> · </span>');
    return `<section style="padding:10px 16px;">
        <div style="font-family:var(--font-body);font-size:10.5px;color:var(--dim);">Appears in suggested teams for: ${links}</div>
    </section>`;
}
