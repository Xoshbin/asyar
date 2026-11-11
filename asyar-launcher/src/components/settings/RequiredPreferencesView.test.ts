// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { getHostPlatform } from '../../lib/keyboard/hostPlatform';

const mockSet = vi.fn().mockResolvedValue(undefined);
const mockExecute = vi.fn().mockResolvedValue(undefined);
const mockClose = vi.fn();

vi.mock('../../services/extension/preferencesPromptStore.svelte', () => ({
  preferencesPromptStore: {
    active: null,
    close: () => mockClose(),
  },
}));

vi.mock('../../services/extension/extensionPreferencesService.svelte', () => ({
  extensionPreferencesService: {
    getDeclarations: () => ({ extension: [{ name: 'targetLang' }], commands: {} }),
    set: (...args: unknown[]) => mockSet(...args),
  },
}));

vi.mock('../../services/extension/commandService.svelte', () => ({
  commandService: {
    executeCommand: (...args: unknown[]) => mockExecute(...args),
  },
}));

vi.mock('../../services/extension/extensionManager.svelte', () => ({
  default: {
    getManifestById: () => ({
      id: 'org.asyar.google-translate',
      name: 'Google Translate',
      commands: [{ id: 'translate', name: 'Translate' }],
    }),
  },
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

import RequiredPreferencesView from './RequiredPreferencesView.svelte';
import BottomActionBar from '../layout/BottomActionBar.svelte';
import { ActionContext } from 'asyar-sdk/contracts';
import { actionService } from '../../services/action/actionService.svelte';
import { actionShortcuts } from '../../services/action/actionShortcuts';
import { viewManager } from '../../services/extension/viewManager.svelte';

describe('RequiredPreferencesView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actionService.unregisterAction('preferences-prompt:continue');
  });

  it('renders extension header and registers Continue (Mod+Enter) without inline footer buttons', async () => {
    render(RequiredPreferencesView, {
      props: {
        extensionId: 'org.asyar.google-translate',
        commandId: 'translate',
        commandObjectId: 'cmd_org.asyar.google-translate_translate',
        missing: [
          {
            name: 'targetLang',
            title: 'Primary Language',
            type: 'dropdown',
            required: true,
            data: [
              { title: 'English', value: 'en' },
              { title: 'Kurdish (Sorani)', value: 'ckb' },
            ],
          },
        ],
      },
    });

    expect(screen.getAllByText('Google Translate').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /cancel/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /save & continue/i })).toBeNull();

    const action = actionService
      .getAllActions()
      .find((a) => a.id === 'preferences-prompt:continue');
    expect(action).toBeTruthy();
    expect(action?.shortcut).toBe('Mod+Enter');
    expect(action?.primary).toBe(true);
    expect(action?.disabled).toBe(false);

    await action!.execute();
    expect(mockSet).toHaveBeenCalledWith('org.asyar.google-translate', null, 'targetLang', 'en');
    expect(mockClose).toHaveBeenCalled();
    expect(mockExecute).toHaveBeenCalledWith('cmd_org.asyar.google-translate_translate');
  });

  it('closes on Escape via viewManager interceptor', () => {
    const onClose = vi.fn();
    render(RequiredPreferencesView, {
      props: {
        extensionId: 'org.asyar.google-translate',
        commandId: 'translate',
        commandObjectId: 'cmd_org.asyar.google-translate_translate',
        missing: [
          {
            name: 'apiKey',
            title: 'API Key',
            type: 'textfield',
            required: true,
          },
        ],
        onClose,
      },
    });

    expect(viewManager.tryInterceptEscape()).toBe(true);
    expect(mockClose).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('enables Continue live once a required textfield and dropdown are filled', async () => {
    render(RequiredPreferencesView, {
      props: {
        extensionId: 'org.asyar.sdk-playground',
        commandId: 'required-prefs-demo',
        commandObjectId: 'cmd_org.asyar.sdk-playground_required-prefs-demo',
        missing: [
          {
            name: 'targetRegion',
            title: 'Target Region',
            type: 'dropdown',
            required: true,
            data: [
              { title: 'US East (N. Virginia)', value: 'us-east' },
              { title: 'US West (Oregon)', value: 'us-west' },
            ],
          },
          {
            name: 'workspaceName',
            title: 'Workspace Name',
            type: 'textfield',
            required: true,
            placeholder: 'e.g. Acme Prod',
          },
        ],
      },
    });

    let action = actionService.getAllActions().find((a) => a.id === 'preferences-prompt:continue');
    expect(action?.disabled).toBe(true);

    const input = screen.getByPlaceholderText('e.g. Acme Prod') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'any' } });

    action = actionService.getAllActions().find((a) => a.id === 'preferences-prompt:continue');
    expect(action?.disabled).toBe(false);
  });

  it('enables BottomActionBar Continue button and triggers submit via Mod+Enter when EXTENSION_VIEW is active', async () => {
    actionService.setContext(ActionContext.EXTENSION_VIEW, 'preferences-prompt');
    render(BottomActionBar, {
      props: {
        isActionListOpen: false,
        onactionListToggled: () => {},
        onactionListClosed: () => {},
      },
    });
    render(RequiredPreferencesView, {
      props: {
        extensionId: 'org.asyar.sdk-playground',
        commandId: 'required-prefs-demo',
        commandObjectId: 'cmd_org.asyar.sdk-playground_required-prefs-demo',
        missing: [
          {
            name: 'targetRegion',
            title: 'Target Region',
            type: 'dropdown',
            required: true,
            data: [
              { title: 'US East (N. Virginia)', value: 'us-east' },
              { title: 'US West (Oregon)', value: 'us-west' },
            ],
          },
          {
            name: 'workspaceName',
            title: 'Workspace Name',
            type: 'textfield',
            required: true,
            placeholder: 'e.g. Acme Prod',
          },
        ],
      },
    });

    const continueBtn = screen.getByRole('button', { name: /continue/i }) as HTMLButtonElement;
    expect(continueBtn.disabled).toBe(true);

    const input = screen.getByPlaceholderText('e.g. Acme Prod') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'any' } });

    expect(continueBtn.disabled).toBe(false);

    const isMac = getHostPlatform() === 'macos';
    const modEnter = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      metaKey: isMac,
      ctrlKey: !isMac,
      bubbles: true,
      cancelable: true,
    });
    expect(actionShortcuts.handle(modEnter)).toBe(true);
    await vi.waitFor(() => {
      expect(mockExecute).toHaveBeenCalledWith('cmd_org.asyar.sdk-playground_required-prefs-demo');
    });
    actionService.setContext(ActionContext.CORE);
  });
});
