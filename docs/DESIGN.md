---
name: Safehouse
description: A household's papers, printed like the papers themselves.
colors:
  paper: "#e7eee9"
  sheet: "#f6f9f6"
  rule: "#c6d3cb"
  rule-strong: "#a7b8ae"
  ink-muted: "#4c5e65"
  ink: "#14232b"
  on-teal: "#ffffff"
  teal: "#13394a"
  teal-deep: "#0b2836"
  side-deep: "#0d2c3a"
  side-ink: "#dbe8ea"
  side-muted: "#a1bec5"
  side-hover: "#1c4a5e"
  plate: "#2f6b80"
  serial-gold: "#d9b25a"
  intaglio-green: "#2f5e45"
  claret: "#7a1f3d"
  claret-deep: "#5f1830"
  old-gold: "#b98a2e"
  old-gold-ink: "#7c591b"
  cat-personal: "#23597a"
  cat-medical: "#2f6b4c"
  cat-business: "#554a86"
  cat-financial: "#7c591b"
  cat-legal: "#6b3a2a"
  cat-general: "#575447"
typography:
  display:
    fontFamily: "Public Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Public Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
  body:
    fontFamily: "Public Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
  label:
    fontFamily: "Public Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.12em"
  stamp:
    fontFamily: "Public Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.1em"
  serial:
    fontFamily: "Red Hat Mono, ui-monospace, Consolas, monospace"
    fontSize: "0.75rem"
    fontWeight: 500
    letterSpacing: "0.12em"
  reference:
    fontFamily: "Red Hat Mono, ui-monospace, Consolas, monospace"
    fontSize: "0.75rem"
    fontWeight: 500
    letterSpacing: "0.06em"
rounded:
  xs: "1px"
  sm: "2px"
  md: "3px"
  xl: "4px"
spacing:
  gutter-phone: "16px"
  gutter-desk: "32px"
  section: "32px"
components:
  button-primary:
    backgroundColor: "{colors.teal}"
    textColor: "{colors.on-teal}"
    rounded: "{rounded.md}"
    padding: "8px 17.6px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.teal-deep}"
  button-secondary:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "8px 17.6px"
    height: "40px"
  button-danger:
    backgroundColor: "{colors.claret}"
    textColor: "{colors.on-teal}"
    rounded: "{rounded.md}"
    padding: "8px 17.6px"
    height: "40px"
  button-danger-hover:
    backgroundColor: "{colors.claret-deep}"
  button-serial:
    backgroundColor: "{colors.serial-gold}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "8px 17.6px"
    height: "40px"
  button-sm:
    rounded: "{rounded.md}"
    padding: "4.8px 12px"
    height: "32px"
  field:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
    height: "40px"
  sheet:
    backgroundColor: "{colors.sheet}"
    rounded: "{rounded.md}"
  masthead:
    backgroundColor: "{colors.side-deep}"
    textColor: "{colors.sheet}"
    typography: "{typography.display}"
  nav-item-active:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
  segmented-current:
    backgroundColor: "{colors.teal}"
    textColor: "{colors.on-teal}"
    padding: "8px 16px"
  stamp:
    typography: "{typography.stamp}"
    rounded: "{rounded.sm}"
    padding: "4.8px 7.2px"
  reference:
    textColor: "{colors.intaglio-green}"
    typography: "{typography.reference}"
---

# Design System: Safehouse

## Overview

**Creative North Star: "Security Print"**

The vault wears the grammar of the papers it guards: passport visa pages,
banknotes, share certificates. A deep teal shell, pale security paper with
sheets a step lighter, one ink, and a guilloché plate engraved behind each
page's name. Every paper carries a printed reference; every state on a paper is
stamped in words; every name in the family is entered in a ruled,
double-framed box the way a certificate records it.

It is an Operate surface, used two ways and both first-class: filing at a desk
and finding on a phone. The print is the atmosphere, never the obstacle: the
plate sits behind a quieter field so the words win, the paper is calm, and
everything a person reads or types is a ruled sheet on that paper. It replaced
porcelain-and-plum on 2026-10-18, which read as a toy (transit-map pills),
generic (a purple SaaS sidebar) and cold rather than home. It refuses the
cloud-drive grid, the SaaS stat card, and the transit-map toy.

The world's tokens and their reasoning are at the top of `app/app.css`; the
plate is `app/guilloche.ts`, the masthead `app/masthead.tsx`, the reference
`app/reference.ts`.

