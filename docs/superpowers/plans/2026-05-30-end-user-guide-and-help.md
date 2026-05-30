# End-User Guide & In-App Help — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish an end-user manual under `/docs/guide/` (auto-rendered by asyar.org) and add a Tier 1 `help` built-in feature that surfaces a keyboard cheat-sheet, a searchable feature list, and an "Open User Guide" link.

**Architecture:** Two workstreams. (A) **Docs** — pure markdown; the website already publishes everything under `/docs/**`, so the only structural work is reframing the docs landing into a two-track fork (Using Asyar / Building Extensions) and scaffolding the `guide/` tree. (B) **Help feature** — a standard Tier 1 built-in (`src/built-in-features/help/`) following the `clipboard-history`/`quit` pattern: auto-discovered via Vite glob, `export default new HelpExtension()`, opens a view via `navigateToView`, opens URLs via `@tauri-apps/plugin-opener`. The cheat-sheet renders from a new co-located shortcut **catalog** so it cannot silently drift from the real bindings.

**Tech Stack:** SvelteKit + Svelte 5 runes, TypeScript, Tauri 2 (`@tauri-apps/plugin-opener`), Vitest, asyar-sdk contracts. Package manager: pnpm. Markdown for docs.

**Conventions honored:** actions live in the action panel (⌘K), key hints in the bottom bar (no in-view buttons); single Esc/Backspace pops the view; built-in features may pin to top; `export default new XxxExtension()` with `executeCommand`; no backward-compat shims (Beta).

**Deferred (NOT in this plan):** writing the full prose body of each guide page, and supplying the actual screenshot files. This plan creates the fork, the landing pages (complete), the per-page **skeletons** (real headings), and **image placeholders** at every screenshot slot. Filling skeletons with prose and dropping the real PNGs into `docs/guide/images/` is a separate content pass tracked outside this plan.

**Image-placeholder convention** (used in Tasks 2–3): every screenshot slot is written as a real, descriptive future path + alt text + caption + a greppable marker, so the page renders the moment the file is added and every unfilled slot is findable:

```
![<descriptive alt text>](<relative>/images/<descriptive-name>.png)
*Figure: <one line describing what the shot should show>.*
<!-- image-todo: <descriptive-name>.png — <what to capture> -->
```

`<relative>` is `.` for top-level guide pages (e.g. `getting-started.md`) and `..` for pages inside `features/`. Find all unfilled slots later with: `grep -rn "image-todo" docs/guide`.

**Two open items confirmed as assumptions (verify in Task 0):**
- Live guide URL pattern = `https://asyar.org/docs/guide/<slug>` (mirrors the `/docs/` folder). Single source const `GUIDE_BASE_URL`; change one line if wrong.
- The keyboard bindings in `src/lib/keyboard/launcherKeyboard.ts` are inline handler functions with **no** data accessor — so we create a co-located catalog rather than refactor the handlers.

All commands run from `/Users/khoshbin/develop/Asyar-Project/asyar-launcher` unless noted.

---

## File Structure

**Workstream A — Docs (repo root `/docs/`):**
- Modify: `docs/README.md` — reframe into the two-track fork.
- Create: `docs/guide/README.md` — "Using Asyar" landing + page map + per-page template.
- Create: `docs/guide/getting-started.md`, `the-basics.md`, `keyboard-shortcuts.md`, `settings.md`, `sync-and-backup.md`, `troubleshooting.md`, `faq.md` — skeletons.
- Create: `docs/guide/features/README.md` + one skeleton per feature (`calculator.md`, `clipboard-history.md`, `snippets.md`, `window-management.md`, `aliases-and-shortcuts.md`, `portals.md`, `scripts.md`, `ai-and-agents.md`, `mcp.md`, `browser-integration.md`, `extensions.md`).
- Create: `docs/guide/images/README.md` — explains the image-placeholder convention (the folder will hold the real PNGs the user adds later).

**Workstream B — Help feature (`asyar-launcher/src/`):**
- Create: `src/lib/keyboard/shortcutCatalog.ts` — `ShortcutEntry` type + `LAUNCHER_SHORTCUTS` array.
- Create: `src/lib/keyboard/shortcutCatalog.test.ts`.
- Create: `src/built-in-features/help/topics.ts` — `HelpTopic` type, `HELP_TOPICS`, `GUIDE_BASE_URL`, `guideUrl()`, `filterTopics()`.
- Create: `src/built-in-features/help/topics.test.ts`.
- Create: `src/built-in-features/help/helpState.svelte.ts` — reactive view state.
- Create: `src/built-in-features/help/manifest.json`.
- Create: `src/built-in-features/help/index.ts` — `HelpExtension`.
- Create: `src/built-in-features/help/index.test.ts`.
- Create: `src/built-in-features/help/DefaultView.svelte`.

---

## Task 0: Verify the two assumptions

**Files:** none (investigation only).

- [ ] **Step 1: Confirm the live guide URL pattern**

Open the existing dev docs in a browser via asyar.org and check how a known page renders, e.g. try both:
- `https://asyar.org/docs/reference/manifest`
- `https://asyar.org/docs/reference/manifest.md`

Note which resolves and whether `/docs/` is in the path. If the pattern is NOT `https://asyar.org/docs/<path-without-extension>`, record the real base. This is the only value used by the in-app links (`GUIDE_BASE_URL` in Task 6).

- [ ] **Step 2: Confirm no binding accessor exists**

