/**
 * Rotation graph — directed graph model for mechanics-aware rotation building.
 *
 * Phase 9 uses a linear array (build.rotation: string[]) as the rotation
 * representation. This module provides the graph type that Phase 10 will
 * graduate to, plus a lossless converter from the linear format so the
 * sim can adopt the graph model incrementally.
 *
 * Architecture reference: thewuwacalculator.com uses a graph-based rotation
 * where edges represent valid sequencing ("skill A unlocks skill B"). Their
 * `ms({graph, targetSlotId})` call builds this graph before simulation.
 * We define the type now so Phase 10 has a clean target.
 *
 * Graph shape:
 *
 *   RotationGraph {
 *     nodes: Map<nodeId, RotationNode>
 *     edges: RotationEdge[]
 *   }
 *
 *   RotationNode {
 *     id:         string        — unique id within this graph (= skillKey for now)
 *     skillKey:   string        — the rotation step key (references autoSkillMap)
 *     index:      number        — original position in the linear array (for display)
 *   }
 *
 *   RotationEdge {
 *     from:       string        — nodeId of the prerequisite
 *     to:         string        — nodeId of the dependent step
 *     kind:       EdgeKind      — why this edge exists
 *   }
 *
 * EdgeKind values (used by Phase 10's availability gating):
 *   'sequence'     — simple ordering ("this step comes after that one")
 *   'prerequisite' — hard game mechanic ("Carlotta's Liberation basic only
 *                    after Liberation is cast")
 *   'optional'     — soft ordering ("can happen earlier but typically here")
 *
 * Phase 9 only uses 'sequence' edges — the linear array maps 1:1.
 * Phase 10 will add 'prerequisite' edges from character-specific rules.
 */

import { computeStateTimeline, stateActive } from './rotation-state.js';
import { computeResourceTimeline } from './rotation-resources.js';

// Mirrors sim.js TUNE_BREAK_STEP_KEY, kept as a literal for the same reason
// cooldowns.js keeps ECHO_KEY: sim.js is downstream of this module and a
// back-import would create a cycle.
const TUNE_BREAK_STEP_KEY = '__tunebreak__';

export const EdgeKind = Object.freeze({
    SEQUENCE: 'sequence',
    PREREQUISITE: 'prerequisite',
    OPTIONAL: 'optional',
});

// =============================================================================
// Factory
// =============================================================================

/**
 * Create an empty RotationGraph.
 */
export function createGraph() {
    return { nodes: new Map(), edges: [] };
}

/**
 * Convert a linear rotation array to a RotationGraph.
 * Each consecutive pair becomes a 'sequence' edge, preserving the full
 * original ordering. Duplicate skill keys become separate nodes (index
 * is used to differentiate them) so a rotation like
 * ['basic_1', 'skill', 'basic_1'] has three distinct nodes.
 *
 * @param {string[]} rotation
 * @returns {RotationGraph}
 */
export function fromLinear(rotation) {
    const graph = createGraph();
    if (!Array.isArray(rotation) || rotation.length === 0) return graph;

    // Node ids: if the same skillKey appears multiple times, suffix with
    // the occurrence index so each cast is a distinct node.
    const occurrences = {};
    const nodeIds = rotation.map(skillKey => {
        const count = (occurrences[skillKey] = (occurrences[skillKey] ?? 0) + 1);
        return count === 1 ? skillKey : `${skillKey}#${count}`;
    });

    for (let i = 0; i < rotation.length; i++) {
        graph.nodes.set(nodeIds[i], {
            id: nodeIds[i],
            skillKey: rotation[i],
            index: i,
        });
    }

    for (let i = 0; i < nodeIds.length - 1; i++) {
        graph.edges.push({
            from: nodeIds[i],
            to: nodeIds[i + 1],
            kind: EdgeKind.SEQUENCE,
        });
    }

    return graph;
}

/**
 * Convert a RotationGraph back to a linear array.
 * Only works correctly for graphs with pure 'sequence' edges (i.e., those
 * created by fromLinear). Used to round-trip through the graph without
 * changing behaviour in Phase 9.
 *
 * @param {RotationGraph} graph
 * @returns {string[]}
 */
export function toLinear(graph) {
    return [...graph.nodes.values()]
        .sort((nodeA, nodeB) => nodeA.index - nodeB.index)
        .map(node => node.skillKey);
}

