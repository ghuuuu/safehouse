---
name: Safehouse
description: A household's papers, kept in a calm, dark, native-feeling app.
colors:
  paper: "#0f1013"
  side: "#15161a"
  sheet: "#1a1b20"
  raised: "#222329"
  gray-50: "#202127"
  gray-100: "#25262d"
  gray-200: "#2d2e36"
  gray-300: "#3b3c46"
  gray-400: "#61626d"
  gray-500: "#a0a1ab"
  gray-600: "#b5b6bf"
  gray-700: "#c9cad2"
  gray-800: "#dcdde3"
  gray-900: "#ececf1"
  gray-950: "#f8f8fb"
  side-ink: "#dcdde3"
  side-muted: "#8e8f99"
  accent: "#f2bd55"
  accent-deep: "#f7cd77"
  on-accent: "#1b1406"
  accent-tint: "color-mix(in oklab, #f2bd55 14%, transparent)"
  ref: "#b5b6bf"
  warn: "#ff8f85"
  red-500: "#ff7b70"
  soon: "#ffae5e"
  cat-personal: "#7fb2ff"
  cat-medical: "#62d2a2"
  cat-business: "#b9a2ff"
  cat-financial: "#5cc8d6"
  cat-legal: "#e391d3"
  cat-general: "#b0b3bd"
typography:
  display:
    fontFamily: "Figtree, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "2.5rem"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.028em"
  title:
    fontFamily: "Figtree, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Figtree, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    letterSpacing: "-0.012em"
  body:
    fontFamily: "Figtree, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
  button:
    fontFamily: "Figtree, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.25
  label:
    fontFamily: "Figtree, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.01em"
  badge:
    fontFamily: "Figtree, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1
  number:
    fontFamily: "Figtree, ui-sans-serif, system-ui, sans-serif"
    fontFeature: "\"tnum\" 1"
  reference:
    fontFamily: "Red Hat Mono, ui-monospace, Cascadia Mono, Consolas, monospace"
    fontSize: "0.75rem"
    fontWeight: 500
    letterSpacing: "0.02em"
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "12px"
  2xl: "16px"
spacing:
  gutter-phone: "16px"
  gutter-desk: "32px"
  section: "32px"
  sidebar: "240px"
  tab-bar: "68px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "8px 16.8px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.accent-deep}"
  button-primary-disabled:
    backgroundColor: "{colors.gray-100}"
    textColor: "{colors.gray-500}"
  button-secondary:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.gray-900}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "8px 16.8px"
    height: "40px"
  button-secondary-hover:
    backgroundColor: "{colors.gray-200}"
  button-danger:
    backgroundColor: "color-mix(in oklab, #ff7b70 14%, transparent)"
    textColor: "{colors.warn}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "8px 16.8px"
    height: "40px"
  button-danger-hover:
    backgroundColor: "color-mix(in oklab, #ff7b70 22%, transparent)"
  button-sm:
    rounded: "{rounded.sm}"
    padding: "4.8px 12px"
    height: "32px"
  field:
    backgroundColor: "{colors.gray-100}"
    textColor: "{colors.gray-900}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
    height: "40px"
  field-focus:
    backgroundColor: "{colors.gray-50}"
  sheet:
    backgroundColor: "{colors.sheet}"
    rounded: "{rounded.xl}"
  masthead:
    textColor: "{colors.gray-950}"
    typography: "{typography.display}"
  nav-item:
    textColor: "{colors.side-ink}"
    rounded: "{rounded.lg}"
    padding: "6.4px 10px"
  nav-item-hover:
    backgroundColor: "{colors.gray-50}"
  nav-item-current:
    backgroundColor: "{colors.accent-tint}"
    textColor: "{colors.gray-950}"
    rounded: "{rounded.lg}"
  tab-bar:
    backgroundColor: "rgb(21 22 26 / 0.85)"
    textColor: "{colors.side-muted}"
    height: "68px"
  tab-current:
    textColor: "{colors.accent}"
  segmented-track:
    backgroundColor: "{colors.gray-100}"
    rounded: "{rounded.lg}"
    padding: "2px"
  segmented-current:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.gray-950}"
    rounded: "{rounded.lg}"
    padding: "6px 14px"
  chip:
    backgroundColor: "{colors.gray-100}"
    textColor: "{colors.gray-800}"
    rounded: "{rounded.lg}"
    padding: "4px 12px"
  badge:
    typography: "{typography.badge}"
    rounded: "{rounded.sm}"
    padding: "4.8px 8.8px"
  badge-warn:
    backgroundColor: "color-mix(in oklab, #ff8f85 14%, transparent)"
    textColor: "{colors.warn}"
  badge-soon:
    backgroundColor: "color-mix(in oklab, #ffae5e 14%, transparent)"
    textColor: "{colors.soon}"
  badge-quiet:
    backgroundColor: "color-mix(in oklab, #b5b6bf 14%, transparent)"
    textColor: "{colors.gray-600}"
  reference:
    textColor: "{colors.ref}"
    typography: "{typography.reference}"
  time-left-ring:
    size: "28px"
