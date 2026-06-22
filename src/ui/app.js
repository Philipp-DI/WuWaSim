/**
 * App entry point.
 *
 * Manages the top-level view state: picker, editor, or builds drawer.
 * Owns the loaded dataset and the currently-edited build. Persistence
 * goes through src/data/storage.js — UI never touches localStorage.
 *
 * View transitions are simple (no router): the URL hash mirrors the
 * current view so reloads preserve state. Hashes are deliberately
 * minimal so they're safe to share.
 *
 *   #picker            -> character grid
 *   #builds            -> saved builds drawer
 *   #edit/<buildId>    -> build editor for that build
 *   #new/<resonatorId> -> create + edit a new build for that resonator
 */

import { loadDataset } from '../data/loader.js';
import { mount as mountPicker } from './components/character-picker.js';
import { mount as mountEditor } from './components/build-editor.js';
import { mount as mountEditorV2 } from './components/build-editor-v2.js';
import { mount as mountTeamEditor } from './components/team-editor.js';
import { mount as mountTeamSimV2 } from './components/team-editor-v2.js';
import { renderV2Header, bindV2Header, getV2Theme, toggleV2Theme } from './components/v2-header.js';
import * as kameraImporter from './components/kamera-importer.js';
import { html, raw, render, esc } from './dom.js';
import * as storage from '../data/storage.js';
import {
    listBuilds, readBuild, saveBuild, deleteBuild, clearAllBuilds, duplicateBuild,
    listTeams, readTeam, saveTeam, deleteTeam, clearAllTeams,
    setCurrentBuildId, readMeta, isAvailable,
} from '../data/storage.js';
import { createBuild, isPristineBuild } from '../core/build.js';
import { createTeam, setTeamSlot, addBuildToTeam } from '../core/team.js';
import { encodeBuild, decodeBuild } from '../data/build-codec.js';

// ---------- DOM regions (set on boot) ----------
const root = document.getElementById('main');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const versionTag = document.getElementById('version-tag');
const v2NavBtn = document.getElementById('v2-nav-btn');

// ---------- App state ----------
let dataset = null;
let currentBuild = null;     // editor's working copy
let saveTimer = null;     // debounce handle for autosave
let teamSaveTimer = null; // debounce handle for team autosave

const SAVE_DEBOUNCE_MS = 400;

function setStatus(label, isIdle = false) {
    statusText.textContent = label;
    statusDot.classList.toggle('idle', isIdle);
}

// v2 is the main experience now. v2 pages render their own sticky header
// (v2-header.js); `v2-mode` on <body> hides the classic topbar/footer so there's
// no doubled chrome. Classic ("archived") pages clear it to show the topbar.
function setShellMode(isV2) {
    document.body.classList.toggle('v2-mode', !!isV2);
}

// Header nav is shared chrome across every v2 page. Bound ONCE on #main (which
// persists across re-renders) so navigating between v2 pages never restacks
// listeners. Theme toggles the shared preference and re-routes the current view
// to repaint it in the new theme.
function bindV2HeaderShell() {
    if (root.__v2HeaderBound) return;
    root.__v2HeaderBound = true;
    bindV2Header(root, {
        onNav: handleV2Nav,
        onTheme: () => { toggleV2Theme(); route(); },
    });
}

function handleV2Nav(tab) {
    if (tab === 'build') goToV2Preview();
    else if (tab === 'party') goto('#party');
    else if (tab === 'compare') goto('#compare');
    else if (tab === 'archived') goto('#picker');
}

// =============================================================================
// Loading / error states
// =============================================================================

function showLoading() {
    setShellMode(false);
    render(root, html`
        <section class="panel">
            <div class="state">
                <span class="eyebrow">Loading</span>
                <p><span class="spinner"></span>Fetching dataset...</p>
            </div>
        </section>
    `);
}

function showError(err) {
    setShellMode(false);
    render(root, html`
        <section class="panel">
            <div class="state state--error">
                <span class="eyebrow">Error</span>
                <p>Could not load dataset.</p>
                <pre>${err && err.stack ? err.stack : String(err)}</pre>
            </div>
        </section>
    `);
}

