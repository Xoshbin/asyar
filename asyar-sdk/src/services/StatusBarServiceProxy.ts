import type {
  IStatusBarService,
  IStatusBarItem,
  StatusBarClickContext,
} from './IStatusBarService';
import { BaseServiceProxy } from './BaseServiceProxy';
import {
  collectHandlers,
  stripHandlers,
  validateTopLevelStatusBarItem,
} from './statusBarValidation';

/** Wire type matching the Rust `asyar:tray-item-click` envelope. */
interface TrayClickPushPayload {
  itemPath?: string[];
  checked?: boolean;
}

/**
 * Proxy for the host-side status-bar service. Each top-level item the
 * extension registers becomes an independent menu-bar tray icon; this proxy
 * keeps the local `onClick` dispatch table and ships the serializable tree
 * over the broker.
 *
 * The proxy validates the tree up-front so malformed input fails before the
 * IPC round-trip.
 */
export class StatusBarServiceProxy
  extends BaseServiceProxy
  implements IStatusBarService
{
  /** Top-level id → flat map of `'topId[:...]' -> onClick handler`. */
  private handlersByTop = new Map<
    string,
    Map<string, (ctx: StatusBarClickContext) => void>
  >();

  private clickListenerBound = false;

  registerItem(item: IStatusBarItem): void {
    validateTopLevelStatusBarItem(item);
    // `id` is guaranteed non-empty after validation above.
    this.handlersByTop.set(item.id!, collectHandlers(item));
    this.ensureClickListener();

    const fullItem = { ...stripHandlers(item), extensionId: this.extensionId };
    this.broker
      .invoke('statusBar:registerItem', { item: fullItem })
      .catch((err) =>
        console.warn('[StatusBarServiceProxy] registerItem failed:', err),
      );
  }

  updateItem(id: string, updates: Partial<IStatusBarItem>): void {
    // `updates` is merged with the existing item on the extension side; the
    // host rebuilds the tray from scratch with the merged tree, so we
    // validate the merge result shape here too.
    const merged: IStatusBarItem = { id, text: '', ...updates };
    if (typeof merged.id !== 'string' || merged.id.trim() === '') {
      throw new Error('updateItem requires a non-empty id');
    }
    validateTopLevelStatusBarItem(merged);
    this.handlersByTop.set(merged.id!, collectHandlers(merged));
    this.ensureClickListener();

    const fullItem = { ...stripHandlers(merged), extensionId: this.extensionId };
    this.broker
      .invoke('statusBar:updateItem', {
        extensionId: this.extensionId,
        id,
        item: fullItem,
      })
      .catch((err) =>
        console.warn('[StatusBarServiceProxy] updateItem failed:', err),
      );
  }

  unregisterItem(id: string): void {
    this.handlersByTop.delete(id);
    this.broker
      .invoke('statusBar:unregisterItem', { extensionId: this.extensionId, id })
      .catch((err) =>
        console.warn('[StatusBarServiceProxy] unregisterItem failed:', err),
      );
  }

  private ensureClickListener(): void {
    if (this.clickListenerBound) return;
    this.clickListenerBound = true;
    this.broker.on('asyar:event:statusBar:click', (payload: unknown) =>
      this.dispatchClick(payload as TrayClickPushPayload | undefined),
    );
  }

  private dispatchClick(payload: TrayClickPushPayload | undefined): void {
    if (!payload || !Array.isArray(payload.itemPath) || payload.itemPath.length === 0) {
      console.warn('[StatusBarServiceProxy] click payload missing itemPath', payload);
      return;
    }
    const [topId] = payload.itemPath;
    const handlers = this.handlersByTop.get(topId);
    if (!handlers) {
      // Top-level id not tracked — likely a stale click after unregister, or
      // a registration the proxy never saw. Log once so we surface it in
      // devtools but stay silent for no-handler leaves (below) since those
      // are a legitimate design case for parent submenu rows.
      console.warn(
        `[StatusBarServiceProxy] no handler map for top-level id '${topId}'`,
        { known: [...this.handlersByTop.keys()] },
      );
      return;
    }
    const key = payload.itemPath.join(':');
    const handler = handlers.get(key);
    // Silent on missing leaf handlers: parent rows with submenus intentionally
    // omit onClick, and firing a native click on them still dispatches here.
    if (!handler) return;
    try {
      handler({ itemPath: payload.itemPath, checked: payload.checked });
    } catch (err) {
      console.warn('[StatusBarServiceProxy] onClick handler threw:', err);
    }
  }
}
