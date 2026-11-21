import type { SearchBarAccessoryDropdownOption } from 'asyar-sdk/contracts';
import type { ApiExtension } from './state.svelte';

export type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

export interface StoreCategoryMeta {
  id: string;
  labelKey: string;
  fallbackLabel: string;
}

export type StoreCapabilityId = 'web-search' | 'ai-provider' | 'web-reader' | 'file-search';

export interface StoreCapabilityMeta {
  id: StoreCapabilityId;
  filterValue: `cap:${StoreCapabilityId}`;
  labelKey: string;
  fallbackLabel: string;
}

export const STORE_CATEGORIES: readonly StoreCategoryMeta[] = [
  { id: 'ai', labelKey: 'features.store.categories.ai', fallbackLabel: 'AI & Search' },
  {
    id: 'developer-tools',
    labelKey: 'features.store.categories.developer_tools',
    fallbackLabel: 'Developer Tools',
  },
  {
    id: 'design-tools',
    labelKey: 'features.store.categories.design_tools',
    fallbackLabel: 'Design Tools',
  },
  {
    id: 'productivity',
    labelKey: 'features.store.categories.productivity',
    fallbackLabel: 'Productivity',
  },
  {
    id: 'communication',
    labelKey: 'features.store.categories.communication',
    fallbackLabel: 'Communication',
  },
  { id: 'finance', labelKey: 'features.store.categories.finance', fallbackLabel: 'Finance' },
  { id: 'media', labelKey: 'features.store.categories.media', fallbackLabel: 'Media' },
  {
    id: 'utilities',
    labelKey: 'features.store.categories.utilities',
    fallbackLabel: 'Utilities',
  },
  { id: 'system', labelKey: 'features.store.categories.system', fallbackLabel: 'System' },
  { id: 'theme', labelKey: 'features.store.categories.theme', fallbackLabel: 'Themes' },
  { id: 'other', labelKey: 'features.store.categories.other', fallbackLabel: 'Other' },
] as const;

export const STORE_CAPABILITIES: readonly StoreCapabilityMeta[] = [
  {
    id: 'web-search',
    filterValue: 'cap:web-search',
    labelKey: 'features.store.capabilities.web_search',
    fallbackLabel: 'Web Search',
  },
  {
    id: 'ai-provider',
    filterValue: 'cap:ai-provider',
    labelKey: 'features.store.capabilities.ai_provider',
    fallbackLabel: 'AI Provider',
  },
  {
    id: 'web-reader',
    filterValue: 'cap:web-reader',
    labelKey: 'features.store.capabilities.web_reader',
    fallbackLabel: 'Web Reader',
  },
  {
    id: 'file-search',
    filterValue: 'cap:file-search',
    labelKey: 'features.store.capabilities.file_search',
    fallbackLabel: 'File Search',
  },
] as const;

const LEGACY_CATEGORY_ALIASES: Record<string, string> = {
  others: 'other',
  development: 'developer-tools',
  'developer tools': 'developer-tools',
  'design tools': 'design-tools',
  themes: 'theme',
  utils: 'utilities',
};

const CATEGORY_BY_ID = new Map(STORE_CATEGORIES.map((c) => [c.id, c]));
const CAPABILITY_BY_ID = new Map(STORE_CAPABILITIES.map((c) => [c.id, c]));

export function normalizeCategorySlug(raw: string | null | undefined): string {
  const cleaned = (raw ?? '').trim().toLowerCase();
  if (!cleaned) return 'other';
  const mapped = LEGACY_CATEGORY_ALIASES[cleaned] ?? cleaned;
  return CATEGORY_BY_ID.has(mapped) ? mapped : 'other';
}

export function getExtensionCategory(item: Pick<ApiExtension, 'category' | 'manifest'>): string {
  if (item.manifest?.type === 'theme') {
    return 'theme';
  }
  return normalizeCategorySlug(item.category);
}

export function getExtensionCapabilities(
  item: Pick<ApiExtension, 'manifest'>,
): StoreCapabilityId[] {
  const m = item.manifest;
  if (!m) return [];
  const caps: StoreCapabilityId[] = [];
  if (Array.isArray(m.webSearchEngines) && m.webSearchEngines.length > 0) {
    caps.push('web-search');
  }
  if (Array.isArray(m.aiProviders) && m.aiProviders.length > 0) {
    caps.push('ai-provider');
  }
  if (Array.isArray(m.webReaders) && m.webReaders.length > 0) {
    caps.push('web-reader');
  }
  if (Array.isArray(m.fileSearchProviders) && m.fileSearchProviders.length > 0) {
    caps.push('file-search');
  }
  return caps;
}