Run: `grep -nE "export (const|function).*[Ss]hortcut|BINDINGS|KEYMAP" src/lib/keyboard/launcherKeyboard.ts`
Expected: no structured catalog export (only the handler functions). Confirms Task 4 creates a new catalog rather than reusing one.

- [ ] **Step 3: Record findings**

If the URL base differs from `https://asyar.org/docs/guide`, write the correct base in the margin of Task 6 Step 3 before implementing.

---

## Workstream A — Docs

> Markdown has no test harness. Each task is create/modify + a render/lint verification. If the repo has a markdown linter (`grep -rl markdownlint package.json .markdownlint*`), run it; otherwise verification is "links resolve and headings are well-formed."

### Task 1: Reframe the docs landing into a two-track fork

**Files:**
- Modify: `docs/README.md` (full rewrite)

- [ ] **Step 1: Replace `docs/README.md` with the two-track fork**

```markdown
# Asyar Documentation

Asyar has two kinds of readers. Pick your track:

## 📘 Using Asyar

You installed Asyar and want to get the most out of it. Start here.

**→ [User Guide](./guide/)** — Getting started, every built-in feature, keyboard
shortcuts, settings, syncing, and troubleshooting.

## 🛠 Building Extensions

You want to extend Asyar or contribute to it. These docs follow the
[Diátaxis framework](https://diataxis.fr/): four quadrants, each serving a
distinct reader need.

- **[Tutorials](./tutorials/)** — Learn by building. Start here if you've never written an Asyar extension before.
- **[How-to guides](./how-to/)** — Solve specific problems. Short, goal-oriented recipes for tasks like publishing, debugging, and best practices.
- **[Reference](./reference/)** — Look things up. Manifest schema, SDK services, CLI commands, permissions, design tokens, and icons.
- **[Explanation](./explanation/)** — Understand how it works. The two-tier model, IPC bridge, extension lifecycle, and launcher internals.

## For the launcher's project README, see [../README.md](../README.md).
```

- [ ] **Step 2: Verify**

Run: `grep -c "User Guide\|Building Extensions" docs/README.md`
Expected: `2` (both tracks present). Confirm the four dev-doc links are unchanged.

- [ ] **Step 3: Commit**

```bash
git add docs/README.md
git commit -m "docs: fork the docs landing into user vs developer tracks"
```

### Task 2: Create the user-guide landing + page template

**Files:**
- Create: `docs/guide/README.md`

- [ ] **Step 1: Write `docs/guide/README.md`**

```markdown
# Using Asyar

Asyar is a keyboard-first launcher: press your global hotkey, start typing, and
act — without touching the mouse. This guide walks you through everything Asyar
can do.

## Start here

1. **[Getting Started](./getting-started.md)** — Install Asyar, finish the first-run setup, and run your first search.
2. **[The Basics](./the-basics.md)** — How search, results, navigation, and the action panel work. The mental model behind everything else.

## Features

See **[Features](./features/)** for a guide to each built-in: Calculator,
Clipboard History, Snippets, Window Management, Aliases & Shortcuts, Portals,
Scripts, AI & Agents, MCP, Browser Integration, and the Extension Store.

## Reference & help

- **[Keyboard Shortcuts](./keyboard-shortcuts.md)** — Every shortcut in one place.
- **[Settings](./settings.md)** — A tour of every settings tab.
- **[Sync & Backup](./sync-and-backup.md)** — Your account, cloud sync, encryption, and backups.
- **[Troubleshooting](./troubleshooting.md)** — Fixes for the most common problems.
- **[FAQ](./faq.md)** — Quick answers.

---

### Page template (for contributors writing this guide)

Every guide page follows the same shape so the manual reads consistently:

    # <Feature / Topic>

    > One-sentence summary of what this does for the user.

    ![<hero alt text>](./images/<name>.png)
    *Figure: <what the hero shot shows>.*
    <!-- image-todo: <name>.png — <what to capture> -->

    ## What it does
    ## How to use it      (numbered, keyboard-first steps; add inline image slots where a step is easier shown than told)
    ## Shortcuts & actions (the action-panel actions and any key hints)
    ## Tips
    ## Related            (links to other guide pages)

Images live in `docs/guide/images/`. Use `./images/...` from top-level pages and
`../images/...` from pages inside `features/`. Until a PNG is added, the slot
renders as a broken-image icon by design — run `grep -rn "image-todo" docs/guide`
to list every slot still to fill.
```

- [ ] **Step 2: Create the images folder README**

`docs/guide/images/README.md`:
```markdown
# Guide Images

Screenshots and figures for the user guide live here. Pages reference them by a
descriptive filename, e.g. `calculator-result.png`.

Pages ship with **image placeholders**: a real `![...](...)` reference plus an
`<!-- image-todo: ... -->` marker. To fill one, drop a PNG at the referenced path
using the exact filename in the marker — the page then renders it automatically.

Find every unfilled placeholder across the guide:

    grep -rn "image-todo" docs/guide
```

- [ ] **Step 3: Verify**

Run: `test -f docs/guide/README.md && test -f docs/guide/images/README.md && grep -q "Page template" docs/guide/README.md && echo OK`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add docs/guide/README.md docs/guide/images/README.md
git commit -m "docs: add Using Asyar guide landing, page template, and images convention"
```

### Task 3: Scaffold the guide page skeletons

**Files:** Create the 7 top-level pages + `features/README.md` + 11 feature pages, each using the template skeleton.

- [ ] **Step 1: Create the `features/` index**

`docs/guide/features/README.md`:

```markdown
# Features

