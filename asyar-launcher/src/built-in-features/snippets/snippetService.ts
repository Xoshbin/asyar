import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { snippetStore, type Snippet } from './snippetStore.svelte';
import * as commands from '../../lib/ipc/commands';

export const snippetService = {
  async onViewOpen(): Promise<{ permissionGranted: boolean }> {
    const granted = await commands.checkSnippetPermission();
    if (granted) await this.syncToRust();
    return { permissionGranted: granted };
  },

  async syncToRust(): Promise<void> {
    const pairs = snippetStore.getAll().map(s => [s.keyword, s.expansion] as [string, string]);
    await commands.syncSnippetsToRust(pairs);
  },

  async setEnabled(enabled: boolean): Promise<{ ok: boolean; error?: string }> {
    try {
      await commands.setSnippetsEnabled(enabled);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  },

  async openAccessibilityPreferences(): Promise<void> {
    await commands.openAccessibilityPreferences();
  },

  // Called by appInitializer's expand-snippet listener
  async expandSnippet(keywordLen: number, expansion: string): Promise<void> {
    await writeText(expansion);
    await commands.expandAndPaste(keywordLen);
  },
};