// =============================================================================
// Picker view
// =============================================================================

function showPicker() {
    setShellMode(false);
    const buildCount = isAvailable() ? listBuilds({ dataset }).length : 0;
    const teamCount = isAvailable() ? listTeams().length : 0;
    render(root, html`
        <section class="panel" aria-labelledby="picker-title">
            <div class="panel__header">
                <h2 class="panel__title" id="picker-title">Resonators</h2>
                <div style="display:flex; gap: var(--sp-3); align-items: center;">
                    <span class="panel__meta">${formatMeta(dataset)}</span>
                    <button class="btn" data-action="show-importer">Import…</button>
                    <button class="btn ${raw(teamCount > 0 ? 'btn--primary' : '')}"
                            data-action="show-teams">
                        Teams${raw(teamCount ? ` · ${teamCount}` : '')}
                    </button>
                    <button class="btn ${raw(buildCount > 0 ? 'btn--primary' : '')}"
                            data-action="show-builds">
                        Saved builds${raw(buildCount ? ` · ${buildCount}` : '')}
                    </button>
                </div>
            </div>
            <div id="picker-root"></div>
        </section>
    `);

    mountPicker(document.getElementById('picker-root'), {
        dataset,
        onSelect: (r) => goto(`#new/${r.id}`),
    });

    root.querySelector('[data-action="show-builds"]')?.addEventListener('click', () => goto('#builds'));
    root.querySelector('[data-action="show-teams"]')?.addEventListener('click', () => goto('#teams'));
    root.querySelector('[data-action="show-importer"]')?.addEventListener('click', () => {
        kameraImporter.open({
            dataset,
            storage,
            onApplied: () => {
                showPicker();
            },
        });
    });
    setStatus('Ready', true);
}

function formatMeta(ds) {
    const date = ds.generatedAt ? new Date(ds.generatedAt).toISOString().slice(0, 10) : '—';
    return `${ds.counts.resonators} resonators · ${ds.counts.weapons} weapons · ${ds.counts.echoes} echoes · ${date}`;
}

// =============================================================================
// Builds drawer view
// =============================================================================

function showBuildsDrawer() {
    setShellMode(false);
    const builds = listBuilds({ dataset });
    render(root, html`
        <section class="panel">
            <div class="panel__header">
                <h2 class="panel__title">Saved builds</h2>
                <div style="display:flex;gap:var(--sp-2);align-items:center">
                    ${raw(builds.length > 0
        ? `<button class="btn btn--danger-outline" data-action="delete-all-builds">Delete all</button>`
        : '')}
                    <button class="btn btn--back" data-action="back-to-picker">Back to roster</button>
                </div>
            </div>
            <div class="builds-drawer">
                ${raw(builds.length === 0
            ? `<div class="builds-drawer__empty">No saved builds yet. Pick a resonator to start.</div>`
            : builds.map(b => renderBuildRow(b)).join(''))}
            </div>
        </section>
    `);

    root.querySelector('[data-action="back-to-picker"]')?.addEventListener('click', () => goto('#picker'));
    root.querySelectorAll('[data-action="open-build"]').forEach(el => {
        el.addEventListener('click', () => goto(`#edit2/${el.dataset.id}`));
    });
    root.querySelectorAll('[data-action="open-build-classic"]').forEach(el => {
        el.addEventListener('click', (e) => { e.stopPropagation(); goto(`#edit/${el.dataset.id}`); });
    });
    root.querySelectorAll('[data-action="delete-build"]').forEach(el => {
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm(`Delete "${el.dataset.name}"?`)) {
                deleteBuild(el.dataset.id);
                showBuildsDrawer();
            }
        });
    });
    root.querySelectorAll('[data-action="duplicate-build"]').forEach(el => {
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            const copy = duplicateBuild(el.dataset.id, { dataset });
            if (copy) { setStatus(`Duplicated · ${copy.name}`, true); showBuildsDrawer(); }
        });
    });
    root.querySelector('[data-action="delete-all-builds"]')?.addEventListener('click', () => {
        if (confirm(`Delete all ${builds.length} saved build${builds.length === 1 ? '' : 's'}? This cannot be undone.`)) {
            clearAllBuilds();
            showBuildsDrawer();
        }
    });
    setStatus(`${builds.length} build${builds.length === 1 ? '' : 's'}`, true);
}