A guide to every built-in feature. Each page follows the same shape: what it
does, how to use it, shortcuts, tips, and related pages.

- [Calculator](./calculator.md) — Math, unit & currency conversion, date math, inline.
- [Clipboard History](./clipboard-history.md) — Browse, filter, favorite, and paste past copies.
- [Snippets](./snippets.md) — Text expansion: type a keyword, paste the full text.
- [Window Management](./window-management.md) — Resize and arrange windows with layout presets.
- [Aliases & Shortcuts](./aliases-and-shortcuts.md) — Custom triggers and global hotkeys for any command.
- [Portals](./portals.md) — Save URLs as searchable shortcuts.
- [Scripts](./scripts.md) — Run shell scripts from watched folders.
- [AI & Agents](./ai-and-agents.md) — Ask AI, build agents, choose providers, manage threads.
- [MCP](./mcp.md) — Connect external tools to your agents.
- [Browser Integration](./browser-integration.md) — Search bookmarks, history, and tabs.
- [Extensions](./extensions.md) — Browse, install, and manage extensions from the store.
```

- [ ] **Step 2: Create each top-level skeleton page**

For each file below, write the heading skeleton from the template. Use the title and the one-line summary given; leave the four section headings (`## What it does`, `## How to use it`, `## Shortcuts & actions`, `## Tips`, `## Related`) as empty sections for the content pass.

Each page gets a hero image slot right under its `>` summary (path `./images/...`
for these top-level pages), plus inline slots where noted. The exact filename and
marker for every page are listed in the **image manifest** at the end of this task.

`docs/guide/getting-started.md`:
```markdown
# Getting Started

> Install Asyar, finish first-run setup, and run your first search.

![The Asyar launcher open with a search query](./images/getting-started-hero.png)
*Figure: the Asyar launcher, opened with the global hotkey.*
<!-- image-todo: getting-started-hero.png — launcher open over the desktop with a query typed -->

## Install
## First-run setup (hotkey, accessibility, theme)

![The first-run onboarding, choosing a global hotkey](./images/getting-started-onboarding.png)
*Figure: the onboarding step where you pick your global hotkey.*
<!-- image-todo: getting-started-onboarding.png — onboarding "Pick hotkey" step -->

## Your global hotkey
## Your first search
## Related
```

`docs/guide/the-basics.md`:
```markdown
# The Basics

> How search, results, navigation, and the action panel fit together.

## The search bar
## Results & how they're ranked
## Navigating with the keyboard
## The action panel (⌘K)
## The AI chip and Tab
## Command arguments
## Related
```

`docs/guide/keyboard-shortcuts.md`:
```markdown
# Keyboard Shortcuts

> Every Asyar shortcut in one place. The same list appears in-app under "Help".

## Global
## In a view
## Per-feature
## Related
```

`docs/guide/settings.md`:
```markdown
# Settings

> A tour of every settings tab.

## General
## Appearance
## Shortcuts
## Applications & Extensions
## AI, MCP & Browsers
## Privacy, Scripts & Advanced
## Account, Backup & About
## Related
```

`docs/guide/sync-and-backup.md`:
```markdown
# Sync & Backup

> Your account, cloud sync, end-to-end encryption, and local backups.

## Signing in
## Cloud sync
## End-to-end encryption
## Export & import a backup
## Related
```

`docs/guide/troubleshooting.md`:
```markdown
# Troubleshooting

> Fixes for the most common problems.

## The hotkey doesn't open Asyar
## Asyar can't see my apps / accessibility
## Search feels slow
## AI isn't responding
## Browser bookmarks/history aren't showing
## Related
```

`docs/guide/faq.md`:
```markdown
# FAQ

> Quick answers to common questions.

## Is Asyar free?
## Does Asyar work offline?
## Where is my data stored?
## How do I get more extensions?
## Related
```

- [ ] **Step 3: Create each feature skeleton page**

For each of the 11 feature files, write the template skeleton with the title and
summary from the `features/README.md` list above, plus **one hero image slot**
(path `../images/...` because these pages live in `features/`). Example for
`docs/guide/features/calculator.md`:

```markdown
# Calculator

> Do math, unit conversion, currency conversion, and date math right from the search bar.

![A calculator result shown inline in the search bar](../images/feature-calculator-hero.png)
*Figure: type a sum and the answer appears inline, ready to copy.*
<!-- image-todo: feature-calculator-hero.png — search bar showing an inline calculator result -->

## What it does
## How to use it
## Shortcuts & actions
## Tips
## Related
```

Repeat for the other 10 feature pages — same five section headings, each with its
own `# Title`, `>` summary line from the index list, and its own hero image slot
using the filename from the image manifest below.

- [ ] **Step 3a: Image manifest (one hero slot per page)**

Use exactly these filenames/markers so the later content pass and the
`grep -rn "image-todo"` workflow are predictable. Top-level pages use
`./images/`; feature pages use `../images/`.

