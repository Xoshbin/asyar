/** One entry in the flat left sidebar. `developerOnly` entries are filtered
 *  in +page.svelte based on `handler.settings.developer?.enabled`. */
export interface SettingsTabDescriptor {
  id: string;
  label: string;
  icon: string;
  developerOnly?: boolean;
}

export const SETTINGS_TABS: SettingsTabDescriptor[] = [
  { id: 'general', label: 'General', icon: 'settings' },
  { id: 'extensions', label: 'Extensions', icon: 'puzzle' },
  { id: 'browsers', label: 'Browsers', icon: 'globe' },
  { id: 'applications', label: 'Applications', icon: 'layers' },
  { id: 'file-search', label: 'File Search', icon: 'folder-search' },
  { id: 'scripts', label: 'Scripts', icon: 'dev-tools' },
  { id: 'ai', label: 'AI', icon: 'ai-chat' },
  { id: 'backup', label: 'Backup', icon: 'cloud-upload' },
  { id: 'account', label: 'Account', icon: 'user' },
  { id: 'privacy', label: 'Privacy', icon: 'lock' },
  { id: 'advanced', label: 'Advanced', icon: 'layers' },
  { id: 'developer', label: 'Developer', icon: 'dev-tools', developerOnly: true },
  { id: 'about', label: 'About', icon: 'info' },
];

/** `sectionAnchor`, when present, must match the `id` attribute of a
 *  `SettingsCard`/section wrapper rendered by that tab, and a `section.id`
 *  passed to that tab's `SettingsSectionNav` — SettingsSearchResults scrolls
 *  to and briefly highlights that element on selection. Tabs are indexed as
 *  they migrate onto the command-bar shell; unmigrated tabs have no entries
 *  yet. Titles/descriptions below are the same copy the design handoff
 *  specifies for these settings, not invented strings. */
export interface SettingsSearchEntry {
  id: string;
  title: string;
  description: string;
  tab: string;
  tabLabel: string;
  sectionAnchor?: string;
  keywords?: string[];
}

