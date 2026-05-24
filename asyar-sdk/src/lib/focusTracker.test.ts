import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('setupFocusTracking', () => {
  let postMessageSpy: ReturnType<typeof vi.fn>;
  let focusinHandler: ((e: Partial<FocusEvent>) => void) | undefined;
  let focusoutHandler: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    // Reset module registry so each test gets fresh internal state
    vi.resetModules();

    postMessageSpy = vi.fn();

    // Simulate being inside an iframe: window.parent !== window
    vi.stubGlobal('parent', { postMessage: postMessageSpy });

    // Spy on document.addEventListener to capture the focusin/focusout handlers
    focusinHandler = undefined;
    focusoutHandler = undefined;
    vi.spyOn(document, 'addEventListener').mockImplementation((event: string, handler: any) => {
      if (event === 'focusin') focusinHandler = handler;
      if (event === 'focusout') focusoutHandler = handler;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('registers focusin and focusout listeners on document', async () => {
    const { setupFocusTracking } = await import('./focusTracker');
    setupFocusTracking();

    expect(document.addEventListener).toHaveBeenCalledWith('focusin', expect.any(Function));
    expect(document.addEventListener).toHaveBeenCalledWith('focusout', expect.any(Function));
  });

  it('posts focused: true when a text input receives focus', async () => {
    const { setupFocusTracking } = await import('./focusTracker');
    setupFocusTracking();

    focusinHandler!({ target: { tagName: 'INPUT', type: 'text' } as unknown as Element });

    expect(postMessageSpy).toHaveBeenCalledWith(
      { type: 'asyar:extension:input-focus', focused: true },
      '*',
    );
  });

  it('posts focused: true when a textarea receives focus', async () => {
    const { setupFocusTracking } = await import('./focusTracker');
    setupFocusTracking();

    focusinHandler!({ target: { tagName: 'TEXTAREA' } as unknown as Element });

    expect(postMessageSpy).toHaveBeenCalledWith(
      { type: 'asyar:extension:input-focus', focused: true },
      '*',
    );
  });

  it('does NOT post when a non-input element receives focus', async () => {
    const { setupFocusTracking } = await import('./focusTracker');
    setupFocusTracking();

    focusinHandler!({ target: { tagName: 'DIV', isContentEditable: false } as unknown as Element });

    expect(postMessageSpy).not.toHaveBeenCalled();
  });

  it('posts focused: false on focusout when active element is not an input', async () => {
    const { setupFocusTracking } = await import('./focusTracker');
    setupFocusTracking();

    // First: focus an input to set the internal state to true
    focusinHandler!({ target: { tagName: 'INPUT', type: 'text' } as unknown as Element });
    postMessageSpy.mockClear();

    // Simulate activeElement becoming a non-input after focusout
    Object.defineProperty(document, 'activeElement', {
      value: { tagName: 'BODY', isContentEditable: false },
      writable: true,
      configurable: true,
    });

    focusoutHandler!();
    vi.advanceTimersByTime(0);

    expect(postMessageSpy).toHaveBeenCalledWith(
      { type: 'asyar:extension:input-focus', focused: false },
      '*',
    );
  });

  it('does NOT re-post when the focused state has not changed (dedup)', async () => {
    const { setupFocusTracking } = await import('./focusTracker');
    setupFocusTracking();

    // Focus an input twice — only the first should emit
    focusinHandler!({ target: { tagName: 'INPUT', type: 'text' } as unknown as Element });
    focusinHandler!({ target: { tagName: 'INPUT', type: 'search' } as unknown as Element });

    expect(postMessageSpy).toHaveBeenCalledTimes(1);
  });
});
