# Lane B — Extracting real cast/animation times from the game paks

**Goal:** replace our *fabricated* per-skill-type cast-time constants (basic 0.55,
heavy 1.40, skill 1.30, liberation 1.80, …) with **measured durations read out of
the game's own animation assets**, landed in a curated `data/cast-times.json`.

**Why this is the only honest source:** every public data dump (Dimbreath ConfigDB,
Arikatsu BinData incl. the 14 MB `damage.json`) carries stats, formulas, energy,
cooldowns — but **zero timing fields**. Durations live only inside the compiled
`AnimMontage`/`AnimSequence` assets in the paks. This is Lane B: parse those assets
**offline, from files on disk**. (Verified this session — see
`docs/energy-signal-findings.md` and the session notes.)

---

## 0. Your install (verified 2026-07-11)

| Fact | Value | Consequence |
| --- | --- | --- |
| Path | `G:\SteamLibrary\steamapps\common\Wuthering Waves` | current & live |
| Paks | `…\Client\Content\Paks` — **55 `.pak`, 77 GB, dated 2026-07-10** | up to date |
| Format | plain `pakchunkN-WindowsNoEditor.pak` **+ `.sig`** | signed PAK, **no IoStore** (`.utoc`/`.ucas`) → AES key is the only decryption input |
| Engine | customized **Unreal Engine 4.26** | needs a **`.usmap`** (unversioned properties) |
| Anti-cheat | ACE (kernel) runs with the game | **only touch files on disk; never inject into the running game** (see §9) |

Because it's plain signed PAK (not IoStore), FModel needs exactly two inputs: the
**AES key** and a matching **`.usmap`**. No container/global file wrangling.

---

## 1. Tools to download

| Tool | Where | Role |
| --- | --- | --- |
| **FModel** | <https://fmodel.app> (`github.com/4sval/FModel`) | GUI explorer/exporter (uses CUE4Parse). Start here. |
| **AES key** | community key repo, e.g. `github.com/yarik0chka/wuwa-keys` (was current this week) | decrypts the paks — rotates each major patch, so grab the one matching a 2026-07 build |
| **`.usmap` mappings** | same key repos often ship one under `/Mappings`; else a current WuWa usmap dump | lets FModel deserialize UE's *unversioned* property blocks correctly (without it, `SequenceLength`/`Notifies` come out mislabeled or missing) |
| *(optional, for automation)* **CUE4Parse** | `github.com/FabianFG/CUE4Parse` (C#/.NET) | scripted bulk extraction once paths are known — §8 |

> Get the AES key and `.usmap` **for the same patch as your paks (2026-07-10)**.
> A stale key fails to mount; a stale usmap silently corrupts struct fields.

---

## 2. FModel one-time setup (exact settings for this install)

1. Launch FModel. On the **Directory Selector**:
   - If "Wuthering Waves" is auto-detected, pick it.
   - Else **Add Undetected Game**: Name `Wuthering Waves`, Directory =
     `G:\SteamLibrary\steamapps\common\Wuthering Waves\Client\Content\Paks`.
2. **UE Version:** choose the **`Wuthering Waves`** game profile if the dropdown
   offers it (current FModel ships `EGame.GAME_WutheringWaves`, which is 4.26 +
   the game's serialization tweaks). If not listed, pick **`GAME_UE4_26`**.
3. **Settings → Advanced → AES:** paste the **Main Key** (`0x…64 hex`). Add any
   listed per-chunk "dynamic" keys too, but WuWa is usually one main key.
4. **Settings → Advanced → Mappings:** browse to the `.usmap` file. Confirm the
   status bar shows it loaded.
5. **Directory → Load** (or Ctrl+L). The pak tree should populate with readable
   asset paths. If names look like GUIDs/garbage → wrong or missing usmap.

Sanity check: open any character mesh or a `DT_`/`AM_` asset and confirm the
**Properties** panel shows named fields. If it does, decryption + mappings are good.

---

## 3. Find the animation assets

WuWa's content root is prefixed **`Aki/`** (Kuro's internal codename). Character
combat assets live roughly under:

```
Aki/Content/Characters/<InternalName>/…/Animation/…   ← AnimSequences / Montages
Aki/Content/…/Abilities|Skill|GameplayAbility/…        ← GA_* that reference the montages
```

The exact leaf paths vary — **use FModel's search box** (top bar) rather than
guessing. Practical queries:

- Search **`AM_`** → AnimMontage assets (montages are what abilities *play*; these
  carry the timing you want).
- Search a character's internal name (not the display name — e.g. search for the
  folder that also holds their mesh/textures) to scope to one resonator.
