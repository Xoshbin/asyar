# Local-First Usage Insights with Opt-In Anonymous Share

**Date:** 2026-06-15
**Status:** Design approved, pending implementation plan
**Author:** Xoshbin (with Claude)

## Problem

Asyar ships with **no telemetry by default** and wants to keep that promise. But the
project still needs usage insight to make good product decisions:

- **A — Product:** which commands/extensions are used vs. ignored.
- **B — Growth/health:** how many active users, retention, platform/version adoption.

The challenge: gain this insight **without breaking "no telemetry by default."**

## Core Principle (the guarantee)

> "No telemetry by default" is about **consent and egress**, not about what is measured.

Everything is recorded **locally** for free. Data only ever leaves the device after an
explicit user opt-in. The hard rule that preserves this:

> **The recorder and the sender are separate layers, and the sender is dead by default.**

A fresh install sends **zero bytes**. Nothing changes that without an explicit user
action. That *is* "no telemetry by default."

## Scope

**In scope (v1):**
- Local recording of command/extension launches + a daily-active heartbeat.
- App/platform metadata (version, OS) attached to the share only.
- A local-only dashboard ("your stats") — pure user value, no egress.
- An opt-in anonymous share (`UsageShareMode` = off/ask/auto, default **off**),
  using a rotating, resettable anonymous UUID.

**Explicitly out of scope (v1):**
- Search behavior / query analytics (queries are private — deferred).
- Error/slow-op counts (deferred; quality signals already partly covered by crash reporting).
- Any per-action timestamped event stream (we store daily counts only).
- Account-linked telemetry.

## Architecture

The recorder always runs locally; the sender is a separate module gated behind a
setting that defaults to `Off` — identical to the existing `CrashReportMode` pattern.

```
┌─────────────────────── DEVICE (always on, never leaves) ──────────────────────┐
│                                                                                 │
│   user runs a command ──▶  UsageRecorder (Rust)  ──▶  local SQLite              │
│                                                        usage_events table       │
│                                                              │                  │
│                                          ┌───────────────────┴──────────┐       │
│                                          ▼                              ▼       │
│                                  Local Dashboard (A)          Aggregator         │
│                                  "your stats" view           (rolls events into │
│                                  reads via thin command       daily counts)      │
│                                                                     │           │
└─────────────────────────────────────────────────────────────────────┼──────────┘
                                                                        │
                          ════════ CONSENT GATE (default OFF) ══════════│════
                                                                        ▼
                            only if shareMode ∈ {ask, auto}:   POST /api/usage
                                                               { anon_id, counts,
                                                                 version, platform }
                                                                        │
                                                                        ▼
                                                              asyar.org (Laravel)
```

Two safety properties:

1. **Recording ≠ sending.** `UsageRecorder` always writes locally (powers the
   dashboard + existing frecency). The network layer is a *separate* Rust module
   gated behind `UsageShareMode`, defaulting to `Off`.
2. **Reuse, don't reinvent.** Consent UX = same off/ask/auto enum + same onboarding
   privacy step + same Privacy settings tab as crash reporting. `UsageShareMode`
   sits next to `crashReportMode` in `PrivacySettings`.

## Architectural Impact

**What this changes:** Adds a local usage-recording + aggregation layer (Rust), a
local-stats dashboard (Tier 1 built-in feature), and a separate opt-in anonymous
sender gated behind a new `UsageShareMode` setting (default `Off`).

**Extension Host alignment:** Recording hooks the existing `record_item_usage()`
seam, so **Tier 2 extension launches are counted for free** through the same path as
built-ins — no special-casing. The dashboard consumes aggregated data through a
generic `usage::service` interface, mirroring how `SearchOrchestrator` consumes search.

**Modular reusability:** The aggregator and sender are plain Rust service functions
callable by any future consumer (a CLI, a headless test, an extension API later).
Nothing is wired to a single Svelte component.

**Layer boundaries:** All logic — recording, daily rollup, anon-id, send-gate
decision — lives in `src-tauri/src/usage/` (service layer). New Tauri commands are
**thin wrappers**. The dashboard Svelte component is display-only. Follows `rust-first`.

**Contribution model:** `UsageShareMode` is added declaratively to `PrivacySettings`
next to `crashReportMode` — same enum-driven off/ask/auto pattern. Consent surfaces
reuse the existing onboarding privacy step + Privacy tab.

**Backward compatibility hacks:** None. New table, new setting, new module — no shims.

## Data Model

### Local table: `usage_events`

