/**
 * Forte-gauge extraction (Lever 2, 2026-07-11) — distills per-resonator Forte
 * data from the Arikatsu BinData dump into a small committed overlay
 * (data/forte-data.json) that preprocess.mjs merges into the skill map.
 *
 * Sources (data/bindata/*.json are committed external dumps — large,
 * infrequently-updated raw tables; moved out of the formerly-gitignored
 * docs/ folder 2026-07-16 so a fresh checkout can regenerate Forte data
 * without re-fetching them; re-run this tool when the dump updates, like
 * tools/fetch-nanoka-chars.mjs):
 *   data/bindata/damage.json       — per damage instance: Id, SpecialEnergy1-5 (Forte)
 *   data/bindata/baseproperty.json — per entity: SpecialEnergy{1..5}Max (the gauge CAP)
 *   data/hit-map.json              — skill key → raw per-hit damage-instance IDs
 *                                    (written by preprocess.mjs)
 *
 * REWRITE 2026-07-16 (second pass, same day — ID JOIN, no matching at all):
 * investigating "switch sources entirely?" established that nanoka's per-hit
 * entry IDs ARE the game's own BinData damage IDs — all 2,650 nanoka entries
 * roster-wide exist in the Arikatsu dump under the identical ID, 2,629
 * value-identical on (rate vector + energy + element_power); nanoka is a
 * projection of the same table with SpecialEnergy dropped. So the row→hit
 * attribution preprocess.mjs already performs (matchRowHits) is the ONLY
 * matching that ever needs to happen: it now records the matched raw IDs per
 * skill key (data/hit-map.json), and this tool reads SpecialEnergy for those
 * exact instances by DIRECT ID LOOKUP. This supersedes both prior versions'
 * rate-vector matching against Arikatsu (the original collapsed-mults matcher
 * AND the same-day matchRowHits-based rewrite) — deleted, not generalized:
 * one attribution algorithm, one place (preprocess), zero re-matching.
 *
 * Known limitation (unchanged, documented in CLAUDE.md): FLAT on-cast gauge
 * grants that have no damage instance at all (e.g. Chisa's Intro +20 /
 * Liberation +40 Ring of Chainsaw — pure kit-text state effects) exist in
 * NEITHER source's damage table, so no join or matcher can recover them.
 * Those need a kit-text-curated override channel if ever modeled.
 *
 *   node tools/extract-forte.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rd = (p) => JSON.parse(readFileSync(resolve(ROOT, p), 'utf8'));
const first = (a) => Array.isArray(a) ? a[0] : (a ?? 0);

for (const f of ['data/bindata/damage.json', 'data/bindata/baseproperty.json', 'data/hit-map.json']) {
    if (!existsSync(resolve(ROOT, f))) { console.error(`MISSING ${f} — cannot extract Forte data. Aborting (no output written).`); process.exit(1); }
}

const dmg = rd('data/bindata/damage.json');
const baseProp = rd('data/bindata/baseproperty.json');
const hitMap = rd('data/hit-map.json').map;

// BinData damage instances by ID — the whole join.
const binById = new Map();
for (const raw of dmg) {
    if (raw.Id < 1e6) continue;
    binById.set(String(raw.Id), {
        se1: first(raw.SpecialEnergy1),
        se2: first(raw.SpecialEnergy2),
        se3: first(raw.SpecialEnergy3),
    });
}
// baseproperty: first (lv1) entry per Id (== resonator id via roleinfo.PropertyId).
const capById = new Map();
for (const e of baseProp) if (!capById.has(e.Id)) capById.set(e.Id, e);

const out = {};
let rosterIds = 0, rosterJoined = 0, charsWithForte = 0;
const report = [];
const staleIds = [];   // hit-map IDs absent from the dump (dump older than nanoka)

for (const [id, keys] of Object.entries(hitMap)) {
    const nid = +id;
    const cap = capById.get(nid);

    // Per-key SpecialEnergy sums over the key's exact damage instances.
    const perKey = {};   // key → { 1: sum, 2: sum, 3: sum }
    const usage = { 1: 0, 2: 0, 3: 0 };   // hits with a nonzero value per channel
    for (const [key, ids] of Object.entries(keys)) {
        const sums = { 1: 0, 2: 0, 3: 0 };
        for (const hid of ids) {
            rosterIds++;
            const se = binById.get(String(hid));
            if (!se) { staleIds.push(`${id}.${key}:${hid}`); continue; }
            rosterJoined++;
            sums[1] += se.se1; sums[2] += se.se2; sums[3] += se.se3;
            for (const ch of [1, 2, 3]) if (se[`se${ch}`] !== 0) usage[ch]++;
        }
        perKey[key] = sums;
    }

    // Channel = the SpecialEnergy the char's abilities actually use most, with a
    // real (non-tiny) cap. Defaults SE3Max=100/SE4=6000/SE5=10000 are global —
    // require ≥2 using hits and a cap ≥ 10 (excludes tiny counters like SE1Max=3).
    let channel = null, best = 1;
    for (const ch of [1, 2, 3]) {
        const c = cap?.[`SpecialEnergy${ch}Max`] ?? 0;
        if (usage[ch] >= 2 && c >= 10 && usage[ch] > best - 1) { channel = ch; best = usage[ch]; }
    }
    if (channel == null) { report.push(`  ${id}: no Forte channel (usage ${JSON.stringify(usage)})`); continue; }
    const forteCap = cap[`SpecialEnergy${channel}Max`];

    const gen = {};
    for (const [key, sums] of Object.entries(perKey)) {
        if (sums[channel] !== 0) gen[key] = sums[channel];
    }
    if (Object.keys(gen).length === 0) { report.push(`  ${id}: channel ${channel} but no generating skills`); continue; }

    out[id] = { channel, cap: forteCap, gen };
    charsWithForte++;
    report.push(`  ${id}: ch${channel} cap${forteCap} — ${Object.keys(gen).length} gen skills`);
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 2 (2026-07-16) — FLAT on-cast gauge grants from kit text.
//
// Some kits top up their Forte gauge with flat "Casting X grants N points of
// [Resource]" state effects that have NO damage instance in any source (e.g.
// Chisa's Liberation +40 / Intro +20 Ring of Chainsaw) — invisible to the
// per-hit ID join above by construction. This phase parses that exact phrase
// family from the kit text (autoSkillMap descs) and folds the grants into
// gen[key], but ONLY when every resolution step is unambiguous:
//
//   1. The sentence is UNCONDITIONAL (no "When/While in …", "additionally",
//      "enhances the next", "at the same time", or a vague "this skill" —
//      those need state modeling or manual reading, and are FLAGGED instead).
//   2. The trigger resolves mechanically: "Casting Intro Skill …" → the
//      intro-type keys; "Casting Resonance Liberation …" → the consuming
//      liberation keys; "Casting [Named Move]" → exact normalized-label match.
//   3. The [Resource] resolves to the resonator's SELECTED channel via its
//      declared cap ("holds up to N points of [R]" / "[R] is capped at N"):
//      the selected channel's cap must equal N (scale 1) or N×100 (raw scale
//      — e.g. Aemeath's Synchronization Rate: kit cap 200, channel cap 20000,
//      so a kit-text "+40" is +4000 raw). Since sibling channels often share
//      a cap value (Chisa 100/100/100; Hiyuki 300/300), the cap alone can't
//      disambiguate — the tiebreaker is TEXT-TO-SIGNAL correlation: the
//      selected channel is, by construction, the one with per-hit join
//      signal, so a resource whose kit text declares ON-HIT income
//      ("Hitting a target … grants [R]", "Dealing damage with … recovers
//      [R]") IS the selected channel's resource. A resource gained ONLY by
//      casts/time with a cap that also matches another channel (Hiyuki's
//      Dedication vs. her per-hit Frostheart, both 300) is FLAGGED —
//      cross-channel grants need multi-gauge modeling first.
//   4. Double-count guard: a target key that already carries per-hit gen on
//      this channel is FLAGGED, not topped up (the grant may already be
//      represented as per-hit SpecialEnergy for that cast).
//
// Applied grants are recorded under `flat` (raw channel units) for audit;
// everything flagged prints in the report and is deliberately NOT applied.
// ═══════════════════════════════════════════════════════════════════════════

const wuwa = rd('data/wuwa-data.json');
const GRANT_RE = /\b(?:grants?|restores?|recovers?|gains?)\s+(\d+)\s*points?\s*of\s*\[([^\]]+)\]/gi;
const CONDITIONAL_RE = /\bwhen\b|\bwhile\b|additionally|enhances the next|at the same time|\bthis skill\b|\bupon\b/i;
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

const flatApplied = [];
const flatFlagged = [];

for (const [id, entry] of Object.entries(out)) {
    const skillMap = wuwa.autoSkillMap[id];
    if (!skillMap) continue;
    const cap = capById.get(+id);

    // Deduplicated kit text (node descs are shared across sibling keys).
    const descs = [...new Set(Object.values(skillMap).map(d => d.desc).filter(Boolean))];
    const allText = descs.join('\n');

    // Declared display cap per [Resource] name.
    const resourceCaps = new Map();
    for (const re of [
        /(?:holds?|can hold)\s+up\s+to\s+(\d+)\s*points?\s*of\s*\[([^\]]+)\]/gi,
        /\[([^\]]+)\]\s*is\s+capped\s+at\s+(\d+)\s*points?/gi,
        /\[([^\]]+)\]\s*has\s+a\s+maximum\s+of\s+(\d+)\s*points?/gi,
    ]) {
        let m;
        while ((m = re.exec(allText))) {
            const [a, b] = [m[1], m[2]];
            const [n, r] = /^\d+$/.test(a) ? [Number(a), b] : [Number(b), a];
            if (!resourceCaps.has(norm(r))) resourceCaps.set(norm(r), { name: r, cap: n });
        }
    }

    // Which resources declare ON-HIT income? (the text-to-signal tiebreaker —
    // per-hit income is exactly what the selected channel's join signal IS.)
    // The grant verb must apply TO the resource ("grants [R]", "recovers [R]",
    // "[R] is restored") — a mere co-mention in a hit sentence is not income
    // (e.g. Hiyuki's "consume 1 point of [Frostharden Iai] to inflict … on
    // hit" is a SPEND that would otherwise false-positive).
    const perHitResources = new Set();
    for (const desc of descs) {
        for (const sentence of desc.split(/(?<=\.)\s+|\n/)) {
            if (!/hitting\s+a\s+target|hits\s+the\s+target|dealing\s+damage\s+with|\bon\s+hit\b/i.test(sentence)) continue;
            for (const [rk, rc] of resourceCaps) {
                const nameRe = rc.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                if (new RegExp(`(?:grants?|recovers?|restores?|obtains?|gains?)[^.\\[\\]]{0,40}\\[${nameRe}\\]`, 'i').test(sentence)
                    || new RegExp(`\\[${nameRe}\\]\\s*is\\s+(?:restored|recovered|granted)`, 'i').test(sentence)) {
                    perHitResources.add(rk);
                }
            }
        }
    }

    // Key lookup tables for trigger resolution.
    const keysByLabel = new Map();
    const introKeys = [], libKeys = [];
    for (const [key, def] of Object.entries(skillMap)) {
        if (key.startsWith('_')) continue;
        keysByLabel.set(norm(def.label ?? ''), key);
        // Labels carry a category prefix ("Basic Attack: …") — also index the
        // bare move name after the colon for "[Named Move]" references.
        const bare = (def.label ?? '').split(':').slice(1).join(':');
        if (bare && !keysByLabel.has(norm(bare))) keysByLabel.set(norm(bare), key);
        if (def.skillType === 'intro') introKeys.push(key);
        if (def.skillType === 'liberation' && def.consumesResource !== false) libKeys.push(key);
    }

    // Sentence-scoped scan.
    const flag = (reason, sentence, extra = {}) =>
        flatFlagged.push({ id, reason, sentence: sentence.replace(/\s+/g, ' ').trim().slice(0, 160), ...extra });
    for (const desc of descs) {
        for (const sentence of desc.split(/(?<=\.)\s+|\n/)) {
            GRANT_RE.lastIndex = 0;
            let g;
            while ((g = GRANT_RE.exec(sentence))) {
                const amount = Number(g[1]);
                const resource = g[2];
                if (CONDITIONAL_RE.test(sentence)) { flag('conditional sentence', sentence, { resource, amount }); continue; }

                // Trigger → keys.
                let keys;
                if (/Casting\s+(?:the\s+)?Intro\s+Skill/i.test(sentence)) keys = introKeys;
                else if (/Casting\s+(?:the\s+)?Resonance\s+Liberation/i.test(sentence)) keys = libKeys;
                else {
                    const names = [...sentence.matchAll(/Casting\s+(?:Resonance\s+Skill\s+)?\[([^\]]+)\]/gi)].map(m => m[1]);
                    keys = names.map(n => keysByLabel.get(norm(n))).filter(Boolean);
                    if (names.length && keys.length !== names.length) { flag('unresolvable named move(s)', sentence, { resource, amount }); continue; }
                }
                if (!keys.length) { flag('no cast trigger in sentence', sentence, { resource, amount }); continue; }

                // Resource → channel/scale, must be the SELECTED channel.
                const rc = resourceCaps.get(norm(resource));
                if (!rc) { flag('no declared cap for resource', sentence, { resource, amount }); continue; }
                // ×100 raw-scale only for real gauges: a tiny cap (< 20) is a
                // stack counter whose ×100 value colliding with a sibling
                // gauge's cap is coincidence (Frostharden Iai 3 vs. 300).
                const selectedMatches = entry.cap === rc.cap || (rc.cap >= 20 && entry.cap === rc.cap * 100);
                if (!selectedMatches) { flag(`resource cap ${rc.cap} does not match selected channel ${entry.channel} (cap ${entry.cap})`, sentence, { resource, amount }); continue; }
                const otherMatches = [1, 2, 3].filter(ch => {
                    if (ch === entry.channel) return false;
                    const c = cap?.[`SpecialEnergy${ch}Max`] ?? 0;
                    return c === rc.cap || c === rc.cap * 100;
                });
                // Sibling channels share the cap value → only the on-hit
                // text-to-signal correlation can claim the selected channel.
                if (otherMatches.length && !perHitResources.has(norm(resource))) {
                    flag(`ambiguous: cap also matches channel(s) ${otherMatches.join(',')} and [${resource}] declares no on-hit income — may be a second gauge (multi-gauge modeling needed)`, sentence, { resource, amount });
                    continue;
                }
                const scale = entry.cap === rc.cap ? 1 : 100;

                for (const key of keys) {
                    if ((entry.gen[key] ?? 0) !== 0) { flag('target key already has per-hit gen (possible double-count)', sentence, { resource, amount, key }); continue; }
                    entry.gen[key] = amount * scale;
                    (entry.flat ??= {})[key] = amount * scale;
                    flatApplied.push({ id, key, resource, raw: amount * scale, display: amount });
                }
            }
        }
    }
}

writeFileSync(resolve(ROOT, 'data/forte-data.json'), JSON.stringify(out, null, 1) + '\n');
console.log(`Forte extraction (ID join): ${charsWithForte} resonators with Forte data | ${rosterJoined}/${rosterIds} hit IDs joined`);
if (staleIds.length) console.log(`STALE dump — ${staleIds.length} hit-map ID(s) absent from data/bindata/damage.json (nanoka is newer; refresh the dump):\n  ${staleIds.slice(0, 20).join('\n  ')}${staleIds.length > 20 ? `\n  … +${staleIds.length - 20} more` : ''}`);
console.log(report.join('\n'));
// Resonators with flat-grant kit text but NO Forte channel at all (no per-hit
// signal to anchor a model) — e.g. Iuno (Sentience: ALL income is flat casts),
// Lynae (Overflow). Invisible to the loops above by construction; surfaced so
// they aren't forgotten (modeling them needs a flat-only gauge concept first).
const unmodeled = [];
for (const [id, skillMap] of Object.entries(wuwa.autoSkillMap)) {
    if (out[id]) continue;
    const text = [...new Set(Object.values(skillMap).map(x => x.desc).filter(Boolean))].join('\n');
    GRANT_RE.lastIndex = 0;
    const hits = [...text.matchAll(GRANT_RE)];
    if (hits.length) unmodeled.push(`${id} (${hits.length} grant mention(s): ${[...new Set(hits.map(h => h[2]))].join(', ')})`);
}

console.log(`\nFlat on-cast grants (Phase 2): ${flatApplied.length} applied`);
for (const a of flatApplied) console.log(`  ${a.id}.${a.key} += ${a.raw}${a.raw !== a.display ? ` (kit text: ${a.display}, ×100 raw scale)` : ''} [${a.resource}]`);
console.log(`Flat grants FLAGGED (not applied): ${flatFlagged.length}`);
for (const f of flatFlagged) console.log(`  ${f.id} [${f.resource ?? '?'} +${f.amount ?? '?'}] ${f.reason}\n      "${f.sentence}"`);
if (unmodeled.length) console.log(`Resonators with flat-grant text but NO Forte model (flat-only gauges — future work):\n  ${unmodeled.join('\n  ')}`);
console.log('Wrote data/forte-data.json');
