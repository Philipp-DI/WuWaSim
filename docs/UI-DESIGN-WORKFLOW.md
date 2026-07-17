# UI Design Workflow — WuWa Sim

## A step-by-step process for designing in Figma and handing off to Claude Code

This workflow is tailored to this specific project: a static HTML+JS app with
no build step, CSS custom properties as the design token layer, and a codebase
that Claude Code will implement from your Figma designs. It is a process for
**you**, not a build spec.

> **Companion guide**: `docs/FIGMA-MCP-GUIDE.md` covers the Figma MCP server in
> depth — setup, the tool inventory, and how it accelerates Steps 2, 3, 5, and 6
> below (Claude Code reading your designs directly instead of through a written
> handoff). Read this document first for the process; read the MCP guide before
> you start Step 2.

---

## Overview of the workflow

```text
 Step 1  Audit            Map every existing screen. Identify what's
                          keeping, fixing, and replacing.

 Step 2  Token Setup      Import the existing design tokens into Figma
                          so your designs already speak the app's language.

 Step 3  Component Audit  Identify reusable components. Map existing ones
                          to Figma components before you design new ones.

 Step 4  Design           Screen by screen, component by component.
                          Defined priority order below.

 Step 5  Annotation       Mark every element Claude Code can't infer —
                          states, interactions, exact values, edge cases.

 Step 6  Handoff          Export a Figma-linked spec document Claude Code
                          reads before touching a single file.
```

Work **sequentially**. Skipping Step 2 means your designs will use colours and
spacing that don't match the token layer, and Claude Code will have to guess at
the right variable names. That creates drift.

---

## Step 1 — Audit the existing UI

Before you open Figma, spend one session in the running app taking screenshots
of every distinct state. The goal is a clear map of what exists and a verdict
on each element.

### Screen inventory - UPDATED by me

| Screen | Primary issues noted/TO-DO | Verdict |
| --- | --- | --- |
| Build editor — header (level/chain/weapon) | Slider for: LVL, RC, SKILLS; add icons; make build name more prominent | Review |
| Build editor — stat tree (node grid) | Slider; compact view (similar to in-game) | Re-design |
| Build editor — inherent skills + effect chips | Part of the above | Re-design |
| Build editor — resonance chain panel | Text format; compacting | Re-design |
| Build editor — echoes grid | make more compact; display stats ON the grid | Re-design |
| Damage panel — skill cards | Cramped, description overflow | Fix |
| Rotation panel — step list | Lacks buff bar; guidance is bare | Fix |
| Rotation panel — palette | add dmg-type-category-breakdown (cake-diagram) | Re-design |
| Rotation panel — totals | see above | Re-design |
| Team editor — slot assignment | — | Reviewed |
| Team sim — swimlane breakdown | Missing; 3-bucket (columns) only | New |
| Team sim — buff/effect bar | Missing entirely; create/add universal icon for buff (description on hover) | New |
| Stats panel | — | Review |
| Sonata display (wherever it appears) | Cramped, unreadable; add official per sonata icons | Fix |

**For each screen, screenshot:**

- Default/empty state
- Populated state (real character data)
- Any hover/focus/error state you can trigger
- Mobile-width if you care about it (the app currently has no mobile breakpoint)

**Write a verdict for each element: Keep / Fix / Replace / New.**
This becomes your audit checklist and prevents you from redesigning things that
don't need it.

---

## Step 2 — Token setup in Figma

The app's design tokens live in `styles/tokens.css`. Before you draw a single
frame, import these into Figma so your colour pickers, spacing values, and
typography are already correct. If you introduce new values in Figma that
aren't in the token file, you create a handoff gap.

### Extract the tokens

Open `styles/tokens.css` and make a reference list:

**Colours (from `:root`)**

```auto
--bg-base, --bg-surface, --bg-elevated, --bg-hover
--text-primary, --text-secondary, --text-muted
--accent, --accent-glow
--warn (#fbbf24), --danger (#ef4444), --crit (#f87171)
--line-dim, --line-mid
--el-glacio, --el-fusion, --el-electro, --el-aero, --el-spectro, --el-havoc
--support-heal (#4caf82)
```

**Spacing** — the app uses a `--sp-N` scale (check the token file for the
exact values).