export const SETTINGS_SEARCH_INDEX: SettingsSearchEntry[] = [
  {
    id: 'general-start-at-login',
    title: 'Launch Asyar at login',
    description: 'Asyar starts in the background when you sign in.',
    tab: 'general',
    tabLabel: 'General',
    sectionAnchor: 'general-startup',
    keywords: ['startup', 'autostart', 'login'],
  },
  {
    id: 'general-hotkey',
    title: 'Global hotkey',
    description: 'Summon the launcher from any app.',
    tab: 'general',
    tabLabel: 'General',
    sectionAnchor: 'general-startup',
    keywords: ['shortcut', 'keybinding'],
  },
  {
    id: 'general-theme',
    title: 'Theme',
    description: 'Match the system or lock one appearance.',
    tab: 'general',
    tabLabel: 'General',
    sectionAnchor: 'general-appearance',
    keywords: ['theme', 'dark', 'light', 'appearance'],
  },
  {
    id: 'general-window-mode',
    title: 'Window mode',
    description: 'How much of the launcher is visible before you type.',
    tab: 'general',
    tabLabel: 'General',
    sectionAnchor: 'general-appearance',
    keywords: ['compact', 'default'],
  },
  {
    id: 'general-display',
    title: 'Display',
    description: 'Which screen the launcher opens on.',
    tab: 'general',
    tabLabel: 'General',
    sectionAnchor: 'general-placement',
    keywords: ['monitor', 'screen', 'cursor', 'primary'],
  },
  {
    id: 'general-position',
    title: 'Vertical position',
    description: 'Drag the launcher itself to set a custom spot.',
    tab: 'general',
    tabLabel: 'General',
    sectionAnchor: 'general-placement',
    keywords: ['placement', 'top', 'centre'],
  },
  {
    id: 'general-snap',
    title: 'Snap while dragging',
    description: 'Snap to screen edges and centre lines.',
    tab: 'general',
    tabLabel: 'General',
    sectionAnchor: 'general-placement',
    keywords: ['snapping', 'drag'],
  },
  {
    id: 'general-onboarding',
    title: 'Onboarding',
    description: 'Walk through the welcome flow again.',
    tab: 'general',
    tabLabel: 'General',
    sectionAnchor: 'general-onboarding',
    keywords: ['welcome', 'tutorial', 're-run'],
  },
  {
    id: 'extensions-installed',
    title: 'Installed extensions',
    description: 'Enable, disable, and configure extensions.',
    tab: 'extensions',
    tabLabel: 'Extensions',
    keywords: ['plugin', 'addon'],
  },
  {
    id: 'extensions-permissions',
    title: 'Extension permissions',
    description: 'Review and revoke what an extension can access.',
    tab: 'extensions',
    tabLabel: 'Extensions',
    keywords: ['consent', 'access', 'revoke'],
  },
  {
    id: 'applications-scope',
    title: 'Search scope',
    description: 'Directories scanned for applications.',
    tab: 'applications',
    tabLabel: 'Applications',
    sectionAnchor: 'applications-scope',
    keywords: ['directory', 'folder', 'scan'],
  },
  {
    id: 'applications-list',
    title: 'App aliases and hotkeys',
    description: 'Per-app shortcuts in search, and per-app enable/disable.',
    tab: 'applications',
    tabLabel: 'Applications',
    sectionAnchor: 'applications-list',
    keywords: ['alias', 'shortcut', 'hotkey'],
  },
  {
    id: 'advanced-ext-search',
    title: 'Extension results in search',
    description: 'Let extensions contribute rows to the root search bar.',
    tab: 'advanced',
    tabLabel: 'Advanced',
    sectionAnchor: 'advanced-extension-surface',
  },
  {
    id: 'advanced-ext-actions',
    title: 'Extension actions in ⌘K',
    description: "When off, only Asyar's built-in actions appear in the action panel.",
    tab: 'advanced',
    tabLabel: 'Advanced',
    sectionAnchor: 'advanced-extension-surface',
  },
  {
    id: 'advanced-auto-update',
    title: 'Auto-update extensions',
    description: 'Updates install silently in the background.',
    tab: 'advanced',
    tabLabel: 'Advanced',
    sectionAnchor: 'advanced-extension-surface',
  },
  {
    id: 'advanced-escape',
    title: 'Escape key',
    description: 'What Escape does inside the launcher.',
    tab: 'advanced',
    tabLabel: 'Advanced',
    sectionAnchor: 'advanced-input',
    keywords: ['esc'],
  },
  {
    id: 'advanced-text-expansion',
    title: 'Text expansion',
    description: 'Expand snippets as you type. Requires Accessibility permission.',
    tab: 'advanced',
    tabLabel: 'Advanced',
    sectionAnchor: 'advanced-input',
    keywords: ['snippets'],
  },
  {
    id: 'advanced-dev-mode',
    title: 'Developer mode',
    description: 'Extension inspector, verbose logging, and sideloading.',
    tab: 'advanced',
    tabLabel: 'Advanced',
    sectionAnchor: 'advanced-input',
  },
  {
    id: 'advanced-scheduled-tasks',
    title: 'Scheduled tasks',
    description: 'Background extension schedules.',
    tab: 'advanced',
    tabLabel: 'Advanced',
    sectionAnchor: 'advanced-scheduled-tasks',
    keywords: ['cron', 'timer'],
  },
  {
    id: 'browsers-connected-browsers',
    title: 'Connected browsers',
    description:
      'Pair browsers running the Asyar Companion extension and manage existing pairings.',
    tab: 'browsers',
    tabLabel: 'Browsers',
    sectionAnchor: 'browsers-connected',
    keywords: ['pairing', 'companion', 'chrome', 'browser', 'connected'],
  },
  {
    id: 'browsers-install-companion',
    title: 'Install browser companion',
    description: 'Get the Asyar Companion extension for Chrome, Brave, Edge, Arc, and Vivaldi.',
    tab: 'browsers',
    tabLabel: 'Browsers',
    sectionAnchor: 'browsers-install',
    keywords: ['chrome', 'extension', 'companion', 'install'],
  },
  {
    id: 'file-search-enable',
    title: 'File search',
    description: "Search files across your home folder from Asyar's search bar.",
    tab: 'file-search',
    tabLabel: 'File Search',
    sectionAnchor: 'file-search-status',
    keywords: ['index', 'enable', 'toggle', 'indexing'],
  },
  {
    id: 'file-search-roots',
    title: 'Search roots',
    description: 'Directories included when indexing files for search.',
    tab: 'file-search',
    tabLabel: 'File Search',
    sectionAnchor: 'file-search-roots',
    keywords: ['directory', 'folder', 'root', 'scope'],
  },
  {
    id: 'file-search-excludes',
    title: 'Exclude patterns',
    description: 'Patterns skipped when indexing files, layered on the built-in exclusions.',
    tab: 'file-search',
    tabLabel: 'File Search',
    sectionAnchor: 'file-search-excludes',
    keywords: ['exclude', 'ignore', 'pattern'],
  },
  {
    id: 'scripts-directories',
    title: 'Script directories',
    description: 'Folders watched for executable scripts.',
    tab: 'scripts',
    tabLabel: 'Scripts',
    keywords: ['script', 'directory', 'watch', 'executable'],
  },
  {
    id: 'ai-tab-continues-last-thread',
    title: 'Tab continues last thread',
    description: 'Pressing Tab resumes your previous conversation with Asyar Assistant.',
    tab: 'ai',
    tabLabel: 'AI',
    sectionAnchor: 'ai-behavior',
    keywords: ['chat', 'thread', 'remember', 'assistant'],
  },
  {
    id: 'ai-providers',
    title: 'AI providers',
    description: 'Configure AI providers, API keys, endpoints, and default assistant models.',
    tab: 'ai',
    tabLabel: 'AI',
    sectionAnchor: 'ai-providers',
    keywords: ['api', 'key', 'openai', 'anthropic', 'ollama', 'gemini', 'openrouter', 'model'],
  },
  {
    id: 'ai-temperature',
    title: 'AI temperature',
    description: 'Adjust sampling temperature for assistant responses.',
    tab: 'ai',
    tabLabel: 'AI',
    sectionAnchor: 'ai-advanced',
    keywords: ['creativity', 'randomness', 'temperature', 'sampling'],
  },
  {
    id: 'ai-max-tokens',
    title: 'AI max tokens',
    description: 'Set maximum response length for AI completions.',
    tab: 'ai',
    tabLabel: 'AI',
    sectionAnchor: 'ai-advanced',
    keywords: ['length', 'tokens', 'limit', 'max'],
  },
  {
    id: 'account-profile',
    title: 'Account profile',
    description: 'View active Asyar user profile, email, and features.',
    tab: 'account',
    tabLabel: 'Account',
    sectionAnchor: 'account-profile',
    keywords: ['user', 'login', 'email', 'avatar', 'sign out'],
  },
  {
    id: 'account-subscription',
    title: 'Subscription',
    description: 'Manage your Asyar subscription and billing.',
    tab: 'account',
    tabLabel: 'Account',
    sectionAnchor: 'account-subscription',
    keywords: ['plan', 'pro', 'tier', 'billing', 'upgrade'],
  },
  {
    id: 'account-sync',
    title: 'Cloud sync',
    description: 'Configure cross-device sync and end-to-end encryption.',
    tab: 'account',
    tabLabel: 'Account',
    sectionAnchor: 'account-sync',
    keywords: ['sync', 'cloud', 'devices', 'e2ee', 'encryption', 'passphrase'],
  },
  {
    id: 'backup-export',
    title: 'Export backup',
    description: 'Export Asyar settings, extensions, and data to an encrypted backup file.',
    tab: 'backup',
    tabLabel: 'Backup',
    sectionAnchor: 'backup-export',
    keywords: ['export', 'save', 'backup', 'file', 'password'],
  },
  {
    id: 'backup-import',
    title: 'Restore from backup',
    description: 'Restore settings and data from a backup file.',
    tab: 'backup',
    tabLabel: 'Backup',
    sectionAnchor: 'backup-import',
    keywords: ['restore', 'import', 'load', 'file'],
  },
  {
    id: 'backup-raycast',
    title: 'Migrate from Raycast',
    description: 'Import snippets, quicklinks, and hotkeys from Raycast.',
    tab: 'backup',
    tabLabel: 'Backup',
    sectionAnchor: 'backup-raycast',
    keywords: ['raycast', 'migrate', 'snippets', 'quicklinks'],
  },
];

