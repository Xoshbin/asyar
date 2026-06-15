# Local-First Usage Insights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **GIT BAN:** Do NOT run any git write command (add/commit/push/reset/checkout/stash/etc.). This repo's owner forbids it. Where a task says "Checkpoint", STOP and let the human commit. Read-only git (status/diff/log) is fine.
>
> **Per-skill obligations (read the skill before the matching task):** `tdd` (RED first, every task) · `rust-first` (all logic in Rust; frontend renders only) · `tech-versions` (Svelte 5 runes + Tauri 2; no `setInterval`) · `service-singletons` (module singletons, no `getInstance()`) · `review-ipc` (these are Tier-1 host commands, NOT `asyar:api:*` proxies — no `PERMISSION_MAP` entry) · `design-language` (existing components + CSS tokens only) · `dev-environment` (full CI matrix green before done).

**Goal:** Record command/extension launches + a daily-active heartbeat locally, show the user their own stats, and offer an opt-in (default OFF) once-per-day anonymous share to asyar.org.

**Architecture:** A self-contained Rust `usage` module owns a dedicated `usage.db` (daily-count rollups + a rotating anon-id). The frontend is a pure dispatcher/renderer. The network sender is a separate module gated behind a new `UsageShareMode` setting defaulting to `Off` — a fresh install sends zero bytes. The backend mirrors the existing `FeedbackController` exactly.

**Tech Stack:** Rust (Tauri 2, rusqlite, reqwest), Svelte 5 (runes), TypeScript, Laravel 12 + Pest, Filament.

---

## File Structure

**Backend (`/Users/khoshbin/PhpstormProjects/asyar-website`):**
- Create: `database/migrations/2026_06_15_000001_create_usage_pings_table.php`
- Create: `app/Models/UsagePing.php`
- Create: `app/Http/Requests/Api/StoreUsagePingRequest.php`
- Create: `app/Http/Controllers/Api/UsageController.php`
- Modify: `routes/api.php` (add throttled route)
- Modify: `app/Providers/AppServiceProvider.php` (add `usage` rate limiter)
- Create: `app/Filament/Resources/UsagePings/UsagePingResource.php` (+ table/infolist/pages — mirror FeedbackReports)
- Test: `tests/Feature/Api/UsagePingTest.php`

**Launcher Rust (`/Users/khoshbin/develop/Asyar-Project/asyar-launcher/src-tauri`):**
- Create: `src/usage/mod.rs` (UsageState, schema, types, daily rollup, mode parse)
- Create: `src/usage/sender.rs` (payload build + send-gate decision + mark-sent)
- Create: `src/commands/usage.rs` (thin command wrappers)
- Modify: `src/lib.rs` (register module, manage UsageState, register commands, startup send hook)
- Modify: `src/auth/api_client.rs` (add `submit_usage_ping`)
- Modify: `src/search_engine/commands.rs` (`record_item_usage` also records a launch)

**Launcher Frontend (`/Users/khoshbin/develop/Asyar-Project/asyar-launcher/src`):**
- Modify: `src/services/settings/types/AppSettingsType.ts` (+ `UsageShareMode`)
- Modify: `src/services/settings/settingsService.svelte.ts` (default)
- Modify: `src/lib/ipc/commands.ts` (command wrappers)
- Create: `src/components/settings/UsageShareSection.svelte`
- Modify: `src/routes/settings/tabs/PrivacyTab.svelte` (mount the section)
- Modify: `src/routes/onboarding/steps/PrivacyConsent.svelte` (add usage-share radio group)
- Create: `src/components/feedback/UsageSharePrompt.svelte` (Ask-mode preview, mirrors CrashReportPrompt)
- Create: `src/built-in-features/usage-stats/` (`manifest.json`, `index.ts`, `DefaultView.svelte`, `usageStatsState.svelte.ts` + tests)

---

## PHASE A — Backend endpoint (independent; can ship first)

### Task A1: `usage_pings` migration + model

**Files:**
- Create: `database/migrations/2026_06_15_000001_create_usage_pings_table.php`
- Create: `app/Models/UsagePing.php`
- Test: `tests/Feature/Api/UsagePingTest.php`

- [ ] **Step 1: Write the failing test** (`tests/Feature/Api/UsagePingTest.php`)

```php
<?php

use App\Models\UsagePing;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

it('stores a well-formed usage ping', function () {
    $payload = [
        'anon_id'     => '9f3c0c2e-1111-2222-3333-444455556666',
        'period'      => '2026-06-15',
        'app_version' => '0.1.0',
        'platform'    => 'macos-aarch64',
        'active'      => true,
        'launches'    => ['org.asyar.calculator' => 12, 'cmd_org.asyar.clipboard_paste' => 40],
    ];

    $response = $this->postJson('/api/usage', $payload);

    $response->assertCreated()->assertJson(['status' => 'received']);
    expect(UsagePing::count())->toBe(1);
    $ping = UsagePing::first();
    expect($ping->anon_id)->toBe($payload['anon_id']);
    expect($ping->active)->toBeTrue();
    expect($ping->launches)->toBe($payload['launches']);
});
```

- [ ] **Step 2: Run it, watch it fail**

Run: `cd /Users/khoshbin/PhpstormProjects/asyar-website && ./vendor/bin/pest --filter=UsagePingTest`
Expected: FAIL — route `/api/usage` 404 / `UsagePing` class not found.

- [ ] **Step 3: Create the migration**

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('usage_pings', function (Blueprint $table) {
            $table->id();
            $table->string('anon_id', 64);
            $table->string('period', 10);            // 'YYYY-MM-DD' the batch covers
            $table->string('app_version', 50);
            $table->string('platform', 50);
            $table->boolean('active')->default(false);
            $table->json('launches');                // { "<id>": <count> }
            $table->timestamps();

            $table->index('anon_id');
            $table->index('period');
            $table->unique(['anon_id', 'period']);   // one ping per id per day
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('usage_pings');
    }
};
```

- [ ] **Step 4: Create the model** (`app/Models/UsagePing.php`)

```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class UsagePing extends Model
{
    protected $fillable = [
        'anon_id', 'period', 'app_version', 'platform', 'active', 'launches',
    ];

    protected function casts(): array
    {
        return [
            'active'   => 'boolean',
            'launches' => 'array',
        ];
    }
}
```

(Route + request created in Task A2 — the test stays red until then.)

### Task A2: request validation, controller, route, limiter

**Files:**
- Create: `app/Http/Requests/Api/StoreUsagePingRequest.php`
- Create: `app/Http/Controllers/Api/UsageController.php`
- Modify: `routes/api.php`
- Modify: `app/Providers/AppServiceProvider.php`

- [ ] **Step 1: Add a validation-failure test** (append to `UsagePingTest.php`)

```php
it('rejects a malformed usage ping', function () {
    $response = $this->postJson('/api/usage', [
        'anon_id' => 'x',           // ok string
        'period'  => 'not-a-date',  // invalid
        // missing app_version, platform, launches
    ]);

    $response->assertStatus(422);
    expect(UsagePing::count())->toBe(0);
});
```

- [ ] **Step 2: Run, watch both tests fail** (`--filter=UsagePingTest`) — Expected: 404/422-mismatch.

- [ ] **Step 3: Create the FormRequest**

```php
<?php

namespace App\Http\Requests\Api;

