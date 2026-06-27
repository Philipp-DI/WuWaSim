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
 *   #roster            -> v2 resonator roster (browse/filter/sort)
 */

import { loadDataset } from '../data/loader.js';
import { loadMeta } from '../data/meta-loader.js';
import { mount as mountEditorV2 } from './components/build-editor-v2.js';
import { mount as mountTeamSimV2 } from './components/team-editor-v2.js';
import { mount as mountRosterV2 } from './components/roster-v2.js';
import { mount as mountCompareV2 } from './components/compare-v2.js';
import { mount as mountMyBuildsV2 } from './components/my-builds-v2.js';
import { renderV2Header, bindV2Header, getV2Theme, toggleV2Theme } from './components/v2-header.js';
import { html, render } from './dom.js';
import {
    listBuilds, readBuild, saveBuild, deleteBuild, duplicateBuild,
    duplicateBuildWithGuardrails,
    listTeams, readTeam, saveTeam, deleteTeam,
    setCurrentBuildId, setCurrentTeamId, readMeta,
    readCompareSlots, writeCompareSlots,
} from '../data/storage.js';
import { createBuild } from '../core/build.js';
import { createTeam } from '../core/team.js';
import { decodeBuild } from '../data/build-codec.js';

// ---------- DOM regions (set on boot) ----------
let root = document.getElementById('main');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const versionTag = document.getElementById('version-tag');
const v2NavBtn = document.getElementById('v2-nav-btn');

// ---------- App state ----------
let dataset = null;
let meta = null;       // P12 optimizer output (data/wuwa-meta.json); null if missing/stale
let currentBuild = null;     // editor's working copy
let saveTimer = null;     // debounce handle for autosave
let teamSaveTimer = null; // debounce handle for team autosave
let editorV2Handle = null;   // mountEditorV2's return value — used to fire the "Saved" toast from the debounced autosave path
let pendingBuildToast = null; // one-shot toast consumed by the next showEditorV2 mount (e.g. post-duplicate)

const SAVE_DEBOUNCE_MS = 400;

// Status hooks live in the (removed) classic topbar; v2 pages surface their own
// toasts instead. Guarded so calls are harmless no-ops when the elements are
// absent, while still updating them if a host page ever provides them.
function setStatus(label, isIdle = false) {
    if (statusText) statusText.textContent = label;
    if (statusDot) statusDot.classList.toggle('idle', isIdle);
}

// v2 pages render their own sticky header (v2-header.js) and want a full-bleed
// <main> (build-v2.css's `body.v2-mode main` rule). The global loading/error
// screens render boxed instead, so they clear v2-mode.
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
    else if (tab === 'roster') goto('#roster');
    else if (tab === 'compare') goto('#compare');
    else if (tab === 'mybuilds') goto('#mybuilds');
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
// Editor view
// =============================================================================

function showEditorForNew(resonatorId) {
    const resonator = dataset.resonators.find(r => r.id === resonatorId);
    if (!resonator) { goto('#roster'); return; }
    currentBuild = createBuild(resonator);
    // Do NOT save immediately — only persist when the user makes a real change
    // (handleBuildChange fires). This prevents empty default builds from
    // accumulating every time a user clicks a resonator to inspect it.
    setCurrentBuildId(currentBuild.id);
    // Picking a resonator from the Roster opens it on the v2 Build page.
    history.replaceState(null, '', `#edit2/${currentBuild.id}`);
    showEditorV2(currentBuild.id);
}


