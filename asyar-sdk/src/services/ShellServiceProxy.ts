import { BaseServiceProxy } from './BaseServiceProxy';
import {
  IShellService,
  ShellChunk,
  ShellDescriptor,
  ShellHandle,
  SpawnParams,
} from './IShellService';

export class ShellServiceProxy extends BaseServiceProxy implements IShellService {
  spawn(params: SpawnParams): ShellHandle {
    const spawnId = crypto.randomUUID();
    return this.buildHandle(spawnId, 'SPAWN_FAILED', () =>
      this.broker.invoke('shell:spawn', {
        program: params.program,
        args: params.args,
        spawnId,
      }),
    );
  }

  async list(): Promise<ShellDescriptor[]> {
    const result = await this.broker.invoke<ShellDescriptor[]>('shell:list', {});
    return result ?? [];
  }

  attach(spawnId: string): ShellHandle {
    return this.buildHandle(spawnId, 'ATTACH_FAILED', () =>
      this.broker.invoke('shell:attach', { spawnId }),
    );
  }

  /**
   * Shared listener plumbing used by both `spawn` and `attach`. Registers
   * the message listener BEFORE the IPC call so that no phase event fired
   * by the host side between invoke and the listener attach can be lost.
   */
  private buildHandle(
    spawnId: string,
    invokeErrorCode: string,
    invokeCall: () => Promise<unknown>,
  ): ShellHandle {
    let settled = false;

    let chunkCb: (chunk: ShellChunk) => void = () => {};
    let doneCb: (exitCode?: number) => void = () => {};
    let errorCb: (error: { code: string; message: string }) => void = () => {};

    const cleanup = () => {
      window.removeEventListener('message', onMessage);
    };

    const settle = (err?: { code: string; message: string }, exitCode?: number) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (err) {
        errorCb(err);
      } else {
        doneCb(exitCode);
      }
    };

    const onMessage = (event: MessageEvent) => {
      const msg = event.data;
      if (msg?.type !== 'asyar:stream' || msg?.streamId !== spawnId) {
        return;
      }

      const { phase, data } = msg;

      switch (phase) {
        case 'chunk':
          if (data) {
            chunkCb(data as ShellChunk);
          }
          break;
        case 'done':
          settle(undefined, data?.exitCode);
          break;
        case 'error':
          settle(data?.error || { code: 'UNKNOWN_ERROR', message: 'Unknown shell stream error' });
          break;
      }
    };

    window.addEventListener('message', onMessage);

    invokeCall().catch((err) => {
      const errorStr = String(err.message || err);
      settle({ code: invokeErrorCode, message: errorStr });
    });

    return {
      spawnId,
      onChunk: (cb) => { chunkCb = cb; },
      onDone: (cb) => { doneCb = cb; },
      onError: (cb) => { errorCb = cb; },
      abort: () => {
        if (settled) return;
        window.parent.postMessage(
          {
            type: 'asyar:stream:abort',
            streamId: spawnId,
          },
          '*',
        );
        settle({ code: 'ABORTED', message: 'Process was aborted by the extension' });
      },
    };
  }
}
