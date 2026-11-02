export type SettingsTabId =
  | 'account'
  | 'general'
  | 'applications'
  | 'built-in-features'
  | 'extensions'
  | 'privacy'
  | 'backup'
  | 'advanced'
  | 'developer'
  | 'about';

export interface NavTarget {
  tab: SettingsTabId;
  extensionId: string | null;
}

export interface NavPayload {
  tab: string;
  extensionId?: string | null;
}

/** Legacy top-level tabs that are now drill-downs under Built-in Features. */
export const BUILT_IN_FEATURE_TAB_IDS = {
  ai: 'agents',
  'file-search': 'file-search',
  browsers: 'browsers',
  scripts: 'scripts',
} as const;

/** Manifest ids of platform features that live under Built-in Features. */
const BUILT_IN_FEATURE_IDS: readonly string[] = [
  'file-search',
  'scripts',
  'clipboard-history',
  'snippets',
  'agents',
  'browsers',
];

export type SidebarGroupId = 'top' | 'app' | 'system';

export const SIDEBAR_GROUPS: { id: SidebarGroupId; tabs: SettingsTabId[] }[] = [
  { id: 'top', tabs: ['account'] },
  {
    id: 'app',
    tabs: ['general', 'applications', 'built-in-features', 'extensions', 'privacy', 'backup'],
  },
  { id: 'system', tabs: ['advanced', 'developer', 'about'] },
];

const DIRECT_TABS: readonly string[] = [
  'account',
  'general',
  'applications',
  'privacy',
  'backup',
  'advanced',
  'about',
];

/**
 * Maps an `asyar:navigate-settings-tab` payload (old and new shapes) onto a
 * sidebar tab plus an optional drill-down id. Keeps every existing caller working.
 */
export function resolveNavigation(payload: NavPayload, developerEnabled: boolean): NavTarget {
  const { tab, extensionId = null } = payload;

  if (tab in BUILT_IN_FEATURE_TAB_IDS) {
    return {
      tab: 'built-in-features',
      extensionId: BUILT_IN_FEATURE_TAB_IDS[tab as keyof typeof BUILT_IN_FEATURE_TAB_IDS],
    };
  }
  if (tab === 'extensions') {
    if (
      extensionId &&
      (BUILT_IN_FEATURE_IDS.includes(extensionId) || extensionId.startsWith('built-in-'))
    ) {
      return { tab: 'built-in-features', extensionId };
    }
    return { tab: 'extensions', extensionId: extensionId ?? null };
  }
  if (tab === 'built-in-features') return { tab, extensionId: extensionId ?? null };
  if (tab === 'developer') {
    return { tab: developerEnabled ? 'developer' : 'advanced', extensionId: null };
  }
  if (DIRECT_TABS.includes(tab)) return { tab: tab as SettingsTabId, extensionId: null };
  return { tab: 'general', extensionId: null };
}

/**
 * Extra terms the sidebar search matches besides a tab's label, so searching
 * for a feature ("clipboard", "theme") finds the tab that contains it.
 */
export const SETTINGS_TAB_KEYWORDS: Partial<Record<SettingsTabId, string[]>> = {
  general: ['hotkey', 'theme', 'appearance', 'window', 'onboarding', 'escape'],
  applications: ['apps', 'applications', 'search scope', 'directories', 'launch'],
  'built-in-features': [
    'ai',
    'clipboard',
    'file search',
    'snippets',
    'browsers',
    'scripts',
    'calculator',
    'notes',
    'portals',
    'ocr',
    'window management',
  ],
  extensions: ['store', 'plugins', 'auto-update'],
  privacy: [
    'permissions',
    'accessibility',
    'calendar',
    'reminders',
    'encryption',
    'shell',
    'telemetry',
  ],
  backup: ['export', 'restore', 'raycast', 'migration'],
  advanced: ['runtimes', 'node', 'bun', 'python', 'scheduled tasks', 'developer mode'],
};
