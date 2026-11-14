/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

vi.mock('../../services/log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../services/extension/extensionIframeManager.svelte', () => ({
  extensionIframeManager: { hasInputFocus: false },
}));

vi.mock('../../services/extension/viewRegistry.svelte', () => ({
  viewRegistry: {
    getEntry: vi.fn(() => ({ extensionId: 'org.asyar.google-translate', mountToken: 1 })),
  },
}));

vi.mock('../../lib/themeFonts', () => ({
  buildFontFaceCSS: vi.fn().mockResolvedValue('/* fonts */'),
}));

vi.mock('../../services/feedback/feedbackService.svelte', () => ({
  feedbackService: { report: vi.fn() },
}));

vi.mock('../../services/action/viewShortcutSync.svelte', () => ({
  announceActiveViewShortcuts: vi.fn(),
  forgetAnnouncedShortcuts: vi.fn(),
}));

import ExtensionIframe from './ExtensionIframe.svelte';

describe('ExtensionIframe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete document.documentElement.dataset.theme;
    document.documentElement.style.cssText = '';
  });

  afterEach(() => {
    delete document.documentElement.dataset.theme;
    document.documentElement.style.cssText = '';
  });

  function mockIframePostMessage(iframe: HTMLIFrameElement) {
    const postMessage = vi.fn();
    Object.defineProperty(iframe, 'contentWindow', {
      configurable: true,
      value: { postMessage },
    });
    return postMessage;
  }

  it('includes the resolved theme in iframeSrc and sends color-scheme on load', async () => {
    document.documentElement.dataset.theme = 'dark';

    const { container } = render(ExtensionIframe, {
      extensionId: 'org.asyar.google-translate',
      view: 'org.asyar.google-translate/TranslateView',
      manifest: null,
    });

    const iframe = container.querySelector('iframe') as HTMLIFrameElement;
    expect(iframe).toBeTruthy();

    const url = new URL(iframe.src);
    expect(url.searchParams.get('view')).toBe('TranslateView');
    expect(url.searchParams.get('theme')).toBe('dark');

    const postMessage = mockIframePostMessage(iframe);
    await fireEvent.load(iframe);

    const themeCall = postMessage.mock.calls.find(([msg]) => msg?.type === 'asyar:theme:variables');
    expect(themeCall).toBeTruthy();
    expect(themeCall![0].payload['color-scheme']).toBe('dark');
  });

  describe('load gate', () => {
    const props = {
      extensionId: 'org.asyar.google-translate',
      view: 'org.asyar.google-translate/TranslateView',
      manifest: null,
    };
    const viewA = props.view;
    const viewB = 'org.asyar.google-translate/OtherView';

    function isHidden(iframe: HTMLIFrameElement) {
      const opacityHidden = iframe.classList.contains('opacity-0');
      expect(iframe.inert).toBe(opacityHidden);
      return opacityHidden;
    }

    function setup() {
      const result = render(ExtensionIframe, props);
      const iframe = result.container.querySelector('iframe') as HTMLIFrameElement;
      mockIframePostMessage(iframe);
      return { ...result, iframe };
    }

    afterEach(() => {
      vi.useRealTimers();
    });

    it('stays hidden and inert until the initial src has loaded', async () => {
      const { iframe } = setup();
      expect(isHidden(iframe)).toBe(true);

      await fireEvent.load(iframe);
      expect(isHidden(iframe)).toBe(false);
    });

    it('hides again when switching view until the new src loads', async () => {
      const { iframe, rerender } = setup();
      await fireEvent.load(iframe);

      await rerender({ ...props, view: viewB });
      expect(isHidden(iframe)).toBe(true);

      await fireEvent.load(iframe);
      expect(isHidden(iframe)).toBe(false);
    });

    it('does not reuse an older load when switching A → B → A', async () => {
      const { iframe, rerender } = setup();
      await fireEvent.load(iframe);

      await rerender({ ...props, view: viewB });
      await rerender({ ...props, view: viewA });
      expect(isHidden(iframe)).toBe(true);

      await fireEvent.load(iframe);
      expect(isHidden(iframe)).toBe(false);
    });

    it('reveals a late load once it arrives', async () => {
      vi.useFakeTimers();
      const { iframe } = setup();

      await vi.advanceTimersByTimeAsync(1000);
      expect(isHidden(iframe)).toBe(true);

      await fireEvent.load(iframe);
      expect(isHidden(iframe)).toBe(false);
    });

    it('reveals after a timeout when no load event fires', async () => {
      vi.useFakeTimers();
      const { iframe } = setup();

      await vi.advanceTimersByTimeAsync(1999);
      expect(isHidden(iframe)).toBe(true);

      await vi.advanceTimersByTimeAsync(1);
      expect(isHidden(iframe)).toBe(false);
    });

    it('reveals when the frame errors', async () => {
      const { iframe } = setup();

      await fireEvent.error(iframe);
      expect(isHidden(iframe)).toBe(false);
    });
  });

  it('updates color-scheme via postMessage on live theme switch without reloading iframeSrc', async () => {
    document.documentElement.dataset.theme = 'dark';

    const { container } = render(ExtensionIframe, {
      extensionId: 'org.asyar.google-translate',
      view: 'org.asyar.google-translate/TranslateView',
      manifest: null,
    });

    const iframe = container.querySelector('iframe') as HTMLIFrameElement;
    const initialSrc = iframe.src;
    const postMessage = mockIframePostMessage(iframe);

    await fireEvent.load(iframe);
    postMessage.mockClear();

    document.documentElement.dataset.theme = 'light';
    // MutationObserver callbacks fire asynchronously as microtasks.
    await Promise.resolve();
    await Promise.resolve();

    expect(iframe.src).toBe(initialSrc);
    const themeCall = postMessage.mock.calls.find(([msg]) => msg?.type === 'asyar:theme:variables');
    expect(themeCall).toBeTruthy();
    expect(themeCall![0].payload['color-scheme']).toBe('light');
  });

  it('falls back to prefers-color-scheme when data-theme is unset', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query === '(prefers-color-scheme: dark)',
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );

    try {
      const { container } = render(ExtensionIframe, {
        extensionId: 'org.asyar.google-translate',
        view: null,
        manifest: null,
      });
      const iframe = container.querySelector('iframe') as HTMLIFrameElement;
      const url = new URL(iframe.src);
      expect(url.searchParams.get('theme')).toBe('dark');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
