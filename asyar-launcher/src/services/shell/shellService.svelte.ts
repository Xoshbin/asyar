import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { streamDispatcher } from '../extension/streamDispatcher.svelte';
import { shellConsentService } from './shellConsentService.svelte';

class ShellService {
  /**
   * Spawns a shell process.
   * Resolves the program path, checks for user consent, creates a stream handle,
   * listens for process output events from Tauri, and finally invokes the Rust spawn command.
   */
  async spawn(
    extensionId: string,
    program: string,
    args: string[] = [],
    spawnId: string,
  ): Promise<{ streaming: true }> {
    // 1. Resolve full path (important for trust store and security)
    const resolvedPath = await invoke<string>('shell_resolve_path', { program });

    // 2. Consent check (Hot path returns true; otherwise shows dialog)
    const allowed = await shellConsentService.requestConsent(extensionId, program, resolvedPath);
    if (!allowed) {
      throw { code: 'PERMISSION_DENIED', message: `User denied permission to run ${program}` };
    }

    // 3. Create a handle for streaming data back to the extension iframe
    const handle = streamDispatcher.create(extensionId, spawnId);

    // 4. Hook up abort logic (e.g. if the extension calls abort())
    handle.onAbort(() => {
      invoke('shell_kill', { spawnId }).catch(err => {
        console.error('[ShellService] Failed to kill process on abort:', err);
      });
    });

    // 5. Listen for Tauri events emitted by the Rust side
    const [unlistenChunk, unlistenDone, unlistenError] = await Promise.all([
      listen('asyar:shell:chunk', (event: any) => {
        const payload = event.payload;
        if (payload.spawnId === spawnId) {
          handle.sendChunk({ stream: payload.stream, data: payload.data });
        }
      }),
      listen('asyar:shell:done', (event: any) => {
        const payload = event.payload;
        if (payload.spawnId === spawnId) {
          handle.sendDone(payload.exitCode);
          cleanup();
        }
      }),
      listen('asyar:shell:error', (event: any) => {
        const payload = event.payload;
        if (payload.spawnId === spawnId) {
          handle.sendError({ code: 'SHELL_ERROR', message: payload.message });
          cleanup();
        }
      })
    ]);

    const cleanup = () => {
      unlistenChunk();
      unlistenDone();
      unlistenError();
    };

    // 6. Invoke the Rust spawn command (fire-and-forget, output comes via events)
    invoke('shell_spawn', {
      extensionId,
      spawnId,
      program: resolvedPath,
      args,
    }).catch(err => {
      handle.sendError({ code: 'SPAWN_FAILED', message: err.toString() });
      cleanup();
    });

    return { streaming: true };
  }
}

export const shellService = new ShellService();
export default shellService;
