import { t } from '../../services/i18n';
import type { ExtensionItem } from './settingsHandlers.svelte';
import type { SettingsTabId } from './settingsNav';

/** A destination in the settings window: a sidebar tab, optionally drilled into a feature. */
export interface SettingsSearchTarget {
  tab: SettingsTabId;
  extensionId?: string | null;
}

export interface SettingsSearchResult {
  id: string;
  title: string;
  /** Parent tab, or parent feature for a command. */
  category: string;
  target: SettingsSearchTarget;
}

interface CatalogEntry {
  /** i18n key of the row's visible label. */
  labelKey: string;
  tab: SettingsTabId;
  /** Built-in feature to drill into when `tab` is 'built-in-features'. */
  extensionId?: string;
  keywords?: string[];
}

/**
 * Every individual row worth jumping to by name. Labels reuse the keys the
 * tabs render, so search never drifts from what the user sees.
 */
export const SETTINGS_ROW_CATALOG: CatalogEntry[] = [
  { labelKey: 'settings.general.hotkey', tab: 'general', keywords: ['asyar hotkey', 'shortcut'] },
  {
    labelKey: 'settings.general.autostart',
    tab: 'general',
    keywords: ['start at login', 'startup'],
  },
  {
    labelKey: 'settings.appearance.theme',
    tab: 'general',
    keywords: ['appearance', 'dark', 'light'],
  },
  { labelKey: 'settings.appearance.window_mode', tab: 'general', keywords: ['compact'] },
  {
    labelKey: 'settings.appearance.interface_size_label',
    tab: 'general',
    keywords: ['size', 'zoom', 'larger'],
  },
  { labelKey: 'settings.general.sound_effects', tab: 'general', keywords: ['audio'] },
  {
    labelKey: 'settings.general.rerun_onboarding',
    tab: 'general',
    keywords: ['onboarding', 'welcome'],
  },
  { labelKey: 'settings.advanced.pop_to_root', tab: 'general', keywords: ['root search'] },
  { labelKey: 'settings.advanced.escape_key', tab: 'general', keywords: ['esc'] },
  { labelKey: 'settings.advanced.developer_mode', tab: 'advanced', keywords: ['developer'] },
  { labelKey: 'settings.runtimes.title', tab: 'advanced', keywords: ['node', 'bun', 'python'] },
  { labelKey: 'settings.tasks.title', tab: 'advanced', keywords: ['background', 'schedule'] },
  { labelKey: 'settings.privacy.accessibility_access', tab: 'privacy' },
  { labelKey: 'settings.privacy.calendar_access', tab: 'privacy' },
  { labelKey: 'settings.privacy.reminders_access', tab: 'privacy' },
  {
    labelKey: 'settings.privacy.active_detectors',
    tab: 'privacy',
    keywords: ['secret redaction', 'secrets'],
  },
  {
    labelKey: 'settings.privacy.encryption_at_rest',
    tab: 'privacy',
    keywords: ['local database encryption', 'sqlite'],
  },
  {
    labelKey: 'settings.privacy.shell_trust',
    tab: 'privacy',
    keywords: ['approved shell binaries', 'trusted programs'],
  },
  {
    labelKey: 'settings.privacy.clipboard_privacy',
    tab: 'built-in-features',
    extensionId: 'clipboard-history',
    keywords: ['denylist', 'clipboard'],
  },
  {
    labelKey: 'settings.file_search.search_roots',
    tab: 'built-in-features',
    extensionId: 'file-search',
    keywords: ['folders', 'file search'],
  },
  {
    labelKey: 'settings.file_search.exclude_patterns',
    tab: 'built-in-features',
    extensionId: 'file-search',
    keywords: ['exclusions', 'ignore', 'file search'],
  },
  {
    labelKey: 'settings.scripts.section_directories',
    tab: 'built-in-features',
    extensionId: 'scripts',
    keywords: ['script directories', 'folders'],
  },
  {
    labelKey: 'settings.advanced.text_expansion',
    tab: 'built-in-features',
    extensionId: 'snippets',
    keywords: ['snippets', 'expand'],
  },
  {
    labelKey: 'settings.ai.providers_section',
    tab: 'built-in-features',
    extensionId: 'agents',
    keywords: ['ai', 'models', 'api key', 'agents'],
  },
  {
    labelKey: 'settings.tabs.browsers',
    tab: 'built-in-features',
    extensionId: 'browsers',
    keywords: ['companion', 'paired browsers'],
  },
  { labelKey: 'settings.privacy.crash_reports', tab: 'privacy', keywords: ['telemetry'] },
  {
    labelKey: 'settings.privacy.usage_share',
    tab: 'privacy',
    keywords: ['telemetry', 'analytics'],
  },
  { labelKey: 'settings.backup.export_backup', tab: 'backup', keywords: ['export', 'password'] },
  { labelKey: 'settings.backup.migrate_raycast', tab: 'backup', keywords: ['import'] },
  { labelKey: 'settings.backup.section_restore', tab: 'backup', keywords: ['restore backup'] },
  { labelKey: 'settings.account.sync_now', tab: 'account', keywords: ['cloud sync'] },
  { labelKey: 'settings.account.resync_cloud', tab: 'account', keywords: ['cloud sync'] },
  { labelKey: 'settings.account.encrypted_sync', tab: 'account', keywords: ['e2ee'] },
  { labelKey: 'settings.account.recovery_phrase', tab: 'account', keywords: ['mnemonic'] },
  { labelKey: 'settings.e2ee.reset_button', tab: 'account', keywords: ['cloud sync'] },
  { labelKey: 'settings.developer.devex_inspector', tab: 'developer' },
  { labelKey: 'settings.developer.verbose_logging', tab: 'developer', keywords: ['debug'] },
  { labelKey: 'settings.developer.tracing', tab: 'developer', keywords: ['ipc', 'rpc'] },
  { labelKey: 'settings.developer.sideload', tab: 'developer', keywords: ['install'] },
  { labelKey: 'settings.about.check_for_updates', tab: 'about', keywords: ['update', 'version'] },
  { labelKey: 'settings.about.release_channel', tab: 'about', keywords: ['beta', 'stable'] },
];

