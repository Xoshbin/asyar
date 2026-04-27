import { BaseServiceProxy } from './BaseServiceProxy';
import type { ISearchBarAccessoryService } from './ISearchBarAccessoryService';
import type {
  SearchBarAccessorySetOptions,
  SearchBarAccessoryListener,
} from '../types/SearchBarAccessoryType';

interface FilterChangePushPayload {
  // commandId is part of the wire shape but the proxy doesn't act on it —
  // the launcher already filters filterChange pushes to the active
  // view-iframe before they reach this listener.
  commandId?: string;
  value?: unknown;
}

const FILTER_CHANGE_EVENT = 'asyar:event:searchBar:filterChange';

/**
 * Proxy for the host-side searchbar accessory service. Methods route
 * through `MessageBroker.invoke('searchBar:...')`; selection changes are
 * received as host pushes on `asyar:event:searchBar:filterChange` and
 * forwarded to the consumer's `onChange` handler.
 */
export class SearchBarAccessoryServiceProxy
  extends BaseServiceProxy
  implements ISearchBarAccessoryService
{
  set(opts: SearchBarAccessorySetOptions): Promise<void> {
    // Wrap in a single-keyed envelope so the launcher's IPC dispatcher
    // (which spreads payload values via `Object.values`) delivers `opts`
    // as a single positional arg to the launcher service rather than
    // spreading its fields in unstable key order. See
    // `ExtensionIpcRouter.dispatchApiCall`.
    return this.broker.invoke('searchBar:set', { opts });
  }

  clear(): Promise<void> {
    return this.broker.invoke('searchBar:clear', {});
  }

  onChange(handler: SearchBarAccessoryListener): () => void {
    const listener = (payload: unknown) => {
      const p = payload as FilterChangePushPayload | undefined;
      if (!p || typeof p.value !== 'string') return;
      try {
        handler(p.value);
      } catch (err) {
        console.warn(
          '[SearchBarAccessoryServiceProxy] onChange handler threw:',
          err,
        );
      }
    };
    this.broker.on(FILTER_CHANGE_EVENT, listener);
    return () => this.broker.off(FILTER_CHANGE_EVENT, listener);
  }
}
