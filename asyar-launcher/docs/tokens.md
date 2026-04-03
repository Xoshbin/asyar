# Asyar Design Tokens

CSS custom properties automatically injected into every extension iframe by the Asyar host. Use `var(--token-name)` in your CSS — no setup required.

**Theme changes are live.** When the user switches light/dark mode, the host re-injects updated values. Your extension adapts without a reload.

## During Development

When building outside the running app, import the static fallback file for IDE autocomplete and neutral defaults:

```typescript
import 'asyar-sdk/tokens.css';
```

Or in plain CSS:

```css
@import 'asyar-sdk/tokens.css';
```

Never hardcode colors, sizes, or radii. Using tokens ensures your extension adapts to light/dark mode and future theme changes automatically.

## Token Reference

### Backgrounds
Surfaces and container fills.

| Token | Dark default | Use for |
| :--- | :--- | :--- |
| `--bg-primary` | `rgba(30, 30, 32, 0.75)` | Main panel/window background |
| `--bg-secondary` | `rgba(40, 40, 42, 0.65)` | Cards, sidebars, secondary surfaces |
| `--bg-tertiary` | `rgba(50, 50, 52, 0.65)` | Input fields, subtle backgrounds |
| `--bg-hover` | `rgba(64, 64, 66, 0.55)` | Hover state on interactive elements |
| `--bg-selected` | `rgba(74, 74, 76, 0.6)` | Active/selected state in lists |
| `--bg-popup` | `rgb(30, 30, 32)` | Opaque popups and modals |
| `--bg-secondary-full-opacity` | `rgba(40, 40, 42)` | bg-secondary without transparency |

```css
.card   { background: var(--bg-secondary); }
.input  { background: var(--bg-tertiary); }
.item:hover    { background: var(--bg-hover); }
.item.selected { background: var(--bg-selected); }
```

### Text

| Token | Dark default | Use for |
| :--- | :--- | :--- |
| `--text-primary` | `rgba(255, 255, 255, 0.95)` | Headings, labels, primary content |
| `--text-secondary` | `rgba(235, 235, 245, 0.65)` | Subtitles, metadata, descriptions |
| `--text-tertiary` | `rgba(235, 235, 245, 0.4)` | Placeholders, hints, disabled text |

```css
h2   { color: var(--text-primary); }
p    { color: var(--text-secondary); }
::placeholder { color: var(--text-tertiary); }
```

### Borders

| Token | Dark default | Use for |
| :--- | :--- | :--- |
| `--border-color` | `rgba(90, 90, 95, 0.5)` | Borders on interactive elements (inputs, buttons) |
| `--separator` | `rgba(90, 90, 95, 0.5)` | Dividers between list items and sections |

```css
.input   { border: 1px solid var(--border-color); }
.divider { border-top: 1px solid var(--separator); }
```

### Accent

| Token | Value | Use for |
| :--- | :--- | :--- |
| `--accent-primary` | `rgb(0, 122, 255)` | Primary actions, focus rings, highlights |
| `--accent-primary-rgb` | `0, 122, 255` | When you need rgba(var(--accent-primary-rgb), 0.2) |
| `--accent-success` | `rgb(40, 205, 65)` | Success states, confirmations |
| `--accent-warning` | `rgb(255, 149, 0)` | Warnings, caution states |
| `--accent-danger` | `rgb(255, 59, 48)` | Errors, destructive actions |

```css
.button-primary { background: var(--accent-primary); }
.badge-success  { background: var(--accent-success); }
.overlay { background: rgba(var(--accent-primary-rgb), 0.15); }
```

### Brand
Asyar's teal brand color and its variants.

| Token | Value |
| :--- | :--- |
| `--asyar-brand` | `#2EC4B6` |
| `--asyar-brand-hover` | `#28B0A3` |
| `--asyar-brand-muted` | `rgba(46, 196, 182, 0.15)` |
| `--asyar-brand-subtle` | `rgba(46, 196, 182, 0.08)` |

### Shadows

