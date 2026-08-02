// tools/preprocess/resonators.mjs — resonator projection — thin Dimbreath rows + the full nanoka kit projection.
// Split from the monolithic preprocess.mjs (Simplification Plan S4.1);
// bodies moved verbatim — LOCK A (byte-identical wuwa-data.json) verifies.
import { matchRowHits } from '../rate-match.mjs';
import { ELEMENT_COLORS, WEAPON_TYPES } from './constants.mjs';
import { iconUrlFor } from './download.mjs';
import { formatSkillDesc, substituteParams } from './text.mjs';
import {
    classifySkillRow, resolveInstanceFormula, inferRowTypes,
    FORMULA_RECLASSIFICATIONS, FORMULA_RECLASS_AMBIGUOUS, isPaletteIncluded,
    RELATED_PROP_ID, nodeRelatedPropId, scalingStatFromFormat, parseHealParam,
    generateSkillKey, generateSkillLabel, linkMetaToSteps, parseMult,
} from './skill-rows.mjs';
import { parseEffectsFromDesc } from './effects.mjs';

// =============================================================================
// Resonators
// =============================================================================

export function isPlayable(role) {
    return role.RoleType === 1
        && (role.QualityId === 4 || role.QualityId === 5)
        && !role.IsTrial;
}

export function projectResonator(role, resolveText) {
    const name = resolveText(role.Name);
    return {
        id: role.Id,
        name,
        rarity: role.QualityId,
        element: role.ElementId,
        weaponType: role.WeaponType,
        propertyId: role.PropertyId,
        maxLevel: role.MaxLevel ?? 90,
        skillId: role.SkillId,
        elementColor: ELEMENT_COLORS[role.ElementId] ?? '#888',
        weaponTypeName: WEAPON_TYPES[role.WeaponType] ?? 'Unknown',
        iconUrl: iconUrlFor(name, role.Id, 'resonators'),
    };
}

// =============================================================================
// Nanoka-sourced entries (new characters/weapons not yet in Dimbreath)
// =============================================================================

// nanoka element/weapon integers → our enums
// nanoka uses: 1=Glacio 2=Fusion 3=Electro 4=Aero 5=Spectro 6=Havoc (same!)
// nanoka weapon: 1=Broadblade 2=Sword 3=Pistols 4=Gauntlets 5=Rectifier (same!)

