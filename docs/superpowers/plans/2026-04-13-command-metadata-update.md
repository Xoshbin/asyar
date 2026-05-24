# Command Metadata Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow extensions to dynamically update command subtitles at runtime so search results display contextual information (e.g., a weather extension showing "72 F" next to its command).

**Architecture:** The subtitle is stored on the Rust `Command` struct, persisted in SQLite, and returned via `SearchResult.description`. The TS `searchResultMapper` already maps `description` to `subtitle`, and `ResultsList` already renders it — so the frontend requires zero UI changes. Extensions call `commandService.updateCommandMetadata(commandId, { subtitle })` through the SDK proxy, which routes through the existing IPC dispatch to a new Rust Tauri command.

**Tech Stack:** Rust (search_engine module), TypeScript (CommandService, IPC wrappers), asyar-sdk (ICommandService interface + proxy), Svelte 5 / Tauri 2.

---

## Architectural Impact

**What this changes:** Adds a `subtitle` field to the Rust `Command` model and a runtime update API accessible by both Tier 1 and Tier 2 extensions.

**Extension Host alignment:** Generic interface through `ICommandService`. Tier 2 extensions use the SDK `CommandServiceProxy` over postMessage IPC. Tier 1 call the host `CommandService` directly. Process isolation maintained — all state mutation happens in Rust.

**Modular reusability:** Both built-in features and third-party extensions use the exact same API. Routes through the existing service/IPC layer (CommandService in serviceRegistry, MessageBroker dispatch).

**Layer boundaries:** Rust owns data storage and mutation (`SearchState`). TS `CommandService` is thin orchestration (validate + invoke Rust). Frontend is display-only (`searchResultMapper` maps `description` -> `subtitle`, `ResultsList` renders it — both already exist).

**Contribution model:** Subtitles are set via the runtime API, not hardcoded. No UI changes, no special-casing per extension.

**Backward compatibility hacks:** None. New optional field with `#[serde(default)]` — existing serialized data deserializes cleanly as `None`.

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src-tauri/src/search_engine/models.rs` | Add `subtitle: Option<String>` to `Command` struct |
| Modify | `src-tauri/src/search_engine/mod.rs` | Add `update_command_subtitle()` method; populate `SearchResult.description` from subtitle in `search()` |
| Modify | `src-tauri/src/search_engine/commands.rs` | Add `UpdateCommandMetadataInput` struct + `update_command_metadata` Tauri command |
| Modify | `src-tauri/src/lib.rs` | Register `update_command_metadata` in `generate_handler!` |
| Regen  | `src/bindings.ts` | Auto-generated — `Command` type gains `subtitle` field |
| Modify | `src/lib/ipc/commands.ts` | Add `updateCommandMetadata()` IPC wrapper + input type |
| Modify | `src/services/extension/commandService.svelte.ts` | Add `updateCommandMetadata()` host method |
| Modify | `src/services/extension/commandService.test.ts` | Tests for the new method |
| Modify | `asyar-sdk/src/services/ICommandService.ts` | Add `updateCommandMetadata()` to interface |
| Modify | `asyar-sdk/src/services/CommandServiceProxy.ts` | Implement `updateCommandMetadata()` on proxy |

**No new files.** All changes extend existing modules.

---

## Task 1: Rust — Add `subtitle` to `Command` struct and update search output

**Files:**
- Modify: `src-tauri/src/search_engine/models.rs` (struct `Command`, line 27-39; test helpers lines 149-159, 207-217)
- Modify: `src-tauri/src/search_engine/mod.rs` (method `search()`, lines 268-288 and 307-327; test helpers lines 482-498)

### 1.1 — Write failing tests for subtitle on Command

- [x] **Step 1: Add test for Command subtitle serialization in `models.rs`**

In `src-tauri/src/search_engine/models.rs`, add inside the existing `mod tests` block (after the last test around line 207):

```rust
#[test]
fn test_command_subtitle_defaults_to_none() {
    let json = r#"{
        "id": "cmd_test_hello",
        "name": "Hello",
        "extension": "test",
        "trigger": "hello",
        "type": "command"
    }"#;
    let cmd: Command = serde_json::from_str(json).unwrap();
    assert_eq!(cmd.subtitle, None);
}

