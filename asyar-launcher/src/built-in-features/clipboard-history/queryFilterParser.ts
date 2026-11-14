import type { SearchBarAccessoryDropdownOption } from 'asyar-sdk/contracts';
import type { ClipboardFilter, SourceAppSummary } from '../../lib/ipc/commands';

export type ClipboardTypeFilter = 'all' | 'text' | 'images' | 'files';
export type ClipboardDateFilter = 'all' | 'today' | 'yesterday' | '7d' | '30d' | string;

export interface ParsedClipboardQuery {
  rawQuery: string;
  textQuery: string;
  typeFilter: ClipboardTypeFilter;
  appFilter: string | null;
  dateFilter: ClipboardDateFilter;
  sqlFilter: ClipboardFilter | undefined;
  hasActiveFilter: boolean;
}

const MS_PER_DAY = 86_400_000;

interface QueryToken {
  raw: string;
  kind: 'text' | 'type' | 'app' | 'date';
}

function tokenizeQuery(input: string): QueryToken[] {
  const tokens: QueryToken[] = [];
  let i = 0;
  const len = input.length;

  while (i < len) {
    while (i < len && /\s/.test(input[i])) {
      i++;
    }
    if (i >= len) break;

    const start = i;
    let inQuote: '"' | "'" | null = null;
    while (i < len) {
      const ch = input[i];
      if (inQuote) {
        if (ch === inQuote) {
          inQuote = null;
        }
        i++;
      } else if (ch === '"' || ch === "'") {
        inQuote = ch;
        i++;
      } else if (/\s/.test(ch)) {
        break;
      } else {
        i++;
      }
    }

    tokens.push({ raw: input.slice(start, i), kind: 'text' });
  }

  return tokens;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1).trim();
    }
  }
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
    return trimmed.slice(1).trim();
  }
  return trimmed;
}

function formatAppTokenValue(appName: string): string {
  return /\s/.test(appName) ? `app:"${appName}"` : `app:${appName}`;
}

function parseIsoDateRange(
  ymd: string,
  exactDayOnly: boolean,
): { after: number; before?: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const start = new Date(year, month - 1, day, 0, 0, 0, 0);
  if (start.getFullYear() !== year || start.getMonth() !== month - 1 || start.getDate() !== day) {
    return null;
  }
  if (!exactDayOnly) {
    return { after: start.getTime() };
  }
  const end = new Date(year, month - 1, day, 23, 59, 59, 999);
  return { after: start.getTime(), before: end.getTime() };
}

function parseDateValue(
  rawVal: string,
  isAfterKey: boolean,
  nowMs: number,
): { normalized: string; after?: number; before?: number } | null {
  const clean = unquote(rawVal).toLowerCase();
  if (!clean) return null;
  if (clean === 'all') {
    return { normalized: 'all' };
  }
  if (clean === 'today') {
    const d = new Date(nowMs);
    d.setHours(0, 0, 0, 0);
    return { normalized: 'today', after: d.getTime() };
  }
  if (clean === 'yesterday') {
    const todayStart = new Date(nowMs);
    todayStart.setHours(0, 0, 0, 0);
    const yesterdayStart = new Date(todayStart.getTime() - MS_PER_DAY);
    return {
      normalized: 'yesterday',
      after: yesterdayStart.getTime(),
      before: todayStart.getTime() - 1,
    };
  }
  if (clean === '7d' || clean === 'week') {
    return { normalized: '7d', after: nowMs - 7 * MS_PER_DAY };
  }
  if (clean === '30d' || clean === 'month') {
    return { normalized: '30d', after: nowMs - 30 * MS_PER_DAY };
  }
  const iso = parseIsoDateRange(clean, !isAfterKey);
  if (iso) {
    return {
      normalized: isAfterKey ? `after:${clean}` : clean,
      after: iso.after,
      before: iso.before,
    };
  }
  return null;
}

