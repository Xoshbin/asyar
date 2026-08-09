# Directed Light

**The Asyar Design Language — Specification v1.0**

This document defines what Asyar looks like, how it moves, and why. It is the
constitution; [`tokens.md`](./tokens.md) is the statute book, and
[`.agents/skills/design-language/SKILL.md`](../../../.agents/skills/design-language/SKILL.md)
is the field manual you actually reach for while building a screen.

Read this once, properly. Then work from the skill file.

---

## 0. Where this came from

Asyar's app icon was drawn before any of this was written down. It shows a
point source at the top, a beam narrowing through dark air, and a single lit
ellipse on a deep navy ground.

That icon is a complete design language. Nobody had noticed.

Sampled from `static/app-icon.png`, the mark's palette is:

| Sample         | Value     | Hue    |
| -------------- | --------- | ------ |
| Ground, corner | `#080F3B` | 231.8° |
| Ground, body   | `#182A68` | 226.5° |
| Lit blue       | `#3050A3` | 223.3° |
| Beam haze      | `#9FA7CC` | 229.3° |
| Source / pool  | `#FFFFFD` | —      |

Everything in this specification is derived from those six values and from the
three physical facts the picture asserts: **there is one source, it is
directly above, and it lights exactly one thing.**

Before this document, the app contradicted its own icon on every axis. The
accent colour was Apple's system blue `rgb(0, 122, 255)`. The brand token was
a teal, `#2ec4b6`, that appeared nowhere in the mark and was used for almost
nothing. Surfaces were neutral grey `rgba(30, 30, 32, …)`. Shadows fell down
and to the left, implying a light source up and to the right. On macOS the
type reverted to San Francisco, so the app had no typographic identity at all
on the platform most of its users are on.

None of that was bad work. It was the absence of a thesis. This is the thesis.

---

## 1. Philosophy and core principles

### The thesis

> **Asyar is an instrument, not a place.**

Applications are places. You arrive, you look around, you settle in, you leave
by the door you came in. Places can afford decoration, navigation, a sense of
having somewhere to be.

An instrument is different. You pick it up, it does one thing with total
precision, and you put it down. A tuning fork has no home screen. Asyar is
summoned by a keystroke, lives for two to six seconds, and vanishes. It is
held, not inhabited.

Everything follows from this. An instrument does not introduce itself, so
there is no logo in the UI. An instrument's surface is entirely given over to
the work, so there is no persistent chrome that isn't load-bearing. An
instrument is judged on how precisely it responds, so motion reports state
rather than performing delight. And an instrument is used without looking,
so every affordance names the key that fires it.

The emotional target is not _delight_. It is **the specific confidence of a
tool that answers before you finish asking.** Asyar should feel less like an
app opening and more like a light coming on.

### The four principles

These are not values. They are constraints, and each one is written so it can
**reject** a design. A principle that cannot reject anything is a poster.

---

#### I. One Lit Thing

> At any instant, exactly one element carries full luminance and full chroma.
> Everything else is graded down toward the ground.

The user is looking for one thing. The interface's job is to say which one it
currently believes that is, and to be unmistakable about it. Attention is a
single beam; splitting it is the only unforgivable error in a launcher.

In practice: the selected result is lit. Nothing else competes — not a
"primary" button, not a colourful icon grid, not a badge. When the user is
typing, the caret is the lit thing. When a dialog is open, the dialog is.

**This principle rejects:** two accent colours on screen at once · a filled
primary button sitting beside a selected row · category icons in saturated
brand colours · a coloured badge on an unselected row · any hover state strong
enough to be mistaken for selection.

**The one carve-out: icons Asyar does not own.** Every result row renders the
real application icon, and those are saturated, full-colour, and outside our
control. A launcher that desaturated them would be harder to scan, not easier —
recognising Safari by its blue compass is the fastest path there is. So
third-party marks are exempt from this principle, and the exemption is narrow:
it covers artwork the user already recognises, never chrome Asyar draws itself.
An extension's _accent_ is still bound by the rule; only its _mark_ is free.

**Corollary — chrome earns its pixels.** Every persistent pixel must be the
query, a result, or the next keystroke. If it is none of those three, it is
decoration, and decoration takes luminance away from the one lit thing.

---

#### II. The Ground Shows Through

> Asyar never paints an opaque plane over the user's desktop unless the
> platform forces it. Depth comes from transmission, not from stacking.

The launcher floats over whatever the user was doing. That wallpaper, that
half-read document, that video still — it is the ground, and Asyar is a lens
over it, not a card on top of it. This is what makes a launcher feel summoned
rather than launched.

Consequently, surfaces are translucent, and opacity climbs with elevation: the
further forward a surface sits, the less of the desktop it lets past. A
popup is more opaque than the shell because it is nearer to you. This is the
entire elevation model — there are no drop-shadowed white cards in Asyar,
because a card is a thing sitting _on_ a surface, and Asyar has no surface.

Surfaces are also **tinted toward the mark's hue (~225°), never neutral grey.**
A neutral grey panel over a warm wallpaper reads as a foreign object. A panel
carrying a consistent cool cast reads as a material — as glass with a colour,
which is a thing that exists.

**This principle rejects:** an opaque container inside the launcher shell ·
a white card on the glass · nested elevated surfaces (elevation is a scalar,
not a stack) · neutral `#1e1e20`-family greys · a border used where a change
in transmission would do.

---

#### III. Every Affordance Names Its Key

> If it can be done, it has a key path, and that key path is visible at the
> moment it becomes possible.

Asyar is a keyboard instrument. The mouse is supported the way a piano
supports being played standing up. This is not asceticism: the entire value
proposition of a launcher is that it is faster than the thing it replaces, and
a control the user has to hunt for with a pointer has already lost to the Dock.

