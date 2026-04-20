import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../ipc/MessageBroker', () => ({
  messageBroker: { invoke: vi.fn(), on: vi.fn(), off: vi.fn() },
}));

import { ExtensionManagerProxy } from './ExtensionManagerProxy';
import { messageBroker } from '../ipc/MessageBroker';

function makeProxy() {
  const mockInvoke = vi.fn().mockResolvedValue(undefined);
  Object.assign(messageBroker, {
    invoke: mockInvoke,
    on: vi.fn(),
    off: vi.fn(),
  });
  const proxy = new ExtensionManagerProxy();
  proxy.setExtensionId('ext.test');
  return { proxy, mockInvoke };
}

describe('ExtensionManagerProxy', () => {
  beforeEach(() => vi.clearAllMocks());

  it('init → "extensions:init"', async () => {
    const { proxy, mockInvoke } = makeProxy();
    mockInvoke.mockResolvedValue(true);
    await proxy.init();
    const call = mockInvoke.mock.calls.find(c => c[0] === 'extensions:init');
    expect(call).toBeDefined();
  });

  it('loadExtensions → "extensions:loadExtensions"', async () => {
    const { proxy, mockInvoke } = makeProxy();
    await proxy.loadExtensions();
    const call = mockInvoke.mock.calls.find(c => c[0] === 'extensions:loadExtensions');
    expect(call).toBeDefined();
  });

  it('reloadExtensions → "extensions:reloadExtensions"', async () => {
    const { proxy, mockInvoke } = makeProxy();
    await proxy.reloadExtensions();
    const call = mockInvoke.mock.calls.find(c => c[0] === 'extensions:reloadExtensions');
    expect(call).toBeDefined();
  });

  it('toggleExtensionState → "extensions:toggleExtensionState"', async () => {
    const { proxy, mockInvoke } = makeProxy();
    mockInvoke.mockResolvedValue(true);
    await proxy.toggleExtensionState('ext.a', true);
    const call = mockInvoke.mock.calls.find(c => c[0] === 'extensions:toggleExtensionState');
    expect(call).toBeDefined();
  });

  it('getAllExtensionsWithState → "extensions:getAllExtensionsWithState"', async () => {
    const { proxy, mockInvoke } = makeProxy();
    mockInvoke.mockResolvedValue([]);
    await proxy.getAllExtensionsWithState();
    const call = mockInvoke.mock.calls.find(c => c[0] === 'extensions:getAllExtensionsWithState');
    expect(call).toBeDefined();
  });

  it('searchAll → "extensions:searchAll"', async () => {
    const { proxy, mockInvoke } = makeProxy();
    mockInvoke.mockResolvedValue([]);
    await proxy.searchAll('q');
    const call = mockInvoke.mock.calls.find(c => c[0] === 'extensions:searchAll');
    expect(call).toBeDefined();
  });

  it('handleViewSearch → "extensions:handleViewSearch"', async () => {
    const { proxy, mockInvoke } = makeProxy();
    await proxy.handleViewSearch('q');
    const call = mockInvoke.mock.calls.find(c => c[0] === 'extensions:handleViewSearch');
    expect(call).toBeDefined();
  });

  it('handleViewSubmit → "extensions:handleViewSubmit"', async () => {
    const { proxy, mockInvoke } = makeProxy();
    await proxy.handleViewSubmit('q');
    const call = mockInvoke.mock.calls.find(c => c[0] === 'extensions:handleViewSubmit');
    expect(call).toBeDefined();
  });

  it('navigateToView → "extensions:navigateToView"', () => {
    const { proxy, mockInvoke } = makeProxy();
    proxy.navigateToView('ext/Default');
    const call = mockInvoke.mock.calls.find(c => c[0] === 'extensions:navigateToView');
    expect(call).toBeDefined();
  });

  it('goBack → "extensions:goBack"', () => {
    const { proxy, mockInvoke } = makeProxy();
    proxy.goBack();
    const call = mockInvoke.mock.calls.find(c => c[0] === 'extensions:goBack');
    expect(call).toBeDefined();
  });

  it('forwardKeyToActiveView → "extensions:forwardKeyToActiveView"', () => {
    const { proxy, mockInvoke } = makeProxy();
    proxy.forwardKeyToActiveView({ key: 'Enter', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false });
    const call = mockInvoke.mock.calls.find(c => c[0] === 'extensions:forwardKeyToActiveView');
    expect(call).toBeDefined();
  });

  it('getAllExtensions → "extensions:getAllExtensions"', async () => {
    const { proxy, mockInvoke } = makeProxy();
    mockInvoke.mockResolvedValue([]);
    await proxy.getAllExtensions();
    const call = mockInvoke.mock.calls.find(c => c[0] === 'extensions:getAllExtensions');
    expect(call).toBeDefined();
  });

  it('uninstallExtension → "extensions:uninstallExtension"', async () => {
    const { proxy, mockInvoke } = makeProxy();
    mockInvoke.mockResolvedValue(true);
    await proxy.uninstallExtension('ext.a', 'Ext A');
    const call = mockInvoke.mock.calls.find(c => c[0] === 'extensions:uninstallExtension');
    expect(call).toBeDefined();
  });

  it('setActiveViewActionLabel → "extensions:setActiveViewActionLabel"', () => {
    const { proxy, mockInvoke } = makeProxy();
    proxy.setActiveViewActionLabel('Go');
    const call = mockInvoke.mock.calls.find(c => c[0] === 'extensions:setActiveViewActionLabel');
    expect(call).toBeDefined();
  });

  it('setActiveViewSubtitle → "extensions:setActiveViewSubtitle"', () => {
    const { proxy, mockInvoke } = makeProxy();
    proxy.setActiveViewSubtitle('Subtitle');
    const call = mockInvoke.mock.calls.find(c => c[0] === 'extensions:setActiveViewSubtitle');
    expect(call).toBeDefined();
  });
});