// Build Page v2 — the main build editor (#edit2/<id>). Carries the shared v2
// header (EDITOR active).
function showEditorV2(buildId) {
    // Prefer the in-memory build when it's already the one requested — a
    // freshly-created build (showEditorForNew) isn't persisted until the
    // first real edit, so re-reading from storage here would lose it.
    if (!(currentBuild && currentBuild.id === buildId)) {
        currentBuild = readBuild(buildId, { dataset });
    }
    if (!currentBuild) { goto('#roster'); return; }
    setShellMode(true);
    setCurrentBuildId(currentBuild.id);
    const toastOnMount = pendingBuildToast;
    pendingBuildToast = null;
    editorV2Handle = mountEditorV2(root, {
        dataset,
        meta,
        build: currentBuild,
        onChange: handleBuildChange,
        toastOnMount,
        onSave: () => {
            if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
            try {
                saveBuild(currentBuild, { dataset });
                setStatus(`Saved · ${currentBuild.name}`, true);
                editorV2Handle?.notifySaved();
            } catch (err) {
                console.error(err);
                setStatus('Save failed');
            }
        },
        onDuplicate: () => {
            // A freshly-opened, never-edited build only exists in memory
            // (showEditorForNew deliberately skips the initial save — see its
            // comment) — ensure it's actually persisted before duplicating,
            // otherwise duplicateBuildWithGuardrails can't find a source.
            if (!readBuild(currentBuild.id, { dataset })) saveBuild(currentBuild, { dataset });
            const result = duplicateBuildWithGuardrails(currentBuild.id, { dataset });
            if (!result.ok) return result;
            pendingBuildToast = `Duplicated as "${result.build.name}"`;
            goto(`#edit2/${result.build.id}`);
            return result;
        },
        onDelete: () => {
            deleteBuild(currentBuild.id);
            currentBuild = null;
            editorV2Handle = null;
            goto('#roster');
        },
        listBuilds: () => listBuilds({ dataset }),
        onPickBuild: (id) => goto(`#edit2/${id}`),
        onPickNewResonator: (resonatorId) => goto(`#new/${resonatorId}`),
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
        if (!team) { goto('#roster'); return; }
    } else {
        // Resume the most recently opened team, not just the first one ever
        // created — readMeta().currentTeamId mirrors how the build editor
        // tracks currentBuildId. Falls back to the first saved team (e.g.
        // first-ever visit, or the remembered team was since deleted), then
        // to a fresh one if nothing is saved at all.
        const teams = listTeams();
        const rememberedId = readMeta().currentTeamId;
        const remembered = rememberedId ? teams.find(t => t.id === rememberedId) : null;
        team = remembered ?? teams[0] ?? saveTeam(createTeam());
        history.replaceState(null, '', `#party/${team.id}`);
    }
    setCurrentTeamId(team.id);

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
        onNewTeam: () => goto(`#party/${saveTeam(createTeam()).id}`),
        onDeleteTeam: (id) => {
            // Cancel any pending debounced autosave so it can't resurrect the
            // team we're deleting, then resume another team (or a fresh one).
            if (teamSaveTimer) { clearTimeout(teamSaveTimer); teamSaveTimer = null; }
            deleteTeam(id);
            setStatus('Team deleted', true);
            goto('#party');
        },
        onOpenBuild: (id) => goto(`#edit2/${id}`),
    });
    bindV2HeaderShell();
    setStatus(`Team sim · ${team.name}`);
}

// =============================================================================
// Roster view — v2
// =============================================================================

function showRosterV2() {
    setShellMode(true);
    mountRosterV2(root, {
        dataset,
        theme: getV2Theme(),
        onOpenResonator: (resonatorId) => goto(`#new/${resonatorId}`),
    });
    bindV2HeaderShell();
    setStatus(`Roster · ${dataset.resonators.length} resonators`, true);
}

// =============================================================================
// Compare view — v2
// =============================================================================

function showCompareV2() {
    setShellMode(true);
    mountCompareV2(root, {
        dataset,
        theme: getV2Theme(),
        listBuilds: () => listBuilds({ dataset }),
        listTeams: () => listTeams(),
        resolveBuild: (id) => readBuild(id, { dataset }),
        loadCompareState: () => readCompareSlots(),
        saveCompareState: (state) => writeCompareSlots(state),
        onOpenBuild: (id) => goto(`#edit2/${id}`),
        saveTeam: (t) => saveTeam(t),
        createBuildForResonator: (resonator) => saveBuild(createBuild(resonator), { dataset }),
    });
    bindV2HeaderShell();
    setStatus('Compare', true);
}

