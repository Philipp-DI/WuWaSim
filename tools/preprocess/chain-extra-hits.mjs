/**
 * Damage instances a Resonance Chain ADDS, which no display row ever mentions.
 *
 * The game ships a chain's extra hits as ordinary bullets whose names carry a
 * 共鸣N (chain N) marker, and their damage rows are already in `damageTable` —
 * `matchRowHits` simply never attaches them to a skill key, because the kit's
 * display rows are written for an S0 build. So an S1 Xiangli Yao's six
 * Convolution Matrices (`1305053101`, 25.68% each) were shipped, present, and
 * worth nothing: 111 such rows across 20 resonators.
 *
 * ADDITION vs REPLACEMENT is the whole problem. Most chain-marked bullets
 * UPGRADE a hit that already exists — Carlotta's `大招-终结-共鸣2` replaces
 * `大招-终结` — and adding those would double the hit instead of improving it.
 * The two are separated by the game's own naming: strip the 共鸣N marker and
 * look for a sibling bullet of the same owner with the remaining name. A hit
 * means the chain replaces that bullet (skip it, the display row already
 * carries the base and the upgrade is not modelled); no hit means the chain
 * introduces it. Measured 2026-08-08: 22 additions against 84 replacements, and
 * the additions corroborate themselves — they are the ones the game names
 * 额外 ("extra"): `退场-伤害(共鸣3额外)`, `[共鸣2]额外添加…`, `共鸣6-额外触发…`.
 *
 * The PARENT is resolved by id prefix, the same longest-prefix route
 * map-timings.mjs and buff-facts use: `1305053101` shares `1305053` with
 * `1305053001`/`1305053002`, both of which sit under
 * `forte_heavy_law_of_reigns`. A prefix that spans two skill keys is refused
 * rather than guessed — an extra hit on the wrong skill is worse than none,
 * since it would take that skill's buffs and its type.
 */

const CHAIN_MARKER = /[（(]?共鸣(\d)[)）]?/;
const MIN_PREFIX = 6;

/**
 * Damage ids the kit text CONFIRMS are additions. The name test above finds
 * candidates; it does not settle them, and measured 2026-08-08 it is wrong more
 * often than it is right — of 16 candidates, spot-checking each against its own
 * chain node found Cantarella's S1 "finisher" bullets and Phoebe's S6 heavies to
 * be upgraded versions of existing hits whose base bullet is merely named
 * differently, and Zhezhi's genuine extra Ivory Herald to resolve onto the wrong
 * parent (her Liberation, when the kit fires it from her Resonance Skill and
 * calls it Basic Attack DMG). So an entry ships only once its chain node has
 * been read and agrees, and the note records what the node says.
 *
 * The DATA still supplies everything quantitative — which row, how many
 * instances, the per-level multipliers. This list only answers "is it an
 * addition", which the game states in English and nowhere in the tables.
 */
const KIT_VERIFIED = new Map([
    [1305053101, 'Xiangli Yao S1: "Law of Reigns additionally launches 6 Convolution '
        + 'Matrices … each dealing … 8% of the skill\'s DMG Multiplier." Six bullets '
        + '(1305053101..106) share this row at 0.2568, exactly 8% of Law of Reigns\' own '
        + '3.21 total (4 x 0.4815 + 1.284).'],
    [1305053201, 'Xiangli Yao S6: the same six matrices, upgraded. 0.452 / 0.2568 = 1.76, '
        + 'exactly the "+76% DMG Multiplier of Law of Reigns" S6 states — so it supersedes '
        + 'the S1 row rather than adding to it.'],
]);

/**
 * A bullet name with its chain marker and trailing punctuation removed.
 *
 * Trailing DIGITS are kept: `子魔方1` and `子魔方2` are two different sub-cubes,
 * and collapsing them would call the second a replacement of the first.
 */
export function stripChainMarker(name) {
    return String(name ?? '').replace(CHAIN_MARKER, '').replace(/[\s\-—_+]*$/, '').trim();
}

/**
 * The single skill key a damage id belongs under, or null when ambiguous.
 * @param {string} damageId
 * @param {Map<string, Set<string>>} keysByHitId — game damage id → skill keys
 */
