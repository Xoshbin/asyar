import { readTextFile } from '@tauri-apps/plugin-fs';
import { portalPickPath, setFocusLock } from '../../lib/ipc/commands';
import { portalStore } from './portalStore.svelte';
import { syncAllPortalsToIndex } from './portalLifecycle';
import { feedbackService } from '../../services/feedback/feedbackService.svelte';
import { logService } from '../../services/log/logService';
import { t } from '../../services/i18n';

interface RawQuicklinkJson {
  name?: unknown;
  link?: unknown;
  url?: unknown;
  icon?: unknown;
  iconName?: unknown;
  openWith?: unknown;
  tags?: unknown;
}

export function parseQuicklinksJsonText(rawText: string): Array<{
  name: string;
  url: string;
  icon?: string;
  openWith?: string;
  tags?: string[];
}> {
  const parsed: unknown = JSON.parse(rawText);
  if (!Array.isArray(parsed)) {
    throw new Error('JSON file must contain an array of Quicklink/Portal objects.');
  }

  const out: Array<{
    name: string;
    url: string;
    icon?: string;
    openWith?: string;
    tags?: string[];
  }> = [];

  for (const item of parsed as RawQuicklinkJson[]) {
    if (!item || typeof item !== 'object') continue;
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const link =
      typeof item.link === 'string'
        ? item.link.trim()
        : typeof item.url === 'string'
          ? item.url.trim()
          : '';
    if (!name || !link) continue;

    let openWith: string | undefined;
    if (typeof item.openWith === 'string' && item.openWith.trim()) {
      openWith = item.openWith.trim();
    } else if (item.openWith && typeof item.openWith === 'object') {
      const obj = item.openWith as Record<string, unknown>;
      if (typeof obj.path === 'string' && obj.path.trim()) {
        openWith = obj.path.trim();
      } else if (typeof obj.name === 'string' && obj.name.trim()) {
        openWith = obj.name.trim();
      }
    }

    const tags = Array.isArray(item.tags)
      ? item.tags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
      : undefined;

    const icon = typeof item.icon === 'string' && item.icon.trim() ? item.icon.trim() : undefined;

    out.push({ name, url: link, icon, openWith, tags });
  }

  return out;
}

export async function importPortalsFromJsonDialog(): Promise<void> {
  await setFocusLock(true);
  try {
    const selected = await portalPickPath('json');
    if (typeof selected !== 'string') return;

    const text = await readTextFile(selected);
    const items = parseQuicklinksJsonText(text);
    const { added, skipped } = portalStore.importPortals(items);
    await syncAllPortalsToIndex();

    const portalNoun =
      added.length === 1
        ? t('features.portals.ui.portal_singular')
        : t('features.portals.ui.portal_plural');
    const dupNoun =
      skipped === 1
        ? t('features.portals.ui.duplicate_singular')
        : t('features.portals.ui.duplicate_plural');
    const skippedPart =
      skipped > 0
        ? t('features.portals.ui.imported_skipped', { count: skipped, noun: dupNoun })
        : '';

    feedbackService.report({
      source: 'frontend',
      kind: 'manual',
      severity: 'info',
      retryable: false,
      context: {
        message: t('features.portals.ui.imported_summary', {
          count: added.length,
          noun: portalNoun,
          skipped: skippedPart,
        }),
      },
    });
  } catch (err) {
    logService.warn(`[portals] importPortalsFromJsonDialog failed: ${err}`);
    feedbackService.report({
      source: 'frontend',
      kind: 'manual',
      severity: 'warning',
      retryable: false,
      context: {
        message: t('features.portals.ui.import_failed', {
          error: err instanceof Error ? err.message : String(err),
        }),
      },
    });
  } finally {
    await setFocusLock(false);
  }
}
