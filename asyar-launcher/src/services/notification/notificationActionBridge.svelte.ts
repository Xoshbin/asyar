import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { logService } from '../log/logService';

/**
 * Envelope emitted by the Rust notification dispatcher on
 * `asyar:notification-action` (see `src-tauri/src/notifications/mod.rs`).
 * `argsJson` is intentionally a string so it survives Tauri's serde
 * round-trip untouched; we parse it right before dispatch.
 */
export interface NotificationActionEnvelope {
  notificationId: string;
  actionId: string;
  extensionId: string;
  commandId: string;
  argsJson?: string;
}

export interface NotificationActionBridgeDeps {
  /**
   * Mirrors the deeplink bridge's contract — returns truthy if the
   * extension is installed, falsy otherwise. Keeps the bridge decoupled
   * from the manifest store internals for tests.
   */
  getManifestById: (id: string) => unknown;
  /** Whether the extension is currently enabled (manifest present + toggle on). */
  isExtensionEnabled: (id: string) => boolean;
  /** Whether the requested command is registered in the command service. */
  hasCommand: (objectId: string) => boolean;
  /** Runs the command via the same path a search-result click would take. */
  executeCommand: (objectId: string, args?: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Listens for `asyar:notification-action` and dispatches the declared
 * command through `extensionManager.handleCommandAction`. Same validation
 * rules as `DeeplinkService`: extension exists → extension enabled →
 * command registered → execute. Errors are logged and swallowed so a
 * stale or disabled extension never crashes the click path.
 */
export class NotificationActionBridge {
  private unlisten: UnlistenFn | null = null;

  constructor(private deps: NotificationActionBridgeDeps) {}

  async init(): Promise<void> {
    if (this.unlisten) return;
    this.unlisten = await listen<NotificationActionEnvelope>(
      'asyar:notification-action',
      (event) => {
        this.handle(event.payload).catch((err) => {
          logService.error(`[NotificationActionBridge] unhandled: ${err}`);
        });
      },
    );
    logService.debug('[NotificationActionBridge] listening for asyar:notification-action');
  }

  dispose(): void {
    this.unlisten?.();
    this.unlisten = null;
  }

  async handle(envelope: NotificationActionEnvelope): Promise<void> {
    const { extensionId, commandId, actionId, notificationId, argsJson } = envelope;
    const objectId = `cmd_${extensionId}_${commandId}`;

    if (!this.deps.getManifestById(extensionId)) {
      logService.warn(
        `[NotificationActionBridge] ignoring action '${actionId}' on ${notificationId}: extension '${extensionId}' not installed`,
      );
      return;
    }

    if (!this.deps.isExtensionEnabled(extensionId)) {
      logService.warn(
        `[NotificationActionBridge] ignoring action '${actionId}' on ${notificationId}: extension '${extensionId}' disabled`,
      );
      return;
    }

    if (!this.deps.hasCommand(objectId)) {
      logService.warn(
        `[NotificationActionBridge] command '${objectId}' not registered — action ignored`,
      );
      return;
    }

    const args = parseArgs(argsJson);
    logService.debug(
      `[NotificationActionBridge] dispatching ${extensionId}/${commandId} for action '${actionId}'`,
    );
    await this.deps.executeCommand(objectId, args);
  }
}

function parseArgs(argsJson?: string): Record<string, unknown> | undefined {
  if (!argsJson) return undefined;
  try {
    const parsed = JSON.parse(argsJson);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}
