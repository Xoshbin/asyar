import { writeText } from 'tauri-plugin-clipboard-x-api';
import { snippetStore } from './snippetStore.svelte';
import * as commands from '../../lib/ipc/commands';
import { createPersistence } from '../../lib/persistence/extensionStore';
import { logService } from '../../services/log/logService';
import { resolveTemplate } from '../../lib/placeholders';
import { secretRedactionService } from '../../services/privacy/secretRedactionService.svelte';

export const enabledPersistence = createPersistence<boolean>('asyar:snippets:enabled', 'snippets-enabled.dat');

/**
 * Run the secret redactor over a snippet's expansion text.
 *
 * Returns `{ expansion, redactedKinds? }` ready to splice onto a
 * [`Snippet`] payload. When the redactor is disabled or finds no match,
 * `redactedKinds` is `undefined` and `expansion` is the input verbatim.
 */
export async function redactSnippetExpansion(
  expansion: string,
): Promise<{ expansion: string; redactedKinds?: string[] }> {
  const r = await secretRedactionService.redactIfEnabled('snippets', expansion);
  if (r && r.kinds.length > 0) {
    return { expansion: r.content, redactedKinds: r.kinds };
  }
  return { expansion };
}

let expanding = false;

export const snippetService = {
  async init(): Promise<void> {
    try {
      const permitted = await commands.checkSnippetPermission();
      if (permitted === null) {
        logService.warn('Snippet expansion init: check_snippet_permission failed');
        return;
      }
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
    const granted = (await commands.checkSnippetPermission()) ?? false;
    if (granted) await this.syncToRust();
    return { permissionGranted: granted };
  },

  async syncToRust(): Promise<void> {
    const pairs = snippetStore.getAll()
      .filter(s => s.keyword)
      .map(s => [s.keyword!, s.expansion] as [string, string]);
    await commands.syncSnippetsToRust(pairs);
  },

  async setEnabled(enabled: boolean): Promise<{ ok: boolean; error?: string }> {
    const ok = await commands.setSnippetsEnabled(enabled);
    return ok ? { ok: true } : { ok: false, error: 'set_snippets_enabled failed' };
  },

  async openAccessibilityPreferences(): Promise<void> {
    await commands.openAccessibilityPreferences();
  },

  // Called by appInitializer's expand-snippet listener
  async expandSnippet(keywordLen: number, expansion: string): Promise<void> {
    if (expanding) return;
    expanding = true;
    try {
      const resolved = await resolveTemplate(expansion, {});
      await writeText(resolved);
      await commands.expandAndPaste(keywordLen);
    } finally {
      expanding = false;
    }
  },

  async pasteSnippet(expansion: string): Promise<void> {
    const resolved = await resolveTemplate(expansion, {});
    await writeText(resolved);
    await commands.hideWindow();
    await commands.simulatePaste();
  },
};
