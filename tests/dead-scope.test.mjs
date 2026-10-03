/**
 * Dead scopes: an effect whose own scope no hit can ever satisfy (2026-10-02).
 *
 *   node tests/dead-scope.test.mjs
 *
 * WHY THIS EXISTS. Luuk Herssen's S6.1 shipped a +120% Liberation DMG Bonus that
 * paid exactly zero, and no test could see it: it was correctly valued, correctly
 * stacked and correctly triggered, and simply scoped to a bucket his Liberation
 * does not read. Nothing about the output looked wrong — the effect was present
 * in every dump and contributed nothing. That is the failure mode here.
 *
 * THE THREE QUESTIONS (src/core/dmg-attribution.js owns the third):
 *   skillType    MECHANICAL — which input casts the move. Drives energy, cast
 *                time, cooldowns, gating, `castMatch` triggers, `multiplierUp`.
 *   formulaType  the skill-LEVEL table key, and the attribution's fallback.
 *   attribution  WHICH of the six bonus buckets the hit reads, from the game's
 *                own per-instance type tag. Exactly one, because the client's
 *                GetAttackTypeDamageBonus is a switch with a single return.
 *
 * `skill.js` resolves BOTH lenses per hit and they are not interchangeable:
 * `ctxNode` is fed the mechanical node `skillType` and is read by `multiplierUp`
 * ALONE; `ctxFormula` is fed the ATTRIBUTION and is read by everything else. So a
 * Liberation CAST may legitimately deal Basic-bucket damage — "Resonance
 * Liberation DMG Bonus" then pays it nothing while "DMG Multiplier of the
 * Liberation" still does. That is correct, and is why this test asks each effect
 * against the lens its own stat actually reads.
 *
 * ONLY TWO STATS ARE GATED ON THE ATTRIBUTION (`resolveChainInherentContext`):
 * `skillTypeBonus` and `amplify`. `defIgnore`, `resReduce`, `deepen`, the crit
 * pair and `atkRatio` ignore `skillType` entirely, and `elementBonus`/`resReduce`
 * gate on the ELEMENT — so a stray `skillType` on those is inert, not dead, and
 * this test deliberately says nothing about them.
 *
 * A NAME OUTRANKS A CATEGORY, so a name-bound effect is exempt: once `skillKeys`
 * matches, the category is never consulted. That is also where most of these come
 * from — A SKILL'S OWN NAME LEADS WITH A CATEGORY WORD. The game writes
 * "Resonance Liberation Rewritten in Winter's Margins" and "Forte Circuit - Learn
 * My True Name"; the parser lifts "Resonance Liberation" / "Forte Circuit" out of
 * those and ships a category the sentence never stated. While the name resolves,
 * that invented category is harmless. When the name fails, it is all that is left
 * — and it decides the effect's fate.
 *
 * `'forte'` is the clearest case and gets its own assertions: it is not an
 * attribution tag (the game ships exactly basic/heavy/liberation/intro/skill/
 * echo) AND `nodeTypeMatches` cannot honour it either, because that helper strips
 * `forte_` off the NODE type — so `'forte'` against `forte_heavy` compares with
 * `'heavy'` and fails. It is a provenance prefix on a KEY and a word for the
 * resonator's specialty; it is never a kind of damage. Rewriting it to the real
 * bucket is NOT the fix: all five of Sigrika's Runic rows are tagged `echo`
 * (stated twice over — `dmgTypes` AND her own text, "considered Echo Skill DMG"),
 * but 10 of her keys read that bucket while her clauses name 4, so a category
 * rewrite would widen the grant 2.5x. The scope is the NAMES.
 *
 * MODES MUST BE RESOLVED. A `dmgTypes` pair is a BRANCH, not a mixture: Lucilla's
 * [Letting It Go] is Basic-bucket in Resonance Mode - Glacio Chafe and
 * Echo-bucket in Resonance Mode - Echo. Asking without a mode falls back to
 * `formulaType` and reports her 30% Echo Skill DMG Bonus as dead when some build
 * can read it. The union over every mode is therefore the right question: an
 * effect is dead only when NO build can satisfy it.
 *
 * THE ALLOW LIST IS A CONTRACT, and it may only SHRINK. Every entry states the
 * investigated cause, not a shrug — and an entry that stops being dead FAILS, so
 * a fix must delete its entry rather than quietly leave a stale excuse behind.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { attributionOf } from '../src/core/dmg-attribution.js';
import { nodeTypeMatches } from '../src/core/buffs.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataset = JSON.parse(readFileSync(resolve(__dirname, '../data/wuwa-data.json'), 'utf8'));

let passed = 0, failed = 0;
function assert(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ FAIL: ${name}`); } }

// The stats `resolveChainInherentContext` gates on the hit's ATTRIBUTION.
const BUCKET_LENS_STATS = new Set(['skillTypeBonus', 'amplify']);
// The one stat read off the MECHANICAL node skillType.
const NODE_LENS_STATS = new Set(['multiplierUp']);

// ── Known-dead, each with its investigated cause. May only SHRINK. ───────────
const ALLOW = new Map(Object.entries({
    '1109.S2.0': 'Lucilla: the category belongs to the TRIGGER, not the grant — "While casting '
        + 'Resonance Liberation - Clear As Day, Lucilla grants the following enhancements…". '
        + "CLAUDE.md's own \"leading TRIGGER is not the SCOPE\" invariant; the grant itself states "
        + 'no category, and her kit reads no liberation bucket under either mode.',
    '1412.S6.1': "Sigrika: 'forte' lifted from the NAME \"Forte Circuit - Learn My True Name\". "
        + 'Scoping it alone would still pay nothing: its stack source is [Innate Gift?], gained only '
        + 'when Soliskin Vitality (earned when TEAMMATES cast Echo Skill) is high enough — the '
        + 'team-composition lane OPEN-ITEMS 2 defers. Also an unresolved data-vs-text contradiction: '
        + "ConfigDB scopes this clause's own ceiling (0.6) to 2 keys, its text names 4, and her "
        + 'reference rotation casts 3 of the 4 but NOT one of the 2, so the gap is material.',
    '1412.SN0.2': 'Sigrika: the same grant restated in her Forte text ("[Innate Gift?] … 30% DMG '
        + "Amplification\"), same 'forte'-from-a-name cause and same Innate Gift? blocker — and it "
        + 'lives in skillNodeEffects, which effect-overrides.json CANNOT address (the slot '
        + 'namespaces are only S<level>.<index> and IH<node>.<index>).',
}));

// ── The six attribution tags come from the GAME, and 'forte' is not one ──────
const attributionTags = new Set();
for (const rows of Object.values(dataset.damageTable)) {
    for (const row of rows) for (const tag of row.dmgTypes ?? []) attributionTags.add(tag);
}
{
    assert('the game ships exactly six attribution tags', attributionTags.size === 6);
    for (const tag of ['basic', 'heavy', 'liberation', 'intro', 'skill', 'echo']) {
        assert(`'${tag}' is one of them`, attributionTags.has(tag));
    }
    assert("'forte' is NOT an attribution tag — it is a provenance prefix on a KEY",
        !attributionTags.has('forte'));

    // Nor can the NODE lens honour it: nodeTypeMatches strips `forte_` from the
    // node type, so 'forte' is compared against 'heavy'/'basic' and never matches.
    const allNodeTypes = new Set();
    for (const skillMap of Object.values(dataset.autoSkillMap)) {
        for (const def of Object.values(skillMap)) if (def.skillType) allNodeTypes.add(def.skillType);
    }
    assert('forte_-prefixed node types exist, so the helper has something to strip',
        [...allNodeTypes].some(nodeType => nodeType.startsWith('forte_')));
    assert("no node skillType on the roster is matched by the scope 'forte'",
        [...allNodeTypes].every(nodeType => !nodeTypeMatches('forte', nodeType)));
    // The stripped form IS matchable — that is what the helper exists for.
    assert("'heavy' does match a forte_heavy node, which is the helper's purpose",
        nodeTypeMatches('heavy', 'forte_heavy'));
}

// ── Every unbound, category-scoped effect must be satisfiable by some hit ────
const dead = new Map();
for (const resonator of dataset.resonators) {
    const skillMap = dataset.autoSkillMap[String(resonator.id)] ?? {};
    const table = dataset.damageTable[String(resonator.id)] ?? [];
    const modes = resonator.resonanceModes ?? [];

    // Every bucket any hit of this kit can read, UNION over every mode — a mode
    // is a build-level toggle, so an effect is dead only if no build at all can
    // satisfy it.
    const buckets = new Set(), nodeTypes = new Set();
    for (const def of Object.values(skillMap)) {
        if (def.skillType) nodeTypes.add(def.skillType);
        for (const id of def.damageIds ?? []) {
            const row = table.find(entry => entry.id === id);
            if (!row) continue;
            const fallback = def.formulaType ?? def.skillType;
            if (modes.length) {
                for (const mode of modes) {
                    buckets.add(attributionOf(row, fallback, { modes, resonanceMode: mode.key }));
                }
            } else {
                buckets.add(attributionOf(row, fallback, {}));
            }
        }
    }

    const lanes = [
        [resonator.resonanceChain, (ni, ei) => `S${ni + 1}.${ei}`],
        [resonator.inherentSkills, (ni, ei) => `IH${ni}.${ei}`],
        // NOT an addressable override slot — named for reporting only.
        [resonator.skillNodeEffects, (ni, ei) => `SN${ni}.${ei}`],
    ];
    for (const [nodes, slotOf] of lanes) {
        (nodes ?? []).forEach((node, ni) => (node.effects ?? []).forEach((effect, ei) => {
            if (effect.skillType == null) return;          // no category to be dead
            if (effect.skillKeys?.length) return;          // a NAME outranks the category
            if (effect.teamWide) return;                   // pays someone else's hits
            // Same reason: an "the incoming Resonator gains …" clause is paid to the
            // member switching IN, so the WIELDER'S kit is the wrong kit to ask.
            // `resolveChainInherentContext` skips these outright — the outro lane
            // (`outroBuffs`) owns the grant, and all four roster clauses of this
            // shape are already carried there at the same value and duration.
            if (effect.recipient === 'incoming') return;
            const bucketLens = BUCKET_LENS_STATS.has(effect.stat);
            if (!bucketLens && !NODE_LENS_STATS.has(effect.stat)) return;  // not gated on skillType
            const live = bucketLens
                ? buckets.has(effect.skillType)
                : [...nodeTypes].some(nodeType => nodeTypeMatches(effect.skillType, nodeType));
            if (live) return;
            dead.set(`${resonator.id}.${slotOf(ni, ei)}`, {
                name: resonator.name, stat: effect.stat, scope: effect.skillType,
                lens: bucketLens ? 'bucket' : 'node',
                reachable: [...(bucketLens ? buckets : nodeTypes)].sort().join(','),
                condition: (effect.condition ?? '').slice(0, 100),
            });
        }));
    }
}

{
    for (const [slot, info] of dead) {
        assert(`${slot} (${info.name}) ${info.lens}-lens ${info.stat} scoped '${info.scope}' is DEAD`
            + ` — kit reaches {${info.reachable}}`
            + (ALLOW.has(slot) ? ' — allow-listed' : ` — NOT allow-listed: ${info.condition}`),
            ALLOW.has(slot));
    }
    // The contract's other half: a fixed effect must have its entry DELETED, or
    // the list silently keeps a stale excuse and stops meaning anything.
    for (const slot of ALLOW.keys()) {
        assert(`allow-list entry ${slot} is still dead — delete it once fixed`, dead.has(slot));
    }
    assert(`the allow list holds exactly the dead set (${dead.size} dead, ${ALLOW.size} allowed)`,
        dead.size === ALLOW.size);
    // The 'forte' subset shares one cause; keep its size visible so a partial fix
    // has to restate it rather than slip past.
    const forteDead = [...dead.values()].filter(info => info.scope === 'forte').length;
    // Was 4, then 3, now 2. Fixed entries are GONE from the list rather than left
    // the allow list rather than left behind as stale excuses: Camellya's S6.0
    // (bound to Sweet Dream's own nine keys + the Budding Mode gate) and Taoqi's
    // S5.0 (bound to the three Timed Counters stages that ARE Power Shift).
    // The two that remain are Sigrika's, blocked behind the Innate Gift? gauge.
    assert(`'forte' accounts for 2 dead scopes, both lifted from a skill NAME`, forteDead === 2);
}

console.log(`\ndead-scope: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
