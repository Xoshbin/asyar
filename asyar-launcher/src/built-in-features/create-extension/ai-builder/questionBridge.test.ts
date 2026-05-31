import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSend = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockNotify = vi.hoisted(() => vi.fn().mockResolvedValue('notif-1'));

vi.mock('./sidecarClient', () => ({ sidecarClient: { send: mockSend } }));
vi.mock('../../../services/notification/notificationService', () => ({
  notificationService: { send: mockNotify },
}));
vi.mock('../../../services/log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { buildJobStore } from './buildJobStore.svelte';
import { presentQuestion, submitAnswer } from './questionBridge';

beforeEach(() => {
  buildJobStore.reset();
  mockSend.mockClear();
  mockNotify.mockClear();
});

describe('presentQuestion', () => {
  it('sets the store question and fires a deep-linkable notification', async () => {
    buildJobStore.start('Build a Notion extension', '/tmp/ext');
    await presentQuestion({ questionId: 'q1', prompt: 'Which database?', inputKind: 'text' });

    expect(buildJobStore.job!.status).toBe('waiting');
    expect(buildJobStore.job!.pendingQuestion!.questionId).toBe('q1');

    expect(mockNotify).toHaveBeenCalledTimes(1);

    // First arg is callerExtensionId
    const [callerExtId, options] = mockNotify.mock.calls[0] as [string, { title: string; body?: string; actions?: Array<{ id: string; title: string; commandId: string; args?: Record<string, unknown> }> }];
    expect(callerExtId).toBe('create-extension');

    // Must have an action that deep-links to the build view command
    expect(options.actions).toBeDefined();
    expect(options.actions!.length).toBeGreaterThanOrEqual(1);
    const action = options.actions![0];
    expect(action.commandId).toBe('build-with-ai');
  });
});

describe('submitAnswer', () => {
  it('clears the question and writes an answer command to the sidecar', async () => {
    buildJobStore.start('Build a Notion extension', '/tmp/ext');
    buildJobStore.setQuestion({ questionId: 'q1', prompt: 'Which database?', inputKind: 'text' });

    await submitAnswer('Tasks DB');

    expect(mockSend).toHaveBeenCalledWith({ kind: 'answer', questionId: 'q1', value: 'Tasks DB' });
    expect(buildJobStore.job!.status).toBe('working');
    expect(buildJobStore.job!.pendingQuestion).toBeNull();
  });

  it('does nothing when there is no pending question', async () => {
    buildJobStore.start('Build a Notion extension', '/tmp/ext');
    // No question set — pendingQuestion is null

    await submitAnswer('ignored');

    expect(mockSend).not.toHaveBeenCalled();
  });
});
