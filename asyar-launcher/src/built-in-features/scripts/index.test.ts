import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./scriptsManager.svelte', () => ({
  scriptsManager: {
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    rescan: vi.fn(async () => {}),
    addDirectory: vi.fn(async () => {}),
    makeSelectedExecutable: vi.fn(async () => {}),
    selectedScript: undefined,
    selectedIssue: undefined,
    selectedPath: undefined,
  },
}));

vi.mock('./dispatch', () => ({
  dispatchScriptCommand: vi.fn(async () => {}),
}));

vi.mock('./ScriptLibraryView.svelte', () => ({ default: {} }));

vi.mock('../../services/action/actionService.svelte', () => ({
  actionService: {
    registerAction: vi.fn(),
    unregisterAction: vi.fn(),
  },
}));

vi.mock('../../services/search/commandArguments', () => ({
  commandArgumentsService: { enter: vi.fn(async () => false) },
}));

vi.mock('@tauri-apps/plugin-opener', () => ({
  revealItemInDir: vi.fn(async () => {}),
}));

vi.mock('tauri-plugin-clipboard-x-api', () => ({
  writeText: vi.fn(async () => {}),
}));

vi.mock('../../services/extension/viewManager.svelte', () => ({
  viewManager: { navigateToView: vi.fn() },
}));

import ScriptsExtension from './index';
import { scriptsManager } from './scriptsManager.svelte';
import { dispatchScriptCommand } from './dispatch';
import { actionService } from '../../services/action/actionService.svelte';
import { commandArgumentsService } from '../../services/search/commandArguments';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { writeText } from 'tauri-plugin-clipboard-x-api';

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(scriptsManager, {
    selectedScript: undefined,
    selectedIssue: undefined,
    selectedPath: undefined,
  });
});

describe('ScriptsExtension', () => {
  it('activate_starts_scripts_manager', async () => {
    await ScriptsExtension.activate();

    expect(scriptsManager.start).toHaveBeenCalled();
  });

  it('deactivate_stops_scripts_manager', async () => {
    await ScriptsExtension.deactivate();

    expect(scriptsManager.stop).toHaveBeenCalled();
  });

  it('executeCommand_for_dynamic_id_dispatches_via_dispatch_handler', async () => {
    const args = { arguments: { x: 1 } };
    await ScriptsExtension.executeCommand('some-dynamic-id', args);

    expect(dispatchScriptCommand).toHaveBeenCalledWith('some-dynamic-id', args);
  });

  it('executeCommand_opens_the_script_library', async () => {
    const result = await ScriptsExtension.executeCommand('script-library');

    expect(result).toEqual({ type: 'view', viewPath: 'scripts/ScriptLibraryView' });
    expect(dispatchScriptCommand).not.toHaveBeenCalled();
  });

  it('registers_and_unregisters_script_library_actions_with_the_view', async () => {
    await ScriptsExtension.viewActivated?.('scripts/ScriptLibraryView');

    const ids = vi.mocked(actionService.registerAction).mock.calls.map(([action]) => action.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'scripts:run',
        'scripts:reveal',
        'scripts:copy-path',
        'scripts:rescan',
        'scripts:add-directory',
        'scripts:make-executable',
      ]),
    );

    await ScriptsExtension.viewDeactivated?.('scripts/ScriptLibraryView');

    expect(actionService.unregisterAction).toHaveBeenCalledWith('scripts:run');
    expect(actionService.unregisterAction).toHaveBeenCalledWith('scripts:make-executable');
  });

  it('library_actions_operate_on_the_current_selection', async () => {
    const script = {
      absolutePath: '/scripts/deploy.sh',
      directoryPath: '/scripts',
      fileName: 'deploy.sh',
      displayName: 'Deploy',
      dynamicId: 'deploy-id',
      header: { arguments: [] },
    };
    Object.assign(scriptsManager, {
      selectedScript: script,
      selectedPath: script.absolutePath,
    });
    await ScriptsExtension.viewActivated?.('scripts/ScriptLibraryView');
    const actions = vi.mocked(actionService.registerAction).mock.calls.map(([action]) => action);
    const execute = async (id: string) => actions.find((action) => action.id === id)?.execute();

    await execute('scripts:run');
    await execute('scripts:reveal');
    await execute('scripts:copy-path');
    await execute('scripts:rescan');
    await execute('scripts:add-directory');

    expect(dispatchScriptCommand).toHaveBeenCalledWith('deploy-id', undefined);
    expect(revealItemInDir).toHaveBeenCalledWith('/scripts/deploy.sh');
    expect(writeText).toHaveBeenCalledWith('/scripts/deploy.sh');
    expect(scriptsManager.rescan).toHaveBeenCalled();
    expect(scriptsManager.addDirectory).toHaveBeenCalled();
  });

  it('run_action_enters_argument_mode_for_scripts_with_arguments', async () => {
    Object.assign(scriptsManager, {
      selectedScript: {
        absolutePath: '/scripts/deploy.sh',
        dynamicId: 'deploy-id',
        header: { arguments: [{ name: 'target', type: 'text' }] },
      },
      selectedPath: '/scripts/deploy.sh',
    });
    vi.mocked(commandArgumentsService.enter).mockResolvedValueOnce(true);
    await ScriptsExtension.viewActivated?.('scripts/ScriptLibraryView');
    const run = vi
      .mocked(actionService.registerAction)
      .mock.calls.map(([action]) => action)
      .find((action) => action.id === 'scripts:run');

    await run?.execute();

    expect(commandArgumentsService.enter).toHaveBeenCalledWith('cmd_scripts_dyn_deploy-id');
    expect(dispatchScriptCommand).not.toHaveBeenCalled();
  });

  it('make_executable_action_repairs_the_selected_issue', async () => {
    Object.assign(scriptsManager, {
      selectedScript: undefined,
      selectedIssue: { fix: 'makeExecutable' },
      selectedPath: '/scripts/broken.sh',
    });
    await ScriptsExtension.viewActivated?.('scripts/ScriptLibraryView');
    const repair = vi
      .mocked(actionService.registerAction)
      .mock.calls.map(([action]) => action)
      .find((action) => action.id === 'scripts:make-executable');

    await repair?.execute();

    expect(scriptsManager.makeSelectedExecutable).toHaveBeenCalled();
  });

  it('runs_the_selected_script_when_the_library_is_submitted', async () => {
    Object.assign(scriptsManager, {
      selectedScript: {
        absolutePath: '/scripts/deploy.sh',
        dynamicId: 'deploy-id',
        header: { arguments: [] },
      },
    });

    await ScriptsExtension.onViewSubmit?.('');

    expect(dispatchScriptCommand).toHaveBeenCalledWith('deploy-id', undefined);
  });
});