const TAB_LABEL_KEYS: Record<SettingsTabId, string> = {
  account: 'settings.tabs.account',
  general: 'settings.tabs.general',
  applications: 'settings.tabs.applications',
  'built-in-features': 'settings.tabs.built_in_features',
  extensions: 'settings.tabs.extensions',
  privacy: 'settings.tabs.privacy',
  backup: 'settings.tabs.backup',
  advanced: 'settings.tabs.advanced',
  developer: 'settings.tabs.developer',
  about: 'settings.tabs.about',
};

export const MAX_SEARCH_RESULTS = 30;

const includes = (haystack: string | undefined, q: string) =>
  !!haystack && haystack.toLowerCase().includes(q);

/**
 * Deep search over individual settings rows, built-in features and installed
 * extensions (plus their commands). Sidebar tabs are matched by the sidebar
 * itself, so they are not repeated here.
 */
export function searchSettings(
  query: string,
  extensions: ExtensionItem[],
  developerEnabled: boolean,
): SettingsSearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const results: SettingsSearchResult[] = [];

  for (const entry of SETTINGS_ROW_CATALOG) {
    if (entry.tab === 'developer' && !developerEnabled) continue;
    const label = t(entry.labelKey);
    if (!includes(label, q) && !entry.keywords?.some((k) => includes(k, q))) continue;
    results.push({
      id: `setting:${entry.labelKey}`,
      title: label,
      category: t(TAB_LABEL_KEYS[entry.tab]),
      target: entry.extensionId
        ? { tab: entry.tab, extensionId: entry.extensionId }
        : { tab: entry.tab },
    });
  }

  for (const ext of extensions) {
    const extId = ext.id ?? ext.title;
    const tab: SettingsTabId = ext.isBuiltIn ? 'built-in-features' : 'extensions';
    const tabLabel = t(TAB_LABEL_KEYS[tab]);
    if (includes(ext.title, q) || includes(ext.subtitle, q)) {
      results.push({
        id: `ext:${extId}`,
        title: ext.title,
        category: tabLabel,
        target: { tab, extensionId: extId },
      });
    }
    for (const cmd of ext.commands ?? []) {
      if (!includes(cmd.name, q)) continue;
      results.push({
        id: `cmd:${extId}:${cmd.id}`,
        title: cmd.name,
        category: `${tabLabel} · ${ext.title}`,
        target: { tab, extensionId: extId },
      });
    }
  }

  return results.slice(0, MAX_SEARCH_RESULTS);
}