- The **`Skill.json`** you already saved (Dimbreath) maps `SkillId → DamageList`;
  Arikatsu **`generalaction`/`statemachine`** blobs reference the animation state
  assets. Those give you the *skill → which montage* bridge (§7), while the pak
  gives you the *montage → how long* half.

---

## 4. What to read out of each montage — the crucial nuance

An `AnimMontage`'s JSON Properties expose:

- **`SequenceLength`** *(float, seconds)* — the **full** montage length at play-rate
  1.0. This is the animation's total duration.
- **`RateScale`** — multiply/divide if the montage is authored at a non-1 rate.
  Actual play time = `SequenceLength / effectivePlayRate`.
- **`Notifies[]`** — timed markers (`LinkValue`/trigger time in seconds). **These are
  what actually matter for rotation pacing**: the point where you can *cancel into
  the next action* (combo window, "CanCancel", input-buffer, or the hit-frame) is a
  **notify partway through the montage**, not the full `SequenceLength`.

> **Read this carefully:** for DPS-rotation timing we want *"when can the player act
> again"* — the **cancel/next-input window**, typically a notify at 50–80 % of the
> montage — **not** the full `SequenceLength` (which includes recovery/return-to-idle
> the player skips by acting). Capturing only `SequenceLength` will systematically
> *over*-count every cast. Grab both; prefer the cancel notify, fall back to
> `SequenceLength` only when no cancel marker exists.

Notify *names* are the tell — look for tokens like `Cancel`, `Combo`, `Next`,
`BufferedInput`, `Recovery`, or a hit-notify. You'll learn each character's
convention after inspecting two or three montages.

---

## 5. Export to JSON

- **Single asset:** right-click → **Save Properties (.json)** (or press the export
  hotkey). You get the Properties tree incl. `SequenceLength` + `Notifies`.
- **Whole character folder (bulk):** right-click the folder → **Save Folder's
  Packages Properties (.json)** → one JSON per asset. Do this per resonator's
  animation folder to batch a character in one shot.
- FModel writes to its **Output/Exports** dir (Settings shows the path).

You only need the **`.json` Properties**, not the raw `.uasset` or the meshes —
keep exports lean.

---

## 6. Fold into `data/cast-times.json` (the code side)

**Superseded by the real implementation (2026-07-28).** This section describes
the target shape from before extraction actually landed. The real pipeline
(`tools/extract/`, `docs/TIMING-EXTRACTION-HANDOVER.md`) produced
`data/actionable-times.json` instead (field renamed `castTime` →
`actionableAt` — see `docs/TIMING_MODEL.md`), joined via `data/hit-map.json`
rather than the montage-name-matching strategy sketched below. Kept as
historical context for the staging idea (extraction and engine-wiring as
separate changes), which still holds.

Target shape (curated input, like `patch.json`/`reference-rotations.json` — safe to
hand-edit, consumed by preprocess, **provenance-tagged** so fabricated defaults are
never silently trusted):

```json
{
  "_meta": {
    "source": "FModel AnimMontage export (SequenceLength + cancel notify)",
    "gameBuild": "paks 2026-07-10",
    "usmap": "<file used>",
    "note": "castTime = actionable/cancel window; sequenceLength = full montage (fallback)"
  },
  "castTimes": {
    "1102": {                                     // resonatorId (Sanhua)
      "basic_1": { "castTime": 0.42, "sequenceLength": 0.63, "montage": "AM_Sanhua_Normal01", "provenance": "extracted" },
      "skill":   { "castTime": 1.05, "sequenceLength": 1.48, "montage": "AM_Sanhua_Skill",    "provenance": "extracted" }
    }
  }
}
```

