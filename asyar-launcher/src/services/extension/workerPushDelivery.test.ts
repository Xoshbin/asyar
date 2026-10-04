/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const mocks = vi.hoisted(() => ({ listeners: new Map<string, (event: any) => void>() }));
vi.mock('../../lib/ipc/iframeLifecycleCommands', () => ({ iframeReadyAck: vi.fn(async () => []) }));
vi.mock('../../lib/ipc/usageCommands', () => ({ recordWorkerFallback: vi.fn() }));
vi.mock('../feedback/feedbackService.svelte', () => ({ feedbackService: { report: vi.fn() } }));
vi.mock('../../lib/ipc/invokeSafe', () => ({ invokeSafe: vi.fn() }));
import { workerHost } from './workerHost.svelte';
import { ExtensionIframeManager } from './extensionIframeManager.svelte';
import { runService } from '../run/runService.svelte';
import {
  invokeExtensionTool,
  handleToolResponse,
} from '../../built-in-features/agents/toolDispatch';
class TestWorker {
  postMessage = vi.fn();
  terminate = vi.fn();
  onmessage: ((event: MessageEvent) => void) | null = null;
}
let worker: TestWorker;

vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock('../../lib/ipc/bridgeEvents', () => ({
  bridgeListen: vi.fn(async (name, cb) => {
    mocks.listeners.set(name, cb);
    return () => {};
  }),
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name, cb) => {
    mocks.listeners.set(name, cb);
    return () => {};
  }),
}));
vi.mock('../../lib/ipc/extensionOrigin', () => ({
  getExtensionFrameOrigin: () => 'asyar-extension://ext',
}));
import { systemEventsBridge } from '../systemEvents/systemEventsBridge.svelte';
import { appEventsBridge } from '../appEvents/appEventsBridge.svelte';
import { browserEventsBridge } from '../browser/browserEventsBridge.svelte';
import { indexEventsBridge } from '../applicationIndex/indexEventsBridge.svelte';
import { fsWatcherBridge } from '../fsWatcher/fsWatcherBridge.svelte';
import { trayClickBridge } from '../statusBar/trayClickBridge.svelte';
import { stateChangedBridge } from '../extensionState/stateChangedBridge.svelte';
import { postToExtension } from './extensionDelivery';
import { logService } from '../log/logService';
beforeEach(() => {
  vi.clearAllMocks();
  workerHost.reset();
  vi.stubGlobal('Worker', TestWorker);
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  document.body.innerHTML = '';
  trayClickBridge.dispose();
  stateChangedBridge.dispose();
  workerHost.mount('ext', 1, 'dist/worker.js');
  worker = workerHost.getWorker('ext')!.rawWorker as unknown as TestWorker;
});
afterEach(() => {
  workerHost.reset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

for (const [bridge, name, type] of [
  [systemEventsBridge, 'asyar:system-event', 'asyar:event:system-event:push'],
  [appEventsBridge, 'asyar:app-event', 'asyar:event:app-event:push'],
  [browserEventsBridge, 'asyar:browser-event', 'asyar:event:browser-event:push'],
  [indexEventsBridge, 'asyar:application-index', 'asyar:event:application-index:push'],
  [fsWatcherBridge, 'asyar:fs-watch', 'asyar:event:fs-watch:push'],
] as const) {
  it(`${name} push reaches a mounted Web Worker without an iframe`, async () => {
    await bridge.init();
    mocks.listeners.get(name)!({ payload: { extensionId: 'ext', event: { value: 1 } } });
    expect(worker.postMessage).toHaveBeenCalledWith({
      type,
      payload: { value: 1 },
    });
    bridge.dispose();
  });
}
it('tray clicks reach a mounted Web Worker', async () => {
  await trayClickBridge.init();
  mocks.listeners.get('asyar:tray-item-click')!({
    payload: { extensionId: 'ext', event: { checked: true } },
  });
  expect(worker.postMessage).toHaveBeenCalledWith({
    type: 'asyar:event:statusBar:click',
    payload: { checked: true },
  });
});
it('state pushes reach only the subscribed worker role', async () => {
  await stateChangedBridge.init();
  mocks.listeners.get('asyar:state-changed')!({
    payload: { extensionId: 'ext', role: 'worker', key: 'x', value: 1 },
  });
  expect(worker.postMessage).toHaveBeenCalledWith({
    type: 'asyar:event:state:changed:push',
    payload: { extensionId: 'ext', role: 'worker', key: 'x', value: 1 },
  });
  worker.postMessage.mockClear();
  mocks.listeners.get('asyar:state-changed')!({
    payload: { extensionId: 'ext', role: 'view', key: 'x', value: 1 },
  });
  expect(worker.postMessage).not.toHaveBeenCalled();
});
it('falls back to a worker iframe', () => {
  workerHost.unmount('ext', 'test');
  const iframe = document.createElement('iframe');
  iframe.dataset.extensionId = 'ext';
  iframe.dataset.role = 'worker';
  document.body.append(iframe);
  const post = vi.spyOn(iframe.contentWindow!, 'postMessage');
  expect(postToExtension('ext', 'worker', { type: 'test' })).toBe(true);
  expect(post).toHaveBeenCalledWith({ type: 'test' }, 'asyar-extension://ext');
});
it('reports missing targets', () => {
  workerHost.unmount('ext', 'test');
  expect(postToExtension('ext', 'worker', { type: 'test' })).toBe(false);
  expect(logService.warn).toHaveBeenCalledWith(expect.stringContaining('ext'));
});
it('forbids worker iframe selectors outside the canonical iframe selector', () => {
  const root = resolve('src');
  const violations: string[] = [];
  function scan(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) scan(path);
      else if (
        /\.(ts|svelte)$/.test(path) &&
        !/\.(test|spec)\./.test(path) &&
        path !== resolve(root, 'services/extension/extensionIframeSelector.ts')
      ) {
        const source = readFileSync(path, 'utf8');
        if (/iframe\[data-extension-id[^\n]*\[data-role=["'](?:worker|\$\{role\})/.test(source))
          violations.push(path);
      }
    }
  }
  scan(root);
  expect(violations).toEqual([]);
});

it('preferences reach the actual mounted worker channel', () => {
  new ExtensionIframeManager().sendPreferencesToExtension('ext', {
    extension: { x: 1 },
    commands: {},
  });
  expect(worker.postMessage).toHaveBeenCalledWith({
    type: 'asyar:event:preferences:set-all',
    payload: { extension: { x: 1 }, commands: {} },
  });
});
it('run cancellation reaches the actual mounted worker channel', async () => {
  await runService['onStateChanged']({
    id: 'run',
    status: 'cancelled',
    extensionId: 'ext',
    kind: 'shell-script',
    label: 'test',
    startedAt: 1,
    cancellable: true,
  });
  expect(worker.postMessage).toHaveBeenCalledWith({
    type: 'asyar:event:runs:cancel',
    payload: { id: 'run' },
  });
});
it('tool round trip uses the actual mounted worker channel and its authenticated source', async () => {
  workerHost.setIpcHandler(handleToolResponse);
  const promise = invokeExtensionTool('ext', 'lookup', {});
  const messageId = worker.postMessage.mock.calls[0][0].messageId;
  worker.onmessage!({
    data: { type: 'asyar:tools:invoke:response', messageId, result: 42 },
  } as MessageEvent);
  await expect(promise).resolves.toBe(42);
});

it('prefers the mounted Web Worker over both iframe roles', () => {
  document.body.innerHTML =
    '<iframe data-extension-id="ext" data-role="view"></iframe><iframe data-extension-id="ext" data-role="worker"></iframe>';
  const frames = Array.from(document.querySelectorAll('iframe'));
  const posts = frames.map((frame) => vi.spyOn(frame.contentWindow!, 'postMessage'));
  expect(postToExtension('ext', 'worker', { type: 'test' })).toBe(true);
  expect(worker.postMessage).toHaveBeenCalledWith({ type: 'test' });
  posts.forEach((post) => expect(post).not.toHaveBeenCalled());
});
it('preserves view delivery while a Web Worker is mounted', () => {
  document.body.innerHTML = '<iframe data-extension-id="ext" data-role="view"></iframe>';
  const post = vi.spyOn(document.querySelector('iframe')!.contentWindow!, 'postMessage');
  expect(postToExtension('ext', 'view', { type: 'test' }, { fallback: false })).toBe(true);
  expect(post).toHaveBeenCalledWith({ type: 'test' }, 'asyar-extension://ext');
  expect(worker.postMessage).not.toHaveBeenCalled();
});
it('preserves view-only fallback for unscoped subscriptions, but forbids it for role-scoped pushes', () => {
  workerHost.unmount('ext', 'test');
  document.body.innerHTML = '<iframe data-extension-id="ext" data-role="view"></iframe>';
  const post = vi.spyOn(document.querySelector('iframe')!.contentWindow!, 'postMessage');
  expect(postToExtension('ext', 'worker', { type: 'test' })).toBe(true);
  post.mockClear();
  expect(postToExtension('ext', 'worker', { type: 'test' }, { fallback: false })).toBe(false);
  expect(post).not.toHaveBeenCalled();
  expect(logService.warn).toHaveBeenCalled();
});
