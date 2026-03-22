import { invoke } from '@tauri-apps/api/core';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { snippetStore } from './snippetStore';

export const snippetService = {
  async onViewOpen(): Promise<{ permissionGranted: boolean }> {
    const granted = await invoke<boolean>('check_snippet_permission');
    if (granted) await this.syncToRust();
    return { permissionGranted: granted };
  },

  async syncToRust(): Promise<void> {
    const pairs = snippetStore.getAll().map(s => [s.keyword, s.expansion] as [string, string]);
    await invoke('sync_snippets_to_rust', { snippets: pairs });
  },

  async setEnabled(enabled: boolean): Promise<{ ok: boolean; error?: string }> {
    try {
      await invoke('set_snippets_enabled', { enabled });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  },

  async openAccessibilityPreferences(): Promise<void> {
    await invoke('open_accessibility_preferences');
  },

  // Called by appInitializer's expand-snippet listener
  async expandSnippet(keywordLen: number, expansion: string): Promise<void> {
    await writeText(expansion);
    await invoke('expand_and_paste', { keywordLen });
  },
};
