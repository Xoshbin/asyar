import { readFile } from '@tauri-apps/plugin-fs';
import type { FileHit, FileType } from 'asyar-sdk/contracts';
import { contextModeService } from '../../services/context/contextModeService.svelte';
import { logService } from '../../services/log/logService';
import extensionManager from '../../services/extension/extensionManager.svelte';

const TEXT_TYPES: FileType[] = ['document', 'code'];
const MAX_INLINE_CONTENT = 50_000;

/**
 * Pops the dedicated file-search view and activates the AI default provider
 * with the file path (and for text files under 50 KB, the file contents)
 * pre-populated in the chat input. Auto-send is OFF — the user presses Enter
 * to send.
 */
export async function primeAiChipForFile(file: FileHit): Promise<void> {
  extensionManager.goBack();

  let body = `I have a file selected: ${file.path}\n\n`;

  if (TEXT_TYPES.includes(file.type)) {
    try {
      const data = await readFile(file.path);
      if (data.byteLength <= MAX_INLINE_CONTENT) {
        const decoder = new TextDecoder('utf-8', { fatal: false });
        const content = decoder.decode(data).slice(0, MAX_INLINE_CONTENT);
        body += `Contents:\n\n\`\`\`\n${content}\n\`\`\`\n\n`;
      }
    } catch (err) {
      logService.debug(`[FileSearch] failed to read file for AI prompt: ${err}`);
    }
  }

  contextModeService.activate('agents:default', body);
}
