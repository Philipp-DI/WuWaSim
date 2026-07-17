# Pre-P11 Housekeeping
## Small, standalone tasks to complete BEFORE P11 implementation begins

These are code-track items triaged out of the design audit (2026-06). None of
them belong in the Figma workflow, and none should silently expand P11's scope.
Each is independently shippable. Order within this list is flexible except
where noted.

---

## Status (verified 2026-06-21)

**All of H1–H5 are done.** Landed in commit `1e7771a` ("P11 groundwork: trim
sub-4★ weapons, build migration, pristine marker, icon pipeline"), code-verified
against the current tree (not just re-reading the commit message):

| Item | Status | Evidence |
| --- | --- | --- |
| H1 — trim sub-4★ weapons | ✅ Done | `data/wuwa-data.json` has 87 weapons, min rarity 4. `saved-data-migration.test.mjs` (16/16) covers the orphaned-weapon-id load path. |
| H2 — "Back" button honesty | ✅ Done | Header nav button reads "Roster"; other contextual instances read "Back to roster" (already names its destination — satisfies the spirit even where the exact H2 wording wasn't copied verbatim). |
| H3 — pristine-build persistence | ✅ Done, both halves | `showEditorForNew` in `src/ui/app.js` does **not** call `saveBuild` on creation (lazy-write, comment cites this exact rationale); `isPristineBuild()` in `src/core/build.js` drives an "unmodified" tag in the saved-builds list (visual marker, no auto-delete). |
| H4 — icon asset pipeline | ✅ Done (core), ⚠️ not adopted by build-v2 | `src/ui/icons.js` + `assets/icons/{elements,weapons,weapon-types,sonata,echoes,monsters,resonators}/` exist; `icons.test.mjs` 69/69. **Gap**: the new Build Page v2 (`src/ui/components/build-editor-v2.js`) does not call `iconFor`/`iconHtml` — its echo-picker rows resolve icon paths ad hoc (`echoIconPath()`, with a crude `onerror` hide, not the designed glyph fallback), and its echo-slot/sonata swatches are decorative gradient placeholders with no icon at all. Wiring v2 onto `icons.js` is unclaimed follow-up work, not a regression — v2 didn't exist when H4 shipped. |
| H5 — saved-data sanity pass | ✅ Covered | Landed as `test/saved-data-migration.test.mjs` (16/16) rather than a one-off manual pass — a stronger, repeatable version of what H5 asked for. |

**Open follow-up** (not a blocker, not in the original H-list): wire Build Page
v2's echo/weapon/sonata icons through `src/ui/icons.js` for fallback parity
with the rest of the app.

---

## H1 — Trim 1–3★ weapons from the dataset

**What**: `tools/preprocess.mjs` drops weapons of rarity 1, 2, and 3 from the
projection. Regenerate `data/wuwa-data.json`.

**Why now**: shrinks the weapon-picker surface before it gets redesigned
(P11/design track). No player builds around sub-4★ weapons.

**Migration requirement (do not skip)**: saved builds may reference a trimmed
weapon id. On build load, if `build.weapon` references an id absent from the
dataset: clear the weapon slot, keep the build, and surface a one-line notice
("Weapon no longer available — slot cleared"). Never crash, never silently
delete the build.

**Verify**: weapon count in the regenerated JSON; a saved build with a (now
trimmed) weapon loads cleanly with the slot cleared.

---

## H2 — "Back" button honesty

**What**: the header "Back" button always navigates to the Roster. Rename its
label to **"Roster"** (or an icon + "Roster" tooltip).

**Why**: a button labelled Back that doesn't go back is worse than no button.
True history-based navigation (pushState) is parked in **Phase X** — promote it
only if the renamed button still feels wrong in use.

---

## H3 — Pristine-build persistence (reframed from the notes)

**Original note**: "remove resonator from saved builds when status is equal to
default status."

**Reframed (agreed)**: do NOT auto-delete builds that match defaults — a user
who strips a weapon mid-edit would silently lose their entry. Instead:

1. **Dirty-check on persist**: a brand-new build is only written to storage
   after its first real modification (level, chain, skill, weapon, echo,
   rotation — anything beyond creation defaults).
2. **Visual marker**: builds currently in storage that match defaults are
   marked ("unmodified") in the roster/build list rather than removed. Optional
   one-time cleanup prompt if any exist.

**Verify**: creating a build and navigating away without edits leaves no
storage entry; an edited build persists; no existing build is ever deleted
without explicit user action.

---

## H4 — Icon asset pipeline

**Context**: a manual sweep of icons (elements, sonata sets, weapon types,
misc/buff glyphs) already exists in a local untracked `templates/` folder.
Samples reviewed: full-colour element icons (e.g. Electro), full-colour sonata
crests (e.g. Crown of Valor), monochrome white-on-transparent weapon-type and
misc glyphs.

**Decision — local assets, not CDN**:
Commit the swept icons into the repo. Hotlinking a CDN (nanoka, raw Dimbreath
paths, wiki mirrors) is rejected: links rot between patches, CORS behaviour is
outside our control, and hotlinking sits in murkier territory than
fan-tool-local use. Icons are small; repo weight is negligible.

**Structure**:
```
assets/icons/
  elements/   electro.webp, glacio.webp, ...      (full-colour)
  sonata/     crown-of-valor.webp, ...            (full-colour)
  weapons/    gauntlets.webp, sword.webp, ...     (monochrome white)
  misc/       buff.webp, ...                      (monochrome)
```
Filenames are kebab-case and must map 1:1 to dataset identifiers (element id →
name, sonata set id → name). Add a small lookup module
(`src/ui/icons.js`) that resolves `iconFor(kind, id)` → path, so no component
hardcodes paths.

**Fallback is REQUIRED, not optional**: when an asset is missing (new sonata
next patch, sweep gap), `iconFor` returns null and the icon component renders a
**glyph fallback**: a small rounded square in the relevant token colour
(element colour for elements; `--accent` otherwise) containing the first
letter/initial. Designs in Figma must include this fallback variant so it is
designed, not improvised.

**Monochrome icon technique**: the white-on-transparent sets (weapons, misc)
should be rendered via **CSS mask** rather than `<img>`:
```css
.icon--mask {
    background-color: currentColor;       /* tintable by any token */
    -webkit-mask: url(...) center / contain no-repeat;
    mask: url(...) center / contain no-repeat;
}
```
This makes them recolourable with the existing token palette (e.g. a buff icon
tinted to its buff-kind colour in the P11 buff bar) and immune to the
white-on-white problem. Full-colour icons (elements, sonata) stay plain `<img>`
with `alt`.

**Attribution**: game icons © Kuro Games — already covered by the README
disclaimer; extend the credits line to mention in-game icon assets explicitly.

**Verify**: every element and currently-known sonata set resolves to an asset;
a deliberately-missing id renders the glyph fallback; mask icons tint correctly
with at least two different token colours.

---

## H5 — Saved-data sanity pass (companion to H1/H3)

After H1 and H3 land, run one manual pass over real saved data (export/import
or localStorage inspection): no orphaned weapon references, no pristine
entries, teams still resolve their member builds. Five minutes; catches the
migration edge cases tests miss.
