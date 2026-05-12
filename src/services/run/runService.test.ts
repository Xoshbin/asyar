import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('../../lib/ipc/invokeSafe', () => ({ invokeSafe: vi.fn() }));
vi.mock('../diagnostics/diagnosticsService.svelte', () => ({
  diagnosticsService: { report: vi.fn() },
}));
vi.mock('../extension/extensionIframeSelector', () => ({
  pickExtensionIframe: vi.fn(),
}));
vi.mock('../notification/notificationService', () => ({
  notificationService: { send: vi.fn() },
}));

import { runService } from './runService.svelte';
import { invokeSafe } from '../../lib/ipc/invokeSafe';
import { listen } from '@tauri-apps/api/event';
import { diagnosticsService } from '../diagnostics/diagnosticsService.svelte';
import { pickExtensionIframe } from '../extension/extensionIframeSelector';
import { notificationService } from '../notification/notificationService';
import type { Run } from 'asyar-sdk/contracts';

const makeRun = (over: Partial<Run> = {}): Run => ({
  id: 'r1',
  kind: 'shell-script',
  label: 'My Script',
  status: 'running',
  startedAt: Date.now(),
  cancellable: false,
  ...over,
});

beforeEach(() => {
  runService.reset();
  vi.clearAllMocks();
});

// ── IPC-callable methods ───────────────────────────────────────────────────────

describe('start', () => {
  it('start_invokes_runs_start_with_correct_args', async () => {
    vi.mocked(invokeSafe).mockResolvedValue(makeRun());
    await runService.start('ext.foo', 'r1', 'shell-script', 'My Script', true);
    expect(invokeSafe).toHaveBeenCalledWith('runs_start', {
      id: 'r1',
      kind: 'shell-script',
      label: 'My Script',
      extensionId: 'ext.foo',
      cancellable: true,
      subjectId: null,
    });
  });

  it('forwards subjectId in the runs_start payload when provided', async () => {
    vi.mocked(invokeSafe).mockResolvedValue(makeRun());
    await runService.start('ext.foo', 'r1', 'shell-script', 'My Script', true, 'cmd_scripts_dyn_abc');
    expect(invokeSafe).toHaveBeenCalledWith('runs_start', expect.objectContaining({
      subjectId: 'cmd_scripts_dyn_abc',
    }));
  });
});

describe('startLocal', () => {
  it('forwards subjectId from the input options to start()', async () => {
    vi.mocked(invokeSafe).mockResolvedValue(makeRun());
    await runService.startLocal({
      label: 'Hosts Update',
      kind: 'shell-script',
      cancellable: false,
      extensionId: null,
      subjectId: 'cmd_scripts_dyn_abc',
    });
    expect(invokeSafe).toHaveBeenCalledWith('runs_start', expect.objectContaining({
      subjectId: 'cmd_scripts_dyn_abc',
    }));
  });

  it('passes subjectId=null when omitted', async () => {
    vi.mocked(invokeSafe).mockResolvedValue(makeRun());
    await runService.startLocal({ label: 'x', kind: 'custom' });
    expect(invokeSafe).toHaveBeenCalledWith('runs_start', expect.objectContaining({
      subjectId: null,
    }));
  });
});

describe('write', () => {
  it('write_invokes_runs_write', async () => {
    vi.mocked(invokeSafe).mockResolvedValue(null);
    await runService.write('ext.foo', 'r1', 'hello');
    expect(invokeSafe).toHaveBeenCalledWith('runs_write', { id: 'r1', line: 'hello' });
  });
});

describe('done', () => {
  it('done_invokes_runs_done', async () => {
    vi.mocked(invokeSafe).mockResolvedValue(null);
    await runService.done('ext.foo', 'r1');
    expect(invokeSafe).toHaveBeenCalledWith('runs_done', { id: 'r1' });
  });
});

