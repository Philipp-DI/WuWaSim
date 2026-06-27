/**
 * Pure effect-audit logic (PRE-P12-DATA-QUALITY.md §2). Builds the markdown
 * report from an already-compiled dataset (`data/wuwa-data.json`) — the SAME
 * resonanceChain/inherentSkills effect arrays the sim resolves via
 * `unlockedEffects`/`isEffectOnAtStep` in `src/core/buffs.js`. Auditing this
 * path (post mode-tagging, post effect-overrides merge) rather than re-running
 * the parser is the point: it's the data the engine actually consumes.
 *
 * Separated from `tools/audit-effects.mjs` (the CLI) so it's importable by
 * `tests/audit-effects.test.mjs` without file I/O.
 *
 * Caveat (documented, not fixed here): `effect.condition` is the parser's
 * truncated-to-120-chars clause text. A conditional keyword or mode name that
 * only appears past that truncation point will not be detected by these
 * checks — a false negative, not a false positive. Widening the stored
 * condition text is a parser-side change, out of scope for the audit tool.
 */

const ELEMENT_NAMES = { 1: 'Glacio', 2: 'Fusion', 3: 'Electro', 4: 'Aero', 5: 'Spectro', 6: 'Havoc' };

// Same keyword family the parser's classifyCondition uses to decide a clause
// is conditional, reimplemented independently here (cross-check, not reuse) —
// a numeric "for Ns" duration also counts, since that always implies a window.
const CONDITIONAL_KEYWORDS_RE = /\b(when|after|while|if|upon|during|once|every|casting|performing|unleashing|releasing|stacks?)\b/i;
const NUMERIC_DURATION_RE = /\bfor\s+[\d.]+\s*s\b/i;
// Worded duration phrasing ("for 10 seconds") the parser's extractDurationSeconds
// regex (`for\s+([\d.]+)\s*s\b`) does not match — a real gap, flagged below.
const WORDED_DURATION_RE = /\bfor\s+[\d.]+\s*(?:secs?|seconds)\b/i;
const UNCONDITIONAL_MULTIPLIER_RE =
    /DMG\s*Multiplier\s+of\s+[^.,;]+?\s+is\s+increased\s+by\s+[\d.]+\s*%|(?:^|[.;]\s*)[A-Za-z][\w\s]*\bDMG\s+is\s+increased\s+by\s+[\d.]+\s*%/i;

const WARNING_CATEGORIES = [
    'UNKNOWN_TRIGGER',
    'UNMAPPED_PHRASE',
    'MISSING_DURATION',
    'MISCLASSIFIED_UNCONDITIONAL',
    'MODE_NOT_TAGGED',
];

/** Detect the known PRE-P12-DATA-QUALITY.md failure patterns on one effect. */
export function detectWarnings(effect, resonator) {
    const warnings = [];
    const trig = effect.trigger, win = effect.window;
    const cond = effect.condition ?? '';

    if (trig?.type === 'unknown') warnings.push('UNKNOWN_TRIGGER');
    // skillKeys (an OR of exact step keys, e.g. Changli's Enflamement trigger)
    // is an alternate, fully-resolved match path — only flag UNMAPPED_PHRASE
    // when there's neither a resolved skillType NOR a skillKeys list.
    if (trig?.type === 'castMatch' && trig.skillType == null && !(Array.isArray(trig.skillKeys) && trig.skillKeys.length > 0)) {
        warnings.push('UNMAPPED_PHRASE');
    }

    const hasDurationText = NUMERIC_DURATION_RE.test(cond) || WORDED_DURATION_RE.test(cond);
    if (hasDurationText && effect.durationSeconds == null && win?.type !== 'seconds') {
        warnings.push('MISSING_DURATION');
    }

    if (UNCONDITIONAL_MULTIPLIER_RE.test(cond) && !CONDITIONAL_KEYWORDS_RE.test(cond)
        && !NUMERIC_DURATION_RE.test(cond) && trig?.type !== 'none') {
        warnings.push('MISCLASSIFIED_UNCONDITIONAL');
    }

    const modes = resonator.resonanceModes ?? [];
    if (modes.length) {
        const condLower = cond.toLowerCase();
        const matched = modes.find(m => condLower.includes(m.name.toLowerCase()));
        if (matched && effect.mode !== matched.key) warnings.push('MODE_NOT_TAGGED');
    }

    return warnings;
}