/**
 * Add a prerequisite edge between two skill keys.
 * If either key doesn't appear in the graph, the edge is silently ignored
 * so Phase 10 rules can be defined ahead of the rotation being built.
 *
 * @param {RotationGraph} graph
 * @param {string} fromSkillKey   — the prerequisite skill
 * @param {string} toSkillKey     — the skill that requires it
 * @param {string} [kind]         — EdgeKind (default: 'prerequisite')
 * @returns {RotationGraph}       — mutated in place (graphs aren't immutable)
 */
export function addPrerequisite(graph, fromSkillKey, toSkillKey, kind = EdgeKind.PREREQUISITE) {
    const fromNode = [...graph.nodes.values()].find(node => node.skillKey === fromSkillKey);
    const toNode = [...graph.nodes.values()].find(node => node.skillKey === toSkillKey);
    if (!fromNode || !toNode) return graph;
    graph.edges.push({ from: fromNode.id, to: toNode.id, kind });
    return graph;
}

/**
 * Return the list of nodeIds that must be visited before `nodeId` is
 * available, based on all non-sequence edges pointing to it.
 * Used by Phase 10's availability checker.
 *
 * @param {RotationGraph} graph
 * @param {string} nodeId
 * @returns {string[]}
 */
export function prerequisitesFor(graph, nodeId) {
    return graph.edges
        .filter(edge => edge.to === nodeId && edge.kind !== EdgeKind.SEQUENCE)
        .map(edge => edge.from);
}

/**
 * Check whether all prerequisites for `nodeId` appear earlier in the graph
 * (lower `index`). Used by the Phase 10 validator.
 *
 * @param {RotationGraph} graph
 * @param {string} nodeId
 * @returns {boolean}
 */
export function prerequisitesSatisfied(graph, nodeId) {
    const node = graph.nodes.get(nodeId);
    if (!node) return false;
    return prerequisitesFor(graph, nodeId).every(prereqId => {
        const prereq = graph.nodes.get(prereqId);
        return prereq && prereq.index < node.index;
    });
}

// =============================================================================
// Rule-based validation (Phase 10)
// =============================================================================

/**
 * Analyze a linear rotation: prerequisite-rule warnings, stage-ordering
 * warnings, and satisfied-gate "grant chips" (2026-07-05).
 *
 * Character rules: for each step that has a rule, the rule is "satisfied" if
 * at least one of its `requires` keys appears at an EARLIER index (logical OR).
 * Unsatisfied rules produce a warning — never an error. The user stays free to
 * build whatever rotation they like; this only surfaces likely mistakes.
 * Validation is occurrence-aware: a gated step satisfied earlier stays
 * satisfied for later occurrences of the same key.
 *
 * Stage ordering (P11): within a staged skill family (Basic Attack Stage
 * 1/2/3…), a step at stage N should be preceded by stage N−1 — UNLESS a
 * curated mechanism legalizes the entry (all from rotation-rules.js):
 *   - a STAGE_GRANTS entry (`free` family exemption, `after` adjacency grant,
 *     `state` license via the state timeline, `resource` threshold), or
 *   - SWAP_IN_ENTRY pre-seen stages (maintainer-verified swap-in behavior), or
 *   - a character rule covering the same key (the curated rule supersedes the
 *     generic heuristic — no double warning).
 *
 * Every satisfied gate emits a CHIP so the UI can show WHY the step is legal
 * ("granted by Intro Skill"), not just stay silent.
 *
 * @param {string[]} rotation — linear rotation (build.rotation)
 * @param {object} [opts]
 * @param {Array<object>} [opts.rules]        — rulesForResonator(id)
 * @param {object|null}   [opts.skillMap]     — autoSkillMap[id]
 * @param {object}        [opts.grants]       — stageGrantsForResonator(id)
 * @param {object|null}   [opts.swapInEntry]  — swapInEntryForResonator(id)
 * @param {Array<object>} [opts.resourceDefs] — resourceDefsForResonator(id)
 * @param {Array<object>} [opts.stateDefs]    — stateDefsForResonator(id)
 * @returns {{
 *   warnings: Array<{ index, skillKey, gate, note, requires }>,
 *   chips:    Array<{ index, skillKey, kind, source, note }>,
 * }}  kind: 'rule' | 'free' | 'after' | 'state' | 'resource' | 'swapIn'
 */