describe('fail', () => {
  it('fail_invokes_runs_fail_with_error', async () => {
    vi.mocked(invokeSafe).mockResolvedValue(null);
    await runService.fail('ext.foo', 'r1', 'boom');
    expect(invokeSafe).toHaveBeenCalledWith('runs_fail', { id: 'r1', error: 'boom' });
  });
});

describe('cancel', () => {
  it('cancel_invokes_runs_cancel', async () => {
    vi.mocked(invokeSafe).mockResolvedValue(null);
    await runService.cancel('ext.foo', 'r1');
    expect(invokeSafe).toHaveBeenCalledWith('runs_cancel', { id: 'r1' });
  });
});

// ── State mirroring via Tauri events ──────────────────────────────────────────

describe('onStateChanged', () => {
  it('state_changed_running_inserts_into_active', () => {
    const run = makeRun({ id: 'r1', status: 'running' });
    runService['onStateChanged'](run);
    expect(runService.active).toContainEqual(run);
  });

  it('state_changed_running_to_succeeded_moves_to_recent', () => {
    const runRunning = makeRun({ id: 'r1', status: 'running' });
    const runSucceeded = makeRun({ id: 'r1', status: 'succeeded', endedAt: Date.now() });
    runService['onStateChanged'](runRunning);
    runService['onStateChanged'](runSucceeded);
    const inActive = runService.active.some((r) => r.id === 'r1');
    expect(inActive).toBe(false);
    const inRecent = runService.recent.find((r) => r.id === 'r1');
    expect(inRecent).toBeDefined();
    expect(inRecent?.status).toBe('succeeded');
  });

  it('state_changed_failed_routes_through_diagnostics', () => {
    const run = makeRun({ id: 'r1', status: 'failed', errorMessage: 'boom' });
    runService['onStateChanged'](run);
    expect(diagnosticsService.report).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'run_failed', severity: 'warning' }),
    );
  });

  it('state_changed_cancelled_with_extension_id_posts_to_iframe', () => {
    const postMessage = vi.fn();
    const fakeIframe = { contentWindow: { postMessage } } as unknown as HTMLIFrameElement;
    vi.mocked(pickExtensionIframe).mockReturnValue(fakeIframe);

    const run = makeRun({ id: 'r1', status: 'cancelled', extensionId: 'ext.foo' });
    runService['onStateChanged'](run);

    expect(pickExtensionIframe).toHaveBeenCalledWith('ext.foo', 'worker');
    expect(postMessage).toHaveBeenCalledWith(
      { type: 'asyar:event:runs:cancel', payload: { id: 'r1' } },
      '*',
    );
  });

  it('state_changed_cancelled_without_extension_id_does_not_post', () => {
    const run = makeRun({ id: 'r1', status: 'cancelled', extensionId: undefined });
    runService['onStateChanged'](run);
    expect(pickExtensionIframe).not.toHaveBeenCalled();
  });

  // ── keptAgents: persistent thread rows ──────────────────────────────────────

  it('succeeded_agent_run_with_subjectId_is_added_to_keptAgents', () => {
    const run = makeRun({
      id: 'r1', status: 'succeeded', kind: 'agent',
      subjectId: 'cmd_agents_dyn_a1', endedAt: Date.now(),
    });
    runService['onStateChanged'](run);
    expect(runService.keptAgents).toHaveLength(1);
    expect(runService.keptAgents[0].id).toBe('r1');
  });

  it('succeeded_shell_script_does_NOT_populate_keptAgents', () => {
    // Lifecycle policy: scripts auto-remove on success. The kept slice is
    // strictly agent-only.
    const run = makeRun({
      id: 'r1', status: 'succeeded', kind: 'shell-script',
      subjectId: 'cmd_scripts_dyn_abc', endedAt: Date.now(),
    });
    runService['onStateChanged'](run);
    expect(runService.keptAgents).toHaveLength(0);
  });

  it('keptAgents_dedupes_by_subjectId_keeping_newest', () => {
    const old = makeRun({
      id: 'r1', status: 'succeeded', kind: 'agent',
      subjectId: 'cmd_agents_dyn_a1', endedAt: 1,
    });
    const fresh = makeRun({
      id: 'r2', status: 'succeeded', kind: 'agent',
      subjectId: 'cmd_agents_dyn_a1', endedAt: 2,
    });
    runService['onStateChanged'](old);
    runService['onStateChanged'](fresh);
    expect(runService.keptAgents).toHaveLength(1);
    expect(runService.keptAgents[0].id).toBe('r2');
  });

  it('keptAgents_keeps_separate_entries_per_distinct_subjectId', () => {
    runService['onStateChanged'](makeRun({
      id: 'r1', status: 'succeeded', kind: 'agent',
      subjectId: 'cmd_agents_dyn_a1', endedAt: 1,
    }));
    runService['onStateChanged'](makeRun({
      id: 'r2', status: 'succeeded', kind: 'agent',
      subjectId: 'cmd_agents_dyn_a2', endedAt: 2,
    }));
    expect(runService.keptAgents).toHaveLength(2);
  });

  it('succeeded_agent_without_subjectId_is_skipped', () => {
    // Without a subjectId we can't dedupe / re-open the thread, so skip.
    const run = makeRun({
      id: 'r1', status: 'succeeded', kind: 'agent',
      subjectId: undefined, endedAt: Date.now(),
    });
    runService['onStateChanged'](run);
    expect(runService.keptAgents).toHaveLength(0);
  });

  it('dismissKeptAgent_removes_the_entry', () => {
    runService['onStateChanged'](makeRun({
      id: 'r1', status: 'succeeded', kind: 'agent',
      subjectId: 'cmd_agents_dyn_a1', endedAt: 1,
    }));
    runService.dismissKeptAgent('r1');
    expect(runService.keptAgents).toHaveLength(0);
  });
});