| Page | Hero image filename | image-todo capture note |
|------|--------------------|--------------------------|
| `getting-started.md` | `getting-started-hero.png` (+ `getting-started-onboarding.png`) | launcher open; onboarding hotkey step |
| `the-basics.md` | `the-basics-results.png` | results list with the action bar visible |
| `keyboard-shortcuts.md` | `keyboard-shortcuts-help.png` | the in-app Help view cheat sheet |
| `settings.md` | `settings-general.png` | the General settings tab |
| `sync-and-backup.md` | `sync-account-tab.png` | the Account settings tab |
| `troubleshooting.md` | _(none — text only)_ | — |
| `faq.md` | _(none — text only)_ | — |
| `features/calculator.md` | `feature-calculator-hero.png` | inline calculator result |
| `features/clipboard-history.md` | `feature-clipboard-hero.png` | clipboard list with type filter |
| `features/snippets.md` | `feature-snippets-hero.png` | snippets list view |
| `features/window-management.md` | `feature-window-management-hero.png` | layout presets list |
| `features/aliases-and-shortcuts.md` | `feature-aliases-shortcuts-hero.png` | Applications tab assigning a shortcut/alias |
| `features/portals.md` | `feature-portals-hero.png` | a portal result in search |
| `features/scripts.md` | `feature-scripts-hero.png` | Scripts settings tab with watched folders |
| `features/ai-and-agents.md` | `feature-ai-agents-hero.png` | agent chat view streaming a reply |
| `features/mcp.md` | `feature-mcp-hero.png` | Manage MCP Servers view |
| `features/browser-integration.md` | `feature-browser-hero.png` | bookmark/tab results in search |
| `features/extensions.md` | `feature-extensions-hero.png` | the Extension Store view |

- [ ] **Step 4: Verify the tree**

Run:
```bash
find docs/guide -name "*.md" | sort && echo "---" && find docs/guide -name "*.md" | wc -l
```
Expected: 21 files (1 guide README + 7 top-level + 1 features README + 11 feature pages + 1 images README from Task 2).

Also confirm every hero slot is present:
```bash
grep -rc "image-todo" docs/guide | grep -v ":0$"
```
Expected: a marker count for every page except `troubleshooting.md` and `faq.md` (text-only).

- [ ] **Step 5: Verify no broken intra-guide links**

Run:
```bash
grep -rhoE "\]\(\.[^)]+\)" docs/guide | sed -E 's/.*\((\.[^)]+)\).*/\1/' | sort -u
```
Manually confirm each relative target exists under `docs/guide/`.

- [ ] **Step 6: Commit**

```bash
git add docs/guide
git commit -m "docs: scaffold the Using Asyar guide pages"
```

---

## Workstream B — Help feature

### Task 4: Keyboard shortcut catalog (cheat-sheet source of truth)

**Files:**
- Create: `src/lib/keyboard/shortcutCatalog.ts`
- Test: `src/lib/keyboard/shortcutCatalog.test.ts`

- [ ] **Step 1: Write the failing test**

`src/lib/keyboard/shortcutCatalog.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { LAUNCHER_SHORTCUTS, type ShortcutEntry } from './shortcutCatalog';

describe('LAUNCHER_SHORTCUTS', () => {
  it('is a non-empty list', () => {
    expect(LAUNCHER_SHORTCUTS.length).toBeGreaterThan(0);
  });

  it('every entry has display keys, a label, and a valid scope', () => {
    const scopes = new Set(['global', 'view', 'context']);
    for (const entry of LAUNCHER_SHORTCUTS as readonly ShortcutEntry[]) {
      expect(Array.isArray(entry.keys)).toBe(true);
      expect(entry.keys.length).toBeGreaterThan(0);
      expect(entry.label.length).toBeGreaterThan(0);
      expect(scopes.has(entry.scope)).toBe(true);
    }
  });

  it('documents the core launcher shortcuts', () => {
    const labels = LAUNCHER_SHORTCUTS.map((s) => s.label.toLowerCase()).join(' | ');
    expect(labels).toContain('action panel');
    expect(labels).toContain('settings');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test:run src/lib/keyboard/shortcutCatalog.test.ts`
Expected: FAIL — cannot resolve `./shortcutCatalog`.

- [ ] **Step 3: Write the catalog**

`src/lib/keyboard/shortcutCatalog.ts`:
```typescript
/**
 * Human-readable catalog of launcher-global keyboard shortcuts.
 *
 * SOURCE OF TRUTH for the in-app Help cheat sheet and the user guide. The
 * *behavior* of these shortcuts lives in the handler functions in
 * `launcherKeyboard.ts`; this catalog is the *documentation* of them. When you
 * add or change a global binding there, update this list so the cheat sheet and
 * the guide stay in sync. The shortcutCatalog.test.ts guard checks the shape.
 *
 * The global show/hide hotkey is user-configurable (Settings → Shortcuts) and
 * is rendered separately by the Help view, so it is intentionally not listed
 * here. ⌘Q is intentionally omitted — Asyar blocks it; users quit via the
 * "Quit Asyar" command.
 */
export interface ShortcutEntry {
  /** Display tokens, rendered as individual keycaps, e.g. ['⌘', 'K']. */
  keys: string[];
  /** What the shortcut does, in plain language. */
  label: string;
  /** Where it applies. */
  scope: 'global' | 'view' | 'context';
}

export const LAUNCHER_SHORTCUTS: readonly ShortcutEntry[] = [
  { keys: ['⌘', ','], label: 'Open Settings', scope: 'global' },
  { keys: ['⌘', 'K'], label: 'Toggle the action panel', scope: 'global' },
  { keys: ['⌘', 'P'], label: 'Toggle the search-bar dropdown (when one is shown)', scope: 'global' },
  { keys: ['Tab'], label: 'Fill command arguments, or switch to AI / context mode', scope: 'global' },
  { keys: ['↑', '↓'], label: 'Move between results', scope: 'global' },
  { keys: ['Enter'], label: 'Run the selected result', scope: 'global' },
  { keys: ['Esc'], label: 'Clear the search, go back, then hide Asyar', scope: 'global' },
  { keys: ['⌫'], label: 'Go back from a view, or exit AI mode when the search is empty', scope: 'view' },
] as const;
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `pnpm test:run src/lib/keyboard/shortcutCatalog.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/keyboard/shortcutCatalog.ts src/lib/keyboard/shortcutCatalog.test.ts
git commit -m "feat: add launcher keyboard shortcut catalog for the help cheat sheet"
```

### Task 5: Help topics catalog + filter

**Files:**
- Create: `src/built-in-features/help/topics.ts`
- Test: `src/built-in-features/help/topics.test.ts`

- [ ] **Step 1: Write the failing test**

`src/built-in-features/help/topics.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { HELP_TOPICS, GUIDE_BASE_URL, guideUrl, filterTopics } from './topics';