**Key Characteristics:**
- Deep teal sidebar and masthead band; pale green-grey security paper; sheets a step lighter with a 1px ruled edge.
- A guilloché plate (interlaced waves and one rosette) generated from each page's own name, so no two pages and no two households print alike.
- Public Sans for every word; Red Hat Mono only for what is counted, dated or numbered. Both self-hosted.
- Three meaning inks besides teal: claret (expired, emergency, destructive), old gold (running out, the serial line), intaglio green (references, confirmed).
- Corners a hair off square (1-4px). Flat: no shadows anywhere.
- States are stamps: ruled, capitalised words in the state's ink, never colour alone.

## Colors

Restrained: teal and paper carry the app, one ink writes on it, and three inks
are kept for meaning. Every value has a dark twin in `app/app.css`; every text
step reads at 4.5:1 or better against every ground, in both modes.

### Primary
- **Engraver's Teal** (teal): the sidebar, the phone tab bar, the primary button, the current option in a switch, the focus ring, the reach bar, `accent-color` and caret. Its hover is **Deep Teal** (teal-deep).
- **Masthead Teal** (side-deep): the masthead band and the signed-out pages, one step darker than the sidebar so the band reads as a printed plate across the page.
- **Plate Ink** (plate): the guilloché lines only, faint behind the masthead's words. Never text, never a fill.

### Secondary
- **Serial Gold** (serial-gold): the one ink that reads on teal. The serial line under a page title, the logo, the gold buttons on teal (`btn-serial`: File a document, Search), the phone tab bar's current-tab bar.
- **Intaglio Green** (intaglio-green): a paper's printed reference, and a value somebody confirmed.

### Tertiary
- **Claret** (`red-*` scale, claret at 700): expired, an emergency window, anything destructive. The danger button, `stamp-warn`.
- **Old Gold** (`amber-*` scale, old-gold at 500, old-gold-ink at 700): about to run out, a notice that something wants doing, and the guardian line in the family chart. `stamp-soon` writes in old-gold-ink.
- **Category inks** (cat-personal through cat-general, banknote inks): a category's section head rule and name, and the small engraved diamond beside a category's written name. Each passes 4.5:1 as text. Never a region's fill.

### Neutral
- **Security Paper** (paper): the page ground.
- **Sheet** (sheet): anything read closely or typed into; also every `white` class.
- **Rules** (rule, rule-strong): a sheet's edge and row dividers; field and secondary-button edges.
- **Muted Ink** (ink-muted) and **Ink** (ink): secondary text and everything else. A section head on a list sheet is ruled in full ink.

### Named Rules
**The Roles Not Shades Rule.** The `gray-*` scale is a set of roles: 50-300 paper and ruled lines, 400-600 muted ink, 700-950 ink. In dark mode the scale turns over in `app/app.css`, so a component never writes `dark:` for a grey. Claret and gold do not turn over; pair them with `dark:` as Tailwind expects.

**The Three Inks Rule.** Besides teal, only claret, old gold and intaglio green carry meaning, and each means one thing. A new state takes one of the three or is said in words.

**The Words Too Rule.** Colour is never the only cue. A stamp carries words; a category's ink sits beside its name; a chart line has a legend.

## Typography

**Body Font:** Public Sans (variable 100-900, roman and italic), fallback ui-sans-serif, system-ui
**Mono Font:** Red Hat Mono (variable 300-700), fallback ui-monospace, Consolas

**Character:** a plain civic grotesque for everything read and operated, and a
typewriter mono for the numbers a form prints. Both ship from `public/fonts`
(OFL); a private vault does not tell a font server which pages are open.

### Hierarchy
- **Display** (700, 1.75rem on a phone to 2.25rem from 768px, line-height 1.25, -0.02em): the page's name in the masthead, one per page. Signed-out cards use 1.5rem bold.
- **Headline** (600, 1.125rem): a section head on a sheet.
- **Body** (400, 0.875rem): lists, forms, explanations. Lead sentences under the masthead are 1rem; footnotes on a sheet 0.75rem in muted ink.
- **Label / Index** (600, 0.6875rem, 0.12em, uppercase): table heads, the sidebar's group names, field labels, legends. The way a form prints its field names.
- **Stamp** (700, 0.6875rem, 0.1em, uppercase): states on a paper.
- **Serial** (mono 500, 0.75rem, 0.12em, uppercase, serial gold): the line printed under the masthead title: date, counts, a reference.
- **Reference** (mono 500, 0.75rem, 0.06em, intaglio green): a paper's reference, "PER-3F9A-21C0".

