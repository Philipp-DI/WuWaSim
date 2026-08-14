#!/usr/bin/env node
/**
 * Pre-processor for WuWa damage simulator.
 *
 * Downloads raw datamined configs from Dimbreath/WutheringData, joins
 * the tables we care about, resolves localization keys, and writes a
 * single lean JSON the static site fetches at runtime.
 *
 * Usage:  node tools/preprocess.mjs [--lang en] [--out data/wuwa-data.json]
 *
 * Re-run when:
 *   - A game patch ships and you want new resonators/weapons/echoes.
 *   - The shape of the output changes (bump SCHEMA_VERSION).
 *
 * Output is committed. Between full re-runs, edit data/patch.json to
 * override individual entries (see src/data/loader.js for merge logic).
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadAll, loadNanokaData } from './preprocess/download.mjs';
import { makeTextResolver } from './preprocess/text.mjs';
import { ELEMENT_COLORS, WEAPON_TYPES } from './preprocess/constants.mjs';
import {
    buildPropertyDict, projectGrowthCurve, projectBaseStats,
    projectSkillTreeBonuses, projectDamageTable,
} from './preprocess/base-stats.mjs';
import {
    parseMult, generateSkillLabel, mechanicalToFormula,
    FORMULA_RECLASSIFICATIONS, FORMULA_RECLASS_AMBIGUOUS,
} from './preprocess/skill-rows.mjs';
import { applyResonanceModesAndOverrides, applyResonatorRoles, parseEffectsFromDesc, extractDurationSeconds } from './preprocess/effects.mjs';
import { buildStatusApplyRules } from './preprocess/status-apply.mjs';
import { bindSkillScopes } from './preprocess/skill-scope.mjs';
import { applyBuffFacts, loadBuffFacts } from './preprocess/buff-facts.mjs';
import { markReplacedInherents } from './preprocess/inherent-replace.mjs';
import { applyTuneStrain } from './preprocess/tune-strain.mjs';
import { buildChainExtraHits } from './preprocess/chain-extra-hits.mjs';
import {
    isPlayable, projectResonator, projectNanokaCharacter, projectNanokaCharacterFull,
} from './preprocess/resonators.mjs';
import {
    projectWeapon, projectNanokaWeapon, projectNanokaWeaponFull, projectWeaponGrowthCurves,
} from './preprocess/weapons.mjs';
import {
    projectEcho, projectNanokaEchoFull, uniqueEchoFamilies,
    projectEchoMainStats, projectEchoSubStats,
} from './preprocess/echoes.mjs';
import { projectSonata, projectNanokaSonatas } from './preprocess/sonatas.mjs';


const __dirname = dirname(fileURLToPath(import.meta.url));

const SCHEMA_VERSION = 9;

// =============================================================================
// Args + IO
// =============================================================================

function parseArgs(argv) {
    const args = { lang: 'en', out: 'data/wuwa-data.json' };
    for (let i = 2; i < argv.length; i++) {
        const k = argv[i];
        if (k === '--lang')      args.lang = argv[++i];
        else if (k === '--out')  args.out  = argv[++i];
        else if (k === '--help') { printHelp(); process.exit(0); }
        else { console.error(`Unknown arg: ${k}`); process.exit(2); }
    }
    return args;
}

function printHelp() {
    console.log('Usage: node tools/preprocess.mjs [--lang en] [--out data/wuwa-data.json]');
}

/**
 * Per-ability facts the UI shows in a skill's hover box (docs/TIMING_MODEL.md).
 *
 * Display-only — none of these feed the sim. `damageCount` /
 * `damageBeforeNextAtt` are precomputed here rather than shipping the whole
 * `damageAt` array to every step: the only question the UI asks of it is "how
 * many of these hits land before the player can act", and two scalars answer
 * that without putting a 21-element array on Lumi's Glare.
 *
 * A null staminaCost / interruptLevel means the rows describing this animation
 * DISAGREED, not that the cost is zero — see unanimousField in map-timings.mjs.
 */
function stampAbilityFacts(step, entry, key) {
    if (entry.nextAttAt != null) step.nextAttAt = entry.nextAttAt;
    if (entry.firstDamageAt != null) step.firstDamageAt = entry.firstDamageAt;
    if (entry.damageAt?.length) {
        step.damageCount = entry.damageAt.length;
        step.damageBeforeNextAtt = entry.nextAttAt == null
            ? entry.damageAt.length
            : entry.damageAt.filter(instant => instant <= entry.nextAttAt).length;
    }
    if (entry.interruptLevel != null) step.interruptLevel = entry.interruptLevel;
    if (entry.staminaCost != null) step.staminaCost = entry.staminaCost;
    if (entry.switchBehavior) step.switchBehavior = entry.switchBehavior;
    // The game's own 普攻N chain position. Stamped ONLY where the key's own name
    // carries no stage number: where both exist the key name wins, because it
    // is our canonical numbering and the tag can mean something else entirely
    // (Jiyan's three Liberation lances are all tagged 普攻4). That leaves the 41
    // keys the naming heuristic cannot see — dodge counters, intro attacks and
    // enhanced basics that occupy a chain slot without saying so in their name.
    if (entry.chainStage && !/_\d+$/.test(key)) step.chainStage = entry.chainStage.stage;
}

// =============================================================================
// Main
// =============================================================================

