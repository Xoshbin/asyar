import { logService } from '../log/logService';
import { getExtensionFrameOrigin } from '$lib/ipc/extensionOrigin';

export interface StreamHandle {
  sendChunk(data: unknown): void;
  sendDone(): void;
  sendError(error: { code: string; message: string }): void;
  onAbort(cb: () => void): void;
  readonly aborted: boolean;
}

interface StreamEntry {
  extensionId: string;
  abortCallbacks: (() => void)[];
  aborted: boolean;
  closed: boolean;
}

export class StreamDispatcher {
  private streams = new Map<string, StreamEntry>();

  create(extensionId: string, streamId: string): StreamHandle {
    if (this.streams.has(streamId)) {
      throw new Error(`StreamDispatcher: streamId already active: ${streamId}`);
    }
    const entry: StreamEntry = {
      extensionId,
      abortCallbacks: [],
      aborted: false,
      closed: false,
    };
    this.streams.set(streamId, entry);

    return {
      sendChunk: (data) => {
        if (entry.closed || entry.aborted) return;
        this.post(streamId, entry, { phase: 'chunk', data });
      },
      sendDone: () => {
        if (entry.closed) return;
        entry.closed = true;
        this.post(streamId, entry, { phase: 'done' });
        this.streams.delete(streamId);
      },
      sendError: (error) => {
        if (entry.closed) return;
        entry.closed = true;
        this.post(streamId, entry, { phase: 'error', error });
        this.streams.delete(streamId);
      },
      onAbort: (cb) => {
        entry.abortCallbacks.push(cb);
      },
      get aborted() {
        return entry.aborted;
      },
    };
  }

  /** Called by ExtensionIpcRouter when it receives an asyar:stream:abort message. */
  abort(streamId: string): void {
    const entry = this.streams.get(streamId);
    if (!entry || entry.closed) return;
    entry.aborted = true;
    entry.closed = true;
    for (const cb of entry.abortCallbacks) {
      try {
        cb();
      } catch (err) {
        logService.error(`[StreamDispatcher] abort callback error: ${err}`);
      }
    }
    this.streams.delete(streamId);
  }

  private post(
    streamId: string,
    entry: StreamEntry,
    payload: { phase: 'chunk' | 'done' | 'error'; data?: unknown; error?: { code: string; message: string } },
  ): void {
    const iframe = document.querySelector<HTMLIFrameElement>(
      `iframe[data-extension-id="${entry.extensionId}"]`,
    );
    if (!iframe?.contentWindow) {
      logService.warn(
        `[StreamDispatcher] iframe for ${entry.extensionId} not found; dropping ${payload.phase} message`,
      );
      return;
    }
    iframe.contentWindow.postMessage(
      { type: 'asyar:stream', streamId, ...payload },
      getExtensionFrameOrigin(entry.extensionId),
    );
  }
}

export const streamDispatcher = new StreamDispatcher();
