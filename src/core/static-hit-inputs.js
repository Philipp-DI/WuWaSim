// src/core/static-hit-inputs.js
/**
 * Static hit inputs: the per-hit amplify scopes and target modifiers (DEF
 * ignore, RES shred) that a build's GEAR grants (weapon and sonata
 * conditionals). One definition, read by both `simulateRotation` and the kit
 * view, so the build page's ability cards and the sim price a hit with the same
 * gear (roadmap step 2, #100).
 *
 *   staticHitInputs({ build, dataset, enemyStatuses }) -> { amplify, targetMods }
 *
 * `amplify` is in the scope format `resolveSkill` reads as `amplifyContext`;
 * `targetMods` is what it reads as `targetContext`.
 */
import { weaponConditionalContribution, sonataConditionalContribution } from './buffs/conditional-buffs.js';

// Conditional amplify → per-hit amplify scopes ({ scope: {type:'element',
// elementId} | {type:'skillType', skillType}, value }). amplifyByElement/Type
// are matched against each hit's element / attribution in skill.js.
export function amplifyScopesOf(contribution) {
    const scopes = [];
    for (const [elementId, value] of Object.entries(contribution?.amplifyByElement ?? {})) {
        scopes.push({ scope: { type: 'element', elementId: Number(elementId) }, value });
    }
    for (const [skillType, value] of Object.entries(contribution?.amplifyByType ?? {})) {
        scopes.push({ scope: { type: 'skillType', skillType }, value });
    }
    if ((contribution?.amplifyAll ?? 0) > 0) {
        scopes.push({ scope: { type: 'element', elementId: null }, value: contribution.amplifyAll });
    }
    return scopes;
}

function weaponContribution(build, dataset, resonator, enemyStatuses) {
    const weapon = build?.weapon;
    const weaponDef = weapon ? dataset?.weapons?.find(candidate => candidate.id === weapon.id) : null;
    return weaponConditionalContribution(weaponDef, weapon?.rank ?? 1, resonator, dataset, enemyStatuses);
}

export function staticHitInputs({ build, dataset, enemyStatuses = null }) {
    const resonator = dataset?.resonators?.find(candidate => candidate.id === build?.resonatorId);
    const contributions = [
        weaponContribution(build, dataset, resonator, enemyStatuses),
        sonataConditionalContribution(build, dataset, resonator, enemyStatuses),
    ];
    return {
        amplify: contributions.flatMap(amplifyScopesOf),
        targetMods: contributions.flatMap(contribution => contribution?.targetMods ?? []),
    };
}