---

# Design System: Safehouse

## Overview

**Creative North Star: "Safehouse at Night"**

A calm, native-feeling private app on a dark, tinted ground, finished like the
best small Mac apps. The craft is in layered surfaces, type and quiet motion,
not in a metaphor. A blue-black ground, a sidebar one step up, surfaces a step
lighter again, and one warm accent, honey, that means only "you, here, now":
the primary action, where you are, and focus.

It is an Operate surface, used two ways and both first-class: filing at a desk
and finding on a phone. Lists read like native lists; a paper opens without
ceremony. The page header sits on the ground, not in a band: the name does the
work.

It replaced Security Print on 2026-10-20. Security Print read plain, without
finesse or motion; the user wanted it dark and moody, less metaphor, and the
calm of Things 3 and Apple Notes, with motion as subtle polish rather than
showpiece. It refuses the cloud-drive card grid, the SaaS stat card, and
costume.

The world's tokens and their reasoning are at the top of `app/app.css`; the
shell is `app/routes/shell.tsx`, the page header `app/masthead.tsx`, the
reference `app/reference.ts`, the signature ring `app/time-left.tsx`.

**Key Characteristics:**
- Always dark. `@custom-variant dark (&)` is on everywhere, so a component's `dark:` classes are simply its classes. There is no light theme.
- Blue-black ground, sidebar one step up, surfaces and raised surfaces each a step lighter, hairlines in the low greys.
- One accent, honey, with dark ink on it: the primary action, the current place, focus. Soft red for expired and destructive, orange for running out, both always said in words.
- Figtree for every word and every number (tabular figures); Red Hat Mono only for references and code. Both self-hosted.
- Soft corners (6-16px), never a pill, never square. Soft shadows, darker than the ground, on raised layers only.
- Icons drawn on one 20px grid with a 1.6 stroke and round ends, always beside words.
- The time-left ring wherever a paper expires.

## Colors

One palette, dark only, with one accent. Every text step from `gray-500` up
reads at 4.5:1 or better on every surface.

### Primary
- **Honey** (accent): the one colour that means "you, here, now". The primary button, the current tab, the icon in the current sidebar row, the reach bar's fill, the focus ring, the waiting line, `accent-color` and caret, guardianship in the family tree, and the corner editor's outline. Its hover is **Light Honey** (accent-deep). Text on honey is **Honey Ink** (on-accent).
- **Honey Tint** (accent-tint, honey at 14%): the current row in the sidebar. Selection is honey at 32%.

