import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/ipc/commands', () => ({
  scriptsRescan: vi.fn(async () => []),
  replaceDynamicCommandsBuiltin: vi.fn(async () => {}),
  scriptsSetInlineScripts: vi.fn(async () => ({
    accepted: [],
    capped: [],
    dropped: [],
  })),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => {}),
}));

vi.mock('../../services/log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../services/diagnostics/diagnosticsService.svelte', () => ({
  diagnosticsService: { report: vi.fn(async () => {}) },
}));

vi.mock('../../services/extension/commandService.svelte', () => ({
  commandService: { liveSubtitles: {} as Record<string, string | null> },
}));

import { scriptsManager } from './scriptsManager.svelte';
import * as commands from '../../lib/ipc/commands';
import { listen } from '@tauri-apps/api/event';
import { diagnosticsService } from '../../services/diagnostics/diagnosticsService.svelte';
import { commandService } from '../../services/extension/commandService.svelte';
import type { ScannedScript } from './types';

const mockScript: ScannedScript = {
  absolutePath: '/home/user/scripts/deploy.sh',
  dynamicId: 'dyn-abc123',
  header: {
    title: 'Deploy',
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
  scriptsManager.reset();
  // Reset the shared mock state on commandService.liveSubtitles
  commandService.liveSubtitles = {};
});

function makeInlineScript(
  overrides: Partial<ScannedScript> & {
    headerOverrides?: Partial<ScannedScript['header']>;
  } = {},
): ScannedScript {
  const { headerOverrides, ...rest } = overrides;
  return {
    absolutePath: '/scripts/clock.sh',
    dynamicId: 'inl-001',
    header: {
      title: 'Clock',
      icon: 'icon:clock',
      arguments: [],
      mode: 'inline',
      refreshTimeSeconds: 10,
      refreshTimeClamped: false,
      ...headerOverrides,
    },
    executable: true,
    ...rest,
  };
}

