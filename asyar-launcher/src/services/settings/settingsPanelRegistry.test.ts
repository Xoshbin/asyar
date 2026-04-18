import { describe, it, expect, beforeEach } from 'vitest';
import type { Component } from 'svelte';
import {
  registerSettingsPanel,
  getSettingsPanel,
  hasSettingsPanel,
  _clearSettingsPanelRegistryForTesting,
} from './settingsPanelRegistry';

const FakePanel = (() => {}) as unknown as Component;
const OtherPanel = (() => {}) as unknown as Component;

describe('settingsPanelRegistry', () => {
  beforeEach(() => {
    _clearSettingsPanelRegistryForTesting();
  });

  it('returns undefined for ids that were never registered', () => {
    expect(getSettingsPanel('applications')).toBeUndefined();
    expect(hasSettingsPanel('applications')).toBe(false);
  });

  it('stores and retrieves a panel by extension id', () => {
    registerSettingsPanel('applications', FakePanel);

    expect(getSettingsPanel('applications')).toBe(FakePanel);
    expect(hasSettingsPanel('applications')).toBe(true);
  });

  it('replaces an existing registration for the same id', () => {
    registerSettingsPanel('applications', FakePanel);
    registerSettingsPanel('applications', OtherPanel);

    expect(getSettingsPanel('applications')).toBe(OtherPanel);
  });

  it('keeps registrations for different ids isolated', () => {
    registerSettingsPanel('applications', FakePanel);
    registerSettingsPanel('snippets', OtherPanel);

    expect(getSettingsPanel('applications')).toBe(FakePanel);
    expect(getSettingsPanel('snippets')).toBe(OtherPanel);
  });
});