function renderBuildRow(build) {
    const resonator = dataset.resonators.find(r => r.id === build.resonatorId);
    const resName = resonator?.name ?? `Resonator #${build.resonatorId}`;
    const equippedEchoes = build.echoes.filter(Boolean).length;
    const pristine = isPristineBuild(build, dataset);
    return `
        <div class="build-row">
            <div class="build-row__main" data-action="open-build" data-id="${esc(build.id)}">
                <span class="build-row__name">
                    ${esc(build.name)}
                    ${pristine ? '<span class="build-row__tag" title="No changes since creation">unmodified</span>' : ''}
                </span>
                <span class="build-row__meta">
                    ${esc(resName)} · Lv ${esc(String(build.level))}
                    · ${equippedEchoes}/5 echoes
                    ${build.weapon ? '· Wpn' : ''}
                </span>
            </div>
            <button class="build-row__btn"
                    data-action="open-build-classic"
                    data-id="${esc(build.id)}"
                    title="Open in the classic (archived) editor">classic</button>
            <button class="build-row__btn"
                    data-action="duplicate-build"
                    data-id="${esc(build.id)}"
                    title="Duplicate build">⧉</button>
            <button class="build-row__delete"
                    data-action="delete-build"
                    data-id="${esc(build.id)}"
                    data-name="${esc(build.name)}"
                    aria-label="Delete ${esc(build.name)}">×</button>
        </div>
    `;
}

// =============================================================================
// Teams drawer + editor
// =============================================================================

function showTeamsDrawer() {
    setShellMode(false);
    const teams = listTeams();
    render(root, html`
        <section class="panel">
            <div class="panel__header">
                <h2 class="panel__title">Teams</h2>
                <div style="display:flex;gap:var(--sp-2);align-items:center">
                    <button class="btn btn--primary" data-action="new-team">+ New team</button>
                    ${raw(teams.length > 0
        ? `<button class="btn btn--danger-outline" data-action="delete-all-teams">Delete all</button>`
        : '')}
                    <button class="btn btn--back" data-action="back-to-picker">Back to roster</button>
                </div>
            </div>
            <div class="builds-drawer">
                ${raw(teams.length === 0
            ? `<div class="builds-drawer__empty">No teams yet. Create one to combine up to 3 resonators.</div>`
            : teams.map(t => renderTeamRow(t)).join(''))}
            </div>
        </section>
    `);

    root.querySelector('[data-action="back-to-picker"]')?.addEventListener('click', () => goto('#picker'));
    root.querySelector('[data-action="new-team"]')?.addEventListener('click', () => {
        const team = saveTeam(createTeam());
        goto(`#team/${team.id}`);
    });
    root.querySelector('[data-action="delete-all-teams"]')?.addEventListener('click', () => {
        if (confirm(`Delete all ${teams.length} team${teams.length === 1 ? '' : 's'}? This cannot be undone.`)) {
            clearAllTeams();
            showTeamsDrawer();
        }
    });
    root.querySelectorAll('[data-action="open-team"]').forEach(el => {
        el.addEventListener('click', () => goto(`#team/${el.dataset.id}`));
    });
    root.querySelectorAll('[data-action="delete-team"]').forEach(el => {
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm(`Delete team "${el.dataset.name}"?`)) {
                deleteTeam(el.dataset.id);
                showTeamsDrawer();
            }
        });
    });
    setStatus(`${teams.length} team${teams.length === 1 ? '' : 's'}`, true);
}