Every action shows its key, in a `KeyboardHint` chip, at the moment it applies.
Not in a help screen. Not on hover. The chip is how the app teaches itself,
and it is why users graduate from reading the UI to not needing to.

**This principle rejects:** a click-only control · a menu that only opens on
hover · a shortcut documented only in settings · an action in the bottom bar
with no chip · a modal whose dismissal is mouse-only.

---

#### IV. Motion Reports

> Every animation answers "what just changed, and where did it come from?"
> Nothing animates to be admired.

Asyar's whole lifetime is shorter than most apps' launch animation. There is
no budget for choreography. Motion exists to preserve object permanence — so
the eye can follow the selection instead of re-finding it — and for nothing
else.

The test is brutal and worth applying literally: **if the animation were
removed, would the user be confused about what happened?** If no, remove it.

**This principle rejects:** staggered list entrances · shimmer on a 40 ms
query · bounce as decoration · anything that delays a result being actionable ·
a spinner for an operation that finishes faster than the spinner's first
rotation · parallax, ever.

---

## 2. Visual anchors and design character

### The three signatures

A design language needs elements that are recognisable in a screenshot with
the logo cropped out. Linear has its micro-borders and its near-black. Stripe
has its gradient and its isometry. Asyar has three.

---

#### Signature 1 — The Rim

**Every raised surface catches light on its top edge.**

One source, directly above, exactly as in the icon. So a surface that is
lifted off the ground is brighter along its top edge, and loses light at the
bottom. It is one inset box-shadow:

```css
box-shadow: inset 0 1px 0 0 var(--rim-light);
```

That is the whole trick, and it is available as `.rim` (top edge) and
`.rim-all` (top highlight plus bottom shade).

The Rim replaces the border as Asyar's primary means of separating a surface
from what is behind it. A border says _this object has an outline_. A rim says
_this object is closer to the light than the thing behind it_, which is both
truer and quieter.

The corollary is strict and it is what makes the whole system cohere:

> **No shadow in Asyar has a horizontal offset.** Every shadow is `0 Ypx`.

Height is expressed by blur radius and negative spread, never by sliding the
shadow sideways, because a sideways shadow implies a second light source and
Asyar has exactly one. The elevation scale is built this way from `--shadow-xs`
through `--shadow-xl`.

#### Signature 2 — The Bloom

**The selected row is lit, not boxed.**

Every launcher on the market draws a rounded grey rectangle behind the
selected row. Asyar does not, because a filled rectangle reads as a box drawn
_behind_ the text, and this language is about light landing _on_ things.

The Bloom is a two-layer gradient: a hard 2px accent seam at the left edge
where the beam lands, and a wash of accent-tinted light falling off across the
row.

```css
background:
  linear-gradient(
    to right,
    var(--bg-selected),
    color-mix(in srgb, var(--bg-selected) 35%, transparent) 68%,
    transparent
  ),
  linear-gradient(to right, var(--accent-primary) 0 2px, transparent 2px);
box-shadow: inset 0 1px 0 0 var(--rim-light);
```

It reads as directional, which a symmetric fill cannot. It reinforces the
reading order — brightest where the eye enters the row. And it is unmistakably
not the macOS selection highlight, which is the point.

**A selected row never takes a border.** The seam is the edge.

#### Signature 3 — The Key Chip

**The `KeyboardHint` is a typographic mark, not a control.**

Small, mono, tabular, rimmed with `--kbd-rim`, and everywhere. It is the
visual proof of Principle III, and because it appears next to every action in
the product, it is the single most-repeated element in the UI — which makes it
a brand asset whether or not it is treated as one. It is treated as one.

Chips are never coloured. A chip is not a state; it is a fact about the
keyboard.

### Surface and elevation

There are exactly **four** elevations. Not a scale you extend — a list you
choose from.

| Level | Name       | What it is                                | Transmission        | Rim | Shadow                    |
| ----- | ---------- | ----------------------------------------- | ------------------- | --- | ------------------------- |
| 0     | The Ground | The user's desktop. Asyar never draws it. | —                   | —   | —                         |
| 1     | The Shell  | The launcher window itself                | `--bg-primary`, 72% | Yes | `--shadow-launcher-popup` |
| 2     | The Raised | Cards, sidebars, panels within the shell  | `--bg-secondary`    | Yes | `--shadow-sm` … `-md`     |
| 3     | The Near   | Popups, menus, the ⌘K palette, dialogs    | `--bg-popup`, ~80%  | Yes | `--shadow-launcher-popup` |

Two rules govern the whole model:

1. **Elevation is a scalar, not a stack.** A level-3 popup opened from a
   level-2 card is still level 3. Surfaces do not accumulate. If you find
   yourself needing level 4, what you actually need is for the thing beneath
   to recede — that is what `--scrim` is for.
2. **Opacity rises with elevation.** Level 1 shows the most desktop; level 3
   shows the least, because it is nearest and most demanding of attention.
   This is the inverse of how most glass systems work, and it is correct:
   translucency is a measure of distance, not a texture.

The blur is the material. `.launcher-popup` carries
`backdrop-filter: blur(60px) saturate(200%)` — the saturation boost is what
keeps the wallpaper's colour alive through 60px of blur instead of turning it
to grey mud. On Linux, where `backdrop-filter` is unreliable, surfaces fall
back to opaque `--bg-popup`, and that is a supported outcome rather than a
degraded one.

### Typography

**Two faces. There is no third.**

