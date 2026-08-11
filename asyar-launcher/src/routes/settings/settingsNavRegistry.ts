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
 *  to and briefly highlights that element on selection. Only the four
 *  Phase-1 tabs (general/extensions/applications/advanced) are indexed;
 *  indexing the remaining tabs is follow-up work for their own migration
 *  plans. Titles/descriptions below are the same copy the design handoff
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
  applications: [
    { id: 'applications-scope', label: 'Search scope' },
    { id: 'applications-list', label: 'Applications' },
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
 *  (currently general/extensions/applications/advanced) — searching e.g.
 *  "backup" or "privacy" would otherwise return nothing even though those
 *  tabs exist. For any tab whose label matches the query and that has no
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
