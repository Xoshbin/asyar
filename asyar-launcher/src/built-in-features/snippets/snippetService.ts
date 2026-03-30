import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { snippetStore } from './snippetStore.svelte';
import * as commands from '../../lib/ipc/commands';
import { createPersistence } from '../../lib/persistence/extensionStore';
import { logService } from '../../services/log/logService';

export const enabledPersistence = createPersistence<boolean>('asyar:snippets:enabled', 'snippets-enabled.dat');

export const snippetService = {
  async init(): Promise<void> {
    try {
      const permitted = await commands.checkSnippetPermission();
      if (!permitted) return;

      await this.syncToRust();

      const enabled = await enabledPersistence.load(true);
      if (enabled) {
        await this.setEnabled(true);
      }
    } catch (e) {
      logService.warn(`Snippet expansion init: ${e}`);
    }
  },

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
