---
paths:
  - "src/core/{off-field,buffs,rotation-graph}.js"
  - "tests/rotation-validation.test.mjs"
---

# Key data shapes (quick reference)

Moved verbatim from `CLAUDE.md` on 2026-10-05.

```js
// OffFieldAction (src/core/off-field.js)
{ type: 'coordinated'|'turret'|'outroBurst', trigger: 'liberation'|'outro'|'skill'|'forte',
  element: number /* elementId 1–6 */, scaling: 'atk'|'def'|'hp', multiplier: number,
  hitsPerCast: number /* outroBurst only */, cooldown: number|null,
  duration: number|null /* null = whole window */, note: string,
  requiresState?: string /* e.g. 'maestro' */ }

// BuffEffect (src/core/buffs.js) — always use makeBuffEffect() factory
{ owner: 'resonator'|'weapon'|'echo'|'echoSet'|'outro'|'team',
  scope: 'self'|'active'|'teamWide'|'incomingResonator',
  stat: BuffStat, value: number /* fraction for % stats */,
  payload: object /* { elementId } | { skillType } | { duration } */, label: string }

// RotationGraph (src/core/rotation-graph.js)
{ nodes: Map<nodeId, { id, skillKey, index }>,
  edges: [{ from, to, kind: 'sequence'|'prerequisite'|'optional' }] }
// Do not add edge kinds without updating validateRotation + buildRuleGraph.
```