Then, in the engine (a follow-up change, **not** part of extraction):

1. `preprocess.mjs` reads `data/cast-times.json` and stamps a per-skill `castTime`
   onto the matching `autoSkillMap` entry when a measured value exists.
2. `resolveCastTime` (sim.js) **already** prefers a per-skill `castTime` over the
   per-type constant — so measured values light up automatically; unmeasured skills
   fall back to the constant, now tagged `provenance:"fabricated-default"`.
3. This is also where we **de-triplicate**: the three hardcoded `CAST_TIMES` copies
   (`preprocess.mjs`, `data/skill-map.json _defaults`, `sim.js HARDCODED_CAST_TIMES`)
   collapse to one default table + the measured overrides.

**Mapping montage → our skill key (the real labor):** two strategies —

- **A · Semantic (first pass):** montage names are descriptive; match `AM_<Char>_Skill`
  → `skill`, `…_Normal0N` → `basic_N`, `…_Ultimate/Burst` → `liberation`, etc. Fast
  for the 6 covered characters; verify a couple against in-game feel.
- **B · Data-bridge (systematic):** decode the Arikatsu `generalaction`/`statemachine`
  references (the base64 flatbuffer blobs) to get *skill → montage asset path*
  authoritatively, then join on the montage paths you exported. Cleaner and
  roster-scalable, but the flatbuffer decode is the hard part — do it only after A
  proves the pipeline end to end.

---

## 7. Validate before trusting it

Before wiring anything into rankings, run the **sensitivity analysis** we planned:
perturb the current fabricated cast-times ±20 % and re-rank the meta teams. If the
ordering barely moves, extraction is a nice-to-have polish; if it swings, timing
precision is load-bearing and the extraction is justified. Either way you'll know
*how much* the measured numbers can change conclusions **before** investing in the
full-roster mapping.

---

## 8. Faster path once it works: CUE4Parse (optional)

FModel is CUE4Parse with a GUI. Once §2–§5 succeed manually, a ~100-line C# console
app using CUE4Parse can: mount the Paks dir with the AES key + usmap, glob every
`AM_*` under the character roots, read `SequenceLength` + `Notifies` directly, and
emit `cast-times.json` in one run — no clicking. Worth it only for a full-roster
sweep; for the 6 covered characters, manual FModel export is faster to stand up.

---

## 9. Safety boundaries (non-negotiable)

- **Offline files only.** Everything above reads `.pak` files on disk with the game
  **closed**. Never run a runtime dumper / injector against the live process — WuWa
  ships kernel anti-cheat (ACE) and injection risks a ban. FModel does **not** touch
  the running game; keep it that way.
- **Derived numbers stay in-repo; assets do not.** `data/cast-times.json` holds
  extracted *durations* (facts about game mechanics, like our existing multipliers/
  energy values). Do **not** commit or redistribute the actual `.uasset`/mesh/anim
  files — only the numbers we derive from them, consistent with how the rest of
  `data/` already works.

---

## 10. Checklist

- [ ] FModel installed, WuWa/UE4.26 profile selected, Paks dir added
- [ ] Current AES key pasted → tree loads with readable names
- [ ] Matching `.usmap` loaded → montage Properties show named fields
- [ ] One character's `AM_*` folder exported to JSON (proof of concept)
- [ ] `SequenceLength` **and** the cancel/next-input notify identified per skill
- [ ] Montage→skill mapping done for the 6 covered characters (strategy A)
- [ ] `data/cast-times.json` authored with `provenance:"extracted"`
- [ ] Sensitivity analysis run (±20 %) to confirm the precision actually matters
- [ ] (later) preprocess wiring + `CAST_TIMES` de-triplication
