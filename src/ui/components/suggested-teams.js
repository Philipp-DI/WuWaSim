// src/ui/components/suggested-teams.js
/**
 * Build-page "Suggested Teams" + "Appears In Teams" surfaces (P13 §8).
 *
 * Pure render functions over the meta team lookups (meta-loader). Curated META
 * teams (maintainer-authoritative known-good comps) pin first with a badge; the
 * sim-ranked alternatives follow with a relative damage bar. The score is shown
 * as a bar/rank, never a raw number (players read rank). Uncovered → a quiet
 * "no suggestion" line, never a fabricated team.
 *
 * Self-contained (only `esc` + the dataset for names/icons + the meta lookups),
 * so it drops into the build page with a single call and inherits the v2 theme
 * via CSS tokens.
 */

import { esc } from '../dom.js';
import { suggestedTeamsFor, appearsInTeams } from '../../data/meta-loader.js';

const nameOf = (dataset, id) => dataset?.resonators?.find(r => r.id === id)?.name ?? `#${id}`;
const iconOf = (dataset, id) => dataset?.resonators?.find(r => r.id === id)?.iconUrl ?? null;
const elemColorOf = (dataset, id) => dataset?.resonators?.find(r => r.id === id)?.elementColor ?? 'var(--acc)';

// One member chip: small portrait + name, ringed in the member's element colour.
function memberChip(dataset, id, isAnchor) {
    const icon = iconOf(dataset, id);
    const ring = elemColorOf(dataset, id);
    const portrait = icon
        ? `<img src="${esc(icon)}" alt="${esc(nameOf(dataset, id))}" style="width:34px;height:34px;border-radius:50%;object-fit:cover;border:2px solid ${ring};">`
        : `<div style="width:34px;height:34px;border-radius:50%;border:2px solid ${ring};background:var(--node);"></div>`;
    return `<div style="display:flex;flex-direction:column;align-items:center;gap:3px;min-width:54px;">
        ${portrait}
        <span style="font-family:var(--font-body);font-size:9.5px;color:${isAnchor ? 'var(--acc)' : 'var(--dim)'};max-width:54px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${isAnchor ? 'font-weight:700;' : ''}">${esc(nameOf(dataset, id))}</span>
    </div>`;
}

function teamRow(dataset, anchorId, t) {
    const pct = Math.max(3, Math.round((t.score ?? 0) * 100));
    const badge = t.curated
        ? `<span style="font-family:var(--font-display);font-size:8px;letter-spacing:1px;color:var(--gold);border:1px solid color-mix(in srgb, var(--gold) 50%, transparent);border-radius:5px;padding:1px 6px;white-space:nowrap;">META · ${esc(t.archetype ?? 'Curated')}</span>`
        : `<span style="font-family:var(--font-display);font-size:8px;letter-spacing:1px;color:var(--faint);">SIM</span>`;
    const chips = t.members.map(id => memberChip(dataset, id, id === anchorId)).join('');
    const reason = t.reason ? `<div style="font-family:var(--font-body);font-size:10px;color:var(--faint);margin-top:4px;">${esc(t.reason)}</div>` : '';
    return `<div style="padding:10px 12px;border:1px solid var(--bd);border-radius:10px;background:var(--node);display:flex;flex-direction:column;gap:7px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
            ${badge}
            <div style="flex:1;height:6px;border-radius:4px;background:var(--inp);overflow:hidden;"><div style="width:${pct}%;height:100%;background:${t.curated ? 'var(--gold)' : 'var(--acc)'};"></div></div>
            <span style="font-family:var(--font-display);font-size:9px;color:var(--dim);min-width:30px;text-align:right;">${pct}%</span>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">${chips}</div>
        ${reason}
    </div>`;
}

/** The "Suggested Teams" panel for a resonator's build page. Returns '' nothing to show would be odd — returns the empty-state line instead. */
export function renderSuggestedTeams(meta, dataset, resonatorId) {
    const teams = suggestedTeamsFor(meta, resonatorId);
    const header = `<div style="font-family:var(--font-display);font-size:9px;letter-spacing:1.5px;color:var(--faint);margin-bottom:9px;">SUGGESTED TEAMS</div>`;
    if (!teams.length) {
        return `<section style="padding:14px 16px;">${header}
            <div style="font-family:var(--font-body);font-size:11px;color:var(--faint);">No team suggestions available for this character yet.</div>
        </section>`;
    }
    const rows = teams.map(t => teamRow(dataset, resonatorId, t)).join('');
    const note = `<div style="font-family:var(--font-body);font-size:9.5px;color:var(--faint);margin-top:8px;">META = maintainer-curated meta comp. Bar = highest simulated team total (single enemy).</div>`;
    return `<section style="padding:14px 16px;">${header}
        <div style="display:flex;flex-direction:column;gap:8px;">${rows}</div>
        ${note}
    </section>`;
}

/** The "Appears In Teams" compact list (reverse lookup) for a support's page. */
export function renderAppearsInTeams(meta, dataset, resonatorId) {
    const apps = appearsInTeams(meta, dataset ? resonatorId : resonatorId);
    if (!apps.length) return '';
    // Distinct anchors, in first-seen order.
    const anchors = [...new Set(apps.map(a => a.anchor))];
    const links = anchors.map(id =>
        `<span data-act="open-build" data-resonator="${id}" style="font-family:var(--font-body);font-size:11px;color:var(--acc);cursor:pointer;">${esc(nameOf(dataset, id))}</span>`
    ).join('<span style="color:var(--faint);">·</span> ');
    return `<section style="padding:10px 16px;">
        <div style="font-family:var(--font-body);font-size:10.5px;color:var(--dim);">Appears in suggested teams for: ${links}</div>
    </section>`;
}