export interface SectionAnchor {
  id: string;
  label: string;
}

/** Anchors for each tab's section-pill sub-nav (`SettingsSectionNav`). Each
 *  `id` must match the `id` attribute of a wrapper rendered by that tab, and
 *  is also the target `SettingsSearchEntry.sectionAnchor` values above point
 *  at — kept as one map so the two can't drift apart silently (see the
 *  consistency test in settingsNavRegistry.test.ts). A tab with no entry
 *  here renders without a sub-nav — either it has nothing to scroll to
 *  (Extensions' fixed master-detail split) or hasn't been migrated onto this
 *  shell yet. */
export const SECTION_ANCHORS: Record<string, SectionAnchor[]> = {
  general: [
    { id: 'general-startup', label: 'Startup' },
    { id: 'general-appearance', label: 'Appearance' },
    { id: 'general-placement', label: 'Placement' },
    { id: 'general-onboarding', label: 'Onboarding' },
  ],
  browsers: [
    { id: 'browsers-connected', label: 'Connected browsers' },
    { id: 'browsers-install', label: 'Install companion' },
  ],
  applications: [
    { id: 'applications-scope', label: 'Search scope' },
    { id: 'applications-list', label: 'Applications' },
  ],
  'file-search': [
    { id: 'file-search-status', label: 'Status' },
    { id: 'file-search-roots', label: 'Search roots' },
    { id: 'file-search-excludes', label: 'Exclude patterns' },
  ],
  ai: [
    { id: 'ai-behavior', label: 'Behavior' },
    { id: 'ai-providers', label: 'Providers' },
    { id: 'ai-advanced', label: 'Advanced' },
  ],
  backup: [
    { id: 'backup-export', label: 'Export' },
    { id: 'backup-import', label: 'Restore' },
    { id: 'backup-raycast', label: 'Migrate' },
  ],
  account: [
    { id: 'account-profile', label: 'Profile' },
    { id: 'account-subscription', label: 'Subscription' },
    { id: 'account-sync', label: 'Cloud sync' },
  ],
  advanced: [
    { id: 'advanced-extension-surface', label: 'Extension surface' },
    { id: 'advanced-input', label: 'Input' },
    { id: 'advanced-scheduled-tasks', label: 'Scheduled tasks' },
  ],
};

