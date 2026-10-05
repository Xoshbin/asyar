import { t } from '../../services/i18n';
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
  {
    id: 'getting-started',
    get title() {
      return t('features.help.topics.getting_started');
    },
    get subtitle() {
      return t('features.help.topics.getting_started_sub');
    },
    icon: 'icon:sparkles',
    slug: 'getting-started',
  },
  {
    id: 'the-basics',
    get title() {
      return t('features.help.topics.basics');
    },
    get subtitle() {
      return t('features.help.topics.basics_sub');
    },
    icon: 'icon:keyboard',
    slug: 'the-basics',
  },
  {
    id: 'calculator',
    get title() {
      return t('features.help.topics.calculator');
    },
    get subtitle() {
      return t('features.help.topics.calculator_sub');
    },
    icon: 'icon:calculator',
    slug: 'features/calculator',
  },
  {
    id: 'clipboard-history',
    get title() {
      return t('features.help.topics.clipboard');
    },
    get subtitle() {
      return t('features.help.topics.clipboard_sub');
    },
    icon: 'icon:clipboard',
    slug: 'features/clipboard-history',
  },
  {
    id: 'snippets',
    get title() {
      return t('features.help.topics.snippets');
    },
    get subtitle() {
      return t('features.help.topics.snippets_sub');
    },
    icon: 'icon:snippets',
    slug: 'features/snippets',
  },
  {
    id: 'window-management',
    get title() {
      return t('features.help.topics.window_management');
    },
    get subtitle() {
      return t('features.help.topics.window_management_sub');
    },
    icon: 'icon:layers',
    slug: 'features/window-management',
  },
  {
    id: 'aliases-and-shortcuts',
    get title() {
      return t('features.help.topics.aliases_shortcuts');
    },
    get subtitle() {
      return t('features.help.topics.aliases_shortcuts_sub');
    },
    icon: 'icon:keyboard',
    slug: 'features/aliases-and-shortcuts',
  },
  {
    id: 'portals',
    get title() {
      return t('features.help.topics.portals');
    },
    get subtitle() {
      return t('features.help.topics.portals_sub');
    },
    icon: 'icon:link',
    slug: 'features/portals',
  },
  {
    id: 'scripts',
    get title() {
      return t('features.help.topics.scripts');
    },
    get subtitle() {
      return t('features.help.topics.scripts_sub');
    },
    icon: 'icon:terminal',
    slug: 'features/scripts',
  },
  {
    id: 'ai-and-agents',
    get title() {
      return t('features.help.topics.ai_agents');
    },
    get subtitle() {
      return t('features.help.topics.ai_agents_sub');
    },
    icon: 'icon:sparkles',
    slug: 'features/ai-and-agents',
  },
  {
    id: 'mcp',
    get title() {
      return t('features.help.topics.mcp');
    },
    get subtitle() {
      return t('features.help.topics.mcp_sub');
    },
    icon: 'icon:server',
    slug: 'features/mcp',
  },
  {
    id: 'browser-integration',
    get title() {
      return t('features.help.topics.browser');
    },
    get subtitle() {
      return t('features.help.topics.browser_sub');
    },
    icon: 'icon:globe',
    slug: 'features/browser-integration',
  },
  {
    id: 'extensions',
    get title() {
      return t('features.help.topics.extensions');
    },
    get subtitle() {
      return t('features.help.topics.extensions_sub');
    },
    icon: 'icon:store',
    slug: 'features/extensions',
  },
] as const;

export function filterTopics(topics: readonly HelpTopic[], query: string): HelpTopic[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...topics];
  return topics.filter(
    (t) => t.title.toLowerCase().includes(q) || t.subtitle.toLowerCase().includes(q),
  );
}