#[test]
fn test_command_subtitle_round_trips() {
    let cmd = Command {
        id: "cmd_test_weather".to_string(),
        name: "Weather".to_string(),
        extension: "test".to_string(),
        trigger: "weather".to_string(),
        command_type: "command".to_string(),
        usage_count: 0,
        icon: None,
        last_used_at: None,
        subtitle: Some("72 F".to_string()),
    };
    let json = serde_json::to_string(&cmd).unwrap();
    let deserialized: Command = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized.subtitle, Some("72 F".to_string()));
}
```

- [x] **Step 2: Run tests — expect compile errors (field doesn't exist yet)**

Run: `cd asyar-launcher/src-tauri && cargo test search_engine::models::tests -- --nocapture 2>&1 | head -20`

Expected: Compile error — `no field subtitle on type Command`

### 1.2 — Add `subtitle` field to `Command`

- [x] **Step 3: Add the field to the `Command` struct in `models.rs`**

In `src-tauri/src/search_engine/models.rs`, add `subtitle` after `last_used_at` (line 38):

```rust
#[derive(Serialize, Deserialize, Debug, Clone, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Command {
    pub id: String,
    pub name: String,
    pub extension: String,
    pub trigger: String,
    #[serde(rename = "type")]
    pub command_type: String,
    #[serde(default)] // Add this default for usage count
    pub usage_count: u32,
    pub icon: Option<String>,
    #[serde(default)]
    pub last_used_at: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subtitle: Option<String>,
}
```

- [x] **Step 4: Fix ALL test helpers that construct `Command` — add `subtitle: None`**

There are multiple test helpers across two files. Update ALL of them:

**In `models.rs`, function `make_cmd` (around line 149):**
```rust
fn make_cmd(id: &str, name: &str) -> SearchableItem {
    SearchableItem::Command(Command {
        id: id.to_string(),
        name: name.to_string(),
        extension: "test-ext".to_string(),
        trigger: name.to_lowercase(),
        command_type: "command".to_string(),
        usage_count: 1,
        icon: None,
        last_used_at: None,
        subtitle: None,
    })
}
```

**In `commands.rs`, function `make_cmd` (around line 207):**
```rust
fn make_cmd(id: &str, name: &str, usage: u32) -> SearchableItem {
    SearchableItem::Command(super::super::models::Command {
        id: id.to_string(),
        name: name.to_string(),
        extension: "test_ext".to_string(),
        trigger: name.to_string(),
        command_type: "command".to_string(),
        usage_count: usage,
        icon: None,
        last_used_at: None,
        subtitle: None,
    })
}
```

**In `mod.rs`, function `cmd` (around line 491):**
```rust
fn cmd(id: &str, name: &str, usage: u32) -> SearchableItem {
    SearchableItem::Command(Command {
        id: id.to_string(), name: name.to_string(),
        extension: "test".to_string(), trigger: name.to_lowercase(),
        command_type: "command".to_string(), usage_count: usage, icon: None,
        last_used_at: None,
        subtitle: None,
    })
}
```

**In `commands.rs`, inside `sync_command_index_internal` (around line 162), where a new `Command` is created from `CommandSyncInput`:**
```rust
items.push(SearchableItem::Command(Command {
    id: cmd_input.id,
    name: cmd_input.name,
    extension: cmd_input.extension,
    trigger: cmd_input.trigger,
    command_type: cmd_input.command_type,
    usage_count: 0,
    icon: cmd_input.icon,
    last_used_at: None,
    subtitle: None,
}));
```

- [x] **Step 5: Run tests — all should pass now**

Run: `cd asyar-launcher/src-tauri && cargo test search_engine -- --nocapture 2>&1 | tail -5`

Expected: All tests pass (including the two new ones).

### 1.3 — Update `search()` to populate description from subtitle

- [x] **Step 6: Add test for subtitle appearing in search results in `mod.rs`**

In `src-tauri/src/search_engine/mod.rs`, add inside the existing `mod service_tests` block:

```rust
#[test]
fn test_search_returns_command_subtitle_as_description() {
    let state = make_state();
    let mut c = Command {
        id: "cmd_test_weather".to_string(),
        name: "Weather".to_string(),
        extension: "test".to_string(),
        trigger: "weather".to_string(),
        command_type: "command".to_string(),
        usage_count: 1,
        icon: None,
        last_used_at: None,
        subtitle: Some("72 F".to_string()),
    };
    state.index_one(SearchableItem::Command(c)).unwrap();

    // Empty query (frecency ranked)
    let results = state.search("").unwrap();
    assert_eq!(results[0].description.as_deref(), Some("72 F"));

    // Fuzzy query
    let results = state.search("weath").unwrap();
    assert_eq!(results[0].description.as_deref(), Some("72 F"));
}

