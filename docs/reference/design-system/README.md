# Design System

Asyar exposes a set of CSS custom properties and built-in icons so extensions can look native across light/dark modes and theme changes.

## Pages in this section

- **[Tokens](./tokens.md)** — CSS custom properties: backgrounds, text, interactive, structure, spacing, code colour, with the full dark-mode default values.
- **[Components](./components.md)** — Every launcher component, grouped by what you would be building when you reach for it.
- **[Icons](./icons.md)** — Visual reference of all built-in icons, grouped by purpose, with usage in manifests and inside iframe views.

## The rules

The reference pages above say **what exists**. The design language says **what
to use where** — which font, which colour, which typography class, which
component, and how the launcher, settings and onboarding surfaces differ:

- **[`.agents/skills/design-language/SKILL.md`](../../../.agents/skills/design-language/SKILL.md)**

That file is the single source of truth for UI decisions, and it is what AI
coding agents load before touching frontend code. Its mechanical rules are
enforced by `pnpm check:design`, which runs in CI:

```bash
pnpm check:design
```

The checker fails on undefined tokens, `var()` fallbacks, hardcoded colours,
raw pixels on scaled properties, bare z-index values, missing
`.custom-scrollbar`, components missing from the barrel, and stale Svelte 4
a11y suppressions. Genuine exceptions are marked in-place with a
`design-ok: <reason>` comment.