use Illuminate\Foundation\Http\FormRequest;

class StoreUsagePingRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'anon_id'     => ['required', 'string', 'max:64'],
            'period'      => ['required', 'date_format:Y-m-d'],
            'app_version' => ['required', 'string', 'max:50'],
            'platform'    => ['required', 'string', 'max:50'],
            'active'      => ['required', 'boolean'],
            'launches'    => ['present', 'array'],
            'launches.*'  => ['integer', 'min:0'],
        ];
    }
}
```

- [ ] **Step 4: Create the controller** (anonymous, no auth — mirrors `FeedbackController` but with an idempotent upsert on `anon_id+period`)

```php
<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\StoreUsagePingRequest;
use App\Models\UsagePing;
use Illuminate\Http\JsonResponse;

class UsageController extends Controller
{
    public function store(StoreUsagePingRequest $request): JsonResponse
    {
        $data = $request->validated();

        $ping = UsagePing::updateOrCreate(
            ['anon_id' => $data['anon_id'], 'period' => $data['period']],
            $data,
        );

        return response()->json(['id' => $ping->id, 'status' => 'received'], 201);
    }
}
```

- [ ] **Step 5: Register the route** (`routes/api.php`, next to the feedback route)

```php
Route::middleware('throttle:usage')->post('/usage', [\App\Http\Controllers\Api\UsageController::class, 'store']);
```

- [ ] **Step 6: Add the rate limiter** (`app/Providers/AppServiceProvider.php` `boot()`, next to the `feedback` limiter)

```php
RateLimiter::for('usage', function (Request $request) {
    return Limit::perMinute(5)->by('ip:'.$request->ip());
});
```

- [ ] **Step 7: Run, watch both tests pass**

Run: `./vendor/bin/pest --filter=UsagePingTest`
Expected: PASS (2 passed).

- [ ] **Step 8: Add an idempotency test** (append) — proves the daily upsert

```php
it('upserts on repeat anon_id+period instead of duplicating', function () {
    $base = [
        'anon_id' => 'id-1', 'period' => '2026-06-15',
        'app_version' => '0.1.0', 'platform' => 'linux-x86_64', 'active' => true,
    ];
    $this->postJson('/api/usage', $base + ['launches' => ['a' => 1]])->assertCreated();
    $this->postJson('/api/usage', $base + ['launches' => ['a' => 5]])->assertCreated();

    expect(UsagePing::count())->toBe(1);
    expect(UsagePing::first()->launches)->toBe(['a' => 5]);
});
```

- [ ] **Step 9: Run all three, watch pass.** Then **Checkpoint** (human commits).

### Task A3: Filament resource (admin view)

**Files:** Create `app/Filament/Resources/UsagePings/UsagePingResource.php` + `Tables/UsagePingsTable.php` + `Schemas/UsagePingInfolist.php` + `Pages/{ListUsagePings,ViewUsagePing}.php`.

- [ ] **Step 1: Scaffold by mirroring FeedbackReports**

Copy the structure of `app/Filament/Resources/FeedbackReports/` verbatim, renaming `FeedbackReport`→`UsagePing`, label "Usage Pings", icon `Heroicon::OutlinedChartBar`. Table columns: `anon_id` (limited/copyable), `period` (sortable, default desc), `platform`, `app_version`, `active` (icon), `created_at`. Keep `canCreate(): false`. The infolist shows all fields + `launches` as a key-value / JSON block.

- [ ] **Step 2: Manual check** — `php artisan route:list | grep usage-pings` shows the panel routes; load the admin panel and confirm pings appear. (No automated test — admin-only read UI.)

- [ ] **Step 3: Checkpoint** (human commits).

---

## PHASE B — Launcher Rust: recording + storage

### Task B1: `usage` module — schema, types, UsageState

**Files:**
- Create: `src-tauri/src/usage/mod.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod usage;`, manage state)

- [ ] **Step 1: Write the failing test** (inline in `src/usage/mod.rs`)

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn mem_state() -> UsageState {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        UsageState { db: std::sync::Mutex::new(conn) }
    }

    #[test]
    fn schema_creates_tables() {
        let state = mem_state();
        let conn = state.db.lock().unwrap();
        // querying the empty tables must succeed
        let events: i64 = conn
            .query_row("SELECT COUNT(*) FROM usage_events", [], |r| r.get(0))
            .unwrap();
        let meta: i64 = conn
            .query_row("SELECT COUNT(*) FROM usage_meta", [], |r| r.get(0))
            .unwrap();
        assert_eq!(events, 0);
        assert_eq!(meta, 0);
    }
}
```

- [ ] **Step 2: Run, watch it fail**

Run: `cd /Users/khoshbin/develop/Asyar-Project/asyar-launcher/src-tauri && cargo test usage::`
Expected: FAIL — `UsageState` / `init_schema` not found.

- [ ] **Step 3: Write the module skeleton** (`src/usage/mod.rs`)

```rust
//! Local-first usage recording. Owns a dedicated `usage.db`.
//! Recording always runs locally; the network sender (sender.rs) is gated
//! behind UsageShareMode and is OFF by default.

use std::sync::Mutex;

pub mod sender;

/// Managed Tauri state: the single connection to usage.db.
pub struct UsageState {
    pub db: Mutex<rusqlite::Connection>,
}

#[derive(Debug, thiserror::Error)]
pub enum UsageError {
    #[error("usage db error: {0}")]
    Db(String),
    #[error("usage lock poisoned")]
    Lock,
}

impl serde::Serialize for UsageError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

const DB_FILE_NAME: &str = "usage.db";

pub fn init_schema(conn: &rusqlite::Connection) -> Result<(), UsageError> {
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         CREATE TABLE IF NOT EXISTS usage_events (
            event_type TEXT NOT NULL,        -- 'launch' | 'heartbeat'
            target     TEXT NOT NULL,        -- item id, '' for heartbeat
            day        TEXT NOT NULL,        -- 'YYYY-MM-DD' local date
            count      INTEGER NOT NULL DEFAULT 0,
            sent       INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (event_type, target, day)
         );
         CREATE TABLE IF NOT EXISTS usage_meta (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
         );",
    )
    .map_err(|e| UsageError::Db(e.to_string()))?;
    Ok(())
}

/// Open (or create) usage.db in the app data dir and build managed state.
pub fn initialize_usage_state<R: tauri::Runtime>(
    app_handle: &tauri::AppHandle<R>,
) -> Result<UsageState, Box<dyn std::error::Error>> {
    use tauri::Manager;
    let dir = app_handle.path().app_data_dir()?;
    std::fs::create_dir_all(&dir)?;
    let conn = rusqlite::Connection::open(dir.join(DB_FILE_NAME))?;
    init_schema(&conn)?;
    Ok(UsageState { db: Mutex::new(conn) })
}
```

- [ ] **Step 4: Run, watch it pass** — `cargo test usage::` → PASS.

- [ ] **Step 5: Wire managed state** in `src/lib.rs` — add `mod usage;` near the other `mod` decls, and inside `setup`/builder where other states are managed, after `initialize_search_state`:

```rust
match usage::initialize_usage_state(&handle) {
    Ok(state) => { app.manage(std::sync::Arc::new(state)); }
    Err(e) => log::error!("usage state init failed: {e}"),
}
```