### Tertiary
- **Soft Red** (`red-*` scale; warn for words, red-500 for tints): expired, an emergency window, anything destructive. The danger button, `stamp-warn`, an expired ring.
- **Orange** (`amber-*` scale; soon): about to run out, and a notice that something wants doing. `stamp-soon`, the time-left arc.
- **Category colours** (cat-personal through cat-general): a small soft dot beside a category's written name, and nothing else. Each reads at 4.5:1 as text. Never a region's fill.

### Neutral
- **Night Ground** (paper): the page, the signed-out pages, and the family tree's own canvas.
- **Sidebar** (side): the sidebar, and the phone's tab bar at 85% behind a blur.
- **Surface** (sheet): anything read closely; also every `white` class.
- **Raised** (raised): what sits on a surface: secondary buttons, the current option of a switch, a person's box in the tree, the phone's More sheet.
- **Greys as roles** (gray-50 to gray-950): 50 a row's hover, 100 a field's fill and a surface's edge, 200 a divider and a control's edge, 300 a stronger edge, 400 the family tree's lines, 500 muted text, 600 quiet badges and references, 700 a lead sentence, 900 ink, 950 headings and names.
- **Sidebar inks** (side-ink, side-muted): the sidebar's words and its group names and resting icons.
- **Reference Grey** (ref): a paper's printed reference.

### Named Rules
**The One Honey Rule.** Honey means you, here, now, and nothing else. A screen keeps one honey button: a page-header action beside the sidebar's File a document is a secondary.

**The Roles Not Shades Rule.** The `gray-*` scale is a set of roles, not shades. A component never picks a hex; it picks a role, and `app/app.css` decides the value.

**The Words Too Rule.** Colour is never the only cue. A badge carries words; a ring has its days written beside it; a category's dot sits beside its name; a tree line has a legend.

## Typography

**Root size:** 106.25% on `:root`, so 1rem is 17px at the browser's default and every rem below (type and spacing) is a step larger than Tailwind's stock 16px. Pixel sizes in this file are written at 16px per rem; multiply by 1.0625 for what the screen shows.

**Body Font:** Figtree (variable 300-900, roman and italic), fallback ui-sans-serif, system-ui, -apple-system
**Mono Font:** Red Hat Mono (variable 300-700), fallback ui-monospace, Cascadia Mono, Consolas

**Character:** one friendly, even grotesque for every word and number, the way
a native app uses its system face, and a mono kept for the one thing that is a
code. Both ship from `public/fonts` (OFL); a private vault does not tell a font
server which pages are open.

### Hierarchy
- **Display** (600, 1.875rem on a phone to 2.5rem from 768px, line-height 1.1, -0.028em): the page's name in the page header, one per page.
- **Title** (600, 1.5rem, -0.02em): the title on a signed-out card.
- **Headline** (600, 1.5rem, -0.02em): a section head on a surface or the page. A category's head is 1rem with its dot.
- **Body** (400, 0.875rem): lists, forms, explanations. The line under the page name is 0.875rem muted; a lead sentence is 1rem in gray-700; footnotes under a surface are 0.75rem muted.
- **Label** (600, 0.75rem, 0.01em, sentence case): table heads, the sidebar's group names, a field panel's names. Not tracked out, not capitals.
- **Badge** (600, 0.75rem, line-height 1): states on a paper.
- **Numbers** (Figtree with tabular figures): counts, dates, sizes. `font-mono`, tables and `<time>` set even figures; `font-mono` is Figtree here, not a mono.
- **Reference** (Red Hat Mono 500, 0.75rem, 0.02em, reference grey): a paper's reference, "PER-3F9A-21C0". `code`, `kbd` and `pre` use the same face.

### Named Rules
**The One Face Rule.** Every word and every number is Figtree. Red Hat Mono is for references and code only.

**The Under Not Over Rule.** The quiet line sits under the page's name, never above it. Nothing small sits above a heading.

## Layout

