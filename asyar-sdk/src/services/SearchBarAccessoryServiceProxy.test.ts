import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SearchBarAccessoryServiceProxy } from './SearchBarAccessoryServiceProxy';
import { messageBroker } from '../ipc/MessageBroker';

describe('SearchBarAccessoryServiceProxy', () => {
  let proxy: SearchBarAccessoryServiceProxy;
  let invokeSpy: ReturnType<typeof vi.fn>;
  let onSpy: ReturnType<typeof vi.fn>;
  let offSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    invokeSpy = vi.fn().mockResolvedValue(undefined);
    onSpy = vi.fn();
    offSpy = vi.fn();
    (messageBroker as any).invoke = invokeSpy;
    (messageBroker as any).on = onSpy;
    (messageBroker as any).off = offSpy;
    proxy = new SearchBarAccessoryServiceProxy();
    proxy.setExtensionId('org.test.example');
  });

  it('set() invokes searchBar:set with the payload', async () => {
    await proxy.set({
      options: [{ value: 'all', title: 'All' }],
      value: 'all',
    });
    expect(invokeSpy).toHaveBeenCalledWith(
      'searchBar:set',
      { opts: { options: [{ value: 'all', title: 'All' }], value: 'all' } },
      'org.test.example',
      undefined,
    );
  });

  it('set() with only value invokes the same channel', async () => {
    await proxy.set({ value: 'images' });
    expect(invokeSpy).toHaveBeenCalledWith(
      'searchBar:set',
      { opts: { value: 'images' } },
      'org.test.example',
      undefined,
    );
  });

  it('clear() invokes searchBar:clear with empty payload', async () => {
    await proxy.clear();
    expect(invokeSpy).toHaveBeenCalledWith(
      'searchBar:clear',
      {},
      'org.test.example',
      undefined,
    );
  });

  it('onChange() registers a listener for filterChange and returns a disposer', () => {
    const handler = vi.fn();
    const off = proxy.onChange(handler);

    expect(onSpy).toHaveBeenCalledWith(
      'asyar:event:searchBar:filterChange',
      expect.any(Function),
    );

    const registeredListener = onSpy.mock.calls[0][1] as (p: unknown) => void;
    registeredListener({ commandId: 'cmd-1', value: 'images' });
    expect(handler).toHaveBeenCalledWith('images');

    off();
    expect(offSpy).toHaveBeenCalledWith(
      'asyar:event:searchBar:filterChange',
      registeredListener,
    );
  });

  it('onChange() ignores malformed payloads', () => {
    const handler = vi.fn();
    proxy.onChange(handler);
    const registeredListener = onSpy.mock.calls[0][1] as (p: unknown) => void;
    registeredListener(undefined);
    registeredListener({});
    registeredListener({ value: 42 });
    expect(handler).not.toHaveBeenCalled();
  });
});