(Use the same `handle`/`app` binding the search-state init uses; wrap in `Arc` to match the `record_item_usage` State pattern.)

- [ ] **Step 6: Run `cargo test`, then Checkpoint.**

### Task B2: `record_launch` — upsert daily count

**Files:** Modify `src/usage/mod.rs`.

- [ ] **Step 1: Write the failing test** (add to the `tests` module)

```rust
#[test]
fn record_launch_increments_same_day() {
    let state = mem_state();
    state.record_launch("org.asyar.calculator", "2026-06-15").unwrap();
    state.record_launch("org.asyar.calculator", "2026-06-15").unwrap();
    state.record_launch("org.asyar.calculator", "2026-06-15").unwrap();

    let conn = state.db.lock().unwrap();
    let count: i64 = conn
        .query_row(
            "SELECT count FROM usage_events WHERE event_type='launch' AND target=?1 AND day=?2",
            rusqlite::params!["org.asyar.calculator", "2026-06-15"],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 3);
}

#[test]
fn record_launch_separates_days() {
    let state = mem_state();
    state.record_launch("a", "2026-06-15").unwrap();
    state.record_launch("a", "2026-06-16").unwrap();
    let conn = state.db.lock().unwrap();
    let rows: i64 = conn
        .query_row("SELECT COUNT(*) FROM usage_events WHERE target='a'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(rows, 2);
}
```

- [ ] **Step 2: Run, watch fail** — `cargo test usage::` → no method `record_launch`.

- [ ] **Step 3: Implement** (impl block in `mod.rs`)

```rust
impl UsageState {
    pub fn record_launch(&self, target: &str, day: &str) -> Result<(), UsageError> {
        let conn = self.db.lock().map_err(|_| UsageError::Lock)?;
        conn.execute(
            "INSERT INTO usage_events (event_type, target, day, count, sent)
             VALUES ('launch', ?1, ?2, 1, 0)
             ON CONFLICT(event_type, target, day)
             DO UPDATE SET count = count + 1",
            rusqlite::params![target, day],
        )
        .map_err(|e| UsageError::Db(e.to_string()))?;
        Ok(())
    }
}
```

- [ ] **Step 4: Run, watch pass.** Checkpoint.

### Task B3: `record_active_day` — heartbeat (max one/day)

**Files:** Modify `src/usage/mod.rs`.

- [ ] **Step 1: Write the failing test**

```rust
#[test]
fn heartbeat_is_idempotent_per_day() {
    let state = mem_state();
    state.record_active_day("2026-06-15").unwrap();
    state.record_active_day("2026-06-15").unwrap();
    let conn = state.db.lock().unwrap();
    let count: i64 = conn
        .query_row(
            "SELECT count FROM usage_events WHERE event_type='heartbeat' AND day='2026-06-15'",
            [], |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 1); // stays 1, never increments
}
```

- [ ] **Step 2: Run, watch fail.**

- [ ] **Step 3: Implement** (add to impl)

```rust
pub fn record_active_day(&self, day: &str) -> Result<(), UsageError> {
    let conn = self.db.lock().map_err(|_| UsageError::Lock)?;
    conn.execute(
        "INSERT INTO usage_events (event_type, target, day, count, sent)
         VALUES ('heartbeat', '', ?1, 1, 0)
         ON CONFLICT(event_type, target, day) DO NOTHING",
        rusqlite::params![day],
    )
    .map_err(|e| UsageError::Db(e.to_string()))?;
    Ok(())
}
```

- [ ] **Step 4: Run, watch pass.** Checkpoint.

### Task B4: anon-id (lazy generate + reset)

**Files:** Modify `src/usage/mod.rs`. Add `uuid` to `Cargo.toml` if absent (`uuid = { version = "1", features = ["v4"] }` — check first; many Tauri apps already have it).

- [ ] **Step 1: Write the failing test**

```rust
#[test]
fn anon_id_is_stable_then_resettable() {
    let state = mem_state();
    let a = state.anon_id().unwrap();
    let b = state.anon_id().unwrap();
    assert_eq!(a, b);                 // stable across calls
    assert_eq!(a.len(), 36);          // uuid v4 hyphenated

    let c = state.reset_anon_id().unwrap();
    assert_ne!(a, c);                 // reset produces a new id
    assert_eq!(state.anon_id().unwrap(), c);
}
```

- [ ] **Step 2: Run, watch fail.**

- [ ] **Step 3: Implement** (add to impl)

```rust
pub fn anon_id(&self) -> Result<String, UsageError> {
    let conn = self.db.lock().map_err(|_| UsageError::Lock)?;
    let existing: Option<String> = conn
        .query_row("SELECT value FROM usage_meta WHERE key='anon_id'", [], |r| r.get(0))
        .ok();
    if let Some(id) = existing {
        return Ok(id);
    }
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO usage_meta (key, value) VALUES ('anon_id', ?1)",
        rusqlite::params![id],
    )
    .map_err(|e| UsageError::Db(e.to_string()))?;
    Ok(id)
}

pub fn reset_anon_id(&self) -> Result<String, UsageError> {
    let id = uuid::Uuid::new_v4().to_string();
    let conn = self.db.lock().map_err(|_| UsageError::Lock)?;
    conn.execute(
        "INSERT INTO usage_meta (key, value) VALUES ('anon_id', ?1)
         ON CONFLICT(key) DO UPDATE SET value = ?1",
        rusqlite::params![id],
    )
    .map_err(|e| UsageError::Db(e.to_string()))?;
    Ok(id)
}
```

- [ ] **Step 4: Run, watch pass.** Checkpoint.

### Task B5: daily rollup query + `UsageShareMode` parse

**Files:** Modify `src/usage/mod.rs`.

- [ ] **Step 1: Write the failing tests**

```rust
#[test]
fn rollup_for_day_collects_launches_and_active() {
    let state = mem_state();
    state.record_launch("a", "2026-06-15").unwrap();
    state.record_launch("a", "2026-06-15").unwrap();
    state.record_launch("b", "2026-06-15").unwrap();
    state.record_active_day("2026-06-15").unwrap();
    state.record_launch("c", "2026-06-16").unwrap(); // other day excluded

    let r = state.rollup_for_day("2026-06-15").unwrap();
    assert_eq!(r.active, true);
    assert_eq!(r.launches.get("a"), Some(&2));
    assert_eq!(r.launches.get("b"), Some(&1));
    assert_eq!(r.launches.get("c"), None);
}

#[test]
fn parse_share_mode_defaults_off() {
    assert_eq!(parse_usage_share_mode("{}"), UsageShareMode::Off);
    assert_eq!(parse_usage_share_mode("not json"), UsageShareMode::Off);
    assert_eq!(
        parse_usage_share_mode(r#"{"privacy":{"usageShareMode":"ask"}}"#),
        UsageShareMode::Ask
    );
    assert_eq!(
        parse_usage_share_mode(r#"{"privacy":{"usageShareMode":"auto"}}"#),
        UsageShareMode::Auto
    );
}
```

- [ ] **Step 2: Run, watch fail.**

- [ ] **Step 3: Implement** — add types + methods

