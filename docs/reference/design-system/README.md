# Design System

Asyar's design language is **Measure**: every value in the product is derived
from a constraint — a window dimension, a contrast ratio, a scale step, a count
of rows that must fit — rather than chosen because it looked right.

The launcher exposes its full token set and built-in icons to extensions, so
an extension can look native across light/dark mode and theme changes without
shipping any colour of its own.

## Start here

- **[Design Language](./design-language.md)** — the specification. The thesis,
  the four principles, the three signatures, the chromatic system, the motion
  physics, and blueprints for the three components that carry the language.
  Read this once, properly.

The four principles, in priority order:

1. **Derived, Not Chosen** — every value traces to a measurement or a scale
   step.
2. **Subtract First** — remove it and look; if nothing is lost, it was
   decoration.
3. **One Candidate** — exactly one element is the thing `⏎` will act on.
4. **Every Affordance Names Its Key** — if it can be done, its key is visible.

## Pages in this section

- **[Tokens](./tokens.md)** — CSS custom properties: backgrounds, text,
  accents (both ramps), edges, spacing, motion, code colour, with dark-mode
  values.
- **[Components](./components.md)** — Every launcher component, grouped by what
  you would be building when you reach for it.
- **[Icons](./icons.md)** — Visual reference of all built-in icons, grouped by
  purpose, with usage in manifests and inside iframe views.

## The rules

The reference pages say **what exists**. The design language says **why**. The
skill file says **what to use where** — which font, which colour ramp, which
typography class, which component, and how the launcher, settings and
onboarding surfaces differ:

- **[`.agents/skills/design-language/SKILL.md`](../../../.agents/skills/design-language/SKILL.md)**

That file is the single source of truth for day-to-day UI decisions, and it is
what AI coding agents load before touching frontend code.

## Enforcement

A design language that is only a document decays within two release cycles.
Asyar's is executable:

| Mechanism                | Enforces                                                                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm check:design`      | Tokens only — no hardcoded colours, raw pixels, bare z-indexes, Tailwind palette classes, voice tokens used as fills, spacing tokens used as dimensions, or new uses of a deprecated token |
| `themePalettes.test.ts`  | The two copies of each palette agree; every accent fill carries `--text-on-accent` at ≥ 4.5:1                                                                                              |
| `themeVariables.test.ts` | Spacing, size, type, tracking and easing stay design-system-owned and cannot be overridden by a theme                                                                                      |

```bash
pnpm check:design
```

Genuine exceptions are marked in place with a `design-ok: <reason>` comment —
a reason is required, and a bare `design-ok` does not suppress.
