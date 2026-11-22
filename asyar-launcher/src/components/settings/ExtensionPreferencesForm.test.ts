// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreferenceDeclaration } from 'asyar-sdk/contracts';
import ExtensionPreferencesForm from './ExtensionPreferencesForm.svelte';
import {
  applicationsCache,
  resetApplicationsCache,
} from '../../services/application/applicationsCache.svelte';

vi.mock('../../services/i18n', () => ({
  t: (key: string) => key,
}));

vi.mock('../../services/settings/settingsService.svelte', () => ({
  settingsService: { currentSettings: { search: { additionalScanPaths: [] } } },
}));

vi.mock('../../lib/ipc/commands', () => ({
  getDefaultAppScanPaths: vi.fn(async () => ['/Applications']),
  listApplications: vi.fn(async () => [
    { id: 'zed', name: 'Zed', path: '/Applications/Zed.app', icon: null },
  ]),
}));

const appPref: PreferenceDeclaration[] = [
  { name: 'customApp', type: 'appPicker', title: 'Custom app' },
];

describe('ExtensionPreferencesForm appPicker', () => {
  beforeEach(() => {
    resetApplicationsCache();
    applicationsCache.apps = [{ id: 'zed', name: 'Zed', path: '/Applications/Zed.app' } as never];
    applicationsCache.hasLoadedOnce = true;
  });

  it('omits clear option when empty and lets users clear a selected app', async () => {
    const onChange = vi.fn();
    const { getByRole, queryByText, unmount } = render(ExtensionPreferencesForm, {
      props: { preferences: appPref, values: { customApp: '' }, onChange },
    });

    await fireEvent.click(getByRole('combobox'));
    expect(queryByText('settings.extensions.clear_app')).toBeNull();
    unmount();

    const view = render(ExtensionPreferencesForm, {
      props: {
        preferences: appPref,
        values: { customApp: '/Applications/Zed.app' },
        onChange,
      },
    });
    await fireEvent.click(view.getByRole('combobox'));
    await fireEvent.click(view.getByText('settings.extensions.clear_app'));
    expect(onChange).toHaveBeenCalledWith('customApp', '');
  });

  it('strips trailing slashes when deriving fallback app labels', () => {
    const { getByRole } = render(ExtensionPreferencesForm, {
      props: {
        preferences: appPref,
        values: { customApp: '/Applications/Custom.app/' },
        onChange: vi.fn(),
      },
    });

    expect(getByRole('combobox').textContent).toContain('Custom');
  });
});
