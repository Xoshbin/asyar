import { listen } from '@tauri-apps/api/event';
import { logService } from '../log/logService';
import { dispatch } from '../extension/extensionDispatcher.svelte';

/**
 * Bridge for the `asyar:timer:fire` Tauri event — forwards each fired
 * one-shot timer to the target extension via the unified `dispatch(...)`
 * pipeline (kind: 'command', source: 'timer').
 *
 * The Rust scheduler has already marked the timer `fired = 1` in SQLite
 * before emitting, so losing this dispatch (e.g. dormant iframe) never
 * causes a duplicate fire on the next tick — it just means a miss. See
 * `docs/reference/sdk/timers.md` for the mount-dependency limitation.
 *
 * Shape mirrors `ExtensionEventSubscriptions` (scheduler tick bridge).
 */
interface TimerFirePayload {
  extensionId: string;
  timerId: string;
  commandId: string;
  argsJson: string;
  fireAt: number;
  firedAt: number;
}

interface TimerBridgeDeps {
  isExtensionEnabled: (id: string) => boolean;
}

function parseArgs(argsJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(argsJson);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch (e) {
    logService.warn(
      `[TimerBridge] argsJson parse failed (sending empty args): ${(e as Error).message}`,
    );
    return {};
  }
  logService.warn('[TimerBridge] argsJson parse failed (non-object), using {}');
  return {};
}

export class TimerBridge {
  private unlisten: (() => void) | null = null;

  async subscribe(deps: TimerBridgeDeps): Promise<void> {
    this.unlisten = await listen<TimerFirePayload>(
      'asyar:timer:fire',
      (event) => this.handleFire(event.payload, deps.isExtensionEnabled),
    );
  }

  unsubscribe(): void {
    this.unlisten?.();
    this.unlisten = null;
  }

  private handleFire(
    payload: TimerFirePayload,
    isExtensionEnabled: (id: string) => boolean,
  ): void {
    const { extensionId, timerId, commandId, argsJson } = payload;

    if (!isExtensionEnabled(extensionId)) {
      logService.debug(
        `[TimerBridge] dropping fire for disabled extension ${extensionId} (timer ${timerId})`,
      );
      return;
    }

    const args = parseArgs(argsJson);
    logService.debug(
      `[TimerBridge] dispatching ${extensionId}:${commandId} (timer ${timerId})`,
    );
    void dispatch({
      extensionId,
      kind: 'command',
      payload: { commandId, args },
      source: 'timer',
      commandMode: 'background',
    });
  }
}