| Token | Use for |
| :--- | :--- |
| `--shadow-xs` | Subtle lift on small elements |
| `--shadow-sm` | Cards, list items |
| `--shadow-md` | Dropdowns, popovers |
| `--shadow-lg` | Modals, elevated panels |
| `--shadow-xl` | Large overlays |
| `--shadow-popup` | Fixed popups and command palettes |
| `--shadow-focus` | Focus ring (0 0 0 2px var(--asyar-brand-muted)) |

```css
.card    { box-shadow: var(--shadow-sm); }
.popup   { box-shadow: var(--shadow-popup); }
.focused { box-shadow: var(--shadow-focus); }
```

### Border Radius

| Token | Value | Use for |
| :--- | :--- | :--- |
| `--radius-xs` | `4px` | Tags, badges |
| `--radius-sm` | `6px` | Buttons, inputs |
| `--radius-md` | `8px` | Cards, panels |
| `--radius-lg` | `10px` | Large containers |
| `--radius-xl` | `12px` | Modals |
| `--radius-full` | `9999px` | Pills, circular elements |

```css
.button { border-radius: var(--radius-sm); }
.card   { border-radius: var(--radius-md); }
.avatar { border-radius: var(--radius-full); }
```

### Spacing
4px base grid.

| Token | Value | Token | Value |
| :--- | :--- | :--- | :--- |
| `--space-1` | `4px` | `--space-7` | `20px` |
| `--space-2` | `6px` | `--space-8` | `24px` |
| `--space-3` | `8px` | `--space-9` | `32px` |
| `--space-4` | `10px` | `--space-10` | `40px` |
| `--space-5` | `12px` | `--space-11` | `48px` |
| `--space-6` | `16px` | | |

```css
.item    { padding: var(--space-3) var(--space-5); }
.section { gap: var(--space-6); }
```

### Font Sizes

| Token | Value | Use for |
| :--- | :--- | :--- |
| `--font-size-2xs` | `10px` | Tiny labels |
| `--font-size-xs` | `11px` | Captions, section headers |
| `--font-size-sm` | `12px` | Secondary text |
| `--font-size-md` | `13px` | UI labels |
| `--font-size-base` | `14px` | Body text |
| `--font-size-lg` | `15px` | Subtitles |
| `--font-size-xl` | `17px` | Titles |
| `--font-size-2xl` | `20px` | Section headings |
| `--font-size-3xl` | `22px` | Page headings |
| `--font-size-display` | `2.25rem` | Hero / display text |

### Font Families

| Token | Fonts | Use for |
| :--- | :--- | :--- |
| `--font-ui` | `Satoshi, system-ui, …` | All UI text |
| `--font-mono` | `JetBrains Mono, …` | Code, monospaced content |

```css
body { font-family: var(--font-ui); }
code { font-family: var(--font-mono); }
```

### Transitions

| Token | Value |
| :--- | :--- |
| `--transition-fast` | `100ms ease` |
| `--transition-normal` | `150ms ease` |
| `--transition-smooth` | `200ms cubic-bezier(0.25, 0.1, 0.25, 1)` |
| `--transition-slow` | `300ms cubic-bezier(0.25, 0.1, 0.25, 1)` |

```css
.button { transition: background var(--transition-normal); }
.panel  { transition: transform var(--transition-smooth); }
```

## Complete Example
A realistic card component using only design tokens:

```html
<div class="card">
  <div class="card-header">
    <span class="title">Item Title</span>
    <span class="badge">New</span>
  </div>
  <p class="description">Supporting description text.</p>
</div>

<style>
  .card {
    background: var(--bg-secondary);
    border: 1px solid var(--separator);
    border-radius: var(--radius-md);
    padding: var(--space-6);
    box-shadow: var(--shadow-sm);
    font-family: var(--font-ui);
    transition: box-shadow var(--transition-normal);
  }
  .card:hover { box-shadow: var(--shadow-md); }

  .card-header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
  }

  .title {
    color: var(--text-primary);
    font-size: var(--font-size-base);
  }

  .badge {
    background: var(--asyar-brand-muted);
    color: var(--asyar-brand);
    font-size: var(--font-size-xs);
    padding: 2px var(--space-2);
    border-radius: var(--radius-full);
  }

  .description {
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
  }
</style>
```
