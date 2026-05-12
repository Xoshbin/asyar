import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { streamDispatcher } from '../extension/streamDispatcher.svelte';
import { shellConsentService } from './shellConsentService.svelte';
import { logService } from '../log/logService';
import { runService, type LocalRunHandle } from '../run/runService.svelte';
import { invokeSafe } from '../../lib/ipc/invokeSafe';

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
    originRole?: 'view' | 'worker',
    /**
     * Run-to-item join key — set by Tier 1 dispatch sites (scripts) so the
     * launcher list can light up the originating row. Forwarded into the
     * auto-promoted `runService.startLocal({...})` call below. Tier 2 callers
     * routing through `ExtensionIpcRouter` never supply this — Tier 2 runs
     * stay anonymous from the launcher's row-status perspective.
     */
    subjectId?: string,
  ): Promise<{ streaming: true }> {
    const resolvedPath = await invoke<string>('shell_resolve_path', { program });

    const allowed = await shellConsentService.requestConsent(extensionId, program, resolvedPath);
    if (!allowed) {
      throw { code: 'PERMISSION_DENIED', message: `User denied permission to run ${program}` };
    }

    await this.ensureGlobalListeners();

    const handle = streamDispatcher.create(extensionId, spawnId, originRole);
    handle.onAbort(() => {
      invoke('shell_kill', { spawnId }).catch((err) => {
        logService.error(`[ShellService] Failed to kill process on abort: ${err}`);
      });
    });

    const label = `${program}${args.length ? ' ' + args.join(' ') : ''}`.slice(0, 100);
    let runHandle: LocalRunHandle | null = null;
    let unsubscribeCancel: (() => void) | undefined;
    try {
      runHandle = await runService.startLocal({
        label,
        kind: 'shell-script',
        cancellable: true,
        extensionId,
        subjectId,
      });
    } catch (err) {
      logService.warn(`runService.startLocal failed for spawn: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (runHandle) {
      unsubscribeCancel = runHandle.onCancel(() => {
        void invokeSafe('shell_kill', { spawnId });
      });
    }

    const chunkUnlisten = await listen<ShellChunkPayload>('asyar:shell:chunk', (ev) => {
      if (ev.payload.spawnId !== spawnId) return;
      void runHandle?.write(ev.payload.data).catch(() => {});
    });

    const doneUnlisten = await listen<ShellDonePayload>('asyar:shell:done', (ev) => {
      if (ev.payload.spawnId !== spawnId) return;
      if ((ev.payload.exitCode ?? 0) === 0) {
        void runHandle?.done().catch(() => {});
      } else {
        void runHandle?.fail(`exit code ${ev.payload.exitCode}`).catch(() => {});
      }
      chunkUnlisten();
      doneUnlisten();
      errorUnlisten?.();
      unsubscribeCancel?.();
    });

    let errorUnlisten: UnlistenFn | undefined;
    errorUnlisten = await listen<ShellErrorPayload>('asyar:shell:error', (ev) => {
      if (ev.payload.spawnId !== spawnId) return;
      void runHandle?.fail(ev.payload.message ?? 'shell error').catch(() => {});
      chunkUnlisten();
      doneUnlisten();
      errorUnlisten?.();
      unsubscribeCancel?.();
    });

    invoke('shell_spawn', {
      extensionId,
      spawnId,
      program: resolvedPath,
      args,
    }).catch((err) => {
      const message =
        err instanceof Error
          ? err.message
          : typeof err === 'string'
            ? err
            : err && typeof err === 'object' && 'message' in err
              ? String((err as { message: unknown }).message)
              : JSON.stringify(err);
      streamDispatcher.forward(spawnId, 'error', {
        error: { code: 'SPAWN_FAILED', message },
      });
      // The asyar:shell:error Tauri event is only emitted by the Rust runtime
      // for runs that actually started; a synchronous shell_spawn rejection
      // (consent miss, missing binary, etc.) bypasses that path. Fail the
      // runHandle directly here so the Run transitions out of "running" and
      // tear down the per-spawn listeners we registered above.
      void runHandle?.fail(message).catch(() => {});
      unsubscribeCancel?.();
      chunkUnlisten();
      doneUnlisten();
      errorUnlisten?.();
    });

    return { streaming: true };
  }

  async list(extensionId: string): Promise<ShellDescriptor[]> {
    return invoke<ShellDescriptor[]>('shell_list', { extensionId });
  }

  async attach(
    extensionId: string,
    spawnId: string,
    originRole?: 'view' | 'worker',
  ): Promise<ShellDescriptor> {
    await this.ensureGlobalListeners();

    // Re-use a live streamDispatcher entry when the original spawn() is
    // still pumping; otherwise open a fresh one so the Rust-side terminal
    // emit (for already-finished entries) has somewhere to land.
    if (!streamDispatcher.has(spawnId)) {
      const handle = streamDispatcher.create(extensionId, spawnId, originRole);
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