```rust
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UsageShareMode {
    Off,
    Ask,
    Auto,
}

/// Mirrors feedback::parse_crash_report_mode. Default Off on any parse miss.
pub fn parse_usage_share_mode(settings_json: &str) -> UsageShareMode {
    let value: serde_json::Value = match serde_json::from_str(settings_json) {
        Ok(v) => v,
        Err(_) => return UsageShareMode::Off,
    };
    match value
        .get("privacy")
        .and_then(|p| p.get("usageShareMode"))
        .and_then(|m| m.as_str())
    {
        Some("ask") => UsageShareMode::Ask,
        Some("auto") => UsageShareMode::Auto,
        _ => UsageShareMode::Off,
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct DayRollup {
    pub day: String,
    pub active: bool,
    pub launches: HashMap<String, u32>,
}

impl UsageState {
    pub fn rollup_for_day(&self, day: &str) -> Result<DayRollup, UsageError> {
        let conn = self.db.lock().map_err(|_| UsageError::Lock)?;

        let active: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM usage_events WHERE event_type='heartbeat' AND day=?1",
                rusqlite::params![day],
                |r| r.get::<_, i64>(0),
            )
            .map_err(|e| UsageError::Db(e.to_string()))?
            > 0;

        let mut launches = HashMap::new();
        let mut stmt = conn
            .prepare("SELECT target, count FROM usage_events WHERE event_type='launch' AND day=?1")
            .map_err(|e| UsageError::Db(e.to_string()))?;
        let rows = stmt
            .query_map(rusqlite::params![day], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)? as u32))
            })
            .map_err(|e| UsageError::Db(e.to_string()))?;
        for row in rows {
            let (t, c) = row.map_err(|e| UsageError::Db(e.to_string()))?;
            launches.insert(t, c);
        }

        Ok(DayRollup { day: day.to_string(), active, launches })
    }
}
```

- [ ] **Step 4: Run, watch pass.** Checkpoint.

---

## PHASE C — Launcher Rust: the gated sender

### Task C1: `submit_usage_ping` HTTP client

**Files:** Modify `src/auth/api_client.rs`.

- [ ] **Step 1: Write the failing test** — add an inline test in `api_client.rs` asserting the payload shape serializes (no network). First define the payload type in `sender.rs` (Task C2 references it); to keep this task self-contained, define `UsagePingPayload` here in `usage::sender` BEFORE the client. Reorder: do C2's type definition first if executing strictly. For TDD here, test serialization:

```rust
#[test]
fn usage_ping_payload_serializes_expected_shape() {
    let mut launches = std::collections::HashMap::new();
    launches.insert("org.asyar.calculator".to_string(), 12u32);
    let p = crate::usage::sender::UsagePingPayload {
        anon_id: "abc".into(),
        period: "2026-06-15".into(),
        app_version: "0.1.0".into(),
        platform: "macos-aarch64".into(),
        active: true,
        launches,
    };
    let json = serde_json::to_value(&p).unwrap();
    assert_eq!(json["anon_id"], "abc");
    assert_eq!(json["period"], "2026-06-15");
    assert_eq!(json["active"], true);
    assert_eq!(json["launches"]["org.asyar.calculator"], 12);
}
```

- [ ] **Step 2: Run, watch fail** (type missing — create it in C2 first, then return here). Expected order note: **execute Task C2 Step 3 (type def) before C1 Step 3.**

- [ ] **Step 3: Add the client method** (mirror `submit_feedback`, anonymous — no token)

```rust
/// POST /api/usage — anonymous aggregate usage ping. No bearer token.
pub async fn submit_usage_ping(
    &self,
    payload: &crate::usage::sender::UsagePingPayload,
) -> Result<(), AppError> {
    let response = self
        .client
        .post(format!("{}/api/usage", self.base_url))
        .json(payload)
        .send()
        .await?;
    if !response.status().is_success() {
        return Err(AppError::Other(format!(
            "usage ping failed: {}",
            response.status()
        )));
    }
    Ok(())
}
```

- [ ] **Step 4: Run, watch pass.** Checkpoint.

### Task C2: sender — payload build, send-gate decision, mark-sent

**Files:** Create `src/usage/sender.rs`.

- [ ] **Step 1: Write the failing tests** (inline in `sender.rs`)

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::usage::{init_schema, UsageShareMode, UsageState};

    fn mem_state() -> UsageState {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        UsageState { db: std::sync::Mutex::new(conn) }
    }

    #[test]
    fn off_mode_yields_no_action() {
        let action = decide_send_action(UsageShareMode::Off);
        assert!(matches!(action, SendAction::DoNothing));
    }

    #[test]
    fn ask_and_auto_map_to_their_actions() {
        assert!(matches!(decide_send_action(UsageShareMode::Ask), SendAction::Prompt));
        assert!(matches!(decide_send_action(UsageShareMode::Auto), SendAction::SendNow));
    }

    #[test]
    fn build_payload_uses_rollup_and_meta() {
        let state = mem_state();
        state.record_launch("a", "2026-06-15").unwrap();
        state.record_active_day("2026-06-15").unwrap();
        let payload = build_payload(&state, "2026-06-15", "0.1.0", "linux-x86_64").unwrap();
        assert_eq!(payload.period, "2026-06-15");
        assert_eq!(payload.active, true);
        assert_eq!(payload.launches.get("a"), Some(&1));
        assert_eq!(payload.anon_id.len(), 36);
    }

    #[test]
    fn mark_day_sent_flips_flag() {
        let state = mem_state();
        state.record_launch("a", "2026-06-15").unwrap();
        mark_day_sent(&state, "2026-06-15").unwrap();
        let conn = state.db.lock().unwrap();
        let unsent: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM usage_events WHERE day='2026-06-15' AND sent=0",
                [], |r| r.get(0),
            )
            .unwrap();
        assert_eq!(unsent, 0);
    }

    #[test]
    fn earliest_unsent_day_before_today_skips_today() {
        let state = mem_state();
        state.record_launch("a", "2026-06-14").unwrap();
        state.record_launch("b", "2026-06-15").unwrap(); // "today"
        let day = earliest_unsent_day_before(&state, "2026-06-15").unwrap();
        assert_eq!(day, Some("2026-06-14".to_string()));
    }
}
```

- [ ] **Step 2: Run, watch fail** — `cargo test usage::sender` → items not found.

- [ ] **Step 3: Implement `sender.rs`**

```rust
//! Network sender for usage pings. Separate from recording so the egress
//! path is gated entirely behind UsageShareMode (default Off).

use std::collections::HashMap;

use super::{UsageError, UsageShareMode, UsageState};

