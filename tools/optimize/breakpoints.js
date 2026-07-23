/**
 * P12 §3 — ER-mode analysis + character-specific conditional thresholds.
 *
 * NOTE — authorized deviation from P12-INSTRUCTION-SET §3a (single ER
 * breakpoint), per the maintainer (2026-06-27) and PHASE0 §13.5 ("never
 * fabricate"): a solo resonator builds Resonance Energy over MULTIPLE rotation
 * cycles from 0, so there is no single within-rotation ER "cliff" to detect
 * solo. On-hit cast generation IS modeled (per hit since the P13-fix
 * 2026-07-02; the off-field 50% share is modeled at team level, team-energy.js
 * — the honest team-context numbers live in meta.teams erOverride); what stays
 * out of scope is enemy-dependent generation (damage taken, kill orbs —
 * maintainer direction) and the Concerto/intro economy (feasible follow-up:
 * raw `element_power` is per-hit Concerto gen). Rather than invent a solo
 * number, the optimizer reports ER as a MODE choice
 * (dmgFocus / balanced / erFocus, see weights.derivePriority) and surfaces:
 *   - scalesWithEr : does ER actually change damage (Mornye-type kits)?
 *   - erWeight     : the marginal damage weight of ER (≈0 for non-scaling kits)
 *   - libCostKnown : whether the Liberation's Resonance-Energy cost is known
 *                    (baseStats.energyMax). Read straight from the data — the
 *                    extracted value is authoritative, not second-guessed: a kit
 *                    with a real energy bar (e.g. Hiyuki, energyMax 125, who
 *                    genuinely wants ~110-120% ER for her in-state Liberation)
 *                    is energy-gated even if it also layers special-resource
 *                    steps. `false` means a genuine data gap (no energyMax);
 *                    post-Arikatsu every shipped kit supplies one. Kit-accurate
 *                    energy INCOME for multi-gauge states is separate future work
 *                    — it refines how fast the bar fills, not whether it exists.
 *   - balancedTarget : the default ER target for "balanced" mode (125%)
 */

const BALANCED_ER_TARGET = 1.25;
// ER is "scaling" if +1% ER moves damage by more than this fraction of baseline
// (non-scaling kits move it by exactly 0; this guards float dust).
const SCALES_WITH_ER_REL = 1e-5;

/**
 * @param {object} args
 * @param {object} args.resonator
 * @param {object} args.dataset
 * @param {number} args.erWeight   — weights.energyRegen at the anchor (per +1%)
 * @param {number} args.baseline   — anchor total damage (for the relative test)
 * @returns {{ scalesWithEr:boolean, erWeight:number, libCostKnown:boolean,
 *             liberationCost:(number|null), balancedTarget:number }}
 */
export function analyzeErMode({ resonator, dataset, erWeight, baseline }) {
    const liberationCost = dataset.baseStats?.[String(resonator.id)]?.energyMax ?? null;
    const libCostKnown = liberationCost != null;
    const scalesWithEr = baseline > 0 && (erWeight / baseline) > SCALES_WITH_ER_REL;
    return {
        scalesWithEr,
        erWeight,
        libCostKnown,
        liberationCost,
        balancedTarget: BALANCED_ER_TARGET,
    };
}

// Recognizable stat names in threshold conditions → meta stat keys.
const STAT_NAME_TO_KEY = [
    [/\bDEF(?:ense)?\b/i, 'def'],
    [/\bHP\b|\bHealth\b/i, 'hp'],
    [/\bATK\b|\bAttack\b/i, 'atk'],
    [/\bEnergy\s*Regen\b/i, 'energyRegen'],
    [/\bCrit\.?\s*Rate\b/i, 'critRate'],
    [/\bCrit\.?\s*DMG\b/i, 'critDmg'],
];

// "when DEF reaches 1000", "if Crit Rate is above 70%", "ATK exceeds 2500".
const THRESHOLD_RE =
    /\b(?:when|if|once|while)\b[^.;]*?\b(DEF(?:ense)?|HP|Health|ATK|Attack|Energy\s*Regen|Crit\.?\s*Rate|Crit\.?\s*DMG)\b[^.;]*?\b(?:reaches|reach|exceeds?|is\s+(?:above|at\s+least|higher\s+than|greater\s+than|over)|>=?)\s+([\d][\d,]*\.?\d*)\s*(%?)/i;

/**
 * Detect character-specific conditional thresholds (§3d) — kit gates of the
 * form "if <stat> reaches <N>, gain <X>". Scans the resonator's chain/inherent
 * effect condition text (the same data the sim resolves). Most characters have
 * none → returns []. Conservative: only emits when a recognizable stat AND a
 * numeric threshold are both present.
 *
 * @returns {Array<{ stat:string, value:number, isPercent:boolean, unlocks:string, source:string }>}
 */
export function detectConditionalThresholds(resonator) {
    const out = [];
    const scan = (effects, source) => {
        for (const effect of effects ?? []) {
            const cond = effect.condition ?? '';
            const match = THRESHOLD_RE.exec(cond);
            if (!match) continue;
            const statKey = STAT_NAME_TO_KEY.find(([regex]) => regex.test(match[1]))?.[1];
            if (!statKey) continue;
            const value = parseFloat(match[2].replace(/,/g, ''));
            if (!Number.isFinite(value)) continue;
            out.push({
                stat: statKey,
                value,
                isPercent: match[3] === '%',
                unlocks: cond.trim().slice(0, 120),
                source,
            });
        }
    };
    for (const chainNode of resonator.resonanceChain ?? []) scan(chainNode.effects, `chain S${chainNode.level}`);
    (resonator.inherentSkills ?? []).forEach((inherent, i) => scan(inherent.effects, `inherent IH${i}`));
    return out;
}

export { BALANCED_ER_TARGET };