| Role                                  | Face           | Token         |
| ------------------------------------- | -------------- | ------------- |
| Everything the user reads as language | Satoshi        | `--font-ui`   |
| Everything the user reads as data     | JetBrains Mono | `--font-mono` |

**Satoshi, on every platform, including macOS.** This specification reverses a
long-standing decision to fall back to San Francisco on macOS. The reasoning
for the reversal is simple: a design language and "use the OS default font"
are mutually exclusive claims. San Francisco is a superb typeface and it makes
Asyar look exactly like every other Mac app, on the platform where most of its
users are. Satoshi is geometric, slightly warm, and has an unusually confident
lowercase `a` and `g` — it reads as _drawn_ rather than _specified_, which is
the correct register for an instrument with a point of view.

The cost is real and is paid explicitly: Satoshi has lighter stems than SF at
11–13px, so the app sets `-webkit-font-smoothing: antialiased` and
`text-rendering: optimizeLegibility` globally, and never uses weight 400 below
`--font-size-sm` on a translucent ground.

**Tracking is a token, not a judgement call.** Satoshi is drawn a little wide
for dense UI, so display sizes are pulled tight and small text is left alone:

| Token                | Value      | Where                                    |
| -------------------- | ---------- | ---------------------------------------- |
| `--tracking-display` | `-0.028em` | Page titles, the largest type in the app |
| `--tracking-tight`   | `-0.014em` | The command line, section headings       |
| `--tracking-normal`  | `0em`      | All body, label and caption text         |
| `--tracking-wide`    | `0.06em`   | Uppercase group labels only              |

**Weight discipline.** 500 is the heaviest weight permitted in body and label
text. 600 is for headings and the command line. **700 does not appear in the
product** — page titles moved from 700 to 600 in this revision, because at
22px with display tracking, 600 already reads as maximally emphatic, and 700
reads as shouting.

**Mono means aligned, not technical.** Reach for `--font-mono` when characters
need to line up or be read individually — a hash, a path, a duration in a
table column. A version number in a sentence stays in Satoshi. All mono
carries `font-variant-numeric: tabular-nums`.

### Voice

Asyar is mostly words. A result is a title and a subtitle; an empty state is a
sentence; a failure is a sentence. Type is how they look, voice is what they
say, and a design language that specifies one and not the other has only done
half the job.

**Asyar writes the way an instrument reports: flatly, in the user's terms, and
without personality.** The product has no character to express — the user's
task is the only subject.

| Rule                              | Do                                              | Not                                 |
| --------------------------------- | ----------------------------------------------- | ----------------------------------- |
| **Sentence case, always**         | "Copy to clipboard"                             | "Copy To Clipboard"                 |
| **A control names its result**    | "Publish" → toast "Published"                   | "OK", "Submit", "Are you sure?"     |
| **Name what the user recognises** | "Notifications"                                 | "Webhook config"                    |
| **Errors say what and what next** | "Extension failed to load — check the manifest" | "An error occurred"                 |
| **No apology, no exclamation**    | "Nothing matched 'xyz'"                         | "Sorry! We couldn't find anything!" |
| **Second person, active**         | "Choose a shortcut"                             | "A shortcut should be chosen"       |

Two rules specific to a launcher:

- **The result list is a noun list.** A result is named, never described. The
  title is what the thing is called; the subtitle is where it lives or what it
  does. Neither is a sentence.
- **Truncate at the end, never the middle**, except for file paths, where the
  middle is the only expendable part.

Terminology is fixed, because these four get used interchangeably and they are
not synonyms: a **command** is a thing an extension declares; an **action** is a
thing you can do to a selected result; a **result** is a row; an **extension**
is the package that ships them.

---

## 3. Space and scale

### The governing idea

> **Density is derived, not chosen.**

Most design systems pick a spacing scale and then fit the product into it.
Asyar cannot. The launcher window is a fixed 750 × 480, the header and footer
are fixed, and what remains is the only thing the user actually looks at. The
spatial system therefore answers exactly one question — **how many results fit
in one glance** — and every other measurement is downstream of that answer.

This is the instrument thesis applied to measurement. A tuning fork's
dimensions are set by the pitch it has to produce, not by taste.

### The dimensional frame

Everything in the launcher is a subdivision of this:

| Measure                      | Value     | Where it comes from                                                                                     |
| ---------------------------- | --------- | ------------------------------------------------------------------------------------------------------- |
| Window                       | 750×480   | `tauri.conf.json`. On macOS the height is pinned in CSS too, so the DOM never re-lays out on `setFrame` |
| Header (`--shell-header-h`)  | 56px      | The command line at 20px plus breathing room                                                            |
| Footer (`--shell-footer-h`)  | 40px      | One row of chips                                                                                        |
| **Content**                  | **384px** | 480 − 56 − 40. The entire product                                                                       |
| List inset                   | 8px       | `--space-3`, top and bottom                                                                             |
| Result row (`--shell-row-h`) | 40px      | The row box                                                                                             |
| Row separation               | 1px       | A hairline, deliberately not `--space-0-5`                                                              |

Those numbers produce an exact fit, and it is worth doing the arithmetic in
full because nothing else in the system is this tight:

```
384 content − 16 inset = 368 usable
368 = 9 × 40 + 8 × 1
```

**The content area holds exactly nine rows, with zero pixels left over.**

That is the single most consequential property in the product, and until v1.0
of this language it was true _by accident_ — the row was a bare
`min-height: 40px` inside `.result-item`, the separation a bare `1px`, and
nothing recorded that the two were load-bearing. `--shell-row-h` exists so the
next person to adjust a result row finds out first.