### Named Rules
**The Counted Not Said Rule.** Mono is only for what is counted, dated or numbered: references, numbers, dates, serials, codes. Words, labels and stamps are Public Sans, even when small and tracked. Tables, `<time>` and mono set tabular figures.

**The Serial Under Rule.** The serial line prints under the page title, never above it. Nothing small and tracked sits above a heading.

## Layout

A 14rem teal sidebar beside the page from 768px up: the wordmark and seal, File
a document as the one gold button, then Find / File / Household groups, the
signed-in name and Sign out at the foot. Below 768px, a teal tab bar fixed at
the bottom (Dashboard, Vault, Search, File, More), the current tab marked by a
short gold bar above its word; More opens the rest of the index as a sheet
above the bar. Pages leave room for the bar so it never covers the end.

Every signed-in page opens with the masthead band, then the page beneath it.
Both share one container (max 72rem, 16px gutters on a phone, 32px from
768px), so a page's work lines up with its name; a narrow page (forms, records,
People, Settings) keeps the same left edge and stops at 48rem. Sections stack
32px apart. On the dashboard, Running out moves above the family chart on a
phone.

Nothing scrolls sideways at 390px except the access matrix and the family
chart, each inside its own sheet; the matrix shows a scroll cue.

### Named Rules
**The Thumb Rule.** Buttons and fields are 40px tall (small buttons 32px); switches and chips grow on coarse pointers; list rows are about 52px. A row that opens one thing is a link across its whole width (`row-link`). Fields are 16px on coarse pointers so the phone does not zoom.

## Elevation & Depth

Flat. No shadows anywhere in the app. Depth is a lighter sheet on the paper
with a 1px ruled edge, and the dark masthead band against the light page. A
sheet's list head is ruled in full ink beneath it, the rows in a light rule.
The only gradients are functional: the masthead's quiet field that keeps the
plate off the words, and the scroll cue's soft edge.

### Named Rules
**The Engraved Not Lifted Rule.** Separation is a rule line, a double frame or a tonal step, never a shadow.

## Shapes

