import { Command } from '@tauri-apps/plugin-shell';
import { openPath } from '@tauri-apps/plugin-opener';

const isWindows = typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('win');
const codeCommand = isWindows ? 'code-cmd' : 'code';

export async function openInEditor(path: string): Promise<void> {
  try {
    const cmd = Command.create(codeCommand, ['.'], { cwd: path });
    await cmd.execute();
  } catch {
    try {
      await openPath(path);
    } catch { /* best-effort */ }
  }
}
