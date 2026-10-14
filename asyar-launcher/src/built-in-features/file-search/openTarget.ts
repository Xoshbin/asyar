import type { BuiltinSearchRow } from '../../services/search/builtinSearchProviders';
import { hideWindow, openUrl, openerPathPreview } from '../../lib/ipc/commands';
import { feedbackService } from '../../services/feedback/feedbackService.svelte';
import { openerService } from '../../services/opener/openerService';

export const OPEN_URL_ROW_ID = 'file_search_open_url';
export const OPEN_PATH_ROW_ID = 'file_search_open_path';

export type OpenTarget = { kind: 'url'; url: string } | { kind: 'path'; path: string };

const SCHEME_URL = /^(https?:\/\/|mailto:)\S+$/i;

const BARE_HOST =
  /^(localhost|(\d{1,3}\.){3}\d{1,3}|([a-z0-9-]+\.)+[a-z]{2,})(:\d{1,5})?([/?#]\S*)?$/i;
const ABS_PATH = /^(\/|~([\\/]|$)|[a-z]:[\\/])/i;

export function parseTarget(query: string): OpenTarget | null {
  const q = query.trim();
  if (!q) return null;
  if (ABS_PATH.test(q)) return { kind: 'path', path: q };
  if (/\s/.test(q)) return null;
  if (SCHEME_URL.test(q)) return { kind: 'url', url: q };
  if (BARE_HOST.test(q)) {
    const local = /^(localhost|\d)/i.test(q);
    return { kind: 'url', url: `${local ? 'http' : 'https'}://${q}` };
  }
  return null;
}

export async function searchOpenTargets(query: string): Promise<BuiltinSearchRow[]> {
  const target = parseTarget(query);
  if (!target) return [];

  if (target.kind === 'url') {
    return [
      {
        id: OPEN_URL_ROW_ID,
        score: 1.0,
        title: `Open ${target.url}`,
        subtitle: 'Open in default browser',
        icon: 'icon:globe',
        priority: 'top',
        actionPayload: target,
      },
    ];
  }

  const preview = await openerPathPreview(target.path);
  if (!preview) return [];
  return [
    {
      id: OPEN_PATH_ROW_ID,
      score: 1.0,
      title: preview.name,
      subtitle: preview.parent,
      icon: preview.icon,
      priority: 'top',
      actionPayload: { kind: 'path', path: preview.path } satisfies OpenTarget,
    },
  ];
}

export async function openTarget(target: OpenTarget): Promise<void> {
  try {
    if (target.kind === 'url') await openUrl(target.url);
    else await openerService.openPath(null, target.path);
    await hideWindow();
  } catch (err) {
    feedbackService.report({
      source: 'frontend',
      kind: 'file-search/open-failed',
      severity: 'error',
      retryable: false,
      developerDetail: String(err),
    });
  }
}

export async function openTypedUrl(input: string): Promise<void> {
  const q = input.trim();
  if (!q) return;
  const target = parseTarget(q);
  await openTarget(target?.kind === 'url' ? target : { kind: 'url', url: `https://${q}` });
}

export async function openTypedPath(input: string): Promise<void> {
  const q = input.trim();
  if (!q) return;
  const preview = await openerPathPreview(q);
  if (preview) return openTarget({ kind: 'path', path: preview.path });
  void feedbackService.sendBackground({ title: 'Open Path', body: `Not found: ${q}` });
}
