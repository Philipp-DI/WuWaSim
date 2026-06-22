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
        .sort((a, b) => a.index - b.index)
        .map(n => n.skillKey);
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
    const fromNode = [...graph.nodes.values()].find(n => n.skillKey === fromSkillKey);
    const toNode = [...graph.nodes.values()].find(n => n.skillKey === toSkillKey);
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
        .filter(e => e.to === nodeId && e.kind !== EdgeKind.SEQUENCE)
        .map(e => e.from);
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
 * Validate a linear rotation against a resonator's prerequisite rules.
 *
 * For each step that has a rule, the rule is "satisfied" if at least one of its
 * `requires` keys appears at an EARLIER index in the rotation (logical OR).
 * Unsatisfied rules produce a warning — never an error. The user stays free to
 * build whatever rotation they like; this only surfaces likely mistakes.
 *
 * Validation is occurrence-aware: a gated step satisfied earlier in the
 * rotation stays satisfied for later occurrences of the same key (e.g. once
 * Twilight Tango is active, every subsequent Fatal Finale is fine).
 *
 * P11 also runs an implicit **intra-skill stage-ordering** check (independent of
 * the character rules): within a staged skill family (e.g. Basic Attack Stage
 * 1/2/3), a step at stage N should be preceded earlier by stage N−1. This runs
 * regardless of the `rules` array. Pass `skillMap` for authoritative staged-
 * family detection and nicer warning labels.
 *
 * @param {string[]} rotation     — linear rotation (build.rotation)
 * @param {Array<object>} rules   — rules from rulesForResonator(resonatorId)
 * @param {object|null} skillMap  — optional autoSkillMap[resonatorId] for labels
 *                                  and staged-family detection
 * @returns {Array<{ index:number, skillKey:string, gate:string, note:string, requires:string[] }>}
 *          warnings (character-rule + stage-ordering), in rotation order
 */
export function validateRotation(rotation, rules, skillMap = null) {
    if (!Array.isArray(rotation) || rotation.length === 0) return [];

    const warnings = [];

    // ── Character-level prerequisite rules (P10) ──────────────────────────────
    if (rules?.length) {
        const ruleByKey = new Map();
        for (const rule of rules) ruleByKey.set(rule.skillKey, rule);

        const seenBefore = new Set();   // keys cast at strictly earlier indices
        for (let i = 0; i < rotation.length; i++) {
            const key = rotation[i];
            const rule = ruleByKey.get(key);
            if (rule) {
                // Satisfied if any required key was seen at an earlier index.
                const satisfied = rule.requires.some(req => seenBefore.has(req));
                if (!satisfied) {
                    warnings.push({
                        index: i,
                        skillKey: key,
                        gate: rule.gate,
                        note: rule.note,
                        requires: rule.requires.slice(),
                    });
                }
            }
            seenBefore.add(key);
        }
    }

    // ── Intra-skill stage ordering (P11) — always runs ────────────────────────
    warnings.push(...stageOrderingWarnings(rotation, skillMap));

    warnings.sort((a, b) => a.index - b.index);
    return warnings;
}

// Parse a stage suffix: "basic_attack_3" → { family: 'basic_attack', stage: 3 }.
// Returns null when the key has no trailing _<number>. Exported so other UI
// consumers (e.g. the rotation palette's family grouping) can reuse the same
// stage-family detection instead of re-implementing it.
export function parseStage(key) {
    const m = /^(.*?)_(\d+)$/.exec(key);
    return m ? { family: m[1], stage: parseInt(m[2], 10) } : null;
}

// Families that are genuinely staged (≥2 distinct stage numbers). Prefer the
// authoritative skillMap; fall back to the rotation's own keys so the check
// still works in tests / when no skillMap is supplied.
function stagedFamilies(rotation, skillMap) {
    const stages = new Map();   // family → Set<number>
    const add = (key) => {
        const p = parseStage(key);
        if (!p) return;
        if (!stages.has(p.family)) stages.set(p.family, new Set());
        stages.get(p.family).add(p.stage);
    };
    const source = (skillMap && typeof skillMap === 'object') ? Object.keys(skillMap) : rotation;
    for (const key of source) add(key);

    const staged = new Set();
    for (const [fam, set] of stages) if (set.size >= 2) staged.add(fam);
    return staged;
}

function stageLabel(key, skillMap) {
    const s = skillMap?.[key];
    return (s && (s.name || s.label)) ? (s.name || s.label) : key;
}

// Emit a warning for any staged step whose immediately-lower stage (N−1) was
// not cast earlier in the rotation. gate: 'sequence' (advisory, like the rest).
function stageOrderingWarnings(rotation, skillMap) {
    const staged = stagedFamilies(rotation, skillMap);
    if (staged.size === 0) return [];

    const warnings = [];
    const seenByFamily = new Map();   // family → Set<number> seen at earlier indices
    for (let i = 0; i < rotation.length; i++) {
        const p = parseStage(rotation[i]);
        if (!p || !staged.has(p.family)) continue;
        const seen = seenByFamily.get(p.family) ?? new Set();
        if (p.stage >= 2 && !seen.has(p.stage - 1)) {
            warnings.push({
                index: i,
                skillKey: rotation[i],
                gate: 'sequence',
                note: `${stageLabel(rotation[i], skillMap)} — Stage ${p.stage - 1} should come first.`,
                requires: [],
            });
        }
        seen.add(p.stage);
        seenByFamily.set(p.family, seen);
    }
    return warnings;
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
    const ordered = [...graph.nodes.values()].sort((a, b) => a.index - b.index);

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
