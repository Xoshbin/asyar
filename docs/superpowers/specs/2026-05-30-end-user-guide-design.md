# End-User Guide & In-App Help — Design

**Date:** 2026-05-30
**Status:** Design approved (structure only); content + implementation deferred to a follow-up plan.
**Author:** Brainstorming session (orchestrator)

---

## Problem

Asyar has comprehensive **developer** documentation (84 markdown files under `/docs/`,
Diátaxis structure, audience = extension authors + contributors) but **zero end-user
guidance**. The launcher ships ~14 built-in features plus a rich keyboard-first UX, none
of which is explained to the people who actually use the app.

The existing `/docs/README.md` frames the entire docs tree as *"developer documentation."*
The asyar.org website already publishes everything under `/docs/**` automatically, so any
markdown we add there goes live with no new build tooling.

> Note: this intentionally crosses the prior project note that "`docs/` is dev-only until
> further notice." That line is now being crossed on purpose.

## Goals

- A discoverable, scannable **end-user manual** published on asyar.org.
- Users and developers **split at the front door** — users never land in manifest/SDK material.
- An **in-app Help** entry point so users find guidance without leaving Asyar (keyboard-first, offline-capable for the reference, link-out for the full guide).
- Reuse existing infrastructure: the website's auto-publish of `/docs/`, and Asyar's Tier 1 built-in pattern.

## Non-Goals

- Writing the actual guide content (deferred — this session is structure only).
- A new docs-site generator (VitePress/Starlight/etc.) — not needed; the website already renders `/docs/`.
- Touching the asyar.org (Laravel) repo — it auto-consumes `/docs/`; no website code changes required here.
- Replacing or expanding the existing onboarding flow (it stays as the first-run entry point).
- Contextual "?" tooltips on every UI element (possible future follow-up, out of scope now).

---

## Decisions (locked during brainstorming)

| Question | Decision |
|----------|----------|
| Where does the guide live? | New folder under `/docs/` (auto-published by asyar.org). No new build tooling. |
| Guide structure | **Light, task-oriented** — one flat `guide/` track + a `features/` subfolder (manual style, like Raycast/Alfred). NOT a second Diátaxis tree. |
| Docs landing | **Reframe** `/docs/README.md` into a two-track fork: *Using Asyar* vs *Building Extensions*. |
| In-app help | **Yes** — add a Tier 1 `help` built-in feature (cheat sheet + feature list + "Open User Guide" link-out). |
| This session's deliverable | Plan + structure only. |

---

## Part A — Audience fork at the docs landing

Rewrite `/docs/README.md` so the front door forks by audience:

```
/docs/README.md   (rewritten)
   │
   ├── 📘  Using Asyar  ───────────▶  /docs/guide/            ← NEW (end users)
   │
   └── 🛠  Building Extensions ────▶  tutorials/ how-to/
                                       reference/ explanation/  (unchanged dev docs)
```

The four existing dev quadrants and their `README.md` section indexes are untouched. Only
the top-level landing changes, plus a one-line cross-link from the guide back to the dev
docs (for users who turn out to be developers).

## Part B — User guide information architecture

A single task-oriented track. Each folder keeps a `README.md` as its section index
(matches the existing site convention).

```
/docs/guide/
  README.md                  "Using Asyar" — landing / map of the guide
  getting-started.md         install · first launch · onboarding · global hotkey · first search
  the-basics.md              search & results · navigation (↑ ↓ Enter Esc) · action panel (⌘K) ·
                             the AI chip + Tab · command arguments   ← the core mental model
  features/
    README.md                feature index
    calculator.md
    clipboard-history.md
    snippets.md
    window-management.md
    aliases-and-shortcuts.md
    portals.md
    scripts.md
    ai-and-agents.md         Ask AI · agents · providers · threads
    mcp.md                   connecting tools to agents
    browser-integration.md   companion · bookmarks · history · tabs · pairing
    extensions.md            store: browse · install · manage · enable/disable
  keyboard-shortcuts.md      the cheat sheet (shared concept with in-app Help)
  settings.md                guided tour of the settings tabs
  sync-and-backup.md         account · cloud sync · E2EE · backup/restore
  troubleshooting.md         hotkey conflicts · permissions · slow search · AI not responding
  faq.md
```

**Rationale:** end users think in *"how do I do X,"* not in Diátaxis quadrants. A flat
guide + features folder reads like a product manual and is faster to scan than a parallel
4-quadrant tree.