// ── History ───────────────────────────────────────────────────────────────────

describe('loadHistory', () => {
  it('load_history_fetches_and_populates_recent', async () => {
    const runs = [
      makeRun({ id: 'r1', status: 'succeeded' }),
      makeRun({ id: 'r2', status: 'failed' }),
      makeRun({ id: 'r3', status: 'cancelled' }),
    ];
    vi.mocked(invokeSafe).mockResolvedValue(runs);
    await runService.loadHistory();
    expect(runService.recent).toEqual(runs);
  });

  it('load_history_handles_null_response', async () => {
    const prior = [makeRun({ id: 'r0', status: 'succeeded' })];
    runService.recent = prior;
    vi.mocked(invokeSafe).mockResolvedValue(null);
    await runService.loadHistory();
    expect(runService.recent).toEqual(prior);
  });
});

describe('clearHistory', () => {
  it('clear_history_invokes_command_and_empties_recent', async () => {
    runService.recent = [makeRun({ id: 'r1', status: 'succeeded' })];
    vi.mocked(invokeSafe).mockResolvedValue(null);
    await runService.clearHistory();
    expect(invokeSafe).toHaveBeenCalledWith('runs_history_clear');
    expect(runService.recent).toEqual([]);
  });
});

// ── UI cancel + reactivity ────────────────────────────────────────────────────

describe('cancelById', () => {
  it('cancel_by_id_invokes_runs_cancel', async () => {
    vi.mocked(invokeSafe).mockResolvedValue(null);
    await runService.cancelById('r1');
    expect(invokeSafe).toHaveBeenCalledWith('runs_cancel', { id: 'r1' });
  });
});

describe('activeCount', () => {
  it('active_count_is_derived_from_active_length', () => {
    expect(runService.activeCount).toBe(0);
    const r1 = makeRun({ id: 'r1', status: 'running' });
    const r2 = makeRun({ id: 'r2', status: 'running' });
    runService['onStateChanged'](r1);
    runService['onStateChanged'](r2);
    expect(runService.activeCount).toBe(2);
    const r1Succeeded = makeRun({ id: 'r1', status: 'succeeded', endedAt: Date.now() });
    runService['onStateChanged'](r1Succeeded);
    expect(runService.activeCount).toBe(1);
  });
});

