import { listen } from '@tauri-apps/api/event';
import { iframeUnmountAck } from '../../lib/ipc/iframeLifecycleCommands';
import { logService } from '../log/logService';

export interface WorkerRegistryEntry {
  extensionId: string;
  mountToken: number;
}

class WorkerRegistry {
  private _entries = $state<WorkerRegistryEntry[]>([]);
  private unlistenMount: (() => void) | null = null;
  private unlistenUnmount: (() => void) | null = null;

  get entries(): ReadonlyArray<WorkerRegistryEntry> {
    return this._entries;
  }

  async init(): Promise<void> {
    if (this.unlistenMount) return;
    this.unlistenMount = await listen<{ extensionId: string; mountToken: number; role?: string }>(
      'asyar:iframe:mount',
      (e) => this.handleMount(e.payload),
    );
    this.unlistenUnmount = await listen<{ extensionId: string; reason: string; role?: string }>(
      'asyar:iframe:unmount',
      (e) => this.handleUnmount(e.payload),
    );
  }

  async reset(): Promise<void> {
    this.unlistenMount?.();
    this.unlistenUnmount?.();
    this.unlistenMount = null;
    this.unlistenUnmount = null;
    this._entries.splice(0, this._entries.length);
  }

  handleMount(p: { extensionId: string; mountToken: number; role?: string }): void {
    if (p.role !== 'worker') return;
    logService.debug(`[workerRegistry] mount ${p.extensionId} token=${p.mountToken}`);
    const entry: WorkerRegistryEntry = { extensionId: p.extensionId, mountToken: p.mountToken };
    const existing = this._entries.findIndex((e) => e.extensionId === p.extensionId);
    if (existing >= 0) {
      this._entries[existing] = entry;
    } else {
      this._entries.push(entry);
    }
  }

  async handleUnmount(p: { extensionId: string; reason: string; role?: string }): Promise<void> {
    if (p.role !== 'worker') return;
    logService.debug(`[workerRegistry] unmount ${p.extensionId} reason=${p.reason}`);
    const idx = this._entries.findIndex((e) => e.extensionId === p.extensionId);
    if (idx >= 0) this._entries.splice(idx, 1);
    try {
      await iframeUnmountAck(p.extensionId, 'worker');
    } catch (err) {
      logService.warn(`[workerRegistry] unmount ack failed for ${p.extensionId}: ${err}`);
    }
  }

  getEntry(extensionId: string): WorkerRegistryEntry | undefined {
    return this._entries.find((e) => e.extensionId === extensionId);
  }
}

export const workerRegistry = new WorkerRegistry();