Engraved, not pressed: every corner is a hair off square (1px, 2px, 3px, 4px;
3px for buttons, fields and sheets, 2px for stamps). No pills and no circles
except the seal. Lines are 1px, with three heavier forms that each mean
something: the double rule (a name box in the chart, the household's and
businesses' certificate boxes, 3px double), a stamp's 1.5px frame, and a
category's 2px ink rule above its section head. A category's mark is a small
rotated square with a 1.5px edge.

## Components

### Buttons
Square, ruled, like a stamp's frame.
- **Shape:** 3px corners, 40px tall (32px small), 600 weight at 0.875rem.
- **Primary:** teal with white text (on-teal); one per form. Hover deepens to teal-deep.
- **Secondary:** sheet with a rule-strong edge; hover darkens the edge to gray-600.
- **Danger:** claret with white text; hover claret-deep.
- **Serial (on teal only):** gold with ink text; hover turns hollow, gold text on teal.
- **Focus:** a 2px teal outline offset 2px on every control, never removed. Disabled is 55% opacity.

### Stamps
A state stamped on a paper: expired, running out, today, private, no sign-in.
- **Style:** capitalised Public Sans 700, 1.5px frame in the text's own colour, 2px corners, no fill.
- **Variants:** warn in claret, soon in old-gold-ink, quiet in muted ink. In the family chart a stamp is double-framed and tilted 2 degrees above the name it belongs to.

### Cards / Containers (the sheet)
- **Corner Style:** 3px.
- **Background:** sheet on paper.
- **Shadow Strategy:** none (see Elevation).
- **Border:** 1px rule. A list sheet's head is ruled in ink below; rows divide with a light rule; a muted footnote closes it.
- **Internal Padding:** 16px on a phone, 20-24px from 768px.

### Inputs / Fields
- **Style:** sheet background, 1px rule-strong edge, 3px corners, 40px tall. Placeholders in muted ink. In the masthead the search field drops its edge.
- **Focus:** the edge turns teal, plus the focus ring.
- **File picker:** its button is drawn as a secondary button.

### Navigation
- **Sidebar:** teal. Group names in the index voice, muted. Items 0.875rem in side-ink; hover side-hover; the current item is a sheet-coloured plate with ink text, 600 weight.
- **Phone:** the teal tab bar; the current tab in side-ink with a gold bar above it; More is a native disclosure.
- **Switch (`app/segmented.tsx`):** a ruled strip of links, the current one teal. The view lives in the URL.
- **Quick searches:** 2px-cornered ruled chips on the sheet, the count beside the word in mono.

### The masthead (signature)
`app/masthead.tsx`. A deep teal band across every signed-in page: the page's name, the serial line in gold under it, and whatever the page needs (search, a button) at the right over the rosette. Behind them, the guilloché plate from `app/guilloche.ts`: twelve interlaced sine strands and one three-ring rosette at the right, seeded by the page's name (the dashboard by the household's), pure and deterministic, drawn in plate ink with a dark field fading in from the left. On first open the plate inks itself in (1400ms, `cubic-bezier(0.16, 1, 0.3, 1)`, staggered 60/140ms); with reduced motion it simply is there. Content is never hidden behind it. The signed-out pages put the same plate, seeded "Safehouse", behind one sheet, with the seal and a tracked wordmark above.

### References
`app/reference.ts`. A paper's printed reference is a category prefix (PER, MED, BUS, FIN, LEG, GEN) and eight hex digits hashed from the document id: "PER-3F9A-21C0". Never a running count: a count would say how many papers exist beyond the viewer's reach. Set in the reference style in intaglio green, after the owner's name.

### The family chart
`app/tree-picture.tsx`. One ink for every family line (1.5px, square joins). Guardianship is old gold, 2px, dash-and-dot. A tie that has ended is dashed and faded, and gives nobody access. A person is a ruled box, 2px corners, framed twice like an entry on a certificate, the name in 14px semibold and the viewer's count of their papers in mono at the right. Someone who has died: a single dashed grey frame and a †. Hover and focus ink the frame teal. A legend under the chart says all of it in words.

### The reach bar
On Access (PRODUCT.md specifies it): an 8px ruled track on the sheet, filled teal to the share of documents an account reaches. Hidden from assistive tech; the sentence beside it says the numbers.

### The logo
`app/logo.tsx`: a house whose door is a keyhole, inside a double-ruled seal, drawn in lines in serial gold. `public/favicon.svg` is the same mark on a 4px-cornered teal square.

### Motion
All of it lives in `app/app.css`, needs no library, and stops under reduced motion.
- **Waiting:** a 2px serial-gold rule across the top of the page while the router or any fetcher is busy, shown after 150ms so a quick page never flickers (`Waiting` in `app/root.tsx`). The button that submitted carries `aria-busy`: no second press, and a rule sweeps its foot.
- **Changing page:** the shell's links and the view switch carry `viewTransition`. The page cross-fades and the new one settles up 6px; the sidebar and tab bar hold still.
- **Stamps:** a warn or soon stamp lands like an office stamp, a touch large and faint, then pressed flat. Quiet stamps just sit.
- **A revealed number** inks in from the left in typewriter steps.

## Do's and Don'ts

### Do:
- **Do** use the grey roles (`gray-500` muted, `gray-900` ink) and the accent and side roles, and let dark mode follow.
- **Do** put anything typed or read closely on a sheet with a 1px rule and 3px corners.
- **Do** set every count, date, reference and serial in Red Hat Mono, and every word in Public Sans.
- **Do** print the serial line under the masthead title.
- **Do** say a state as a stamp in words: claret for expired or destructive, old gold for running out.
- **Do** derive any printed reference from the document id, never from a count.
- **Do** seed a guilloché plate from the page's own name, and keep the quiet field between it and the words.
- **Do** keep every text colour at 4.5:1 or better in both modes.

### Don't:
- **Don't** add shadows, pills, or corners rounder than 4px.
- **Don't** set words, labels or stamps in mono.
- **Don't** put a kicker or any small tracked line above a heading.
- **Don't** add `dark:` variants for greys, or new hex colours in a component.
- **Don't** fill a region with a category ink, or use plate ink for anything but the plate.
- **Don't** give the family chart a colour per family; one ink, gold for guardianship, dashed for ended.
- **Don't** load a font from a font server.
- **Don't** rebuild the cloud-drive grid, the SaaS stat card, or the transit-map toy.
