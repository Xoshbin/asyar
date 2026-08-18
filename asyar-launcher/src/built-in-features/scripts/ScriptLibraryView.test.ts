// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./scriptsManager.svelte', () => ({
  scriptsManager: {
    scripts: [],
    issues: [],
    selectedEntryId: null,
    selectedScript: undefined,
    selectedIssue: undefined,
    selectEntry: vi.fn(),
    moveSelection: vi.fn(),
    makeSelectedExecutable: vi.fn(async () => {}),
  },
}));

vi.mock('./runSelected', () => ({
  runSelectedScript: vi.fn(async () => {}),
}));

vi.mock('../../components/base/Modal.logic', () => ({
  isAnyModalOpen: vi.fn(() => false),
}));

vi.mock('../../services/extension/viewManager.svelte', () => ({
  viewManager: { activeViewPrimaryActionLabel: null },
}));

vi.mock('../../services/search/commandArguments', () => ({
  commandArgumentsService: { active: null },
}));

vi.mock('../../components', async () => ({
  Badge: (await import('../../components/base/Badge.svelte')).default,
  Card: (await import('../../components/layout/Card.svelte')).default,
  EmptyState: (await import('../../components/feedback/EmptyState.svelte')).default,
  Icon: (await import('../../components/base/Icon.svelte')).default,
  IconBox: (await import('../../components/base/IconBox.svelte')).default,
  LauncherListRow: (await import('../../components/list/LauncherListRow.svelte')).default,
  SplitView: (await import('../../components/list/SplitView.svelte')).default,
  WarningBanner: (await import('../../components/feedback/WarningBanner.svelte')).default,
}));

import ScriptLibraryView from './ScriptLibraryView.svelte';
import { scriptsManager } from './scriptsManager.svelte';
import { runSelectedScript } from './runSelected';
import { isAnyModalOpen } from '../../components/base/Modal.logic';
import { viewManager } from '../../services/extension/viewManager.svelte';
import { commandArgumentsService } from '../../services/search/commandArguments';

// `active` is a getter on the real service, so the mock needs a writable view.
const argumentMode = commandArgumentsService as unknown as { active: unknown };

const script = {
  absolutePath: '/scripts/deploy.sh',
  directoryPath: '/scripts',
  fileName: 'deploy.sh',
  displayName: 'Deploy',
  dynamicId: 'deploy-id',
  header: { mode: 'silent', icon: null, arguments: [], refreshTimeSeconds: null },
};

const notExecutableIssue = {
  absolutePath: '/scripts/broken.sh',
  directoryPath: '/scripts',
  fileName: 'broken.sh',
  message: 'File is not executable',
  reason: 'notExecutable',
  fix: 'makeExecutable',
};

const unreadableIssue = {
  absolutePath: '/scripts/unreadable.sh',
  directoryPath: '/scripts',
  fileName: 'unreadable.sh',
  message: 'File could not be read',
  reason: 'contentUnreadable',
  fix: null,
};

/** Select `script` / an issue on the non-reactive manager mock, then render. */
function selectScript() {
  Object.assign(scriptsManager, {
    scripts: [script],
    issues: [],
    selectedEntryId: `script:${script.dynamicId}`,
    selectedScript: script,
    selectedIssue: undefined,
  });
}

function selectIssue(issue: typeof notExecutableIssue | typeof unreadableIssue) {
  Object.assign(scriptsManager, {
    scripts: [],
    issues: [issue],
    selectedEntryId: `issue:${issue.absolutePath}`,
    selectedScript: undefined,
    selectedIssue: issue,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isAnyModalOpen).mockReturnValue(false);
  viewManager.activeViewPrimaryActionLabel = null;
  argumentMode.active = null;
  Object.assign(scriptsManager, {
    scripts: [],
    issues: [],
    selectedEntryId: null,
    selectedScript: undefined,
    selectedIssue: undefined,
  });
});

