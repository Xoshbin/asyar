import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const handlers = vi.hoisted(() => new Map<string, (payload: unknown) => void>());
vi.mock('./ipc/MessageBroker', () => ({
  messageBroker: {
    on: (type: string, handler: (payload: unknown) => void) => handlers.set(type, handler),
    send: vi.fn(),
    invoke: vi.fn().mockResolvedValue(undefined),
  },
}));

type KeyHandler = (event: KeyboardEvent) => void;

describe('ExtensionBridge key forwarder: action shortcuts', () => {
  let keydown: KeyHandler;
  let postMessage: ReturnType<typeof vi.fn>;

  const press = (init: KeyboardEventInit & { code?: string }) => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    const preventDefault = vi.spyOn(event, 'preventDefault');
    keydown(event);
    return { event, preventDefault };
  };
  const pushChords = (chords: string[]) =>
    handlers.get('asyar:event:actions:shortcuts')!({ chords });
  const forwarded = () => postMessage.mock.calls.map((c) => c[0]);

  beforeEach(async () => {
    vi.resetModules();
    handlers.clear();
    postMessage = vi.fn();
    vi.spyOn(window, 'addEventListener').mockImplementation(((type: string, h: KeyHandler) => {
      if (type === 'keydown') keydown = h;
    }) as typeof window.addEventListener);
    Object.defineProperty(window, 'parent', {
      value: { postMessage },
      writable: true,
      configurable: true,
    });
    await import('./ExtensionBridge');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('forwards nothing for an action chord until the host announces it', () => {
    const { preventDefault } = press({ key: 'n', code: 'KeyN', metaKey: true });
    expect(forwarded()).toEqual([]);
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('forwards a chord the host announced and consumes it locally', () => {
    pushChords(['Super+N']);
    const { preventDefault } = press({ key: 'n', code: 'KeyN', metaKey: true });
    expect(preventDefault).toHaveBeenCalled();
    expect(forwarded()).toEqual([
      {
        type: 'asyar:extension:keydown',
        payload: {
          key: 'n',
          code: 'KeyN',
          metaKey: true,
          ctrlKey: false,
          shiftKey: false,
          altKey: false,
          repeat: false,
          isComposing: false,
        },
      },
    ]);
  });

  it('forwards key repeat so the launcher can ignore a held chord', () => {
    pushChords(['Super+N']);
    press({ key: 'n', code: 'KeyN', metaKey: true, repeat: true });
    expect(forwarded()[0].payload.repeat).toBe(true);
  });

  it('does not forward chords the host did not announce', () => {
    pushChords(['Super+N']);
    press({ key: 'm', code: 'KeyM', metaKey: true });
    press({ key: 'n', code: 'KeyN', metaKey: true, shiftKey: true });
    expect(forwarded()).toEqual([]);
  });

  it('forwards a chord even while a text field is focused (Mod chords never type)', () => {
    pushChords(['Control+N']);
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    press({ key: 'n', code: 'KeyN', ctrlKey: true });
    expect(forwarded()).toHaveLength(1);
  });

  it('replaces the announced set wholesale, so stale chords stop forwarding', () => {
    pushChords(['Super+N']);
    pushChords(['Super+M']);
    press({ key: 'n', code: 'KeyN', metaKey: true });
    press({ key: 'm', code: 'KeyM', metaKey: true });
    expect(forwarded()).toHaveLength(1);
  });

  it('keeps the previous set when an announcement is malformed', () => {
    pushChords(['Super+N']);
    handlers.get('asyar:event:actions:shortcuts')!({ chords: 'nope' });
    handlers.get('asyar:event:actions:shortcuts')!(undefined);
    press({ key: 'n', code: 'KeyN', metaKey: true });
    expect(forwarded()).toHaveLength(1);
  });

  it('still forwards the launcher-reserved chords unconditionally', () => {
    press({ key: 'k', code: 'KeyK', metaKey: true });
    press({ key: ',', code: 'Comma', ctrlKey: true });
    expect(forwarded()).toHaveLength(2);
  });

  it('keeps forwarding Escape and Backspace only when no field is being edited', () => {
    press({ key: 'Escape', code: 'Escape' });
    expect(forwarded()).toHaveLength(1);
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    press({ key: 'Backspace', code: 'Backspace' });
    expect(forwarded()).toHaveLength(1);
  });

  it('never forwards a plain key even if the host announced something odd', () => {
    pushChords(['N', 'Enter']);
    press({ key: 'n', code: 'KeyN' });
    press({ key: 'Enter', code: 'Enter' });
    expect(forwarded()).toEqual([]);
  });
});
