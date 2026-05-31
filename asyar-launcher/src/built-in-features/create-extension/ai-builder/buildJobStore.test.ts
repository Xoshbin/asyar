import { describe, it, expect, beforeEach } from 'vitest';
import { buildJobStore } from './buildJobStore.svelte';

beforeEach(() => buildJobStore.reset());

describe('buildJobStore', () => {
  it('starts idle with no job', () => {
    expect(buildJobStore.job).toBeNull();
  });

  it('start() creates a WORKING job with the prompt and empty steps', () => {
    buildJobStore.start('build a notion extension', '/tmp/ext');
    expect(buildJobStore.job).toMatchObject({ status: 'working', prompt: 'build a notion extension', dir: '/tmp/ext', steps: [] });
  });

  it('appendStep() adds to the step log while WORKING', () => {
    buildJobStore.start('p', '/tmp/ext');
    buildJobStore.appendStep({ label: 'Fetching docs' });
    buildJobStore.appendStep({ label: 'Writing manifest', detail: 'manifest.json' });
    expect(buildJobStore.job!.steps).toEqual([
      { label: 'Fetching docs' },
      { label: 'Writing manifest', detail: 'manifest.json' },
    ]);
  });

  it('setQuestion() moves to WAITING and clearing it returns to WORKING', () => {
    buildJobStore.start('p', '/tmp/ext');
    buildJobStore.setQuestion({ questionId: 'q1', prompt: 'Which DB?', inputKind: 'text' });
    expect(buildJobStore.job!.status).toBe('waiting');
    expect(buildJobStore.job!.pendingQuestion!.questionId).toBe('q1');
    buildJobStore.clearQuestion();
    expect(buildJobStore.job!.status).toBe('working');
    expect(buildJobStore.job!.pendingQuestion).toBeNull();
  });

  it('finishDone() moves to DONE with result and wipes the build-time secret', () => {
    buildJobStore.start('p', '/tmp/ext');
    buildJobStore.setBuildSecret('secret-ABC-123');
    buildJobStore.finishDone({ extensionId: 'com.x.notion', path: '/tmp/ext', smokeSummary: '200 OK' });
    expect(buildJobStore.job!.status).toBe('done');
    expect(buildJobStore.job!.result).toMatchObject({ extensionId: 'com.x.notion' });
    expect(buildJobStore.buildSecret).toBeNull();
  });

  it('finishFailed() moves to FAILED with the error and log, and wipes the build-time secret', () => {
    buildJobStore.start('p', '/tmp/ext');
    buildJobStore.setBuildSecret('secret-ABC-123');
    buildJobStore.finishFailed({ step: 'build', error: 'tsc failed', log: 'TS2322 ...' });
    expect(buildJobStore.job!.status).toBe('failed');
    expect(buildJobStore.job!.failure).toMatchObject({ step: 'build' });
    expect(buildJobStore.buildSecret).toBeNull();
  });
});