A 15rem sidebar beside the page from 768px up: the logo and wordmark,
File a document as the one honey button, then Find / File / Household groups of
icon rows, the signed-in name, role and Sign out at the foot. Below 768px, a
translucent tab bar fixed at the bottom (Dashboard, Vault, Search, File, More)
with icons over words, 68px tall plus the safe area; the current tab is honey.
More is a native disclosure that opens the rest of the index on a raised sheet
floating above the bar, with 16px corners. Pages leave room for the bar so it
never covers the end.

Every signed-in page opens with the page header on the ground (32px from the
top on a phone, 48px from 768px), then the page. Both share one container (max
72rem, 16px gutters on a phone, 32px from 768px), so a page's work lines up with
its name; a narrow page (forms, records, People, Settings) keeps the same left
edge and stops at 48rem. Sections stack 32px apart.

The dashboard is the one page that takes the whole window width (`wide` on the
header and page), so the tree and the lists show as much as the screen holds. It
reads: the lead sentence, any alerts, the family (its switch and quick searches
under its head, then the tree, then the household and businesses), then Running
out and By kind side by side from 1024px, 3:2, stacked in that order below it.

Nothing scrolls sideways at 390px except the access matrix and the family
tree, each inside its own surface; the matrix shows a scroll cue.

### Named Rules
**The Thumb Rule.** Buttons and fields are 40px tall (small buttons 32px); sidebar rows are 40px on a phone; tabs are 68px; switches and chips grow on coarse pointers. A row that opens one thing is a link across its whole width (`row-link`). Fields are 16px on coarse pointers so the phone does not zoom.

## Elevation & Depth

Layered. Depth is a stack of lighter surfaces (ground, sidebar, surface,
raised), each edged with a hairline from the low greys, and soft shadows on the
layers that sit up. A shadow is offset down and darker than the ground, with a
1px inset highlight along the top edge; never a halo. Section heads are divided
from their rows by a gray-200 line, rows by gray-100.

### Shadow Vocabulary
- **Raised** (`--shadow-raised`): every surface (`.sheet`), and the current option of a switch.
- **Float** (`--shadow-float`): what floats over the page: the phone's More sheet and the signed-out card.
- **Primary bevel** (`0 1px 0 rgb(255 255 255 / 0.25) inset, 0 1px 2px rgb(0 0 0 / 0.4)`): the honey button.
- **Secondary highlight** (`0 1px 0 rgb(255 255 255 / 0.04) inset`): the secondary button.
- **Field glow** (`0 0 0 3px` honey at 30%): a focused field, in place of the outline.

### Named Rules
**The Darker Not Glowing Rule.** Shadows are darker than the ground and fall downward. The only light is a 1px top highlight, honey only at focus, and the faint honey glow behind the signed-out card.

## Shapes

Soft, the way a native app's corners are: 6px for small buttons and badges,
8px for buttons, fields and alert panels, 10px for sidebar rows, chips, a
switch's track and its option, and the family tree's canvas, 12px for surfaces, 16px for the floating More sheet. Never a pill, never square. Circles are kept for two
things: a category's dot (with a soft 3px ring of its own colour at 18%) and
the time-left ring. Lines are 1px; family lines
1.5px, guardianship 2px.

## Components

### Buttons
Quiet and solid, with a press that sinks a hair.
- **Shape:** 8px corners, 40px tall, Figtree 600 at 0.875rem, an icon optional at 16px.
- **Primary:** honey with honey ink, one per screen. Hover lightens to accent-deep. Disabled gives up its honey for a gray-100 fill and muted text.
- **Secondary:** raised fill, gray-200 edge, gray-900 text; hover gray-200 fill, gray-300 edge.
- **Danger:** said in red on a red tint (14%, edge 30%); hover 22% and 45%.
- **Small:** 32px, 0.8125rem, 6px corners.
- **Press:** scales to 0.97 in 120ms. **Focus:** a 2px honey outline offset 2px on every control, never removed. Disabled is 50% opacity.