**Image placeholders:** pages ship with screenshot slots, not finished images. Each slot
is a real `![alt](relative/images/<name>.png)` reference + caption + a greppable
`<!-- image-todo: ... -->` marker, with real PNGs dropped into `docs/guide/images/`
later. `grep -rn "image-todo" docs/guide` lists every unfilled slot. The page renders the
image automatically once the file exists — no markdown edits needed at fill time.

## Part C — In-app Help feature (Tier 1 built-in)

```
src/built-in-features/help/
  manifest.json     id:"help"  command "Help"  searchable
                    triggers: help, shortcuts, guide, ?
  index.svelte.ts   export default new HelpExtension()
                    executeCommand → open HelpView ; onViewSearch → filter cheat-sheet + topics
  HelpView.svelte   ┌─────────────────────────────────────────┐
                    │  ⌨  Keyboard Cheat Sheet                 │  rendered from the keyboard
                    │     ⌘K Actions · Tab AI/args · Esc back  │  binding source of truth
                    ├─────────────────────────────────────────┤
                    │  ✦  Features  (searchable list)          │  each row opens that
                    │     Calculator · Snippets · Ask AI · …    │  feature's guide page
                    ├─────────────────────────────────────────┤
                    │  Action panel (⌘K): "Open User Guide"    │  → asyar.org/guide
                    └─────────────────────────────────────────┘
```

### Architectural Impact

- **Extension Host alignment:** Tier 1 built-in, exactly like `settings`/`quit`
  (`export default new HelpExtension()` with `executeCommand`, plus `onViewSearch` for the
  searchable view). Runs in the privileged host context; no host/extension isolation crossed.
- **Opening the guide URL:** because Help is Tier 1, it opens the external URL directly via
  the host's Tauri opener (the same capability `EntitlementGate` already uses for
  asyar.org/pricing). **No `asyar:api:*` call → no Rust permission-gate work.** (The Rust gate
  in `permissions.rs::get_required_permission` only governs Tier 2 extension IPC.)
- **Cheat-sheet = single source of truth:** the cheat sheet renders from the existing
  keyboard-binding definitions, NOT a hand-copied table. Any binding added there appears in
  Help automatically — honoring "never hardcode what should be registered." (Implementation
  detail: expose the binding list as read-only data the view consumes; exact accessor to be
  determined in the plan against `src/lib/keyboard/launcherKeyboard.ts`.)
- **Contribution model:** registers declaratively via its own `manifest.json` command
  (`searchable`). No core-UI special-casing.
- **UI conventions:** actions in the action panel; key hints in the bottom bar (no in-view
  buttons); single Esc/Backspace pops the view; built-in may pin to top. Follows the
  design-language and actions-panel-over-view-buttons conventions.
- **Backward-compat hacks:** None.

### Discoverability

- Help appears in search via its command + triggers (`help`, `shortcuts`, `guide`, `?`).
- Onboarding remains the first-run entry; Help is the always-available reference.
- Optional (flag for the plan, not committed): a subtle "Press ? for help" hint in the
  empty-state / bottom bar.

---

## Build sequence (for the follow-up plan)

```
1. Rewrite /docs/README.md into the two-track fork (Using Asyar / Building Extensions)
2. Scaffold /docs/guide/ + README + getting-started + the-basics      (content TBD)
3. Fill features/*.md + settings/sync-and-backup/troubleshooting/faq   (content TBD)
4. help built-in: manifest.json → index.svelte.ts → HelpView.svelte
5. Wire the cheat sheet to the keyboard-binding source of truth
6. Cross-link: Help "Features" rows + "Open User Guide" → asyar.org/guide/*
```

Steps 1 and 4–6 are the structural/code work; steps 2–3 are content authoring that can be
parallelized per page once the skeleton exists.

## Risks / open items for the plan

- **Cheat-sheet accessor shape:** confirm how `launcherKeyboard.ts` exposes bindings and
  whether a small read-only selector is needed to feed the view without duplication.
- **Guide URL routing on asyar.org:** confirm the live URL pattern the website produces for
  `/docs/guide/*` so in-app links point correctly (e.g. `asyar.org/docs/guide/...` vs
  `asyar.org/guide/...`).
- **Content scope per page:** define a per-page template (what · why · steps · shortcuts ·
  related) so the content pass is consistent.

## Out of scope (explicit)

Website (Laravel) code changes, a new static-site generator, onboarding redesign,
per-element contextual tooltips, and writing the guide prose in this session.
