/** Maps each Help topic to its page in the user guide on asyar.org. */
export interface HelpTopic {
  id: string;
  title: string;
  subtitle: string;
  /** Built-in icon, "icon:<name>". Names must exist in asyar-sdk ICON_DATA. */
  icon: string;
  /** Path under the guide root, e.g. "features/calculator". */
  slug: string;
}

export const GUIDE_BASE_URL = 'https://asyar.org/docs/guide';

export function guideUrl(slug: string): string {
  return `${GUIDE_BASE_URL}/${slug}`;
}

export const HELP_TOPICS: readonly HelpTopic[] = [
  { id: 'getting-started', title: 'Getting Started', subtitle: 'Install, first launch, your hotkey', icon: 'icon:sparkles', slug: 'getting-started' },
  { id: 'the-basics', title: 'The Basics', subtitle: 'Search, navigation, the action panel', icon: 'icon:keyboard', slug: 'the-basics' },
  { id: 'calculator', title: 'Calculator', subtitle: 'Math, units, currency, dates', icon: 'icon:calculator', slug: 'features/calculator' },
  { id: 'clipboard-history', title: 'Clipboard History', subtitle: 'Browse, filter, favorite, paste past copies', icon: 'icon:clipboard', slug: 'features/clipboard-history' },
  { id: 'snippets', title: 'Snippets', subtitle: 'Type a keyword, paste the full text', icon: 'icon:snippets', slug: 'features/snippets' },
  { id: 'window-management', title: 'Window Management', subtitle: 'Resize and arrange windows', icon: 'icon:layers', slug: 'features/window-management' },
  { id: 'aliases-and-shortcuts', title: 'Aliases & Shortcuts', subtitle: 'Custom triggers and global hotkeys', icon: 'icon:keyboard', slug: 'features/aliases-and-shortcuts' },
  { id: 'portals', title: 'Portals', subtitle: 'Save URLs as searchable shortcuts', icon: 'icon:link', slug: 'features/portals' },
  { id: 'scripts', title: 'Scripts', subtitle: 'Run shell scripts from watched folders', icon: 'icon:terminal', slug: 'features/scripts' },
  { id: 'ai-and-agents', title: 'AI & Agents', subtitle: 'Ask AI, build agents, manage threads', icon: 'icon:sparkles', slug: 'features/ai-and-agents' },
  { id: 'mcp', title: 'MCP', subtitle: 'Connect external tools to your agents', icon: 'icon:server', slug: 'features/mcp' },
  { id: 'browser-integration', title: 'Browser Integration', subtitle: 'Search bookmarks, history, and tabs', icon: 'icon:globe', slug: 'features/browser-integration' },
  { id: 'extensions', title: 'Extensions', subtitle: 'Browse, install, and manage extensions', icon: 'icon:store', slug: 'features/extensions' },
] as const;

export function filterTopics(topics: readonly HelpTopic[], query: string): HelpTopic[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...topics];
  return topics.filter(
    (t) => t.title.toLowerCase().includes(q) || t.subtitle.toLowerCase().includes(q),
  );
}
