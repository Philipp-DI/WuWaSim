/**
 * Team editor — edit a 3-slot team, add resonators from the roster or from
 * saved builds, remove slots, rename the team.
 *
 * mount(root, {
 *   dataset,
 *   team,                       // current team object
 *   onChange(team),             // called whenever the team mutates (autosave)
 *   onOpenBuild(buildId),       // navigate to the build editor for a slot
 *   resolveBuild(buildId),      // -> build | null  (reads from storage)
 *   listBuilds(),               // -> [build]       (for the saved-builds picker)
 *   createBuildForResonator(r), // -> build (created + saved); used for roster adds
 * })
 *
 * A slot references a saved build by id (see team.js). The editor resolves
 * each slot to a build at render time; a dangling reference shows as empty.
 */

import { html, raw, render, on, esc } from '../dom.js';
import * as modal from './modal-picker.js';
import { resolveTotalStats } from '../../core/stats.js';
import { simulateTeamRotation } from '../../core/team-sim.js';
import {
    setTeamName, setTeamSlot, addBuildToTeam, removeBuildFromTeam, resolveTeamSlots, TEAM_SLOTS,
} from '../../core/team.js';

let api = null;

// =============================================================================
// Rendering
// =============================================================================

function resonatorFor(build) {
    return api.dataset.resonators.find(r => r.id === build.resonatorId) ?? null;
}

function renderSlot(slot) {
    const { slotIndex, build } = slot;

    if (!build) {
        return `
            <div class="team-slot team-slot--empty" data-slot="${slotIndex}">
                <button class="team-slot__add" data-action="add-slot" data-slot="${slotIndex}">
                    <span class="team-slot__plus">+</span>
                    <span>Add resonator</span>
                </button>
            </div>
        `;
    }

    const reso = resonatorFor(build);
    if (!reso) {
        // Dangling reference — build resolved but resonator missing from dataset.
        return `
            <div class="team-slot team-slot--empty" data-slot="${slotIndex}">
                <button class="team-slot__add" data-action="remove-slot" data-slot="${slotIndex}">
                    <span>Unknown build — remove</span>
                </button>
            </div>
        `;
    }

    const elColor = reso.elementColor ?? 'var(--accent)';
    const portrait = reso.iconUrl
        ? `<img class="team-slot__portrait" src="${esc(reso.iconUrl)}" alt=""
                onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'team-slot__portrait team-slot__portrait--missing'}))">`
        : `<div class="team-slot__portrait team-slot__portrait--missing"></div>`;

    // Lightweight per-slot stat summary.
    let statLine = '';
    try {
        const s = resolveTotalStats(build, api.dataset);
        statLine = `ATK ${Math.round(s.atk)} · CR ${(s.critRate * 100).toFixed(1)}% · CD ${(s.critDmg * 100).toFixed(0)}%`;
    } catch {
        statLine = 'Stats unavailable';
    }

    const equippedEchoes = build.echoes.filter(Boolean).length;

    return `
        <div class="team-slot" data-slot="${slotIndex}" style="--el-color:${esc(elColor)}">
            <div class="team-slot__head">
                ${portrait}
                <div class="team-slot__title">
                    <span class="team-slot__name">${esc(reso.name)}</span>
                    <span class="team-slot__build">${esc(build.name)}</span>
                </div>
                <button class="team-slot__remove" data-action="remove-slot" data-slot="${slotIndex}"
                        title="Remove from team" aria-label="Remove ${esc(reso.name)}">×</button>
            </div>
            <div class="team-slot__meta">
                Lv ${esc(String(build.level))} · S${esc(String(build.chain))} · ${equippedEchoes}/5 echoes
                ${build.weapon ? '· Wpn' : ''}
            </div>
            <div class="team-slot__stats">${esc(statLine)}</div>
            <div class="team-slot__actions">
                <button class="btn btn--sm" data-action="open-build" data-build="${esc(build.id)}">Edit build</button>
                <button class="btn btn--sm" data-action="swap-slot" data-slot="${slotIndex}">Swap</button>
            </div>
        </div>
    `;
}

