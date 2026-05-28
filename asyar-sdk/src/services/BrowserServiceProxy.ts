import { BaseServiceProxy } from './BaseServiceProxy';
import type {
  Bookmark,
  BrowserFamily,
  BrowserId,
  BrowserKey,
  HistoryEntry,
  IBrowserService,
  ListBookmarksFilter,
  OpenUrlTarget,
  SearchHistoryOptions,
  Tab,
  TabsChangedEvent,
} from './IBrowserService';

interface TabsChangedState {
  subscriptionIdPromise: Promise<string>;
  callbacks: Set<(e: TabsChangedEvent) => void>;
}

export class BrowserServiceProxy extends BaseServiceProxy implements IBrowserService {
  // Per-kind ref-counting state mirroring SystemEventsServiceProxy.
  // Currently the proxy only subscribes to 'tabs.changed', but the map shape
  // keeps the door open for future browser event kinds without restructuring.
  private states = new Map<'tabs.changed', TabsChangedState>();
  private pushListenerInstalled = false;

  listAvailableBrowsers(): Promise<BrowserId[]> {
    return this.broker.invoke<BrowserId[]>('browser:listAvailableBrowsers', {}, undefined, 5000);
  }

  isCompanionInstalled(family: BrowserFamily): Promise<boolean> {
    return this.broker.invoke<boolean>(
      'browser:isCompanionInstalled',
      { family },
      undefined,
      5000,
    );
  }

  listBookmarks(filter?: ListBookmarksFilter): Promise<Bookmark[]> {
    return this.broker.invoke<Bookmark[]>(
      'browser:listBookmarks',
      { filter: filter ?? {} },
      undefined,
      5000,
    );
  }

  searchHistory(query: string, opts?: SearchHistoryOptions): Promise<HistoryEntry[]> {
    return this.broker.invoke<HistoryEntry[]>(
      'browser:searchHistory',
      { query, opts: opts ?? {} },
      undefined,
      5000,
    );
  }

  listTabs(filter?: { browser?: BrowserId; query?: string }): Promise<Tab[]> {
    return this.broker.invoke<Tab[]>(
      'browser:listTabs',
      { filter: filter ?? {} },
      undefined,
      5000,
    );
  }

  getActiveTab(browser?: BrowserId): Promise<Tab | null> {
    return this.broker.invoke<Tab | null>(
      'browser:getActiveTab',
      { browser },
      undefined,
      5000,
    );
  }

  activateTab(tabId: string): Promise<void> {
    return this.broker.invoke<void>('browser:activateTab', { tabId }, undefined, 5000);
  }

  closeTab(tabId: string): Promise<void> {
    return this.broker.invoke<void>('browser:closeTab', { tabId }, undefined, 5000);
  }

  openUrl(url: string, target?: OpenUrlTarget): Promise<void> {
    return this.broker.invoke<void>(
      'browser:openUrl',
      { url, target: target ?? {} },
      undefined,
      5000,
    );
  }

  listPairedBrowsers(): Promise<BrowserKey[]> {
    return this.broker.invoke<BrowserKey[]>(
      'browser:listPairedBrowsers',
      {},
      undefined,
      5000,
    );
  }

  onTabsChanged(handler: (e: TabsChangedEvent) => void): () => void {
    this.ensurePushListener();
    let state = this.states.get('tabs.changed');
    if (!state) {
      const subscriptionIdPromise = this.broker.invoke<string>(
        'browser:subscribeEvents',
        { eventTypes: ['tabs.changed'] },
        undefined,
        5000,
      );
      state = { subscriptionIdPromise, callbacks: new Set() };
      this.states.set('tabs.changed', state);
    }
    state.callbacks.add(handler);

    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      const s = this.states.get('tabs.changed');
      if (!s) return;
      s.callbacks.delete(handler);
      if (s.callbacks.size === 0) {
        this.states.delete('tabs.changed');
        s.subscriptionIdPromise
          .then((id) =>
            this.broker.invoke<void>(
              'browser:unsubscribeEvents',
              { subscriptionId: id },
              undefined,
              5000,
            ),
          )
          .catch(() => {
            // Subscribe failed; nothing to unsubscribe.
          });
      }
    };
  }

  private ensurePushListener(): void {
    if (this.pushListenerInstalled) return;
    this.pushListenerInstalled = true;
    this.broker.on('asyar:event:browser-event:push', (payload: unknown) => {
      if (!payload || typeof payload !== 'object' || !('type' in payload)) return;
      const env = payload as { type: string } & TabsChangedEvent;
      if (env.type !== 'tabs-changed') return;
      const state = this.states.get('tabs.changed');
      if (!state) return;
      for (const cb of state.callbacks) {
        try {
          cb(env);
        } catch {
          // One bad callback must not block the rest on this push.
        }
      }
    });
  }
}
