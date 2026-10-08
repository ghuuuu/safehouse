---
name: Safehouse
description: A household's papers, kept like a well-kept home filing cabinet.
colors:
  paper: "#f5f1e8"
  sheet: "#fffdf8"
  shelf: "#eee8dc"
  rule: "#dcd3c2"
  rule-strong: "#c8bda8"
  ink-muted: "#6b6052"
  ink: "#231e18"
  tab-personal: "#3b6788"
  tab-medical: "#4a7655"
  tab-business: "#585c8c"
  tab-financial: "#8f6418"
  tab-legal: "#86372f"
  tab-general: "#74654f"
  warning-red: "#c10007"
typography:
  headline:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 500
    letterSpacing: "-0.025em"
  title:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "1rem"
    fontWeight: 500
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
  label:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  full: "9999px"
spacing:
  row: "16px"
  section: "32px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.sheet}"
    rounded: "{rounded.lg}"
    padding: "8px 16px"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "8px 16px"
  button-danger:
    backgroundColor: "{colors.warning-red}"
    textColor: "#fef2f2"
    rounded: "{rounded.lg}"
    padding: "8px 16px"
  input:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "8px"
  nav-item-active:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "6px 8px"
  chip:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.full}"
    padding: "4px 12px"
---

# Design System: Safehouse

## Overview

**Creative North Star: "The Home Filing Cabinet"**

Papers on a desk, filed in folders with coloured tabs, written in ink. The
ground is warm paper; anything you write on or read closely is a lighter sheet
lying on it; edges are ruled lines, not shadows. Colour belongs to the six
categories, as folder tabs, and to warnings. Nothing else is coloured.

It is an Operate surface: people come to find a paper, file one, or check who
can see what, and leave. Density is moderate, type is the system's own sans,
and the interface stays familiar so it can disappear into the task. At night
the cabinet is the inside of the drawer: the same roles, turned over.

The visual contract lives at the top of `app/app.css` and ships in the built
CSS.

**Key Characteristics:**
- Warm paper ground, lighter sheets, ink text, ruled edges.
- Six folder-tab colours, one per category, always beside the category's name.
- One grey scale with roles, not shades: it turns over in dark mode by itself.
- Flat: depth comes from paper against sheet, never from shadow.
- One sidebar index, grouped Find / File / Household.

## Colors

A restrained palette of paper and ink, with six muted folder-tab colours and one red.

### Primary
- **Ink** (#231e18): body text, headings, the primary button, the focus ring, checkboxes. Almost black, warm.

### Secondary
- **Folder tabs** (personal #3b6788, medical #4a7655, business #585c8c, financial #8f6418, legal #86372f, general #74654f): the category's mark and its folder tab. Each passes 4.5:1 as text on paper; dark mode has lighter twins.

### Tertiary
- **Warning red** (#c10007): something has expired, an emergency window is open, a destructive action. Amber is kept for "needs attention but nothing is wrong yet" (unconfirmed fields, safekeeping reminders).

### Neutral
- **Paper** (#f5f1e8): the page.
- **Sheet** (#fffdf8): inputs, lists of papers, the tree canvas, the active nav item. Anything you write on.
- **Shelf** (#eee8dc): the sidebar.
- **Rule** (#dcd3c2) and **strong rule** (#c8bda8): card edges and input edges.
- **Muted ink** (#6b6052): secondary text. 5.4:1 on paper.

### Named Rules
**The Roles Not Shades Rule.** The `gray-*` scale is a set of roles: 50–300 are paper and rules, 400–600 muted ink, 700–950 ink. In dark mode the scale turns over in `app/app.css`, so a component never writes `dark:` for a grey. Writing one is the bug.

**The Tab Rule.** Category colour appears only as a folder tab or a small mark, and always next to the category's written name. It is never a background for a whole region and never the only cue.

## Typography

**Body Font:** the system UI sans (ui-sans-serif, system-ui, Segoe UI, Roboto)

**Character:** one familiar workhorse face for everything. Nothing is shipped from a third party; a private vault does not tell a font server which pages are open.

### Hierarchy
- **Headline** (500, 1.5rem, tracking -0.025em): one per page, the page's name.
- **Title** (500, 1rem): sections within a page ("What it says", "Versions").
- **Body** (400, 0.875rem): lists, forms, explanations.
- **Label** (500, 0.75rem): the sidebar's group names, small metadata.

### Named Rules
**The Sentence Case Rule.** Headings are sentence case in ink. No uppercase tracked grey labels over sections.

## Layout

A 13rem sidebar beside the page from 768px up. Below that, a bottom tab bar in thumb reach: Dashboard, Vault, Search, File, and More, which opens the rest of the index as a sheet above the bar. Pages are padded 16px on a phone and 32px on wider screens; each keeps its own measure inside, forms and records about 48rem, lists and the console up to 64rem. Rows are 16px inside, sections 24–32px apart. On the dashboard, what is running out comes before the family tree. Nothing scrolls sideways at 390px except the access matrix, inside its own scroller.

### Named Rules
**The Thumb Rule.** On touch, every control is at least 24px tall and list rows are about 52px. A list row that opens one thing is tappable across its whole width (the `row-link` class); fields are 16px text so the phone does not zoom.

## Elevation & Depth

Flat. Depth is paper against sheet and a 1px ruled edge. The only shadow-like device is the 1px ring on the active nav item.

### Named Rules
**The Paper Not Shadow Rule.** To lift something, put it on a sheet and rule its edge. Do not add a drop shadow.

## Shapes

Gently rounded: 8px on cards, lists and inputs, 6px on nav items and tabs, full rounding on chips. A folder tab is a 6px top-rounded label with a 3px top edge in its category colour, sitting on a list whose top-left corner is square.

## Components

### Buttons
- **Shape:** gently curved (8px).
- **Primary:** ink background, sheet text. One per form: "Save", "Save access", "File it".
- **Secondary:** ruled outline on paper ("Search", "Reset").
- **Danger:** warning red with a fixed pale text, so it reads the same in both modes.

### Chips
- **Style:** fully rounded, ruled outline, ink label with a muted count. Quick searches on the dashboard.

### Cards / Containers
- **Corner Style:** 8px.
- **Background:** sheet for lists of papers; paper with a ruled edge for grouped settings.
- **Border:** 1px rule.

### Inputs / Fields
- **Style:** sheet background, 1px strong rule, 8px corners.
- **Focus:** a 2px ink outline, offset 2px, on every control.

### Navigation
- **Style:** the sidebar index on shelf. Inactive items in muted ink; hover lays a rule-coloured wash; the current page sits on a sheet with a 1px ruled ring.
- **Phone:** the tab bar on shelf, 64px tall, labels only. The current tab is ink and semi-bold with a short ink bar above its label.

### Folder tab (signature)
The category's name on a tab tinted 12% toward its colour, with a 3px top edge in the colour, above the list of papers it holds. The dashboard uses the small square mark instead.

## Do's and Don'ts

### Do:
- **Do** use the grey roles (`gray-500` muted, `gray-900` ink) and let dark mode follow.
- **Do** put anything typed or read closely on a sheet.
- **Do** write the category's name beside its colour.
- **Do** keep every text colour at 4.5:1 or better on paper, sheet and shelf, in both modes.

### Don't:
- **Don't** add `dark:` variants for greys, or new hex colours in a component.
- **Don't** colour a region with a category colour, or use a coloured left border as a marker.
- **Don't** use drop shadows for depth.
- **Don't** load fonts from a third party.
