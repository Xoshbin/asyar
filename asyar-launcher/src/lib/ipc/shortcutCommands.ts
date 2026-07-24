// asyar-launcher/src/lib/ipc/shortcutCommands.ts
// Tauri command wrappers, re-exported through ./commands (the barrel).
import { invokeSafe, invokeSafeVoid } from './invokeSafe';

// ── Shortcuts ─────────────────────────────────────────────────────────────────

// `register_item_shortcut`/`unregister_item_shortcut` are `Result<(), AppError>`
// on the Rust side — use invokeSafeVoid's boolean signal so callers can
// detect a conflict/failure instead of assuming the shortcut took effect.
export async function registerItemShortcut(
  objectId: string,
  modifier: string,
  key: string,
): Promise<boolean> {
  return invokeSafeVoid('register_item_shortcut', { objectId, modifier, key });
}

export async function unregisterItemShortcut(modifier: string, key: string): Promise<boolean> {
  return invokeSafeVoid('unregister_item_shortcut', { modifier, key });
}

// `update_global_shortcut` is `Result<(), AppError>` on the Rust side —
// use invokeSafeVoid's boolean signal so callers can detect failure.
export async function updateGlobalShortcut(modifier: string, key: string): Promise<boolean> {
  return invokeSafeVoid('update_global_shortcut', { modifier, key });
}

export async function getPersistedShortcut(): Promise<{ modifier: string; key: string } | null> {
  return invokeSafe<{ modifier: string; key: string }>('get_persisted_shortcut');
}

export async function initializeShortcutFromSettings(modifier: string, key: string): Promise<void> {
  await invokeSafe('initialize_shortcut_from_settings', { modifier, key });
}

export async function pauseUserShortcuts(): Promise<void> {
  await invokeSafe('pause_user_shortcuts');
}

export async function resumeUserShortcuts(): Promise<void> {
  await invokeSafe('resume_user_shortcuts');
}

// Distinct from pause/resumeUserShortcuts: these also pause/resume the
// launcher's own global shortcut, not just user item shortcuts.
export async function pauseAllShortcuts(): Promise<void> {
  await invokeSafe('pause_all_shortcuts');
}

export async function resumeAllShortcuts(): Promise<void> {
  await invokeSafe('resume_all_shortcuts');
}

export async function getValidShortcutKeys(): Promise<string[] | null> {
  return invokeSafe<string[]>('get_valid_shortcut_keys');
}

// ── Storage: Shortcuts ───────────────────────────────────────────────────────

export interface StoredItemShortcut {
  id: string;
  objectId: string;
  itemName: string;
  itemType: string;
  itemPath?: string;
  shortcut: string;
  createdAt: number;
}

export async function shortcutUpsert(shortcut: StoredItemShortcut): Promise<void> {
  await invokeSafe('shortcut_upsert', { shortcut });
}

export async function shortcutGetAll(): Promise<StoredItemShortcut[] | null> {
  return invokeSafe<StoredItemShortcut[]>('shortcut_get_all');
}

export async function shortcutRemove(objectId: string): Promise<void> {
  await invokeSafe('shortcut_remove', { objectId });
}
