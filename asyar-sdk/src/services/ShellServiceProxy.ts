import { BaseServiceProxy } from './BaseServiceProxy';
import { IShellService, ShellChunk, ShellHandle, SpawnParams } from './IShellService';

export class ShellServiceProxy extends BaseServiceProxy implements IShellService {
  spawn(params: SpawnParams): ShellHandle {
    const spawnId = crypto.randomUUID();
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
      } else if (exitCode !== undefined || !err) {
        // Only call doneCb if no error was passed (normal completion)
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

    // Register listener BEFORE invoking to avoid races
    window.addEventListener('message', onMessage);

    this.broker
      .invoke('shell:spawn', {
        program: params.program,
        args: params.args,
        spawnId,
      })
      .catch((err) => {
        // Handle rejection from the host side (e.g. permission denied)
        const errorStr = String(err.message || err);
        settle({ code: 'SPAWN_FAILED', message: errorStr });
      });

    return {
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
          '*'
        );
        settle({ code: 'ABORTED', message: 'Process was aborted by the extension' });
      },
    };
  }
}