The corollary governs the whole scale: **row separation is 1px, not
`--space-0-5`.** Two pixels is the smallest step on the spacing grid and it
looks like the obvious token to use here — but 9 × 40 + 8 × 2 = 376, which
overflows 368 and costs a whole row. This is the one place in Asyar where a
raw pixel beats a token, and the comment in `style.css` says so.

Row inset follows the same logic horizontally. The list insets by `--space-3`
(8px) and the row pads by another `--space-3`, putting result content on 16px
— the same left edge as the query above it, which uses `px-4`. That number was
9px until v1.0, which set every result one pixel to the right of the text the
user had typed, and sat off the 2px grid besides.

### Space is not size

This is the structural decision in the spatial system, and it is the direct
analogue of the voice/fill split in colour.

> **Space is the gap between objects. Size is the object.**

Asyar had only a spacing scale until v1.0 of this language, and the
consequence was visible in the scale itself. `--space-*` had grown values of
**11px, 13px and 23px** — numbers that make no sense as rhythm and perfect
sense as things. 23px was the icon tile in a result row. 11px was the inline
spinner. 13px was the glyph inside a context chip. They were sizes wearing
spacing names, because sizes had nowhere else to live.

So there are now two scales:

**`--space-*` — a 2px grid.** Not the 4px grid most systems use, and that is
deliberate: at 40px rows and 11–14px type, a 4px grid is too coarse to tune a
row against its neighbour. Every whole step is a multiple of 2 — 2, 4, 6, 8,
10, 12, 16, 20, 24, 32, 40, 48.

**`--size-*` — a 4px grid, t-shirt named.** Objects can afford the coarser
grid, and landing them all on multiples of 4 keeps an object aligned to the
spacing rhythm around it.

| Token        | Value | Canonical use                                   |
| ------------ | ----- | ----------------------------------------------- |
| `--size-xs`  | 12px  | A glyph inside a dense chip or badge            |
| `--size-sm`  | 16px  | The default inline icon, beside body text       |
| `--size-md`  | 20px  | A key chip, a small pill, a status pip          |
| `--size-lg`  | 24px  | The icon tile in a result row — the unit object |
| `--size-xl`  | 32px  | An extension avatar, a settings row icon        |
| `--size-2xl` | 48px  | An empty-state or onboarding glyph              |
| `--size-3xl` | 64px  | The largest object in the product               |

The scale is t-shirt named rather than role named (`--size-tile`,
`--size-avatar`) because role names lie at the call site: a 24px spinner is not
a tile, and a token whose name is wrong where it is used reads wrong in review.
The canonical use lives in the comment, where it can be a guide instead of a
claim.

### The four deprecated half-steps

With sizes moved out, four spacing tokens are left holding values that are not
on the 2px grid. They are the only off-grid numbers in the entire system:

| Token         | Value | Status                                                                                                                |
| ------------- | ----- | --------------------------------------------------------------------------------------------------------------------- |
| `--space-1-5` | 5px   | Deprecated → `--space-1` or `--space-2`                                                                               |
| `--space-2-5` | 11px  | Deprecated → `--space-4` or `--space-5`. Its name also lies: it sits between `--space-4` and `--space-5`, not 2 and 3 |
| `--space-5-5` | 13px  | Deprecated → `--space-5` or `--space-6`                                                                               |
| `--space-7-5` | 23px  | Deprecated → `--space-8`, or `--size-lg` if it is an object                                                           |

They are safe to leave in place and must not gain new uses. Across the whole
launcher they account for **3.1%** of spacing usage (32 of 1027 references),
and the majority of those were the size misuses now migrated. What remains is
genuine 1px optical correction, which is worth keeping until each file is
touched for another reason.

### The type scale is a modular scale

Nobody wrote this down either, and it is the same kind of latent order as the
icon. The dense band of the type scale is **10 × 1.08ⁿ, rounded**:

| n   | 1.08ⁿ × 10 | Rounds to | Token                 |
| --- | ---------- | --------- | --------------------- |
| 0   | 10.00      | 10        | `--font-size-2xs`     |
| 1   | 10.80      | 11        | `--font-size-xs`      |
| 2   | 11.66      | 12        | `--font-size-sm`      |
| 3   | 12.60      | 13        | `--font-size-md`      |
| 4   | 13.60      | 14        | `--font-size-base`    |
| 5   | 14.69      | 15        | `--font-size-lg`      |
| 6   | 15.87      | 16        | `--font-size-section` |
| 7   | 17.14      | 17        | `--font-size-xl`      |

An eight-step ratio scale reproduced exactly. A 1.08 ratio is unusually tight —
most systems use 1.125 or 1.25 — and it is right here for the same reason the
spacing grid is 2px: at 10–17px, 8% is a perceptible step, and the product
spends **65% of all its type** in the 11–13px band. A coarser ratio would give
this app three usable sizes.

Above 17px the ratio breaks, and that is intentional — those are not UI sizes,
they are voice sizes, and there are only three:

| Token                 | Value | Role                                    |
| --------------------- | ----- | --------------------------------------- |
| `--font-size-2xl`     | 20px  | **The command line.** Nothing else.     |
| `--font-size-3xl`     | 22px  | A page title                            |
| `--font-size-display` | 36px  | Onboarding and empty-state display type |

The gap between 17 and 20 is the most important interval in the scale: it is
what keeps the query unmistakably larger than every other string on screen
(Principle I).

### Density across the three surfaces

Same tokens, three different densities. This is the one place the system
deliberately varies, because the five surfaces are read at different speeds.
(This document said "three" until the surface audit — the HUD and sticky windows
are real, user-facing, and were being designed without guidance.)