// ── Tray running-count effect ─────────────────────────────────────────────────

describe('tray running-count effect', () => {
  it('activeCount_change_invokes_tray_set_running_count', () => {
    const r1 = makeRun({ id: 'r1', status: 'running' });
    const r2 = makeRun({ id: 'r2', status: 'running' });

    runService['onStateChanged'](r1);
    expect(invokeSafe).toHaveBeenCalledWith('tray_set_running_count', { n: 1 });

    runService['onStateChanged'](r2);
    expect(invokeSafe).toHaveBeenCalledWith('tray_set_running_count', { n: 2 });

    const r1Succeeded = makeRun({ id: 'r1', status: 'succeeded', endedAt: Date.now() });
    runService['onStateChanged'](r1Succeeded);
    expect(invokeSafe).toHaveBeenCalledWith('tray_set_running_count', { n: 1 });
  });

  it('tray_count_starts_at_zero_on_init', () => {
    expect(invokeSafe).toHaveBeenCalledWith('tray_set_running_count', { n: 0 });
  });
});

describe('output event listener', () => {
  it('output_event_handler_is_called_when_event_fires', () => {
    const listenMock = vi.mocked(listen);
    const registeredEvents = listenMock.mock.calls.map((c) => c[0] as string);
    expect(registeredEvents).toContain('runs:output');
  });
});

// ── selectedRunId ─────────────────────────────────────────────────────────────

describe('selectedRunId', () => {
  it('selectedRunId_starts_null_and_is_assignable', () => {
    expect(runService.selectedRunId).toBeNull();
    runService.selectedRunId = 'r1';
    expect(runService.selectedRunId).toBe('r1');
    runService.selectedRunId = null;
    expect(runService.selectedRunId).toBeNull();
  });
});

// ── startLocal ────────────────────────────────────────────────────────────────

