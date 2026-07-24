// asyar-launcher/src/lib/ipc/snippetCommands.ts
// Tauri command wrappers, re-exported through ./commands (the barrel).
import { invokeSafe, invokeSafeVoid } from './invokeSafe';

// ── Storage: Snippets ────────────────────────────────────────────────────────

export interface StoredSnippet {
  id: string;
  keyword?: string;
  expansion: string;
  name: string;
  createdAt: number;
  pinned: boolean;
}

export async function snippetUpsert(snippet: StoredSnippet): Promise<void> {
  await invokeSafe('snippet_upsert', { snippet });
}

export async function snippetGetAll(): Promise<StoredSnippet[] | null> {
  return invokeSafe<StoredSnippet[]>('snippet_get_all');
}

export async function snippetRemove(id: string): Promise<void> {
  await invokeSafe('snippet_remove', { id });
}

export async function snippetTogglePin(id: string): Promise<boolean | null> {
  return invokeSafe<boolean>('snippet_toggle_pin', { id });
}

export async function snippetClearAll(): Promise<void> {
  await invokeSafe('snippet_clear_all');
}

// ── Snippets (legacy — text expansion sync) ──────────────────────────────────

export async function syncSnippetsToRust(snippets: [string, string][]): Promise<void> {
  await invokeSafe('sync_snippets_to_rust', { snippets });
}

// boolean (not void): snippetService.setEnabled's { ok, error } contract
// needs to distinguish success from failure.
export async function setSnippetsEnabled(enabled: boolean): Promise<boolean> {
  return invokeSafeVoid('set_snippets_enabled', { enabled }, { silent: true });
}

export async function checkSnippetPermission(): Promise<boolean | null> {
  return invokeSafe<boolean>('check_snippet_permission');
}
