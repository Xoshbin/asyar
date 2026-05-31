import { Command } from '@tauri-apps/plugin-shell';
import { openPath } from '@tauri-apps/plugin-opener';
import { platform } from '@tauri-apps/plugin-os';
import { diagnosticsService } from '../../../services/diagnostics/diagnosticsService.svelte';

export async function openInEditor(path: string): Promise<void> {
  // Resolve at call-time, not module load — mirrors openTerminal.ts.
  const codeCommand = platform() === 'windows' ? 'code-cmd' : 'code';
  try {
    const cmd = Command.create(codeCommand, ['.'], { cwd: path });
    await cmd.execute();
  } catch {
    try {
      await openPath(path);
    } catch {
      await diagnosticsService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'info',
        retryable: false,
        context: { message: `Couldn't open the editor. Open the folder manually: ${path}` },
      });
    }
  }
}