export function parseClipboardSearchQuery(
  rawQuery: string,
  nowMs: number = Date.now(),
): ParsedClipboardQuery {
  const tokens = tokenizeQuery(rawQuery);
  const textParts: string[] = [];

  let typeFilter: ClipboardTypeFilter = 'all';
  let appFilter: string | null = null;
  let dateFilter: ClipboardDateFilter = 'all';
  let createdAfter: number | undefined;
  let createdBefore: number | undefined;

  for (const tok of tokens) {
    const colonIdx = tok.raw.indexOf(':');
    if (colonIdx > 0) {
      const key = tok.raw.slice(0, colonIdx).toLowerCase();
      const val = tok.raw.slice(colonIdx + 1);

      if (key === 'type') {
        const norm = unquote(val).toLowerCase();
        if (norm === 'text') {
          typeFilter = 'text';
          continue;
        }
        if (norm === 'image' || norm === 'images') {
          typeFilter = 'images';
          continue;
        }
        if (norm === 'file' || norm === 'files') {
          typeFilter = 'files';
          continue;
        }
        if (norm === 'all') {
          typeFilter = 'all';
          continue;
        }
      } else if (key === 'app') {
        const cleanApp = unquote(val);
        if (cleanApp) {
          appFilter = cleanApp.toLowerCase() === 'all' ? null : cleanApp;
          continue;
        }
      } else if (key === 'date' || key === 'after') {
        const parsedDate = parseDateValue(val, key === 'after', nowMs);
        if (parsedDate) {
          dateFilter = parsedDate.normalized;
          createdAfter = parsedDate.after;
          createdBefore = parsedDate.before;
          continue;
        }
      }
    }

    textParts.push(tok.raw);
  }

  const hasActiveFilter = typeFilter !== 'all' || appFilter !== null || dateFilter !== 'all';

  let sqlFilter: ClipboardFilter | undefined;
  if (hasActiveFilter) {
    sqlFilter = {
      ...(typeFilter !== 'all' ? { itemType: typeFilter } : {}),
      ...(appFilter ? { sourceApp: appFilter } : {}),
      ...(createdAfter !== undefined ? { createdAfter } : {}),
      ...(createdBefore !== undefined ? { createdBefore } : {}),
    };
  }

  return {
    rawQuery,
    textQuery: textParts.join(' '),
    typeFilter,
    appFilter,
    dateFilter,
    sqlFilter,
    hasActiveFilter,
  };
}

export function applyDropdownSelectionToQuery(rawQuery: string, selectedValue: string): string {
  const parsed = parseClipboardSearchQuery(rawQuery);
  let nextType: ClipboardTypeFilter = parsed.typeFilter;
  let nextApp: string | null = parsed.appFilter;
  let nextDate: string = parsed.dateFilter;

  if (selectedValue === 'all' || selectedValue === 'type:all') {
    nextType = 'all';
  } else if (selectedValue === 'text' || selectedValue === 'images' || selectedValue === 'files') {
    nextType = selectedValue;
  } else if (selectedValue.startsWith('type:')) {
    const val = selectedValue.slice('type:'.length);
    if (val === 'text' || val === 'images' || val === 'files') {
      nextType = val;
    } else if (val === 'all') {
      nextType = 'all';
    }
  } else if (selectedValue === 'app:all') {
    nextApp = null;
  } else if (selectedValue.startsWith('app:')) {
    const appName = selectedValue.slice('app:'.length).trim();
    if (!appName) {
      nextApp = null;
    } else if (nextApp && nextApp.toLowerCase() === appName.toLowerCase()) {
      nextApp = null;
    } else {
      nextApp = appName;
    }
  } else if (selectedValue === 'date:all') {
    nextDate = 'all';
  } else if (selectedValue.startsWith('date:')) {
    const preset = selectedValue.slice('date:'.length).trim();
    if (!preset || preset === 'all') {
      nextDate = 'all';
    } else if (nextDate === preset) {
      nextDate = 'all';
    } else {
      nextDate = preset;
    }
  }

  const filterTokens: string[] = [];
  if (nextType !== 'all') {
    filterTokens.push(`type:${nextType}`);
  }
  if (nextApp) {
    filterTokens.push(formatAppTokenValue(nextApp));
  }
  if (nextDate !== 'all') {
    filterTokens.push(nextDate.startsWith('after:') ? nextDate : `date:${nextDate}`);
  }

  if (filterTokens.length === 0) {
    return parsed.textQuery;
  }
  if (parsed.textQuery) {
    return `${filterTokens.join(' ')} ${parsed.textQuery}`;
  }
  return `${filterTokens.join(' ')} `;
}