function renderRoot() {
    const slots = resolveTeamSlots(api.team, api.resolveBuild);
    const size = slots.filter(s => s.build).length;
    const passes = api.passCount ?? 1;

    return html`
        <div class="team-editor">
            <div class="team-editor__head">
                <input class="team-name" type="text"
                       value="${esc(api.team.name)}"
                       data-action="rename"
                       maxlength="60"
                       aria-label="Team name">
                <span class="team-editor__count">${size}/${TEAM_SLOTS}</span>
            </div>
            <div class="team-slots">
                ${raw(slots.map(renderSlot).join(''))}
            </div>
            <div class="team-sim-controls">
                <label class="team-sim-controls__label">
                    Passes:
                    <input type="number" class="team-sim-passes" min="1" max="10"
                           value="${passes}" data-action="set-passes"
                           style="width:52px">
                </label>
            </div>
            <div data-region="team-summary"></div>
        </div>
    `;
}

function paint() {
    render(api.root, renderRoot());
}

// =============================================================================
// Add / swap flow
// =============================================================================

// Open a picker letting the user choose between roster resonators and saved
// builds. Roster picks create+save a fresh build (Q2); saved-build picks add
// the existing build id directly.
function openAddPicker(slotIndex, { swap = false } = {}) {
    const builds = api.listBuilds();
    const usedIds = new Set(api.team.slots.filter(Boolean));

    // Saved builds not already in the team (unless we're swapping this slot).
    const availableBuilds = builds.filter(b =>
        !usedIds.has(b.id) || (swap && b.id === api.team.slots[slotIndex])
    );

    // Items: a tagged union of {kind:'build'} and {kind:'roster'}.
    const buildItems = availableBuilds.map(b => {
        const r = api.dataset.resonators.find(x => x.id === b.resonatorId);
        return { kind: 'build', build: b, resonator: r, name: b.name, resoName: r?.name ?? '' };
    });
    const rosterItems = api.dataset.resonators.map(r => ({
        kind: 'roster', resonator: r, name: r.name, resoName: r.name,
    }));

    const items = [...buildItems, ...rosterItems];

    modal.open({
        title: swap ? `Swap slot ${slotIndex + 1}` : `Add to slot ${slotIndex + 1}`,
        items,
        searchFields: ['name', 'resoName'],
        showCounts: true,
        totalCount: items.length,
        filters: [
            {
                kind: 'source', label: 'Source',
                options: [
                    { value: 'build', label: 'Saved builds', test: (it) => it.kind === 'build' },
                    { value: 'roster', label: 'Roster', test: (it) => it.kind === 'roster' },
                ],
            },
        ],
        renderRow: (it) => {
            const r = it.resonator;
            const elColor = r?.elementColor ?? 'var(--accent)';
            const icon = r?.iconUrl
                ? `<img class="option__icon" src="${esc(r.iconUrl)}" alt="" loading="lazy" onerror="this.style.display='none'">`
                : `<span class="option__icon option__icon--missing"></span>`;
            const sub = it.kind === 'build'
                ? `Saved build · Lv ${it.build.level}`
                : 'Roster · new build';
            const badge = it.kind === 'build' ? 'B' : 'R';
            return `
                ${icon}
                <div class="option__body" style="--el-color:${esc(elColor)}">
                    <span class="option__name">${esc(it.name)}</span>
                    <span class="option__sub">${esc(sub)}</span>
                </div>
                <span class="option__badge">${badge}</span>
            `;
        },
        onPick: (it) => {
            if (!it) return;
            let buildId;
            if (it.kind === 'build') {
                buildId = it.build.id;
            } else {
                // Roster pick → create + save a fresh build, then reference it (Q2).
                const fresh = api.createBuildForResonator(it.resonator);
                buildId = fresh.id;
            }
            if (swap) {
                api.team = setTeamSlot(api.team, slotIndex, buildId);
            } else {
                const res = addBuildToTeam(api.team, buildId);
                api.team = res.team;
            }
            api.onChange?.(api.team);
            paint();
            mountSummary();
        },
    });
}

// =============================================================================
// Team summary (combined stats / shared element / future team buffs)
// =============================================================================

