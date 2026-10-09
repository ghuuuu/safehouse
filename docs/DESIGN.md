---
name: Safehouse
description: A household's papers, with the family drawn as a line map.
colors:
  page: "#f6f4f6"
  sheet: "#ffffff"
  rule: "#ddd5de"
  rule-strong: "#c9bdca"
  ink-muted: "#6a5a6c"
  ink: "#2e1a31"
  plum: "#5a2b5f"
  sidebar: "#3a1f3d"
  sidebar-ink: "#ecdfee"
  sidebar-muted: "#b59cb8"
  logo-amber: "#f0a020"
  line-1: "#2f6fe0"
  line-2: "#d93a3f"
  line-3: "#1f8a55"
  line-4: "#0e7c86"
  line-5: "#8a5a2b"
  line-guardian: "#c47f00"
  warn: "#c0262d"
  soon: "#f0a020"
typography:
  headline:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
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
  index:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "11px"
    fontWeight: 600
rounded:
  field: "8px"
  card: "8px"
  pill: "9999px"
spacing:
  row: "16px"
  section: "24px"
components:
  button-primary:
    backgroundColor: "{colors.plum}"
    textColor: "{colors.sheet}"
    rounded: "{rounded.pill}"
    padding: "8px 20px"
  button-secondary:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "8px 16px"
  input:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "8px"
  search:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "8px 16px"
  nav-item-active:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "6px 12px"
  name-on-map:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
---

# Design System: Safehouse

## Overview

**Creative North Star: "The household is a map"**

People are names on coloured family lines, the way stations sit on a metro
map. A couple shares one line and their children hang from it; what is running
out hangs as a tag on the person it belongs to. Around the map, the app is a
calm porcelain page beside a plum sidebar, with a house-and-keyhole mark.

It is an Operate surface: people come to find a paper, file one, or check who
can see what, and leave. The map is the one expressive thing; everything else
stays familiar so it can disappear into the task. At night the page goes dark
and the plum deepens.

Chosen on 2026-10-09 from three rounds of directions; the mockups are in
`.impeccable/sketches/` (`r4-porcelain.png` for the layout, `r5-plum.png` for
the accent). The visual contract is at the top of `app/app.css` and ships in
the built CSS.

**Key characteristics:**
- Plum sidebar, light porcelain page, white sheets for anything you read or type.
- One grey scale with roles, not shades, tinted plum; it turns over in dark mode by itself.
- The family as a line map: names in pills, a colour per family, tags on names.
- Pills for actions, names and search; 8px corners for fields and cards.
- Flat: no shadows. Depth is sheet against page and a 1px ruled edge.

## Colors

Restrained: plum and porcelain carry the app; the family lines are the only
run of colour, and red and amber are kept for warnings.