| Surface        | Rhythm                                              | Read at                          |
| -------------- | --------------------------------------------------- | -------------------------------- |
| **Launcher**   | `--space-2` / `--space-3` inside a row              | A glance. Density is the feature |
| **Settings**   | `--space-5` / `--space-6` between rows and sections | Deliberately, with a pointer     |
| **Onboarding** | `--space-7`+ between blocks                         | Once, slowly, one idea per stage |
| **HUD**        | Single line, no chrome at all                       | Peripherally, mid-task           |
| **Sticky**     | Launcher density, but persistent                    | Repeatedly, over minutes         |

A row that is comfortable in Settings is wasteful in the launcher, and a
launcher row dropped into onboarding reads as cramped. If you are unsure which
you are building for, the question is not "how much space looks right" but
"how fast is this read".

### Hit targets

The launcher is keyboard-first, so pointer targets are a secondary concern —
which is fortunate, because this is the one place the spatial system does not
clear the usual bar. A 40px result row is below the 44px both Apple and the
WCAG 2.2 target-size guidance ask for.

That is a deliberate trade, not an oversight: growing the row to 44px costs a
visible result (368 ÷ 45 is eight rows, not nine), and for a surface driven by
`↑`/`↓` and `⏎`, the ninth result is worth more than the four pixels. The row
is still 40px tall and full-bleed horizontally, so it is a large target by any
practical measure — just not by the letter of the guideline.

**Two things follow.** Any surface that is _not_ keyboard-first — Settings,
onboarding, anything with a pointer-only control — has no such excuse and uses
the roomier density below. And if the launcher ever grows a control smaller
than the row itself, that control needs its own target check, because nothing
in the toolchain measures this.

---

## 4. The chromatic system

### The governing idea

Asyar's palette has one hue. Everything that is not a state lives at
**~225°**, the hue of the beam in the mark. Surfaces, text, borders, brand and
accent are all the same colour at different luminances and chromas. Only the
three state colours leave that axis, and they leave it deliberately, because a
state that shared the system's hue would not read as an interruption.

This is why the system feels like a material rather than a palette: there is
nothing in it to clash.

| Element      | Hue    |
| ------------ | ------ |
| Dark ground  | 231.4° |
| Dark raised  | 230.0° |
| Light ground | 225.0° |
| Accent, all  | 225.0° |
| Success      | 157°   |
| Warning      | 35°    |
| Danger       | 354°   |

### The voice and the ground

This is the most important structural decision in the colour system, and the
one most design systems get wrong.

> **A colour that fills cannot also be the colour that speaks.**

The two jobs have contradictory requirements. An accent used as _text_ on a
dark surface must be light enough to reach 4.5:1 against that surface. An
accent used as a _fill_ under white text must be dark enough for white to
reach 4.5:1 on top of it. On a dark ground those two constraints have no
overlapping solution — it is arithmetically impossible for one value to do
both jobs.

Asyar therefore ships two ramps:

| Ramp           | Token             | Use for                                                                      |
| -------------- | ----------------- | ---------------------------------------------------------------------------- |
| **The Voice**  | `--accent-*`      | Text, icons, strokes, focus rings, and as the source for a tinted background |
| **The Ground** | `--accent-*-fill` | The background of a filled surface carrying `--text-on-accent`               |

The voice ramp keeps the unsuffixed names because that is what the codebase
overwhelmingly means — text usage outnumbers fill usage 172 to 27. In light
mode the two converge, because a colour dark enough to read on paper already
carries white; in dark mode they must not, and a test enforces that they don't.

Every pairing is measured, not eyeballed:

| Pairing                                       | Dark   | Light  |
| --------------------------------------------- | ------ | ------ |
| `--accent-primary` on its own ground          | 7.25:1 | 5.67:1 |
| `--accent-success` on its own ground          | 9.66:1 | 4.85:1 |
| `--accent-warning` on its own ground          | 9.14:1 | 5.59:1 |
| `--accent-danger` on its own ground           | 6.87:1 | 5.12:1 |
| `--text-on-accent` on `--accent-primary-fill` | 4.55:1 | 6.23:1 |
| `--text-on-accent` on `--accent-success-fill` | 5.00:1 | 5.34:1 |
| `--text-on-accent` on `--accent-warning-fill` | 5.62:1 | 6.15:1 |
| `--text-on-accent` on `--accent-danger-fill`  | 5.62:1 | 5.63:1 |

`themePalettes.test.ts` recomputes the fill column on every run and fails the
build if any pairing drops below 4.5:1. `check:design` rejects a voice token
used as a background in the same rule as `--text-on-accent`. The guarantee is
mechanical; it is not a promise anyone has to remember.

### Surfaces

Named by depth, not by lightness, so the same name works in both modes.

| Token            | Role                                          | Dark                   | Light                   |
| ---------------- | --------------------------------------------- | ---------------------- | ----------------------- |
| `--bg-primary`   | The window. You rarely set this yourself.     | `rgba(14,16,28,.72)`   | `rgba(242,244,250,.72)` |
| `--bg-secondary` | Cards, sidebars, panels sitting on the window | `rgba(24,27,42,.7)`    | `rgba(233,236,246,.7)`  |
| `--bg-tertiary`  | Inputs, wells, insets inside a card           | `rgba(32,36,54,.7)`    | `rgba(248,250,253,.72)` |
| `--bg-hover`     | Hover on any interactive row                  | `rgba(56,63,92,.5)`    | `rgba(206,214,236,.55)` |
| `--bg-selected`  | **The Bloom.** Accent-tinted, not grey.       | `rgba(61,107,245,.18)` | `rgba(42,85,214,.13)`   |
| `--bg-popup`     | Opaque popups and menus                       | `rgb(16,18,31)`        | `rgb(246,248,252)`      |

