/**
 * Shared rate-vector ↔ raw-hit-instance matching (P13-fix-3, 2026-07-03;
 * extracted to a neutral module 2026-07-16 so tools/extract-forte.mjs can
 * reuse the SAME rigorous algorithm instead of its own naive matcher).
 *
 * Problem this solves: a display row's `mults` is a per-level array of TERM
 * STRINGS ("20%*4" = one term, 4 hits, 20% each), but the raw source (nanoka's
 * `sk.damage`, or an external dump like Arikatsu BinData's `damage.json`)
 * lists ONE ENTRY PER INDIVIDUAL HIT. Naively comparing a row's total against
 * a single raw entry only works for single-hit rows; multi-hit rows need the
 * term parsed (base value × hit count) and matched against a CLUSTER of
 * raw entries, not one.
 *
 * Universal facts this exploits (verified on real data, both sources):
 * (a) entries of the SAME row-term are ID-adjacent (diff ≈ 1);
 * (b) same-vector entries of DIFFERENT rows are far apart (diff ≥ 100).
 * So candidates cluster by ID gap, and rows consume clusters — the same
 * top-to-bottom reconciliation a manual read of the raw table produces.
 *
 * Generalized over WHICH value(s) to sum per matched instance (`fields`) and
 * which fields identify a "hidden 2×-shadow" duplicate (`identityFields`) —
 * preprocess.mjs sums nanoka's `energy`/`element_power`; extract-forte.mjs
 * sums Arikatsu's `SpecialEnergy{1,2,3}`, keyed by its own field names.
 */

// "A%+B%*2+C" → [{base, hits, pct}] per term (null for unparseable terms).
export function parseHitTerms(multVal) {
    const out = [];
    for (const term of String(multVal).split('+')) {
        const [baseStr, nStr] = term.split('*');
        const pct = /%/.test(baseStr);
        const base = parseFloat(baseStr.replace(/%/g, '').trim());
        if (!Number.isFinite(base)) { out.push(null); continue; }
        const hits = Math.max(1, Math.round(parseFloat(nStr ?? '1') || 1));
        out.push({ base, hits, pct });
    }
    return out;
}

// Per-term ×100 value vectors over the row's usable levels. Levels whose term
// count differs from level 1 are skipped (some rows gain/lose terms at high
// levels); a row needs ≥3 usable levels to be matchable.
export function rowTermVectors(mults) {
    const perLevel = mults.map(parseHitTerms);
    const length = perLevel[0]?.length ?? 0;
    if (!length) return null;
    const usable = perLevel.map((terms, i) => (terms.length === length ? i : -1)).filter(i => i >= 0);
    if (usable.length < 3) return null;
    const vectors = [];
    for (let j = 0; j < length; j++) {
        if (usable.some(i => perLevel[i][j] === null)) { vectors.push(null); continue; }
        const pct = perLevel[usable[0]][j].pct;
        const hits = perLevel[usable[0]][j].hits;
        if (usable.some(i => perLevel[i][j].pct !== pct || perLevel[i][j].hits !== hits)) { vectors.push(null); continue; }
        vectors.push({ pct, hits, levels: usable, vec: usable.map(i => Math.round(perLevel[i][j].base * 100)) });
    }
    return vectors;
}

// Level-1 exact; later levels tolerate display-rounding drift (±max(3, 0.1%)).
export function termEntryMatches(term, rateLv) {
    if (!rateLv?.length) return false;
    let compared = 0;
    for (let k = 0; k < term.levels.length; k++) {
        const lvIdx = term.levels[k];
        if (lvIdx >= rateLv.length) break;
        const rate = Math.round(rateLv[lvIdx]);
        const tol = compared === 0 ? 0 : Math.max(3, Math.round(rate * 0.001));
        if (Math.abs(rate - term.vec[k]) > tol) return false;
        compared++;
    }
    return compared >= 3;
}

// Is `b` a hidden 2×-shadow of some lower-ID entry (double vector, equal
// identity fields, e.g. energy/element_power)? Used ONLY to break ties
// between candidate clusters. `identityOf(e)` returns a small array of
// numbers that must match exactly between the two entries.
export function isShadowEntry(entry, entries, identityOf) {
    const identityB = identityOf(entry.e);
    for (const other of entries) {
        if (other === entry || entry.idNum <= other.idNum) continue;
        const identityA = identityOf(other.e);
        if (identityA.length !== identityB.length || identityA.some((value, i) => value !== identityB[i])) continue;
        const ratesA = other.e.rate_lv ?? [], ratesB = entry.e.rate_lv ?? [];
        if (!ratesA.length || ratesA.length !== ratesB.length) continue;
        let isDouble = true;
        for (let i = 0; i < ratesA.length; i++) {
            if (Math.abs(ratesB[i] - 2 * ratesA[i]) > Math.max(3, Math.round(ratesB[i] * 0.001))) { isDouble = false; break; }
        }
        if (isDouble) return true;
    }
    return false;
}