export function projectNanokaCharacter(id, entry) {
    // Thin projection used when no full character JSON is available.
    // Only provides basic picker data (no stats, no damage table).
    const elementId  = entry.element ?? 0;
    const weaponType = entry.weapon  ?? 0;
    return {
        id,
        name:           entry.en,
        rarity:         entry.rank ?? 5,
        element:        elementId,
        weaponType,
        propertyId:     null,
        maxLevel:       90,
        skillId:        null,
        elementColor:   ELEMENT_COLORS[elementId] ?? '#888',
        weaponTypeName: WEAPON_TYPES[weaponType]  ?? 'Unknown',
        iconUrl:        iconUrlFor(entry.en, id, 'resonators'),
        source:         'nanoka',
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// P13-fix-3 (2026-07-03) — full-VECTOR row↔entry matching for per-hit energy
// (Resonance) + Concerto extraction, replacing the level-1-rate keyed lookup
// of P13-fix/P13-fix-2 (kept in git history; see the findings doc). The
// matching primitives (parseHitTerms/rowTermVectors/termEntryMatches/
// isShadowEntry/pickHitCluster/matchRowHits) now live in the neutral
// ./rate-match.mjs (extracted 2026-07-16 so tools/extract-forte.mjs can reuse
// the SAME rigorous algorithm — it was using a much naiver matcher that
// couldn't handle multi-hit rows, see docs/forte-modeling-investigation.md).
//
// nanoka's `sk.damage` has one entry per TERM of a row's multiplier string (with
// per-hit `energy`/`element_power`; maintainer-verified in-game). Attributing
// entries to rows by their level-1 rate alone breaks whenever two things
// share a rate. The robust signal: every entry carries a FULL rate_lv vector
// (20 levels) and every row's multiplier strings exist at every level — matching
// the whole vector (level-1 exact, later levels tolerant to display-rounding
// drift, e.g. Taoqi "52.78%" vs raw 5277, drift ≤3 by lv20) is near-unique.
// Where full vectors still collide, the raw entry-ID structure disambiguates:
// the ID digit layout varies per character (Mornye 4+3+2, Sanhua 4+3+3,
// Baizhi block-style — NOT decodable roster-wide), but two properties hold
// universally: (a) entries of the SAME row-term are ID-adjacent (diff ≈ 1);
// (b) same-vector entries of DIFFERENT rows are far apart (diff ≥ 100). So
// candidates cluster by ID gap, and rows consume clusters in sk.level order —
// the same top-to-bottom reconciliation a manual read of the raw table
// produces (maintainer-verified on Mornye/Lucilla worked examples).
//
// Verified cases this handles (docs/energy-signal-findings.md, P13-fix-3):
// - Scalar rows (STA Cost "25", Cooldown "16", Concerto Regen "10", flat
//   heal terms) no longer phantom-match a rate — their constant "vectors"
//   can't match scaling rate_lv arrays. (Previously they silently stole
//   energy AND corrupted the shared consumption counter.)
// - Multi-hit "*N" terms appear as 1 entry (Mornye BA3 "5.2%*6"), N entries
//   (Mornye "20%*4" → 4 IDs), or k<N entries (Zhezhi "10.34%*5" → 2 IDs):
//   consume the term's ID-cluster, repeat the last entry for remaining hits.
// - Display rows can legitimately SHARE one instance (Denia's basic vs
//   mid-air Breakdown rows) — if no unconsumed entry matches, re-read a
//   consumed one instead of yielding 0.
// - Hidden "2× shadow" duplicates (empowered variants at exactly double the
//   vector with UNCHANGED energy/ep, e.g. Aemeath …012 = …010×2) lose
//   cluster tie-breaks — but ONLY as a tie-break, since a kit can also have
//   a legitimate real 2× row (Augusta's 120% Protector vs 60% Sunborne).
// - ~500 entries roster-wide match no display row at all (hidden/empowered
//   instances, e.g. Denia's rate+120000 liberation variants) — left alone.
//
// The matching primitives are in ./rate-match.mjs (imported above); this
// module's own call site sums nanoka's `energy`/`element_power` fields.

export function projectNanokaCharacterFull(nChar) {
    const id         = nChar.id;
    const name       = nChar.name;
    const elementId  = nChar.element  ?? 0;
    const weaponType = nChar.weapon   ?? 0;

    // ── Base stats: use phase 6, level 90 as the canonical Lv90 value ─────────
    // Standard base Crit Rate / Crit DMG / Energy Regen for 5★ resonators.
    // These are NOT in nanoka but are identical across all 5★ characters in WuWa.
    // If a future character differs, override via patch.json.
    const BASE_CRIT_RATE   = 0.05;   // 5%
    const BASE_CRIT_DMG    = 1.50;   // 150%
    const BASE_ENERGY_REGEN = 1.00;  // 100%

    // Derive full stat lookup table: { [level]: { hp, atk, def } }
    const statsByLevel = {};
    for (const [_phase, levels] of Object.entries(nChar.stats ?? {})) {
        for (const [lvStr, stats] of Object.entries(levels)) {
            const level = Number(lvStr);
            // Take the max value at each level (post-ascension wins)
            if (!statsByLevel[level] || stats.atk > statsByLevel[level].atk) {
                statsByLevel[level] = { hp: stats.life, atk: stats.atk, def: stats.def };
            }
        }
    }
    // Lv90 = canonical final value
    const lv90 = statsByLevel[90] ?? { hp: 0, atk: 0, def: 0 };

    // ── Skill tree stat bonuses (node_type 4 = passive stat) ─────────────────
    // 4 stat nodes per tier × 2 tiers = 8 total. Node IDs within each tier
    // are sorted ascending and assigned to columns in this order:
    //   normal → skill → liberation → intro  (Forte Circuit gets Inherent Skills)
    // parent_nodes confirms: Node9.parent=[1]=NormalAtk, Node10.parent=[2]=Skill, etc.
    //
    // propId mapping for stat bonus types:
    const STAT_BONUS_PROP = {
        'ATK+':              { propId: 10007, key: 'atkRatio'      },
        'HP+':               { propId: 10002, key: 'hpRatio'       },
        'HP Up':             { propId: 10002, key: 'hpRatio'       },  // alias
        'DEF+':              { propId: 10010, key: 'defRatio'      },
        'Crit. Rate+':       { propId: 8,     key: 'critRate'      },
        'Crit. Rate Up':     { propId: 8,     key: 'critRate'      },  // alias
        'Crit. DMG+':        { propId: 9,     key: 'critDmg'       },
        'Healing Bonus+':    { propId: 35,    key: 'healingBonus'  },
        // Element DMG bonuses — propId = 21 + elementId (1..6)
        'Glacio DMG Bonus+': { propId: 22, key: 'dmgBonus' },
        'Fusion DMG Bonus+': { propId: 23, key: 'dmgBonus' },
        'Electro DMG Bonus+':{ propId: 24, key: 'dmgBonus' },
        'Aero DMG Bonus+':   { propId: 25, key: 'dmgBonus' },
        'Spectro DMG Bonus+':{ propId: 26, key: 'dmgBonus' },
        'Havoc DMG Bonus+':  { propId: 27, key: 'dmgBonus' },
    };
    const STAT_NODE_COLS = ['normal', 'skill', 'liberation', 'intro'];

    // Collect stat nodes grouped by coordinate (tier), sorted by node ID
    const statByTier = {};
    for (const [k, node] of Object.entries(nChar.skill_trees ?? {})) {
        if (node.node_type !== 4) continue;
        const tier = node.coordinate ?? 1;
        if (!statByTier[tier]) statByTier[tier] = [];
        statByTier[tier].push({ nodeId: Number(k), sk: node.skill ?? {} });
    }

    // Build both the flat skillTreeBonuses (for stats engine) and the
    // structured statNodeBonuses (for UI display and toggle control).
    // Each bonus carries col+tier so statNodesActive can filter it.
    const skillTreeBonuses = [];
    const statNodeBonuses  = { normal: [], skill: [], liberation: [], intro: [] };

    for (const [tierStr, nodes] of Object.entries(statByTier)) {
        const tier   = Number(tierStr);
        const sorted = nodes.sort((nodeA, nodeB) => nodeA.nodeId - nodeB.nodeId);
        sorted.forEach((item, i) => {
            const col    = STAT_NODE_COLS[i];
            if (!col) return;
            const def    = STAT_BONUS_PROP[item.sk.name];
            const value  = parseFloat(item.sk.param?.[0]) / 100;
            if (!def || !Number.isFinite(value)) return;

            skillTreeBonuses.push({ propId: def.propId, key: def.key, value, col, tier });
            statNodeBonuses[col].push({ name: item.sk.name, value, tier, propId: def.propId });
        });
    }

    // ── Inherent Skills (node_type 3, sk.type='Inherent Skill') ──────────────
    // Two passive ability nodes per character connected to the Forte Circuit.
    // Tooltip fix: substitute {0},{1}... params BEFORE stripping remaining
    // game-engine {Cus:...} tags, so numbers show instead of "{…}".
    const inherentSkills = [];
    for (const node of Object.values(nChar.skill_trees ?? {})) {
        if (node.node_type !== 3) continue;
        const skill = node.skill ?? {};
        if (skill.type !== 'Inherent Skill') continue;
        // Step 1: strip HTML tags only
        const rawDesc = (skill.desc ?? '').replace(/<[^>]+>/g, '').trim();
        // Step 2: substitute numeric placeholders {0},{1}... with actual values
        const withParams = substituteParams(rawDesc, skill.param ?? []);
        // Step 3: strip any remaining game-engine tags {Cus:...} etc.
        const cleanDesc = withParams.replace(/\{[A-Za-z][^}]*\}/g, '').replace(/\s+/g, ' ').trim();
        inherentSkills.push({
            name: skill.name ?? '',
            desc: cleanDesc,
            params: skill.param ?? [],
            effects: parseEffectsFromDesc(cleanDesc, name),
        });
    }

    // ── Outro Skill buff grants ───────────────────────────────────────────────
    // The Outro Skill grants DMG Amplification to the INCOMING resonator
    // (separate multiplicative bucket from dmgBonus — matches formula.js `amplify`).
    // We parse every buff grant in the Outro description so team-sim can apply
    // them to the next member's damage calculation.
    //
    // WuWa uses several language patterns for the same mechanic:
    //   "Y DMG Amplified by X%"      — most common (Sanhua, Zhezhi, ...)
    //   "X% Y Amplification"         — gains/grants variant (Mortefi, Phrolova, ...)
    //   "Amplify ... Y by X%"        — Brant/Cantarella variant
    //
    // scope.type:
    //   'element'   → amplify hits whose element matches scope.elementId
    //                 elementId null = "All DMG" (applies to every hit)
    //   'skillType' → amplify hits whose formulaType matches scope.skillType

    // These regexes are applied globally to pick up ALL grants in one pass.
    const OUTRO_GLOBAL_A = new RegExp(
        '(?:All|Glacio|Fusion|Electro|Aero|Spectro|Havoc|Basic\\s+Attack|Heavy\\s+Attack|Resonance\\s+Skill|Resonance\\s+Liberation|Echo\\s+Skill|Intro\\s+Skill)\\s+DMG\\s+Amplif\\w+\\s+by\\s+([\\d.]+)%',
        'gi'
    );
    const OUTRO_GLOBAL_B = new RegExp(
        '([\\d.]+)%\\s+((?:All|Glacio|Fusion|Electro|Aero|Spectro|Havoc|Basic\\s+Attack|Heavy\\s+Attack|Resonance\\s+Skill|Resonance\\s+Liberation|Echo\\s+Skill|Intro\\s+Skill)\\s+(?:DMG\\s+)?Amplif)',
        'gi'
    );
    const OUTRO_GLOBAL_C = new RegExp(
        'Amplif\\w+.*?((?:All|Glacio|Fusion|Electro|Aero|Spectro|Havoc|Basic\\s+Attack|Heavy\\s+Attack|Resonance\\s+Skill|Resonance\\s+Liberation|Echo\\s+Skill)\\s+DMG)\\s+by\\s+([\\d.]+)%',
        'gi'
    );

    const OUTRO_ELEMENT_MAP = [
        { re: /All\s+DMG/i,                    elementId: null },
        { re: /Glacio\s+DMG/i,                 elementId: 1 },
        { re: /Fusion\s+DMG/i,                 elementId: 2 },
        { re: /Electro\s+DMG/i,                elementId: 3 },
        { re: /Aero\s+DMG/i,                   elementId: 4 },
        { re: /Spectro\s+DMG/i,                elementId: 5 },
        { re: /Havoc\s+DMG/i,                  elementId: 6 },
    ];
    const OUTRO_SKILL_TYPE_MAP = [
        { re: /Basic\s+Attack\s+DMG/i,         skillType: 'basic' },
        { re: /Heavy\s+Attack\s+DMG/i,         skillType: 'heavy' },
        { re: /Resonance\s+Skill\s+DMG/i,      skillType: 'skill' },
        { re: /Resonance\s+Liberation\s+DMG/i, skillType: 'liberation' },
        { re: /Echo\s+Skill\s+DMG/i,           skillType: 'echo' },
        { re: /Intro\s+Skill\s+DMG/i,          skillType: 'intro' },
    ];

    function labelToScope(label) {
        for (const { re, elementId } of OUTRO_ELEMENT_MAP) {
            if (re.test(label)) return { type: 'element', elementId };
        }
        for (const { re, skillType } of OUTRO_SKILL_TYPE_MAP) {
            if (re.test(label)) return { type: 'skillType', skillType };
        }
        return null;
    }

    const outroBuffs = [];
    for (const node of Object.values(nChar.skill_trees ?? {})) {
        const skill = node.skill ?? {};
        if (skill.type !== 'Outro Skill') continue;

        const raw    = (skill.desc ?? '').replace(/<[^>]+>/g, '');
        const filled = substituteParams(raw, skill.param ?? [])
            .replace(/\{[A-Za-z][^}]*\}/g, '').replace(/\s+/g, ' ').trim();

        // Duration: "for Xs" — default 14s if absent
        const durM     = filled.match(/for\s+([\d.]+)s\b/i);
        const duration = durM ? parseFloat(durM[1]) : 14;

        // Collect all grants via global regexes (handles "X% A and X% B" on one line)
        const seen = new Set();  // dedup by scope key
        function addGrant(label, value) {
            const scope = labelToScope(label.trim());
            if (!scope) return;
            const key = scope.type + ':' + (scope.elementId ?? scope.skillType);
            if (seen.has(key)) return;
            seen.add(key);
            outroBuffs.push({ scope, value: parseFloat(value) / 100, duration });
        }

        // Pattern A: "Y DMG Amplified by X%" — label is the prefix before "Amplif"
        for (const match of filled.matchAll(OUTRO_GLOBAL_A)) {
            const label = match[0].replace(/\s+Amplif\w+.*$/i, '').trim();
            addGrant(label, match[1]);
        }

        // Pattern B: "X% Y Amplification"
        for (const match of filled.matchAll(OUTRO_GLOBAL_B)) {
            const label = match[2].replace(/\s*Amplif\w*/i, '').replace(/\s*DMG\s*$/i, ' DMG').trim();
            addGrant(label, match[1]);
        }

        // Pattern C: "Amplify ... Y by X%"
        for (const match of filled.matchAll(OUTRO_GLOBAL_C)) {
            addGrant(match[1].trim(), match[2]);
        }

        // Pattern D: bare "DMG Amplified by X%" with no type prefix → "All DMG"
        const OUTRO_GLOBAL_D = /\bDMG\s+Amplif\w+\s+by\s+([\d.]+)%/gi;
        for (const match of filled.matchAll(OUTRO_GLOBAL_D)) {
            // Only add if no element or skill-type was already detected from this text
            if (!seen.size) addGrant('All DMG', match[1]);
        }

        break;  // one Outro Skill node per character
    }

    // ── Off-field damage actions ──────────────────────────────────────────────
    // Projected from skill level params (same source as all skillDamage) +
    // description text for rates/durations.
    //
    // Three types (src/core/off-field.js):
    //   'coordinated' — triggers on every on-field hit, rate-limited
    //   'turret'      — periodic damage from a deployed entity
    //   'outroBurst'  — single burst at the switch-out moment (Outro DMG params)
    //
    // IMPORTANT: multipliers come from sk.level params, not desc text.
    // The description only contains rates and durations in human language.
    // Exception: Rover:Havoc outro mentions "X% of Rover's ATK" in desc.

    // Param name patterns that identify off-field DMG rows.
    // Covers both "X DMG" and "X Damage" naming conventions in nanoka data.
    const COORD_PARAM_RE  = /coordinated\s+attack|marcato|inklit\s+spirit|judgement\s+strike|judgment\s+strike|dreamweaver|diffusion|lance.*coord|photosynthesis/i;
    const TURRET_PARAM_RE = /turret|phantom|havoc\s+field|hover\s+cannon/i;
    const DMG_NAME_RE     = /DMG|Damage/i;   // nanoka uses both conventions

    // Description-level patterns for type detection and timing
    const COORD_DESC_RE   = /coordinated\s+attack/i;
    // Matches: "summons a turret", "summons a Havoc Field", "summon Hover Cannons"
    const TURRET_DESC_RE  = /summon\w*\s+.{0,20}(?:turret|phantom|havoc\s*field|hover\s+cannon)/i;

    function descCooldown(text) {
        const match = text.match(/(?:triggered|fires?|once|triggered once)\s+every\s+([\d.]+)\s*s|every\s+([\d.]+)\s*s\b/i);
        return match ? parseFloat(match[1] ?? match[2]) : null;
    }
    function descDuration(text) {
        const match = text.match(/(?:lasts?\s+for|for)\s+([\d.]+)\s*s\b/i);
        return match ? parseFloat(match[1]) : null;
    }
    function descMaxHits(text) {
        const match = text.match(/up to\s+(\d+)\s+times?/i);
        return match ? parseInt(match[1]) : null;
    }
    // Fallback: "X% of CharName's ATK every Ns" in desc text (Rover:Havoc)
    function descInlineMultiplier(text) {
        const match = text.match(/([\d.]+)%\s*of\s+\w+(?:'s)?\s+ATK/i);
        return match ? parseFloat(match[1]) / 100 : null;
    }

    const offFieldActions = [];

    for (const node of Object.values(nChar.skill_trees ?? {})) {
        const skill    = node.skill ?? {};
        const stype = skill.type ?? '';

        if (!['Resonance Liberation', 'Outro Skill', 'Resonance Skill',
              'Forte Circuit'].includes(stype)) continue;

        const raw    = (skill.desc ?? '').replace(/<[^>]+>/g, '');
        const filled = substituteParams(raw, skill.param ?? [])
            .replace(/\{[A-Za-z][^}]*\}/g, '').replace(/\s+/g, ' ').trim();

        const trigger = stype === 'Resonance Liberation' ? 'liberation'
            : stype === 'Outro Skill'  ? 'outro'
            : stype === 'Resonance Skill' ? 'skill' : 'forte';

        const cooldown    = descCooldown(filled);
        const dur   = descDuration(filled);
        const maxHits = descMaxHits(filled);

        // ── Coordinated attacks: multiplier from level params ─────────────────
        if (COORD_DESC_RE.test(filled)) {
            // Sum all level params whose names match coordinated-attack patterns
            let totalMult = 0;
            let hitRows   = 0;
            let bakedHits = null;   // baked-in "%*N" instance count, if present
            for (const levelParams of Object.values(skill.level ?? {})) {
                const rowName = levelParams.name ?? '';
                if (!COORD_PARAM_RE.test(rowName)) continue;
                if (!DMG_NAME_RE.test(rowName)) continue;
                const mults = levelParams.param?.[0] ?? [];
                if (!mults.length) continue;
                const raw = mults[mults.length - 1] ?? mults[0];
                // Some characters' coordinated-attack cell bakes a "perHit%*N"
                // aggregate into one value (e.g. Cantarella's Diffusion
                // "7.31%*21" = 7.31% PER Dreamweaver hit, ×21 Dreamweavers
                // total) — feeding the AGGREGATE into this model double-counts,
                // since computeOffFieldDamage (off-field.js) re-multiplies by
                // its OWN computed hit count from duration/cooldown. Detect the
                // bare "X%*N" form and split it into the per-hit value plus the
                // baked instance count (becomes the hits cap below); any other
                // shape (e.g. "X%*N+Y%") falls back to the existing aggregate
                // parse, matching every other roster character's clean rows.
                const baked = /^([\d.]+)%\*(\d+)$/.exec(String(raw));
                if (baked) {
                    totalMult += parseFloat(baked[1]) / 100;
                    bakedHits = (bakedHits ?? 0) + parseInt(baked[2], 10);
                } else {
                    const parsed = parseMult(raw);
                    if (parsed > 0) totalMult += parsed;
                }
                hitRows++;
            }
            if (totalMult > 0) {
                offFieldActions.push({
                    type:        'coordinated',
                    trigger,
                    element:     elementId,
                    scaling:     'atk',
                    multiplier:  totalMult,
                    hitsPerCast: maxHits ?? bakedHits,
                    cooldown:    cooldown ?? 1.0,
                    duration:    dur,
                    note:        `${skill.name ?? stype} (${hitRows} DMG row${hitRows > 1 ? 's' : ''})`,
                });
            }
        }

        // ── Turret / persistent summon: level params first, desc fallback ─────
        if (TURRET_DESC_RE.test(filled) && stype === 'Outro Skill') {
            let multiplier = null;
            // Primary: level params
            for (const levelParams of Object.values(skill.level ?? {})) {
                const rowName = levelParams.name ?? '';
                if (!TURRET_PARAM_RE.test(rowName) && !DMG_NAME_RE.test(rowName)) continue;
                const mults = levelParams.param?.[0] ?? [];
                if (!mults.length) continue;
                const parsed = parseMult(mults[mults.length - 1] ?? mults[0]);
                if (parsed > 0) { multiplier = parsed; break; }
            }
            // Fallback: inline "X% of ATK" in desc (Rover:Havoc — no level params)
            if (multiplier == null) multiplier = descInlineMultiplier(filled);

            if (multiplier != null) {
                offFieldActions.push({
                    type:        'turret',
                    trigger:     'outro',
                    element:     elementId,
                    scaling:     'atk',
                    multiplier,
                    hitsPerCast: null,
                    cooldown:    cooldown ?? 1.0,
                    duration:    dur ?? 14,
                    note:        `${skill.name ?? 'Outro'} summon`,
                });
            }
        }

        // ── Outro burst: Outro Skill nodes with DMG level params ──────────────
        if (stype === 'Outro Skill') {
            for (const levelParams of Object.values(skill.level ?? {})) {
                const rowName = levelParams.name ?? '';
                if (!DMG_NAME_RE.test(rowName)) continue;
                // Skip turret rows (already handled above) and buff rows
                if (TURRET_PARAM_RE.test(rowName)) continue;
                const mults = levelParams.param?.[0] ?? [];
                if (!mults.length) continue;
                const parsed = parseMult(mults[mults.length - 1] ?? mults[0]);
                if (parsed > 0) {
                    offFieldActions.push({
                        type:        'outroBurst',
                        trigger:     'outro',
                        element:     elementId,
                        scaling:     'atk',
                        multiplier:  parsed,
                        hitsPerCast: 1,
                        cooldown:    null,
                        duration:    null,
                        note:        `${skill.name ?? 'Outro'}: ${rowName}`,
                    });
                }
            }
        }
    }

    // Descriptions are param-substituted like inherent skills so the UI can
    // show the user exactly what each chain level does. Mechanical effects on
    // damage are NOT applied here — chains are bespoke per character and are
    // surfaced as display-only information for now.
    const resonanceChain = [];
    for (const lvl of ['1', '2', '3', '4', '5', '6']) {
        const chain = nChar.chains?.[lvl];
        if (!chain) continue;
        const rawDesc    = (chain.desc ?? '').replace(/<[^>]+>/g, '').trim();
        const withParams = substituteParams(rawDesc, chain.param ?? []);
        const cleanDesc  = withParams.replace(/\{[A-Za-z][^}]*\}/g, '').replace(/\s+/g, ' ').trim();
        resonanceChain.push({
            level:  Number(lvl),
            name:   chain.name ?? `Sequence ${lvl}`,
            desc:   cleanDesc,
            params: chain.param ?? [],
            effects: parseEffectsFromDesc(cleanDesc, name),
        });
    }

    // ── Skill data: classify, key, and link every row ─────────────────────────
    const SKILL_TYPE_MAP = {
        'Normal Attack':         'basic',
        'Resonance Skill':       'skill',
        'Resonance Liberation':  'liberation',
        'Forte Circuit':         'forte',
        'Intro Skill':           'intro',
        'Outro Skill':           'outro',
    };

    // Accumulate rows per node so META linking can work within each node
    const damageByNode   = {};   // nodeId → [classified damage rows]
    const supportByNode  = {};   // nodeId → [heal + shield rows]
    const metaByNode     = {};   // nodeId → [raw meta rows]
    const nodeTypeByNode = {};   // nodeId → mechanical node type (for the Intro Concerto/Energy Regen fold below)
    const buffRows       = [];   // conditional buff rows (node-crossing)

    for (const [nodeK, node] of Object.entries(nChar.skill_trees ?? {})) {
        const skill       = node.skill ?? {};
        const nodeType = SKILL_TYPE_MAP[skill.type] ?? 'unknown';
        const levels   = skill.level;
        if (!levels) continue;

        const nid = Number(nodeK);
        nodeTypeByNode[nid] = nodeType;
        if (!damageByNode[nid])  damageByNode[nid]  = [];
        if (!supportByNode[nid]) supportByNode[nid] = [];
        if (!metaByNode[nid])    metaByNode[nid]    = [];

        // Compute the node-level fallback once (dominant non-healing prop in sk.damage).
        const nodeRelPropId = nodeRelatedPropId(skill.damage);

        // Build a lookup from rate_lv[0] value → related_property from sk.damage.
        // This lets us match individual level params to their correct scaling stat
        // even in mixed-scaling nodes (e.g. Shorekeeper Intro: Enlightenment=ATK,
        // Discernment=HP, both in the same node).
        // Key: Math.round(rate_lv[0]) — raw integer from nanoka; value: propId.
        const dmgPropByRate = {};
        for (const instance of Object.values(skill.damage ?? {})) {
            if (instance.element === 0 || instance.type === 0) continue;   // skip healing entries
            const key = Math.round(instance.rate_lv[0] ?? 0);
            dmgPropByRate[key] = RELATED_PROP_ID[instance.related_property] ?? 7;
        }

        // P11.5: separate, unfiltered-by-`type` lookup for per-hit energy gen.
        // Deliberately NOT reusing dmgPropByRate's filter above: `type === 0` is
        // NOT a healing marker (verified against real data — Sanhua's and
        // Baizhi's ordinary attack hits are overwhelmingly type:0; excluding
        // them would silently drop energy for most real hits). `element === 0`
        // does correlate with non-damage entries in both samples (a healer's
        // pure-heal sub-rows), so that part of the exclusion is kept.
        //
        // `e.energy` is stored at a ×100 scale (same convention as several
        // other raw nanoka fields elsewhere in this pipeline, e.g. crit values
        // as hundredths-of-percent) — confirmed via in-game testing on Sanhua
        // at 165.6% ER: raw basic_1=87 → 0.87 base × 1.656 × 17 hits = 24.5%
        // gauge fill (observed ~25%); raw skill=1000 → 10 base × 1.656 × 3
        // casts = 49.7% (observed "~50%") and × 6 casts = 99.4% (observed
        // "tiny sliver short of castable"). Both independent checks landed
        // within ~1% of predicted — divide by 100 here, not at the consumer.
        //
        // P13-fix-3: entries carry their raw ID (BigInt for the ID-adjacency
        // clustering — some IDs exceed 2^53) and are matched to rows by full
        // rate-vector, consumed via a node-shared set. element-0 entries
        // (heal sub-rows) are INCLUDED so heal rows consume their own
        // entries (energy/ep 0 there) instead of leaving them to collide
        // with later damage rows.
        //
        // `e.element_power` is per-hit CONCERTO Energy at the same ×100 raw
        // scale (Sanhua basic stage 1 = 200 → 2.0; a full basic combo ≈ 32,
        // i.e. ~3 combos to fill the 100 gauge — plausible in-game cadence).
        // CONFIRMED (2026-07-02, maintainer manual in-game testing + a
        // reverse-engineered per-term accounting rule from the raw key
        // structure — docs/energy-signal-findings.md "CONFIRMED" section).
        const nodeHitEntries = Object.entries(skill.damage ?? {}).map(([entId, instance]) => ({ id: entId, idNum: BigInt(entId), e: instance }));
        const nodeConsumed = new Set();

        // Format the skill description once per node for the damage panel.
        const nodeDesc = formatSkillDesc(skill.desc ?? '', skill.param ?? []);

        for (const [paramK, paramV] of Object.entries(levels)) {
            const rowName = paramV.name ?? '';
            const mults   = paramV.param?.[0] ?? [];
            if (!mults.length) continue;

            // Per-row scaling: `format` field is authoritative when present.
            //   format='{0} HP'  → HP(2)   format='{0} DEF' → DEF(10)
            //   format='{0} ATK' → ATK(7)  format=null → see below
            // For format=null: match the first hit's per-hit multiplier against sk.damage
            // rate_lv[0] values to find the exact entry and its related_property.
            // This correctly handles mixed-scaling nodes like Shorekeeper Intro.
            // Falls back to nodeRelPropId if no match found.
            const rowFmt = paramV.format ?? null;
            let rowRelPropId = nodeRelPropId;  // node-level fallback

            // P11.5: unlike relatedPropId, energy has no format-string equivalent
            // to derive it from — so the sk.damage match always runs, even
            // when `format` is present and wins for relatedPropId.
            // P13-fix-3: full rate-VECTOR matching + ID-adjacency clustering
            // over EVERY term of the multiplier string (see matchRowHits).
            const { energy: rowEnergyGen, concerto: rowConcertoGen, hitTypes: rowHitTypes, hitIds: rowHitIds } = matchRowHits(
                mults, nodeHitEntries, nodeConsumed,
                { energy: (instance) => (instance.energy ?? 0) / 100, concerto: (instance) => (instance.element_power ?? 0) / 100 },
            );
            const firstMult = String(mults[0] ?? '').split('+')[0].split('*')[0].replace('%', '').trim();
            const firstVal  = parseFloat(firstMult);

            if (rowFmt) {
                if (/\{0\}\s*HP/i.test(rowFmt))  rowRelPropId = 2;
                else if (/\{0\}\s*DEF/i.test(rowFmt)) rowRelPropId = 10;
                else if (/\{0\}\s*ATK/i.test(rowFmt)) rowRelPropId = 7;
                // else: keep nodeRelPropId (unknown format like Tune AMP)
            } else if (Number.isFinite(firstVal)) {
                const key = Math.round(firstVal * 100);   // 22.79 → 2279
                if (dmgPropByRate[key] != null) rowRelPropId = dmgPropByRate[key];
            }

            const cls = classifySkillRow(rowName);

            if (cls === 'damage') {
                // Mechanical skill type + fallback bucket; formulaType/isEchoSkill
                // are READ from the matched damage instances' raw `type` tags
                // (resolveInstanceFormula) — no kit-text parsing.
                const { skillType, baseFormula } = inferRowTypes(nodeType, rowName);
                const { formulaType, isEchoSkill, ambiguous } = resolveInstanceFormula(rowHitTypes, baseFormula);
                const key   = generateSkillKey(rowName, skillType, skill.name);
                // Record data-driven reclassifications (instance type ≠ mechanical
                // default) and ambiguous rows for the end-of-run eyeball report.
                if (formulaType !== baseFormula) {
                    FORMULA_RECLASSIFICATIONS.push({ id, name, key, from: baseFormula, to: formulaType });
                }
                if (ambiguous) {
                    FORMULA_RECLASS_AMBIGUOUS.push({ id, name, key, baseFormula });
                }
                const label = generateSkillLabel(rowName, skillType, skill.name, isEchoSkill);
                damageByNode[nid].push({
                    nodeId:        nid,
                    paramId:       Number(paramK),
                    skillName:     skill.name,
                    name:          rowName,
                    type:          nodeType,
                    skillType,
                    formulaType,
                    isEchoSkill,
                    element:       elementId,
                    relatedPropId: rowRelPropId,
                    mults,
                    key,
                    label,
                    desc:          nodeDesc,   // formatted skill description
                    paletteInclude: isPaletteIncluded(rowName),
                    energyGen:     rowEnergyGen,   // P11.5 — base energy gained on cast, pre-energyRegen-scaling
                    concertoGen:   rowConcertoGen, // P13 — base Concerto gained on cast (element_power ÷100)
                    // Raw per-hit entry IDs this row matched (== the game's own
                    // BinData damage IDs) — the join key for external BinData
                    // overlays (data/hit-map.json; see the write in main()).
                    // NOT copied onto autoSkillMap entries (runtime never needs it).
                    hitIds:        rowHitIds,
                });
            } else if (cls === 'heal' || cls === 'shield') {
                // Support rows: heal or shield values.
                // Each level param has its own format (e.g. "{0} HP") which
                // determines the scaling stat — format is authoritative here.
                const fmt        = paramV.format ?? null;
                const scalingStat = scalingStatFromFormat(fmt);
                // Parse flats and ratios across all 20 skill levels
                const flatsByLevel  = mults.map(value => parseHealParam(value, fmt).flat);
                const ratiosByLevel = mults.map(value => parseHealParam(value, fmt).ratio);
                const rawCoefsByLevel = mults.map(value => parseHealParam(value, fmt).rawCoef ?? 0);
                // Build a key mirroring the parent damage key so the sim can
                // find support rows via the same autoSkillMap entry.
                const { skillType } = inferRowTypes(nodeType, rowName);
                const key = generateSkillKey(rowName, skillType, skill.name);
                supportByNode[nid].push({
                    nodeId:        nid,
                    paramId:       Number(paramK),
                    skillName:     skill.name,
                    name:          rowName,
                    rowType:       cls,
                    skillType,
                    scalingStat,
                    flatsByLevel,
                    ratiosByLevel,
                    rawCoefsByLevel,
                    key,
                    label:         `${skill.name}: ${rowName}`,
                    desc:          nodeDesc,
                });
            } else if (cls === 'meta') {
                metaByNode[nid].push({ name: rowName, mults });
            } else if (cls === 'buff') {
                buffRows.push({
                    nodeId:    nid,
                    paramId:   Number(paramK),
                    skillName: skill.name,
                    name:      rowName,
                    mults,
                    nodeType,
                });
            }
        }
    }

    // Link META rows to their parent damage steps within each node
    const skillMeta = {};    // damageKey → [{ label, mults }]
    for (const [nid, dmgRows] of Object.entries(damageByNode)) {
        const links = linkMetaToSteps(dmgRows, metaByNode[nid] ?? []);
        for (const [key, items] of links) {
            if (items.length) skillMeta[key] = items;
        }

        // Multi-stage Liberation nodes (maintainer-confirmed 2026-07-11, e.g.
        // Augusta: "Sword of Eternal Oath" [costs Resonance Energy] vs. the
        // follow-up "Sublime is the Sun — Sunborne/Everbright Protector" [kit
        // text: "costs no Resonance Energy but 2 stacks of Majesty instead"])
        // split ONE raw skill node into several skill-map keys, but only the
        // key(s) whose OWN meta carries an explicit Resonance/Energy Cost row
        // actually spend the gauge on cast — the rest are free continuations
        // or alt-resource casts and must not re-consume it. Detected from the
        // already-linked meta (no new text scanning beyond the existing
        // Cooldown/Cost/Regen classification): if ANY liberation-type sibling
        // in this node has a matched cost row, only those siblings consume;
        // if NONE do, leave every sibling defaulting to "consumes" (no signal
        // to differentiate — preserves current behavior for the common single
        // stage-with-untextually-matched-cost case, e.g. Jiyan/Carlotta/
        // Xiangli Yao's multi-hit-but-single-cast Liberations).
        const libRowsInNode = dmgRows.filter(row => row.skillType === 'liberation');
        if (libRowsInNode.length > 1) {
            const costKeys = new Set();
            for (const row of libRowsInNode) {
                const items = links.get(row.key) ?? [];
                if (items.some(item => /Resonance Cost|Energy Cost/i.test(item.label))) costKeys.add(row.key);
            }
            if (costKeys.size > 0) {
                for (const row of libRowsInNode) row.consumesResource = costKeys.has(row.key);
            }
        }

        // Skill cooldowns (2026-07-12): read each key's linked "… Cooldown"
        // meta row (already classified/linked by the same rail as Resonance
        // Cost) into seconds. Keys fed by ONE meta row — the bare-name
        // node-level fallback, or an explicit shared row like "Jade Cleave/
        // Petalfall Cooldown" — get the SAME cooldownGroup: casting any of
        // them arms one shared timer. A key with both a stage-specific and a
        // node-level bare row prefers the specific one.
        for (const row of dmgRows) {
            if (row.cooldown != null) continue;   // same-key sibling already set
            const cdItems = (links.get(row.key) ?? []).filter(item => /Cooldown$/i.test(item.label));
            if (cdItems.length === 0) continue;
            const cooldownItem = cdItems.find(item => item.label !== 'Cooldown') ?? cdItems[0];
            const secs = parseFloat(cooldownItem.mults?.[0]);
            if (!Number.isFinite(secs) || secs <= 0) continue;
            row.cooldown = secs;
            row.cooldownGroup = `${nid}:${cooldownItem.label}`;
        }

        // Intro Skill flat Concerto/Energy Regen (maintainer-confirmed
        // 2026-07-10): every resonator's Intro Skill carries a flat, level-
        // invariant "<name> Concerto Regen" row (universally 10, Baizhi's
        // Discernment variant 20) that the vector-matched `damage[*].element_power`
        // never captures (53/56 nodes show element_power 0 there) — the game
        // mechanic is a flat restore on a successful Intro cast, not a per-hit
        // rate. classifySkillRow buckets it 'meta' (display-only) by design, so
        // fold its value straight into the linked damage row's concertoGen/
        // energyGen here — read AS-IS, no ÷100 (unlike the ×100-scaled vector
        // fields, these meta-row params are already plain numbers). Scoped to
        // Intro nodes only per maintainer direction — not a general meta-row
        // energy extraction.
        if (nodeTypeByNode[nid] === 'intro') {
            for (const [key, items] of links) {
                const row = dmgRows.find(candidate => candidate.key === key);
                if (!row) continue;
                for (const item of items) {
                    const flat = parseFloat(item.mults?.[0]);
                    if (!Number.isFinite(flat)) continue;
                    if (/Concerto\s*Regen$/i.test(item.label)) row.concertoGen += flat;
                    else if (/Energy\s*Regen$/i.test(item.label)) row.energyGen += flat;
                }
            }
        }
    }

    // Assign each buff row to the closest damage step in the same node
    // (the last damage row = the node's primary output, typically correct
    //  for Liberation buffs like "Increase per Snowforged Blade")
    const skillBuffs = buffRows.map(buff => {
        const nodeDmg = damageByNode[buff.nodeId] ?? [];
        const parentKey = nodeDmg[nodeDmg.length - 1]?.key ?? null;
        return { ...buff, parentKey };
    });

    const skillDamage  = Object.values(damageByNode).flat();
    const skillSupport = Object.values(supportByNode).flat();  // heal + shield rows

    return {
        id,
        name,
        rarity:          nChar.rarity ?? 5,
        element:         elementId,
        weaponType,
        propertyId:      id,
        maxLevel:        90,
        skillId:         null,
        elementColor:    ELEMENT_COLORS[elementId] ?? '#888',
        weaponTypeName:  WEAPON_TYPES[weaponType]  ?? 'Unknown',
        iconUrl:         iconUrlFor(name, id, 'resonators'),
        source:          'nanoka',
        baseAtk:         lv90.atk,
        baseHp:          lv90.hp,
        baseDef:         lv90.def,
        baseCritRate:    BASE_CRIT_RATE,
        baseCritDmg:     BASE_CRIT_DMG,
        baseEnergyRegen: BASE_ENERGY_REGEN,
        statsByLevel,
        skillTreeBonuses,
        statNodeBonuses,   // { normal, skill, liberation, intro } → [{name,value,tier,propId}]
        inherentSkills,
        resonanceChain,
        outroBuffs,       // [{ scope: {type,elementId?|skillType?}, value, duration }]
        offFieldActions,  // [{ type, trigger, element, scaling, multiplier, cooldown, duration, note }]
        skillDamage,   // granular, classified, keyed
        skillSupport,  // heal + shield rows, keyed same as skillDamage
        skillMeta,     // key → [meta items] for the damage panel
        skillBuffs,    // conditional buff rows with parentKey
    };
}