function mountSummary() {
    const region = api.root.querySelector('[data-region="team-summary"]');
    if (!region) return;

    const slots = resolveTeamSlots(api.team, api.resolveBuild).filter(s => s.build);
    if (slots.length === 0) {
        region.innerHTML = `<div class="team-summary team-summary--empty">Add resonators to see team-level information.</div>`;
        return;
    }

    // Element spread
    const elementCounts = {};
    for (const s of slots) {
        const r = resonatorFor(s.build);
        if (!r) continue;
        const elName = api.dataset.elements?.find(e => e.id === r.element)?.name ?? '—';
        elementCounts[elName] = (elementCounts[elName] ?? 0) + 1;
    }
    const elementSpread = Object.entries(elementCounts)
        .map(([el, n]) => `${el}${n > 1 ? ` ×${n}` : ''}`)
        .join(' · ');

    // Check if any member has a rotation defined
    const hasRotations = slots.some(s => (s.build.rotation?.length ?? 0) > 0);

    // Run team sim
    const target = { level: 90, atkLv: 90, resistances: { 1: 0.1, 2: 0.1, 3: 0.1, 4: 0.1, 5: 0.1, 6: 0.1 } };
    const teamResult = hasRotations ? simulateTeamRotation({
        team: api.team,
        resolveBuild: api.resolveBuild,
        dataset: api.dataset,
        target,
        passCount: api.passCount ?? 1,
    }) : null;

    const fmtNum = n => Math.round(n).toLocaleString();
    const fmtTime = s => `${s.toFixed(2)}s`;

    // Per-member totals rows
    const memberRows = (teamResult?.memberTotals ?? []).map(m => {
        const r = api.dataset.resonators.find(x => x.id === m.resonatorId);
        const name = r?.name ?? '?';
        const pct = teamResult.totals.damage > 0
            ? (m.damage / teamResult.totals.damage * 100).toFixed(1) : '—';
        const dps = m.time > 0 ? fmtNum(m.damage / m.time) : '—';
        const offFieldBadge = m.offFieldDmg > 0
            ? `<span class="ts-badge ts-badge--offield" title="Off-field: ${fmtNum(m.offFieldDmg)}">${(m.offFieldDmg / m.damage * 100).toFixed(0)}% off</span>`
            : '';
        const healBadge = m.heal > 0 ? `<span class="ts-badge ts-badge--heal"   title="Healing">♥ ${fmtNum(m.heal)}</span>` : '';
        const shieldBadge = m.shield > 0 ? `<span class="ts-badge ts-badge--shield" title="Shielding">◆ ${fmtNum(m.shield)}</span>` : '';
        return `
            <div class="ts-row ts-row--member">
                <span class="ts-row__name">${esc(name)}${offFieldBadge}${healBadge}${shieldBadge}</span>
                <span class="ts-row__val">${esc(fmtNum(m.damage))}</span>
                <span class="ts-row__val">${esc(dps)}/s</span>
                <span class="ts-row__val ts-row__pct">${esc(pct)}%</span>
            </div>
        `;
    }).join('');

    // Timeline segments — proportional widths
    const totalTime = teamResult?.totals.time ?? 0;
    const SLOT_COLORS = ['var(--accent)', '#ff9c66', '#c8a2ff'];
    const timelineSegs = (teamResult?.segments ?? []).map(seg => {
        const pct = totalTime > 0 ? ((seg.endTime - seg.startTime) / totalTime * 100) : 0;
        const col = SLOT_COLORS[seg.slotIndex] ?? 'var(--line-base)';
        const opacity = seg.kind === 'outro' ? '0.3' : seg.kind === 'intro' ? '0.65' : '1';
        const title = `${seg.resonatorName} — ${seg.kind} [${seg.startTime.toFixed(2)}–${seg.endTime.toFixed(2)}s]${seg.damage > 0 ? ' · ' + fmtNum(seg.damage) + ' dmg' : ''}`;
        return `<div class="ts-seg ts-seg--${esc(seg.kind)}" style="width:${pct.toFixed(2)}%;background:${col};opacity:${opacity}" title="${esc(title)}"></div>`;
    }).join('');

    const simBlock = teamResult ? `
        <div class="ts-totals">
            <div class="ts-row ts-row--head">
                <span class="ts-row__label">Total damage</span>
                <span class="ts-row__val">${esc(fmtNum(teamResult.totals.damage))}</span>
            </div>
            ${teamResult.totals.offFieldDmg > 0 ? `
            <div class="ts-row ts-row--sub">
                <span class="ts-row__label ts-row__label--indent">↳ Off-field</span>
                <span class="ts-row__val ts-row__val--dim">${esc(fmtNum(teamResult.totals.offFieldDmg))} (${(teamResult.totals.offFieldDmg / teamResult.totals.damage * 100).toFixed(1)}%)</span>
            </div>` : ''}
            ${teamResult.totals.heal > 0 ? `
            <div class="ts-row ts-row--sub">
                <span class="ts-row__label ts-row__label--indent ts-row__label--heal">♥ Healing</span>
                <span class="ts-row__val ts-row__val--heal">${esc(fmtNum(teamResult.totals.heal))}</span>
            </div>` : ''}
            ${teamResult.totals.shield > 0 ? `
            <div class="ts-row ts-row--sub">
                <span class="ts-row__label ts-row__label--indent ts-row__label--shield">◆ Shielding</span>
                <span class="ts-row__val ts-row__val--shield">${esc(fmtNum(teamResult.totals.shield))}</span>
            </div>` : ''}
            <div class="ts-row ts-row--head">
                <span class="ts-row__label">Rotation time</span>
                <span class="ts-row__val">${esc(fmtTime(teamResult.totals.time))}</span>
            </div>
            <div class="ts-row ts-row--head">
                <span class="ts-row__label">Team DPS</span>
                <span class="ts-row__val ts-row__val--accent">${esc(fmtNum(teamResult.totals.dps))}/s</span>
            </div>
        </div>
        <div class="ts-member-header">
            <span>Resonator</span><span>Damage</span><span>DPS</span><span>Share</span>
        </div>
        ${memberRows}
        <div class="ts-timeline" title="Rotation timeline">
            ${timelineSegs}
        </div>
        <div class="ts-legend">
            <span class="ts-legend__item ts-legend__item--rotation">Rotation</span>
            <span class="ts-legend__item ts-legend__item--intro">Intro</span>
            <span class="ts-legend__item ts-legend__item--outro">Outro</span>
        </div>
    ` : `<div class="ts-no-rotation">Add rotations to each build to see team DPS.</div>`;

    region.innerHTML = `
        <div class="team-summary">
            <h3 class="section__title">Team overview</h3>
            <div class="ts-row">
                <span class="ts-row__label">Elements</span>
                <span class="ts-row__val">${esc(elementSpread)}</span>
            </div>
            ${simBlock}
            <div class="ts-hint">
                Intro/Outro handoff timing included. Shared team buffs coming soon.
            </div>
        </div>
    `;
}