export function filterSearchIndex(
  index: SettingsSearchEntry[],
  query: string,
): SettingsSearchEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return index.filter((entry) => {
    const haystack = [entry.title, entry.description, entry.tabLabel, ...(entry.keywords ?? [])]
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  });
}

/** `filterSearchIndex` only covers tabs indexed in `SETTINGS_SEARCH_INDEX`
 *  (general/extensions/browsers/applications/file-search/scripts/ai/backup/account/advanced) —
 *  searching e.g. "privacy" or "about" would otherwise return nothing even though
 *  those tabs exist. For any tab whose label matches the query and that has no
 *  real indexed match of its own, synthesize a fallback entry that just
 *  opens the tab, so every tab stays reachable from search until its own
 *  settings are indexed. */
export function buildSearchResults(
  index: SettingsSearchEntry[],
  tabs: SettingsTabDescriptor[],
  query: string,
): SettingsSearchEntry[] {
  const matches = filterSearchIndex(index, query);
  const q = query.trim().toLowerCase();
  if (!q) return matches;

  const matchedTabIds = new Set(matches.map((entry) => entry.tab));
  const tabFallbacks: SettingsSearchEntry[] = tabs
    .filter((tab) => !matchedTabIds.has(tab.id) && tab.label.toLowerCase().includes(q))
    .map((tab) => ({
      id: `tab-${tab.id}`,
      title: tab.label,
      description: `Open the ${tab.label} tab.`,
      tab: tab.id,
      tabLabel: tab.label,
    }));

  return [...matches, ...tabFallbacks];
}
