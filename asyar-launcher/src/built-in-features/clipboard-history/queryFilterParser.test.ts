import { describe, it, expect } from 'vitest';
import {
  parseClipboardSearchQuery,
  applyDropdownSelectionToQuery,
  buildClipboardAccessoryState,
} from './queryFilterParser';

describe('queryFilterParser', () => {
  const fixedNow = new Date(2026, 4, 15, 14, 30, 0, 0).getTime();

  it('parses plain text queries cleanly without filters', () => {
    const parsed = parseClipboardSearchQuery('cloudflare api token', fixedNow);
    expect(parsed.textQuery).toBe('cloudflare api token');
    expect(parsed.typeFilter).toBe('all');
    expect(parsed.appFilter).toBeNull();
    expect(parsed.dateFilter).toBe('all');
    expect(parsed.hasActiveFilter).toBe(false);
    expect(parsed.sqlFilter).toBeUndefined();
  });

  it('does not hijack unrecognized key:value code snippets', () => {
    const parsed = parseClipboardSearchQuery('type:string cloudflare', fixedNow);
    expect(parsed.typeFilter).toBe('all');
    expect(parsed.textQuery).toBe('type:string cloudflare');
    expect(parsed.hasActiveFilter).toBe(false);
  });

  it('parses type, quoted app name, and date tokens together', () => {
    const parsed = parseClipboardSearchQuery(
      'type:images app:"Visual Studio Code" date:7d screenshot',
      fixedNow,
    );
    expect(parsed.typeFilter).toBe('images');
    expect(parsed.appFilter).toBe('Visual Studio Code');
    expect(parsed.dateFilter).toBe('7d');
    expect(parsed.textQuery).toBe('screenshot');
    expect(parsed.hasActiveFilter).toBe(true);
    expect(parsed.sqlFilter).toEqual({
      itemType: 'images',
      sourceApp: 'Visual Studio Code',
      createdAfter: fixedNow - 7 * 86_400_000,
    });
  });

  it('parses date:today, date:yesterday, date:YYYY-MM-DD, and after:YYYY-MM-DD', () => {
    const today = parseClipboardSearchQuery('date:today', fixedNow);
    expect(today.sqlFilter?.createdAfter).toBe(new Date(2026, 4, 15, 0, 0, 0, 0).getTime());

    const yesterday = parseClipboardSearchQuery('date:yesterday', fixedNow);
    expect(yesterday.sqlFilter?.createdAfter).toBe(new Date(2026, 4, 14, 0, 0, 0, 0).getTime());
    expect(yesterday.sqlFilter?.createdBefore).toBe(
      new Date(2026, 4, 15, 0, 0, 0, 0).getTime() - 1,
    );

    const exact = parseClipboardSearchQuery('date:2026-05-01', fixedNow);
    expect(exact.sqlFilter?.createdAfter).toBe(new Date(2026, 4, 1, 0, 0, 0, 0).getTime());
    expect(exact.sqlFilter?.createdBefore).toBe(new Date(2026, 4, 1, 23, 59, 59, 999).getTime());

    const after = parseClipboardSearchQuery('after:2026-05-01 token', fixedNow);
    expect(after.textQuery).toBe('token');
    expect(after.sqlFilter?.createdAfter).toBe(new Date(2026, 4, 1, 0, 0, 0, 0).getTime());
    expect(after.sqlFilter?.createdBefore).toBeUndefined();
  });

  it('syncs dropdown selections into search query tokens while preserving existing text', () => {
    expect(applyDropdownSelectionToQuery('', 'images')).toBe('type:images ');
    expect(applyDropdownSelectionToQuery('type:images ', 'app:Visual Studio Code')).toBe(
      'type:images app:"Visual Studio Code" ',
    );
    expect(applyDropdownSelectionToQuery('type:images cloudflare', 'date:today')).toBe(
      'type:images date:today cloudflare',
    );
    // Re-selecting the active app toggles it off
    expect(
      applyDropdownSelectionToQuery(
        'app:"Visual Studio Code" cloudflare',
        'app:Visual Studio Code',
      ),
    ).toBe('cloudflare');
    // Choosing 'all' removes type token while preserving text & other filters
    expect(applyDropdownSelectionToQuery('type:images date:today cloudflare', 'all')).toBe(
      'date:today cloudflare',
    );
  });

  it('builds accessory options tree, checkmarks, and compact summary button title', () => {
    const tr = (key: string) =>
      ({
        'features.clipboard.filter_all_types': 'All Types',
        'features.clipboard.filter_text': 'Text',
        'features.clipboard.filter_images': 'Images',
        'features.clipboard.filter_files': 'Files',
        'features.clipboard.filter_by_app': 'Filter by App',
        'features.clipboard.filter_by_date': 'Filter by Date',
        'features.clipboard.filter_all_apps': 'All Apps',
        'features.clipboard.filter_all_dates': 'All Time',
        'features.clipboard.filter_date_today': 'Today',
        'features.clipboard.filter_date_yesterday': 'Yesterday',
        'features.clipboard.filter_date_7d': 'Last 7 Days',
        'features.clipboard.filter_date_30d': 'Last 30 Days',
      })[key] ?? key;

    const parsed = parseClipboardSearchQuery('type:images app:Chrome date:7d', fixedNow);
    const acc = buildClipboardAccessoryState(
      parsed,
      [
        { name: 'Chrome', count: 14 },
        { name: 'Terminal', count: 6 },
      ],
      tr,
    );

    expect(acc.buttonTitle).toBe('Images · Chrome · Last 7 Days');
    const appSubmenu = acc.options.find((o) => o.value === 'submenu:app');
    expect(appSubmenu?.subtitle).toBe('Chrome');
    expect(appSubmenu?.children?.find((c) => c.value === 'app:Chrome')?.selected).toBe(true);
    expect(appSubmenu?.children?.find((c) => c.value === 'app:all')?.selected).toBe(false);

    // Omits "Filter by App" when no source apps exist and no app filter is active
    const noAppParsed = parseClipboardSearchQuery('', fixedNow);
    const noAppAcc = buildClipboardAccessoryState(noAppParsed, [], tr);
    expect(noAppAcc.buttonTitle).toBe('All Types');
    expect(noAppAcc.options.find((o) => o.value === 'submenu:app')).toBeUndefined();
  });
});
