import type { LanDevice } from '../../lib/ipc/lanCommands';

export type LanPickerMode = 'discover' | 'direct';

export interface LanPickerRequest {
  extensionId: string;
  extensionName: string;
  mode: LanPickerMode;
  reason?: string;
  serviceTypes?: string[];
  allowManualEntry: boolean;
  target?: LanDevice;
}

type QueuedRequest = { request: LanPickerRequest; resolve: (device: LanDevice | null) => void };
const MAX_QUEUE = 3;

export class LanDevicePickerService {
  activePicker = $state<LanPickerRequest | null>(null);
  private queue: QueuedRequest[] = [];
  private activeResolver: ((device: LanDevice | null) => void) | null = null;
  private pendingExtensions = new Set<string>();

  request(request: LanPickerRequest): Promise<LanDevice | null> {
    if (this.pendingExtensions.has(request.extensionId)) {
      return Promise.reject(new Error('LAN_PICKER_ALREADY_OPEN'));
    }
    if (this.queue.length >= MAX_QUEUE) return Promise.reject(new Error('LAN_PICKER_BUSY'));
    this.pendingExtensions.add(request.extensionId);
    return new Promise((resolve) => {
      this.queue.push({ request, resolve });
      this.pump();
    });
  }

  onPicked(device: LanDevice): void {
    this.settle(device);
  }
  onCancelled(): void {
    this.settle(null);
  }

  reset(): void {
    const pending = this.queue.splice(0);
    if (this.activePicker && this.activeResolver) this.activeResolver(null);
    pending.forEach(({ resolve }) => resolve(null));
    this.activePicker = null;
    this.activeResolver = null;
    this.pendingExtensions.clear();
  }

  private pump(): void {
    if (this.activePicker) return;
    const next = this.queue.shift();
    if (!next) return;
    this.activePicker = next.request;
    this.activeResolver = next.resolve;
  }

  private settle(device: LanDevice | null): void {
    const extensionId = this.activePicker?.extensionId;
    const resolve = this.activeResolver;
    this.activePicker = null;
    this.activeResolver = null;
    if (extensionId) this.pendingExtensions.delete(extensionId);
    resolve?.(device);
    this.pump();
  }
}

export const lanDevicePickerService = new LanDevicePickerService();