Note `--bg-selected`: it is the only surface token carrying chroma, and that
is Principle I expressed as a colour value.

### Text

Three tiers. If you want a fourth, you want a different layout.

| Token              | Composited contrast (dark / light) | For                                         |
| ------------------ | ---------------------------------- | ------------------------------------------- |
| `--text-primary`   | 15.3:1 / 14.4:1                    | Headings, labels, the content they came for |
| `--text-secondary` | 5.9:1 / 5.2:1                      | Subtitles, metadata, supporting detail      |
| `--text-tertiary`  | 3.8:1 / 3.4:1                      | Placeholders, hints, timestamps             |

The tertiary tier was raised in this revision — it previously composited to
2.7:1, below the 3:1 floor for incidental text, which made timestamps and
placeholders genuinely hard to read on a busy wallpaper.

### Colour is never the only channel

Contrast is not the whole of colour accessibility, and the state ramp is where
that bites. Simulated for **deuteranopia** — the most common form, around 6% of
men — the three state hues collapse toward the same olive:

| Pair               | Luminance ratio, deuteranopia |
| ------------------ | ----------------------------- |
| success vs warning | 1.21                          |
| success vs danger  | 1.23                          |
| warning vs danger  | 1.49                          |

`#3ed18f` and `#ff6b77` both land near rgb(160, 160, 130). Green–amber–red is
the textbook failure, and no amount of contrast tuning fixes it, because the
problem is hue discrimination rather than luminance.

This does not mean abandoning the ramp — colour remains the fastest channel for
the majority of users. It means colour may never be the _only_ channel:

> **Every state must be legible with all hue removed.** A state colour is an
> accelerant on top of a shape, an icon, or a word — never the sole carrier.

In practice: a status indicator needs an accessible label or an adjacent word;
a severity needs an icon whose silhouette differs; a chart series needs a direct
label. `Badge` already satisfies this because it carries text. `StatusDot` does
not — it is a bare coloured circle at 8 call sites, and closing that is the
first item in the outstanding list.

The test is mechanical enough to apply in review: **screenshot it, desaturate
it, and see whether you can still read the state.**

### Tinted state backgrounds

There is one house formula. Do not invent a second token for a tinted state:

```css
background: color-mix(in srgb, var(--accent-danger) 12%, transparent);
color: var(--accent-danger);
```

The voice ramp is the source for the tint _and_ the text, which is why they
always agree.

---

## 5. Micro-interactions and motion

### The physics

Asyar's motion is built from **four durations and four curves**. Every
animation in the product is one of each. There is no fifth of either, and
adding one requires changing this document.

| Duration        | Value   | Governs                                      |
| --------------- | ------- | -------------------------------------------- |
| `--dur-instant` | `80ms`  | Colour and opacity landing under the pointer |
| `--dur-quick`   | `140ms` | A state change the user caused directly      |
| `--dur-travel`  | `220ms` | The selection moving; a panel sliding        |
| `--dur-emerge`  | `320ms` | The launcher arriving; a sheet opening       |

| Curve           | Value                         | Character                                           |
| --------------- | ----------------------------- | --------------------------------------------------- |
| `--ease-travel` | `cubic-bezier(.32,.72,0,1)`   | The workhorse. Fast out, long settle, no overshoot. |
| `--ease-emerge` | `cubic-bezier(.16,1,.3,1)`    | Arrival. Decisive start, very long tail.            |
| `--ease-recede` | `cubic-bezier(.7,0,.84,0)`    | Departure. Slow start, accelerating away.           |
| `--ease-settle` | `cubic-bezier(.34,1.4,.64,1)` | The only curve permitted to overshoot.              |

**Asymmetry is the point.** Arrival and departure use different curves.
Things enter decisively and settle; they leave by accelerating out of frame.
Using one curve for both is the single most common way to make an interface
feel cheap, because nothing in the physical world enters and exits the same
way.

**`--ease-settle` may only be applied to `scale`.** Overshoot on position
reads as sloppy; overshoot on opacity is incoherent; overshoot on scale reads
as physical mass. That restriction is what keeps the one springy curve in the
system from leaking into everything.

### The choreography

Asyar's motion language is fully specified below. Two of these behaviours are
built today and two are not; the status is marked on each, because a
specification that quietly describes unbuilt behaviour is worse than no
specification. The unbuilt two are the design's outstanding debt, not its
aspiration — they are specified precisely enough to implement directly.

**Pressing.** _(shipped)_ `.pressable` scales to `0.97` over `--dur-instant`.
This is the one place scale is used for feedback rather than for arrival, and
it is deliberately small enough to be felt more than seen.

**Results changing under a query.** _(shipped)_ The list does not animate. It
cannot: the user types faster than any entrance animation, and a staggered
reveal on every keystroke is nauseating. Rows swap instantly, which is why
`.list-row` carries `transition: none` — an explicit decision, not an omission.

**Reduced motion.** _(shipped)_ Under `prefers-reduced-motion: reduce`, all
durations collapse to 1ms globally and transforms are dropped outright.
Durations collapse rather than zeroing so `transitionend` still fires for the
components that sequence off it. This is safe by construction: every state in
Asyar is distinguishable with all motion removed. If a state is only legible
through its animation, that is a bug in the state, not in the motion.

**Summoning.** _(specified — not yet built)_ The launcher should not slide in
from anywhere; it has no origin, because it was not anywhere before. It should
resolve: opacity `0 → 1` over `--dur-emerge` with `--ease-emerge`, and scale
`0.96 → 1` on the same timing with `--ease-settle`, with the backdrop blur
ramping alongside. The intended read is of an image coming into focus rather
than an object arriving — which is precisely the difference between a launcher
and a window. Dismissal reverses it at `--dur-quick` with `--ease-recede`,
scaling to `0.98`: leaving is roughly twice as fast as arriving, because an
instrument you put down should be gone before you have finished the thought.

