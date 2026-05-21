import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/shell/shellService.svelte', () => ({
  shellService: { spawn: vi.fn(async () => ({ streaming: true })) },
}));

vi.mock('../../services/diagnostics/diagnosticsService.svelte', () => ({
  diagnosticsService: { report: vi.fn(async () => {}) },
}));

vi.mock('./scriptsManager.svelte', () => ({
  scriptsManager: {
    getScriptByDynamicId: vi.fn(),
  },
}));

import { dispatchScriptCommand } from './dispatch';
import { shellService } from '../../services/shell/shellService.svelte';
import { diagnosticsService } from '../../services/diagnostics/diagnosticsService.svelte';
import { scriptsManager } from './scriptsManager.svelte';
import type { ScannedScript } from './types';

const mockScript: ScannedScript = {
  absolutePath: '/foo/bar.sh',
  dynamicId: 'dyn123',
  header: {
    title: 'My Script',
    icon: null,
    arguments: [],
    mode: 'compact',
    refreshTimeSeconds: null,
    refreshTimeClamped: false,
  },
  executable: true,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('dispatchScriptCommand', () => {
  it('dispatch_with_known_id_calls_shell_spawn', async () => {
    vi.mocked(scriptsManager.getScriptByDynamicId).mockReturnValue(mockScript);

    await dispatchScriptCommand('dyn123', undefined);

    expect(shellService.spawn).toHaveBeenCalledWith(
      'scripts',
      '/foo/bar.sh',
      [],
      expect.any(String),
      undefined,
      'cmd_scripts_dyn_dyn123',
      'My Script',
    );
    expect(diagnosticsService.report).not.toHaveBeenCalled();
  });

  it('dispatch_passes_script_title_as_run_label', async () => {
    vi.mocked(scriptsManager.getScriptByDynamicId).mockReturnValue(mockScript);

    await dispatchScriptCommand('dyn123', undefined);

    const call = vi.mocked(shellService.spawn).mock.calls[0];
    // 7th positional arg is the display name used as the run label.
    expect(call[6]).toBe('My Script');
  });

  it('dispatch_falls_back_to_filename_when_script_has_no_title', async () => {
    const scriptNoTitle: ScannedScript = {
      ...mockScript,
      absolutePath: '/Users/me/scripts/sync-hosts.sh',
      header: { ...mockScript.header, title: null },
    };
    vi.mocked(scriptsManager.getScriptByDynamicId).mockReturnValue(scriptNoTitle);

    await dispatchScriptCommand('dyn123', undefined);

    const call = vi.mocked(shellService.spawn).mock.calls[0];
    expect(call[6]).toBe('sync-hosts');
  });

  it('dispatch_passes_subjectId_matching_dynamic_command_object_id', async () => {
    vi.mocked(scriptsManager.getScriptByDynamicId).mockReturnValue(mockScript);

    await dispatchScriptCommand('dyn123', undefined);

    // Per the dynamic-commands convention, the script's command object_id is
    // `cmd_scripts_dyn_<dynamicId>`. The launcher list joins script rows to
    // their runs by checking `run.subjectId === item.object_id`, so the
    // subjectId we tag the run with MUST equal that exact string.
    const call = vi.mocked(shellService.spawn).mock.calls[0];
    expect(call[5]).toBe('cmd_scripts_dyn_dyn123');
  });

  it('dispatch_with_unknown_id_reports_diagnostic', async () => {
    vi.mocked(scriptsManager.getScriptByDynamicId).mockReturnValue(undefined);

    await dispatchScriptCommand('ghost', undefined);

    expect(diagnosticsService.report).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'action_failed' }),
    );
    expect(shellService.spawn).not.toHaveBeenCalled();
  });

  it('dispatch_with_args_passes_them_in_declared_order', async () => {
    const scriptWithArgs: ScannedScript = {
      ...mockScript,
      header: {
        ...mockScript.header,
        arguments: [
          { name: 'name', type: 'text', placeholder: undefined, required: false },
          { name: 'count', type: 'text', placeholder: undefined, required: false },
        ],
      },
    };
    vi.mocked(scriptsManager.getScriptByDynamicId).mockReturnValue(scriptWithArgs);

    await dispatchScriptCommand('dyn123', { name: 'alice', count: 3 });

    expect(shellService.spawn).toHaveBeenCalledWith(
      'scripts',
      '/foo/bar.sh',
      ['alice', '3'],
      expect.any(String),
      undefined,
      'cmd_scripts_dyn_dyn123',
      'My Script',
    );
  });

  it('dispatch_returns_keepLauncherOpen_on_success', async () => {
    vi.mocked(scriptsManager.getScriptByDynamicId).mockReturnValue(mockScript);

    const result = await dispatchScriptCommand('dyn123', undefined);

    expect(result).toEqual({ keepLauncherOpen: true });
  });

  it('dispatch_returns_keepLauncherOpen_when_script_not_found', async () => {
    vi.mocked(scriptsManager.getScriptByDynamicId).mockReturnValue(undefined);

    const result = await dispatchScriptCommand('ghost', undefined);

    expect(result).toEqual({ keepLauncherOpen: true });
  });

  it('dispatch_resolves_args_under_arguments_key_envelope', async () => {
    const scriptWithArgs: ScannedScript = {
      ...mockScript,
      header: {
        ...mockScript.header,
        arguments: [
          { name: 'name', type: 'text', placeholder: undefined, required: false },
          { name: 'count', type: 'text', placeholder: undefined, required: false },
        ],
      },
    };
    vi.mocked(scriptsManager.getScriptByDynamicId).mockReturnValue(scriptWithArgs);

    await dispatchScriptCommand('dyn123', { arguments: { name: 'alice', count: 3 } } as any);

    expect(shellService.spawn).toHaveBeenCalledWith(
      'scripts',
      '/foo/bar.sh',
      ['alice', '3'],
      expect.any(String),
      undefined,
      'cmd_scripts_dyn_dyn123',
      'My Script',
    );
  });
});