#[test]
fn test_search_returns_none_description_when_no_subtitle() {
    let state = make_state();
    state.index_one(cmd("cmd_test_calc", "Calculator", 1)).unwrap();
    let results = state.search("").unwrap();
    assert_eq!(results[0].description, None);
}
```

- [x] **Step 7: Run the new tests — first one should FAIL (description is always None)**

Run: `cd asyar-launcher/src-tauri && cargo test search_engine::service_tests::test_search_returns_command_subtitle -- --nocapture 2>&1`

Expected: FAIL — `assertion left: None, right: Some("72 F")`

- [x] **Step 8: Update `search()` to populate `description` from `cmd.subtitle`**

In `src-tauri/src/search_engine/mod.rs`, in the `search()` method, update BOTH places where `SearchResult` is constructed for commands.

**Empty-query branch** (around line 268-287) — change the `description` field:
```rust
description: match item {
    SearchableItem::Command(cmd) => cmd.subtitle.clone(),
    _ => None,
},
```

**Fuzzy-query branch** (around line 307-327) — change the `description` field:
```rust
description: match item {
    SearchableItem::Command(cmd) => cmd.subtitle.clone(),
    _ => None,
},
```

- [x] **Step 9: Run all search_engine tests**

Run: `cd asyar-launcher/src-tauri && cargo test search_engine -- --nocapture 2>&1 | tail -5`

Expected: All tests pass.

- [x] **Step 10: Commit**

```bash
git add src-tauri/src/search_engine/models.rs src-tauri/src/search_engine/mod.rs src-tauri/src/search_engine/commands.rs
git commit -m "feat: add subtitle field to Command and surface in search results"
```

---

## Task 2: Rust — Add `update_command_subtitle()` method to `SearchState`

**Files:**
- Modify: `src-tauri/src/search_engine/mod.rs` (new method on `SearchState`, new tests)

- [x] **Step 1: Write failing tests for `update_command_subtitle`**

In `src-tauri/src/search_engine/mod.rs`, add inside `mod service_tests`:

```rust
#[test]
fn test_update_command_subtitle_sets_value() {
    let state = make_state();
    state.index_one(cmd("cmd_test_weather", "Weather", 0)).unwrap();

    state.update_command_subtitle("cmd_test_weather", Some("72 F".to_string())).unwrap();

    let results = state.search("").unwrap();
    assert_eq!(results[0].description.as_deref(), Some("72 F"));
}

#[test]
fn test_update_command_subtitle_clears_value() {
    let state = make_state();
    let item = SearchableItem::Command(Command {
        id: "cmd_test_weather".to_string(),
        name: "Weather".to_string(),
        extension: "test".to_string(),
        trigger: "weather".to_string(),
        command_type: "command".to_string(),
        usage_count: 0,
        icon: None,
        last_used_at: None,
        subtitle: Some("old subtitle".to_string()),
    });
    state.index_one(item).unwrap();

    state.update_command_subtitle("cmd_test_weather", None).unwrap();

    let results = state.search("").unwrap();
    assert_eq!(results[0].description, None);
}