**Typography** — `--font-sans`, `--font-mono`, `--fs-xs` through `--fs-xl`.

### In Figma

1. Create a **Styles** page (not a frame — a dedicated page for the design
   system).
2. Add each colour as a **Colour Style** named exactly as the CSS variable
   (e.g. `bg/surface`, `text/primary`, `el/glacio`). Use the `/` convention for
   grouping. The exact names don't matter as long as they're consistent — what
   matters is that you can look up "what token is this?" in the annotation step.
3. Add a **Grid style** matching the app's column layout (currently a fluid
   single-column with some two-column sections in the editor).
4. Add **Text Styles** for each `--fs-*` size, using the same font families.

**Do not** introduce new colours or spacing values in your designs unless you
intend to add them to `tokens.css`. New values must be documented: "add
`--bg-overlay: #1a1a2e` to tokens.css" is a valid annotation; using a
one-off `#1a1a2e` with no token is not.

---

## Step 3 — Component audit before designing

List the reusable components the app already has (rendered as HTML, not as
Figma components yet). For each, decide: Does the component's *structure* stay
the same (just reskin in Figma)? Or does it change shape?

**Existing components to map:**

- `.rc-effect` chip (static badge / toggle) — new in P10, likely evolves in P11
- `.rot-step` row — needs a major overhaul in P11 (buff markers, type colour)
- `.skill-card` — fix readability
- Sonata display (wherever it appears) — full redesign
- Echo slot card — stays similar, substat toggles are new
- Buff/effect bar — entirely new component

For each component you'll redesign or create:

1. Create a Figma **Component** (not just a frame).
2. Add **Variants** for every state: default, hover, active/selected, disabled,
   warning, error, loading/empty.
3. Name variants and properties descriptively — Claude Code reads these names
   in the annotation, so "State=Warning" is more useful than "Variant 3".

Build components before you build screens. Screens are composed from components.
If you design the screen first, you'll end up with inconsistent one-off shapes
that break under content variation.

---

## Step 4 — Design priority order

Design in this order. Each group is a logical unit you can hand off to Claude
Code independently if needed.

### Group A — Design system (do first, blocks everything else)

1. Colour / token reference page (Step 2 output, already done)
2. Typography scale
3. Spacing and layout grid
4. Core atomic components: button variants, input variants, chip variants,
   badge variants, tooltip, modal/overlay shell

### Group B — Existing screens that need fixes (quick wins, validate your tokens)

5. Sonata display — redesign from cramped pill to a readable card/row. Decide
   what information shows at-a-glance vs. on-hover.
6. Skill card in damage panel — more vertical breathing room; description text
   readable at default size.
7. Effect chips (chain/inherent) — the new static-badge vs. toggle-chip split
   from P10; make the distinction visually immediate without reading the label.

### Group C — New build-sim components

8. Buff/effect bar — shows which buffs are active across the step list.
   Design the bar, individual buff tokens (name, icon-placeholder, duration),
   and the empty state.
9. Conditional guidance UI — the validation warning banner and per-step warning
   markers from P10, redesigned to be constructive and tappable (not just a
   warning you read and ignore). Includes the "valid next action" suggestion
   component.
10. Auto-inserted step indicator — how does a step that was auto-added by the
    sim differ visually from a user-added one? Design the distinction.

### Group C — New team-sim screen (the most complex)

11. Per-character column layout — how the three character columns sit.
    Design at three states: 1 member, 2 members, 3 members.
12. Per-step damage bars within a column — collapsible group → expanded steps.
    Design the collapsed state (shows totals) and the expanded state (shows
    each step as a labelled, colour-coded bar).
13. Damage type colour coding — define which colour maps to which type
    (Basic / Heavy / Resonance Skill / Resonance Liberation / Echo /
    Intro / Outro). Suggest starting from the app's existing skill-type colours
    in `rotation.css` and extending them. **All seven must be perceptually
    distinct at small size** — test against a dark background.
14. Hover tooltip on a step — what does the user see when they hover a step?
    (Step name, damage value, active buffs at that step, damage type breakdown.)
15. Buff/effect timeline bar for the team sim — same component as Group C #8
    but spans the full team width and must align with the column positions.
