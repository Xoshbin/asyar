import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock MessageBroker BEFORE import (matches CacheServiceProxy.test.ts pattern)
vi.mock('../ipc/MessageBroker', () => {
  return {
    messageBroker: {
      invoke: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    },
  };
});

import { BrowserServiceProxy } from './BrowserServiceProxy';
import { messageBroker } from '../ipc/MessageBroker';

describe('BrowserServiceProxy', () => {
  let proxy: BrowserServiceProxy;
  let mockBroker: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockBroker = messageBroker;
    proxy = new BrowserServiceProxy();
  });

  it('listAvailableBrowsers invokes browser:listAvailableBrowsers', async () => {
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce([]);
    await proxy.listAvailableBrowsers();
    expect(mockBroker.invoke).toHaveBeenCalledWith(
      'browser:listAvailableBrowsers',
      {},
      undefined,
      5000,
    );
  });

  it('isCompanionInstalled invokes browser:isCompanionInstalled with family', async () => {
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce(false);
    await proxy.isCompanionInstalled('firefox');
    expect(mockBroker.invoke).toHaveBeenCalledWith(
      'browser:isCompanionInstalled',
      { family: 'firefox' },
      undefined,
      5000,
    );
  });

  it('listBookmarks forwards filter', async () => {
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce([]);
    await proxy.listBookmarks({ query: 'doc' });
    expect(mockBroker.invoke).toHaveBeenCalledWith(
      'browser:listBookmarks',
      { filter: { query: 'doc' } },
      undefined,
      5000,
    );
  });

  it('searchHistory forwards query + opts', async () => {
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce([]);
    await proxy.searchHistory('rust', { limit: 10 });
    expect(mockBroker.invoke).toHaveBeenCalledWith(
      'browser:searchHistory',
      { query: 'rust', opts: { limit: 10 } },
      undefined,
      5000,
    );
  });
});

describe('BrowserServiceProxy — bridge methods', () => {
  let proxy: BrowserServiceProxy;
  let mockBroker: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockBroker = messageBroker;
    proxy = new BrowserServiceProxy();
  });

  it('listTabs invokes browser:listTabs', async () => {
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce([]);
    await proxy.listTabs({ query: 'react' });
    expect(mockBroker.invoke).toHaveBeenCalledWith(
      'browser:listTabs',
      { filter: { query: 'react' } },
      undefined,
      5000,
    );
  });

  it('activateTab invokes browser:activateTab', async () => {
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce(undefined);
    await proxy.activateTab('t1');
    expect(mockBroker.invoke).toHaveBeenCalledWith(
      'browser:activateTab',
      { tabId: 't1' },
      undefined,
      5000,
    );
  });

  it('openUrl invokes browser:openUrl with target', async () => {
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce(undefined);
    await proxy.openUrl('https://x', { newWindow: true });
    expect(mockBroker.invoke).toHaveBeenCalledWith(
      'browser:openUrl',
      { url: 'https://x', target: { newWindow: true } },
      undefined,
      5000,
    );
  });

  it('getCurrentPage invokes browser:getCurrentPage with timeout 10000', async () => {
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce(null);
    await proxy.getCurrentPage();
    expect(mockBroker.invoke).toHaveBeenCalledWith(
      'browser:getCurrentPage',
      { browser: undefined },
      undefined,
      10000,
    );
  });

  it('queryPage invokes browser:queryPage with timeout 10000', async () => {
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce([]);
    await proxy.queryPage('t1', 'body', ['class']);
    expect(mockBroker.invoke).toHaveBeenCalledWith(
      'browser:queryPage',
      { tabId: 't1', selector: 'body', attrs: ['class'] },
      undefined,
      10000,
    );
  });

  it('actOnPage invokes browser:actOnPage with timeout 10000', async () => {
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce(undefined);
    await proxy.actOnPage('t1', { kind: 'goBack' });
    expect(mockBroker.invoke).toHaveBeenCalledWith(
      'browser:actOnPage',
      { tabId: 't1', action: { kind: 'goBack' } },
      undefined,
      10000,
    );
  });

});