### Badges
A state on a paper: expired, running out, today, private, superseded, read by machine.
- **Style:** Figtree 600 at 0.75rem, 6px corners, a 14% tint of the text's own colour, no edge. Always words.
- **Variants:** `stamp-warn` soft red, `stamp-soon` orange, `stamp-quiet` gray-600. Over a name in the family tree the badge hangs above the box with a 35% edge.

### Cards / Containers (the surface)
- **Corner Style:** 12px.
- **Background:** sheet on the ground.
- **Shadow Strategy:** raised (see Elevation).
- **Border:** 1px gray-100. A list surface's head is divided by gray-200, rows by gray-100, a row hovers to gray-50, and a muted footnote closes it.
- **Internal Padding:** 16px on a phone, 20-24px from 768px.
- **Alerts:** a red or amber panel (tint fill, 300-step edge, 8px corners) above the surfaces, for an open emergency window, failing notifications, or the key and backup jobs.

### Inputs / Fields
- **Style:** gray-100 fill, 1px gray-200 edge, 8px corners, 40px tall. Placeholders in muted grey. The header's search field drops its edge.
- **Focus:** the edge turns honey, the fill steps to gray-50, and a 3px honey glow replaces the outline.
- **File picker:** its button is drawn as a secondary button.
- **Disclosures:** a summary that keeps the browser's marker gets a drawn chevron that turns 90 degrees when it opens.

### Navigation
- **Sidebar:** the side colour, a hairline on its right. Group names in the label voice, side-muted. Rows are icon and word at 0.875rem in side-ink, 10px corners; hover gray-50. The current row is a honey tint with gray-950 text at 500 weight and a honey icon; the tint carries `view-transition-name: nav-here`, so on a page change it glides to the new row. Unfinished shows its count of drafts in tabular figures, with "waiting" for screen readers.
- **Phone:** the translucent tab bar (side at 85%, `backdrop-blur-xl`, saturate 150%), 22px icons over 0.6875rem words, side-muted at rest, honey when current. More turns honey when the page is one of its own.
- **Switch (`app/segmented.tsx`):** a native segmented control. A recessed gray-100 track, 2px in, the current option raised on it with the raised shadow. Each option is a link; the view lives in the URL. It is also a page's tabs (`?tab=` on Settings and People, `?view=` on Access), so a form posts back to the tab it was on; when the options outgrow a phone the track scrolls sideways rather than wrapping.
- **Quick searches:** chips with 10px corners, gray-100 fill and gray-200 edge, the count beside the word in muted tabular figures.
- **Icons (`app/icons.tsx`):** drawn here, one 20px grid, 1.6 stroke, round ends. Decorative: the words beside them say the same.

### The page header
`app/masthead.tsx`. The page's name in the display style on the ground, a muted
line under it (on the dashboard the day, "Tuesday 20 October", and the count of
papers), and whatever the page needs at the right (search, a button), wrapping
under on a phone. No band, no plate, no art.

### The time-left ring (signature)
`app/time-left.tsx`. A small circular gauge, 28px, drawn wherever a paper
expires: a gray-200 track with an orange arc for the share of the reminder
window left, round ends, starting at twelve o'clock. An expired paper is an
empty soft-red track at 40%. On first draw the arc fills from empty (900ms,
ease-out, 120ms delay). It is hidden from assistive tech and never alone: the
days are always written beside it.

### Category dots
`app/folder-tab.tsx`. A 10px dot in the category's colour with a soft 3px ring
of the same at 18%, before the category's written name. A category's section
head is the dot and its name at 1rem semibold.

### References
`app/reference.ts`. A paper's printed reference is a category prefix (PER,
MED, BUS, FIN, LEG, GEN) and eight hex digits hashed from the document id:
"PER-3F9A-21C0". Never a running count: a count would say how many papers exist
beyond the viewer's reach. Set in the reference style, after the owner's name.