16. Inline rotation editor within the team sim — how the user edits steps
    without leaving this screen. Probably a slide-in panel or an inline
    palette that appears below the column.

### Group D — 3-way team comparison (deferrable to P13)

17. Side-by-side layout for three team setups.

Design Group A and B before handing off anything. Groups C and D can be handed
off after A is locked, because Claude Code needs the design system to be stable
before building components.

---

## Step 5 — Annotation (the most important step for handoff)

Figma designs without annotations hand off ambiguity, not clarity. Claude Code
will have to guess at anything that isn't explicitly stated — and it will guess
wrong about the things that matter.

**Annotate on a dedicated "Redlines" layer group** (not mixed with the design).
For every non-obvious element, add a callout note covering:

### What to annotate

**Spacing** — exact pixel values, or map to token ("padding: `--sp-2` top/bottom,
`--sp-3` left/right"). Don't annotate things that follow obviously from the grid.

**Colours** — token name (not hex), e.g. "background: `--bg-elevated`".

**Interactions** — hover state, click behaviour, what changes and how fast.
"On hover: background transitions to `--bg-hover`, duration `--t-fast`."

**Content variability** — "this label truncates at 24 characters with an ellipsis"
or "this bar's width is proportional to damage/total-damage, min-width 2px."

**Empty states** — every list/panel must have a designed empty state. Annotate
what appears when there's no data.

**Error and warning states** — what does the conditional warning chip look like
for each `gate` type (state / resource / form)?

**CSS classes to assign** — if you already know the class name from the existing
codebase, note it. "This is `.rot-step.is-warned`; add class `.is-auto-inserted`
for auto-triggered steps."

**Token gaps** — if your design uses a value not in `tokens.css`, annotate:
"Add `--color-dmg-liberation: #c084fc` to tokens.css."

**Animation** — if a component animates (expand/collapse, slide-in), note the
direction, duration (use token or exact ms), and easing.

### What NOT to annotate

Don't annotate things that follow directly from the existing CSS (e.g. "button
uses `--accent` colour" if that's already in `button.css`). Over-annotation
buries the important callouts. Reserve annotations for things Claude Code can't
derive from the existing codebase.

---

## Step 6 — Handoff document

Before Claude Code touches any file, produce a handoff document that Claude Code
reads **first** as its SKILL.md equivalent. It should cover:

1. **Token additions/changes** — the exact new entries to add to `tokens.css`,
   in the format they appear in the file.
2. **New CSS custom properties** per component — list every `--my-var` used in
   your designs that doesn't exist yet.
3. **Component-by-component spec** — for each new or changed component: HTML
   structure, CSS classes, modifier classes, states, and a reference to the
   Figma frame by name.
4. **What NOT to change** — explicitly list components/files that should not be
   touched. This prevents Claude Code from "helpfully" refactoring something you
   didn't ask it to.
5. **Figma link** — direct link to the relevant frame for each component, so
   Claude Code can reference it.

This document becomes the Phase 11 build spec's visual companion. The P11 spec
(which is a logic/architecture document) says *what* to build; the handoff
document says *what it should look like*.

---

## Practical tips for this project specifically

**Design for dark mode only.** The app has a single dark theme. Don't spend
time on light mode unless you intend to add it.

**Design at 1440px width first.** This is the primary target. Mobile is
out of scope unless you decide otherwise.

**The element colour system already exists** — `--el-glacio`, `--el-fusion`,
etc. Use these for resonator-attributed elements (the colour of a character's
damage, their column header accent, etc.). Don't invent new element colours.

**The app uses `color-mix()` for tinted surfaces** (e.g. buff chip backgrounds).
This requires Chrome 111+ / Firefox 113+. Annotate anything using `color-mix()`
clearly so Claude Code knows to use it rather than hardcoding a tint.

**Clip test content.** When placing characters in your designs, use real
character names (Carlotta, Sanhua, Verina) with real data from the dataset.
Designs built around "Character Name" and "12345" as placeholders will break
on the first real content edge case.

**The validation flow from P10 is already partially designed** (rotation
warnings, amber banner). Your Group C work extends rather than replaces it.
Don't redesign the warning system from scratch — redesign the *constructiveness*
of it.
