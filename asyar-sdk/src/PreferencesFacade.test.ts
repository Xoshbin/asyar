import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn().mockResolvedValue(undefined as any),
}));

vi.mock('./ipc/MessageBroker', () => ({
  MessageBroker: {
    getInstance: vi.fn(() => ({
      invoke: mockInvoke,
      on: vi.fn(),
      off: vi.fn(),
    })),
  },
}));

import { PreferencesFacade, buildFrozenSnapshot, type PreferencesSnapshot } from './PreferencesFacade';

beforeEach(() => {
  mockInvoke.mockReset();
  mockInvoke.mockResolvedValue(undefined);
});

describe('buildFrozenSnapshot', () => {
  it('freezes the top-level object', () => {
    const snap = buildFrozenSnapshot({ extension: { a: 1 }, commands: {} });
    expect(Object.isFrozen(snap)).toBe(true);
  });

  it('freezes the commands map', () => {
    const snap = buildFrozenSnapshot({ extension: {}, commands: { foo: { x: 1 } } });
    expect(Object.isFrozen(snap.commands)).toBe(true);
  });

  it('freezes each command entry', () => {
    const snap = buildFrozenSnapshot({ extension: {}, commands: { foo: { x: 1 } } });
    expect(Object.isFrozen(snap.commands.foo)).toBe(true);
  });

  it('spreads extension-level keys onto the top-level snapshot', () => {
    const snap = buildFrozenSnapshot({ extension: { apiKey: 'abc', units: 'metric' }, commands: {} });
    expect(snap.apiKey).toBe('abc');
    expect(snap.units).toBe('metric');
  });

  it('tolerates undefined commands field', () => {
    const snap = buildFrozenSnapshot({ extension: { a: 1 }, commands: undefined as any });
    expect(snap.a).toBe(1);
    expect(snap.commands).toEqual({});
  });

  it('direct mutation is rejected in strict mode', () => {
    'use strict';
    const snap = buildFrozenSnapshot({ extension: { x: 1 }, commands: {} });
    expect(() => {
      (snap as any).x = 999;
    }).toThrow();
  });
});

describe('PreferencesFacade', () => {
  it('starts with an empty frozen snapshot at .values', () => {
    const facade = new PreferencesFacade();
    expect(facade.values.commands).toBeDefined();
    expect(Object.isFrozen(facade.values)).toBe(true);
    expect(Object.isFrozen(facade.values.commands)).toBe(true);
  });

  it('_setValues replaces .values with the given snapshot', () => {
    const facade = new PreferencesFacade();
    const snap = buildFrozenSnapshot({ extension: { theme: 'dark' }, commands: {} });
    facade._setValues(snap);
    expect(facade.values).toBe(snap);
    expect(facade.values.theme).toBe('dark');
  });

  it('.set forwards to the IPC proxy with the right wire type', async () => {
    const facade = new PreferencesFacade();
    await facade.set('extension', 'theme', 'dark');
    const call = mockInvoke.mock.calls.find((c) => c[0] === 'preferences:set');
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({ scope: 'extension', key: 'theme', value: 'dark' });
  });

  it('.reset forwards to the IPC proxy with the scope', async () => {
    const facade = new PreferencesFacade();
    await facade.reset('extension');
    const call = mockInvoke.mock.calls.find((c) => c[0] === 'preferences:reset');
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({ scope: 'extension' });
  });

  it('.refresh fetches fresh values via IPC and updates .values', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'preferences:getAll') {
        return { extension: { theme: 'blue' }, commands: {} };
      }
      return undefined;
    });
    const facade = new PreferencesFacade();
    const fresh = await facade.refresh();
    expect(facade.values).toBe(fresh);
    expect(facade.values.theme).toBe('blue');
    expect(Object.isFrozen(facade.values)).toBe(true);
  });
});
