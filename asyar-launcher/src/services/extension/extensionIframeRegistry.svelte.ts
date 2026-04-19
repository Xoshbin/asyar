import { listen } from '@tauri-apps/api/event';
import { iframeUnmountAck } from '../../lib/ipc/iframeLifecycleCommands';
import { logService } from '../log/logService';
import { extensionPendingState } from './extensionPendingState.svelte';
import { extensionDegradedState } from './extensionDegradedState.svelte';

export interface IframeRegistryEntry {
  extensionId: string;
  mountToken: number;
}

class ExtensionIframeRegistry {
  private _entries = $state<IframeRegistryEntry[]>([]);
  private unlistenMount: (() => void) | null = null;
  private unlistenUnmount: (() => void) | null = null;
  private unlistenRecovered: (() => void) | null = null;

  // Getter, not method: Svelte 5 reactively tracks property reads on class
  // instances with $state fields. A method call inside a $derived doesn't
  // always propagate when consumed from another module — a getter does.
  get entries(): ReadonlyArray<IframeRegistryEntry> {
    return this._entries;
  }

  async init(): Promise<void> {
    if (this.unlistenMount) return;
    this.unlistenMount = await listen<{ extensionId: string; mountToken: number }>(
      'asyar:iframe:mount',
      (e) => this.handleMount(e.payload),
    );
    this.unlistenUnmount = await listen<{ extensionId: string; reason: string }>(
      'asyar:iframe:unmount',
      (e) => this.handleUnmount(e.payload),
    );
    this.unlistenRecovered = await listen<{ extensionId: string }>(
      'asyar:iframe:recovered',
      (e) => extensionDegradedState.recovered(e.payload.extensionId),
    );
  }

  async reset(): Promise<void> {
    this.unlistenMount?.();
    this.unlistenUnmount?.();
    this.unlistenRecovered?.();
    this.unlistenMount = null;
    this.unlistenUnmount = null;
    this.unlistenRecovered = null;
    this._entries.splice(0, this._entries.length);
  }

  /** Exposed for component tests to drive the registry without a Tauri runtime. */
  handleMount(p: { extensionId: string; mountToken: number }): void {
    logService.debug(`[registry] mount ${p.extensionId} token=${p.mountToken}`);
    const existing = this._entries.findIndex((e) => e.extensionId === p.extensionId);
    if (existing >= 0) {
      // In-place index assignment on a $state array triggers Svelte's
      // deep reactivity.
      this._entries[existing] = { ...p };
    } else {
      this._entries.push({ ...p });
    }
  }

  async handleUnmount(p: { extensionId: string; reason: string }): Promise<void> {
    logService.debug(`[registry] unmount ${p.extensionId} reason=${p.reason}`);
    const idx = this._entries.findIndex((e) => e.extensionId === p.extensionId);
    if (idx >= 0) this._entries.splice(idx, 1);
    extensionPendingState.markReady(p.extensionId);
    try {
      await iframeUnmountAck(p.extensionId);
    } catch (err) {
      logService.warn(`[registry] unmount ack failed for ${p.extensionId}: ${err}`);
    }
  }
}

export const extensionIframeRegistry = new ExtensionIframeRegistry();