Today the window simply appears. The tokens exist; the animation does not.

**The selection travelling.** _(specified — not yet built)_ This is the motion
the user sees most, so it deserves the most care. The Bloom should not fade out
of one row and into the next — it should _move_, over `--dur-travel` with
`--ease-travel`, so the eye can follow one lit thing rather than re-find it.
Held arrow keys should shorten to `--dur-instant`, because at repeat rate a
travel animation lags the input and the selection appears to trail the
keyboard, which feels like the app is thinking. It is not thinking.

Today the Bloom is painted per-row, so selection snaps. Building this means
lifting the highlight out of `ListItem` into a single translating element
owned by the list — non-trivial against a virtualised list, which is why it is
recorded here rather than half-done.

---

## 6. Component blueprints

Three components carry the language. Asyar's anatomy differs from a
phone-style launcher, so the canonical trio maps as follows: the **Command
Line** is the global search bar and command palette; the **Action Rail** is
Asyar's adaptive dock — context-sensitive, bottom-anchored, and driven by
selection rather than by pinning; and the **Glance Chip** is the contextual
widget surface.

---

### 6.1 The Command Line

`components/layout/SearchHeader.svelte`

The only thing in the product the user authored. It is therefore the largest,
highest-contrast text on screen, and the only place tracking is pulled tight.

**Anatomy**, left to right:

```
┌──────────────────────────────────────────────────────────────────┐
│  [←]  [context chip]  query text▏   [arg chips]      [Tab hint]  │
└──────────────────────────────────────────────────────────────────┘
   ↑         ↑              ↑              ↑                ↑
  back    the mode       the query     inline args     what's next
  (⎋)     you're in     20px/500      trails the       Principle III
                        the lit thing  text by 12px
```

**Structural logic.**

- **The query is level 0 in the type hierarchy and nothing else may match it.**
  20px (`--font-size-2xl`), weight 500, `--tracking-tight`. Weight dropped
  from 600 in this revision: at 20px, Satoshi at 600 reads as a heading, and
  the field is not a heading — it is editable text and must look editable.
- **The caret is the accent.** It is the only element in the UI that moves on
  its own, which makes it the one lit thing whenever the user is typing.
  Principle I resolves the moment focus lands here.
- **The field has no box.** No border, no background, no focus ring. The
  header _is_ the field; drawing a box inside it would be chrome that has not
  earned its pixels. This is why the global focus ring explicitly stands aside
  for `input`.
- **The header is the window's drag handle.** The window is undecorated, so
  there is no title bar. The drag controller ignores presses landing on the
  input or a button and only engages after a few pixels of travel, so
  click-to-focus still works.
- **Argument chips trail the typed text by exactly 12px**, measured off a
  hidden mirror span. The mirror's font-size, weight and tracking must stay in
  lockstep with the field — a mismatch does not look wrong, it silently puts
  the chips at the wrong x.

**Rejected alternatives.** A bordered search box (chrome that isn't
load-bearing). A magnifying-glass icon (the entire window is the search).
A placeholder that animates through suggestions (motion that reports nothing).

---

### 6.2 The Action Rail

`components/layout/BottomActionBar.svelte`

Asyar's dock. It is adaptive in the only sense that matters for an instrument:
its contents are a function of what is currently selected, not of what the
user pinned there six months ago.

**Anatomy:**

```
┌──────────────────────────────────────────────────────────────────┐
│ [glance chip]              [feedback slot]   Open ⏎  Actions ⌘K  │
└──────────────────────────────────────────────────────────────────┘
      ↑                            ↑              ↑         ↑
   where you are             transient state   primary   everything
   (§6.3)                    never persistent   action     else
```

**Structural logic.**

- **The primary action is stated, not guessed at.** The right slot always
  names what `⏎` will do to the current selection — "Open", "Paste", "Run".
  A launcher whose Enter key is a mystery is a launcher people stop trusting.
- **`⌘K` is the escape valve, and it is always present.** Every secondary
  action lives behind it. This is what allows the rail to stay at two items:
  it never needs to grow, because it has somewhere to grow into.
- **Fixed height, `--shell-footer-h`.** The rail never reflows. Content
  changes; geometry does not. A bar that changes height as you arrow through
  results makes the whole window feel unstable.
- **The feedback slot is transient by contract.** Nothing persistent renders
  there. It is for the argument-validation error that clears itself as soon as
  the value parses — state not worth keeping in history.
- **Every item carries its chip.** Principle III is not negotiable here; this
  is the surface where users learn the keyboard.

**Rejected alternatives.** User-pinned favourites (a launcher's job is to
make pinning unnecessary). Icons without labels (unlabelled icons are a
memory test). A rail that grows with available actions (`⌘K` exists).

---

### 6.3 The Glance Chip

`components/layout/InformationPanel.svelte`

Asyar's contextual widget. It answers one question — _where am I?_ — and it
answers it in one line.

**Anatomy:** an accent-filled icon tile, the extension name, and an optional
subtitle the active view publishes.

**Structural logic.**

- **A glance is a sentence fragment, not a dashboard.** It occupies the left
  slot of the rail and never wraps, never scrolls, never takes interaction.
  If a piece of context needs two lines, it is not a glance and belongs in
  the result list.
- **The icon tile is the one place a saturated fill appears in the chrome**,
  and it uses `--accent-primary-fill` with `--text-on-accent` precisely
  because it carries a glyph on top of colour.
