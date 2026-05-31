import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPresentQuestion = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockNotify = vi.hoisted(() => vi.fn().mockResolvedValue('notif-id'));
const mockFinalize = vi.hoisted(() => vi.fn().mockResolvedValue({ leaked: false }));
const mockSidecarStart = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockResolveSpec = vi.hoisted(() => vi.fn().mockResolvedValue('/res/capabilitySpec'));
const mockListen = vi.hoisted(() => vi.fn().mockResolvedValue(() => {}));
const mockLogWarn = vi.hoisted(() => vi.fn());

vi.mock('./questionBridge', () => ({ presentQuestion: mockPresentQuestion }));
vi.mock('../../../services/notification/notificationService', () => ({
  notificationService: { send: mockNotify },
}));
vi.mock('./finalizeBuild', () => ({ finalizeBuild: mockFinalize }));
vi.mock('./sidecarClient', () => ({ sidecarClient: { start: mockSidecarStart } }));
vi.mock('./buildPaths', () => ({ resolveCapabilitySpecDir: mockResolveSpec }));
vi.mock('@tauri-apps/api/path', () => ({
  homeDir: vi.fn().mockResolvedValue('/home/u'),
  join: vi.fn(async (...p: string[]) => p.join('/')),
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: mockListen }));
vi.mock('../../../services/log/logService', () => ({
  logService: { warn: mockLogWarn, error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { buildJobStore } from './buildJobStore.svelte';
import { handleEvent, startBuild, ensureListening, stopListening } from './orchestrator';

beforeEach(async () => {
  await stopListening();
  mockListen.mockClear();
  buildJobStore.reset();
  buildJobStore.start('p', '/tmp/ext');
  mockPresentQuestion.mockClear();
  mockNotify.mockClear();
  mockFinalize.mockClear().mockResolvedValue({ leaked: false });
  mockSidecarStart.mockClear();
});

describe('handleEvent', () => {
  it('impossible verdict fails the job and notifies, no question', async () => {
    await handleEvent({ kind: 'verdict', possible: false, reason: 'needs a system keylogger' });
    expect(buildJobStore.job!.status).toBe('failed');
    expect(buildJobStore.job!.failure!.error).toContain('keylogger');
  });

  it('possible verdict keeps working and appends a step', async () => {
    await handleEvent({ kind: 'verdict', possible: true, reason: 'ok' });
    expect(buildJobStore.job!.status).toBe('working');
    expect(buildJobStore.job!.steps.length).toBe(1);
  });

  it('step event appends to the log', async () => {
    await handleEvent({ kind: 'step', label: 'Fetching Notion docs' });
    expect(buildJobStore.job!.steps).toContainEqual({ label: 'Fetching Notion docs', detail: undefined });
  });

  it('ask event delegates to presentQuestion', async () => {
    await handleEvent({ kind: 'ask', questionId: 'q1', prompt: 'Which DB?', inputKind: 'text' });
    expect(mockPresentQuestion).toHaveBeenCalledWith({ questionId: 'q1', prompt: 'Which DB?', inputKind: 'text', placeholder: undefined });
  });

  it('done event finalizes (secret scan + register/activate) and notifies success', async () => {
    await handleEvent({ kind: 'done', extensionId: 'com.x.notion', path: '/tmp/ext', smokeSummary: '200 OK' });
    expect(mockFinalize).toHaveBeenCalled();
    expect(buildJobStore.job!.status).toBe('done');
    expect(mockNotify).toHaveBeenCalled();
    const successCall = mockNotify.mock.calls.at(-1)!;
    expect(successCall[0]).toBe('create-extension');
    expect((successCall[1] as any).actions[0].commandId).toBe('build-with-ai');
  });

  it('done event fails the job if finalize throws (no silent hang)', async () => {
    mockFinalize.mockRejectedValueOnce(new Error('register failed'));
    await handleEvent({ kind: 'done', extensionId: 'com.x.notion', path: '/tmp/ext', smokeSummary: '200 OK' });
    expect(buildJobStore.job!.status).toBe('failed');
    expect(buildJobStore.job!.failure!.step).toBe('finalize');
    expect(mockNotify).toHaveBeenCalled();
  });

  it('done event fails closed if the secret guard reports a leak', async () => {
    mockFinalize.mockResolvedValueOnce({ leaked: true, path: 'src/config.ts' });
    await handleEvent({ kind: 'done', extensionId: 'com.x.notion', path: '/tmp/ext', smokeSummary: '200 OK' });
    expect(buildJobStore.job!.status).toBe('failed');
    expect(buildJobStore.job!.failure!.error).toContain('hardcoded secret');
  });

  it('fail event marks the job failed and notifies', async () => {
    await handleEvent({ kind: 'fail', step: 'build', error: 'tsc failed', log: 'TS2322' });
    expect(buildJobStore.job!.status).toBe('failed');
    expect(mockNotify).toHaveBeenCalled();
  });
});

describe('startBuild', () => {
  beforeEach(() => { buildJobStore.reset(); mockSidecarStart.mockClear(); });

  it('refuses when no Anthropic key is configured', async () => {
    const res = await startBuild('build a notion ext', { anthropicKey: '' });
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('Anthropic');
    expect(mockSidecarStart).not.toHaveBeenCalled();
  });

  it('refuses a whitespace-only key', async () => {
    const res = await startBuild('p', { anthropicKey: '   ' });
    expect(res.ok).toBe(false);
    expect(mockSidecarStart).not.toHaveBeenCalled();
  });

  it('starts a WORKING job and spawns the sidecar when a key is present', async () => {
    const res = await startBuild('build a notion ext', { anthropicKey: '  sk-ant-xxx  ' });
    expect(res.ok).toBe(true);
    expect(buildJobStore.job!.status).toBe('working');
    expect(mockSidecarStart).toHaveBeenCalledTimes(1);
    expect(mockSidecarStart).toHaveBeenCalledWith({
      prompt: 'build a notion ext',
      targetDir: '/home/u/AsyarExtensions',
      capabilitySpecDir: '/res/capabilitySpec',
      anthropicKey: 'sk-ant-xxx',
    });
  });

  it('subscribes to the Tauri event exactly once when a key is present', async () => {
    await startBuild('build a notion ext', { anthropicKey: 'sk-ant-xxx' });
    expect(mockListen).toHaveBeenCalledTimes(1);
    expect(mockListen).toHaveBeenCalledWith('asyar:ext-builder:event', expect.any(Function));
  });
});

describe('ensureListening', () => {
  beforeEach(async () => { await stopListening(); mockListen.mockClear(); mockLogWarn.mockClear(); });

  it('subscribes once and is idempotent', async () => {
    await ensureListening();
    await ensureListening();
    expect(mockListen).toHaveBeenCalledTimes(1);
    expect(mockListen).toHaveBeenCalledWith('asyar:ext-builder:event', expect.any(Function));
  });

  it('routes a parsed event from the listener callback through handleEvent', async () => {
    await stopListening();
    await ensureListening();
    const handler = mockListen.mock.calls[0][1] as (e: { payload: string }) => void;
    buildJobStore.reset();
    buildJobStore.start('p', '/tmp/ext');
    handler({ payload: JSON.stringify({ kind: 'step', label: 'hello' }) });
    // allow the void handleEvent microtask to flush
    await Promise.resolve();
    expect(buildJobStore.job!.steps.some(s => s.label === 'hello')).toBe(true);
  });

  it('drops an unparseable event without throwing', async () => {
    await stopListening();
    await ensureListening();
    const handler = mockListen.mock.calls[0][1] as (e: { payload: string }) => void;
    expect(() => handler({ payload: 'not json' })).not.toThrow();
    expect(mockLogWarn).toHaveBeenCalled();
  });
});
