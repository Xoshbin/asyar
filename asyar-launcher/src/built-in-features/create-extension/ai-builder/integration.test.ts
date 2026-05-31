import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockInvoke = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockNotify = vi.hoisted(() => vi.fn().mockResolvedValue('notif-id'));
const mockFinalize = vi.hoisted(() => vi.fn().mockResolvedValue({ leaked: false }));

vi.mock('@tauri-apps/api/core', () => ({ invoke: mockInvoke }));
vi.mock('../../../services/notification/notificationService', () => ({ notificationService: { send: mockNotify } }));
vi.mock('./finalizeBuild', () => ({ finalizeBuild: mockFinalize }));

// orchestrator.ts imports these at module level — mock to prevent Tauri native calls
vi.mock('@tauri-apps/api/path', () => ({
  homeDir: vi.fn().mockResolvedValue('/home/u'),
  join: vi.fn(async (...p: string[]) => p.join('/')),
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));
vi.mock('./buildPaths', () => ({
  resolveCapabilitySpecDir: vi.fn().mockResolvedValue('/res/capabilitySpec'),
}));
vi.mock('../../../services/log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { buildJobStore } from './buildJobStore.svelte';
import { handleEvent } from './orchestrator';
import { submitAnswer } from './questionBridge';
import { parseSidecarEvent } from './buildProtocol';

beforeEach(() => { buildJobStore.reset(); mockInvoke.mockClear(); mockNotify.mockClear(); mockFinalize.mockClear().mockResolvedValue({ leaked: false }); });

// A fake sidecar transcript: gate -> steps -> ask -> step -> done.
const TRANSCRIPT = [
  '{"kind":"verdict","possible":true,"reason":"fits network + storage + preferences"}',
  '{"kind":"step","label":"Fetching Notion API docs"}',
  '{"kind":"ask","questionId":"q1","prompt":"Which Notion database?","inputKind":"text"}',
  // (answer injected by the test between these)
  '{"kind":"step","label":"Smoke test: GET /v1/databases"}',
  '{"kind":"done","extensionId":"com.user.notion","path":"/home/u/AsyarExtensions/com.user.notion","smokeSummary":"200 OK"}',
];

describe('end-to-end native flow with real ids', () => {
  it('drives gate -> waiting -> answer -> done and finalizes with the real path/id', async () => {
    buildJobStore.start('create an extension for Notion', '/home/u/AsyarExtensions');

    await handleEvent(parseSidecarEvent(TRANSCRIPT[0])!); // verdict
    expect(buildJobStore.job!.status).toBe('working');

    await handleEvent(parseSidecarEvent(TRANSCRIPT[1])!); // step
    await handleEvent(parseSidecarEvent(TRANSCRIPT[2])!); // ask
    expect(buildJobStore.job!.status).toBe('waiting');
    expect(buildJobStore.job!.pendingQuestion!.questionId).toBe('q1');
    expect(mockNotify).toHaveBeenCalled(); // deep-link notification fired

    await submitAnswer('Tasks DB'); // writes answer to sidecar, resumes
    expect(mockInvoke).toHaveBeenCalledWith('ext_builder_answer', { line: '{"kind":"answer","questionId":"q1","value":"Tasks DB"}' });
    expect(buildJobStore.job!.status).toBe('working');

    await handleEvent(parseSidecarEvent(TRANSCRIPT[3])!); // step
    await handleEvent(parseSidecarEvent(TRANSCRIPT[4])!); // done

    expect(mockFinalize).toHaveBeenCalledWith('/home/u/AsyarExtensions/com.user.notion', 'com.user.notion');
    expect(buildJobStore.job!.status).toBe('done');
    expect(buildJobStore.job!.result!.smokeSummary).toBe('200 OK');
  });

  it('a leaked-secret done event fails closed end-to-end', async () => {
    mockFinalize.mockResolvedValueOnce({ leaked: true, path: 'src/config.ts' });
    buildJobStore.start('p', '/home/u/AsyarExtensions');
    await handleEvent(parseSidecarEvent(TRANSCRIPT[4])!);
    expect(buildJobStore.job!.status).toBe('failed');
    expect(buildJobStore.job!.failure!.error).toContain('hardcoded secret');
  });
});
