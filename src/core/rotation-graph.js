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
    SEQUENCE:     'sequence',
    PREREQUISITE: 'prerequisite',
    OPTIONAL:     'optional',
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
            id:       nodeIds[i],
            skillKey: rotation[i],
            index:    i,
        });
    }

    for (let i = 0; i < nodeIds.length - 1; i++) {
        graph.edges.push({
            from: nodeIds[i],
            to:   nodeIds[i + 1],
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
    const toNode   = [...graph.nodes.values()].find(n => n.skillKey === toSkillKey);
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