export function analyzeRotation(rotation, opts = {}) {
    if (!Array.isArray(rotation) || rotation.length === 0) {
        return { warnings: [], chips: [] };
    }
    const { rules = [], skillMap = null, grants = {}, swapInEntry = null,
        resourceDefs = [], stateDefs = [] } = opts;

    const warnings = [];
    const chips = [];
    const labelOf = (key) => {
        const skillDef = skillMap?.[key];
        return (skillDef && (skillDef.name || skillDef.label)) ? (skillDef.name || skillDef.label) : key;
    };

    // ── Character-level prerequisite rules (P10) ──────────────────────────────
    const ruleByKey = new Map();
    for (const rule of rules) ruleByKey.set(rule.skillKey, rule);
    {
        const seenBefore = new Set();   // keys cast at strictly earlier indices
        for (let i = 0; i < rotation.length; i++) {
            const key = rotation[i];
            const rule = ruleByKey.get(key);
            if (rule) {
                const met = rule.requires.find(req => seenBefore.has(req));
                if (met === undefined) {
                    warnings.push({
                        index: i,
                        skillKey: key,
                        gate: rule.gate,
                        note: rule.note,
                        requires: rule.requires.slice(),
                    });
                } else {
                    chips.push({ index: i, skillKey: key, kind: 'rule', source: labelOf(met), note: rule.note });
                }
            }
            seenBefore.add(key);
        }
    }

    // ── Supporting timelines for grant resolution ─────────────────────────────
    // State timeline without stepTimes: 'seconds' states degrade to persist —
    // acceptable for legality checking (the sim computes the timed version).
    const stateTimeline = stateDefs.length
        ? computeStateTimeline(rotation, skillMap, stateDefs)
        : null;
    const initialStates = new Set(
        stateDefs.filter(def => def.initiallyActive === true).map(def => def.name.toLowerCase()),
    );
    const resources = computeResourceTimeline(rotation, resourceDefs);

    // ── Intra-skill stage ordering (P11 + grants) ─────────────────────────────
    const stage = stageOrderingWarnings(rotation, skillMap, {
        grants,
        swapInEntry,
        ruleKeys: new Set(ruleByKey.keys()),
        stateTimeline,
        initialStates,
        resources,
        labelOf,
    });
    warnings.push(...stage.warnings);
    chips.push(...stage.chips);

    // ── More than one Tune Break in a single rotation ─────────────────────────
    // A Tune Break responds to the TARGET's Off-Tune bar, which refills once per
    // cycle, so one rotation gets one. The build page still ALLOWS more (a
    // rotation here is a scratchpad, and a longer fight really does offer more
    // than one) — but the team sim caps it at one per pass for the whole team,
    // so a second is damage the team run will not credit. Flagged rather than
    // blocked, per maintainer direction 2026-08-03.
    const tuneBreakAt = rotation
        .map((key, index) => (key === TUNE_BREAK_STEP_KEY ? index : -1))
        .filter(index => index >= 0);
    for (const index of tuneBreakAt.slice(1)) {
        warnings.push({
            index,
            skillKey: TUNE_BREAK_STEP_KEY,
            gate: 'tuneBreakOncePerRotation',
            // No FIX button: resolving means REMOVING a step, which is a
            // judgment call (a long fight really does offer more than one) —
            // the same reason the cooldown banner offers none.
            noFix: true,
            note: 'Second Tune Break this rotation — the target\'s Off-Tune bar refills '
                + 'once per cycle, and the team sim credits only the first one per pass.',
            requires: [],
        });
    }

    warnings.sort((warningA, warningB) => warningA.index - warningB.index);
    chips.sort((chipA, chipB) => chipA.index - chipB.index);
    return { warnings, chips };
}

/**
 * Back-compatible warning-only validation (pre-grants signature). Callers that
 * want grant awareness + chips should use analyzeRotation() with the full
 * rotation-rules.js context instead.
 */
export function validateRotation(rotation, rules, skillMap = null) {
    return analyzeRotation(rotation, { rules, skillMap }).warnings;
}