#[derive(Debug, Clone, serde::Serialize)]
pub struct UsagePingPayload {
    pub anon_id: String,
    pub period: String,
    pub app_version: String,
    pub platform: String,
    pub active: bool,
    pub launches: HashMap<String, u32>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum SendAction {
    DoNothing, // Off
    Prompt,    // Ask  → emit event, let the user confirm
    SendNow,   // Auto → fire-and-forget
}

pub fn decide_send_action(mode: UsageShareMode) -> SendAction {
    match mode {
        UsageShareMode::Off => SendAction::DoNothing,
        UsageShareMode::Ask => SendAction::Prompt,
        UsageShareMode::Auto => SendAction::SendNow,
    }
}

pub fn build_payload(
    state: &UsageState,
    day: &str,
    app_version: &str,
    platform: &str,
) -> Result<UsagePingPayload, UsageError> {
    let rollup = state.rollup_for_day(day)?;
    let anon_id = state.anon_id()?;
    Ok(UsagePingPayload {
        anon_id,
        period: rollup.day,
        app_version: app_version.to_string(),
        platform: platform.to_string(),
        active: rollup.active,
        launches: rollup.launches,
    })
}

pub fn mark_day_sent(state: &UsageState, day: &str) -> Result<(), UsageError> {
    let conn = state.db.lock().map_err(|_| UsageError::Lock)?;
    conn.execute(
        "UPDATE usage_events SET sent = 1 WHERE day = ?1",
        rusqlite::params![day],
    )
    .map_err(|e| UsageError::Db(e.to_string()))?;
    Ok(())
}

/// The most recent day that has unsent rows AND is strictly before `today`.
pub fn earliest_unsent_day_before(
    state: &UsageState,
    today: &str,
) -> Result<Option<String>, UsageError> {
    let conn = state.db.lock().map_err(|_| UsageError::Lock)?;
    let day: Option<String> = conn
        .query_row(
            "SELECT day FROM usage_events WHERE sent = 0 AND day < ?1
             ORDER BY day DESC LIMIT 1",
            rusqlite::params![today],
            |r| r.get(0),
        )
        .ok();
    Ok(day)
}
```

- [ ] **Step 4: Run, watch pass.** Now return to **Task C1 Step 3/4** (client) if not yet done. Checkpoint.

### Task C3: startup send hook + `today`/`platform` helpers

**Files:** Modify `src/lib.rs`. Reuse the crash-report startup pattern (read `settings.dat`, parse mode, spawn async).

- [ ] **Step 1: Write the failing test** — the date helper is the only pure-logic piece; test it inline in `usage/mod.rs`:

```rust
#[test]
fn local_day_format_is_yyyy_mm_dd() {
    // local_day() returns today in YYYY-MM-DD; assert shape, not value.
    let d = local_day();
    assert_eq!(d.len(), 10);
    assert_eq!(d.as_bytes()[4], b'-');
    assert_eq!(d.as_bytes()[7], b'-');
}
```

- [ ] **Step 2: Run, watch fail.**

- [ ] **Step 3: Implement `local_day()`** in `usage/mod.rs` (uses `chrono`, already a Tauri-common dep — verify in Cargo.toml; if absent add `chrono = "0.4"`)

```rust
/// Today's local date as YYYY-MM-DD.
pub fn local_day() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}
```

- [ ] **Step 4: Run, watch pass.**

- [ ] **Step 5: Add the startup hook in `lib.rs`** — in `setup`, after usage state is managed, mirroring the crash-report block (`lib.rs:775`):

```rust
// Opt-in usage share: roll up the most recent unsent prior day and act on consent.
{
    let handle = app.handle().clone();
    let usage_state = app.state::<std::sync::Arc<usage::UsageState>>().inner().clone();
    let mode = handle
        .store("settings.dat")
        .ok()
        .and_then(|s| s.get("settings"))
        .map(|v| usage::parse_usage_share_mode(&v.to_string()))
        .unwrap_or(usage::UsageShareMode::Off);

    let today = usage::local_day();
    if let Ok(Some(day)) = usage::sender::earliest_unsent_day_before(&usage_state, &today) {
        match usage::sender::decide_send_action(mode) {
            usage::sender::SendAction::DoNothing => { /* recorded locally only */ }
            usage::sender::SendAction::SendNow => {
                let st = usage_state.clone();
                tauri::async_runtime::spawn(async move {
                    let platform = current_platform_string(); // existing helper used by feedback
                    let version = handle.package_info().version.to_string();
                    if let Ok(payload) = usage::sender::build_payload(&st, &day, &version, &platform) {
                        let client = crate::auth::api_client::ApiClient::new();
                        if client.submit_usage_ping(&payload).await.is_ok() {
                            let _ = usage::sender::mark_day_sent(&st, &day);
                        }
                    }
                });
            }
            usage::sender::SendAction::Prompt => {
                // Hand the day to the frontend; it shows UsageSharePrompt and calls
                // send_pending_usage on confirm.
                let _ = handle.emit("usage:pending-share", &day);
            }
        }
    }
}
```

(Use the same `current_platform_string()` / version helpers the feedback flow uses — grep `platform` in `feedback`/`commands/feedback.rs`. If named differently, reuse that exact function; do not duplicate.)

- [ ] **Step 6: `cargo test` + `cargo clippy --all-targets -D warnings`** (run `cargo clean` first if clippy surfaces stale errors). Checkpoint.

### Task C4: commands — record launch hook, heartbeat, stats, share controls

**Files:**
- Create: `src/commands/usage.rs`
- Modify: `src/search_engine/commands.rs` (hook `record_item_usage`)
- Modify: `src/lib.rs` (register commands)

- [ ] **Step 1: Write the failing test** for the stats shape — inline in `commands/usage.rs` we test the pure mapping via UsageState; the command wrappers themselves are thin. Add to `usage/mod.rs` a `stats()` method test:

```rust
#[test]
fn stats_returns_totals_and_active_days() {
    let state = mem_state();
    state.record_launch("a", "2026-06-15").unwrap();
    state.record_launch("a", "2026-06-15").unwrap();
    state.record_launch("b", "2026-06-16").unwrap();
    state.record_active_day("2026-06-15").unwrap();
    state.record_active_day("2026-06-16").unwrap();

    let s = state.stats().unwrap();
    assert_eq!(s.active_days, 2);
    assert_eq!(s.total_launches, 3);
    // top items sorted desc by count
    assert_eq!(s.top.first().map(|t| t.id.as_str()), Some("a"));
    assert_eq!(s.top.first().map(|t| t.count), Some(2));
}
```

- [ ] **Step 2: Run, watch fail.**

- [ ] **Step 3: Implement `stats()`** in `usage/mod.rs`

```rust
#[derive(Debug, Clone, serde::Serialize)]
pub struct TopItem {
    pub id: String,
    pub count: u32,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct UsageStats {
    pub active_days: u32,
    pub total_launches: u32,
    pub top: Vec<TopItem>,
}

impl UsageState {
    pub fn stats(&self) -> Result<UsageStats, UsageError> {
        let conn = self.db.lock().map_err(|_| UsageError::Lock)?;

        let active_days: u32 = conn
            .query_row(
                "SELECT COUNT(*) FROM usage_events WHERE event_type='heartbeat'",
                [], |r| r.get::<_, i64>(0),
            )
            .map_err(|e| UsageError::Db(e.to_string()))? as u32;

        let total_launches: u32 = conn
            .query_row(
                "SELECT COALESCE(SUM(count),0) FROM usage_events WHERE event_type='launch'",
                [], |r| r.get::<_, i64>(0),
            )
            .map_err(|e| UsageError::Db(e.to_string()))? as u32;

        let mut top = Vec::new();
        let mut stmt = conn
            .prepare(
                "SELECT target, SUM(count) AS c FROM usage_events
                 WHERE event_type='launch' GROUP BY target ORDER BY c DESC LIMIT 20",
            )
            .map_err(|e| UsageError::Db(e.to_string()))?;
        let rows = stmt
            .query_map([], |r| Ok(TopItem { id: r.get(0)?, count: r.get::<_, i64>(1)? as u32 }))
            .map_err(|e| UsageError::Db(e.to_string()))?;
        for row in rows {
            top.push(row.map_err(|e| UsageError::Db(e.to_string()))?);
        }

        Ok(UsageStats { active_days, total_launches, top })
    }
}
```

- [ ] **Step 4: Run, watch pass.**

- [ ] **Step 5: Write the thin command wrappers** (`src/commands/usage.rs`)

```rust
use std::sync::Arc;
use crate::usage::{self, UsageError, UsageState};

#[tauri::command]
pub async fn record_active_day(
    state: tauri::State<'_, Arc<UsageState>>,
) -> Result<(), UsageError> {
    state.record_active_day(&usage::local_day())
}

#[tauri::command]
pub async fn get_usage_stats(
    state: tauri::State<'_, Arc<UsageState>>,
) -> Result<usage::UsageStats, UsageError> {
    state.stats()
}

#[tauri::command]
pub async fn reset_usage_anon_id(
    state: tauri::State<'_, Arc<UsageState>>,
) -> Result<String, UsageError> {
    state.reset_anon_id()
}

#[tauri::command]
pub async fn get_usage_anon_id(
    state: tauri::State<'_, Arc<UsageState>>,
) -> Result<String, UsageError> {
    state.anon_id()
}

/// Ask-mode confirm: build the payload for `day`, send it, mark sent.
#[tauri::command]
pub async fn send_pending_usage(
    day: String,
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, Arc<UsageState>>,
) -> Result<(), UsageError> {
    let platform = crate::usage::sender_platform(); // see note below
    let version = app_handle.package_info().version.to_string();
    let payload = usage::sender::build_payload(&state, &day, &version, &platform)?;
    let client = crate::auth::api_client::ApiClient::new();
    client
        .submit_usage_ping(&payload)
        .await
        .map_err(|e| UsageError::Db(e.to_string()))?;
    usage::sender::mark_day_sent(&state, &day)
}
```

Note: factor the platform string used by `feedback` into a shared helper (`usage::sender_platform()` or reuse the feedback one) so it isn't duplicated — rust-first DRY. Use the exact existing function from the feedback flow.

- [ ] **Step 6: Hook `record_item_usage`** (`src/search_engine/commands.rs`) — add the second managed state and record a launch. The frontend contract is unchanged.

```rust
#[tauri::command]
pub async fn record_item_usage(
    object_id: String,
    state: State<'_, std::sync::Arc<SearchState>>,
    usage: State<'_, std::sync::Arc<crate::usage::UsageState>>,
) -> Result<(), SearchError> {
    state.record_usage(&object_id)?;
    // Best-effort local usage record; never fail the launch on a usage write.
    let _ = usage.record_launch(&object_id, &crate::usage::local_day());
    Ok(())
}
```

- [ ] **Step 7: Register all commands** in `lib.rs` `generate_handler!` (next to `record_item_usage` and `submit_feedback`):

```rust
    commands::usage::record_active_day,
    commands::usage::get_usage_stats,
    commands::usage::get_usage_anon_id,
    commands::usage::reset_usage_anon_id,
    commands::usage::send_pending_usage,
```

Add `pub mod usage;` to `src/commands/mod.rs`.

- [ ] **Step 8: `cargo test` + `cargo clippy --all-targets -D warnings` + `cargo build`.** Checkpoint.

---

## PHASE D — Launcher Frontend

### Task D1: settings type + default

**Files:** Modify `AppSettingsType.ts`, `settingsService.svelte.ts`.

- [ ] **Step 1: Write the failing test** (`src/services/settings/settingsService.svelte.test.ts` — add a case; if the file doesn't exist, create a minimal one mocking the tauri store)

```typescript
it('defaults usageShareMode to off', () => {
  expect(settingsService.currentSettings.privacy.usageShareMode).toBe('off');
});
```

- [ ] **Step 2: Run, watch fail** — `cd asyar-launcher && pnpm test:run -- settingsService` → property missing.

- [ ] **Step 3: Extend the types** (`AppSettingsType.ts`)

```typescript
export type CrashReportMode = 'off' | 'ask' | 'auto';
export type UsageShareMode = 'off' | 'ask' | 'auto';

export interface PrivacySettings {
  crashReportMode: CrashReportMode;
  usageShareMode: UsageShareMode;
}
```

- [ ] **Step 4: Add the default** (`settingsService.svelte.ts`, in the defaults `privacy` block)

```typescript
privacy: {
  crashReportMode: 'off',
  usageShareMode: 'off',
},
```

- [ ] **Step 5: Run, watch pass.** Checkpoint.

### Task D2: TS command wrappers

**Files:** Modify `src/lib/ipc/commands.ts`.

- [ ] **Step 1: Write the failing test** (`src/lib/ipc/commands.test.ts` or colocated) using the tdd mock pattern

```typescript
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
import { invoke } from '@tauri-apps/api/core';
import { getUsageStats, recordActiveDay } from './commands';

it('getUsageStats invokes get_usage_stats', async () => {
  vi.mocked(invoke).mockResolvedValueOnce({ activeDays: 2, totalLaunches: 5, top: [] });
  await getUsageStats();
  expect(invoke).toHaveBeenCalledWith('get_usage_stats');
});

it('recordActiveDay invokes record_active_day', async () => {
  await recordActiveDay();
  expect(invoke).toHaveBeenCalledWith('record_active_day');
});
```

- [ ] **Step 2: Run, watch fail.**

- [ ] **Step 3: Add wrappers** (`commands.ts`, near `submitFeedback`)

```typescript
export interface UsageTopItem { id: string; count: number }
export interface UsageStats { activeDays: number; totalLaunches: number; top: UsageTopItem[] }

export async function getUsageStats(): Promise<UsageStats> {
  return invoke('get_usage_stats');
}
export async function recordActiveDay(): Promise<void> {
  return invoke('record_active_day');
}
export async function getUsageAnonId(): Promise<string> {
  return invoke('get_usage_anon_id');
}
export async function resetUsageAnonId(): Promise<string> {
  return invoke('reset_usage_anon_id');
}
export async function sendPendingUsage(day: string): Promise<void> {
  return invoke('send_pending_usage', { day });
}
```

(Note: Rust returns snake_case fields. Confirm the serde rename — `UsageStats` derives `Serialize`; add `#[serde(rename_all = "camelCase")]` to `UsageStats`, `TopItem`, and `UsageStats`'s fields so `activeDays`/`totalLaunches` match the TS interface. If you prefer snake_case in TS, align the interface instead. Pick camelCase to match existing TS conventions and add the serde attribute in Task C4's structs — update there.)

- [ ] **Step 4: Run, watch pass.** Checkpoint.

> **Back-reference fix:** add `#[serde(rename_all = "camelCase")]` to `UsageStats` and `TopItem` in `usage/mod.rs` (Task C4 Step 3). Re-run `cargo test`.

### Task D3: `UsageShareSection.svelte` (Privacy tab)

**Files:** Create `src/components/settings/UsageShareSection.svelte`; modify `src/routes/settings/tabs/PrivacyTab.svelte`.

- [ ] **Step 1: Extract the testable logic first** (rust-first/tdd: no logic in `.svelte`). The mode read/write is a one-liner against `settingsService`; the anon-id load/reset goes through commands. Write a tiny state module test `src/components/settings/usageShareState.svelte.test.ts`:

```typescript
vi.mock('../../lib/ipc/commands', () => ({
  getUsageAnonId: vi.fn().mockResolvedValue('abc-id'),
  resetUsageAnonId: vi.fn().mockResolvedValue('new-id'),
}));
import { getUsageAnonId, resetUsageAnonId } from '../../lib/ipc/commands';
import { usageShareState } from './usageShareState.svelte';

it('loads then resets the anon id', async () => {
  await usageShareState.load();
  expect(usageShareState.anonId).toBe('abc-id');
  await usageShareState.reset();
  expect(resetUsageAnonId).toHaveBeenCalled();
  expect(usageShareState.anonId).toBe('new-id');
});
```

- [ ] **Step 2: Run, watch fail.**

- [ ] **Step 3: Implement the state module** (`usageShareState.svelte.ts`) — module singleton (service-singletons)

```typescript
import { getUsageAnonId, resetUsageAnonId } from '../../lib/ipc/commands';

class UsageShareState {
  anonId = $state('');

  async load() { this.anonId = await getUsageAnonId(); }
  async reset() { this.anonId = await resetUsageAnonId(); }
}

export const usageShareState = new UsageShareState();
```

- [ ] **Step 4: Run, watch pass.**

- [ ] **Step 5: Build the component** (`UsageShareSection.svelte`) — design-language: reuse `SettingsSection`, `SettingsRadioGroup` (as CrashReportSection does), `Button`, CSS tokens only. Svelte 5 runes.

```svelte
<script lang="ts">
  import { SettingsSection, SettingsRow, Button, SettingsRadioGroup } from '../../components';
  import { settingsService } from '../../services/settings/settingsService.svelte';
  import type { UsageShareMode } from '../../services/settings/types/AppSettingsType';
  import { usageShareState } from './usageShareState.svelte';

  let mode = $derived(settingsService.currentSettings.privacy.usageShareMode);

  const options: { value: UsageShareMode; label: string; description?: string }[] = [
    { value: 'off',  label: 'Off',                description: 'Nothing leaves your device.' },
    { value: 'ask',  label: 'Ask each time',      description: 'Review the exact data before it is sent.' },
    { value: 'auto', label: 'Share automatically', description: 'Send anonymous daily counts in the background.' },
  ];

  function choose(value: string) {
    void settingsService.updateSettings('privacy', { usageShareMode: value as UsageShareMode });
  }

  $effect(() => { void usageShareState.load(); });
</script>

<SettingsSection
  title="Anonymous usage share"
  description="Help shape Asyar by sharing anonymous daily counts of which commands you run. No search text, no timestamps, no file paths. Off by default."
>
  <SettingsRadioGroup name="usageShareMode" {options} value={mode} onchange={choose} />

  <SettingsRow label="Anonymous ID" description="A random id, not linked to your account. Reset it any time.">
    {#snippet control()}
      <span class="text-mono text-caption">{usageShareState.anonId}</span>
      <Button variant="secondary" onclick={() => usageShareState.reset()}>Reset</Button>
    {/snippet}
  </SettingsRow>
</SettingsSection>
```

(Confirm `SettingsRadioGroup`, `SettingsRow` control-snippet prop names against `CrashReportSection.svelte` and the component source; adjust to the real API. Do NOT inline custom styling.)

- [ ] **Step 6: Mount in `PrivacyTab.svelte`** — add `<UsageShareSection />` after `<CrashReportSection />`.

- [ ] **Step 7: `pnpm test:run` + `pnpm check` (svelte-check).** Checkpoint.

### Task D4: onboarding privacy step

**Files:** Modify `src/routes/onboarding/steps/PrivacyConsent.svelte`.

- [ ] **Step 1: Add a second radio group** for `usageShareMode`, mirroring the existing crash-report group in the same step (keep it one `GuidanceStep`, two grouped choices). Real code:

```svelte
  let usageMode = $state<UsageShareMode>(
    settingsService.currentSettings.privacy.usageShareMode
  )

  const usageOptions: { value: UsageShareMode; label: string; description?: string }[] = [
    { value: 'off',  label: 'Off',           description: 'No usage data is shared.' },
    { value: 'ask',  label: 'Ask each time', description: 'You review each share.' },
    { value: 'auto', label: 'Share anonymously', description: 'Daily counts, no personal data.' },
  ]

  function handleUsageChange(value: string) {
    void settingsService.updateSettings('privacy', { usageShareMode: value as UsageShareMode })
  }
```

Add the import `UsageShareMode` and render a second `<SettingsRadioGroup name="usageShareMode" options={usageOptions} bind:value={usageMode} onchange={handleUsageChange} />` under a short "Anonymous usage share (optional)" sub-heading inside the step body snippet.

- [ ] **Step 2: Manual onboarding walkthrough** — both defaults show "Off"; selecting persists. (Onboarding is component-level UI; verify by running the app — see dev-environment.) Checkpoint.

### Task D5: Ask-mode prompt

**Files:** Create `src/components/feedback/UsageSharePrompt.svelte`; wire the `usage:pending-share` listener where `CrashReportPrompt` is wired (find its mount + `getPendingCrash` listener).

- [ ] **Step 1: Extract prompt state + test** (`usageSharePromptState.svelte.ts` + test), mirroring `crashPromptState.svelte.ts`. Test: on event payload (a day string), it fetches a preview via a new `previewUsagePing` — to keep scope tight, the preview shown is built from `getUsageStats`-style data; simplest is to display the day + a short explanatory line and call `sendPendingUsage(day)` on confirm. Test the confirm path:

```typescript
vi.mock('../../lib/ipc/commands', () => ({ sendPendingUsage: vi.fn().mockResolvedValue(undefined) }));
import { sendPendingUsage } from '../../lib/ipc/commands';
import { usageSharePromptState } from './usageSharePromptState.svelte';

it('sends the pending day on confirm and clears', async () => {
  usageSharePromptState.show('2026-06-15');
  expect(usageSharePromptState.pendingDay).toBe('2026-06-15');
  await usageSharePromptState.confirm();
  expect(sendPendingUsage).toHaveBeenCalledWith('2026-06-15');
  expect(usageSharePromptState.pendingDay).toBeNull();
});
```

- [ ] **Step 2: Run, watch fail.**

- [ ] **Step 3: Implement the state** (module singleton)

```typescript
import { sendPendingUsage } from '../../lib/ipc/commands';

class UsageSharePromptState {
  pendingDay = $state<string | null>(null);

  show(day: string) { this.pendingDay = day; }
  dismiss() { this.pendingDay = null; }
  async confirm() {
    const day = this.pendingDay;
    if (!day) return;
    await sendPendingUsage(day);
    this.pendingDay = null;
  }
}

export const usageSharePromptState = new UsageSharePromptState();
```

- [ ] **Step 4: Run, watch pass.**

- [ ] **Step 5: Build the banner + listener** — copy `CrashReportPrompt.svelte`'s structure/components. In its `$effect`, `listen<string>('usage:pending-share', (e) => usageSharePromptState.show(e.payload))` (Tauri 2 `listen`, cleanup returned). The banner shows: "Share anonymous usage for {day}? Only command counts and your anonymous id are sent." + Send / Not now buttons (existing `Button` component). Mount it next to `CrashReportPrompt`.

- [ ] **Step 6: `pnpm test:run` + `pnpm check`.** Checkpoint.

### Task D6: heartbeat on app activity

**Files:** Modify the app root (where `getCurrentWindow`/focus is handled, or the main layout `+layout.svelte`).

- [ ] **Step 1: Call `recordActiveDay()` on startup + window focus** — Svelte 5 `$effect` listening to Tauri's window focus event (Tauri 2 `getCurrentWindow().onFocusChanged`), NOT a timer. Real code in the root layout:

```svelte
  import { recordActiveDay } from '../lib/ipc/commands';
  import { getCurrentWindow } from '@tauri-apps/api/window';

  $effect(() => {
    void recordActiveDay(); // once on mount
    const promise = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused) void recordActiveDay();
    });
    return () => { promise.then((unlisten) => unlisten()); };
  });
```

(Rust dedupes to one heartbeat/day, so calling on every focus is cheap and correct.)

- [ ] **Step 2: Manual check** — launch app, confirm a `heartbeat` row exists for today (`sqlite3 <appdata>/usage.db "SELECT * FROM usage_events"`). Checkpoint.

### Task D7: Usage Stats built-in feature (local dashboard)

**Files:** Create `src/built-in-features/usage-stats/{manifest.json,index.ts,DefaultView.svelte,usageStatsState.svelte.ts}` + tests. Register the feature where other built-ins are registered (follow `feedback`).

- [ ] **Step 1: Write the state test** (`usageStatsState.svelte.test.ts`)

```typescript
vi.mock('../../lib/ipc/commands', () => ({
  getUsageStats: vi.fn().mockResolvedValue({
    activeDays: 3, totalLaunches: 52,
    top: [{ id: 'org.asyar.calculator', count: 40 }, { id: 'b', count: 12 }],
  }),
}));
import { getUsageStats } from '../../lib/ipc/commands';
import { usageStatsState } from './usageStatsState.svelte';

it('loads stats from the host', async () => {
  await usageStatsState.load();
  expect(getUsageStats).toHaveBeenCalled();
  expect(usageStatsState.stats?.totalLaunches).toBe(52);
  expect(usageStatsState.stats?.top[0].id).toBe('org.asyar.calculator');
});
```

- [ ] **Step 2: Run, watch fail.**

- [ ] **Step 3: Implement the state** (module singleton)

```typescript
import { getUsageStats, type UsageStats } from '../../lib/ipc/commands';

class UsageStatsState {
  stats = $state<UsageStats | null>(null);
  async load() { this.stats = await getUsageStats(); }
}

export const usageStatsState = new UsageStatsState();
```

- [ ] **Step 4: Run, watch pass.**

- [ ] **Step 5: manifest.json** (mirror feedback)

```json
{
  "id": "usage-stats",
  "name": "Usage Stats",
  "version": "1.0.0",
  "type": "extension",
  "searchable": true,
  "commands": [
    { "id": "open-usage-stats", "name": "Usage Stats", "mode": "view", "component": "DefaultView" }
  ]
}
```

- [ ] **Step 6: index.ts** — `export default new UsageStatsExtension()` with `executeCommand` navigating to the view (copy feedback `index.ts`, swap ids/VIEW_PATH, call `usageStatsState.load()` before navigate). Add an `index.test.ts` asserting `executeCommand('open-usage-stats')` returns the view + triggers `load()`.

- [ ] **Step 7: DefaultView.svelte** — design-language: `AppBar`, scrollable `.custom-scrollbar` content, `Card`/`ListItem` for the top list, `EmptyState` when `stats?.top.length === 0`, `KeyboardHint`/bottom bar for hints. Show: total launches, active days, and the top-20 list (`ListItem` leading=`IconBox`, title=id, trailing=count `Badge`). Real skeleton:

```svelte
<script lang="ts">
  import { AppBar, Card, ListItem, Badge, EmptyState } from '../../components';
  import { usageStatsState } from './usageStatsState.svelte';
  $effect(() => { void usageStatsState.load(); });
  let stats = $derived(usageStatsState.stats);
</script>

<AppBar title="Usage Stats" />
<div class="flex-1 overflow-y-auto custom-scrollbar">
  {#if stats && stats.top.length > 0}
    <Card>
      <div class="text-section">{stats.totalLaunches} launches · {stats.activeDays} active days</div>
    </Card>
    {#each stats.top as item}
      <ListItem title={item.id}>
        {#snippet trailing()}<Badge>{item.count}</Badge>{/snippet}
      </ListItem>
    {/each}
  {:else}
    <EmptyState message="No usage yet" description="Run some commands and your stats will appear here." />
  {/if}
</div>
```

(Confirm `ListItem` / `Card` snippet prop names against the real components; adjust. No inline styling, tokens only.)

- [ ] **Step 8: Register the built-in** alongside `feedback` (find the built-in registry/list and add `usage-stats`).

- [ ] **Step 9: `pnpm test:run` + `pnpm check`.** Then search "Usage Stats" in the running app and confirm the view renders. Checkpoint.

---

## PHASE E — Verification

### Task E1: full CI matrix + format

- [ ] **Step 1: Rust** — `cd asyar-launcher/src-tauri && cargo clean && cargo test && cargo clippy --all-targets -- -D warnings && cargo build`. All green.
- [ ] **Step 2: Launcher TS** — `cd asyar-launcher && pnpm test:run && pnpm check`. All green.
- [ ] **Step 3: Backend** — `cd /Users/khoshbin/PhpstormProjects/asyar-website && ./vendor/bin/pest`. All green.
- [ ] **Step 4: End-to-end smoke (real ids)** — with `ASYAR_API_BASE` pointed at a local Laravel instance and `usageShareMode='auto'`: run a few commands today, set the day back / wait to next day (or temporarily test via the Ask path), confirm a real ping lands in the `usage_pings` table with the correct `anon_id` and counts. This is the cross-seam integration check the per-task unit tests cannot cover.
- [ ] **Step 5: The default-OFF guarantee, manually** — fresh profile, never touch the setting, run commands across two days, confirm **zero** rows in `usage_pings` and zero network calls. This is the core promise.
- [ ] **Step 6: Format changed files only** (per the no-crate-wide-fmt rule): `rustfmt --skip-children --edition 2021 <each changed leaf .rs>`; `pnpm format` scoped to changed TS/Svelte. Re-run CI. Checkpoint.

---

## Self-Review Notes (author)

- **Spec coverage:** A (launches → B2, C4 stats, D7 dashboard), B-heartbeat (B3, D6), platform/version metadata (C2/C3), opt-in share off/ask/auto (B5 parse, C2 decide, C3 startup, D3 settings, D4 onboarding, D5 ask-prompt), rotating resettable anon-id (B4, D3 reset), backend (A1–A3), default-OFF guarantee (C2 `off_mode_yields_no_action` + E1 Step 5). All covered.
- **Type consistency:** Rust `UsageStats`/`TopItem` use `#[serde(rename_all="camelCase")]` (added in C4, flagged in D2) to match the TS `UsageStats`/`UsageTopItem` interfaces. `UsageShareMode` string values `off|ask|auto` identical across Rust parse (B5), TS type (D1), settings key `privacy.usageShareMode`.
- **Deviation from spec:** dedicated `usage.db` + anon-id in `usage_meta` (not `settings.dat`) — recorded in the spec's Data Model section.
- **Out of scope (per spec):** search-behavior analytics, error/slow-op counts, account linking — no tasks, intentionally.
