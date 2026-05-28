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
  PageAction,
  PageChangedEvent,
  PageMatch,
  PageSnapshot,
  SearchHistoryOptions,
  Tab,
  TabsChangedEvent,
} from './IBrowserService';

interface KindState {
  subscriptionIdPromise: Promise<string>;
  callbacks: Set<(e: unknown) => void>;
}

export class BrowserServiceProxy extends BaseServiceProxy implements IBrowserService {
  // Per-kind ref-counting state mirroring SystemEventsServiceProxy. Each kind
  // owns its own subscriptionId so we can ref-count + unsubscribe independently.
  private states = new Map<'tabs.changed' | 'page.changed', KindState>();
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
    return this.subscribe<TabsChangedEvent>(
      'tabs.changed',
      'browser:subscribeTabsChanged',
      'browser:unsubscribeTabsChanged',
      handler,
    );
  }

  onPageChanged(handler: (e: PageChangedEvent) => void): () => void {
    return this.subscribe<PageChangedEvent>(
      'page.changed',
      'browser:subscribePageChanged',
      'browser:unsubscribePageChanged',
      handler,
    );
  }

  private subscribe<E>(
    kind: 'tabs.changed' | 'page.changed',
    subscribeMethod: `browser:${string}`,
    unsubscribeMethod: `browser:${string}`,
    handler: (e: E) => void,
  ): () => void {
    this.ensurePushListener();
    let state = this.states.get(kind);
    if (!state) {
      const subscriptionIdPromise = this.broker.invoke<string>(
        subscribeMethod,
        {},
        undefined,
        5000,
      );
      state = { subscriptionIdPromise, callbacks: new Set() };
      this.states.set(kind, state);
    }
    const wrapped = (e: unknown) => handler(e as E);
    state.callbacks.add(wrapped);

    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      const s = this.states.get(kind);
      if (!s) return;
      s.callbacks.delete(wrapped);
      if (s.callbacks.size === 0) {
        this.states.delete(kind);
        s.subscriptionIdPromise
          .then((id) =>
            this.broker.invoke<void>(unsubscribeMethod, { subscriptionId: id }, undefined, 5000),
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
      const env = payload as { type: string };
      const kind =
        env.type === 'tabs-changed' ? 'tabs.changed' as const :
        env.type === 'page-changed' ? 'page.changed' as const :
        null;
      if (!kind) return;
      const state = this.states.get(kind);
      if (!state) return;
      for (const cb of state.callbacks) {
        try {
          cb(payload);
        } catch {
          // One bad callback must not block the rest on this push.
        }
      }
    });
  }

  // — Page content methods (Plan 3)

  getCurrentPage(browser?: BrowserId): Promise<PageSnapshot | null> {
    return this.broker.invoke<PageSnapshot | null>(
      'browser:getCurrentPage',
      { browser },
      undefined,
      10000,
    );
  }

  queryPage(tabId: string, selector: string, attrs?: string[]): Promise<PageMatch[]> {
    return this.broker.invoke<PageMatch[]>(
      'browser:queryPage',
      { tabId, selector, attrs },
      undefined,
      10000,
    );
  }

  actOnPage(tabId: string, action: PageAction): Promise<void> {
    return this.broker.invoke<void>(
      'browser:actOnPage',
      { tabId, action },
      undefined,
      10000,
    );
  }
}