function renderTeamRow(team) {
    const members = team.slots.filter(Boolean).length;
    // Resolve member resonator names for a quick preview.
    const names = team.slots
        .filter(Boolean)
        .map(id => {
            const b = readBuild(id, { dataset });
            const r = b ? dataset.resonators.find(x => x.id === b.resonatorId) : null;
            return r?.name ?? '?';
        })
        .join(', ');
    return `
        <div class="build-row">
            <div class="build-row__main" data-action="open-team" data-id="${esc(team.id)}">
                <span class="build-row__name">${esc(team.name)}</span>
                <span class="build-row__meta">
                    ${members}/3 members${names ? ' · ' + esc(names) : ''}
                </span>
            </div>
            <button class="build-row__delete"
                    data-action="delete-team"
                    data-id="${esc(team.id)}"
                    data-name="${esc(team.name)}"
                    aria-label="Delete ${esc(team.name)}">×</button>
        </div>
    `;
}

function showTeamEditor(teamId) {
    setShellMode(false);
    let team = readTeam(teamId);
    if (!team) { goto('#teams'); return; }

    render(root, html`
        <section class="panel">
            <div class="panel__header">
                <h2 class="panel__title">Team</h2>
                <div class="editor__actions">
                    <button class="btn btn--back" data-action="back-to-teams">Teams</button>
                    <button class="btn btn--back" data-action="back-to-picker">Roster</button>
                </div>
            </div>
            <div id="team-editor-root"></div>
        </section>
    `);

    mountTeamEditor(document.getElementById('team-editor-root'), {
        dataset,
        team,
        onChange: (next) => {
            team = next;
            if (teamSaveTimer) clearTimeout(teamSaveTimer);
            teamSaveTimer = setTimeout(() => {
                try { saveTeam(team); setStatus(`Saved · ${team.name}`, true); }
                catch (err) { console.error(err); setStatus('Save failed'); }
            }, SAVE_DEBOUNCE_MS);
        },
        onOpenBuild: (buildId) => goto(`#edit/${buildId}`),
        resolveBuild: (id) => readBuild(id, { dataset }),
        listBuilds: () => listBuilds({ dataset }),
        createBuildForResonator: (resonator) => {
            // Q2: roster add creates + saves a fresh build immediately so the
            // team slot has a real id to reference.
            const fresh = createBuild(resonator);
            return saveBuild(fresh, { dataset });
        },
    });

    root.querySelector('[data-action="back-to-teams"]')?.addEventListener('click', () => goto('#teams'));
    root.querySelector('[data-action="back-to-picker"]')?.addEventListener('click', () => goto('#picker'));
    setStatus(`Editing team · ${team.name}`);
}

// =============================================================================
// Editor view
// =============================================================================

function showEditorForNew(resonatorId) {
    const resonator = dataset.resonators.find(r => r.id === resonatorId);
    if (!resonator) { goto('#picker'); return; }
    currentBuild = createBuild(resonator);
    // Do NOT save immediately — only persist when the user makes a real change
    // (handleBuildChange fires). This prevents empty default builds from
    // accumulating every time a user clicks a resonator to inspect it.
    setCurrentBuildId(currentBuild.id);
    // v2 is the main editor now: picking a resonator from the (archived) roster
    // opens it on the v2 Build page. The classic editor remains reachable via
    // the saved-builds drawer's per-row "classic" link.
    history.replaceState(null, '', `#edit2/${currentBuild.id}`);
    showEditorV2(currentBuild.id);
}

function showEditorForExisting(buildId) {
    // Prefer the in-memory build when it's already the one requested — e.g.
    // opening the classic (archived) editor via the saved-builds "classic"
    // link for a build that was just created and hasn't had its first real
    // edit (and therefore isn't in storage yet). Re-reading would lose it.
    if (currentBuild && currentBuild.id === buildId) {
        setCurrentBuildId(buildId);
        paintEditor();
        return;
    }
    let migrationNotice = null;
    currentBuild = readBuild(buildId, { dataset, onNotice: (m) => { migrationNotice = m; } });
    if (!currentBuild) {
        // Build not found — could be a just-inspected default that was never saved.
        goto('#picker');
        return;
    }
    setCurrentBuildId(buildId);
    paintEditor();
    // paintEditor's trailing setStatus would clobber the notice, so surface it after.
    if (migrationNotice) setStatus(migrationNotice);
}