// Parse a stage suffix: "basic_attack_3" → { family: 'basic_attack', stage: 3 }.
// Returns null when the key has no trailing _<number>. Exported so other UI
// consumers (e.g. the rotation palette's family grouping) can reuse the same
// stage-family detection instead of re-implementing it.
export function parseStage(key) {
    const match = /^(.*?)_(\d+)$/.exec(key);
    return match ? { family: match[1], stage: parseInt(match[2], 10) } : null;
}

// Families that are genuinely staged (≥2 distinct stage numbers). Prefer the
// authoritative skillMap; fall back to the rotation's own keys so the check
// still works in tests / when no skillMap is supplied.
function stagedFamilies(rotation, skillMap) {
    const stages = new Map();   // family → Set<number>
    const add = (key) => {
        const stage = parseStage(key);
        if (!stage) return;
        if (!stages.has(stage.family)) stages.set(stage.family, new Set());
        stages.get(stage.family).add(stage.stage);
    };
    const source = (skillMap && typeof skillMap === 'object') ? Object.keys(skillMap) : rotation;
    for (const key of source) add(key);

    const staged = new Set();
    for (const [fam, set] of stages) if (set.size >= 2) staged.add(fam);
    return staged;
}

function stageLabel(key, skillMap) {
    const skillDef = skillMap?.[key];
    return (skillDef && (skillDef.name || skillDef.label)) ? (skillDef.name || skillDef.label) : key;
}

/**
 * The staged family an unstaged key belongs to — longest matching prefix.
 *
 * `basic_dodge_counter` belongs to the `basic` family; Zhezhi's
 * `midair_mid_air_attack` belongs to `midair_mid_air_attack`. Longest wins so a
 * character with both `basic_*` and `basic_woolies_*` families cannot have the
 * shorter one swallow the longer one's keys.
 */
function familyOfUnstagedKey(key, staged) {
    let best = null;
    for (const family of staged) {
        if (key !== family && !key.startsWith(`${family}_`)) continue;
        if (!best || family.length > best.length) best = family;
    }
    return best;
}

/**
 * The chain slot the game itself says an unstaged key occupies, or null.
 *
 * `skillDef.chainStage` is the game's own 普攻N tag (`preprocess.mjs`), stamped
 * only on keys whose NAME carries no stage number — 41 roster-wide. Those are
 * exactly the ones the naming heuristic is blind to: a dodge counter, an intro
 * attack or an enhanced basic that occupies a chain slot without saying so.
 *
 * Sanhua's dodge counter is tagged 普攻2 and Yinlin's 普攻3, so
 * `basic_dodge_counter → basic_3` and `→ basic_4` are legal chains that both
 * warned before this. Per-character and authored — no curation, no table to
 * keep in sync.
 */
function chainSlotOf(key, skillMap, staged) {
    const stage = skillMap?.[key]?.chainStage;
    if (!(stage > 0)) return null;
    const family = familyOfUnstagedKey(key, staged);
    return family ? { family, stage } : null;
}

