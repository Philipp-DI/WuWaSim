// tests/skill-node-effects.test.mjs — the THIRD effect source (2026-08-10).
//
// A buff the game states inside a Resonance Liberation / Resonance Skill /
// Forte Circuit node was never read: parseEffectsFromDesc ran on inherentSkills
// and resonanceChain only, so an effect whose source is a CAST had nowhere to
// live. Chisa's "Woven Myriad - Convergence" is the live case.
//
// What this file pins is the SHAPE, because the shape is what keeps the source
// honest: the node is the unit (not the skill key), the trigger comes from where
// the text lives (not from prose), the scope is bound or the effect is dropped,
// and the key namespace does not collide with the frozen ones.
import { readFileSync } from 'fs';
import { unlockedEffects } from '../src/core/buffs.js';

const dataset = JSON.parse(readFileSync(new URL('../data/wuwa-data.json', import.meta.url), 'utf8'));

let failed = 0;
function assert(name, cond) {
    if (cond) { console.log(`  ok   ${name}`); } else { console.log(`  FAIL ${name}`); failed++; }
}

const CHISA = 1508;
const chisa = dataset.resonators.find(resonator => resonator.id === CHISA);
const withEffects = dataset.resonators.filter(resonator => (resonator.skillNodeEffects ?? []).length);

// ── The live case: Chisa's Woven Myriad - Convergence ────────────────────────
{
    const nodes = chisa.skillNodeEffects ?? [];
    const node = nodes.find(entry => entry.skillKeys.includes('liberation'));
    assert('Chisa has a skill-node effect on her Liberation', !!node);

    const effect = (node?.effects ?? []).find(candidate => candidate.stat === 'multiplierUp');
    assert('it is the +120% DMG Multiplier', !!effect && Math.abs(effect.value - 1.2) < 1e-9);
    // "Casting this skill sends Chisa into [Woven Myriad - Convergence] for 15s"
    assert('triggered by casting the node it is stated in, not by prose',
        effect?.trigger?.type === 'castMatch'
        && Array.isArray(effect.trigger.skillKeys)
        && effect.trigger.skillKeys.includes('liberation'));
    assert('windowed to the 15s the node states', effect?.window?.type === 'seconds' && effect.window.seconds === 15);
    assert('NOT default-active — it needs its own cast', effect?.defaultActive === false);
    // The same clause on her S3 binds to ten keys; this must bind identically.
    assert('scoped to her Sawring chain, not to her whole kit',
        (effect?.skillKeys ?? []).includes('forte_heavy_sawring_blitz_1')
        && (effect?.skillKeys ?? []).includes('forte_heavy_sawring_eradication')
        && !(effect?.skillKeys ?? []).includes('liberation'));
}

// ── The NODE is the unit, never the skill key ────────────────────────────────
// Chisa's 28 keys carry only 5 distinct descriptions (11 share the Forte text),
// so a per-key pass would multiply one clause elevenfold.
{
    for (const resonator of withEffects) {
        const map = dataset.autoSkillMap[String(resonator.id)] ?? {};
        const descs = new Set();
        for (const node of resonator.skillNodeEffects) {
            const key = node.skillKeys[0];
            descs.add(map[key]?.desc ?? '');
        }
        assert(`${resonator.name}: one entry per distinct node description`,
            descs.size === resonator.skillNodeEffects.length);
    }
}

// ── No unscoped multiplierUp survives ────────────────────────────────────────
// An unscoped multiplierUp multiplies every hit the wielder throws. This source
// is new, so the safe default is to drop rather than inflate.
//
// ONE shape is scoped without naming a skill: a multiplier scaled by what the
// cast CONSUMES ("For each [Dark Core] consumed …"). Its stack count is the
// amount that step spends, which is zero on every cast that spends nothing, so
// it is scoped by arithmetic rather than by a name. Such an effect must also
// carry a 'thisCast' window — with 'persist' it would be dark on the very cast
// it is for until some sibling key fired first.
{
    const offenders = [];
    const consumptionScoped = [];
    for (const resonator of withEffects) {
        for (const node of resonator.skillNodeEffects) {
            for (const effect of node.effects) {
                if (effect.stat !== 'multiplierUp') continue;
                if (effect.skillKeys?.length || effect.skillType != null) continue;
                if (effect.stackTrigger?.type === 'resource' && effect.stackTrigger.consumed === true) {
                    consumptionScoped.push({ name: resonator.name, effect });
                    continue;
                }
                offenders.push(`${resonator.name} ${effect.value}`);
            }
        }
    }
    assert(`no skill-node multiplierUp is unscoped (found ${offenders.length}: ${offenders.slice(0, 3).join('; ')})`,
        offenders.length === 0);
    assert('the consumption-scoped set is exactly Denia\'s Dark Core clause',
        consumptionScoped.length === 1 && consumptionScoped[0].name === 'Denia'
        && consumptionScoped[0].effect.stackTrigger.resource === 'Dark Core');
    assert('a consumption-scoped multiplier is windowed to its own cast',
        consumptionScoped.every(entry => entry.effect.window?.type === 'thisCast'));
    assert('and carries the per-unit value, not a collapsed one',
        consumptionScoped.every(entry => Math.abs(entry.effect.perStack - 1.5) < 1e-9));
}