describe('BrowserServiceProxy.onTabsChanged — subscribe pattern', () => {
  let proxy: BrowserServiceProxy;
  let invokeMock: ReturnType<typeof vi.fn>;
  let onMock: ReturnType<typeof vi.fn>;
  let offMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    invokeMock = vi.fn();
    onMock = vi.fn();
    offMock = vi.fn();
    proxy = new BrowserServiceProxy();
    (proxy as unknown as { broker: unknown }).broker = {
      invoke: invokeMock,
      on: onMock,
      off: offMock,
    };
  });

  it('first listener issues browser:subscribeTabsChanged and installs push listener once', () => {
    invokeMock.mockResolvedValueOnce('sub-1');
    const handler = vi.fn();
    proxy.onTabsChanged(handler);

    expect(invokeMock).toHaveBeenCalledWith(
      'browser:subscribeTabsChanged',
      {},
      undefined,
      5000,
    );
    expect(onMock).toHaveBeenCalledWith('asyar:event:browser-event:push', expect.any(Function));
    expect(onMock).toHaveBeenCalledTimes(1);

    // Second listener: no new subscribe, no new push listener.
    invokeMock.mockClear();
    onMock.mockClear();
    proxy.onTabsChanged(vi.fn());
    expect(invokeMock).not.toHaveBeenCalled();
    expect(onMock).not.toHaveBeenCalled();
  });

  it('disposer issues browser:unsubscribeTabsChanged only when last listener is removed', async () => {
    let resolveSub: (v: string) => void = () => {};
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'browser:subscribeTabsChanged') {
        return new Promise<string>((res) => {
          resolveSub = res;
        });
      }
      return Promise.resolve(undefined);
    });

    const dispose1 = proxy.onTabsChanged(vi.fn());
    const dispose2 = proxy.onTabsChanged(vi.fn());
    resolveSub('sub-1');
    await Promise.resolve();

    // Disposing one of two listeners must NOT unsubscribe.
    dispose1();
    // Allow any microtask flush.
    await Promise.resolve();
    await Promise.resolve();
    const unsubCallsAfterFirstDispose = invokeMock.mock.calls.filter(
      (c) => c[0] === 'browser:unsubscribeTabsChanged',
    );
    expect(unsubCallsAfterFirstDispose).toHaveLength(0);

    dispose2();
    await Promise.resolve();
    await Promise.resolve();
    const unsubCalls = invokeMock.mock.calls.filter(
      (c) => c[0] === 'browser:unsubscribeTabsChanged',
    );
    expect(unsubCalls).toHaveLength(1);
    expect(unsubCalls[0]).toEqual([
      'browser:unsubscribeTabsChanged',
      { subscriptionId: 'sub-1' },
      undefined,
      5000,
    ]);
  });

  it('disposer is idempotent', async () => {
    invokeMock.mockResolvedValue('sub-1');
    const dispose = proxy.onTabsChanged(vi.fn());
    await Promise.resolve();
    dispose();
    await Promise.resolve();
    await Promise.resolve();
    const unsubCount = invokeMock.mock.calls.filter(
      (c) => c[0] === 'browser:unsubscribeTabsChanged',
    ).length;
    dispose();
    await Promise.resolve();
    await Promise.resolve();
    const unsubCountAfter = invokeMock.mock.calls.filter(
      (c) => c[0] === 'browser:unsubscribeTabsChanged',
    ).length;
    expect(unsubCountAfter).toBe(unsubCount); // No extra unsubscribe on second call.
  });

  it('only fires callbacks for matching tabs-changed payload', () => {
    invokeMock.mockResolvedValue('sub-1');
    let pushHandler: ((payload: unknown) => void) | undefined;
    onMock.mockImplementation((event: string, h: (p: unknown) => void) => {
      if (event === 'asyar:event:browser-event:push') pushHandler = h;
    });
    const handler = vi.fn();
    proxy.onTabsChanged(handler);

    expect(pushHandler).toBeDefined();

    // Wrong shape: ignored.
    pushHandler!(null);
    pushHandler!({});
    pushHandler!({ type: 'something-else', tabs: [] });
    expect(handler).not.toHaveBeenCalled();

    // Correct shape: fired.
    const evt = {
      type: 'tabs-changed' as const,
      browser: { family: 'chromium' as const, variant: 'chrome' },
      tabs: [],
    };
    pushHandler!(evt);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(evt);
  });

  it('a thrown callback does not block other callbacks on the same kind', () => {
    invokeMock.mockResolvedValue('sub-1');
    let pushHandler: ((payload: unknown) => void) | undefined;
    onMock.mockImplementation((event: string, h: (p: unknown) => void) => {
      if (event === 'asyar:event:browser-event:push') pushHandler = h;
    });

    const a = vi.fn(() => { throw new Error('bad'); });
    const b = vi.fn();
    proxy.onTabsChanged(a);
    proxy.onTabsChanged(b);

    pushHandler!({
      type: 'tabs-changed',
      browser: { family: 'chromium', variant: 'chrome' },
      tabs: [],
    });

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});