// =============================================================================
// Events
// =============================================================================

function bind() {
    const root = api.root;

    on(root, 'input', '[data-action="rename"]', (e) => {
        api.team = setTeamName(api.team, e.target.value);
        api.onChange?.(api.team);
    });

    on(root, 'change', '[data-action="set-passes"]', (e) => {
        api.passCount = Math.max(1, Math.min(10, Number(e.target.value) || 1));
        mountSummary();
    });

    on(root, 'click', '[data-action="add-slot"]', (_e, btn) => {
        openAddPicker(Number(btn.dataset.slot), { swap: false });
    });

    on(root, 'click', '[data-action="swap-slot"]', (_e, btn) => {
        openAddPicker(Number(btn.dataset.slot), { swap: true });
    });

    on(root, 'click', '[data-action="remove-slot"]', (_e, btn) => {
        api.team = setTeamSlot(api.team, Number(btn.dataset.slot), null);
        api.onChange?.(api.team);
        paint();
        mountSummary();
    });

    on(root, 'click', '[data-action="open-build"]', (_e, btn) => {
        api.onOpenBuild?.(btn.dataset.build);
    });
}

// =============================================================================
// Public mount
// =============================================================================

export function mount(root, config) {
    api = {
        root,
        dataset: config.dataset,
        team: config.team,
        onChange: config.onChange,
        onOpenBuild: config.onOpenBuild,
        resolveBuild: config.resolveBuild,
        listBuilds: config.listBuilds,
        createBuildForResonator: config.createBuildForResonator,
        passCount: 1,
    };
    paint();
    mountSummary();
    if (!root.__teamBound) {
        root.__teamBound = true;
        bind();
    }
    return {
        update(team) {
            api.team = team;
            paint();
            mountSummary();
        },
    };
}