// Build Page v2 — the main build editor (#edit2/<id>). Carries the shared v2
// header (BUILD active). Same build object + persistence as the classic editor,
// which is preserved as an archived page reachable from the saved-builds drawer.
function showEditorV2(buildId) {
    // Prefer the in-memory build when it's already the one requested — a
    // freshly-created build (showEditorForNew) isn't persisted until the
    // first real edit, so re-reading from storage here would lose it.
    if (!(currentBuild && currentBuild.id === buildId)) {
        currentBuild = readBuild(buildId, { dataset });
    }
    if (!currentBuild) { goto('#picker'); return; }
    setShellMode(true);
    setCurrentBuildId(currentBuild.id);
    mountEditorV2(root, {
        dataset,
        build: currentBuild,
        onChange: handleBuildChange,
    });
    bindV2HeaderShell();
    setStatus(`Editing · ${currentBuild.name}`);
}

// =============================================================================
// Team Simulator (PARTY) view — v2
// =============================================================================

// The v2 team-sim page. `#party` (no id) resumes the most recent saved team or
// starts a fresh one; `#party/<id>` opens a specific team. Member weapon edits
// persist to the referenced build; team edits autosave (debounced).
function showTeamSimV2(teamId) {
    setShellMode(true);
    let team;
    if (teamId) {
        team = readTeam(teamId);
        if (!team) { goto('#picker'); return; }
    } else {
        const teams = listTeams();
        team = teams[0] ?? saveTeam(createTeam());
        history.replaceState(null, '', `#party/${team.id}`);
    }

    mountTeamSimV2(root, {
        dataset,
        team,
        resolveBuild: (id) => readBuild(id, { dataset }),
        listBuilds: () => listBuilds({ dataset }),
        listTeams: () => listTeams(),
        saveTeam: (t) => saveTeam(t),
        saveBuild: (b) => saveBuild(b, { dataset }),
        createBuildForResonator: (resonator) => saveBuild(createBuild(resonator), { dataset }),
        onChangeTeam: (next) => {
            team = next;
            if (teamSaveTimer) clearTimeout(teamSaveTimer);
            teamSaveTimer = setTimeout(() => {
                try { saveTeam(team); setStatus(`Saved · ${team.name}`, true); }
                catch (err) { console.error(err); setStatus('Save failed'); }
            }, SAVE_DEBOUNCE_MS);
        },
        onLoadTeam: (id) => goto(`#party/${id}`),
    });
    bindV2HeaderShell();
    setStatus(`Team sim · ${team.name}`);
}

// =============================================================================
// Compare view — v2 stub
// =============================================================================

function showCompareV2() {
    setShellMode(true);
    render(root, html`
        <div class="bv2" data-theme="${getV2Theme()}">
            ${raw(renderV2Header({ active: 'compare', theme: getV2Theme() }))}
            <div style="max-width:1240px;margin:0 auto;padding:28px 24px 40px;">
                <div class="bv2-card">
                    <span class="bv2-card__stripe"></span>
                    <div class="bv2-card__head">
                        <div class="bv2-title"><span class="bv2-title__bar"></span><span class="bv2-title__txt">COMPARE</span></div>
                        <span class="bv2-meta">Coming soon</span>
                    </div>
                    <div class="bv2-stub">Build-vs-build comparison is on the way. For now, use BUILD to tune a resonator and PARTY to run a full team simulation.</div>
                </div>
            </div>
        </div>
    `);
    bindV2HeaderShell();
    setStatus('Compare (coming soon)', true);
}

// Global header shortcut into the v2 build page — for manual review without
// first navigating into a specific build. Prefers whatever's already in
// context (open build, last-edited build, most recent saved build) and falls
// back to the picker if none exists yet.
function goToV2Preview() {
    if (!dataset) return;
    const id = currentBuild?.id
        ?? readMeta().currentBuildId
        ?? listBuilds({ dataset })[0]?.id
        ?? null;
    // showEditorV2 itself falls back to #picker if `id` doesn't resolve to a
    // real build, so no need to duplicate that validation here.
    goto(id ? `#edit2/${id}` : '#picker');
}

