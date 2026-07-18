### 8.36 `BrowserService` — Read and drive paired browsers

**Runs in:** both worker and view.

**Permission required:** per method — `browser:tabs.read`, `browser:tabs.write`, `browser:bookmarks.read`, `browser:history.read`, `browser:page.read`, `browser:page.write`. Declare only the ones you call. Discovery methods (`listAvailableBrowsers`, `isCompanionInstalled`) need no permission.

`BrowserService` brings the user's browser into your extension. Two data paths back it:

- **On-disk reads** — bookmarks and history are read directly from the browser's own files (JSON / SQLite). These work as long as the browser is installed; no companion is needed.
- **The companion bridge** — tabs and live page content flow over a local WebSocket to the Asyar browser companion extension. The user must install that companion and approve pairing in **Settings → Browsers** first. `isCompanionInstalled(family)` tells you whether a family is currently paired; guard tab/page calls with it. See the [Browser Bridge protocol](../../explanation/browser-bridge-protocol.md) for the wire contract and the [Browser Integration guide](../../guide/features/browser-integration.md) for the user-facing setup.

Chromium-based browsers (Chrome, Brave, Arc, Edge, Vivaldi) are supported today; Firefox and Safari companions are planned.

```typescript
export type BrowserFamily = 'chromium' | 'firefox' | 'safari';

export interface BrowserId {
  family: BrowserFamily;
  variant: string; // 'chrome' | 'brave' | 'arc' | 'edge' | 'vivaldi' | ...
  profileId: string; // e.g. 'Default', 'Profile 1'
}

export interface Tab {
  id: string;
  browser: BrowserId;
  windowId: string;
  index: number;
  title: string;
  url: string;
  faviconUrl?: string;
  isActive: boolean;
  isPinned: boolean;
  isAudible: boolean;
  groupName?: string;
}

export interface PageSnapshot {
  url: string;
  title: string;
  readableText: string;
  html?: string;
  selection?: string;
  meta: { description?: string; ogImage?: string | null; lang?: string };
}

export type PageAction =
  { kind: 'reload' } | { kind: 'goBack' } | { kind: 'goForward' } | { kind: 'scrollToTop' };
```

#### Discovery — no permission

```typescript
listAvailableBrowsers(): Promise<BrowserId[]>;        // browsers with a readable data dir on disk
isCompanionInstalled(family: BrowserFamily): Promise<boolean>; // is the companion paired for this family?
listPairedBrowsers(): Promise<BrowserKey[]>;          // families/variants currently paired
```

#### Bookmarks & history — on-disk reads

```typescript
listBookmarks(filter?: { browser?: BrowserId; query?: string }): Promise<Bookmark[]>; // browser:bookmarks.read
searchHistory(query: string, opts?: { limit?: number; sinceMs?: number }): Promise<HistoryEntry[]>; // browser:history.read
```

#### Tabs — needs the companion

```typescript
listTabs(filter?: { browser?: BrowserId; query?: string }): Promise<Tab[]>; // browser:tabs.read
getActiveTab(browser?: BrowserId): Promise<Tab | null>;                     // browser:tabs.read
getMostRecentActiveBrowser(): Promise<BrowserKey | null>;                   // browser:tabs.read
activateTab(tabId: string): Promise<void>;                                  // browser:tabs.write
closeTab(tabId: string): Promise<void>;                                     // browser:tabs.write
openUrl(url: string, target?: { browser?: BrowserId; newWindow?: boolean }): Promise<void>; // browser:tabs.write
searchWeb(text: string, browser?: BrowserId): Promise<void>;                // browser:tabs.write
```

`openUrl` accepts only the web-default schemes (`http`, `https`, `mailto`, `tel`) plus any your manifest declares in `permissionArgs["shell:open-url"]` — the same allowlist `shell:open-url` uses. Schemeless or relative URLs are rejected.

#### Page content — needs the companion

```typescript
getCurrentPage(browser?: BrowserId): Promise<PageSnapshot | null>;          // browser:page.read
queryPage(tabId: string, selector: string, attrs?: string[]): Promise<PageMatch[]>; // browser:page.read
actOnPage(tabId: string, action: PageAction): Promise<void>;                // browser:page.write
```

#### Live subscriptions

```typescript
onTabsChanged(handler: (e: TabsChangedEvent) => void): () => void;  // browser:tabs.read
onPageChanged(handler: (e: PageChangedEvent) => void): () => void;  // browser:page.read
```

Both return a **synchronous disposer** — call it to unsubscribe. Listeners are ref-counted: the first listener opens one subscription over the bridge and later listeners reuse it; the last disposer tears it down. Disposers are idempotent. Because these fire while the panel is closed, register them from the **worker**.

```typescript
import type { IBrowserService } from 'asyar-sdk/contracts';

const browser = context.getService<IBrowserService>('browser');

if (await browser.isCompanionInstalled('chromium')) {
  const tab = await browser.getActiveTab();
  if (tab) {
    const page = await browser.getCurrentPage();
    // summarize page.readableText, save tab.url, etc.
  }
}
```
