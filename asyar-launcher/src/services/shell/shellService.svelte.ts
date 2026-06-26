import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { streamDispatcher } from '../extension/streamDispatcher.svelte';
import { shellConsentService } from './shellConsentService.svelte';
import { logService } from '../log/logService';
import { runService, type LocalRunHandle } from '../run/runService.svelte';
import {
  shellResolvePath,
  shellKill,
  shellSpawn,
  shellList,
  shellAttach,
  type ShellDescriptor,
} from '../../lib/ipc/shellCommands';

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

export type { ShellDescriptor };

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
    /**
     * Human-readable label used as `Run.label`. Tier 1 script dispatch passes
     * the script's display name (header title or filename); Tier 2 callers
     * omit this and get a label derived from program + args.
     */
    label?: string,
  ): Promise<{ streaming: true }> {
    const resolvedPath = await shellResolvePath(program);
    if (resolvedPath === null) {
      throw { code: 'PATH_RESOLUTION_FAILED', message: `Failed to resolve path for ${program}` };
    }

    const allowed = await shellConsentService.requestConsent(extensionId, program, resolvedPath);
    if (!allowed) {
      throw { code: 'PERMISSION_DENIED', message: `User denied permission to run ${program}` };
    }

    await this.ensureGlobalListeners();

    const handle = streamDispatcher.create(extensionId, spawnId, originRole);
    handle.onAbort(() => {
      void shellKill(spawnId);
    });

    const resolvedLabel =
      label ?? `${program}${args.length ? ' ' + args.join(' ') : ''}`.slice(0, 100);
    let runHandle: LocalRunHandle | null = null;
    let unsubscribeCancel: (() => void) | undefined;
    try {
      runHandle = await runService.startLocal({
        label: resolvedLabel,
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
        void shellKill(spawnId);
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

    void shellSpawn(extensionId, spawnId, resolvedPath, args).then((ok) => {
      if (ok) return;
      const message = `Failed to spawn ${resolvedPath}`;
      streamDispatcher.forward(spawnId, 'error', {
        error: { code: 'SPAWN_FAILED', message },
      });
      // The asyar:shell:error Tauri event is only emitted by the Rust runtime
      // for runs that actually started; a synchronous shell_spawn failure
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
    return (await shellList(extensionId)) ?? [];
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
        void shellKill(spawnId);
      });
    }

    const descriptor = await shellAttach(extensionId, spawnId);
    if (descriptor === null) {
      throw { code: 'ATTACH_FAILED', message: `Failed to attach to spawn ${spawnId}` };
    }
    return descriptor;
  }
}

export const shellService = new ShellService();
export default shellService;
