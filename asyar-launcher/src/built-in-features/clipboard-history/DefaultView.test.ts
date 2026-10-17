/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';

// Hoisted so the store mock below can list them. The text item comes first so
// the view's initial auto-selection doesn't start an image read.
const items = vi.hoisted((): Record<string, any> => ({
  text: { id: 'text', type: 'text', content: 'hello', createdAt: 0 },
  img: { id: 'img', type: 'image', content: '/cache/big.png', createdAt: 0 },
  img2: { id: 'img2', type: 'image', content: '/cache/other.png', createdAt: 0 },
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

vi.mock('@tauri-apps/plugin-opener', () => ({
  revealItemInDir: vi.fn(),
}));

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
    fetchFullItem: vi.fn((id: string) => Promise.resolve(items[id] ?? null)),
    deleteHistoryItem: vi.fn().mockResolvedValue({ imageContentPath: undefined }),
  },
}));

vi.mock('../../services/feedback/feedbackService.svelte', () => ({
  feedbackService: { report: vi.fn() },
}));

vi.mock('../../services/log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../utils/mermaid', () => ({
  renderMermaidDiagrams: vi.fn(),
}));

vi.mock('../../lib/ipc/bridgeEvents', () => ({
  appListen: vi.fn().mockResolvedValue(() => {}),
}));

import DefaultView from './DefaultView.svelte';
import { clipboardViewState } from './state.svelte';

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

describe('DefaultView image preview', () => {
  let urlCount = 0;
  const createObjectURL = vi.fn(() => `blob:test/${++urlCount}`);
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    urlCount = 0;
    pendingReads.clear();
    mockReadFile.mockClear();
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }));
    clipboardViewState.selectedItemId = null as any;
  });

  afterEach(() => {
    cleanup();
  });

  it('ignores an image read that finishes after the selection moved on', async () => {
    render(DefaultView);
    await select('img');
    expect(mockReadFile).toHaveBeenCalledWith('/cache/big.png');

    await select('text');
    await finishRead('/cache/big.png');

    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('only shows the latest of two overlapping image reads', async () => {
    const { container } = render(DefaultView);
    await select('img');
    await select('img2');

    await finishRead('/cache/other.png');
    await finishRead('/cache/big.png');

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(container.querySelector('img[src="blob:test/1"]')).not.toBeNull();
  });

  it('revokes the image blob URL on unmount', async () => {
    const { unmount } = render(DefaultView);
    await select('img');
    await finishRead('/cache/big.png');
    expect(createObjectURL).toHaveBeenCalledTimes(1);

    unmount();

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test/1');
  });

  it('does not create a blob URL for a read that finishes after unmount', async () => {
    const { unmount } = render(DefaultView);
    await select('img');
    unmount();

    await finishRead('/cache/big.png');

    expect(createObjectURL).not.toHaveBeenCalled();
  });
});