#[test]
fn test_update_command_subtitle_rejects_nonexistent_command() {
    let state = make_state();
    let result = state.update_command_subtitle("cmd_nonexistent", Some("test".to_string()));
    assert!(result.is_err());
}

#[test]
fn test_update_command_subtitle_rejects_non_command_id() {
    let state = make_state();
    state.index_one(app("app_safari", "Safari", 0)).unwrap();
    let result = state.update_command_subtitle("app_safari", Some("test".to_string()));
    assert!(result.is_err());
}

#[test]
fn test_update_command_subtitle_persists_to_db() {
    let state = make_state();
    state.index_one(cmd("cmd_test_timer", "Timer", 0)).unwrap();
    state.update_command_subtitle("cmd_test_timer", Some("5:00 remaining".to_string())).unwrap();

    // Reload from DB to verify persistence
    let conn = state.db.lock().unwrap();
    let items = load_items_from_db(&conn).unwrap();
    let timer = items.iter().find(|i| i.id() == "cmd_test_timer").unwrap();
    if let SearchableItem::Command(c) = timer {
        assert_eq!(c.subtitle.as_deref(), Some("5:00 remaining"));
    } else {
        panic!("Expected Command variant");
    }
}
```

- [x] **Step 2: Run tests — expect compile error (method doesn't exist)**

Run: `cd asyar-launcher/src-tauri && cargo test search_engine::service_tests::test_update_command_subtitle -- --nocapture 2>&1 | head -10`

Expected: Compile error — `no method named update_command_subtitle found`

- [x] **Step 3: Implement `update_command_subtitle` on `SearchState`**

In `src-tauri/src/search_engine/mod.rs`, add the method to the `impl SearchState` block (after `record_usage`, around line 357):

```rust
/// Update the subtitle of a command in the search index.
/// Persists the change to SQLite immediately.
pub fn update_command_subtitle(
    &self,
    command_id: &str,
    subtitle: Option<String>,
) -> Result<(), SearchError> {
    if !command_id.starts_with("cmd_") {
        return Err(SearchError::Other(format!(
            "Invalid command ID for subtitle update: {}",
            command_id
        )));
    }
    let mut guard = self.items.write().map_err(|_| SearchError::LockError)?;
    let found = guard.iter_mut().any(|item| {
        if let SearchableItem::Command(cmd) = item {
            if cmd.id == command_id {
                cmd.subtitle = subtitle.clone();
                return true;
            }
        }
        false
    });
    drop(guard);
    if !found {
        return Err(SearchError::NotFound(command_id.to_string()));
    }
    self.save_items_to_db()
}
```

- [x] **Step 4: Run all search_engine tests**

Run: `cd asyar-launcher/src-tauri && cargo test search_engine -- --nocapture 2>&1 | tail -5`

Expected: All tests pass.

- [x] **Step 5: Commit**

```bash
git add src-tauri/src/search_engine/mod.rs
git commit -m "feat: add update_command_subtitle method to SearchState"
```

---

## Task 3: Rust — Add `update_command_metadata` Tauri command

**Files:**
- Modify: `src-tauri/src/search_engine/commands.rs` (new struct + command)
- Modify: `src-tauri/src/lib.rs` (register in `generate_handler!`)

- [x] **Step 1: Add `UpdateCommandMetadataInput` struct and Tauri command**

In `src-tauri/src/search_engine/commands.rs`, add after the `sync_command_index` function (around line 189, before `#[cfg(test)]`):

```rust
/// Input for updating a command's runtime metadata (currently: subtitle only).
#[derive(serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCommandMetadataInput {
    pub command_object_id: String,
    pub subtitle: Option<String>,
}

#[tauri::command]
pub async fn update_command_metadata(
    input: UpdateCommandMetadataInput,
    search_state: tauri::State<'_, crate::search_engine::SearchState>,
) -> Result<(), crate::error::AppError> {
    search_state
        .update_command_subtitle(&input.command_object_id, input.subtitle)
        .map_err(|e| crate::error::AppError::Other(format!("{}", e)))
}
```

