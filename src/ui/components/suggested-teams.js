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

// Echo main-stat propId → short label (the subset used by template mains).
const MAIN_LABEL = {
    1: 'HP', 2: 'HP%', 3: 'ATK', 4: 'ATK%', 5: 'DEF', 6: 'DEF%',
    20: 'Crit Rate', 21: 'Crit DMG', 22: 'Glacio', 23: 'Fusion', 24: 'Electro',
    25: 'Aero', 26: 'Spectro', 27: 'Havoc', 18: 'Energy Regen', 19: 'Healing',
};
const mainLabel = (m) => m ? (MAIN_LABEL[m.propId] ?? `#${m.propId}`) : '—';

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

// The inspectable per-member build row (weapon · sonata · mode · stats · echoes · rotation).
function buildInspectRow(dataset, mb, dmg) {
    if (!mb) return '';
    const s = mb.stats ?? {};
    const echoes = (mb.echoes ?? []).map(e => `${e.cost}:${mainLabel(e.mainStat)}`).join(' · ');
    const rot = (mb.rotation ?? []).map(k => k === '__echo__' ? 'Echo' : k.replace(/_/g, ' ')).join(' → ');
    return `<div style="padding:8px 10px;border-top:1px solid var(--bd);font-family:var(--font-body);font-size:10.5px;color:var(--dim);">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span style="font-weight:700;color:var(--txt);">${esc(mb.name)}</span>
            ${dmg != null ? `<span style="color:var(--acc);">${fmtN(dmg)} dmg</span>` : ''}
            <span style="color:var(--faint);">·</span><span>${esc(mb.weaponName ?? '—')}</span>
            <span style="color:var(--faint);">·</span><span>${esc(mb.sonataName ?? '—')}</span>
            ${mb.mode ? `<span style="color:var(--faint);">·</span><span style="color:var(--gold);">${esc(mb.mode.replace(/_/g, ' '))}</span>` : ''}
        </div>
        <div style="margin-top:3px;color:var(--faint);">
            ATK ${fmtN(s.atk)} · CR ${pctOf(s.critRate)} · CD ${pctOf(s.critDmg)} · ER ${pctOf(s.energyRegen)} &nbsp; | &nbsp; Echoes ${esc(echoes)}
        </div>
        <div style="margin-top:3px;color:var(--faint);line-height:1.4;">Rotation: ${esc(rot)}</div>
    </div>`;
}

function teamRow(dataset, anchorId, t, memberBuilds) {
    const pct = Math.max(3, Math.round((t.score ?? 0) * 100));
    const badge = t.curated
        ? `<span style="font-family:var(--font-display);font-size:8px;letter-spacing:1px;color:var(--gold);border:1px solid color-mix(in srgb, var(--gold) 50%, transparent);border-radius:5px;padding:1px 6px;white-space:nowrap;">META · ${esc(t.archetype ?? 'Curated')}</span>`
        : `<span style="font-family:var(--font-display);font-size:8px;letter-spacing:1px;color:var(--faint);">SIM</span>`;
    const dpsById = Object.fromEntries((t.perMember ?? []).map(m => [m.id, m]));
    const chips = t.members.map(id => memberChip(dataset, id, id === anchorId, dpsById[id]?.dps)).join('');
    const reason = t.reason ? `<div style="font-family:var(--font-body);font-size:10px;color:var(--faint);">${esc(t.reason)}</div>` : '';
    // At-a-glance actual numbers (the maintainer-required transparency).
    const numbers = `<div style="display:flex;gap:14px;flex-wrap:wrap;font-family:var(--font-display);">
        <span style="font-size:13px;color:var(--txt);font-weight:700;">${fmtN(t.teamDamage)}<span style="font-size:9px;color:var(--faint);font-weight:400;"> dmg</span></span>
        <span style="font-size:13px;color:var(--txt);">${(t.teamTime ?? 0).toFixed(1)}<span style="font-size:9px;color:var(--faint);">s</span></span>
        <span style="font-size:13px;color:var(--acc);">${fmtN(t.teamDps)}<span style="font-size:9px;color:var(--faint);"> DPS</span></span>
    </div>`;
    const inspect = `<details style="margin-top:2px;"><summary style="cursor:pointer;font-family:var(--font-display);font-size:9px;letter-spacing:1px;color:var(--faint);outline:none;">INSPECT BUILDS</summary>
        ${t.members.map(id => buildInspectRow(dataset, memberBuilds?.[String(id)], dpsById[id]?.damage)).join('')}
    </details>`;
    return `<div style="padding:11px 13px;border:1px solid var(--bd);border-radius:10px;background:var(--node);display:flex;flex-direction:column;gap:8px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
            ${badge}
            <div style="flex:1;height:6px;border-radius:4px;background:var(--inp);overflow:hidden;"><div style="width:${pct}%;height:100%;background:${t.curated ? 'var(--gold)' : 'var(--acc)'};"></div></div>
            <span style="font-family:var(--font-display);font-size:9px;color:var(--dim);min-width:30px;text-align:right;">${pct}%</span>
        </div>
        ${numbers}
        <div style="display:flex;gap:8px;flex-wrap:wrap;">${chips}</div>
        ${reason}
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
    const note = `<div style="font-family:var(--font-body);font-size:9.5px;color:var(--faint);margin-top:8px;">META = maintainer-curated meta comp. Numbers are a representative-build single-enemy sim (one rotation, carry plays last). Open INSPECT BUILDS to see each member's weapon, sonata, stats, and rotation.</div>`;
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
