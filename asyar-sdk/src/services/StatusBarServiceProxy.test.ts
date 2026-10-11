import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StatusBarServiceProxy } from './StatusBarServiceProxy';
import { messageBroker } from '../ipc/MessageBroker';
import type { IStatusBarItem } from './IStatusBarService';

vi.mock('../ipc/MessageBroker', () => ({
  messageBroker: { invoke: vi.fn(), on: vi.fn(), off: vi.fn() },
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
  Object.assign(messageBroker, broker);
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
  it('sends statusBar:registerItem without caller-supplied identity', () => {
    const { proxy, broker } = makeProxy();
    proxy.registerItem(topLevel());
    const call = broker.invoke.mock.calls.find((c: any[]) => c[0] === 'statusBar:registerItem');
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({
      item: expect.objectContaining({
        id: 'top',
        icon: '☕',
        text: 'Coffee',
      }),
    });
    expect(call![1].item).not.toHaveProperty('extensionId');
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
    const call = broker.invoke.mock.calls.find((c: any[]) => c[0] === 'statusBar:registerItem');
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
    const call = broker.invoke.mock.calls.find((c: any[]) => c[0] === 'statusBar:registerItem');
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
      broker.invoke.mock.calls.find((c: any[]) => c[0] === 'statusBar:registerItem'),
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
  it('sends the unregister IPC with id only', () => {
    const { proxy, broker } = makeProxy();
    proxy.unregisterItem('top');
    const call = broker.invoke.mock.calls.find((c: any[]) => c[0] === 'statusBar:unregisterItem');
    expect(call).toBeDefined();
    expect(call![1]).toEqual({ id: 'top' });
  });
});

describe('updateItem', () => {
  it('re-validates and sends merged tree', () => {
    const { proxy, broker } = makeProxy();
    proxy.registerItem(topLevel());
    proxy.updateItem('top', { icon: '🍵', text: 'Tea' });
    const call = broker.invoke.mock.calls.find((c: any[]) => c[0] === 'statusBar:updateItem');
    expect(call).toBeDefined();
    expect(call![1].item).toMatchObject({
      id: 'top',
      icon: '🍵',
      text: 'Tea',
    });
  });

  it('throws when the merged shape violates top-level rules', () => {
    const { proxy } = makeProxy();
    proxy.registerItem(topLevel());
    // no icon / no iconPath
    expect(() => proxy.updateItem('top', { icon: undefined, text: 'Tea' })).toThrow(/icon/i);
  });

  it('merges title onto the registered item, retaining icon, submenu and handlers', () => {
    const { proxy, broker } = makeProxy();
    const onClick = vi.fn();
    proxy.registerItem(topLevel({ submenu: [{ id: 'play', text: 'Play', onClick }] }));
    proxy.updateItem('top', { title: '25:00', id: 'spoof' } as Partial<IStatusBarItem>);
    const calls = broker.invoke.mock.calls;
    expect(calls[calls.length - 1]!.slice(0, 2)).toEqual([
      'statusBar:updateItem',
      {
        id: 'top',
        item: {
          id: 'top',
          icon: '☕',
          text: 'Coffee',
          title: '25:00',
          submenu: [{ id: 'play', text: 'Play' }],
        },
      },
    ]);
    broker.emit('asyar:event:statusBar:click', { itemPath: ['top', 'play'] });
    expect(onClick).toHaveBeenCalledOnce();
  });

  it.each(['', undefined])('clears title with %s', (title) => {
    const { proxy, broker } = makeProxy();
    proxy.registerItem(topLevel({ title: '25:00' } as Partial<IStatusBarItem>));
    proxy.updateItem('top', { title } as Partial<IStatusBarItem>);
    const calls = broker.invoke.mock.calls;
    expect(calls[calls.length - 1]![1].item.title).toBe(title);
  });

  it('throws for unknown and unregistered ids', () => {
    const { proxy } = makeProxy();
    expect(() => proxy.updateItem('top', { icon: '☕', text: 'Coffee' })).toThrow(/unknown/i);
    proxy.registerItem(topLevel());
    proxy.unregisterItem('top');
    expect(() => proxy.updateItem('top', { icon: '☕', text: 'Coffee' })).toThrow(/unknown/i);
  });

  it('replaces submenu wholesale and drops old handlers', () => {
    const { proxy, broker } = makeProxy();
    const old = vi.fn();
    const next = vi.fn();
    proxy.registerItem(topLevel({ submenu: [{ id: 'old', text: 'Old', onClick: old }] }));
    proxy.updateItem('top', { submenu: [{ id: 'next', text: 'Next', onClick: next }] });
    broker.emit('asyar:event:statusBar:click', { itemPath: ['top', 'old'] });
    broker.emit('asyar:event:statusBar:click', { itemPath: ['top', 'next'] });
    expect(old).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });
});

describe('title validation', () => {
  it.each(['a'.repeat(33), 'line\nbreak', 'tab\t', '\u007f', '\u0085'])(
    'rejects invalid title %j',
    (title) => {
      const { proxy } = makeProxy();
      expect(() => proxy.registerItem(topLevel({ title } as Partial<IStatusBarItem>))).toThrow(
        /title/i,
      );
    },
  );
  it('accepts 32 Unicode characters', () => {
    const { proxy } = makeProxy();
    expect(() =>
      proxy.registerItem(topLevel({ title: '🍅'.repeat(32) } as Partial<IStatusBarItem>)),
    ).not.toThrow();
  });
  it.each([false, true])(
    'rejects titles on submenu children, including separators (%s)',
    (separator) => {
      const { proxy } = makeProxy();
      expect(() =>
        proxy.registerItem(
          topLevel({
            submenu: [{ id: 'child', text: 'Child', separator, title: '' } as IStatusBarItem],
          }),
        ),
      ).toThrow(/title/i);
    },
  );
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
    expect(() => broker.emit('asyar:event:statusBar:click', undefined)).not.toThrow();
    expect(() => broker.emit('asyar:event:statusBar:click', { itemPath: [] })).not.toThrow();
    expect(() => broker.emit('asyar:event:statusBar:click', {})).not.toThrow();
  });

  it('routes top-level click when itemPath has length 1', () => {
    const { proxy, broker } = makeProxy();
    const onTop = vi.fn();
    proxy.registerItem(topLevel({ onClick: onTop }));
    broker.emit('asyar:event:statusBar:click', { itemPath: ['top'] });
    expect(onTop).toHaveBeenCalledWith(expect.objectContaining({ itemPath: ['top'] }));
  });
});