- [x] **Step 2: Register the command in `lib.rs`**

In `src-tauri/src/lib.rs`, add after the `search_engine::commands::record_item_usage` line (around line 154):

```rust
search_engine::commands::update_command_metadata,
```

- [x] **Step 3: Verify compilation**

Run: `cd asyar-launcher/src-tauri && cargo check 2>&1 | tail -5`

Expected: No errors.

- [x] **Step 4: Run all tests**

Run: `cd asyar-launcher/src-tauri && cargo test 2>&1 | tail -5`

Expected: All tests pass.

- [x] **Step 5: Commit**

```bash
git add src-tauri/src/search_engine/commands.rs src-tauri/src/lib.rs
git commit -m "feat: add update_command_metadata Tauri command"
```

---

## Task 4: Regenerate TypeScript bindings

**Files:**
- Modify: `src-tauri/src/search_engine/models.rs` (add `UpdateCommandMetadataInput` to bindings export)
- Regenerate: `src/bindings.ts`

- [x] **Step 1: Add `UpdateCommandMetadataInput` to the specta export test**

In `src-tauri/src/search_engine/models.rs`, update the `export_bindings` function in `mod bindings_export` to include the new type. Add the import and register call:

```rust
#[cfg(test)]
mod bindings_export {
    use super::*;
    use crate::search_engine::commands::UpdateCommandMetadataInput;
    use specta_typescript::Typescript;

    #[test]
    #[ignore = "Only run manually to regenerate TypeScript bindings"]
    fn export_bindings() {
        let types = specta::TypeCollection::default()
            .register::<Application>()
            .register::<Command>()
            .register::<SearchableItem>()
            .register::<SearchResult>()
            .register::<ExternalSearchResult>()
            .register::<UpdateCommandMetadataInput>();

        Typescript::default()
            .export_to(
                std::path::PathBuf::from("../src/bindings.ts"),
                &types,
            )
            .expect("Failed to export TypeScript bindings to src/bindings.ts");
    }
}
```

- [x] **Step 2: Run the export**

Run: `cd asyar-launcher/src-tauri && cargo test export_bindings -- --ignored --nocapture 2>&1`

Expected: Success message. `src/bindings.ts` updated with `subtitle?: string | null` on `Command` type and new `UpdateCommandMetadataInput` type.

- [x] **Step 3: Verify the generated bindings**

Run: `cat asyar-launcher/src/bindings.ts`

Expected content should now include:

```typescript
export type Command = {
    id: string,
    name: string,
    extension: string,
    trigger: string,
    type: string,
    usageCount?: number,
    icon: string | null,
    lastUsedAt?: number | null,
    subtitle?: string | null,
};

export type UpdateCommandMetadataInput = {
    commandObjectId: string,
    subtitle: string | null,
};
```

- [x] **Step 4: Commit**

```bash
git add src-tauri/src/search_engine/models.rs src/bindings.ts
git commit -m "chore: regenerate TypeScript bindings with subtitle field"
```

---

## Task 5: TypeScript IPC — Add `updateCommandMetadata` wrapper

**Files:**
- Modify: `src/lib/ipc/commands.ts`

- [x] **Step 1: Add the IPC wrapper function**

In `src/lib/ipc/commands.ts`, add after the `syncCommandIndex` function (around line 254):

```typescript
export interface UpdateCommandMetadataInput {
  commandObjectId: string;
  subtitle: string | null;
}

export async function updateCommandMetadata(input: UpdateCommandMetadataInput): Promise<void> {
  return invoke('update_command_metadata', { input });
}
```

- [x] **Step 2: Verify TypeScript compilation**

Run: `cd asyar-launcher && npx tsc --noEmit 2>&1 | head -20`

Expected: No errors related to `updateCommandMetadata`.

- [x] **Step 3: Commit**

```bash
git add src/lib/ipc/commands.ts
git commit -m "feat: add updateCommandMetadata IPC wrapper"
```

---

## Task 6: TypeScript — Add `updateCommandMetadata` to host `CommandService`

