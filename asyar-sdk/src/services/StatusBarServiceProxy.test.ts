import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StatusBarServiceProxy } from './StatusBarServiceProxy';
import { MessageBroker } from '../ipc/MessageBroker';
import type { IStatusBarItem } from './IStatusBarService';

vi.mock('../ipc/MessageBroker', () => ({
  MessageBroker: {
    getInstance: vi.fn(),
  },
}));

interface FakeBroker {
  invoke: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  emit: (event: string, payload: unknown) => void;
}

function makeBroker(): FakeBroker {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  return {
    invoke: vi.fn().mockResolvedValue(undefined),
    on: vi.fn((event: string, fn: (p: unknown) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(fn);
    }),
    off: vi.fn(),
    emit(event: string, payload: unknown) {
      const set = listeners.get(event);
      if (set) for (const fn of set) fn(payload);
    },
  };
}

function makeProxy() {
  const broker = makeBroker();
  vi.mocked(MessageBroker.getInstance).mockReturnValue(broker as any);
  const proxy = new StatusBarServiceProxy();
  proxy.setExtensionId('ext.test');
  return { proxy, broker };
}

function topLevel(overrides: Partial<IStatusBarItem> = {}): IStatusBarItem {
  return {
    id: 'top',
    icon: '☕',
    text: 'Coffee',
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

// ── Happy path ─────────────────────────────────────────────────────────────

describe('registerItem happy path', () => {
  it('sends statusBar:registerItem with the stripped tree + extensionId', () => {
    const { proxy, broker } = makeProxy();
    proxy.registerItem(topLevel());
    const call = broker.invoke.mock.calls.find(
      (c: any[]) => c[0] === 'statusBar:registerItem',
    );
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({
      item: expect.objectContaining({
        id: 'top',
        icon: '☕',
        text: 'Coffee',
        extensionId: 'ext.test',
      }),
    });
  });

  it('accepts a 2-level submenu tree', () => {
    const { proxy, broker } = makeProxy();
    proxy.registerItem(
      topLevel({
        submenu: [
          { id: 'play', text: 'Play', checked: true },
          { separator: true } as IStatusBarItem,
          { id: 'next', text: 'Next', enabled: false },
        ],
      }),
    );
    const call = broker.invoke.mock.calls.find(
      (c: any[]) => c[0] === 'statusBar:registerItem',
    );
    expect(call).toBeDefined();
    const submenu = (call![1].item as any).submenu;
    expect(submenu).toHaveLength(3);
    expect(submenu[0]).toMatchObject({ id: 'play', checked: true });
    expect(submenu[1]).toMatchObject({ separator: true });
    expect(submenu[2]).toMatchObject({ id: 'next', enabled: false });
  });

  it('strips onClick handlers from the IPC payload', () => {
    const { proxy, broker } = makeProxy();
    const onClick = vi.fn();
    proxy.registerItem(
      topLevel({
        onClick,
        submenu: [{ id: 'sub', text: 'Sub', onClick }],
      }),
    );
    const call = broker.invoke.mock.calls.find(
      (c: any[]) => c[0] === 'statusBar:registerItem',
    );
    const item = call![1].item as any;
    expect(item).not.toHaveProperty('onClick');
    expect(item.submenu[0]).not.toHaveProperty('onClick');
  });
});

// ── Validation ─────────────────────────────────────────────────────────────

describe('registerItem validation (client-side)', () => {
  function rejects(bad: IStatusBarItem, matcher: string | RegExp = /./) {
    const { proxy, broker } = makeProxy();
    expect(() => proxy.registerItem(bad)).toThrow(matcher);
    // No IPC sent for rejected input.
    expect(
      broker.invoke.mock.calls.find(
        (c: any[]) => c[0] === 'statusBar:registerItem',
      ),
    ).toBeUndefined();
  }

  it('rejects empty id', () => {
    rejects(topLevel({ id: '' }), /id/);
  });

  it('rejects top-level without icon and iconPath', () => {
    rejects({ id: 'x', text: 'x' } as IStatusBarItem, /icon/i);
  });

  it('rejects top-level with checked', () => {
    rejects(topLevel({ checked: true }), /checked/i);
  });

  it('rejects top-level with separator', () => {
    rejects(topLevel({ separator: true }), /separator/i);
  });

  it('rejects top-level with enabled=false', () => {
    rejects(topLevel({ enabled: false }), /disabled/i);
  });

  it('rejects id containing colon', () => {
    rejects(topLevel({ id: 'bad:id' }), /separator/i);
  });

  it('rejects duplicate submenu sibling ids', () => {
    rejects(
      topLevel({
        submenu: [
          { id: 'dup', text: 'A' },
          { id: 'dup', text: 'B' },
        ],
      }),
      /duplicate/i,
    );
  });

  it('rejects submenu nested deeper than depth 4', () => {
    rejects(
      topLevel({
        submenu: [
          {
            id: 'l2',
            text: 'L2',
            submenu: [
              {
                id: 'l3',
                text: 'L3',
                submenu: [
                  {
                    id: 'l4',
                    text: 'L4',
                    submenu: [{ id: 'l5', text: 'L5' }],
                  },
                ],
              },
            ],
          },
        ],
      }),
      /depth/i,
    );
  });

  it('accepts exactly depth 4', () => {
    const { proxy } = makeProxy();
    expect(() =>
      proxy.registerItem(
        topLevel({
          submenu: [
            {
              id: 'l2',
              text: 'L2',
              submenu: [
                {
                  id: 'l3',
                  text: 'L3',
                  submenu: [{ id: 'l4', text: 'L4' }],
                },
              ],
            },
          ],
        }),
      ),
    ).not.toThrow();
  });
});

// ── unregister / update ─────────────────────────────────────────────────────

describe('unregisterItem', () => {
  it('sends the unregister IPC with extensionId + id', () => {
    const { proxy, broker } = makeProxy();
    proxy.unregisterItem('top');
    const call = broker.invoke.mock.calls.find(
      (c: any[]) => c[0] === 'statusBar:unregisterItem',
    );
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({ extensionId: 'ext.test', id: 'top' });
  });
});

describe('updateItem', () => {
  it('re-validates and sends merged tree', () => {
    const { proxy, broker } = makeProxy();
    proxy.updateItem('top', { icon: '🍵', text: 'Tea' });
    const call = broker.invoke.mock.calls.find(
      (c: any[]) => c[0] === 'statusBar:updateItem',
    );
    expect(call).toBeDefined();
    expect(call![1].item).toMatchObject({
      id: 'top',
      icon: '🍵',
      text: 'Tea',
      extensionId: 'ext.test',
    });
  });

  it('throws when the merged shape violates top-level rules', () => {
    const { proxy } = makeProxy();
    // no icon / no iconPath
    expect(() => proxy.updateItem('top', { text: 'Tea' })).toThrow(/icon/i);
  });
});

// ── Click dispatch ──────────────────────────────────────────────────────────

describe('click dispatch', () => {
  it('routes tray-item-click events to matching onClick handlers', () => {
    const { proxy, broker } = makeProxy();
    const onTop = vi.fn();
    const onLeaf = vi.fn();
    proxy.registerItem(
      topLevel({
        onClick: onTop,
        submenu: [
          {
            id: 'timer',
            text: 'Timer',
            submenu: [{ id: '30m', text: '30m', onClick: onLeaf }],
          },
        ],
      }),
    );

    broker.emit('asyar:event:statusBar:click', {
      itemPath: ['top', 'timer', '30m'],
    });
    expect(onLeaf).toHaveBeenCalledWith(
      expect.objectContaining({ itemPath: ['top', 'timer', '30m'] }),
    );
    expect(onTop).not.toHaveBeenCalled();
  });

  it('forwards the checked flag when present', () => {
    const { proxy, broker } = makeProxy();
    const onClick = vi.fn();
    proxy.registerItem(
      topLevel({
        submenu: [{ id: 'play', text: 'Play', checked: true, onClick }],
      }),
    );
    broker.emit('asyar:event:statusBar:click', {
      itemPath: ['top', 'play'],
      checked: false,
    });
    expect(onClick).toHaveBeenCalledWith({
      itemPath: ['top', 'play'],
      checked: false,
    });
  });

  it('ignores events for unknown top-level ids', () => {
    const { proxy, broker } = makeProxy();
    const onClick = vi.fn();
    proxy.registerItem(topLevel({ onClick }));
    broker.emit('asyar:event:statusBar:click', { itemPath: ['other'] });
    expect(onClick).not.toHaveBeenCalled();
  });

  it('ignores malformed click payloads without throwing', () => {
    const { proxy, broker } = makeProxy();
    proxy.registerItem(topLevel());
    expect(() =>
      broker.emit('asyar:event:statusBar:click', undefined),
    ).not.toThrow();
    expect(() =>
      broker.emit('asyar:event:statusBar:click', { itemPath: [] }),
    ).not.toThrow();
    expect(() =>
      broker.emit('asyar:event:statusBar:click', {}),
    ).not.toThrow();
  });

  it('routes top-level click when itemPath has length 1', () => {
    const { proxy, broker } = makeProxy();
    const onTop = vi.fn();
    proxy.registerItem(topLevel({ onClick: onTop }));
    broker.emit('asyar:event:statusBar:click', { itemPath: ['top'] });
    expect(onTop).toHaveBeenCalledWith(
      expect.objectContaining({ itemPath: ['top'] }),
    );
  });
});