### The family tree
`app/tree-picture.tsx`. Drawn on the ground inside its surface, with 10px
corners. One quiet line for every family tie (gray-400, 1.5px, round joins).
Guardianship is honey, 2px, solid. A tie that has ended is dashed and at
70%, and gives nobody access. Two lines leaving one card leave from separate
points; a second line into a child (a step-parent's) lands beside the
parents' line, its label on its own side. Where a line runs across another's
drop it hops over it in a 5px arc, so a crossing never reads as a join. A person is a raised box, 8px corners, a gray-200
edge, the name in 14px semibold and the viewer's count of their papers in
tabular figures at the right. Someone who has died: a dashed gray-300 edge on
the ground and a †. Hover and focus light the edge honey. A badge hangs above
a name that has a paper running out. A legend under the tree says all of it in
words.
- **Moving:** drag to pan, and the tree follows the finger exactly; let go
  while moving and it is thrown on a little (220ms of travel) then settles.
  Pinch, or Ctrl or Cmd with the wheel, zooms about the pointer; the buttons
  zoom by 1.25 about the middle. Zooms and throws glide, eased by time (about
  90% there in 200ms), never jumping. A plain wheel scrolls the page past it.
  It opens no smaller than 0.8, on its middle, and is never panned off the
  family. With reduced motion every move is instant.

### The reach bar
On Access (PRODUCT.md specifies it): an 8px gray-200 track with 4px corners,
filled honey to the share of documents an account reaches. Hidden from assistive tech; the sentence
beside it says the numbers.

### The logo
`app/logo.tsx`: a house that is a safe, its door a combination dial, inlined
from `public/logo/SH-logo.svg` (also the favicon). Recoloured into the night:
a honey shell, the door in the sheet's grey, the dial honey on raised grey,
every line in honey ink. The original navy-and-orange art and its Illustrator
file are in `design/`. 44px tall beside a 28px "SafeHouse", centred, in the sidebar,
64px over a 24px one on the signed-out pages. The product is written
SafeHouse wherever a person reads it.

### Signed-out pages
`app/signed-out.tsx`. Sign-in, first run, an invite, an error: the logo and
wordmark centred above one surface with the float shadow (max 28rem, 42rem
wide), its title in the title style, on the ground with a faint honey glow
behind it.

### Drafts (`app/routes/intake.$intakeId.tsx`)
An upload is checked before it is filed (D40), on one narrow page: a Pages surface, a Details surface, then File it. Their heads are divided by gray-200.
- **A page row:** the page as it will be filed on the left (a photo flattened, a PDF page in the browser's own viewer), and on the right its number in tabular figures, where it came from in muted words or a `stamp-soon` "Edges not found", the size picker (presets, "As scanned", or millimetres asked for only when "Another size" is the choice), and small secondary buttons to turn, move and remove it.
- **Read by machine:** a field the reader filled carries a `stamp-soon` "read by machine" until a person types over it. Filing records whatever is in the form as checked, and the page says so above the fields.
- **File it** belongs to the details form, so what is typed is what is filed. Discard sits under a native disclosure and is a danger button.
- **The corner editor** (`intake.$intakeId.corners.$pageId.tsx`): the photo inside an SVG of its own pixel size, the outline a 2px honey line over a 12% honey wash, and four square handles (sheet fill, honey edge, a hair of corner), never circles. Each handle is a focusable slider that arrow keys move, 1% a step and 0.2% with Shift.

### Folders (`app/routes/folders.tsx`)
The vault as a filing cabinet (D41): one surface, "Everything" at its head divided by gray-200, then whose, what kind and the papers, each level a native disclosure indented a step. A folder is a small line drawing (tab and body, no fill) in muted grey. A folder's checkbox ticks everything in it and shows a half tick when some is chosen. A paper still filed as images carries a `stamp-quiet` "Image". The one primary button says how many are chosen, in tabular figures.

### People, Access and Settings: tabs, not one long scroll
- **People** (`app/routes/people.tsx`): an administrator gets three tabs. Everyone is the roster, one surface per kind, each name a `row-link` to that owner's papers, with the sign-in state shown to the administrator only (anybody else would read "no sign-in" for a relative who has one). Sign-ins splits people into Can sign in (New sign-in link) and No sign-in yet (email and Invite). Add somebody is the form on one surface: names, born and sex in a two-column grid, then the "They are the ___ of ___" sentence. Anybody else sees the roster with no tabs.
- **Access** (`app/routes/access.tsx`): One account, Everyone at once, How access works. The account list is grouped under a heading per role with its count. In the grant list, an owner the account already reaches through the tree or the household is muted and says "already sees". Everyone at once is the one wide Access view. How access works is the rules in words, from the permission views, on raised cards two to a row from 1024px.
- **Settings** (`app/routes/settings.tsx`): Account, Security, Notifications, Household, one or two surfaces each, headed at 1.25rem. Two-factor states itself with a stamp: quiet "On", orange "Off".

### Unfinished (`app/routes/unfinished.tsx`)
Two list surfaces: drafts (a row that opens the draft, `row-link`, someone else's marked with `stamp-quiet`) and papers filed as images, each with a small secondary Convert button. The sidebar shows the number of drafts beside Unfinished, with "waiting" for screen readers.

### Motion
Subtle polish, not showpiece. All of it lives in `app/app.css` (and the tree's glide in `app/tree-picture.tsx`), needs no library, and stops under reduced motion: view transitions, keyframes and the tree all go still.
- **Waiting:** a 2px honey line across the top of the page while the router or any fetcher is busy, shown after 150ms so a quick page never flickers, creeping towards the end over 10s (`Waiting` in `app/root.tsx`). The button that submitted carries `aria-busy`: no second press, and a soft shimmer sweeps across it every 1100ms. With reduced motion the line is simply there.
- **Changing page:** the shell's links and the view switch carry `viewTransition`. The old page fades in 140ms; the new one settles up 8px out of a 3px blur in 320ms. The sidebar and tab bar hold still, and the honey current row glides to its new place in 320ms.
- **Badges:** a warn or soon badge fades up 2px into place (360ms, 80ms delay). Quiet badges just sit.
- **A revealed number** comes into focus out of a blur (420ms).
- **The ring** draws its arc once, from empty.
- **Easing:** `--ease-out`, `cubic-bezier(0.16, 1, 0.3, 1)`, for everything that arrives; plain ease-out for colour changes (150ms).

## Do's and Don'ts

### Do:
- **Do** pick grey roles (`gray-500` muted, `gray-900` ink, `gray-950` headings) and the accent and side roles; never a hex in a component.
- **Do** put anything read closely or typed into on a surface: sheet fill, 1px gray-100 edge, 12px corners, the raised shadow.
- **Do** keep one honey button per screen, and use honey only for the primary action, the current place and focus.
- **Do** set every word and number in Figtree, numbers with tabular figures, and only references and code in Red Hat Mono.
- **Do** say a state in words: a badge in soft red for expired or destructive, orange for running out.
- **Do** draw the time-left ring wherever a paper expires, with its days written beside it.
- **Do** derive any printed reference from the document id, never from a count.
- **Do** use the icons in `app/icons.tsx`, and add new ones on the same 20px grid and 1.6 stroke.
- **Do** keep every text colour at 4.5:1 or better.

### Don't:
- **Don't** add a light theme or a halo shadow; shadows are darker than the ground.
- **Don't** use pills or square corners; stay within 6-16px.
- **Don't** set words, labels or badges in mono, or track a label out in capitals.
- **Don't** put a kicker or any small line above a heading; the quiet line goes under.
- **Don't** fill a region with a category colour; a category is a dot beside its name.
- **Don't** give the family tree a colour per family; one line, honey for guardianship, dashed for ended.
- **Don't** load a font from a font server.
- **Don't** rebuild the cloud-drive card grid, the SaaS stat card, or a costume.