Daily rollup in a **dedicated `usage.db`** owned by a self-contained `usage::UsageState`
managed-state module (NOT the search-index db — keeps the module boundary tight and
avoids contention on the search connection's `Mutex`). We store **daily counts, not
timestamped events** — less sensitive, smaller, and all the share needs.

```
usage_events
  id          INTEGER
  event_type  TEXT     -- 'launch' | 'heartbeat'
  target      TEXT     -- command/extension id (null for heartbeat)
  day         TEXT     -- 'YYYY-MM-DD' (local date, no clock time)
  count       INTEGER  -- one row per (event_type, target, day), incremented
```

UNIQUE constraint on `(event_type, target, day)`; writes upsert-increment.

### Rotating anonymous id

A random UUID stored in a `usage_meta(key, value)` table inside `usage.db` (machine
identity, Rust-managed — NOT in `settings.dat`, which holds only the user's mode
preference). Generated **lazily** the first time the share runs. Shown and
**resettable** in the Privacy tab. Never tied to email/account.

### Two event sources

```
launch     → hooks the existing record_item_usage() call site. One extra write next
             to the usage_count increment (same seam, DRY). Counts Tier 1 + Tier 2.
heartbeat  → on app focus/activity, write one 'heartbeat' row for today if absent.
             Max one per day. Powers active-user / retention.
```

## Consent Flow & Share Payload

```
shareMode = Off (DEFAULT)  ──▶  recorder writes locally, sender NEVER runs. 0 bytes out.
shareMode = Ask            ──▶  once per period, show preview of exact JSON → user clicks Send
shareMode = Auto           ──▶  sender posts silently on cadence
```

Exact payload to `POST /api/usage` (clean serializable types only):

```json
{
  "anon_id":     "9f3c…",        // rotating UUID, resettable
  "period":      "2026-06-15",   // the day this batch covers
  "app_version": "0.1.0",
  "platform":    "macos-aarch64",
  "active":      true,           // the heartbeat — one true per active day
  "launches":    { "org.asyar.calculator": 12, "cmd_org.asyar.clipboard_paste": 40 }
}
```

Counts + a day + a coarse id. **No query text, no per-action timestamps, no file
paths.** `Ask` mode shows this exact object before anything leaves, reusing the
`CrashReportPrompt` preview pattern.

## Cadence & Backend

- **Cadence:** batch **once per day**. On first launch of a new local day, the sender
  (if enabled) rolls up *yesterday's* counts into one payload and posts it. One
  request per active day per user — no chatty per-event traffic.
- **Backend:** new `usage_pings` table + `POST /api/usage` controller on asyar.org,
  mirroring `FeedbackController` exactly (public route, throttled via a named limiter,
  `StoreUsagePingRequest` validation, Filament resource to view aggregates).
  Anonymous — no auth required; `anon_id` is the only identity.

## Settings & UI

- New `UsageShareMode` enum (`Off` | `Ask` | `Auto`) added to `PrivacySettings`
  alongside `crashReportMode`. Default `Off`.
- `UsageShareSection.svelte` in the Privacy tab: mode selector + anon-id display +
  "Reset id" button + link to the local dashboard.
- Onboarding privacy step gains a short, honest line about the opt-in usage share
  (defaults off).
- Local dashboard: a Tier 1 built-in feature ("Usage Stats") rendering the user's own
  launch counts and active-day streak. Display-only; reads via a thin
  `get_usage_stats` command. Follows the `design-language` skill.

## Testing (TDD)

**Rust (`src-tauri`):**
- Recorder writes daily rollup correctly (upsert-increment on repeat same-day launch).
- **CRITICAL GUARD:** `Off` mode produces **zero** send calls — a dedicated test
  asserting the sender is never invoked by default.
- Anon-id generates lazily on first enable; reset produces a new id.
- Day-boundary rollup selects *yesterday* only.
- Heartbeat writes at most one row per day.

**TS/Svelte (`src`):**
- Dashboard renders counts from `get_usage_stats`.
- Settings toggle persists `usageShareMode`.
- Ask-mode preview shows the real serialized payload.

**Backend (Pest):**
- `/api/usage` validates and stores a well-formed ping.
- Rejects malformed payloads.
- Throttled via named limiter.

## Skills Governing Implementation

The plan must read and honor each at the relevant step:

- `tdd` — RED-phase first for every Rust + TS + Pest change.
- `rust-first` — recording, rollup, anon-id, send-gate all in Rust; frontend display-only.
- `tech-versions` — Svelte 5 runes + Tauri 2 APIs in all frontend/integration code.
- `service-singletons` — sender + recorder as module singletons (no `getInstance()`).
- `review-ipc` — audit the new `get_usage_stats` / `set_usage_share_mode` commands
  and permission-gate coverage.
- `design-language` — dashboard + settings section visual consistency.
- `dev-environment` — workspace/lockfile discipline; CI matrix green before done.

## Open Questions / Future (not v1)

- Search-behavior analytics (abandonment, tier hits) — deferred; sensitive.
- Error/slow-op counts (metric C) — deferred.
- Letting Tier 2 extensions read their own usage stats via an SDK API — possible later
  since the data already flows through a generic service.