// ── Every effect carries a trigger; none is silently always-on ───────────────
{
    let alwaysOn = 0;
    for (const resonator of withEffects) {
        for (const node of resonator.skillNodeEffects) {
            for (const effect of node.effects) {
                if (effect.trigger?.type === 'none' && effect.window?.type === 'always') alwaysOn++;
            }
        }
    }
    assert('no skill-node effect is unconditional + always-on', alwaysOn === 0);
}

// ── The SK namespace does not collide with the frozen S / IH keys ────────────
// effect-overrides.json and saved builds' effectStacks address effects by
// `S{level}.{index}` / `IH{node}.{index}`; a new source must renumber neither.
{
    const build = { chain: 6, inherentSkillsActive: [true, true] };
    const keys = unlockedEffects(build, chisa).map(entry => entry.key);
    assert('unlockedEffects emits SK keys', keys.some(key => /^SK\d+\.\d+$/.test(key)));
    assert('no duplicate keys across the three sources', new Set(keys).size === keys.length);
    assert('SK keys never look like S or IH keys',
        keys.filter(key => key.startsWith('SK')).every(key => !/^S\d/.test(key) && !/^IH/.test(key)));

    // Chain level must not gate them: casting the skill IS the gate.
    const atS0 = unlockedEffects({ chain: 0, inherentSkillsActive: [true, true] }, chisa)
        .filter(entry => entry.key.startsWith('SK')).length;
    const atS6 = keys.filter(key => key.startsWith('SK')).length;
    assert('skill-node effects are unlocked at S0 as well as S6', atS0 > 0 && atS0 === atS6);
}

