import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { streamDispatcher } from '../extension/streamDispatcher.svelte';
import { shellConsentService } from './shellConsentService.svelte';
import { logService } from '../log/logService';

interface ShellChunkPayload {
  spawnId: string;
  stream: 'stdout' | 'stderr';
  data: string;
}

interface ShellDonePayload {
  spawnId: string;
  exitCode?: number;
}

interface ShellErrorPayload {
  spawnId: string;
  message: string;
}

export interface ShellDescriptor {
  spawnId: string;
  program: string;
  args: string[];
  pid: number;
  startedAt: number;
}

class ShellService {
  // Installed once so spawn() and attach() share a single chunk/done/error
  // subscription. A per-call listen() would double-fire when attach() lands
  // on the same spawnId as a still-live spawn().
  private listenersReady: Promise<void> | null = null;

  private ensureGlobalListeners(): Promise<void> {
    if (this.listenersReady) return this.listenersReady;
    this.listenersReady = (async () => {
      await Promise.all([
        listen<ShellChunkPayload>('asyar:shell:chunk', (event) => {
          const p = event.payload;
          streamDispatcher.forward(p.spawnId, 'chunk', { stream: p.stream, data: p.data });
        }),
        listen<ShellDonePayload>('asyar:shell:done', (event) => {
          const p = event.payload;
          streamDispatcher.forward(p.spawnId, 'done', { exitCode: p.exitCode });
        }),
        listen<ShellErrorPayload>('asyar:shell:error', (event) => {
          const p = event.payload;
          streamDispatcher.forward(p.spawnId, 'error', {
            error: { code: 'SHELL_ERROR', message: p.message },
          });
        }),
      ]);
    })();
    return this.listenersReady;
  }

  async spawn(
    extensionId: string,
    program: string,
    args: string[] = [],
    spawnId: string,
  ): Promise<{ streaming: true }> {
    const resolvedPath = await invoke<string>('shell_resolve_path', { program });

    const allowed = await shellConsentService.requestConsent(extensionId, program, resolvedPath);
    if (!allowed) {
      throw { code: 'PERMISSION_DENIED', message: `User denied permission to run ${program}` };
    }

    await this.ensureGlobalListeners();

    const handle = streamDispatcher.create(extensionId, spawnId);
    handle.onAbort(() => {
      invoke('shell_kill', { spawnId }).catch((err) => {
        logService.error(`[ShellService] Failed to kill process on abort: ${err}`);
      });
    });

    invoke('shell_spawn', {
      extensionId,
      spawnId,
      program: resolvedPath,
      args,
    }).catch((err) => {
      streamDispatcher.forward(spawnId, 'error', {
        error: { code: 'SPAWN_FAILED', message: String(err) },
      });
    });

    return { streaming: true };
  }

  async list(extensionId: string): Promise<ShellDescriptor[]> {
    return invoke<ShellDescriptor[]>('shell_list', { extensionId });
  }

  async attach(extensionId: string, spawnId: string): Promise<ShellDescriptor> {
    await this.ensureGlobalListeners();

    // Re-use a live streamDispatcher entry when the original spawn() is
    // still pumping; otherwise open a fresh one so the Rust-side terminal
    // emit (for already-finished entries) has somewhere to land.
    if (!streamDispatcher.has(spawnId)) {
      const handle = streamDispatcher.create(extensionId, spawnId);
      handle.onAbort(() => {
        invoke('shell_kill', { spawnId }).catch((err) => {
          logService.error(`[ShellService] Failed to kill process on abort: ${err}`);
        });
      });
    }

    return invoke<ShellDescriptor>('shell_attach', { extensionId, spawnId });
  }
}

export const shellService = new ShellService();
export default shellService;
