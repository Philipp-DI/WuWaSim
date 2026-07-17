// tools/preprocess/sonatas.mjs — sonata-set projection and always-on addProp parsing.
// Split from the monolithic preprocess.mjs (Simplification Plan S4.1);
// bodies moved verbatim — LOCK A (byte-identical wuwa-data.json) verifies.
import { ELEMENT_NAME_TO_ID } from './constants.mjs';
import { cleanText, substituteParams } from './text.mjs';

// Sonata propId constants — mirrors src/core/stats.js's PROP table (kept
// separate since this file has no shared import path into src/core).
export const SONATA_PROP = {
    ATK_RATIO: 10007, ENERGY_REGEN: 11, HEALING_BONUS: 35,
    DMG_BASIC: 17, DMG_HEAVY: 18, DMG_SKILL: 14, DMG_LIBERATION: 19,
};

export const SONATA_SKILL_DMG_PROP = {
    'basic attack': SONATA_PROP.DMG_BASIC, 'heavy attack': SONATA_PROP.DMG_HEAVY,
    'resonance skill': SONATA_PROP.DMG_SKILL, 'resonance liberation': SONATA_PROP.DMG_LIBERATION,
};

export const SONATA_ADDPROP_PATTERNS = [
    {
        re: /^(Glacio|Fusion|Electro|Aero|Spectro|Havoc) DMG\s*\+\s*([\d.]+)%\.?$/i,
        build: (match) => [{ propId: 21 + ELEMENT_NAME_TO_ID[match[1].toLowerCase()], value: Number(match[2]) / 100, isRatio: true }],
    },
    {
        re: /^Healing Bonus\s*\+\s*([\d.]+)%\.?$/i,
        build: (match) => [{ propId: SONATA_PROP.HEALING_BONUS, value: Number(match[1]) / 100, isRatio: true }],
    },
    {
        re: /^Energy Regen\s*\+\s*([\d.]+)%\.?$/i,
        build: (match) => [{ propId: SONATA_PROP.ENERGY_REGEN, value: Number(match[1]) / 100, isRatio: true }],
    },
    {
        re: /^ATK\s*\+\s*([\d.]+)%\.?$/i,
        build: (match) => [{ propId: SONATA_PROP.ATK_RATIO, value: Number(match[1]) / 100, isRatio: true }],
    },
    {
        re: /^(Basic Attack|Heavy Attack|Resonance Skill|Resonance Liberation) DMG\s*\+\s*([\d.]+)%\.?$/i,
        build: (match) => [{ propId: SONATA_SKILL_DMG_PROP[match[1].toLowerCase()], value: Number(match[2]) / 100, isRatio: true }],
    },
];

// Nanoka sonata tiers carry only human-readable effect text, no structured
// stat data — unlike Dimbreath's AddProp[]. Always-on tiers (the bulk of 2pc
// bonuses: "Fusion DMG + 10%.", "ATK +10%", etc.) follow a small, consistent
// set of phrasings, so we parse those into AddProp directly; anything with a
// trigger condition (when/after/while/upon/during) is left empty and still
// surfaces via buffIds as a "pending" effect — same convention as resonance
// chain/inherent effect parsing.
export function parseSonataAddProp(effectText) {
    if (!effectText) return [];
    const trimmed = effectText.trim();
    if (/\b(when|after|while|upon|during)\b/i.test(trimmed)) return [];
    for (const { re, build } of SONATA_ADDPROP_PATTERNS) {
        const match = trimmed.match(re);
        if (match) return build(match);
    }
    return [];
}

export function projectNanokaSonatas(echoDetailFiles) {
    const sonatas = new Map();
    for (const nEcho of echoDetailFiles) {
        for (const [gid, group] of Object.entries(nEcho.group ?? {})) {
            const id = Number(gid);
            if (sonatas.has(id)) continue;
            const tiers = [];
            for (const [pieces, setData] of Object.entries(group.set ?? {})) {
                const effect = substituteParams(setData.desc ?? '', setData.param ?? []);
                tiers.push({
                    pieces:    Number(pieces),
                    effect,
                    rawEffect: setData.desc ?? '',
                    params:    setData.param ?? [],
                    buffIds:   Number(pieces) >= 5 ? [id * 1000 + Number(pieces)] : [],
                    addProp:   parseSonataAddProp(effect),
                });
            }
            sonatas.set(id, {
                id,
                name:  group.name,
                color: group.color ?? undefined,
                tiers: tiers.sort((tierA, tierB) => tierA.pieces - tierB.pieces),
            });
        }
    }
    return [...sonatas.values()].sort((sonataA, sonataB) => sonataA.id - sonataB.id);
}

// =============================================================================
// Sonatas
// =============================================================================

// FetterMap[i] = { Key: piecesNeeded, Value: effectId }. effectId resolves
// to "PhantomFetter_<effectId>_EffectDescription" in the text map.
// Project one sonata. Each tier carries:
//   - effect / summary    localized description text (with {0},{1} placeholders for newer effects)
//   - addProp[]           STRUCTURED stat bonuses, always-active when tier reached
//                         (e.g., 2pc Freezing Frost = +10% Glacio DMG via prop22)
//                         These are wired into the damage formula directly.
//   - descParams[]        positional substitution values (resolves {0}/{1} placeholders).
//                         Lets the UI render the actual numbers in the description text.
//   - buffIds[]           conditional buff trigger ids (e.g., 5pc "after Resonance Skill")
//                         Phase 7 will model these as uptime windows; for now they're
//                         surfaced so the user knows the effect is conditional.
export function projectSonata(sonata, resolveText, effectMap) {
    const name = cleanText(resolveText(sonata.FetterGroupName));
    if (!name) return null;

    const tiers = [];
    for (const entry of sonata.FetterMap || []) {
        const effectId = entry.Value;
        const pieces   = entry.Key;
        if (!effectId || !pieces) continue;
        const effect = effectMap.get(effectId) || {};
        tiers.push({
            pieces,
            effect:       cleanText(resolveText(`PhantomFetter_${effectId}_EffectDescription`)),
            summary:      cleanText(resolveText(`PhantomFetter_${effectId}_SimplyEffectDesc`)),
            addProp:      projectAddProp(effect.AddProp),
            descParams:   Array.isArray(effect.EffectDescriptionParam)
                          ? effect.EffectDescriptionParam.slice() : [],
            buffIds:      Array.isArray(effect.BuffIds) && effect.BuffIds.length > 0
                          ? effect.BuffIds.map(buffId => Math.trunc(buffId)) : [],
        });
    }
    tiers.sort((tierA, tierB) => tierA.pieces - tierB.pieces);
    return { id: sonata.Id, name, tiers };
}

// Convert raw AddProp entries to a uniform { propId, isRatio, value } shape.
// Game-internal flat values are scaled by 10000 (1000 = 10%), so we normalize
// to a 0..1 fraction for consistency with the rest of the dataset.
export function projectAddProp(addProp) {
    if (!Array.isArray(addProp)) return [];
    return addProp.map(prop => ({
        propId:  prop.Id,
        isRatio: !!prop.IsRatio,
        // When IsRatio=true the value is already a fraction (e.g., 0.10);
        // when IsRatio=false the value is scaled by 10000 (e.g., 1000 = 10%).
        value:   prop.IsRatio ? prop.Value : prop.Value / 10000,
    }));
}
