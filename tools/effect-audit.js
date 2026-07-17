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
        const matched = modes.find(mode => condLower.includes(mode.name.toLowerCase()));
        if (matched && effect.mode !== matched.key) warnings.push('MODE_NOT_TAGGED');
    }

    return warnings;
}

function formatValue(effect) {
    if (typeof effect.value !== 'number') return '';
    const pct = effect.value * 100;
    const sign = pct >= 0 ? '+' : '';
    return `${sign}${Number(pct.toFixed(2))}%`;
}

function bracketTag(effect) {
    if (effect.skillType) return ` [${effect.skillType}]`;
    if (effect.element != null) return ` [${ELEMENT_NAMES[effect.element] ?? `element ${effect.element}`}]`;
    return '';
}

function formatTrigger(trigger) {
    if (!trigger) return 'MISSING';
    switch (trigger.type) {
        case 'none': return 'none (unconditional)';
        case 'castMatch':
            if (Array.isArray(trigger.skillKeys) && trigger.skillKeys.length > 0) return `castMatch "${trigger.phrase ?? trigger.skillKeys.join(' OR ')}" → ANY [${trigger.skillKeys.join(', ')}]`;
            return trigger.skillType != null
                ? `castMatch "${trigger.phrase ?? trigger.skillType}" → ${trigger.skillType}`
                : `castMatch (UNRESOLVED phrase: "${trigger.phrase ?? '?'}")`;
        case 'stateEnter': return `stateEnter "${trigger.state}"`;
        case 'modeMatch': return `modeMatch "${trigger.mode}"`;
        case 'unknown': return 'UNKNOWN';
        default: return trigger.type;
    }
}

function formatWindow(window) {
    if (!window) return 'MISSING';
    switch (window.type) {
        case 'always': return 'always';
        case 'persist': return 'persist (until rotation end)';
        case 'seconds': return `${window.seconds}s`;
        case 'stateBound':
            return Array.isArray(window.states) ? `stateBound ANY [${window.states.join(', ')}]` : `stateBound "${window.state}"`;
        default: return window.type;
    }
}

/** Yield { slotKey, effect } for every chain + inherent effect, in stable order. */
export function* iterResonatorEffects(resonator) {
    const chain = [...(resonator.resonanceChain ?? [])].sort((chainA, chainB) => chainA.level - chainB.level);
    for (const chainNode of chain) {
        const effs = chainNode.effects ?? [];
        for (let i = 0; i < effs.length; i++) yield { slotKey: `S${chainNode.level}.${i}`, effect: effs[i] };
    }
    const ihs = resonator.inherentSkills ?? [];
    for (let nodeIndex = 0; nodeIndex < ihs.length; nodeIndex++) {
        const effs = ihs[nodeIndex].effects ?? [];
        for (let i = 0; i < effs.length; i++) yield { slotKey: `IH${nodeIndex}.${i}`, effect: effs[i] };
    }
}