// My Builds (MY BUILDS) view — v2. Minimal management list for saved builds:
// open / duplicate / delete, or jump to the Roster to create a new one.
function showMyBuildsV2() {
    setShellMode(true);
    mountMyBuildsV2(root, {
        dataset,
        theme: getV2Theme(),
        listBuilds: () => listBuilds({ dataset }),
        onOpen: (id) => goto(`#edit2/${id}`),
        onDuplicate: (id) => {
            const copy = duplicateBuild(id, { dataset });
            if (copy) setStatus(`Duplicated · ${copy.name}`, true);
        },
        onDelete: (id) => { deleteBuild(id); },
        onNew: () => goto('#roster'),
    });
    bindV2HeaderShell();
    setStatus(`${listBuilds({ dataset }).length} build${listBuilds({ dataset }).length === 1 ? '' : 's'}`, true);
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
    goto(id ? `#edit2/${id}` : '#roster');
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
            editorV2Handle?.notifySaved();
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

// Every v2 page component delegates its clicks via on(root, ...) (dom.js),
// which is a bare addEventListener with no way to remove it — and each
// component's own bind-once guard (e.g. root.__partyBound) only stops *that*
// component from re-binding, not a *different* component's still-attached
// handler from a page visited earlier this session. Because #main is reused
// across every navigation, two pages sharing a data-act name (e.g.
// "pick-weapon" on both the Build page and the Teams page) would both fire
// on click — the stale page's handler repainting #main with its own,
// unrelated module state. Cloning-and-replacing #main on every route() drops
// every listener attached to the old node (clones never carry listeners),
// so only the page actually being routed to ever has live handlers.
function resetRoot() {
    const fresh = root.cloneNode(false);
    root.replaceWith(fresh);
    root = fresh;
    // Body-appended overlays (hover tooltip, sonata menu) are owned by
    // whichever page last created them and are never torn down on
    // navigation — orphaned ones must be removed here, not left floating
    // over the next page.
    document.querySelectorAll('.bv2-tooltip, .bv2-sonata-menu').forEach(el => el.remove());
}

function route() {
    resetRoot();
    const hash = location.hash || '#roster';
    const newMatch = hash.match(/^#new\/(\d+)$/);
    const edit2Match = hash.match(/^#edit2\/([\w-]+)$/);
    const shareMatch = hash.match(/^#share\/(.+)$/);
    const partyMatch = hash.match(/^#party(?:\/([\w-]+))?$/);

    // build-editor-v2.js's `api` is a module-level singleton whose toast
    // paints directly onto #main via the handle's notifySaved() — leaving a
    // stale handle around after navigating away would let a delayed
    // debounced-autosave callback repaint the v2 build page over whatever
    // view is now showing. Only showEditorV2 (via newMatch/edit2Match) sets
    // it again, immediately after this dispatch.
    editorV2Handle = null;

    if (newMatch) {
        showEditorForNew(Number(newMatch[1]));
    } else if (edit2Match) {
        showEditorV2(edit2Match[1]);
    } else if (shareMatch) {
        importSharedBuild(shareMatch[1]);
    } else if (partyMatch) {
        showTeamSimV2(partyMatch[1]);
    } else if (hash === '#mybuilds') {
        showMyBuildsV2();
    } else if (hash === '#compare') {
        showCompareV2();
    } else {
        // #roster is the default v2 landing (browse + create builds).
        showRosterV2();
    }
}

// Decode a shared build from the URL hash, save it as a new build, and
// open the editor. On failure shows an alert and routes to the roster.
function importSharedBuild(encoded) {
    const decoded = decodeBuild(encoded, dataset);
    if (!decoded) {
        alert('Could not import shared build — the link looks invalid.');
        goto('#roster');
        return;
    }
    // Tag the build so it's discoverable in My Builds.
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
        // Optimizer meta loads in the background — a missing/stale file is fine
        // (the build page falls back to live sim), so it never blocks boot.
        meta = await loadMeta().catch(() => null);
        if (versionTag) versionTag.textContent = `schema v${dataset.schemaVersion}`;

        // Listener must be attached before any hash assignment below — a
        // hash change fires its event asynchronously, but assigning it and
        // returning without ever attaching the listener means the redirect
        // below leaves the app stuck on the loading screen forever.
        window.addEventListener('hashchange', route);
        v2NavBtn?.addEventListener('click', goToV2Preview);

        // With no explicit hash, land on the v2 Build page for the
        // current/last/first build, falling back to the Roster if no builds
        // exist yet. goToV2Preview encapsulates that fallback and routes via
        // the hashchange listener attached above.
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