describe('ScriptLibraryView keyboard', () => {
  it('enter_runs_the_selected_script', async () => {
    selectScript();
    render(ScriptLibraryView);

    const notConsumed = await fireEvent.keyDown(window, { key: 'Enter' });

    expect(runSelectedScript).toHaveBeenCalled();
    expect(notConsumed).toBe(false);
  });

  it('enter_repairs_a_make_executable_issue', async () => {
    selectIssue(notExecutableIssue);
    render(ScriptLibraryView);

    const notConsumed = await fireEvent.keyDown(window, { key: 'Enter' });

    expect(scriptsManager.makeSelectedExecutable).toHaveBeenCalled();
    expect(runSelectedScript).not.toHaveBeenCalled();
    expect(notConsumed).toBe(false);
  });

  it('enter_without_a_selection_leaves_the_event_to_the_launcher', async () => {
    render(ScriptLibraryView);

    const notConsumed = await fireEvent.keyDown(window, { key: 'Enter' });

    expect(runSelectedScript).not.toHaveBeenCalled();
    expect(scriptsManager.makeSelectedExecutable).not.toHaveBeenCalled();
    expect(notConsumed).toBe(true);
  });

  it('enter_on_an_unfixable_issue_leaves_the_event_to_the_launcher', async () => {
    selectIssue(unreadableIssue);
    render(ScriptLibraryView);

    const notConsumed = await fireEvent.keyDown(window, { key: 'Enter' });

    expect(scriptsManager.makeSelectedExecutable).not.toHaveBeenCalled();
    expect(notConsumed).toBe(true);
  });

  it('modified_enter_is_ignored', async () => {
    selectScript();
    render(ScriptLibraryView);

    await fireEvent.keyDown(window, { key: 'Enter', metaKey: true });

    expect(runSelectedScript).not.toHaveBeenCalled();
  });

  it('enter_is_ignored_while_a_modal_is_open', async () => {
    selectScript();
    vi.mocked(isAnyModalOpen).mockReturnValue(true);
    render(ScriptLibraryView);

    await fireEvent.keyDown(window, { key: 'Enter' });

    expect(runSelectedScript).not.toHaveBeenCalled();
  });

  it('enter_is_ignored_while_the_action_popup_is_open', async () => {
    selectScript();
    render(ScriptLibraryView);
    const popup = document.createElement('div');
    popup.className = 'action-popup';
    document.body.appendChild(popup);

    await fireEvent.keyDown(window, { key: 'Enter' });
    popup.remove();

    expect(runSelectedScript).not.toHaveBeenCalled();
  });

  it('enter_falls_through_while_argument_mode_is_open', async () => {
    // runSelectedScript promotes a script with arguments into argument mode,
    // which leaves this view mounted under the chips. Stealing Enter there
    // would re-enter argument mode and discard what the user typed instead of
    // letting the chip row submit.
    selectScript();
    render(ScriptLibraryView);
    argumentMode.active = { commandObjectId: 'cmd_scripts_dyn_deploy-id' };

    const notConsumed = await fireEvent.keyDown(window, { key: 'Enter' });

    expect(runSelectedScript).not.toHaveBeenCalled();
    expect(notConsumed).toBe(true);
  });

  it('arrow_keys_fall_through_while_argument_mode_is_open', async () => {
    selectScript();
    render(ScriptLibraryView);
    argumentMode.active = { commandObjectId: 'cmd_scripts_dyn_deploy-id' };

    const notConsumed = await fireEvent.keyDown(window, { key: 'ArrowDown' });

    expect(scriptsManager.moveSelection).not.toHaveBeenCalled();
    expect(notConsumed).toBe(true);
  });

  it('enter_from_a_focused_text_field_falls_through', async () => {
    selectScript();
    render(ScriptLibraryView);
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    const notConsumed = await fireEvent.keyDown(input, { key: 'Enter' });
    input.remove();

    expect(runSelectedScript).not.toHaveBeenCalled();
    expect(notConsumed).toBe(true);
  });

  it('arrow_keys_still_move_the_selection', async () => {
    selectScript();
    render(ScriptLibraryView);

    await fireEvent.keyDown(window, { key: 'ArrowDown' });
    await fireEvent.keyDown(window, { key: 'ArrowUp' });

    expect(scriptsManager.moveSelection).toHaveBeenNthCalledWith(1, 1);
    expect(scriptsManager.moveSelection).toHaveBeenNthCalledWith(2, -1);
    expect(runSelectedScript).not.toHaveBeenCalled();
  });
});

describe('ScriptLibraryView primary action label', () => {
  it('label_is_run_script_when_a_script_is_selected', () => {
    selectScript();
    render(ScriptLibraryView);

    expect(viewManager.activeViewPrimaryActionLabel).toBe('Run Script');
  });

  it('label_is_make_executable_for_a_repairable_issue', () => {
    selectIssue(notExecutableIssue);
    render(ScriptLibraryView);

    expect(viewManager.activeViewPrimaryActionLabel).toBe('Make Executable');
  });

  it('label_is_null_for_an_unfixable_issue', () => {
    selectIssue(unreadableIssue);
    render(ScriptLibraryView);

    expect(viewManager.activeViewPrimaryActionLabel).toBeNull();
  });

  it('label_is_null_without_a_selection', () => {
    render(ScriptLibraryView);

    expect(viewManager.activeViewPrimaryActionLabel).toBeNull();
  });

  it('label_is_cleared_when_the_view_is_destroyed', () => {
    selectScript();
    const { unmount } = render(ScriptLibraryView);
    expect(viewManager.activeViewPrimaryActionLabel).toBe('Run Script');

    unmount();

    expect(viewManager.activeViewPrimaryActionLabel).toBeNull();
  });

  it('destroy_keeps_a_label_the_incoming_view_already_set', () => {
    // A global item hotkey replaces the view: the next view's viewActivated
    // publishes its own label before Svelte tears this component down.
    selectScript();
    const { unmount } = render(ScriptLibraryView);
    expect(viewManager.activeViewPrimaryActionLabel).toBe('Run Script');

    viewManager.activeViewPrimaryActionLabel = 'Paste';
    unmount();

    expect(viewManager.activeViewPrimaryActionLabel).toBe('Paste');
  });
});