**Files:**
- Modify: `src/services/extension/commandService.test.ts` (new tests)
- Modify: `src/services/extension/commandService.svelte.ts` (new method)

- [x] **Step 1: Write failing tests**

In `src/services/extension/commandService.test.ts`, add the following tests. First check the existing import/mock setup at the top of the file and follow the same pattern. The tests should mock `invoke` from `@tauri-apps/api/core`:

```typescript
describe('updateCommandMetadata', () => {
  it('calls Rust with correct command object ID and subtitle', async () => {
    const svc = new CommandService();
    const handler = { execute: vi.fn() };
    svc.registerCommand('cmd_weather-ext_check', handler, 'weather-ext');

    vi.mocked(invoke).mockResolvedValueOnce(undefined);

    await svc.updateCommandMetadata('weather-ext', 'check', 'Sunny, 72 F');

    expect(invoke).toHaveBeenCalledWith('update_command_metadata', {
      input: {
        commandObjectId: 'cmd_weather-ext_check',
        subtitle: 'Sunny, 72 F',
      },
    });
  });

  it('clears subtitle when null is passed', async () => {
    const svc = new CommandService();
    const handler = { execute: vi.fn() };
    svc.registerCommand('cmd_timer-ext_countdown', handler, 'timer-ext');

    vi.mocked(invoke).mockResolvedValueOnce(undefined);

    await svc.updateCommandMetadata('timer-ext', 'countdown', null);

    expect(invoke).toHaveBeenCalledWith('update_command_metadata', {
      input: {
        commandObjectId: 'cmd_timer-ext_countdown',
        subtitle: null,
      },
    });
  });

  it('throws when command is not registered', async () => {
    const svc = new CommandService();

    await expect(
      svc.updateCommandMetadata('unknown-ext', 'missing', 'test')
    ).rejects.toThrow("Command 'missing' not found for extension 'unknown-ext'");
  });

  it('throws when extension does not own the command', async () => {
    const svc = new CommandService();
    const handler = { execute: vi.fn() };
    svc.registerCommand('cmd_ext-a_do-thing', handler, 'ext-a');

    await expect(
      svc.updateCommandMetadata('ext-b', 'do-thing', 'hack')
    ).rejects.toThrow("Command 'do-thing' not found for extension 'ext-b'");
  });
});
```