describe('BrowserServiceProxy.onPageChanged — subscribe pattern', () => {
  let proxy: BrowserServiceProxy;
  let invokeMock: ReturnType<typeof vi.fn>;
  let onMock: ReturnType<typeof vi.fn>;
  let offMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    invokeMock = vi.fn();
    onMock = vi.fn();
    offMock = vi.fn();
    proxy = new BrowserServiceProxy();
    (proxy as unknown as { broker: unknown }).broker = {
      invoke: invokeMock,
      on: onMock,
      off: offMock,
    };
  });

  it('first listener issues browser:subscribePageChanged with empty payload (host hard-codes eventTypes)', () => {
    invokeMock.mockResolvedValueOnce('sub-pg');
    proxy.onPageChanged(vi.fn());

    expect(invokeMock).toHaveBeenCalledWith(
      'browser:subscribePageChanged',
      {},
      undefined,
      5000,
    );
    expect(onMock).toHaveBeenCalledWith('asyar:event:browser-event:push', expect.any(Function));
  });

  it('tabs-changed payload does NOT fire page-changed callback (isolation)', () => {
    invokeMock.mockResolvedValue('sub');
    let pushHandler: ((p: unknown) => void) | undefined;
    onMock.mockImplementation((event: string, h: (p: unknown) => void) => {
      if (event === 'asyar:event:browser-event:push') pushHandler = h;
    });

    const pageHandler = vi.fn();
    const tabsHandler = vi.fn();
    proxy.onPageChanged(pageHandler);
    proxy.onTabsChanged(tabsHandler);

    expect(pushHandler).toBeDefined();

    pushHandler!({
      type: 'page-changed',
      browser: { family: 'chromium', variant: 'chrome' },
      tabId: 't1',
      page: { url: 'x', title: 'T', readableText: 'body', meta: {} },
    });
    expect(pageHandler).toHaveBeenCalledTimes(1);
    expect(tabsHandler).toHaveBeenCalledTimes(0);

    pushHandler!({
      type: 'tabs-changed',
      browser: { family: 'chromium', variant: 'chrome' },
      tabs: [],
    });
    expect(pageHandler).toHaveBeenCalledTimes(1);
    expect(tabsHandler).toHaveBeenCalledTimes(1);
  });

  it('disposer issues browser:unsubscribePageChanged when last listener leaves', async () => {
    let resolveSub: (v: string) => void = () => {};
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'browser:subscribePageChanged') {
        return new Promise<string>((res) => { resolveSub = res; });
      }
      return Promise.resolve(undefined);
    });

    const dispose = proxy.onPageChanged(vi.fn());
    resolveSub('sub-pg');
    await Promise.resolve();
    dispose();
    await Promise.resolve();
    await Promise.resolve();

    const unsubCalls = invokeMock.mock.calls.filter(
      (c) => c[0] === 'browser:unsubscribePageChanged',
    );
    expect(unsubCalls).toHaveLength(1);
    expect(unsubCalls[0]).toEqual([
      'browser:unsubscribePageChanged',
      { subscriptionId: 'sub-pg' },
      undefined,
      5000,
    ]);
  });
});