function renderResonatorSection(resonator, deferredForResonator = {}) {
    const entries = [...iterResonatorEffects(resonator)];
    const lines = [`## ${resonator.name}`, ''];
    let warnCount = 0, deferredCount = 0;
    const categoryCounts = Object.fromEntries(WARNING_CATEGORIES.map(category => [category, 0]));

    if (entries.length === 0) {
        lines.push('_No parsed effects._', '');
    }
    for (const { slotKey, effect: effect } of entries) {
        const warnings = detectWarnings(effect, resonator);
        const deferredReason = deferredForResonator[slotKey];
        let flag = '';
        if (deferredReason) {
            deferredCount++;
            flag = ` ⚠→DEFERRED (accepted, tracked)`;
        } else if (warnings.length) {
            warnCount += warnings.length;
            for (const warning of warnings) categoryCounts[warning]++;
            flag = ` ⚠ [${warnings.join(', ')}]`;
        }
        const valuePart = effect.value != null ? ` ${formatValue(effect)}` : '';
        lines.push(`${resonator.name} ${slotKey}  ${effect.stat ?? '?'}${valuePart}${bracketTag(effect)}${flag}`);
        lines.push(`  trigger: ${formatTrigger(effect.trigger)}   window: ${formatWindow(effect.window)}`);
        lines.push(`  source text: "${(effect.condition ?? '').trim()}"`);
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
    const resonators = [...(dataset.resonators ?? [])].sort((resonatorA, resonatorB) => resonatorA.name.localeCompare(resonatorB.name));

    const sections = resonators.map(resonator => ({ r: resonator, ...renderResonatorSection(resonator, deferred[String(resonator.id)] ?? {}) }));

    const categoryCounts = Object.fromEntries(WARNING_CATEGORIES.map(category => [category, 0]));
    let totalEffects = 0, totalWarnings = 0, totalDeferred = 0, deepAuditWarnings = 0, deepAuditDeferred = 0;
    const unresolvedCharacters = [];
    const deepAuditRows = [];

    for (const section of sections) {
        totalEffects += section.effectCount;
        totalWarnings += section.warnCount;
        totalDeferred += section.deferredCount;
        mergeCounts(categoryCounts, section.categoryCounts);
        if (section.warnCount > 0) unresolvedCharacters.push(`${section.r.name} (${section.warnCount})`);
        if (deepAuditIds.has(section.r.id)) {
            deepAuditWarnings += section.warnCount;
            deepAuditDeferred += section.deferredCount;
            deepAuditRows.push(`| ${section.r.name} | ${section.effectCount} | ${section.warnCount} | ${section.deferredCount} |`);
        }
    }

    const markdown = [];
    markdown.push('# Effect Audit Report');
    markdown.push('');
    markdown.push('Produced by `tools/audit-effects.mjs` per `docs/PRE-P12-DATA-QUALITY.md` §2.');
    markdown.push('Read top to bottom — ⚠ entries first.');
    markdown.push('');
    markdown.push('## Summary');
    markdown.push('');
    markdown.push(`- Resonators audited: ${sections.length}`);
    markdown.push(`- Total parsed effects: ${totalEffects}`);
    markdown.push(`- Total ⚠ flags (needs a decision): ${totalWarnings}`);
    for (const category of WARNING_CATEGORIES) markdown.push(`  - ${category}: ${categoryCounts[category]}`);
    markdown.push(`- Total deferred (explicitly accepted, tracked in data/effect-overrides.json): ${totalDeferred}`);
    markdown.push('');

    markdown.push('## P12 seed + Resonance Mode characters — gate status');
    markdown.push('');
    markdown.push('Per `PRE-P12-DATA-QUALITY.md` §6, P12 may start once the ⚠ column is all');
    markdown.push('zeros — entries explicitly accepted via `data/effect-overrides.json`\'s');
    markdown.push('`deferred` map count toward the gate as resolved-by-decision, not blocking.');
    markdown.push('');
    markdown.push('| Resonator | Effects | ⚠ (needs decision) | Deferred (accepted) |');
    markdown.push('| --- | --- | --- | --- |');
    markdown.push(...deepAuditRows);
    markdown.push('');
    markdown.push(deepAuditWarnings === 0
        ? `**Gate: CLEAR** — zero undecided ⚠ across the seed + mode set${deepAuditDeferred > 0 ? ` (${deepAuditDeferred} explicitly deferred and tracked)` : ''}.`
        : `**Gate: NOT CLEAR** — ${deepAuditWarnings} undecided ⚠ remaining in the seed + mode set.`);
    markdown.push('');

    if (unresolvedCharacters.length) {
        markdown.push('## Unresolved entries (all characters, excludes deferred)');
        markdown.push('');
        for (const name of unresolvedCharacters) markdown.push(`- ${name}`);
        markdown.push('');
    }

    markdown.push('## Per-character detail');
    markdown.push('');
    for (const section of sections) markdown.push(...section.lines);

    return {
        markdown: markdown.join('\n').trimEnd() + '\n',
        totalEffects,
        totalWarnings,
        totalDeferred,
        categoryCounts,
        deepAuditWarnings,
        deepAuditDeferred,
        unresolvedCharacters,
    };
}