function getDateLabel(
  dateFilter: ClipboardDateFilter,
  translate: (key: string) => string,
): string | undefined {
  switch (dateFilter) {
    case 'all':
      return undefined;
    case 'today':
      return translate('features.clipboard.filter_date_today');
    case 'yesterday':
      return translate('features.clipboard.filter_date_yesterday');
    case '7d':
      return translate('features.clipboard.filter_date_7d');
    case '30d':
      return translate('features.clipboard.filter_date_30d');
    default:
      return dateFilter.startsWith('after:') ? dateFilter : dateFilter;
  }
}

export function buildClipboardAccessoryState(
  parsed: ParsedClipboardQuery,
  sourceApps: SourceAppSummary[],
  translate: (key: string) => string,
): { options: SearchBarAccessoryDropdownOption[]; buttonTitle: string } {
  const typeLabelMap: Record<Exclude<ClipboardTypeFilter, 'all'>, string> = {
    text: translate('features.clipboard.filter_text'),
    images: translate('features.clipboard.filter_images'),
    files: translate('features.clipboard.filter_files'),
  };

  const options: SearchBarAccessoryDropdownOption[] = [
    {
      value: 'all',
      title: translate('features.clipboard.filter_all_types'),
      selected: parsed.typeFilter === 'all',
    },
    {
      value: 'text',
      title: typeLabelMap.text,
      selected: parsed.typeFilter === 'text',
    },
    {
      value: 'images',
      title: typeLabelMap.images,
      selected: parsed.typeFilter === 'images',
    },
    {
      value: 'files',
      title: typeLabelMap.files,
      selected: parsed.typeFilter === 'files',
    },
  ];

  if (sourceApps.length > 0 || parsed.appFilter) {
    const appChildren: SearchBarAccessoryDropdownOption[] = [
      {
        value: 'app:all',
        title: translate('features.clipboard.filter_all_apps'),
        selected: !parsed.appFilter,
      },
      ...sourceApps.map((app) => ({
        value: `app:${app.name}`,
        title: app.name,
        subtitle: String(app.count),
        selected: parsed.appFilter?.toLowerCase() === app.name.toLowerCase(),
      })),
    ];

    if (
      parsed.appFilter &&
      !sourceApps.some((a) => a.name.toLowerCase() === parsed.appFilter!.toLowerCase())
    ) {
      appChildren.push({
        value: `app:${parsed.appFilter}`,
        title: parsed.appFilter,
        selected: true,
      });
    }

    options.push({
      value: 'submenu:app',
      title: translate('features.clipboard.filter_by_app'),
      subtitle: parsed.appFilter ?? undefined,
      children: appChildren,
    });
  }

  const dateSubtitle = getDateLabel(parsed.dateFilter, translate);
  options.push({
    value: 'submenu:date',
    title: translate('features.clipboard.filter_by_date'),
    subtitle: dateSubtitle,
    children: [
      {
        value: 'date:all',
        title: translate('features.clipboard.filter_all_dates'),
        selected: parsed.dateFilter === 'all',
      },
      {
        value: 'date:today',
        title: translate('features.clipboard.filter_date_today'),
        selected: parsed.dateFilter === 'today',
      },
      {
        value: 'date:yesterday',
        title: translate('features.clipboard.filter_date_yesterday'),
        selected: parsed.dateFilter === 'yesterday',
      },
      {
        value: 'date:7d',
        title: translate('features.clipboard.filter_date_7d'),
        selected: parsed.dateFilter === '7d',
      },
      {
        value: 'date:30d',
        title: translate('features.clipboard.filter_date_30d'),
        selected: parsed.dateFilter === '30d',
      },
    ],
  });

  const activeLabels: string[] = [];
  if (parsed.typeFilter !== 'all') {
    activeLabels.push(typeLabelMap[parsed.typeFilter]);
  }
  if (parsed.appFilter) {
    activeLabels.push(parsed.appFilter);
  }
  if (dateSubtitle) {
    activeLabels.push(dateSubtitle);
  }

  const buttonTitle =
    activeLabels.length > 0
      ? activeLabels.join(' · ')
      : translate('features.clipboard.filter_all_types');

  return { options, buttonTitle };
}