### Primary
- **Plum** (#5a2b5f, dark #c9a0cf): the primary button, the current option in a switch, the focus ring, checkboxes.
- **Sidebar plum** (#3a1f3d, dark #24132a): the sidebar, the phone's tab bar, the signed-out pages behind their card.

### Secondary
- **Family lines** (blue #2f6fe0, red #d93a3f, green #1f8a55, teal #0e7c86, brown #8a5a2b; dark twins in `app.css`): each couple or single parent takes the next ink in turn. Each passes 3:1 against the page as a line.
- **Guardianship amber** (#c47f00): always a guardian's line, so it is never a family's.
- **Logo amber** (#f0a020): the house mark and the phone tab bar's current-tab bar.
- **Category marks** (`--cat-*`): a small square beside a category's written name, and the folder tab on the vault. Never a region.

### Tertiary
- **Warn** (#c0262d on white text, dark #ff7b7b on dark text): expired, an emergency window, a destructive action, a tag on the map.
- **Soon** (#f0a020 on dark text): about to run out, as a tag on the map. Amber notices ("nobody has checked these details") stay quiet.

### Neutral
- **Page** (#f6f4f6), **sheet** (#ffffff), **rules** (#ddd5de, #c9bdca), **muted ink** (#6a5a6c, 5.8:1 on the page), **ink** (#2e1a31).

### Named Rules
**The Roles Not Shades Rule.** The `gray-*` scale is a set of roles: 50–300 are the page and rules, 400–600 muted ink, 700–950 ink. In dark mode the scale turns over in `app/app.css`, so a component never writes `dark:` for a grey. Writing one is the bug. `accent`, `on-accent`, `side`, `side-ink`, `side-muted`, `side-hover`, `side-on` and `side-on-ink` are roles too.

**The Words Too Rule.** Colour is never the only cue. A family line has a legend; a tag carries words and is in the name's accessible label; a category's mark sits beside its name.

## Typography

**Font:** the system UI sans. Nothing is shipped from a third party; a private
vault does not tell a font server which pages are open.

### Hierarchy
- **Headline** (700, 1.5rem, tight): one per page, the page's name.
- **Title** (500, 1rem): sections within a page.
- **Body** (400, 0.875rem): lists, forms, explanations. A name on the map is 14px semibold.
- **Label** (500, 0.75rem): small metadata, footnotes.
- **Index** (600, 11px, uppercase, tracked): the sidebar's group names (Find, File, Household), and the small "guardian" and "step" labels on the map. The only uppercase in the app.

## Layout

A 13rem plum sidebar beside the page from 768px up; below that, a plum tab bar
at the bottom (Dashboard, Vault, Search, File, More), with More opening the rest
of the index as a white sheet. Pages are padded 16px on a phone and 32px wider.
The dashboard is up to 72rem wide; forms and records about 48rem. Nothing
scrolls sideways at 390px except the access matrix and the map, each inside its
own frame.

### The dashboard
Title and the "N papers need you" line on the left, the pill search on the
right. Then the Individuals / Businesses switch and quick-search chips, then the
family map with its tags, then the household's and businesses' own pills with
their counts, then Running out and the categories side by side. Running out
stays a list under the map: it is what a screen reader reads, and it holds the
household's and businesses' papers, which have no name on the map.

### Named Rules
**The Thumb Rule.** On touch, every control is at least 24px tall and list rows about 52px. A row that opens one thing is tappable across its whole width (`row-link`); fields are 16px so the phone does not zoom.

## Elevation & Depth

Flat. Depth is a white sheet on the porcelain page with a 1px rule. No shadows.

## Shapes

Pills for anything you press or that stands for a person: buttons, the search,
navigation items, chips, names on the map, tags. 8px corners for fields, cards
and lists. The household and businesses on the dashboard are 12px-cornered
boxes with a 2px ink edge, so they read as places rather than people.

## Components

### Buttons
- **Primary:** plum pill, white text (dark mode: light plum, dark text). One per form.
- **Secondary:** white pill with a ruled edge that darkens on hover.
- **Danger:** red pill with fixed pale text.

### Switch
Two or three views of one page are a segmented control (`app/segmented.tsx`): a ruled outline holding links, the current one plum. The view lives in the URL.

### Navigation
The sidebar on plum: the logo and wordmark, group names in the index style, items as pills (the current one a white pill with ink text). On the phone, the tab bar on plum with the current tab in sidebar ink and a short amber bar above it.

### The family line map (signature)
`app/tree-picture.tsx`, laid out by `app/tree-layout.ts`:
- A person is a white pill with an ink edge, their name, and in muted ink the number of papers the viewer can see for them. Someone who has died: a dashed grey edge and a †.
- `familyLines` gives each couple one ink, drawn between the two names; a child of the couple hangs from its middle in the same ink. Guardianship is amber; a step-parent or a single parent draws a line of their own; each line down runs across at its own height.
- Ended relationships (divorce, a guardianship that ran out) are dotted, and give nobody access (D33).
- A child stands under the couple they hang from; a lone parent stands over their child; somebody with no relationships goes last.
- Tags (optional) hang above a name: warn for expired, soon for about to run out, with a "+N" when there are more.
- Pan by dragging, zoom with the wheel or buttons; every name is a link and keyboard-reachable; the tag is in its label.

### Dates
A calendar date is "5 May 2034" (`longDate` in `app/when.tsx`), a moment adds a time in the reader's zone, and soon is "in 10 days". Never an ISO date on screen.

### The logo
`app/logo.tsx`: an amber house whose door is a keyhole, cut out in the sidebar's plum. `public/favicon.svg` is the same mark on a plum square.

## Do's and Don'ts

### Do:
- **Do** use the grey roles (`gray-500` muted, `gray-900` ink) and the accent and side roles, and let dark mode follow.
- **Do** put anything typed or read closely on a white sheet.
- **Do** read every number on the map through the viewer's own transaction, as the vault does; a count is a listing.
- **Do** keep every text colour at 4.5:1 or better in both modes.

### Don't:
- **Don't** add `dark:` variants for greys, or new hex colours in a component.
- **Don't** use a family ink or a category colour as a region's background.
- **Don't** add drop shadows.
- **Don't** load fonts from a third party.