function formatValue(e) {
    if (typeof e.value !== 'number') return '';
    const pct = e.value * 100;
    const sign = pct >= 0 ? '+' : '';
    return `${sign}${Number(pct.toFixed(2))}%`;
}

function bracketTag(e) {
    if (e.skillType) return ` [${e.skillType}]`;
    if (e.element != null) return ` [${ELEMENT_NAMES[e.element] ?? `element ${e.element}`}]`;
    return '';
}

function formatTrigger(t) {
    if (!t) return 'MISSING';
    switch (t.type) {
        case 'none': return 'none (unconditional)';
        case 'castMatch':
            if (Array.isArray(t.skillKeys) && t.skillKeys.length > 0) return `castMatch "${t.phrase ?? t.skillKeys.join(' OR ')}" → ANY [${t.skillKeys.join(', ')}]`;
            return t.skillType != null
                ? `castMatch "${t.phrase ?? t.skillType}" → ${t.skillType}`
                : `castMatch (UNRESOLVED phrase: "${t.phrase ?? '?'}")`;
        case 'stateEnter': return `stateEnter "${t.state}"`;
        case 'modeMatch': return `modeMatch "${t.mode}"`;
        case 'unknown': return 'UNKNOWN';
        default: return t.type;
    }
}

function formatWindow(w) {
    if (!w) return 'MISSING';
    switch (w.type) {
        case 'always': return 'always';
        case 'persist': return 'persist (until rotation end)';
        case 'seconds': return `${w.seconds}s`;
        case 'stateBound':
            return Array.isArray(w.states) ? `stateBound ANY [${w.states.join(', ')}]` : `stateBound "${w.state}"`;
        default: return w.type;
    }
}

/** Yield { slotKey, effect } for every chain + inherent effect, in stable order. */
export function* iterResonatorEffects(resonator) {
    const chain = [...(resonator.resonanceChain ?? [])].sort((a, b) => a.level - b.level);
    for (const c of chain) {
        const effs = c.effects ?? [];
        for (let i = 0; i < effs.length; i++) yield { slotKey: `S${c.level}.${i}`, effect: effs[i] };
    }
    const ihs = resonator.inherentSkills ?? [];
    for (let s = 0; s < ihs.length; s++) {
        const effs = ihs[s].effects ?? [];
        for (let i = 0; i < effs.length; i++) yield { slotKey: `IH${s}.${i}`, effect: effs[i] };
    }
}

function renderResonatorSection(r, deferredForResonator = {}) {
    const entries = [...iterResonatorEffects(r)];
    const lines = [`## ${r.name}`, ''];
    let warnCount = 0, deferredCount = 0;
    const categoryCounts = Object.fromEntries(WARNING_CATEGORIES.map(c => [c, 0]));

    if (entries.length === 0) {
        lines.push('_No parsed effects._', '');
    }
    for (const { slotKey, effect: e } of entries) {
        const warnings = detectWarnings(e, r);
        const deferredReason = deferredForResonator[slotKey];
        let flag = '';
        if (deferredReason) {
            deferredCount++;
            flag = ` ⚠→DEFERRED (accepted, tracked)`;
        } else if (warnings.length) {
            warnCount += warnings.length;
            for (const w of warnings) categoryCounts[w]++;
            flag = ` ⚠ [${warnings.join(', ')}]`;
        }
        const valuePart = e.value != null ? ` ${formatValue(e)}` : '';
        lines.push(`${r.name} ${slotKey}  ${e.stat ?? '?'}${valuePart}${bracketTag(e)}${flag}`);
        lines.push(`  trigger: ${formatTrigger(e.trigger)}   window: ${formatWindow(e.window)}`);
        lines.push(`  source text: "${(e.condition ?? '').trim()}"`);
        if (deferredReason) lines.push(`  deferred reason: ${deferredReason}`);
        lines.push('');
    }
    return { lines, effectCount: entries.length, warnCount, deferredCount, categoryCounts };
}

function mergeCounts(target, source) {
    for (const k of WARNING_CATEGORIES) target[k] += source[k];
}

