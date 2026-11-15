/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import type { StoredClipboardItem, StoredClipboardListItem } from '../../lib/ipc/commands';

// Hoisted so the store mock below can list them. The text item comes first so
// the view's initial auto-selection doesn't start an image read.
const items = vi.hoisted((): Record<string, any> => ({
  text: { id: 'text', type: 'text', content: 'hello', createdAt: 0 },
  img: { id: 'img', type: 'image', content: '/cache/big.png', createdAt: 0 },
  img2: { id: 'img2', type: 'image', content: '/cache/other.png', createdAt: 0 },
  url: { id: 'url', type: 'text', content: 'https://example.com/page', createdAt: 0 },
}));

const pendingReads = new Map<string, (data: Uint8Array) => void>();
const mockReadFile = vi.fn(
  (path: string) =>
    new Promise<Uint8Array>((resolve) => {
      pendingReads.set(path, resolve);
    }),
);

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  transformCallback: vi.fn(() => 0),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  readFile: (path: string) => mockReadFile(path),
}));

const mockRevealItemInDir = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@tauri-apps/plugin-opener', () => ({
  revealItemInDir: (path: string) => mockRevealItemInDir(path),
}));

const mockHostPlatform = vi.hoisted(() =>
  vi.fn<() => 'macos' | 'windows' | 'other'>(() => 'macos'),
);

vi.mock('../../lib/keyboard/hostPlatform', () => ({
  getHostPlatform: () => mockHostPlatform(),
}));

const mockOpenPath = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('../../services/opener/openerService', () => ({
  openerService: {
    open: vi.fn().mockResolvedValue(undefined),
    openPath: (caller: string | null, path: string, options?: { with?: string }) =>
      mockOpenPath(caller, path, options),
    reveal: vi.fn().mockResolvedValue(undefined),
  },
}));

const mockGetFileThumbnail = vi.hoisted(() => vi.fn().mockResolvedValue(null));

vi.mock('../../lib/ipc/thumbnailCommands', () => ({
  getFileThumbnail: (path: string, maxDim: number) => mockGetFileThumbnail(path, maxDim),
}));

const mockFetchFullItem = vi.hoisted(() =>
  vi.fn((id: string) => Promise.resolve((items[id] as StoredClipboardItem | undefined) ?? null)),
);

vi.mock('../../services/clipboard/stores/clipboardHistoryStore.svelte', () => ({
  clipboardHistoryStore: {
    favorites: [],
    recent: Object.values(items),
    searchResults: null,
    nextOlderCursor: undefined,
    loadInitial: vi.fn().mockResolvedValue(undefined),
    loadOlder: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue(undefined),
    clearSearch: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    fetchFullItem: (id: string) => mockFetchFullItem(id),
    deleteHistoryItem: vi.fn().mockResolvedValue({ imageContentPath: undefined }),
  },
}));

const mockFeedbackReport = vi.hoisted(() => vi.fn());
const mockShowHUD = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('../../services/feedback/feedbackService.svelte', () => ({
  feedbackService: { report: mockFeedbackReport, showHUD: mockShowHUD },
}));

const mockLogError = vi.hoisted(() => vi.fn());

vi.mock('../../services/log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: mockLogError },
}));

vi.mock('../../utils/mermaid', () => ({
  renderMermaidDiagrams: vi.fn(),
}));

const appListenHandlers = vi.hoisted(() => new Map<string, () => void>());
const mockAppListen = vi.hoisted(() =>
  vi.fn((event: string, cb: () => void) => {
    appListenHandlers.set(event, cb);
    return Promise.resolve(() => {
      if (appListenHandlers.get(event) === cb) {
        appListenHandlers.delete(event);
      }
    });
  }),
);

vi.mock('../../lib/ipc/bridgeEvents', () => ({
  appListen: mockAppListen,
}));

vi.mock('./urlFetcher', () => ({
  fetchRawHtml: vi.fn().mockResolvedValue({ status: 'ok', html: '<html>preview</html>' }),
}));

import DefaultView from './DefaultView.svelte';
import { clipboardViewState } from './state.svelte';
import { clipboardHistoryStore } from '../../services/clipboard/stores/clipboardHistoryStore.svelte';
import { viewManager } from '../../services/extension/viewManager.svelte';