describe('help topics', () => {
  it('has a topic per built-in plus the two intro pages', () => {
    const ids = HELP_TOPICS.map((t) => t.id);
    expect(ids).toContain('getting-started');
    expect(ids).toContain('the-basics');
    expect(ids).toContain('calculator');
    expect(ids).toContain('ai-and-agents');
    // every topic is fully formed
    for (const t of HELP_TOPICS) {
      expect(t.title.length).toBeGreaterThan(0);
      expect(t.icon.startsWith('icon:')).toBe(true);
      expect(t.slug.length).toBeGreaterThan(0);
    }
  });

  it('builds an absolute guide URL from a slug', () => {
    expect(guideUrl('features/calculator')).toBe(`${GUIDE_BASE_URL}/features/calculator`);
  });

  it('filters topics case-insensitively by title and subtitle', () => {
    expect(filterTopics(HELP_TOPICS, 'clip').map((t) => t.id)).toContain('clipboard-history');
    expect(filterTopics(HELP_TOPICS, 'PASTE').some((t) => t.id === 'clipboard-history')).toBe(true);
  });

  it('returns all topics for an empty query', () => {
    expect(filterTopics(HELP_TOPICS, '')).toHaveLength(HELP_TOPICS.length);
    expect(filterTopics(HELP_TOPICS, '   ')).toHaveLength(HELP_TOPICS.length);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test:run src/built-in-features/help/topics.test.ts`
Expected: FAIL — cannot resolve `./topics`.

- [ ] **Step 3: Write `topics.ts`**

> If Task 0 found a different URL base, change `GUIDE_BASE_URL` here only.

```typescript
/** Maps each Help topic to its page in the user guide on asyar.org. */
export interface HelpTopic {
  id: string;
  title: string;
  subtitle: string;
  /** Built-in icon, "icon:<name>". Names must exist in asyar-sdk ICON_DATA. */
  icon: string;
  /** Path under the guide root, e.g. "features/calculator". */
  slug: string;
}

export const GUIDE_BASE_URL = 'https://asyar.org/docs/guide';

export function guideUrl(slug: string): string {
  return `${GUIDE_BASE_URL}/${slug}`;
}

export const HELP_TOPICS: readonly HelpTopic[] = [
  { id: 'getting-started', title: 'Getting Started', subtitle: 'Install, first launch, your hotkey', icon: 'icon:sparkles', slug: 'getting-started' },
  { id: 'the-basics', title: 'The Basics', subtitle: 'Search, navigation, the action panel', icon: 'icon:keyboard', slug: 'the-basics' },
  { id: 'calculator', title: 'Calculator', subtitle: 'Math, units, currency, dates', icon: 'icon:calculator', slug: 'features/calculator' },
  { id: 'clipboard-history', title: 'Clipboard History', subtitle: 'Browse, filter, favorite, paste past copies', icon: 'icon:clipboard', slug: 'features/clipboard-history' },
  { id: 'snippets', title: 'Snippets', subtitle: 'Type a keyword, paste the full text', icon: 'icon:snippets', slug: 'features/snippets' },
  { id: 'window-management', title: 'Window Management', subtitle: 'Resize and arrange windows', icon: 'icon:layers', slug: 'features/window-management' },
  { id: 'aliases-and-shortcuts', title: 'Aliases & Shortcuts', subtitle: 'Custom triggers and global hotkeys', icon: 'icon:keyboard', slug: 'features/aliases-and-shortcuts' },
  { id: 'portals', title: 'Portals', subtitle: 'Save URLs as searchable shortcuts', icon: 'icon:link', slug: 'features/portals' },
  { id: 'scripts', title: 'Scripts', subtitle: 'Run shell scripts from watched folders', icon: 'icon:terminal', slug: 'features/scripts' },
  { id: 'ai-and-agents', title: 'AI & Agents', subtitle: 'Ask AI, build agents, manage threads', icon: 'icon:sparkles', slug: 'features/ai-and-agents' },
  { id: 'mcp', title: 'MCP', subtitle: 'Connect external tools to your agents', icon: 'icon:server', slug: 'features/mcp' },
  { id: 'browser-integration', title: 'Browser Integration', subtitle: 'Search bookmarks, history, and tabs', icon: 'icon:globe', slug: 'features/browser-integration' },
  { id: 'extensions', title: 'Extensions', subtitle: 'Browse, install, and manage extensions', icon: 'icon:store', slug: 'features/extensions' },
] as const;

export function filterTopics(topics: readonly HelpTopic[], query: string): HelpTopic[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...topics];
  return topics.filter(
    (t) => t.title.toLowerCase().includes(q) || t.subtitle.toLowerCase().includes(q),
  );
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `pnpm test:run src/built-in-features/help/topics.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/built-in-features/help/topics.ts src/built-in-features/help/topics.test.ts
git commit -m "feat: add help topics catalog mapping features to guide pages"
```

### Task 6: Help view state

**Files:**
- Create: `src/built-in-features/help/helpState.svelte.ts`

> No separate test — the filtering logic is already tested in Task 5 (`filterTopics`). This file is thin reactive glue, verified via `pnpm check` and the `index.test.ts` in Task 7.

- [ ] **Step 1: Write `helpState.svelte.ts`**

```typescript
import { HELP_TOPICS, filterTopics, type HelpTopic } from './topics';

/** Reactive state for the Help view: search query + keyboard selection. */
class HelpViewState {
  query = $state('');
  selectedIndex = $state(0);

  get filtered(): HelpTopic[] {
    return filterTopics(HELP_TOPICS, this.query);
  }

  get selected(): HelpTopic | null {
    return this.filtered[this.selectedIndex] ?? null;
  }

  setSearch(query: string): void {
    this.query = query;
    this.selectedIndex = 0;
  }

  move(delta: number): void {
    const len = this.filtered.length;
    if (len === 0) return;
    this.selectedIndex = (this.selectedIndex + delta + len) % len;
  }

  reset(): void {
    this.query = '';
    this.selectedIndex = 0;
  }
}

export const helpViewState = new HelpViewState();
```

- [ ] **Step 2: Verify it type-checks**

Run: `pnpm check`
Expected: no new errors referencing `helpState.svelte.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/built-in-features/help/helpState.svelte.ts
git commit -m "feat: add reactive state for the help view"
```

### Task 7: Help manifest + extension class

**Files:**
- Create: `src/built-in-features/help/manifest.json`
- Create: `src/built-in-features/help/index.ts`
- Test: `src/built-in-features/help/index.test.ts`

- [ ] **Step 1: Write the manifest**

`src/built-in-features/help/manifest.json`:
```json
{
  "id": "help",
  "name": "Help",
  "icon": "icon:info",
  "version": "1.0.0",
  "description": "Keyboard shortcuts, feature guides, and the Asyar user manual",
  "type": "extension",
  "searchable": true,
  "commands": [
    {
      "id": "show-help",
      "name": "Help",
      "description": "View keyboard shortcuts and open the user guide",
      "trigger": "help shortcuts guide",
      "icon": "icon:info",
      "mode": "view",
      "component": "DefaultView"
    }
  ]
}
```

- [ ] **Step 2: Write the failing test**

`src/built-in-features/help/index.test.ts`:
```typescript
/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../services/log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const registerAction = vi.fn();
const unregisterAction = vi.fn();
vi.mock('../../services/action/actionService.svelte', () => ({
  actionService: { registerAction, unregisterAction, setActionExecutor: vi.fn() },
}));

const openUrl = vi.fn();
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl }));

import extension from './index';
import { helpViewState } from './helpState.svelte';
import { GUIDE_BASE_URL, guideUrl } from './topics';

function mockContext() {
  return {
    getService: vi.fn((name: string) => {
      if (name === 'log') return { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
      if (name === 'extensions') return { navigateToView: vi.fn(), setActiveViewActionLabel: vi.fn() };
      return null;
    }),
  };
}

describe('HelpExtension', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    helpViewState.reset();
    vi.spyOn(window, 'addEventListener');
    vi.spyOn(window, 'removeEventListener');
  });
  afterEach(() => vi.restoreAllMocks());

  it('opens the help view on the show-help command', async () => {
    await extension.initialize(mockContext() as any);
    const result = await extension.executeCommand('show-help');
    expect(result.type).toBe('view');
    expect(result.viewPath).toBe('help/DefaultView');
  });

  it('updates view state on search', async () => {
    await extension.initialize(mockContext() as any);
    await extension.onViewSearch('clip');
    expect(helpViewState.query).toBe('clip');
    expect(helpViewState.filtered.some((t) => t.id === 'clipboard-history')).toBe(true);
  });

  it('registers and unregisters the Open User Guide action around the view', async () => {
    await extension.initialize(mockContext() as any);
    await extension.viewActivated('help/DefaultView');
    expect(registerAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'help:open-user-guide' }),
    );
    expect(window.addEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));

    await extension.viewDeactivated('help/DefaultView');
    expect(unregisterAction).toHaveBeenCalledWith('help:open-user-guide');
    expect(window.removeEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
  });

  it('Open User Guide action opens the guide base URL', async () => {
    await extension.initialize(mockContext() as any);
    await extension.viewActivated('help/DefaultView');
    const action = registerAction.mock.calls
      .map((c) => c[0])
      .find((a) => a.id === 'help:open-user-guide');
    await action.execute();
    expect(openUrl).toHaveBeenCalledWith(GUIDE_BASE_URL);
  });

  it('opens the selected topic guide page on the primary action', async () => {
    await extension.initialize(mockContext() as any);
    await extension.viewActivated('help/DefaultView');
    helpViewState.setSearch('calc'); // selects calculator
    await extension.openSelectedTopic();
    expect(openUrl).toHaveBeenCalledWith(guideUrl('features/calculator'));
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm test:run src/built-in-features/help/index.test.ts`
Expected: FAIL — cannot resolve `./index`.

- [ ] **Step 4: Write `index.ts`**

```typescript
import type {
  Extension,
  ExtensionContext,
  IExtensionManager,
  ILogService,
  ExtensionAction,
} from 'asyar-sdk/contracts';
import { openUrl } from '@tauri-apps/plugin-opener';
import { actionService } from '../../services/action/actionService.svelte';
import { helpViewState } from './helpState.svelte';
import { GUIDE_BASE_URL, guideUrl } from './topics';
import DefaultView from './DefaultView.svelte';

const VIEW_PATH = 'help/DefaultView';
const OPEN_GUIDE_ACTION_ID = 'help:open-user-guide';

class HelpExtension implements Extension {
  onUnload = () => {};
  private logService?: ILogService;
  private extensionManager?: IExtensionManager;
  private handleKeydownBound = (e: KeyboardEvent) => this.handleKeydown(e);

  async initialize(context: ExtensionContext): Promise<void> {
    this.logService = context.getService<ILogService>('log');
    this.extensionManager = context.getService<IExtensionManager>('extensions');
  }

  async executeCommand(commandId: string): Promise<any> {
    if (commandId === 'show-help') {
      helpViewState.reset();
      this.extensionManager?.navigateToView(VIEW_PATH);
      return { type: 'view', viewPath: VIEW_PATH };
    }
    throw new Error(`Unknown command: ${commandId}`);
  }

  async onViewSearch(query: string): Promise<void> {
    helpViewState.setSearch(query);
  }

  async viewActivated(_viewPath: string): Promise<void> {
    window.addEventListener('keydown', this.handleKeydownBound);
    this.extensionManager?.setActiveViewActionLabel('Open Guide');
    this.registerViewActions();
  }

  async viewDeactivated(_viewPath: string): Promise<void> {
    window.removeEventListener('keydown', this.handleKeydownBound);
    this.extensionManager?.setActiveViewActionLabel(null);
    actionService.unregisterAction(OPEN_GUIDE_ACTION_ID);
  }

  /** Opens the guide page for the currently selected topic. */
  async openSelectedTopic(): Promise<void> {
    const topic = helpViewState.selected;
    if (topic) await openUrl(guideUrl(topic.slug));
  }

  private registerViewActions(): void {
    const openGuide: ExtensionAction = {
      id: OPEN_GUIDE_ACTION_ID,
      title: 'Open User Guide',
      description: 'Open the full Asyar user guide in your browser',
      icon: 'icon:globe',
      extensionId: 'help',
      category: 'help-action',
      execute: async () => {
        await openUrl(GUIDE_BASE_URL);
      },
    };
    actionService.registerAction(openGuide);
  }

  private handleKeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        helpViewState.move(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        helpViewState.move(-1);
        break;
      case 'Enter':
        event.preventDefault();
        void this.openSelectedTopic();
        break;
    }
  }

  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
}

export default new HelpExtension();
export { DefaultView };
```

- [ ] **Step 5: Create a minimal `DefaultView.svelte` so the import resolves**

(Full UI comes in Task 8; a stub lets `index.ts` import it and the test run.)
`src/built-in-features/help/DefaultView.svelte`:
```svelte
<script lang="ts">
  import { helpViewState } from './helpState.svelte';
</script>

<div>{helpViewState.filtered.length} topics</div>
```

- [ ] **Step 6: Run the test and watch it pass**

Run: `pnpm test:run src/built-in-features/help/index.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add src/built-in-features/help/manifest.json src/built-in-features/help/index.ts src/built-in-features/help/index.test.ts src/built-in-features/help/DefaultView.svelte
git commit -m "feat: add help built-in feature (command, view, open-guide action)"
```

### Task 8: Help view UI

**Files:**
- Modify: `src/built-in-features/help/DefaultView.svelte`

> Reference the visual conventions in the **design-language** skill before styling. Match an existing list view (e.g. `clipboard-history/DefaultView.svelte`) for spacing, selected-row highlight, and section headers. Verification is type-check + manual run (no component test harness in this repo).

- [ ] **Step 1: Replace the stub with the full view**

```svelte
<script lang="ts">
  import { helpViewState } from './helpState.svelte';
  import { LAUNCHER_SHORTCUTS } from '../../lib/keyboard/shortcutCatalog';
  import Icon from '../../components/base/Icon.svelte';
  import { getBuiltInIconName, isBuiltInIcon } from '../../lib/iconUtils';

  const shortcuts = LAUNCHER_SHORTCUTS;
</script>

<div class="help-view">
  <section class="cheat-sheet">
    <h2 class="section-title">Keyboard Shortcuts</h2>
    <ul class="shortcut-list">
      {#each shortcuts as s}
        <li class="shortcut-row">
          <span class="keys">
            {#each s.keys as k}<kbd>{k}</kbd>{/each}
          </span>
          <span class="label">{s.label}</span>
        </li>
      {/each}
    </ul>
  </section>

  <section class="topics">
    <h2 class="section-title">Feature Guides</h2>
    <ul class="topic-list">
      {#each helpViewState.filtered as topic, i}
        <li class="topic-row" class:selected={i === helpViewState.selectedIndex}>
          {#if isBuiltInIcon(topic.icon)}
            <Icon name={getBuiltInIconName(topic.icon)} />
          {/if}
          <span class="topic-text">
            <span class="topic-title">{topic.title}</span>
            <span class="topic-subtitle">{topic.subtitle}</span>
          </span>
        </li>
      {/each}
      {#if helpViewState.filtered.length === 0}
        <li class="empty">No topics match your search.</li>
      {/if}
    </ul>
  </section>
</div>

<style>
  .help-view { display: flex; flex-direction: column; gap: var(--spacing-lg, 16px); padding: var(--spacing-md, 12px); overflow-y: auto; }
  .section-title { font-size: var(--font-size-sm, 12px); text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-secondary, #888); margin: 0 0 var(--spacing-sm, 8px); }
  .shortcut-list, .topic-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .shortcut-row { display: flex; align-items: center; gap: var(--spacing-md, 12px); padding: var(--spacing-xs, 4px) var(--spacing-sm, 8px); }
  .keys { display: inline-flex; gap: 4px; min-width: 84px; }
  kbd { font-family: inherit; font-size: 11px; padding: 1px 6px; border-radius: 4px; background: var(--surface-2, #2a2a2a); border: 1px solid var(--border, #3a3a3a); }
  .label { color: var(--text-primary, #ddd); }
  .topic-row { display: flex; align-items: center; gap: var(--spacing-md, 12px); padding: var(--spacing-sm, 8px); border-radius: var(--radius-md, 8px); }
  .topic-row.selected { background: var(--surface-selected, rgba(255,255,255,0.08)); }
  .topic-text { display: flex; flex-direction: column; }
  .topic-title { color: var(--text-primary, #eee); }
  .topic-subtitle { font-size: 12px; color: var(--text-secondary, #888); }
  .empty { color: var(--text-secondary, #888); padding: var(--spacing-sm, 8px); }
</style>
```

- [ ] **Step 2: Type-check**

Run: `pnpm check`
Expected: no errors in `help/`. (If `Icon.svelte`'s prop name differs, match its real signature — open `src/components/base/Icon.svelte` and adjust the `name` prop.)

- [ ] **Step 3: Manual smoke test**

Run: `pnpm tauri dev` (or the project's run command). Open the launcher, type `help`, press Enter. Verify: the cheat sheet lists the shortcuts; the feature list renders; ↑/↓ moves the selection; Enter opens the selected feature's guide page; ⌘K shows the "Open User Guide" action which opens `asyar.org/docs/guide`.

- [ ] **Step 4: Commit**

```bash
git add src/built-in-features/help/DefaultView.svelte
git commit -m "feat: build the help view UI (cheat sheet + searchable feature guides)"
```

### Task 9: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Run the full TS/Svelte test suite**

Run: `pnpm test:run`
Expected: all tests pass, including the three new files.

- [ ] **Step 2: Type-check the whole project**

Run: `pnpm check`
Expected: no errors.

- [ ] **Step 3: Confirm the manifest-icons guard still passes**

Run: `pnpm test:run src/built-in-features/manifestIcons.test.ts`
Expected: PASS — confirms `icon:info`, `icon:globe`, `icon:keyboard`, etc. used by the help feature exist in `ICON_DATA`.

- [ ] **Step 4: Confirm the help feature is auto-discovered**

In `pnpm tauri dev`, with an empty query, confirm "Help" appears in results (searchable built-in), and that typing `shortcuts` or `guide` also surfaces it (manifest `trigger`).

- [ ] **Step 5: Final commit (if anything was adjusted)**

```bash
git add -A
git commit -m "chore: finalize end-user guide scaffold and help feature"
```

---

## Self-Review (completed)

**Spec coverage:** Part A (audience fork) → Task 1. Part B (guide IA) → Tasks 2–3. Part C (in-app Help: manifest, view, cheat sheet from source of truth, link-out, action-panel/bottom-bar conventions) → Tasks 4–8. Build sequence steps 1–6 from the spec all map to tasks. Open items → Task 0.

**Placeholder scan:** Docs skeleton headings are the intended deliverable (real content), not plan placeholders; prose-fill is explicitly deferred and tracked outside this plan. No "TBD"/"handle edge cases"/"write tests for the above" in any step — all code is shown in full.

**Type consistency:** `ShortcutEntry`/`LAUNCHER_SHORTCUTS` (Task 4) used identically in Task 8. `HelpTopic`/`HELP_TOPICS`/`filterTopics`/`guideUrl`/`GUIDE_BASE_URL` (Task 5) used identically in Tasks 6–8. `helpViewState` methods (`setSearch`, `move`, `selected`, `filtered`, `reset`) defined in Task 6 and called consistently in Tasks 7–8. `openSelectedTopic` and `OPEN_GUIDE_ACTION_ID`/`'help:open-user-guide'` consistent between Task 7 impl and test.

**Risk flagged for executor:** `Icon.svelte` prop name and `IExtensionManager.setActiveViewActionLabel` signature should be confirmed against the real contracts during Task 7–8 (both observed in `clipboard-history`, but verify). The cheat-sheet catalog documents behavior defined elsewhere (handlers in `launcherKeyboard.ts`); keep them in sync manually — the guard test only checks shape, not parity with handlers.