/**
 * Build the full audit report.
 * @param {object} dataset — parsed wuwa-data.json
 * @param {object} [opts]
 * @param {number[]} [opts.deepAuditIds] — resonator ids surfaced in their own
 *   summary block (the P12 seed set + the four Resonance Mode characters).
 * @param {Object<string, Object<string, string>>} [opts.deferred] —
 *   data/effect-overrides.json's `deferred` map: resonatorId -> slotKey ->
 *   reason. Slots listed here are explicitly accepted exceptions (still shown
 *   with their reason, excluded from warning counts and the gate check) —
 *   distinct from entries nobody has triaged yet.
 * @returns {{ markdown: string, totalEffects: number, totalWarnings: number,
 *             totalDeferred: number, categoryCounts: object,
 *             deepAuditWarnings: number, deepAuditDeferred: number,
 *             unresolvedCharacters: string[] }}
 */
export function buildAuditReport(dataset, opts = {}) {
    const deepAuditIds = new Set(opts.deepAuditIds ?? []);
    const deferred = opts.deferred ?? {};
    const resonators = [...(dataset.resonators ?? [])].sort((a, b) => a.name.localeCompare(b.name));

    const sections = resonators.map(r => ({ r, ...renderResonatorSection(r, deferred[String(r.id)] ?? {}) }));

    const categoryCounts = Object.fromEntries(WARNING_CATEGORIES.map(c => [c, 0]));
    let totalEffects = 0, totalWarnings = 0, totalDeferred = 0, deepAuditWarnings = 0, deepAuditDeferred = 0;
    const unresolvedCharacters = [];
    const deepAuditRows = [];

    for (const s of sections) {
        totalEffects += s.effectCount;
        totalWarnings += s.warnCount;
        totalDeferred += s.deferredCount;
        mergeCounts(categoryCounts, s.categoryCounts);
        if (s.warnCount > 0) unresolvedCharacters.push(`${s.r.name} (${s.warnCount})`);
        if (deepAuditIds.has(s.r.id)) {
            deepAuditWarnings += s.warnCount;
            deepAuditDeferred += s.deferredCount;
            deepAuditRows.push(`| ${s.r.name} | ${s.effectCount} | ${s.warnCount} | ${s.deferredCount} |`);
        }
    }

    const md = [];
    md.push('# Effect Audit Report');
    md.push('');
    md.push('Produced by `tools/audit-effects.mjs` per `docs/PRE-P12-DATA-QUALITY.md` §2.');
    md.push('Read top to bottom — ⚠ entries first.');
    md.push('');
    md.push('## Summary');
    md.push('');
    md.push(`- Resonators audited: ${sections.length}`);
    md.push(`- Total parsed effects: ${totalEffects}`);
    md.push(`- Total ⚠ flags (needs a decision): ${totalWarnings}`);
    for (const c of WARNING_CATEGORIES) md.push(`  - ${c}: ${categoryCounts[c]}`);
    md.push(`- Total deferred (explicitly accepted, tracked in data/effect-overrides.json): ${totalDeferred}`);
    md.push('');

    md.push('## P12 seed + Resonance Mode characters — gate status');
    md.push('');
    md.push('Per `PRE-P12-DATA-QUALITY.md` §6, P12 may start once the ⚠ column is all');
    md.push('zeros — entries explicitly accepted via `data/effect-overrides.json`\'s');
    md.push('`deferred` map count toward the gate as resolved-by-decision, not blocking.');
    md.push('');
    md.push('| Resonator | Effects | ⚠ (needs decision) | Deferred (accepted) |');
    md.push('| --- | --- | --- | --- |');
    md.push(...deepAuditRows);
    md.push('');
    md.push(deepAuditWarnings === 0
        ? `**Gate: CLEAR** — zero undecided ⚠ across the seed + mode set${deepAuditDeferred > 0 ? ` (${deepAuditDeferred} explicitly deferred and tracked)` : ''}.`
        : `**Gate: NOT CLEAR** — ${deepAuditWarnings} undecided ⚠ remaining in the seed + mode set.`);
    md.push('');

    if (unresolvedCharacters.length) {
        md.push('## Unresolved entries (all characters, excludes deferred)');
        md.push('');
        for (const u of unresolvedCharacters) md.push(`- ${u}`);
        md.push('');
    }

    md.push('## Per-character detail');
    md.push('');
    for (const s of sections) md.push(...s.lines);

    return {
        markdown: md.join('\n').trimEnd() + '\n',
        totalEffects,
        totalWarnings,
        totalDeferred,
        categoryCounts,
        deepAuditWarnings,
        deepAuditDeferred,
        unresolvedCharacters,
    };
}