describe('ScriptsManager', () => {
  it('start_subscribes_to_scripts_changed_event', async () => {
    await scriptsManager.start();

    expect(listen).toHaveBeenCalledWith('scripts:changed', expect.any(Function));
  });

  it('start_calls_initial_rescan_and_registers', async () => {
    vi.mocked(commands.scriptsRescan).mockResolvedValueOnce([mockScript]);

    await scriptsManager.start();

    expect(commands.scriptsRescan).toHaveBeenCalled();
    expect(commands.replaceDynamicCommandsBuiltin).toHaveBeenCalledWith(
      'scripts',
      expect.arrayContaining([
        expect.objectContaining({ id: mockScript.dynamicId }),
      ]),
    );
  });

  it('scripts_changed_event_triggers_rescan', async () => {
    let capturedHandler: (() => void) | null = null;
    vi.mocked(listen).mockImplementation(async (event, handler) => {
      // start() registers two listeners; only `scripts:changed` carries
      // the rescan trigger. The inline-tick handler reads `event.payload`,
      // so we MUST scope this capture to the right event name.
      if (event === 'scripts:changed') {
        capturedHandler = handler as () => void;
      }
      return () => {};
    });

    await scriptsManager.start();

    expect(commands.scriptsRescan).toHaveBeenCalledTimes(1);

    capturedHandler!();
    await Promise.resolve();

    expect(commands.scriptsRescan).toHaveBeenCalledTimes(2);
  });

  it('start_with_titled_script_uses_title_as_command_name', async () => {
    const titled: ScannedScript = { ...mockScript, header: { ...mockScript.header, title: 'Deploy' } };
    vi.mocked(commands.scriptsRescan).mockResolvedValueOnce([titled]);

    await scriptsManager.start();

    const [, regs] = vi.mocked(commands.replaceDynamicCommandsBuiltin).mock.calls[0];
    expect((regs as { name: string }[])[0].name).toBe('Deploy');
  });

  it('start_with_no_title_falls_back_to_filename', async () => {
    const untitled: ScannedScript = {
      ...mockScript,
      absolutePath: '/home/user/scripts/my_backup.sh',
      header: { ...mockScript.header, title: null },
    };
    vi.mocked(commands.scriptsRescan).mockResolvedValueOnce([untitled]);

    await scriptsManager.start();

    const [, regs] = vi.mocked(commands.replaceDynamicCommandsBuiltin).mock.calls[0];
    const name = (regs as { name: string }[])[0].name;
    expect(typeof name).toBe('string');
    expect(name.length).toBeGreaterThan(0);
    expect(name).toContain('my_backup');
  });

  it('start_uses_header_icon_when_script_declares_one', async () => {
    const withIcon: ScannedScript = {
      ...mockScript,
      header: { ...mockScript.header, icon: 'icon:cloud-upload' },
    };
    vi.mocked(commands.scriptsRescan).mockResolvedValueOnce([withIcon]);

    await scriptsManager.start();

    const [, regs] = vi.mocked(commands.replaceDynamicCommandsBuiltin).mock.calls[0];
    expect((regs as { icon: string }[])[0].icon).toBe('icon:cloud-upload');
  });

  it('start_falls_back_to_terminal_icon_when_script_omits_one', async () => {
    vi.mocked(commands.scriptsRescan).mockResolvedValueOnce([mockScript]);

    await scriptsManager.start();

    const [, regs] = vi.mocked(commands.replaceDynamicCommandsBuiltin).mock.calls[0];
    expect((regs as { icon: string }[])[0].icon).toBe('icon:terminal');
  });

  it('stop_clears_registrations_and_unsubscribes', async () => {
    const unlistenChanged = vi.fn();
    const unlistenInlineTick = vi.fn();
    // start() registers two listeners in order: scripts:changed, then
    // scripts:inline:tick. Queue both unlisten mocks in the same order.
    vi.mocked(listen)
      .mockResolvedValueOnce(unlistenChanged)
      .mockResolvedValueOnce(unlistenInlineTick);

    await scriptsManager.start();
    await scriptsManager.stop();

    expect(commands.replaceDynamicCommandsBuiltin).toHaveBeenCalledWith('scripts', []);
    expect(unlistenChanged).toHaveBeenCalled();
    expect(unlistenInlineTick).toHaveBeenCalled();
  });

  // ── Inline mode ─────────────────────────────────────────────────────────

  it('inline_script_passed_to_set_inline_scripts_after_refresh', async () => {
    const inline = makeInlineScript();
    vi.mocked(commands.scriptsRescan).mockResolvedValueOnce([inline]);

    await scriptsManager.start();

    expect(commands.scriptsSetInlineScripts).toHaveBeenCalledWith([
      {
        dynamicId: inline.dynamicId,
        absolutePath: inline.absolutePath,
        refreshTimeSeconds: 10,
      },
    ]);
  });

  it('non_inline_scripts_excluded_from_set_inline_scripts', async () => {
    const compact: ScannedScript = makeInlineScript({
      dynamicId: 'cmp-1',
      headerOverrides: { mode: 'compact', refreshTimeSeconds: null },
    });
    const silent: ScannedScript = makeInlineScript({
      dynamicId: 'sil-1',
      headerOverrides: { mode: 'silent', refreshTimeSeconds: null },
    });
    vi.mocked(commands.scriptsRescan).mockResolvedValueOnce([compact, silent]);

    await scriptsManager.start();

    expect(commands.scriptsSetInlineScripts).toHaveBeenCalledWith([]);
  });

  it('inline_script_without_refresh_time_excluded', async () => {
    const inlineNoRefresh = makeInlineScript({
      headerOverrides: { refreshTimeSeconds: null },
    });
    vi.mocked(commands.scriptsRescan).mockResolvedValueOnce([inlineNoRefresh]);

    await scriptsManager.start();

    expect(commands.scriptsSetInlineScripts).toHaveBeenCalledWith([]);
  });

  it('clamped_inline_script_reports_diagnostic_once', async () => {
    const clamped = makeInlineScript({
      headerOverrides: { refreshTimeClamped: true },
    });
    vi.mocked(commands.scriptsRescan).mockResolvedValue([clamped]);

    await scriptsManager.start();
    // Trigger a second refresh through the same dynamicId — the warning
    // must NOT repeat (memory `feedback_diagnostics_migrate_on_touch`
    // emphasises grouped, non-spammy diagnostics).
    await scriptsManager['refresh']();

    expect(diagnosticsService.report).toHaveBeenCalledTimes(1);
    const [call] = vi.mocked(diagnosticsService.report).mock.calls;
    expect(call[0]).toMatchObject({
      kind: 'inline_script_clamped',
      severity: 'warning',
    });
  });

  it('capped_inline_scripts_report_grouped_diagnostic', async () => {
    const inline = makeInlineScript();
    vi.mocked(commands.scriptsRescan).mockResolvedValueOnce([inline]);
    vi.mocked(commands.scriptsSetInlineScripts).mockResolvedValueOnce({
      accepted: [],
      capped: [inline.dynamicId],
      dropped: [],
    });

    await scriptsManager.start();

    const capCall = vi
      .mocked(diagnosticsService.report)
      .mock.calls.find((c) => c[0].kind === 'inline_script_capped');
    expect(capCall).toBeTruthy();
    expect(capCall![0].severity).toBe('warning');
  });

  it('dropped_ids_clear_their_liveSubtitle', async () => {
    const inline = makeInlineScript();
    // Seed a stale subtitle for the dropped id.
    commandService.liveSubtitles = {
      cmd_scripts_dyn_inl_orphan: 'stale 11:22:33',
    };
    vi.mocked(commands.scriptsRescan).mockResolvedValueOnce([inline]);
    vi.mocked(commands.scriptsSetInlineScripts).mockResolvedValueOnce({
      accepted: [inline.dynamicId],
      capped: [],
      dropped: ['inl_orphan'],
    });

    await scriptsManager.start();

    expect(commandService.liveSubtitles).not.toHaveProperty('cmd_scripts_dyn_inl_orphan');
  });

  it('inline_tick_event_writes_to_liveSubtitle', async () => {
    let captured: ((p: { payload: { dynamicId: string; subtitle: string | null; error: string | null } }) => void) | null = null;
    // First listen() call = 'scripts:changed' (unused here), second = 'scripts:inline:tick'.
    vi.mocked(listen)
      .mockImplementationOnce(async () => () => {})
      .mockImplementationOnce(async (_event, handler) => {
        captured = handler as any;
        return () => {};
      });

    await scriptsManager.start();
    expect(captured).toBeTruthy();
    captured!({
      payload: { dynamicId: 'inl-001', subtitle: '15:04:05', error: null },
    });

    expect(commandService.liveSubtitles['cmd_scripts_dyn_inl-001']).toBe('15:04:05');
  });

  it('inline_tick_with_error_writes_error_subtitle', async () => {
    let captured: ((p: { payload: { dynamicId: string; subtitle: string | null; error: string | null } }) => void) | null = null;
    vi.mocked(listen)
      .mockImplementationOnce(async () => () => {})
      .mockImplementationOnce(async (_event, handler) => {
        captured = handler as any;
        return () => {};
      });

    await scriptsManager.start();
    captured!({
      payload: { dynamicId: 'inl-001', subtitle: null, error: 'timeout' },
    });

    expect(commandService.liveSubtitles['cmd_scripts_dyn_inl-001']).toContain('timeout');
  });

  it('getScriptByDynamicId_returns_script_when_present', async () => {
    vi.mocked(commands.scriptsRescan).mockResolvedValueOnce([mockScript]);
    await scriptsManager.start();

    const result = scriptsManager.getScriptByDynamicId(mockScript.dynamicId);
    expect(result).toEqual(mockScript);
  });

  it('getScriptByDynamicId_returns_undefined_for_unknown', async () => {
    await scriptsManager.start();

    const result = scriptsManager.getScriptByDynamicId('ghost-id');
    expect(result).toBeUndefined();
  });
});