async function main() {
    const args = parseArgs(process.argv);
    process.stderr.write(`Pre-processing WuWa data (lang=${args.lang}) ...\n`);

    const raw = await downloadAll(args.lang);
    const resolveText = makeTextResolver(raw.textMap);
    const propDict = buildPropertyDict(raw.propertyIndex, resolveText);

    // ── Resonators: Dimbreath (primary, full stats) + nanoka (new chars only) ──
    // Deduplicate: Rover exists as male and female variants with different ids
    // but identical names and stats. Keep the first (lower id) per name.
    const seen = new Set();
    const dimbreathResonators = raw.roleInfo
        .filter(isPlayable)
        .map(role => projectResonator(role, resolveText))
        .sort((resonatorA, resonatorB) => resonatorA.id - resonatorB.id)
        .filter(resonator => {
            if (seen.has(resonator.name)) return false;
            seen.add(resonator.name);
            return true;
        });

    // Merge new characters from nanoka that aren't in Dimbreath yet.
    // Dimbreath IDs always win — we only add IDs not already covered.
    const nanoka = loadNanokaData();
    const CHAR_DIR = resolve(__dirname, '../data/extracted-nanoka/characters');
    const dimbreathIds = new Set(dimbreathResonators.map(resonator => resonator.id));

    const nanokaChars = Object.entries(nanoka.characters)
        .map(([k, entry]) => [Number(k), entry])
        .filter(([id, entry]) => {
            if (dimbreathIds.has(id)) return false;
            if (!entry.en) return false;
            if (seen.has(entry.en)) return false;
            return true;
        })
        .map(([id, entry]) => {
            seen.add(entry.en);
            // If a full character JSON was fetched by fetch-nanoka-chars.mjs, use it.
            const fullPath = resolve(CHAR_DIR, `${id}.json`);
            if (existsSync(fullPath)) {
                try {
                    const nChar = JSON.parse(readFileSync(fullPath, 'utf8'));
                    return projectNanokaCharacterFull(nChar);
                } catch { /* fall through to thin projection */ }
            }
            return projectNanokaCharacter(id, entry);
        });

    if (nanokaChars.length > 0) {
        const full = nanokaChars.filter(character => character.skillDamage);
        const thin = nanokaChars.filter(character => !character.skillDamage);
        if (full.length) process.stderr.write(`  + ${full.length} nanoka char(s) [FULL stats]: ${full.map(character => character.name).join(', ')}\n`);
        if (thin.length) process.stderr.write(`  + ${thin.length} nanoka char(s) [basic only]: ${thin.map(character => character.name).join(', ')}\n`);
    }

    const resonators = [...dimbreathResonators, ...nanokaChars]
        .sort((resonatorA, resonatorB) => resonatorA.id - resonatorB.id);

    // Signature weapon (2026-08-04): nanoka's own `recommend.weapon` list —
    // present on EVERY character's full JSON regardless of which pipeline
    // above built their core projection (role stats can come from Dimbreath/
    // Arikatsu while the recommend list only lives in the nanoka file) — its
    // first entry is verified roster-wide (56/56) to always be a 5★ weapon of
    // the resonator's own weaponType, i.e. their signature weapon (Carlotta →
    // The Last Dance, Changli → Blazing Brilliance, ...). Data-driven, no
    // name/regex matching needed. A single pass here (rather than inside each
    // projectX function) covers every resonator uniformly, independent of
    // source.
    for (const resonator of resonators) {
        const path = resolve(CHAR_DIR, `${resonator.id}.json`);
        if (!existsSync(path)) continue;
        try {
            const nChar = JSON.parse(readFileSync(path, 'utf8'));
            resonator.signatureWeaponId = nChar.recommend?.weapon?.[0] ?? null;
        } catch { /* leave unset */ }
    }

    // ── Weapons: nanoka detail (primary) + Dimbreath (fallback) ──────────────
    const WEAPON_DIR = resolve(__dirname, '../data/extracted-nanoka/weapons');
    const nanokaWeaponDetail = {};   // id → parsed detail JSON
    if (existsSync(WEAPON_DIR)) {
        for (const [idStr] of Object.entries(nanoka.weapons)) {
            const path = resolve(WEAPON_DIR, `${idStr}.json`);
            if (existsSync(path)) {
                try { nanokaWeaponDetail[idStr] = JSON.parse(readFileSync(path, 'utf8')); }
                catch { /* skip */ }
            }
        }
    }

    const dimbreathWeapons = raw.weaponConf
        .map(weapon => projectWeapon(weapon, resolveText, propDict))
        .filter(Boolean);

    // Build the weapon list: nanoka-full where we have a detail file,
    // else nanoka-thin for new IDs, else Dimbreath.
    const weaponsById = new Map();
    for (const weapon of dimbreathWeapons) weaponsById.set(weapon.id, weapon);
    for (const [idStr, entry] of Object.entries(nanoka.weapons)) {
        const id = Number(idStr);
        const detail = nanokaWeaponDetail[idStr];
        if (detail) {
            weaponsById.set(id, projectNanokaWeaponFull(detail));   // nanoka full wins
        } else if (!weaponsById.has(id)) {
            const thin = projectNanokaWeapon(id, entry);            // new id, no detail yet
            if (thin) weaponsById.set(id, thin);
        }
    }
    const isProjectionWeapon = id => id >= 80000000;
    // Drop 1–3★ weapons: nobody builds around sub-4★ gear and they only bloat
    // the picker. QualityId is the in-game star rating (1..5); keep 4★ and 5★.
    const MIN_WEAPON_RARITY = 4;
    const weapons = [...weaponsById.values()]
        .filter(weapon => !isProjectionWeapon(weapon.id))
        .filter(weapon => (weapon.rarity ?? 0) >= MIN_WEAPON_RARITY)
        .sort((weaponA, weaponB) => (weaponB.rarity - weaponA.rarity) || (weaponA.type - weaponB.type) || weaponA.name.localeCompare(weaponB.name));

    const nanokaFullWeapons = weapons.filter(weapon => weapon.statsByLevel).length;
    process.stderr.write(`  weapons: ${weapons.length} total, ${nanokaFullWeapons} with nanoka per-level stats\n`);

    // ── Echoes: nanoka detail (primary) + Dimbreath (fallback) ───────────────
    const ECHO_DIR = resolve(__dirname, '../data/extracted-nanoka/echoes');
    const nanokaEchoDetail = [];   // parsed detail JSONs (for sonata extraction)
    let echoes;

    const haveNanokaEchoes = existsSync(ECHO_DIR) &&
        Object.keys(nanoka.echoes).some(id => existsSync(resolve(ECHO_DIR, `${id}.json`)));

    if (haveNanokaEchoes) {
        // nanoka is the authoritative echo source
        const echoList = [];
        for (const [idStr, indexEntry] of Object.entries(nanoka.echoes)) {
            const path = resolve(ECHO_DIR, `${idStr}.json`);
            if (!existsSync(path)) continue;
            try {
                const nEcho = JSON.parse(readFileSync(path, 'utf8'));
                nanokaEchoDetail.push(nEcho);
                echoList.push(projectNanokaEchoFull(nEcho, indexEntry));
            } catch { /* skip */ }
        }
        echoes = echoList.sort((echoA, echoB) => (echoB.cost - echoA.cost) || echoA.name.localeCompare(echoB.name));
        process.stderr.write(`  echoes: ${echoes.length} from nanoka detail files\n`);
    } else {
        // Fallback: Dimbreath PhantomItem
        echoes = uniqueEchoFamilies(raw.phantomItem, resolveText)
            .map(phantom => projectEcho(phantom, resolveText))
            .sort((echoA, echoB) => (echoB.cost - echoA.cost) || echoA.name.localeCompare(echoB.name));
        process.stderr.write(`  echoes: ${echoes.length} from Dimbreath (no nanoka echo files found)\n`);
    }

    const elements = raw.elementInfo
        .filter(element => element.Id !== 0)
        .map(element => ({ id: element.Id, name: resolveText(element.Name), color: ELEMENT_COLORS[element.Id] }))
        .sort((elementA, elementB) => elementA.id - elementB.id);

    const effectMap = new Map((raw.phantomFetterEffects || []).map(effect => [effect.Id, effect]));
    // Prefer nanoka sonatas (pre-split descParams) when echo detail files exist.
    const sonatas = nanokaEchoDetail.length > 0
        ? projectNanokaSonatas(nanokaEchoDetail)
        : raw.phantomFetter
            .map(sonata => projectSonata(sonata, resolveText, effectMap))
            .filter(Boolean)
            .sort((sonataA, sonataB) => sonataA.id - sonataB.id);
    process.stderr.write(`  sonatas: ${sonatas.length} from ${nanokaEchoDetail.length > 0 ? 'nanoka' : 'Dimbreath'}\n`);

    const echoMainStats = projectEchoMainStats(raw.phantomMain, raw.phantomGrowth, propDict);
    const echoSubStats  = projectEchoSubStats(raw.phantomSub, propDict);
    const growthCurve   = projectGrowthCurve(raw.roleGrowth);
    const baseStats     = projectBaseStats(raw.baseProperty, resonators.map(resonator => resonator.propertyId));
    const skillTree     = projectSkillTreeBonuses(raw.skillTree);
    const weaponGrowthCurves = projectWeaponGrowthCurves(raw.weaponGrowth);
    const damageTable   = projectDamageTable(raw.damage, resonators.map(resonator => resonator.id));
    const supportTable  = {};   // resonatorId → [{id, rowType, scalingStat, flatsByLevel, ratiosByLevel}]

    // Merge nanoka skill damage into the damageTable for nanoka-sourced chars.
    // Nanoka rows use { nodeId, paramId, skillName, name, type, element, mults }.
    // We convert them to the same row shape the engine reads:
    //   { id, mults, element, relatedProp }
    // The synthetic id is resonatorId * 1e7 + nodeId * 1000 + paramId (unique).
    // Build autoSkillMap + supplemental damageTable entries for ALL resonators
    // that have a nanoka character JSON — not just the ones new to Dimbreath.
    // This gives skill data to every Dimbreath char (Sanhua, Jinhsi, etc.) as
    // soon as their JSON is fetched with: node tools/fetch-nanoka-chars.mjs --all
    const autoSkillMap = {};

    const ACTIONABLE_TIMES = {
        basic: 0.55, heavy: 1.40, skill: 1.30, liberation: 1.80,
        intro: 0.80, outro: 1.00, midair: 0.60,
        forte_basic: 0.80, forte_heavy: 1.60,
    };

    // Combine: nanokaChars (IDs not in Dimbreath) + Dimbreath resonators
    // that have a downloaded nanoka character JSON.
    const charsToProcess = [...nanokaChars.filter(character => character.skillDamage?.length || character.skillSupport?.length)];
    for (const resonator of dimbreathResonators) {
        const path = resolve(CHAR_DIR, `${resonator.id}.json`);
        if (!existsSync(path)) continue;
        try {
            const nChar = JSON.parse(readFileSync(path, 'utf8'));
            const proj  = projectNanokaCharacterFull(nChar);
            if (proj.skillDamage?.length || proj.skillSupport?.length) charsToProcess.push(proj);
            // Copy inherent skills onto the Dimbreath resonator object
            // so the build editor can display the passive toggles for all chars.
            if (proj.inherentSkills?.length) resonator.inherentSkills = proj.inherentSkills;
            if (proj.tuneBreak)              resonator.tuneBreak      = proj.tuneBreak;
            if (proj.resonanceChain?.length) resonator.resonanceChain = proj.resonanceChain;
            if (proj.outroBuffs?.length)     resonator.outroBuffs     = proj.outroBuffs;
            if (proj.offFieldActions?.length) resonator.offFieldActions = proj.offFieldActions;
            if (proj.statNodeBonuses)        resonator.statNodeBonuses = proj.statNodeBonuses;
            if (proj.skillTreeBonuses?.length && !resonator.skillTreeBonuses?.length) {
                resonator.skillTreeBonuses = proj.skillTreeBonuses;
            }
        } catch { /* skip malformed JSON */ }
    }

    // Per-resonator skill-key → raw per-hit entry IDs (== the game's own
    // BinData damage IDs, verified identical 2650/2650 roster-wide 2026-07-16).
    // Written to data/hit-map.json below — the join key that lets external
    // BinData overlays (tools/extract-forte.mjs) read per-hit fields nanoka
    // dropped (SpecialEnergy) by DIRECT ID LOOKUP instead of re-matching.
    const hitMap = {};

    for (const character of charsToProcess) {
        if (!character.skillDamage?.length && !character.skillSupport?.length) continue;
        const rid = character.id;
        if (!damageTable[rid]) damageTable[rid] = [];
        if (!supportTable[rid]) supportTable[rid] = [];
        autoSkillMap[rid] = {};
        hitMap[rid] = {};

        for (const row of character.skillDamage ?? []) {
            const synId = rid * 1e7 + row.nodeId * 1000 + row.paramId;

            damageTable[rid].push({
                id:          synId,
                mults:       row.mults.map(parseMult),
                element:     row.element,
                relatedProp: row.relatedPropId ?? 7,   // ATK(7), HP(2), DEF(10)
                name:        row.label,
                energyGen:   row.energyGen ?? 0,        // P11.5 — see autoSkillMap entry for usage
                concertoGen: row.concertoGen ?? 0,      // P13 — see autoSkillMap entry for usage
            });

            if (row.hitIds?.length) {
                hitMap[rid][row.key] = [...(hitMap[rid][row.key] ?? []), ...row.hitIds];
            }

            if (autoSkillMap[rid][row.key]) {
                autoSkillMap[rid][row.key].damageIds.push(synId);
                // P11.5: a key with multiple damageIds is multiple hits under one
                // cast (e.g. 1301.heavy_heavy_attack) — sum their energy gen the
                // same way resolveSkill already sums their damage.
                autoSkillMap[rid][row.key].energyGen   += row.energyGen ?? 0;
                autoSkillMap[rid][row.key].concertoGen += row.concertoGen ?? 0;
                continue;
            }

            const meta = character.skillMeta?.[row.key] ?? [];
            const buff = character.skillBuffs?.find(buff => buff.parentKey === row.key);

            autoSkillMap[rid][row.key] = {
                label:          row.label,
                skillType:      row.skillType,
                formulaType:    row.formulaType,
                isEchoSkill:    row.isEchoSkill ?? false,
                paletteInclude: row.paletteInclude,
                damageIds:      [synId],
                supportIds:     [],
                stepDuration:   ACTIONABLE_TIMES[row.skillType] ?? 1.0,
                desc:           row.desc || '',    // formatted skill description
                meta,
                energyGen:      row.energyGen ?? 0,   // P11.5 — base energy gained casting this step, pre-energyRegen
                concertoGen:    row.concertoGen ?? 0, // P13 — base Concerto gained casting this step
                // Multi-stage Liberation nodes only: false means this specific
                // stage is a cost-free continuation/alt-cast, not the gauge-
                // spending activation (see the libRowsInNode block above).
                // Absent (undefined) = "consumes", the overwhelming default.
                ...(row.consumesResource === false ? { consumesResource: false } : {}),
                // Re-cast gate in seconds; keys sharing a cooldownGroup share
                // one timer (see the cooldown block above). Absent = no
                // cooldown row in the game data for this key.
                ...(row.cooldown != null ? { cooldown: row.cooldown, cooldownGroup: row.cooldownGroup } : {}),

                ...(buff ? {
                    conditionalBuff: {
                        label:         buff.name,
                        perStackMults: buff.mults.map(parseMult),
                        defaultStacks: 0,
                    },
                } : {}),
                source: 'nanoka',
            };
        }

        // Attach support (heal/shield) rows to their autoSkillMap entries.
        // Strategy: find the damage entry in the same node whose label base
        // most closely matches this support row's name base (both stripped of
        // "DMG"/"Damage"/"Healing"/"Shield" suffixes). If found, attach the
        // supportId there — so one rotation step shows both damage and support.
        // Only create a stub if no matching damage entry exists in the node.
        for (const row of character.skillSupport ?? []) {
            const synId = rid * 1e7 + row.nodeId * 1000 + row.paramId + 0.5;

            supportTable[rid].push({
                id:             synId,
                rowType:        row.rowType,
                scalingStat:    row.scalingStat,
                flatsByLevel:   row.flatsByLevel,
                ratiosByLevel:  row.ratiosByLevel,
                rawCoefsByLevel: row.rawCoefsByLevel,
                name:           row.label,
            });

            // Normalise a name to its base (strip type suffixes) for matching
            const nameBase = (name) => name
                .replace(/\s+(?:DMG|Damage|Healing|Heal|Shield|Absorb|Barrier)\s*$/i, '')
                .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

            const rowBase = nameBase(row.name.replace(/^[^:]+:\s*/, '')); // strip "SkillName: "

            // Find matching damage key in same resonator: same nodeId and similar name
            let attached = false;
            for (const dmgDef of Object.values(autoSkillMap[rid] ?? {})) {
                if (!dmgDef.damageIds?.length) continue;
                // Check if this damage entry has a damageId in the same node
                const dmgId = dmgDef.damageIds[0];
                const dmgNodeId = Math.trunc((dmgId - rid * 1e7) / 1000);
                if (dmgNodeId !== row.nodeId) continue;
                // Name similarity: both bases overlap
                const dmgBase = nameBase(dmgDef.label.replace(/^[^:]+:\s*/, ''));
                if (rowBase && dmgBase && (rowBase.startsWith(dmgBase) || dmgBase.startsWith(rowBase) || rowBase === dmgBase)) {
                    dmgDef.supportIds ??= [];
                    dmgDef.supportIds.push(synId);
                    attached = true;
                    break;
                }
            }

            if (!attached) {
                // Attach to any damage entry in the same node (fallback),
                // or create a stub if the skill is pure-support (e.g. Shorekeeper Liberation).
                let fallback = false;
                for (const [, dmgDef] of Object.entries(autoSkillMap[rid] ?? {})) {
                    if (!dmgDef.damageIds?.length) continue;
                    const dmgId = dmgDef.damageIds[0];
                    const dmgNodeId = Math.trunc((dmgId - rid * 1e7) / 1000);
                    if (dmgNodeId === row.nodeId) {
                        dmgDef.supportIds ??= [];
                        dmgDef.supportIds.push(synId);
                        fallback = true;
                        break;
                    }
                }
                if (!fallback) {
                    // Pure-support node (no damage at all) — stub entry.
                    // Label: use the skill node name + type prefix, stripping the
                    // generic row suffix ("Healing", "Shield") so e.g.
                    // sk.name="End Loop", skillType="liberation" → "Resonance Liberation: End Loop"
                    if (autoSkillMap[rid][row.key]) {
                        autoSkillMap[rid][row.key].supportIds ??= [];
                        autoSkillMap[rid][row.key].supportIds.push(synId);
                    } else {
                        const stubLabel = generateSkillLabel(row.skillName, row.skillType, row.skillName);
                        autoSkillMap[rid][row.key] = {
                            label:          stubLabel,
                            skillType:      row.skillType,
                            // A support-only row has no damage instances, so nothing
                            // data-driven sets its type. The mechanical fallback must
                            // still be a real DAMAGE type — `forte_heavy` addresses no
                            // DMG-bonus bucket (Baizhi's healing row leaked that way).
                            formulaType:    mechanicalToFormula(row.skillType),
                            isEchoSkill:    false,
                            paletteInclude: true,
                            damageIds:      [],
                            supportIds:     [synId],
                            stepDuration:   ACTIONABLE_TIMES[row.skillType] ?? 1.0,
                            desc:           row.desc || '',
                            meta:           [],
                            energyGen:      0,   // pure-support stub — no damage instance to source energy from
                            concertoGen:    0,
                            source:         'nanoka',
                        };
                    }
                }
            }
        }
    }

    // -- skill-node effects (2026-08-10) -------------------------------------
    // A buff the game states INSIDE a Resonance Liberation / Resonance Skill /
    // Forte Circuit node was never read at all: parseEffectsFromDesc ran on
    // inherentSkills and resonanceChain only, so an effect whose source is a
    // CAST had nowhere to live. Chisa's "Woven Myriad - Convergence" (+120% on
    // her whole Sawring chain, granted by her own Liberation) is the live case,
    // and it is worth ~24% of her shortfall against the external benchmark.
    //
    // Two things make this structural rather than a wider prose sweep, and both
    // matter more than the parsing itself:
    //
    //  1. THE UNIT IS THE NODE, NOT THE SKILL KEY. One node's description is
    //     shared by every key derived from it — Chisa's 28 keys carry only 5
    //     distinct descriptions, 11 of them sharing the Forte text — so parsing
    //     per key would multiply one clause elevenfold. Keys are grouped by
    //     description and each node is parsed exactly once.
    //
    //  2. THE TRIGGER COMES FROM WHERE THE TEXT LIVES, not from the prose. An
    //     effect stated in a node is granted by CASTING that node; that is a
    //     structural fact about the data, not a reading of English. The parser's
    //     "unconditional / always-on" default is correct for a chain or inherent
    //     node (both are passive) and wrong here, so an untriggered effect is
    //     re-anchored onto a castMatch over the node's OWN keys, for the
    //     duration the node states. An effect the parser DID find a trigger for
    //     keeps it — that came from real text.
    //
    // Slot keys are `SK{node}.{index}`, a NEW namespace: `S`/`IH` keys are
    // frozen before effect-overrides.json and saved builds' effectStacks read
    // them (CLAUDE.md), and nothing here renumbers either.
    for (const resonator of resonators) {
        const rid = String(resonator.id);
        const byDesc = new Map();
        for (const [key, def] of Object.entries(autoSkillMap[rid] ?? {})) {
            const desc = def?.desc ?? '';
            if (!desc) continue;
            if (!byDesc.has(desc)) byDesc.set(desc, []);
            byDesc.get(desc).push(key);
        }
        const nodes = [];
        for (const [desc, keys] of byDesc) {
            const parsed = parseEffectsFromDesc(desc, resonator.name) ?? [];
            if (!parsed.length) continue;
            const nodeSeconds = extractDurationSeconds(desc);
            const effects = parsed.map(effect => {
                // Already triggered by something the text stated — leave it be.
                if (effect.trigger && effect.trigger.type !== 'none') return effect;
                return {
                    ...effect,
                    // `trigger.skillKeys` is what the matcher reads (buffs.js
                    // castMatchFiredBefore) — which casts FIRE this effect.
                    // Distinct from the effect's own top-level `skillKeys`,
                    // which bindSkillScopes fills in with what it APPLIES TO.
                    trigger: { type: 'castMatch', skillKeys: keys.slice() },
                    // A value scaled by what a cast CONSUMES belongs to that cast
                    // and to no other, so its window is 'thisCast'. 'persist'
                    // would be wrong in both directions here: its castMatch check
                    // reads strictly EARLIER steps, so the effect would be dark on
                    // the very cast it is for unless some sibling key happened to
                    // fire first, and live on every step after it. The stack count
                    // is already zero away from the consuming cast, so this is
                    // about being right rather than about safety.
                    window: effect.stackTrigger?.consumed === true
                        ? { type: 'thisCast' }
                        : nodeSeconds != null
                            ? { type: 'seconds', seconds: nodeSeconds }
                            : { type: 'persist' },
                    // It is no longer unconditional: it needs its own cast.
                    defaultActive: false,
                    defaultAssume: false,
                };
            });
            // `desc` travels with the node because bindSkillScopes re-splits it
            // to recover each clause (effect.condition is truncated to 120 chars
            // for display) — without it an unscoped multiplierUp would multiply
            // the WHOLE kit, which is the one failure mode here that inflates
            // silently. See CLAUDE.md, "An UNSCOPED multiplierUp".
            nodes.push({ desc, skillKeys: keys.slice(), effects });
        }
        if (nodes.length) resonator.skillNodeEffects = nodes;
    }

    // -- measured animation timings (docs/TIMING_MODEL.md) -------------------
    // data/actionable-times.json carries a real, extracted stepDuration per
    // skillMap key, joined from the game's own animation assets. Stamped over
    // the ACTIONABLE_TIMES per-type guess above; sim.js's resolveActionableAt
    // already prefers skillDef.stepDuration, so nothing downstream changes.
    // A key with no measured value keeps its per-type default.
    //
    // freezeTime carries ONLY the clock-stopping freeze. WuWa has two, and the
    // shipped client JavaScript names them outright: TimeStopRequest is
    // "instance timer and all combat units' buffs + skill cooldowns freeze"
    // (exactly the sim's gameTime pause), while AbsoluteTimeStop is "animation
    // and bullet freeze" — it holds the animation without stopping any clock.
    // actionable-times.json already applies that split, so 61 ordinary Intro
    // Skills correctly contribute zero here instead of pausing the world on
    // every swap-in. See docs/TIMING_MODEL.md "Two freezes".
    //
    // A measured freeze is stamped together with the IDENTITY of the animation
    // that carries it (`freezeSource` — the montage path, or `row:<id>` for the
    // coarse fallback route). Freeze belongs to the animation, not to the
    // dataset key: several keys routinely resolve to one animation, so sim.js's
    // resolveFreezeSchedule pays a source out only once per rotation. Without
    // that identity, Jinhsi's Incandescence would freeze 4.4s for one 2.2s
    // animation, since Solar Flare and Stella Glamor are two named damage rows
    // of the same cast.
    //
    // Two guards, both read off the data's own shape:
    //   - only a POSITIVE measured freeze is stamped, so a Liberation with no
    //     measurement keeps resolveFreezeTime's existing fraction estimate;
    //   - a freeze read off a SHARED `skillRow` row is dropped. That route is
    //     the coarse fallback — it recovers a DT_SkillInfo row, not an animation
    //     — so when several keys land on one row its window describes none of
    //     them in particular. Phrolova is the case: her whole 4.0s ultimate clip
    //     sits on all five "Basic Attack — Hecate Stage 1/2" / "Enhanced Attack
    //     — Hecate" keys, which are on-field attacks inside the summoned form,
    //     not a cinematic. A shared BULLET-CHAIN montage is kept, because that
    //     route does identify the one animation — those collapse correctly via
    //     resolveFreezeSchedule instead of being thrown away.
    //
    // Note this deliberately no longer mirrors resolveFreezeTime's cinematic
    // gate: a measurement outranks the heuristic that stands in for it, which is
    // what lets a genuine cinematic FINALE (Carlotta's Fatal Finale, its own
    // AM_Burst02 with its own 3.18s TimeStopRequest) freeze even though it is a
    // cost-free continuation. See docs/TIMING_MODEL.md "Freeze belongs to the
    // animation".
    const measuredPath = resolve(__dirname, '../data/actionable-times.json');
    let measuredApplied = 0, measuredMissing = 0, freezeApplied = 0, freezeSkipped = 0, tuneBreakTimed = 0;
    if (existsSync(measuredPath)) {
        const measured = JSON.parse(readFileSync(measuredPath, 'utf8')).actionableTimes ?? {};
        const sourceOf = (entry) => entry.sourceMontage ?? (entry.sourceSkillId ? `row:${entry.sourceSkillId}` : null);
        for (const [rid, keys] of Object.entries(measured)) {
            // How many of this resonator's keys resolve to each source animation.
            const keysPerSource = new Map();
            for (const entry of Object.values(keys)) {
                const source = sourceOf(entry);
                if (source) keysPerSource.set(source, (keysPerSource.get(source) ?? 0) + 1);
            }
            for (const [key, entry] of Object.entries(keys)) {
                // Tune Break is a rotation step with no skillMap entry (its row
                // carries no damage ids, so it is reached by trigger type rather
                // than by hit id — map-timings.mjs, route 'breakWeakness'). Its
                // measurement lands on the resonator's own node instead.
                if (key === '__tunebreak__') {
                    const resonator = resonators.find(entry_ => String(entry_.id) === rid);
                    if (resonator?.tuneBreak && entry.stepDuration > 0) {
                        Object.assign(resonator.tuneBreak, {
                            stepDuration: entry.stepDuration,
                            stepDurationRule: entry.stepDurationRule,
                            // Measured TimeStopRequest: the Tune Break animation
                            // stops the combat clock for its whole length, which
                            // is why it is stamped rather than left to
                            // resolveFreezeTime's cinematic gate (that reads a
                            // skillType this step does not have).
                            freezeTime: entry.freezeTime ?? 0,
                            hitCount: entry.hitCount ?? null,
                            interruptLevel: entry.interruptLevel ?? null,
                            sourceSkillId: entry.sourceSkillId ?? null,
                            sourceSkillName: entry.sourceSkillName ?? null,
                            timingSource: entry.provenance === 'curated' ? 'curated' : 'extracted',
                        });
                        tuneBreakTimed++;
                    }
                    continue;
                }
                const step = autoSkillMap[rid]?.[key];
                if (!step) { measuredMissing++; continue; }
                if (!(entry.stepDuration > 0)) continue;
                step.stepDuration = entry.stepDuration;
                step.stepDurationRule = entry.stepDurationRule;
                // When this key's damage finishes landing. The engine takes
                // max(stepDuration, resolvesAt) because a key credits its FULL
                // kit multiplier every time it appears: advancing only to the
                // queue point while damage is still landing banks damage the
                // rotation never waited for. See resolveStepDuration.
                if (entry.resolvesAt != null) step.resolvesAt = entry.resolvesAt;
                stampAbilityFacts(step, entry, key);
                step.timingSource = entry.provenance === 'curated' ? 'curated' : 'extracted';
                if (entry.needsStateModel) step.timingProvisional = 'state';
                else if (entry.isPhaseOnly) step.timingProvisional = 'phaseOnly';
                // A loop animation's markers describe ONE ITERATION, not the
                // whole held action, so its duration understates by however
                // many iterations the player holds. Flagged, not corrected —
                // the iteration count is not in the export (see TIMING_MODEL).
                else if (entry.isLoop) step.timingProvisional = 'loop';
                // Orthogonal to WHY the value is provisional, and must survive a
                // stronger caveat winning above: 3 of the 4 loop keys are also
                // state-gated or phase-only, and per-iteration-ness is true of
                // all of them regardless.
                if (entry.isLoop) step.timingIsLoop = true;
                measuredApplied++;

                if (!(entry.freezeTime > 0)) continue;
                const source = sourceOf(entry);
                if (!source || (entry.route === 'skillRow' && keysPerSource.get(source) > 1)) {
                    freezeSkipped++;
                    continue;
                }
                step.freezeTime = entry.freezeTime;
                step.freezeSource = source;
                freezeApplied++;
            }
        }
    } else {
        process.stderr.write('  WARNING: data/actionable-times.json missing — '
            + 'every step keeps its fabricated per-type stepDuration\n');
    }

    const nanokaSkillCount = Object.values(autoSkillMap)
        .reduce((count, map) => count + Object.keys(map).length, 0);
    process.stderr.write(`  autoSkillMap: ${nanokaSkillCount} steps across ${Object.keys(autoSkillMap).length} chars\n`);
    process.stderr.write(`  measured stepDuration:  ${measuredApplied} steps stamped`
        + `${measuredMissing ? `, ${measuredMissing} had no matching step` : ''}\n`);
    process.stderr.write(`  measured freezeTime:   ${freezeApplied} steps stamped`
        + `${freezeSkipped ? `, ${freezeSkipped} skipped (shared skillRow fallback)` : ''}\n`);
    process.stderr.write(`  Tune Break timing:     ${tuneBreakTimed} resonators measured\n`);

    // The Tune Strain chain, read off each Tune Break node (see tune-strain.mjs).
    // Runs after the node exists and after its timing is stamped, since it
    // writes onto the same object.
    const strainResponders = applyTuneStrain(resonators);
    process.stderr.write(`  Tune Strain chain:     ${strainResponders} responders derived\n`);

    // Forte-gauge overlay (Lever 2) — data/forte-data.json is the committed
    // distillation of the BinData SpecialEnergy channels (tools/extract-forte.mjs).
    // Stamp per-cast `forteGen` onto skill-map entries and expose per-resonator
    // { channel, cap } as `forte`. Absent file → skipped (openers keep their
    // non-Forte behavior; graceful, no regression).
    const forte = {};
    const fortePath = resolve(__dirname, '../data/forte-data.json');
    if (existsSync(fortePath)) {
        const forteData = JSON.parse(readFileSync(fortePath, 'utf8'));
        let stamped = 0;
        for (const [rid, entry] of Object.entries(forteData)) {
            if (rid.startsWith('_')) continue;      // _doc / _specialEnergyCaps
            forte[rid] = { channel: entry.channel, cap: entry.cap };
            const map = autoSkillMap[rid];
            if (!map) continue;
            for (const [key, gen] of Object.entries(entry.gen ?? {})) {
                if (map[key]) { map[key].forteGen = gen; stamped++; }
            }
        }
        // The game's declared cap for EVERY SpecialEnergy channel a resonator
        // owns (not just the one Forte bar its rotation runs on). This is the
        // authoritative answer to "how many stacks can this gauge hold", so a
        // curated gauge definition never has to trust a kit-text regex for it —
        // rotation-rules.js resolves a def's cap from here by channel.
        let capped = 0, boosted = 0;
        for (const resonator of resonators) {
            const perChannel = forteData._specialEnergyCaps?.[String(resonator.id)];
            if (perChannel) { resonator.specialEnergyCaps = perChannel; capped++; }
            // Tune Break Boost the resonator starts the fight with (attribute 142
            // WeaknessMastery). Absent for everyone but the seven responders, so
            // an absent field means zero — src/core/tune-break.js adds it to the
            // kit grants, and Pact of Neonlight Leap's 5-piece scales off it.
            const boostBase = forteData._tuneBreakBoostBase?.[String(resonator.id)];
            if (boostBase) { resonator.tuneBreakBoostBase = boostBase; boosted++; }
        }
        process.stderr.write(`  forte overlay: ${Object.keys(forte).length} resonators, ${stamped} skills stamped, ${capped} gauge-cap sets, ${boosted} Tune Break Boost bases\n`);
    } else {
        process.stderr.write(`  forte overlay: data/forte-data.json absent — skipped\n`);
    }

    // Affliction (negative-status) LevelModifier curve, straight from the game's
    // own AbnormalDamageConfig table (tools/extract/extract_abnormal_damage.py).
    // enemy-status.js modelled this as the single level-90 constant 3674, which
    // the table confirms exactly — and extends to every level 1-100.
    const abnormalDamage = (() => {
        const path = resolve(__dirname, '../data/abnormal-damage.json');
        if (!existsSync(path)) {
            process.stderr.write('  abnormal damage: data/abnormal-damage.json absent — skipped\n');
            return null;
        }
        const parsed = JSON.parse(readFileSync(path, 'utf8'));
        process.stderr.write(`  abnormal damage: ${Object.keys(parsed.byLevel ?? {}).length} levels\n`);
        return { byLevel: parsed.byLevel ?? {}, elementIndependent: parsed.elementIndependent === true };
    })();

    // Affliction (negative-status) damage rows + the KIT-SPECIFIC per-stack
    // multipliers that trigger them (tools/extract/extract_affliction_damage.py).
    // The multiplier is not one global constant per status -- it lives on the
    // buff that triggers the damage -- which is why Fusion Burst sat "pending
    // calibration" for so long.
    const afflictionDamage = (() => {
        const path = resolve(__dirname, '../data/affliction-damage.json');
        if (!existsSync(path)) {
            process.stderr.write('  affliction damage: data/affliction-damage.json absent — skipped\n');
            return null;
        }
        const parsed = JSON.parse(readFileSync(path, 'utf8'));
        process.stderr.write(`  affliction damage: ${Object.keys(parsed.rows ?? {}).length} rows, ${(parsed.multipliers ?? []).length} multiplier tables\n`);
        return { rows: parsed.rows ?? {}, multipliers: parsed.multipliers ?? [] };
    })();

    // GENERIC negative-status damage: the per-stack table every status deals on
    // its own, from the game's system buffs (tools/extract/extract_status_damage.py).
    // Distinct from afflictionDamage above, which is the KIT-triggered lane. Glacio
    // Chafe's row matches the community-calibrated curve the engine already carried
    // to the digit, which is what confirms the reading -- and settles Fusion Burst
    // and Electro Flare, both of which had been contributing nothing at all.
    const statusDamage = (() => {
        const path = resolve(__dirname, '../data/status-damage.json');
        if (!existsSync(path)) {
            process.stderr.write('  status damage: data/status-damage.json absent — skipped\n');
            return null;
        }
        const parsed = JSON.parse(readFileSync(path, 'utf8'));
        process.stderr.write(`  status damage: ${Object.keys(parsed.statuses ?? {}).length} statuses\n`);
        return { statuses: parsed.statuses ?? {} };
    })();

    // The game's own per-application stack counts, used only to bound the text
    // derivation below (tools/extract/extract_status_appliers.py). The ConfigDB
    // has no skill→applier link, so it can say HOW MANY but never WHICH cast.
    const statusAppliers = (() => {
        const path = resolve(__dirname, '../data/status-appliers.json');
        if (!existsSync(path)) {
            process.stderr.write('  status appliers: data/status-appliers.json absent — skipped\n');
            return null;
        }
        return JSON.parse(readFileSync(path, 'utf8'));
    })();

    // EXTERNAL buff grants read straight from the game's own tables
    // (tools/extract/extract_external_buffs.py). One row per grant, with its own
    // attribute id, magnitude, duration and stack limit — so a source stating two
    // grants can no longer collapse into one, and a grant reachable from several
    // trigger paths is present once rather than twice. The text readers in
    // src/core/buffs/ stay as the FALLBACK for anything not covered here.
    const externalBuffs = (() => {
        const path = resolve(__dirname, '../data/external-buffs.json');
        if (!existsSync(path)) {
            process.stderr.write('  external buffs: data/external-buffs.json absent — skipped\n');
            return null;
        }
        const parsed = JSON.parse(readFileSync(path, 'utf8'));
        const weapons = parsed.weapons ?? {};
        const sonatas = parsed.sonatas ?? {};
        process.stderr.write(`  external buffs: ${Object.keys(weapons).length} weapons, ` +
            `${Object.keys(sonatas).length} sonatas\n`);
        return { attributeNames: parsed.attributeNames ?? {}, weapons, sonatas };
    })();

    // A clause that NAMES its skills binds to those skills, not to their whole
    // category — without this, sibling clauses stack onto each other and land on
    // every step of that category. The same pass reads the STATE a clause's
    // leading "In X," gates it behind, and DROPS the effects it could not scope
    // at all (see skill-scope.mjs).
    //
    // The game's own bucket AND skill scope for each value — see
    // preprocess/buff-facts.mjs. Runs BEFORE bindSkillScopes on purpose: that
    // pass DROPS an effect marked `needsScope` that resolved no skills, and the
    // game's explicit skill-id list is the scope that saves the ones whose kit
    // names no matcher can reach. Changes no effect COUNT, so it is neutral to
    // the slot-key invariant below.
    const buffFacts = loadBuffFacts();
    const factTally = resonators.reduce((total, resonator) => {
        const { moved, scoped } = applyBuffFacts(resonator, buffFacts);
        return { moved: total.moved + moved, scoped: total.scoped + scoped };
    }, { moved: 0, scoped: 0 });
    process.stderr.write(`  buff facts: ${factTally.moved} effects rebucketed`
        + `, ${factTally.scoped} scoped by the game's own skill ids
`);

    // Runs BEFORE anything keyed on an effect's slot. `S{level}.{index}` is a
    // critical invariant (CLAUDE.md) — data/effect-overrides.json and a saved
    // build's `effectStacks` both address effects by it — so a pass that changes
    // the effect COUNT has to finish before the slot means anything. Ordered
    // after the overrides, the drop silently moved Luuk Herssen's curated S6.0
    // patch onto a different effect.
    const scopeTally = resonators.reduce((total, resonator) => {
        const { bound, dropped } = bindSkillScopes(resonator, autoSkillMap[String(resonator.id)]);
        return { bound: total.bound + bound, dropped: total.dropped + dropped };
    }, { bound: 0, dropped: 0 });
    process.stderr.write(`  skill scopes: ${scopeTally.bound} effects bound to a named skill`
        + `${scopeTally.dropped ? `, ${scopeTally.dropped} dropped as unscopable` : ''}\n`);

    // A skill-node `multiplierUp` that bindSkillScopes could not scope is
    // DROPPED, not shipped. Unscoped, it multiplies every hit the wielder
    // throws (CLAUDE.md, "An UNSCOPED multiplierUp multiplies the WHOLE kit"),
    // and this source is new — there is no prior behaviour to preserve, so the
    // safe default is to apply nothing rather than to inflate silently. The
    // count is REPORTED so the set is visible and can only shrink; the chain
    // and inherent sources keep their own existing handling untouched.
    // A STATE-GATED multiplier stated in a skill node with no named skill
    // enhances THE NODE IT IS WRITTEN IN. The game writes these as one bulleted
    // branch per state — Phoebe's Liberation carries
    //     - [Absolution] Enhancement: Increase DMG Multiplier by 255%.
    //     - [Confession] Enhancement: Apply 8 of [Spectro Frazzle] to targets hit.
    // — where "Enhancement" has an elided subject and the node supplies it. The
    // state gate is what makes this safe to assume: a clause that meant some
    // OTHER skill would have to name it, and a named subject binds through
    // bindSkillScopes before this ever runs. Without the scope these were
    // dropped outright (unscoped, +255% would multiply her whole kit).
    for (const resonator of resonators) {
        for (const node of resonator.skillNodeEffects ?? []) {
            for (const effect of node.effects) {
                if (effect.stat !== 'multiplierUp') continue;
                if ((effect.skillKeys?.length ?? 0) > 0 || effect.skillType != null) continue;
                if (effect.structuralTrigger?.type !== 'inState') continue;
                effect.skillKeys = node.skillKeys.slice();
            }
        }
    }

    // A multiplier scaled by what a cast CONSUMES is already scoped, by
    // arithmetic rather than by name: its stack count is the amount that step
    // spends, which is zero on every cast that spends nothing. Denia's "+150%
    // per [Dark Core] consumed" is the whole set. Requiring a skill scope on top
    // would drop the one effect the shape was built to carry.
    const selfScopedByConsumption = (effect) =>
        effect.stackTrigger?.type === 'resource' && effect.stackTrigger.consumed === true;

    let unscopedDropped = 0;
    for (const resonator of resonators) {
        for (const node of resonator.skillNodeEffects ?? []) {
            const before = node.effects.length;
            node.effects = node.effects.filter(effect =>
                effect.stat !== 'multiplierUp'
                || (effect.skillKeys?.length ?? 0) > 0
                || effect.skillType != null
                || selfScopedByConsumption(effect));
            unscopedDropped += before - node.effects.length;
        }
        if (resonator.skillNodeEffects) {
            resonator.skillNodeEffects = resonator.skillNodeEffects.filter(node => node.effects.length);
            if (!resonator.skillNodeEffects.length) delete resonator.skillNodeEffects;
        }
    }
    const skillNodeTally = resonators.reduce((sum, resonator) =>
        sum + (resonator.skillNodeEffects ?? []).reduce((count, node) => count + node.effects.length, 0), 0);
    process.stderr.write(`  skill-node effects: ${skillNodeTally} kept`
        + `${unscopedDropped ? `, ${unscopedDropped} unscoped multiplierUp dropped` : ''}\n`);

    // Resonance Mode tagging + surgical effect overrides (post-pass).
    applyResonanceModesAndOverrides(resonators);

    // A sequence node can REPLACE an inherent skill; applying both stacks two
    // readings of one effect (see inherent-replace.mjs).
    const replacedInherents = resonators.reduce((count, resonator) => count + markReplacedInherents(resonator), 0);
    process.stderr.write(`  inherent replacements: ${replacedInherents} superseded by a sequence node\n`);

    // WHICH casts inflict a negative status, read off each kit's own text
    // (OPEN-ITEMS #29). A resonator whose text states no rule is absent here and
    // keeps the every-damaging-step fallback in applicationsFromSteps.
    // Damage instances a Resonance Chain ADDS, which no display row mentions —
    // the game ships them as bullets marked 共鸣N and their rows are already in
    // damageTable, just attached to nothing. See chain-extra-hits.mjs for why an
    // entry needs its kit node read before it ships.
    const chainExtraHits = (() => {
        const path = resolve(__dirname, '../data/bullet-timings.json');
        if (!existsSync(path)) {
            process.stderr.write('  chain extra hits: data/bullet-timings.json absent — skipped\n');
            return {};
        }
        const bullets = JSON.parse(readFileSync(path, 'utf8'));
        const { extras, skipped } = buildChainExtraHits({
            bulletNames: bullets.bulletNames, bulletDamageIds: bullets.bulletDamageIds,
            hitMap, damageTable,
        });
        const attached = Object.values(extras).reduce((count, list) => count + list.length, 0);
        const unconfirmed = skipped.filter(row => row.reason === 'candidate not confirmed by kit text').length;
        process.stderr.write(`  chain extra hits: ${attached} attached, `
            + `${unconfirmed} candidates awaiting a kit-text read, ${skipped.length - unconfirmed} otherwise skipped\n`);
        return extras;
    })();

    const statusApplyRules = buildStatusApplyRules(resonators, autoSkillMap, statusAppliers);
    const ruleCount = Object.values(statusApplyRules).reduce((count, rules) => count + rules.length, 0);
    process.stderr.write(`  status apply rules: ${ruleCount} across `
        + `${Object.keys(statusApplyRules).length} resonators\n`);

    // Role-label tags (P13 synergy-pruning input; roster filter + build-page badges).
    const roleCatalogue = applyResonatorRoles(resonators);
    const roleCount = resonators.filter(resonator => resonator.roles?.length).length;
    process.stderr.write(`  resonator roles: ${roleCount} resonators tagged, ${roleCatalogue.length} distinct roles\n`);

    const out = {
        schemaVersion: SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
        source: 'Dimbreath/WutheringData + nanoka.cc',
        credits: {
            dimbreath: 'https://github.com/Dimbreath/WutheringData — raw datamined config tables',
            nanoka:    'https://ww.nanoka.cc — community game-data service, icon CDN, and current-patch character/weapon coverage',
        },
        lang: args.lang,
        counts: {
            resonators:    resonators.length,
            weapons:       weapons.length,
            echoes:        echoes.length,
            sonatas:       sonatas.length,
            elements:      elements.length,
            echoMainStats: Object.values(echoMainStats).flat().length,
            echoSubStats:  echoSubStats.length,
            growthCurve:   growthCurve.length,
            baseStats:     Object.keys(baseStats).length,
            skillTree:     Object.keys(skillTree).length,
            weaponCurves:  Object.keys(weaponGrowthCurves).length,
            damageTable:   Object.values(damageTable).reduce((count, rows) => count + rows.length, 0),
            skillMapAuto:  Object.keys(autoSkillMap).length,
        },
        elements,
        weaponTypes: Object.entries(WEAPON_TYPES).map(([id, name]) => ({ id: +id, name })),
        roles: roleCatalogue,
        resonators,
        weapons,
        echoes,
        sonatas,
        echoMainStats,
        echoSubStats,
        growthCurve,
        baseStats,
        skillTree,
        weaponGrowthCurves,
        damageTable,
        supportTable,
        autoSkillMap,
        forte,
        abnormalDamage,
        afflictionDamage,
        statusDamage,
        statusApplyRules,
        chainExtraHits,
        externalBuffs,
    };

    await mkdir(dirname(args.out), { recursive: true });
    const serialized = JSON.stringify(out, null, 2) + '\n';
    await writeFile(args.out, serialized);

    // data/hit-map.json — skill key → raw per-hit entry IDs (== BinData damage
    // IDs; verified identical 2650/2650 roster-wide, 2026-07-16). TOOLS-ONLY
    // artifact (the runtime never fetches it, so it is deliberately NOT part
    // of the data-version content hash): the join key that lets external
    // BinData overlays (tools/extract-forte.mjs) read per-hit fields nanoka
    // dropped (SpecialEnergy) by direct ID lookup instead of re-matching.
    const hitMapOut = {
        _doc: 'skill key → raw per-hit damage-instance IDs, as matched by preprocess.mjs matchRowHits. IDs are the game\'s own BinData damage IDs — join them directly against external BinData dumps (tools/extract-forte.mjs). Generated file; do not hand-edit.',
        map: hitMap,
    };
    await writeFile(resolve(dirname(args.out), 'hit-map.json'), JSON.stringify(hitMapOut, null, 1) + '\n');

    // Content-hash manifest (data/data-version.json): a tiny always-fresh file
    // the runtime fetches first to derive cache-busters for the large, CDN-cached
    // data + meta files. Auto-busts on EVERY content change — not just schema
    // bumps — which a content-only regen (e.g. effect reclassification) needs.
    // Carries a per-pipeline field (`data` here, `meta` from optimize.mjs); each
    // tool merges its own field so the other's stays intact.
    // Hash over EVERY data file the runtime loader fetches — not just
    // wuwa-data.json — so a manual edit to a sibling (patch.json, skill-map.json,
    // stat-ranges.json) also busts the cache. generatedAt is stripped so an
    // identical-content regen stays stable (matches optimize.mjs).
    const dataDir = dirname(args.out);
    const hashable = serialized.replace(/"generatedAt":\s*"[^"]*"/, '"generatedAt":""');
    const hash = createHash('sha256').update(hashable);
    for (const file of ['patch.json', 'skill-map.json', 'stat-ranges.json']) {
        try { hash.update(readFileSync(resolve(dataDir, file))); } catch { /* optional sibling */ }
    }
    const dataVersion = hash.digest('hex').slice(0, 12);
    const manifestPath = resolve(dataDir, 'data-version.json');
    let manifest = {};
    try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); } catch { /* first run */ }
    manifest.data = dataVersion;
    manifest.generatedAt = new Date().toISOString();
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

    process.stderr.write(`\nWrote ${args.out}\n`);
    process.stderr.write(`Wrote ${manifestPath} (data ${dataVersion})\n`);
    for (const [k, value] of Object.entries(out.counts)) {
        process.stderr.write(`  ${k.padEnd(15)} ${value}\n`);
    }

    // ── DMG-type reclassification report (instance-type ≠ mechanical) ─────────
    process.stderr.write(`\nDMG-type reclassifications (data-driven, instance type ≠ mechanical): ${FORMULA_RECLASSIFICATIONS.length}\n`);
    const byChar = new Map();
    for (const reclassification of FORMULA_RECLASSIFICATIONS) {
        if (!byChar.has(reclassification.name)) byChar.set(reclassification.name, []);
        byChar.get(reclassification.name).push(reclassification);
    }
    for (const [charName, rows] of byChar) {
        process.stderr.write(`  ${charName}:\n`);
        for (const row of rows) process.stderr.write(`      ${row.key.padEnd(46)} ${row.from} → ${row.to}\n`);
    }
    if (FORMULA_RECLASS_AMBIGUOUS.length) {
        process.stderr.write(`\n⚠ Ambiguous rows (matched instances span >1 non-echo type, kept mechanical): ${FORMULA_RECLASS_AMBIGUOUS.length}\n`);
        for (const entry of FORMULA_RECLASS_AMBIGUOUS) process.stderr.write(`      ${entry.name} ${entry.key} (${entry.baseFormula})\n`);
    }
}

main().catch(err => { console.error(err); process.exit(1); });