function paintEditor() {
    if (!currentBuild) return;
    setShellMode(false);
    render(root, html`
        <section class="panel">
            <div class="panel__header">
                <h2 class="panel__title">Build</h2>
                <div class="editor__actions">
                    <button class="btn btn--back" data-action="back-to-picker">Roster</button>
                    <button class="btn" data-action="add-to-team">+ Team</button>
                    <button class="btn" data-action="share-build">Share</button>
                    <button class="btn" data-action="back-to-builds">Saved builds</button>
                    <button class="btn btn--primary" data-action="new-design">New design ▸</button>
                </div>
            </div>
            <div id="editor-root"></div>
        </section>
    `);

    mountEditor(document.getElementById('editor-root'), {
        dataset,
        build: currentBuild,
        onChange: handleBuildChange,
        onBack: () => goto('#picker'),
    });

    root.querySelector('[data-action="back-to-picker"]')?.addEventListener('click', () => goto('#picker'));
    root.querySelector('[data-action="back-to-builds"]')?.addEventListener('click', () => goto('#builds'));
    root.querySelector('[data-action="share-build"]')?.addEventListener('click', () => shareCurrentBuild());
    root.querySelector('[data-action="add-to-team"]')?.addEventListener('click', () => addCurrentBuildToTeam());
    root.querySelector('[data-action="new-design"]')?.addEventListener('click', () => goto(`#edit2/${currentBuild.id}`));

    setStatus(`Editing · ${currentBuild.name}`);
}

// Add the current editor build to a team. Saves the build first (it may be an
// unsaved default — Q2: explicit team-add is a deliberate action that persists).
// Then prompts for which team (or a new one) via the modal picker.
function addCurrentBuildToTeam() {
    if (!currentBuild) return;
    // Persist the build so the team has a real id to reference.
    currentBuild = saveBuild(currentBuild, { dataset });
    setCurrentBuildId(currentBuild.id);

    import('./components/modal-picker.js').then(modal => {
        const teams = listTeams();
        // Items: existing teams (that have room or already contain this build)
        // plus a synthetic "new team" entry.
        const teamItems = teams.map(t => ({ kind: 'team', team: t, name: t.name }));
        const items = [{ kind: 'new', name: '+ Create new team' }, ...teamItems];

        modal.open({
            title: `Add "${currentBuild.name}" to team`,
            items,
            searchFields: ['name'],
            renderRow: (it) => {
                if (it.kind === 'new') {
                    return `<div class="option__body"><span class="option__name">+ Create new team</span>
                            <span class="option__sub">Start a fresh team with this build</span></div>`;
                }
                const members = it.team.slots.filter(Boolean).length;
                const has = it.team.slots.includes(currentBuild.id);
                const full = members >= 3 && !has;
                const sub = has ? 'Already in this team'
                    : full ? 'Team full (3/3)'
                        : `${members}/3 members`;
                return `<div class="option__body"><span class="option__name">${esc(it.team.name)}</span>
                        <span class="option__sub">${esc(sub)}</span></div>`;
            },
            onPick: (it) => {
                if (!it) return;
                if (it.kind === 'new') {
                    let team = createTeam();
                    team = setTeamSlot(team, 0, currentBuild.id);
                    saveTeam(team);
                    goto(`#team/${team.id}`);
                    return;
                }
                const res = addBuildToTeam(it.team, currentBuild.id);
                if (!res.added && !it.team.slots.includes(currentBuild.id)) {
                    alert('That team is full (3/3).');
                    return;
                }
                saveTeam(res.team);
                setStatus(`Added to · ${res.team.name}`, true);
                goto(`#team/${res.team.id}`);
            },
        });
    });
}