// Stage-ordering check: a staged step at stage N warns when stage N−1 was not
// cast earlier — unless a curated mechanism legalizes the entry (ctx from
// analyzeRotation). Returns { warnings, chips }: every legalized entry emits a
// chip naming its source, so the UI can show WHY the step is legal.
function stageOrderingWarnings(rotation, skillMap, ctx = {}) {
    const { grants = {}, swapInEntry = null, ruleKeys = new Set(),
        stateTimeline = null, initialStates = new Set(), resources = new Map(),
        labelOf = (k) => stageLabel(k, skillMap) } = ctx;

    const staged = stagedFamilies(rotation, skillMap);
    if (staged.size === 0) return { warnings: [], chips: [] };

    const warnings = [];
    const chips = [];
    // Stages genuinely CAST at earlier indices, per family.
    const seenByFamily = new Map();   // family → Set<number>
    // Swap-in pre-seen stages (maintainer-verified) — separate from cast
    // stages so their use is visible as a chip, not silent.
    const preSeen = (swapInEntry && staged.has(swapInEntry.family))
        ? new Set(swapInEntry.preSeen)
        : null;
    // Chain slots the game itself authors, filled only by keys cast EARLIER in
    // this rotation — the tag says which slot a key occupies, not that it
    // happened.
    const filledByTag = new Map();   // family → Map<stage, key cast earlier>

    for (let i = 0; i < rotation.length; i++) {
        const key = rotation[i];
        const stage = parseStage(key);
        if (!stage || !staged.has(stage.family)) {
            const slot = chainSlotOf(key, skillMap, staged);
            if (slot) {
                if (!filledByTag.has(slot.family)) filledByTag.set(slot.family, new Map());
                filledByTag.get(slot.family).set(slot.stage, key);
            }
            continue;
        }
        const seen = seenByFamily.get(stage.family) ?? new Set();

        if (stage.stage >= 2 && !seen.has(stage.stage - 1)) {
            const grant = grants[key] ?? null;
            let chip = null;

            // A grant may carry several mechanisms (e.g. Sigrika: adjacency OR
            // resource threshold) — check each until one legalizes the entry.
            if (grant?.free) {
                chip = { kind: 'free', source: 'direct entry' };
            }
            if (!chip && preSeen && stage.family === swapInEntry.family && preSeen.has(stage.stage - 1)) {
                chip = { kind: 'swapIn', source: 'swap-in combo entry' };
            }
            // The game's own chain tag: an earlier key already occupied the
            // preceding slot, so this stage follows it legally.
            const filler = filledByTag.get(stage.family)?.get(stage.stage - 1);
            if (!chip && filler) {
                chip = { kind: 'chainTag', source: stageLabel(filler, skillMap) };
            }
            if (!chip && grant?.after && i > 0 && grant.after.includes(rotation[i - 1])) {
                chip = { kind: 'after', source: labelOf(rotation[i - 1]) };
            }
            if (!chip && grant?.state) {
                const active = i > 0 ? stateTimeline?.activeAt[i - 1] : initialStates;
                if (active && stateActive(active, grant.state)) {
                    chip = { kind: 'state', source: grant.state };
                }
            }
            if (!chip && grant?.resource) {
                const lvl = resources.get(grant.resource.name.toLowerCase())?.[i] ?? 0;
                if (lvl >= grant.resource.atLeast) {
                    chip = { kind: 'resource', source: `${grant.resource.name} ≥ ${grant.resource.atLeast}` };
                }
            }

            if (chip) {
                chips.push({ index: i, skillKey: key, ...chip, note: grant?.note ?? '' });
            } else if (!ruleKeys.has(key)) {
                // A character rule covering this key supersedes the generic
                // heuristic (its own warning/chip already fired above).
                warnings.push({
                    index: i,
                    skillKey: key,
                    gate: 'sequence',
                    note: `${stageLabel(key, skillMap)} — Stage ${stage.stage - 1} should come first.`,
                    requires: [],
                });
            }
        }
        seen.add(stage.stage);
        seenByFamily.set(stage.family, seen);
    }
    return { warnings, chips };
}

/**
 * Build a RotationGraph from a linear rotation and overlay prerequisite edges
 * from the resonator's rules. The graph keeps the original 'sequence' edges
 * (1:1 with the linear order) and adds 'prerequisite' edges from each gated
 * step back to the FIRST matching requirement found earlier in the rotation.
 *
 * This is the structured representation Phase 10 UIs can render (e.g. drawing
 * dependency arrows), while validateRotation() above gives the flat warning
 * list for inline display.
 *
 * @param {string[]} rotation
 * @param {Array<object>} rules
 * @returns {RotationGraph}
 */
export function buildRuleGraph(rotation, rules) {
    const graph = fromLinear(rotation);
    if (!rules?.length) return graph;

    const ruleByKey = new Map();
    for (const rule of rules) ruleByKey.set(rule.skillKey, rule);

    // Walk in order, tracking the most recent node id for each skillKey so a
    // prerequisite edge points at the actual earlier cast (not a later one).
    const lastNodeIdForKey = new Map();
    const ordered = [...graph.nodes.values()].sort((nodeA, nodeB) => nodeA.index - nodeB.index);

    for (const node of ordered) {
        const rule = ruleByKey.get(node.skillKey);
        if (rule) {
            for (const req of rule.requires) {
                const reqNodeId = lastNodeIdForKey.get(req);
                if (reqNodeId) {
                    graph.edges.push({ from: reqNodeId, to: node.id, kind: EdgeKind.PREREQUISITE });
                    break;   // one satisfying edge is enough (OR semantics)
                }
            }
        }
        lastNodeIdForKey.set(node.skillKey, node.id);
    }

    return graph;
}