- **It exists only inside an extension view.** In the root search state there
  is no "where" to report, so it renders nothing rather than rendering a
  placeholder. Chrome that says "no context" is chrome that has not earned its
  pixels.
- **The subtitle is owned by the view, not the shell.** `viewManager`
  publishes it; the chip renders whatever it is handed and never invents copy.

**Rejected alternatives.** A breadcrumb trail (Asyar is one level deep by
design). A persistent stats strip (nothing in a 2-second interaction is worth
a permanent widget). Multiple simultaneous glances (Principle I).

---

### 6.4 The blueprint in production code

The Bloom, written the way it actually ships. This is `ListItem.svelte`'s
selected state — the single most-seen element in the product.

```css
/* ── The Bloom ──────────────────────────────────────────────────────────
   The selected row is the one lit thing on screen (Principle I), so it is
   lit rather than boxed. Two stacked gradients: a hard accent seam at the
   left edge where the beam lands, and a wash falling off across the row.  */

.list-row {
  /* Geometry comes off the scale; nothing here is a raw pixel. */
  display: flex;
  align-items: center;
  gap: var(--space-5); /* 12px */
  padding: var(--space-5) var(--space-6); /* 12px / 16px */
  border-radius: var(--radius-xl); /* 12px */
  margin-bottom: var(--space-0-5); /* 2px  */

  position: relative;
  overflow: hidden; /* clips the gradient to the corner radius */
  flex-shrink: 0;
  cursor: default;
  user-select: none;

  /* No transition. Rows swap instantly under a query — only the Bloom
     travels, and it is the container that animates, not the row. */
  transition: none;
}

.list-row.selected {
  background:
    /* Layer 1 — the wash, brightest at the left, gone by 68%. */
    linear-gradient(
      to right,
      var(--bg-selected),
      color-mix(in srgb, var(--bg-selected) 35%, transparent) 68%,
      transparent
    ),
    /* Layer 2 — the seam. The voice ramp, because it carries no text. */
    linear-gradient(to right, var(--accent-primary) 0 2px, transparent 2px);

  /* The Rim. One source, directly above — no horizontal offset, ever. */
  box-shadow: inset 0 1px 0 0 var(--rim-light);
}

/* Selection promotes the whole row's type one tier: the lit thing is fully
   legible, and its metadata stops being incidental. */
.list-row.selected * {
  color: var(--text-primary);
}
.list-row.selected .text-caption {
  color: var(--text-secondary);
}
```

Note what is absent, because the absences are the design:

- **No border.** The seam is the edge (Signature 2).
- **No horizontal shadow offset.** There is one light source (Signature 1).
- **No hardcoded colour, pixel, or z-index.** `check:design` rejects all
  three, in CI.
- **No `transition` on the row.** Motion reports; a row that is being replaced
  has nothing to report (Principle IV).

---

## 7. What this specification does not cover

Stated plainly, so nobody mistakes silence for permission.

- **Extension-authored view content.** Extensions receive every token and are
  bound by the colour and spacing rules, but Asyar does not dictate their
  layout. See [`extension-types/theme.md`](../extension-types/theme.md).
- **Iconography.** The built-in icon set is documented in
  [`icons.md`](./icons.md) and is stylistically settled; a formal icon grid
  and stroke specification is not yet written.
- **The marketing site.** It shares the palette and the wordmark and is
  otherwise free — a website is a place, and this document is about an
  instrument.
- **Sound.** Asyar makes none. If that ever changes, it needs its own section
  here first.
- **Latency budgets.** The thesis is "answers before you finish asking", and
  nothing here states what that means in milliseconds — no keystroke-to-paint
  target, no debounce doctrine, no rule for what occupies the list while a slow
  source resolves. For an instrument, responsiveness _is_ the design, so this is
  a genuine hole rather than a deferral.
- **Writing and voice, in full.** §2 sets the register and the fixed
  terminology; a complete error taxonomy, a capitalisation reference for every
  surface, and localisation guidance are not written yet.

### Outstanding against this specification

The language is defined in full; the implementation is not yet complete
against it. Known gaps, in the order they are worth closing:

1. **`StatusDot` carries state by colour alone** (§4) — a bare coloured circle
   at 8 call sites, with no label, shape, or aria. The clearest violation of the
   rule above, and the first thing to fix.
2. **The travelling Bloom** (§5) — selection currently snaps between rows.
3. **Summon and dismiss choreography** (§5) — the window appears and
   disappears without transition.
4. **Per-view retrofit** — the token layer re-skins all 188 components, but
   individual views have not been re-composed against Principles I and II.
   Expect surfaces that are still boxed where they should be lit.
5. **A formal icon grid** — stroke weight, optical sizing, and corner
   treatment are consistent by habit rather than by specification.

---

## 8. Enforcement

A design language that is only a document decays within two release cycles.
Asyar's is executable.

| Mechanism                         | Enforces                                                                                                                                                                                  |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check:design`               | Tokens only: no hardcoded colours, raw pixels, bare z-indexes, Tailwind palette classes, voice tokens used as fills, spacing tokens used as dimensions, or new uses of a deprecated token |
| `themePalettes.test.ts`           | The two copies of each palette agree; every fill carries `--text-on-accent` at ≥4.5:1                                                                                                     |
| `themeVariables.test.ts`          | Spacing, size, type, tracking and easing stay design-system-owned and un-overridable by themes                                                                                            |
| `.agents/skills/design-language/` | What an agent loads before touching any UI                                                                                                                                                |

The mechanical half cannot be forgotten, so the human half gets to be about
judgement. That division is the reason this system will still be intact in
two years.

---

_Directed Light v1.0 — one source, above, lighting one thing._