// ── THE DROPPED-CLAUSE CONTRACT ──────────────────────────────────────────────
// Every skill-node `multiplierUp` bindSkillScopes cannot scope is DROPPED rather
// than shipped, because unscoped it multiplies every hit the wielder throws.
// Silence is only acceptable if it is COUNTED — same contract as
// effect-coverage.test.mjs: this list may SHRINK as each is wired, never grow
// quietly. Each entry carries WHY, verified against the game's own tables.
//
// Re-derives the set from source rather than reading the shipped dataset (where
// they are already gone), so the test fails if a new one appears.
{
    const { parseEffectsFromDesc, extractDurationSeconds } = await import('../tools/preprocess/effects.mjs');
    const { bindSkillScopes } = await import('../tools/preprocess/skill-scope.mjs');

    // resonator → the gate the clause needs, and whether the ENGINE already has it.
    const EXPECTED = {
        // ALREADY PAID ELSEWHERE — shipping these would DOUBLE-COUNT. Aemeath's
        // Fusion/Rupturous Trail per-stack multipliers are the affliction lane's
        // own curve (data/affliction-damage.json 1210072022 byStacks 1.1/1.2/1.3
        // = +10%/stack, verified end-to-end 2026-08-10).
        Aemeath: 2,
        // MISCLASSIFIED — not a multiplierUp at all. The game files Danjin's
        // clause as buff 1602201011 `DamageChange` (attr 15), i.e. the ADDITIVE
        // dmgBonus bucket. Wants a buff-facts rebucket, not a scope.
        Danjin: 1,
        // NO FIXED VALUE TO READ — "0.25% per 1% Energy Regen over 100%, up to
        // 40%" parses as +0%. The game ships it as DISCRETE tiers instead
        // (1209400003-008, per-element, 10%/20%/...), so it wants a tier table
        // keyed on an ER breakpoint, not a multiplier.
        Mornye: 1,
        // Phoebe was here and is now WIRED (2026-08-10): stateInClause learned
        // the bulleted, state-LABELLED form the kit actually uses
        // ("- [Absolution] Enhancement: …", LEADING_BRACKET) on top of the
        // sentence form ("In Absolution, …"), and a state-gated skill-node
        // multiplier with no named skill scopes to the node it is written in.
        // Both her +255% now carry `inState: absolution` and scope to their own
        // key. Left as a comment because this list documents WHY each remaining
        // clause is silent, and one fewer is the point.
        //
        // RESOURCE GATE — the mechanism exists (RESOURCE_DEFS + resourceLevelAt)
        // but covers only Changli and Sigrika.
        //
        // Denia was here and is now WIRED (2026-08-12). Her gauge became
        // readable (data/gauge-income.json: SpecialEnergy2, cap 3, +1 per Intro
        // cast), and the clause turned out not to need a skill scope at all:
        // "For each [Dark Core] CONSUMED" scales on what the step spends, which
        // is zero on every cast that spends nothing, so it scopes itself. See
        // rotation-resources.js computeResourceConsumption. Validated against
        // the game's own pre-multiplied rows — 12111052110/…120/…130/…140/…150
        // are exactly base x (1 + 1.5N) of her 56.34% display row for N = 1..5,
        // five variants because S3 states "Denia now holds up to 5 Dark Cores".
        // Left as a comment because this list documents WHY each remaining
        // clause is silent, and one fewer is the point.
        //
        //   Camellya's Crimson Bud — gained by CONSUMING 10 Crimson Pistils
        //     (cap 100), i.e. a resource fed by another resource, which the flat
        //     `gains: {skillKey: n}` shape cannot express. Confirmed 2026-08-12
        //     that this is not merely unmodelled but unreadable from either
        //     extractable lane: she has no cast-lane gauge income at all, and her
        //     one db_PassiveSkill gauge row (1603906015) has magnitude 0.
        Camellya: 1,
        // TARGET MARK — "to [marked] targets", no skill list. Unlike the others
        // this one has no attribute row in db_buff either, consistent with
        // multiplierUp being the skill's own rate. Needs a decision on whether an
        // always-satisfied mark makes it a genuine global.
        Lupa: 1,
    };

    const found = {};
    for (const resonator of dataset.resonators) {
        const map = dataset.autoSkillMap[String(resonator.id)] ?? {};
        const byDesc = new Map();
        for (const [key, def] of Object.entries(map)) {
            const desc = def?.desc ?? '';
            if (!desc) continue;
            if (!byDesc.has(desc)) byDesc.set(desc, []);
            byDesc.get(desc).push(key);
        }
        const nodes = [];
        for (const [desc, keys] of byDesc) {
            const parsed = parseEffectsFromDesc(desc, resonator.name) ?? [];
            if (!parsed.length) continue;
            const seconds = extractDurationSeconds(desc);
            nodes.push({
                desc, skillKeys: keys.slice(),
                effects: parsed.map(effect => (effect.trigger && effect.trigger.type !== 'none') ? effect : ({
                    ...effect,
                    trigger: { type: 'castMatch', skillKeys: keys.slice() },
                    window: seconds != null ? { type: 'seconds', seconds } : { type: 'persist' },
                    defaultActive: false, defaultAssume: false,
                })),
            });
        }
        if (!nodes.length) continue;
        const probe = { id: resonator.id, name: resonator.name, resonanceChain: [], inherentSkills: [], skillNodeEffects: nodes };
        bindSkillScopes(probe, map);
        for (const node of probe.skillNodeEffects) {
            for (const effect of node.effects) {
                if (effect.stat !== 'multiplierUp') continue;
                if ((effect.skillKeys?.length ?? 0) > 0 || effect.skillType != null) continue;
                // Mirrors preprocess.mjs: a STATE-GATED multiplier with no named
                // skill enhances the node it is written in, so it is scoped, not
                // dropped. Replicated here so this probe stays a faithful model
                // of the pipeline rather than a second, drifting one.
                if (effect.structuralTrigger?.type === 'inState') continue;
                // Likewise: a multiplier scaled by what the cast CONSUMES is
                // scoped by arithmetic — zero on every step that spends nothing.
                if (effect.stackTrigger?.type === 'resource' && effect.stackTrigger.consumed === true) continue;
                found[resonator.name] = (found[resonator.name] ?? 0) + 1;
            }
        }
    }

    const expectedTotal = Object.values(EXPECTED).reduce((sum, n) => sum + n, 0);
    const foundTotal = Object.values(found).reduce((sum, n) => sum + n, 0);
    assert(`the dropped set is exactly the ${expectedTotal} documented clauses (found ${foundTotal})`,
        foundTotal === expectedTotal);
    for (const [name, count] of Object.entries(EXPECTED)) {
        assert(`  ${name}: ${count} dropped, as documented`, (found[name] ?? 0) === count);
    }
    const surprises = Object.keys(found).filter(name => !(name in EXPECTED));
    assert(`no UNDOCUMENTED resonator joins the dropped set (${surprises.join(', ') || 'none'})`,
        surprises.length === 0);
}

// ── Roster-wide sanity ───────────────────────────────────────────────────────
{
    const total = withEffects.reduce((sum, resonator) =>
        sum + resonator.skillNodeEffects.reduce((count, node) => count + node.effects.length, 0), 0);
    assert(`the source is populated but bounded (${total} effects, ${withEffects.length} resonators)`,
        total > 0 && total < 200 && withEffects.length <= dataset.resonators.length);
}

console.log(`skill-node-effects: ${failed === 0 ? 'all passed' : failed + ' failed'}`);
process.exit(failed === 0 ? 0 : 1);