// Let the selection effect fetch the item and kick off loadImage.
async function flush() {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
    await tick();
  }
}

async function select(id: string) {
  clipboardViewState.selectedItemId = id;
  await flush();
}

async function finishRead(path: string) {
  pendingReads.get(path)?.(new Uint8Array([1, 2, 3]));
  pendingReads.delete(path);
  await flush();
}

class MockURL extends URL {
  static createObjectURL = vi.fn();
  static revokeObjectURL = vi.fn();
}

describe('DefaultView image preview', () => {
  let urlCount = 0;

  beforeEach(() => {
    urlCount = 0;
    mockReadFile.mockClear();
    mockHostPlatform.mockReturnValue('macos');
    mockRevealItemInDir.mockReset().mockResolvedValue(undefined);
    mockOpenPath.mockReset().mockResolvedValue(undefined);
    mockGetFileThumbnail.mockReset().mockResolvedValue(null);
    MockURL.createObjectURL.mockReset().mockImplementation(() => `blob:test/${++urlCount}`);
    MockURL.revokeObjectURL.mockReset();
    vi.stubGlobal('URL', MockURL);
    clipboardViewState.reset();
    clipboardHistoryStore.recent = Object.values(items);
    clipboardHistoryStore.favorites = [];
    pendingReads.clear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    clipboardViewState.reset();
    clipboardHistoryStore.recent = Object.values(items);
    clipboardHistoryStore.favorites = [];
    pendingReads.clear();
  });

  it('ignores an image read that finishes after the selection moved on', async () => {
    render(DefaultView);
    await select('img');
    expect(mockReadFile).toHaveBeenCalledWith('/cache/big.png');

    await select('text');
    await finishRead('/cache/big.png');

    expect(MockURL.createObjectURL).not.toHaveBeenCalled();
  });

  it('only shows the latest of two overlapping image reads', async () => {
    const { container } = render(DefaultView);
    await select('img');
    await select('img2');

    await finishRead('/cache/other.png');
    await finishRead('/cache/big.png');

    expect(MockURL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(container.querySelector('img[src="blob:test/1"]')).not.toBeNull();
  });

  it('revokes the image blob URL on unmount', async () => {
    const { unmount } = render(DefaultView);
    await select('img');
    await finishRead('/cache/big.png');
    expect(MockURL.createObjectURL).toHaveBeenCalledTimes(1);

    unmount();

    expect(MockURL.revokeObjectURL).toHaveBeenCalledWith('blob:test/1');
  });

  it('does not create a blob URL for a read that finishes after unmount', async () => {
    const { unmount } = render(DefaultView);
    await select('img');
    unmount();

    await finishRead('/cache/big.png');

    expect(MockURL.createObjectURL).not.toHaveBeenCalled();
  });

  it('revokes the rendered URL blob URL on unmount', async () => {
    clipboardViewState.showRenderedHtml = true;
    clipboardViewState.networkService = { fetch: vi.fn() } as any;
    const { unmount } = render(DefaultView);

    await select('url');

    expect(MockURL.createObjectURL).toHaveBeenCalledTimes(1);
    const urlBlobUrl = MockURL.createObjectURL.mock.results[0].value;

    unmount();

    expect(MockURL.revokeObjectURL).toHaveBeenCalledWith(urlBlobUrl);
  });

  it('subscribes to clipboardHistoryStore on mount and cleans up on unmount', () => {
    const mockUnsub = vi.fn();
    vi.mocked(clipboardHistoryStore.subscribe).mockReturnValueOnce(mockUnsub);

    const { unmount } = render(DefaultView);
    expect(clipboardHistoryStore.subscribe).toHaveBeenCalled();

    unmount();
    expect(mockUnsub).toHaveBeenCalled();
  });

  it('renders a pin badge on favorite clips', async () => {
    clipboardHistoryStore.favorites = [
      { id: 'fav1', type: 'text', content: 'pinned clip', favorite: true, createdAt: 100 } as any,
    ];
    clipboardHistoryStore.recent = [];
    const { unmount } = render(DefaultView);
    await flush();

    const pinBadge = screen.getByTestId('clip-pin-icon');
    expect(pinBadge).toBeTruthy();
    expect(pinBadge.getAttribute('aria-label')).toBeTruthy();
    unmount();
  });

  it('renders metadata list for selected clipboard item', async () => {
    const { unmount } = render(DefaultView);
    await select('text');

    expect(screen.getByText('Type')).toBeTruthy();
    expect(screen.getByText('text')).toBeTruthy();
    expect(screen.getByText('Characters')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy();
    unmount();
  });
});

describe('DefaultView preview context menu', () => {
  let urlCount = 0;
  let origScrollIntoView: PropertyDescriptor | undefined;

  function setClipboardItems(
    recent: StoredClipboardListItem[],
    fullById: Record<string, StoredClipboardItem> = {},
  ) {
    clipboardHistoryStore.recent = recent;
    mockFetchFullItem.mockImplementation((id: string) =>
      Promise.resolve(fullById[id] ?? (items[id] as StoredClipboardItem | undefined) ?? null),
    );
  }

  beforeEach(() => {
    urlCount = 0;
    origScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
    if (!Element.prototype.scrollIntoView) {
      Element.prototype.scrollIntoView = vi.fn();
    }
    mockReadFile.mockClear();
    mockHostPlatform.mockReturnValue('macos');
    mockRevealItemInDir.mockReset().mockResolvedValue(undefined);
    mockOpenPath.mockReset().mockResolvedValue(undefined);
    mockGetFileThumbnail.mockReset().mockResolvedValue(null);
    mockFeedbackReport.mockReset();
    mockShowHUD.mockReset().mockResolvedValue(undefined);
    mockLogError.mockReset();
    appListenHandlers.clear();
    mockAppListen.mockClear();
    MockURL.createObjectURL.mockReset().mockImplementation(() => `blob:test/${++urlCount}`);
    MockURL.revokeObjectURL.mockReset();
    vi.stubGlobal('URL', MockURL);
    clipboardViewState.reset();
    setClipboardItems(Object.values(items) as StoredClipboardListItem[]);
    clipboardHistoryStore.favorites = [];
    pendingReads.clear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (origScrollIntoView) {
      Object.defineProperty(Element.prototype, 'scrollIntoView', origScrollIntoView);
    } else {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
    clipboardViewState.reset();
    setClipboardItems(Object.values(items) as StoredClipboardListItem[]);
    clipboardHistoryStore.favorites = [];
    pendingReads.clear();
  });

  it('prevents the default context menu and opens Preview on macOS', async () => {
    const { container, unmount } = render(DefaultView);
    await select('img');
    await finishRead('/cache/big.png');

    const img = container.querySelector('img[src="blob:test/1"]');
    expect(img).not.toBeNull();

    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 120,
      clientY: 160,
    });
    const dispatchResult = img!.dispatchEvent(event);
    expect(dispatchResult).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    await flush();

    const menu = screen.getByRole('menu');
    expect(menu.hasAttribute('data-no-focus-steal')).toBe(true);
    expect(screen.getAllByRole('menuitem')).toHaveLength(2);
    const openBtn = screen.getByRole('menuitem', { name: 'Open in Preview' });
    expect(openBtn).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Reveal in Finder' })).toBeTruthy();

    await fireEvent.click(openBtn);
    await flush();
    expect(mockOpenPath).toHaveBeenCalledWith(null, '/cache/big.png', {
      with: 'Preview',
    });
    expect(screen.queryByRole('menu')).toBeNull();
    unmount();
  });

  it('uses default viewer and platform reveal label outside macOS', async () => {
    mockHostPlatform.mockReturnValue('windows');
    const { container, unmount } = render(DefaultView);
    await select('img');
    await finishRead('/cache/big.png');

    const img = container.querySelector('img[src="blob:test/1"]')!;
    await fireEvent.contextMenu(img, { clientX: 80, clientY: 90 });
    await flush();

    const openBtn = screen.getByRole('menuitem', { name: 'Open Image' });
    expect(screen.getByRole('menuitem', { name: 'Show in File Explorer' })).toBeTruthy();
    await fireEvent.click(openBtn);
    await flush();

    expect(mockOpenPath).toHaveBeenCalledWith(null, '/cache/big.png', undefined);
    unmount();
  });

  it('reveals the image file in Finder', async () => {
    const { container, unmount } = render(DefaultView);
    await select('img');
    await finishRead('/cache/big.png');

    const img = container.querySelector('img[src="blob:test/1"]')!;
    await fireEvent.contextMenu(img);
    await flush();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Reveal in Finder' }));
    await flush();
    expect(mockRevealItemInDir).toHaveBeenCalledWith('/cache/big.png');
    expect(screen.queryByRole('menu')).toBeNull();
    unmount();
  });

  it('supports preview context menu on single image file thumbnails', async () => {
    vi.useFakeTimers();
    mockGetFileThumbnail.mockResolvedValue('asyar-thumb://shot');
    const fileItem: StoredClipboardItem = {
      id: 'shot',
      type: 'files',
      content: JSON.stringify(['/Users/test/Screenshot.png']),
      preview: 'Screenshot.png',
      createdAt: 0,
      favorite: false,
    };
    setClipboardItems([items.text as StoredClipboardListItem, fileItem], { shot: fileItem });

    const { container, unmount } = render(DefaultView);
    await select('shot');
    await vi.advanceTimersByTimeAsync(200);
    await flush();

    const thumb = container.querySelector('img.file-solo-thumb')!;
    expect(thumb).not.toBeNull();

    await fireEvent.contextMenu(thumb);
    await flush();
    expect(screen.getAllByRole('menuitem')).toHaveLength(2);
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Open in Preview' }));
    await flush();
    expect(mockOpenPath).toHaveBeenCalledWith(null, '/Users/test/Screenshot.png', {
      with: 'Preview',
    });

    await fireEvent.contextMenu(thumb);
    await flush();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Reveal in Finder' }));
    await flush();
    expect(mockRevealItemInDir).toHaveBeenCalledWith('/Users/test/Screenshot.png');
    unmount();
  });

  it('uses generic Open action on non-image solo file thumbnails', async () => {
    vi.useFakeTimers();
    mockGetFileThumbnail.mockResolvedValue('asyar-thumb://pdf');
    const pdfItem: StoredClipboardItem = {
      id: 'pdf',
      type: 'files',
      content: JSON.stringify(['/Users/test/Report.pdf']),
      preview: 'Report.pdf',
      createdAt: 0,
      favorite: false,
    };
    setClipboardItems([items.text as StoredClipboardListItem, pdfItem], { pdf: pdfItem });

    const { container, unmount } = render(DefaultView);
    await select('pdf');
    await vi.advanceTimersByTimeAsync(200);
    await flush();

    const thumb = container.querySelector('img.file-solo-thumb')!;
    expect(thumb).not.toBeNull();

    await fireEvent.contextMenu(thumb);
    await flush();
    expect(screen.getAllByRole('menuitem')).toHaveLength(2);
    expect(screen.queryByRole('menuitem', { name: 'Open in Preview' })).toBeNull();

    const openBtn = screen.getByRole('menuitem', { name: 'Open' });
    await fireEvent.click(openBtn);
    await flush();
    expect(mockOpenPath).toHaveBeenCalledWith(null, '/Users/test/Report.pdf', undefined);
    unmount();
  });

  it('opens .heic thumbnails in Preview', async () => {
    vi.useFakeTimers();
    mockGetFileThumbnail.mockResolvedValue('asyar-thumb://heic');
    const heicItem: StoredClipboardItem = {
      id: 'heic',
      type: 'files',
      content: JSON.stringify(['/Users/test/Photo.heic']),
      preview: 'Photo.heic',
      createdAt: 0,
      favorite: false,
    };
    setClipboardItems([items.text as StoredClipboardListItem, heicItem], { heic: heicItem });

    const { container, unmount } = render(DefaultView);
    await select('heic');
    await vi.advanceTimersByTimeAsync(200);
    await flush();

    const thumb = container.querySelector('img.file-solo-thumb')!;
    await fireEvent.contextMenu(thumb);
    await flush();
    expect(screen.getByRole('menuitem', { name: 'Open in Preview' })).toBeTruthy();

    await fireEvent.click(screen.getByRole('menuitem', { name: 'Open in Preview' }));
    await flush();
    expect(mockOpenPath).toHaveBeenCalledWith(null, '/Users/test/Photo.heic', { with: 'Preview' });
    unmount();
  });

  it('suppresses the native context menu on data: URIs without opening the custom menu', async () => {
    const dataUri = 'data:image/png;base64,AAA';
    const legacyItem: StoredClipboardItem = {
      id: 'legacy',
      type: 'image',
      content: dataUri,
      preview: 'Image',
      createdAt: 0,
      favorite: false,
    };
    setClipboardItems([items.text as StoredClipboardListItem, legacyItem], { legacy: legacyItem });

    const { container, unmount } = render(DefaultView);
    await select('legacy');
    await finishRead(dataUri);

    const img = container.querySelector('img[src="blob:test/1"]');
    expect(img).not.toBeNull();

    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    const dispatchResult = img!.dispatchEvent(event);
    expect(dispatchResult).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    await flush();
    expect(screen.queryByRole('menu')).toBeNull();
    unmount();
  });

  it('reports a manual diagnostic error when opening the preview file fails', async () => {
    mockOpenPath.mockRejectedValueOnce(new Error('No application found'));
    const { container, unmount } = render(DefaultView);
    await select('img');
    await finishRead('/cache/big.png');

    const img = container.querySelector('img[src="blob:test/1"]')!;
    await fireEvent.contextMenu(img);
    await flush();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Open in Preview' }));
    await flush();

    expect(mockLogError).toHaveBeenCalled();
    expect(mockFeedbackReport).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'frontend',
        kind: 'manual',
        severity: 'error',
        context: { message: 'Could not open /cache/big.png' },
      }),
    );
    unmount();
  });

  it('dismisses the context menu via viewManager Escape interceptor, window Escape, outside pointerdown, and panel resign', async () => {
    const { container, unmount } = render(DefaultView);
    await select('img');
    await finishRead('/cache/big.png');

    const img = container.querySelector('img[src="blob:test/1"]')!;
    await fireEvent.contextMenu(img);
    await flush();
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(viewManager.tryInterceptEscape()).toBe(true);
    await flush();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(viewManager.tryInterceptEscape()).toBe(false);

    await fireEvent.contextMenu(img);
    await flush();
    expect(screen.getByRole('menu')).toBeTruthy();

    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();

    await fireEvent.contextMenu(img);
    await flush();
    expect(screen.getByRole('menu')).toBeTruthy();

    await fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();

    await fireEvent.contextMenu(img);
    await flush();
    expect(screen.getByRole('menu')).toBeTruthy();

    appListenHandlers.get('main_panel_did_resign_key')?.();
    await flush();
    expect(screen.queryByRole('menu')).toBeNull();
    unmount();
  });

  it('focuses the first menu item on open and handles ArrowUp, ArrowDown, Home, End without propagating', async () => {
    const { container, unmount } = render(DefaultView);
    await select('img');
    await finishRead('/cache/big.png');

    const img = container.querySelector('img[src="blob:test/1"]')!;
    await fireEvent.contextMenu(img);
    await flush();

    const menu = screen.getByRole('menu');
    const items = screen.getAllByRole('menuitem');
    expect(items.length).toBe(2);
    expect(document.activeElement).toBe(items[0]);

    const windowKeydownSpy = vi.fn();
    window.addEventListener('keydown', windowKeydownSpy);

    const dispatchKey = (key: string) => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      menu.dispatchEvent(event);
      return event;
    };

    expect(dispatchKey('ArrowDown').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(items[1]);

    expect(dispatchKey('ArrowDown').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(items[0]);

    expect(dispatchKey('ArrowUp').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(items[1]);

    expect(dispatchKey('Home').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(items[0]);

    expect(dispatchKey('End').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(items[1]);

    expect(windowKeydownSpy).not.toHaveBeenCalled();

    dispatchKey('Escape');
    await flush();
    expect(screen.queryByRole('menu')).toBeNull();

    window.removeEventListener('keydown', windowKeydownSpy);
    unmount();
  });
});
