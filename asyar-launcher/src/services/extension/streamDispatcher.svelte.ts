import { logService } from '../log/logService';
import { getExtensionFrameOrigin } from '$lib/ipc/extensionOrigin';
import { pickExtensionIframe } from './extensionIframeSelector';

export interface StreamHandle {
  sendChunk(data: unknown): void;
  sendDone(exitCode?: number): void;
  sendError(error: { code: string; message: string }): void;
  onAbort(cb: () => void): void;
  readonly aborted: boolean;
}

interface StreamEntry {
  extensionId: string;
  abortCallbacks: (() => void)[];
  aborted: boolean;
  closed: boolean;
  originRole?: 'view' | 'worker';
}

export class StreamDispatcher {
  private streams = new Map<string, StreamEntry>();

  create(extensionId: string, streamId: string, originRole?: 'view' | 'worker'): StreamHandle {
    if (this.streams.has(streamId)) {
      throw new Error(`StreamDispatcher: streamId already active: ${streamId}`);
    }
    const entry: StreamEntry = {
      extensionId,
      abortCallbacks: [],
      aborted: false,
      closed: false,
      originRole,
    };
    this.streams.set(streamId, entry);

    return {
      sendChunk: (data) => {
        if (entry.closed || entry.aborted) return;
        this.post(streamId, entry, { phase: 'chunk', data });
      },
      sendDone: (exitCode?: number) => {
        if (entry.closed) return;
        entry.closed = true;
        this.post(streamId, entry, { phase: 'done', data: { exitCode } });
        this.streams.delete(streamId);
      },
      sendError: (error) => {
        if (entry.closed) return;
        entry.closed = true;
        this.post(streamId, entry, { phase: 'error', data: { error } });
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

  has(streamId: string): boolean {
    return this.streams.has(streamId);
  }

  /**
   * Forwards an event fired by an out-of-band source (e.g. a global Tauri
   * listener) to the stream entry identified by `streamId`. Mirrors the
   * per-handle `sendChunk/sendDone/sendError` path so a single global
   * subscription can drive many streams — used by the shell bridge so both
   * spawn() and attach() reach the same posting pipeline without
   * double-listener bookkeeping.
   */
  forward(
    streamId: string,
    phase: 'chunk' | 'done' | 'error',
    data: unknown,
  ): void {
    const entry = this.streams.get(streamId);
    if (!entry || entry.closed) return;
    if (phase === 'chunk' && entry.aborted) return;

    this.post(streamId, entry, { phase, data });

    if (phase === 'done' || phase === 'error') {
      entry.closed = true;
      this.streams.delete(streamId);
    }
  }

  private post(
    streamId: string,
    entry: StreamEntry,
    payload: { phase: 'chunk' | 'done' | 'error'; data?: unknown },
  ): void {
    // Prefer the originating iframe role; legacy callers without an origin
    // fall back to view-first, matching the historical default.
    const iframe = pickExtensionIframe(entry.extensionId, entry.originRole ?? 'view');
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