// Group same-vector candidates into ID-adjacency clusters; return the first
// (lowest-ID) cluster whose head is not a 2×-shadow (falling back to the
// first cluster when all are shadows).
const HIT_CLUSTER_GAP = 10n;
export function pickHitCluster(matches, allEntries, identityOf) {
    const sorted = [...matches].sort((entryA, entryB) => (entryA.idNum < entryB.idNum ? -1 : entryA.idNum > entryB.idNum ? 1 : 0));
    const clusters = [];
    let cluster = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].idNum - sorted[i - 1].idNum <= HIT_CLUSTER_GAP) cluster.push(sorted[i]);
        else { clusters.push(cluster); cluster = [sorted[i]]; }
    }
    clusters.push(cluster);
    if (clusters.length === 1) return clusters[0];
    const nonShadow = clusters.filter(cluster => !isShadowEntry(cluster[0], allEntries, identityOf));
    return (nonShadow.length ? nonShadow : clusters)[0];
}

/**
 * Per-row {[fieldKey]: sum, hitTypes, hitIds} — consumes matched entries from
 * the shared `consumed` set (rows should be processed in a stable order, e.g.
 * sk.level order). `mults` is the row's FULL per-level raw-string array
 * (`paramV.param[0]`), not an already-collapsed numeric total.
 *
 * `hitIds` lists the raw entry ID of every counted hit, aligned with
 * `hitTypes` (repeated-last-entry hits repeat that entry's ID — mirroring the
 * value accumulation exactly). Since nanoka's entry IDs ARE the game's own
 * BinData damage IDs (verified 2650/2650 roster-wide, 2026-07-16), these IDs
 * are a direct join key into any external BinData table (e.g. Arikatsu
 * damage.json's SpecialEnergy fields) — no re-matching needed downstream.
 *
 * @param {Array<string>} mults
 * @param {Array<{id, idNum:bigint, e:object}>} nodeEntries - candidate raw hit instances
 * @param {Set<string>} consumed - mutated; shared across rows in the same scope
 * @param {Object<string,(e:object)=>number>} fields - value(s) to sum per matched instance
 * @param {Array<string>} [identityFields] - `e` field names used for shadow-duplicate detection
 * @param {(e:object)=>*} [typeOf] - optional per-instance type-tag reader (defaults to `e.type`)
 */
export function matchRowHits(mults, nodeEntries, consumed, fields, identityFields = ['energy', 'element_power'], typeOf = (entry) => entry.type) {
    const totals = {};
    for (const k of Object.keys(fields)) totals[k] = 0;
    const hitTypes = [];
    const hitIds = [];
    const identityOf = (entry) => identityFields.map(field => entry[field] ?? 0);
    const vectors = rowTermVectors(mults) ?? [];
    for (const term of vectors) {
        if (!term || !term.pct) continue;
        let matches = nodeEntries.filter(entry => !consumed.has(entry.id) && termEntryMatches(term, entry.e.rate_lv));
        let reused = false;
        if (!matches.length) {
            matches = nodeEntries.filter(entry => consumed.has(entry.id) && termEntryMatches(term, entry.e.rate_lv));
            reused = true;
        }
        if (!matches.length) continue;
        const cluster = pickHitCluster(matches, nodeEntries, identityOf);
        const take = Math.min(term.hits, cluster.length);
        for (let hitIndex = 0; hitIndex < take; hitIndex++) {
            if (!reused) consumed.add(cluster[hitIndex].id);
            for (const [k, fieldFn] of Object.entries(fields)) totals[k] += fieldFn(cluster[hitIndex].e);
            hitTypes.push(typeOf(cluster[hitIndex].e));
            hitIds.push(cluster[hitIndex].id);
        }
        for (let hitIndex = take; hitIndex < term.hits; hitIndex++) {
            for (const [k, fieldFn] of Object.entries(fields)) totals[k] += fieldFn(cluster[take - 1].e);
            hitTypes.push(typeOf(cluster[take - 1].e));
            hitIds.push(cluster[take - 1].id);
        }
    }
    return { ...totals, hitTypes, hitIds };
}