- [x] **Step 2: Run the tests — expect failure (method doesn't exist)**

Run: `cd asyar-launcher && pnpm test:run -- --reporter=verbose src/services/extension/commandService.test.ts 2>&1 | tail -20`

Expected: FAIL — `svc.updateCommandMetadata is not a function`

- [x] **Step 3: Implement `updateCommandMetadata` on `CommandService`**

In `src/services/extension/commandService.svelte.ts`, add the import for the IPC commands (if not already present) and the new method. Add after the `clearCommandsForExtension` method (around line 165):

```typescript
/**
 * Update the runtime subtitle of a command in the Rust search index.
 * Scoped to the calling extension — only commands owned by `extensionId`
 * can be updated.
 *
 * @param extensionId - The extension that owns the command
 * @param commandId   - The bare command ID (as declared in manifest.json)
 * @param subtitle    - The new subtitle text, or null to clear
 */
async updateCommandMetadata(
  extensionId: string,
  commandId: string,
  subtitle: string | null
): Promise<void> {
  const commandObjectId = `cmd_${extensionId}_${commandId}`;
  const registered = this.commands.get(commandObjectId);
  if (!registered || registered.extensionId !== extensionId) {
    throw new Error(
      `Command '${commandId}' not found for extension '${extensionId}'`
    );
  }
  const { updateCommandMetadata: updateMeta } = await import(
    "../../lib/ipc/commands"
  );
  await updateMeta({ commandObjectId, subtitle });
}
```

Note: Using dynamic import to avoid circular dependency issues that may arise from the static import of `commands.ts`. If the test file already mocks `@tauri-apps/api/core` (which `commands.ts` uses), this will work. If the file already has a static import of commands at the top, use that instead and remove the dynamic import:

```typescript
async updateCommandMetadata(
  extensionId: string,
  commandId: string,
  subtitle: string | null
): Promise<void> {
  const commandObjectId = `cmd_${extensionId}_${commandId}`;
  const registered = this.commands.get(commandObjectId);
  if (!registered || registered.extensionId !== extensionId) {
    throw new Error(
      `Command '${commandId}' not found for extension '${extensionId}'`
    );
  }
  await commands.updateCommandMetadata({ commandObjectId, subtitle });
}
```

Check the top of `commandService.svelte.ts` — if there is no existing `import * as commands from '../../lib/ipc/commands'`, add it. If there is one, just use it directly.

**Important:** Check the existing test file's mock setup. The tests need `invoke` to be mocked. If the test file already has `vi.mock('@tauri-apps/api/core', ...)` at the top, no changes needed. If not, add:

```typescript
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
import { invoke } from '@tauri-apps/api/core';
```

- [x] **Step 4: Run the tests**

Run: `cd asyar-launcher && pnpm test:run -- --reporter=verbose src/services/extension/commandService.test.ts 2>&1 | tail -20`

Expected: All tests pass.

- [x] **Step 5: Commit**

```bash
git add src/services/extension/commandService.svelte.ts src/services/extension/commandService.test.ts
git commit -m "feat: add updateCommandMetadata to host CommandService"
```

---

## Task 7: SDK — Add to `ICommandService` interface and `CommandServiceProxy`

**Files:**
- Modify: `asyar-sdk/src/services/ICommandService.ts`
- Modify: `asyar-sdk/src/services/CommandServiceProxy.ts`

- [x] **Step 1: Add to the interface**

In `asyar-sdk/src/services/ICommandService.ts`, add the new method to the interface:

```typescript
import type { CommandHandler, ExtensionAction } from '../types';

export interface ICommandService {
  registerCommand(
    commandId: string,
    handler: CommandHandler,
    extensionId: string,
    actions?: Omit<ExtensionAction, 'extensionId'>[]
  ): void;
  unregisterCommand(commandId: string): void;
  executeCommand(commandId: string, args?: Record<string, any>): Promise<any>;
  getCommands(): string[];
  getCommandsForExtension(extensionId: string): string[];
  clearCommandsForExtension(extensionId: string): void;
  /**
   * Update the runtime subtitle of a command owned by this extension.
   * The subtitle appears in root search results next to the command name.
   *
   * @param commandId - The bare command ID as declared in manifest.json
   * @param metadata  - Object with optional subtitle (pass undefined/null to clear)
   */
  updateCommandMetadata(
    commandId: string,
    metadata: { subtitle?: string }
  ): Promise<void>;
}
```

- [x] **Step 2: Implement on the proxy**

In `asyar-sdk/src/services/CommandServiceProxy.ts`, add the method:

```typescript
updateCommandMetadata(
  commandId: string,
  metadata: { subtitle?: string }
): Promise<void> {
  return this.broker.invoke('command:updateCommandMetadata', {
    extensionId: this.extensionId,
    commandId,
    subtitle: metadata.subtitle ?? null,
  });
}
```

The IPC flow:
1. `broker.invoke('command:updateCommandMetadata', { extensionId, commandId, subtitle })` sends `asyar:api:command:updateCommandMetadata`
2. IPC Router: `serviceMap['command']` = `'CommandService'`
3. `Object.values({ extensionId, commandId, subtitle })` = `[extensionId, commandId, subtitle]`
4. `CommandService` is NOT in `INJECTS_EXTENSION_ID` — args passed as-is
5. Calls: `commandService.updateCommandMetadata(extensionId, commandId, subtitle)`

This matches the host method signature from Task 6.

- [x] **Step 3: Verify SDK compilation**

Run: `cd asyar-sdk && npx tsc --noEmit 2>&1 | head -10`

Expected: No errors.

- [x] **Step 4: Run SDK tests**

Run: `cd asyar-sdk && pnpm test:run 2>&1 | tail -5`

Expected: All existing tests pass.

- [x] **Step 5: Commit**

```bash
cd asyar-sdk
git add src/services/ICommandService.ts src/services/CommandServiceProxy.ts
git commit -m "feat: add updateCommandMetadata to SDK ICommandService and proxy"
```

---

## Task 8: Full verification

- [x] **Step 1: Run all Rust tests**

Run: `cd asyar-launcher/src-tauri && cargo test 2>&1 | tail -10`

Expected: All tests pass (including new subtitle tests).

- [x] **Step 2: Run all TS launcher tests**

Run: `cd asyar-launcher && pnpm test:run 2>&1 | tail -10`

Expected: All tests pass.

- [x] **Step 3: Run all SDK tests**

Run: `cd asyar-sdk && pnpm test:run 2>&1 | tail -10`

Expected: All tests pass.

- [x] **Step 4: Verify the rendering pipeline (no UI changes needed)**

Trace the data flow to confirm everything connects:

1. `SearchState.search()` → builds `SearchResult { description: cmd.subtitle.clone() }` (**Task 1**)
2. `SearchResult` over IPC → TS `bindings.ts` `SearchResult.description` (**Task 4**)
3. `searchResultMapper.ts:171` → `subtitle: result.description || undefined` (**already exists**)
4. `MappedSearchItem.subtitle` → `ResultsList.svelte:121-122` renders it (**already exists**)

No UI changes required. The subtitle renders automatically once it's set.

- [x] **Step 5: Verify dev build compiles**

Run: `cd asyar-launcher && pnpm build 2>&1 | tail -5`

Or if the project uses a check command:
Run: `cd asyar-launcher && npx tsc --noEmit 2>&1 | tail -5`

Expected: No errors.

- [x] **Step 6: Update the capabilities gap document**

In `asyar-launcher/.claude/extension-capabilities-gap.md`, move "Command metadata update" from "Lower Priority — nice to have" to "Recently Shipped":

Add to the "Recently Shipped" table:
```
| **Command metadata update** | `CommandService.updateCommandMetadata(commandId, { subtitle })` — extensions update their command's subtitle at runtime (e.g., showing weather data, timer countdown). Persisted in SQLite search index. Ungated (extensions can only update their own commands). Both Tier 1 + Tier 2 via same SDK proxy. |
```

Remove from "Lower Priority — nice to have":
```
| **Command metadata update** (runtime subtitle changes) | Minor UX polish. |
```

- [x] **Step 7: Final commit**

```bash
git add asyar-launcher/.claude/extension-capabilities-gap.md
git commit -m "docs: mark command metadata update as shipped"
```

---

## Extension Usage Example (for reference, not a task)

### Tier 2 Extension (manifest.json + index.ts)

```json
{
  "id": "org.example.weather",
  "commands": [
    {
      "id": "check",
      "name": "Check Weather",
      "trigger": "weather",
      "resultType": "no-view",
      "icon": "icon:weather",
      "schedule": { "intervalSeconds": 3600 }
    }
  ]
}
```

```typescript
import { Extension } from 'asyar-sdk';

export default class WeatherExtension extends Extension {
  async activate() {
    const temp = await this.fetchWeather();
    await this.context.proxies.CommandService.updateCommandMetadata('check', {
      subtitle: `${temp} F — Last checked: ${new Date().toLocaleTimeString()}`
    });
  }

  async executeCommand(commandId: string, args: Record<string, any>) {
    if (commandId === 'check' || args?.scheduledTick) {
      const temp = await this.fetchWeather();
      await this.context.proxies.CommandService.updateCommandMetadata('check', {
        subtitle: `${temp} F — Last checked: ${new Date().toLocaleTimeString()}`
      });
    }
  }

  private async fetchWeather(): Promise<number> {
    // ... fetch from API
    return 72;
  }
}
```

### Tier 1 Built-in Feature

```typescript
import { commandService } from '../services/extension/commandService.svelte';

// In the built-in feature's handler:
await commandService.updateCommandMetadata('my-extension-id', 'my-command', '5:00 remaining');
```