// Encode the current build into a share URL and copy to clipboard.
// Falls back to a prompt() if clipboard access is denied.
function shareCurrentBuild() {
    if (!currentBuild) return;
    const encoded = encodeBuild(currentBuild);
    if (!encoded) {
        alert('Could not generate share link — the build is missing required fields.');
        return;
    }
    const url = `${location.origin}${location.pathname}#share/${encoded}`;
    if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(url).then(
            () => setStatus('Share link copied', true),
            () => promptCopy(url),
        );
    } else {
        promptCopy(url);
    }
}
function promptCopy(url) {
    prompt('Copy the share link:', url);
}

function handleBuildChange(nextBuild) {
    currentBuild = nextBuild;
    setStatus(`Editing · ${nextBuild.name}`);
    // Debounced autosave keeps the rename input snappy.
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        try {
            saveBuild(currentBuild, { dataset });
            setStatus(`Saved · ${currentBuild.name}`, true);
        } catch (err) {
            console.error(err);
            setStatus('Save failed');
        }
    }, SAVE_DEBOUNCE_MS);
}

// =============================================================================
// Router
// =============================================================================

function goto(hash) {
    if (location.hash === hash) {
        // Same hash — force a re-route since hashchange won't fire.
        route();
    } else {
        location.hash = hash;
    }
}

function route() {
    const hash = location.hash || '#picker';
    const newMatch = hash.match(/^#new\/(\d+)$/);
    const edit2Match = hash.match(/^#edit2\/([\w-]+)$/);
    const editMatch = hash.match(/^#edit\/([\w-]+)$/);
    const shareMatch = hash.match(/^#share\/(.+)$/);
    const teamMatch = hash.match(/^#team\/([\w-]+)$/);
    const partyMatch = hash.match(/^#party(?:\/([\w-]+))?$/);

    if (newMatch) {
        showEditorForNew(Number(newMatch[1]));
    } else if (edit2Match) {
        showEditorV2(edit2Match[1]);
    } else if (editMatch) {
        showEditorForExisting(editMatch[1]);
    } else if (shareMatch) {
        importSharedBuild(shareMatch[1]);
    } else if (partyMatch) {
        showTeamSimV2(partyMatch[1]);
    } else if (hash === '#compare') {
        showCompareV2();
    } else if (teamMatch) {
        showTeamEditor(teamMatch[1]);
    } else if (hash === '#teams') {
        showTeamsDrawer();
    } else if (hash === '#builds') {
        showBuildsDrawer();
    } else {
        showPicker();
    }
}

// Decode a shared build from the URL hash, save it as a new build, and
// open the editor. On failure shows an alert and routes back to picker.
function importSharedBuild(encoded) {
    const decoded = decodeBuild(encoded, dataset);
    if (!decoded) {
        alert('Could not import shared build — the link looks invalid.');
        goto('#picker');
        return;
    }
    // Tag the build so it's discoverable in the saved-builds drawer.
    decoded.name = `${decoded.name || 'Build'} (shared)`;
    saveBuild(decoded, { dataset });
    setCurrentBuildId(decoded.id);
    goto(`#edit2/${decoded.id}`);
}

// =============================================================================
// Boot
// =============================================================================

async function boot() {
    setStatus('Loading');
    showLoading();
    try {
        dataset = await loadDataset();
        if (versionTag) versionTag.textContent = `schema v${dataset.schemaVersion}`;

        // Listener must be attached before any hash assignment below — a
        // hash change fires its event asynchronously, but assigning it and
        // returning without ever attaching the listener means the redirect
        // below leaves the app stuck on the loading screen forever.
        window.addEventListener('hashchange', route);
        v2NavBtn?.addEventListener('click', goToV2Preview);

        // v2 is the main experience: with no explicit hash, land on the v2
        // Build page for the current/last/first build, falling back to the
        // (archived) roster if no builds exist yet. goToV2Preview encapsulates
        // that fallback and routes via the hashchange listener attached above.
        if (!location.hash) {
            goToV2Preview();
            return;
        }

        route();
    } catch (err) {
        console.error(err);
        showError(err);
        setStatus('Error');
    }
}

boot();