describe('startLocal', () => {
  it('startLocal_generates_uuid_and_invokes_start', async () => {
    const mockRun = makeRun({ id: 'generated-uuid', status: 'running' });
    vi.mocked(invokeSafe).mockResolvedValue(mockRun);

    const handle = await runService.startLocal({ label: 'X', kind: 'agent' });

    expect(invokeSafe).toHaveBeenCalledWith(
      'runs_start',
      expect.objectContaining({
        extensionId: null,
        kind: 'agent',
        label: 'X',
        cancellable: false,
        id: expect.any(String),
      }),
    );
    expect(typeof handle.id).toBe('string');
    expect(handle.id.length).toBeGreaterThan(0);
  });

  it('startLocal_cancellable_passed_through', async () => {
    const mockRun = makeRun({ id: 'generated-uuid', status: 'running' });
    vi.mocked(invokeSafe).mockResolvedValue(mockRun);

    await runService.startLocal({ label: 'Y', kind: 'agent', cancellable: true });

    expect(invokeSafe).toHaveBeenCalledWith(
      'runs_start',
      expect.objectContaining({ cancellable: true }),
    );
  });

  it('local_handle_write_invokes_runs_write', async () => {
    const mockRun = makeRun({ id: 'r-handle', status: 'running' });
    vi.mocked(invokeSafe).mockResolvedValue(mockRun);

    const handle = await runService.startLocal({ label: 'Z', kind: 'agent' });
    vi.clearAllMocks();
    vi.mocked(invokeSafe).mockResolvedValue(null);

    await handle.write('line');

    expect(invokeSafe).toHaveBeenCalledWith('runs_write', { id: handle.id, line: 'line' });
  });

  it('local_handle_done_fail_cancel_invoke_correct_commands', async () => {
    const mockRun = makeRun({ id: 'r-multi', status: 'running' });
    vi.mocked(invokeSafe).mockResolvedValue(mockRun);

    const handle = await runService.startLocal({ label: 'multi', kind: 'agent' });
    vi.clearAllMocks();
    vi.mocked(invokeSafe).mockResolvedValue(null);

    await handle.done();
    expect(invokeSafe).toHaveBeenCalledWith('runs_done', { id: handle.id });

    vi.clearAllMocks();
    vi.mocked(invokeSafe).mockResolvedValue(null);
    await handle.fail('boom');
    expect(invokeSafe).toHaveBeenCalledWith('runs_fail', { id: handle.id, error: 'boom' });

    vi.clearAllMocks();
    vi.mocked(invokeSafe).mockResolvedValue(null);
    await handle.cancel();
    expect(invokeSafe).toHaveBeenCalledWith('runs_cancel', { id: handle.id });
  });

  it('local_handle_onCancel_fires_when_state_changed_cancelled_for_id', async () => {
    const mockRun = makeRun({ id: 'r-cancel-cb', status: 'running' });
    vi.mocked(invokeSafe).mockResolvedValue(mockRun);

    const handle = await runService.startLocal({ label: 'cancel-test', kind: 'agent' });
    const cb = vi.fn();
    handle.onCancel(cb);

    // Simulate cancel for a different id — cb must NOT fire
    runService['onStateChanged'](makeRun({ id: 'other-id', status: 'cancelled' }));
    expect(cb).not.toHaveBeenCalled();

    // Simulate cancel for the correct id — cb MUST fire
    runService['onStateChanged'](makeRun({ id: handle.id, status: 'cancelled' }));
    expect(cb).toHaveBeenCalledTimes(1);

    // Simulate cancel again — internal set deleted, cb must NOT fire again
    runService['onStateChanged'](makeRun({ id: handle.id, status: 'cancelled' }));
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

// ── Failure notifications ─────────────────────────────────────────────────────

describe('failure notifications', () => {
  it('failed_run_fires_notification_with_open_action', () => {
    const run = makeRun({ id: 'r1', label: 'My Run', status: 'failed', errorMessage: 'boom' });
    runService['onStateChanged'](run);

    expect(notificationService.send).toHaveBeenCalledTimes(1);

    const [callerExtId, options] = vi.mocked(notificationService.send).mock.calls[0];
    expect(callerExtId).toBe('runs');
    expect(options.title.toLowerCase()).toContain('failed');
    expect(options.body).toContain('My Run');
    expect(options.actions).toBeDefined();
    expect(options.actions!.length).toBeGreaterThanOrEqual(1);

    const openAction = options.actions![0];
    expect(openAction.commandId).toBe('open-runs');
    expect(openAction.args).toEqual(expect.objectContaining({ arguments: { id: 'r1' } }));
  });

  it('succeeded_run_does_not_fire_notification', () => {
    const run = makeRun({ id: 'r2', status: 'succeeded', endedAt: Date.now() });
    runService['onStateChanged'](run);
    expect(notificationService.send).not.toHaveBeenCalled();
  });

  it('cancelled_run_does_not_fire_notification', () => {
    const run = makeRun({ id: 'r3', status: 'cancelled' });
    runService['onStateChanged'](run);
    expect(notificationService.send).not.toHaveBeenCalled();
  });

  it('running_state_change_does_not_fire_notification', () => {
    const run = makeRun({ id: 'r4', status: 'running' });
    runService['onStateChanged'](run);
    expect(notificationService.send).not.toHaveBeenCalled();
  });

  it('failed_run_notification_open_action_includes_run_id', () => {
    const run = makeRun({ id: 'specific-run-id', label: 'Labeled Run', status: 'failed', extensionId: 'ext.foo' });
    runService['onStateChanged'](run);

    expect(notificationService.send).toHaveBeenCalledTimes(1);
    const [, options] = vi.mocked(notificationService.send).mock.calls[0];
    const openAction = options.actions!.find((a) => a.commandId === 'open-runs');
    expect(openAction).toBeDefined();
    expect(openAction!.args?.['arguments']).toEqual(expect.objectContaining({ id: 'specific-run-id' }));
  });
});