export function getCategoryLabel(category: string | null | undefined, t: TranslateFn): string {
  const slug = normalizeCategorySlug(category);
  const meta = CATEGORY_BY_ID.get(slug);
  if (!meta) return category || 'Other';
  const translated = t(meta.labelKey);
  return translated === meta.labelKey ? meta.fallbackLabel : translated;
}

export function getCapabilityLabel(cap: StoreCapabilityId, t: TranslateFn): string {
  const meta = CAPABILITY_BY_ID.get(cap);
  if (!meta) return cap;
  const translated = t(meta.labelKey);
  return translated === meta.labelKey ? meta.fallbackLabel : translated;
}

export function matchesStoreFilter(item: ApiExtension, filter: string): boolean {
  if (!filter || filter === 'all') return true;
  if (filter === 'installed') {
    return item.status === 'INSTALLED' || item.status === 'UPDATE_AVAILABLE';
  }
  if (filter.startsWith('cap:')) {
    const cap = filter.slice(4) as StoreCapabilityId;
    return getExtensionCapabilities(item).includes(cap);
  }
  return getExtensionCategory(item) === filter;
}

export function getStoreFilterLabel(filter: string, t: TranslateFn): string {
  const tr = (key: string, fallback: string) => {
    const val = t(key);
    return val === key ? fallback : val;
  };
  if (!filter || filter === 'all') {
    return tr('features.store.filter.all', 'All Extensions');
  }
  if (filter === 'installed') {
    return tr('features.store.filter.installed', 'Installed');
  }
  if (filter.startsWith('cap:')) {
    return getCapabilityLabel(filter.slice(4) as StoreCapabilityId, t);
  }
  return getCategoryLabel(filter, t);
}

export function buildStoreAccessoryOptions(
  items: ApiExtension[],
  activeFilter: string,
  t: TranslateFn,
): { options: SearchBarAccessoryDropdownOption[]; buttonTitle: string } {
  const tr = (key: string, fallback: string) => {
    const val = t(key);
    return val === key ? fallback : val;
  };

  const options: SearchBarAccessoryDropdownOption[] = [
    {
      title: tr('features.store.filter.all', 'All Extensions'),
      value: 'all',
      subtitle: items.length > 0 ? String(items.length) : undefined,
      selected: activeFilter === 'all',
    },
  ];

  const installedCount = items.filter(
    (it) => it.status === 'INSTALLED' || it.status === 'UPDATE_AVAILABLE',
  ).length;
  if (installedCount > 0 || activeFilter === 'installed') {
    options.push({
      title: tr('features.store.filter.installed', 'Installed'),
      value: 'installed',
      subtitle: installedCount > 0 ? String(installedCount) : undefined,
      selected: activeFilter === 'installed',
    });
  }

  const categoryCounts = new Map<string, number>();
  const capabilityCounts = new Map<StoreCapabilityId, number>();
  for (const item of items) {
    const cat = getExtensionCategory(item);
    categoryCounts.set(cat, (categoryCounts.get(cat) ?? 0) + 1);
    for (const cap of getExtensionCapabilities(item)) {
      capabilityCounts.set(cap, (capabilityCounts.get(cap) ?? 0) + 1);
    }
  }

  const categoryChildren: SearchBarAccessoryDropdownOption[] = STORE_CATEGORIES.filter(
    (cat) => (categoryCounts.get(cat.id) ?? 0) > 0 || activeFilter === cat.id,
  ).map((cat) => {
    const count = categoryCounts.get(cat.id) ?? 0;
    return {
      title: getCategoryLabel(cat.id, t),
      value: cat.id,
      subtitle: count > 0 ? String(count) : undefined,
      selected: activeFilter === cat.id,
    };
  });

  if (categoryChildren.length > 0) {
    options.push({
      title: tr('features.store.filter.categories_group', 'Categories'),
      value: '__group_categories__',
      selected: categoryChildren.some((c) => c.selected),
      children: categoryChildren,
    });
  }

  const capabilityChildren: SearchBarAccessoryDropdownOption[] = STORE_CAPABILITIES.filter(
    (cap) => (capabilityCounts.get(cap.id) ?? 0) > 0 || activeFilter === cap.filterValue,
  ).map((cap) => {
    const count = capabilityCounts.get(cap.id) ?? 0;
    return {
      title: getCapabilityLabel(cap.id, t),
      value: cap.filterValue,
      subtitle: count > 0 ? String(count) : undefined,
      selected: activeFilter === cap.filterValue,
    };
  });

  if (capabilityChildren.length > 0) {
    options.push({
      title: tr('features.store.filter.capabilities_group', 'Capabilities'),
      value: '__group_capabilities__',
      selected: capabilityChildren.some((c) => c.selected),
      children: capabilityChildren,
    });
  }

  return {
    options,
    buttonTitle: getStoreFilterLabel(activeFilter, t),
  };
}