function parentKeyFor(damageId, keysByHitId) {
    const id = String(damageId);
    for (let length = id.length - 1; length >= MIN_PREFIX; length--) {
        const prefix = id.slice(0, length);
        const keys = new Set();
        for (const [hitId, hitKeys] of keysByHitId) {
            if (hitId.startsWith(prefix)) for (const key of hitKeys) keys.add(key);
        }
        if (keys.size === 1) return [...keys][0];
        if (keys.size > 1) return null;      // splits across skills — refuse
    }
    return null;
}

/**
 * Chain-added damage instances per resonator.
 *
 * @param {object} args
 * @param {object} args.bulletNames        bullet id → name (bullet-timings.json)
 * @param {object} args.bulletDamageIds    bullet id → damage ids
 * @param {object} args.hitMap             rid → skillKey → game damage ids
 * @param {object} args.damageTable        rid → rows carrying `id`
 * @returns {{ extras: object, skipped: Array }} extras keyed by resonator id
 */
export function buildChainExtraHits({ bulletNames, bulletDamageIds, hitMap, damageTable }) {
    const extras = {};
    const skipped = [];

    for (const rid of Object.keys(hitMap ?? {})) {
        const keysByHitId = new Map();
        for (const [key, hitIds] of Object.entries(hitMap[rid] ?? {})) {
            for (const hitId of hitIds ?? []) {
                if (!keysByHitId.has(String(hitId))) keysByHitId.set(String(hitId), new Set());
                keysByHitId.get(String(hitId)).add(key);
            }
        }
        if (!keysByHitId.size) continue;
        const rows = new Set((damageTable?.[rid] ?? []).map(row => String(row.id)));

        // Bullets of this owner that carry NO chain marker, by stripped name —
        // the evidence that a marked bullet is an upgrade rather than an addition.
        const baseNames = new Set();
        for (const [bullet, name] of Object.entries(bulletNames ?? {})) {
            if (bullet.startsWith(rid) && !CHAIN_MARKER.test(name ?? '')) baseNames.add(stripChainMarker(name));
        }

        // (chain, damageId) → how many distinct bullets fire it. Xiangli Yao's
        // six sub-cubes all point at one row, so the COUNT is the instance count.
        // `family` is the bullet's name without its chain marker: one bullet can
        // ship a variant per chain level (his sub-cubes exist at 共鸣1 AND 共鸣6),
        // and those SUPERSEDE each other rather than stacking.
        const tally = new Map();
        for (const [bullet, name] of Object.entries(bulletNames ?? {})) {
            if (!bullet.startsWith(rid)) continue;
            const marker = CHAIN_MARKER.exec(name ?? '');
            if (!marker) continue;
            const family = stripChainMarker(name);
            if (baseNames.has(family)) continue;                              // replacement
            for (const damageId of bulletDamageIds?.[bullet] ?? []) {
                const id = String(damageId);
                if (keysByHitId.has(id)) continue;                            // already counted
                if (!rows.has(id)) continue;                                  // no multiplier shipped
                const slot = `${marker[1]}|${id}`;
                if (!tally.has(slot)) tally.set(slot, { chain: Number(marker[1]), damageId: id, count: 0, family });
                tally.get(slot).count += 1;
            }
        }

        for (const entry of tally.values()) {
            const skillKey = parentKeyFor(entry.damageId, keysByHitId);
            if (!skillKey) {
                skipped.push({ rid, ...entry, reason: 'no unique parent skill key' });
                continue;
            }
            // A row whose multiplier is zero at every level contributes nothing;
            // carrying it would only add noise to the strip and the tests.
            const row = (damageTable?.[rid] ?? []).find(candidate => String(candidate.id) === entry.damageId);
            if (!(row?.mults ?? []).some(mult => mult > 0)) {
                skipped.push({ rid, ...entry, reason: 'row has no non-zero multiplier' });
                continue;
            }
            const note = KIT_VERIFIED.get(Number(entry.damageId));
            if (!note) {
                skipped.push({ rid, ...entry, skillKey, reason: 'candidate not confirmed by kit text' });
                continue;
            }
            (extras[rid] ??= []).push({
                chain: entry.chain, skillKey, damageId: Number(entry.damageId),
                count: entry.count, family: entry.family, note,
            });
        }
        extras[rid]?.sort((left, right) => left.chain - right.chain
            || left.skillKey.localeCompare(right.skillKey) || left.damageId - right.damageId);
    }
    return { extras, skipped };
}
