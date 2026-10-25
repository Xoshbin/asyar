import {
  registerBuiltinSearchProvider,
  type BuiltinRowAction,
  type BuiltinSearchRow,
} from '../../services/search/builtinSearchProviders';
import { openerService } from '../../services/opener/openerService';
import { feedbackService } from '../../services/feedback/feedbackService.svelte';
import { hideWindow } from '../../lib/ipc/commands';
import { t } from '../../services/i18n';
import { writeText } from 'tauri-plugin-clipboard-x-api';
import type { Extension, ExtensionContext } from 'asyar-sdk/contracts';
import { parseUrl } from './parseUrl';

const URL_ROW_ID = 'url_opener_open';

function urlFromPayload(payload: unknown): string | null {
  const url = (payload as { url?: unknown } | undefined)?.url;
  return typeof url === 'string' ? url : null;
}

class UrlOpenerExtension implements Extension {
  private enabled = true;

  async initialize(_context: ExtensionContext): Promise<void> {}

  async activate(): Promise<void> {
    this.enabled = true;
  }

  async deactivate(): Promise<void> {
    this.enabled = false;
  }

  async executeCommand(): Promise<unknown> {
    return undefined;
  }

  async searchRows(query: string): Promise<BuiltinSearchRow[]> {
    if (!this.enabled) return [];
    const url = parseUrl(query);
    if (!url) return [];
    return [
      {
        id: URL_ROW_ID,
        score: 1.0,
        title: t('features.url_opener.open_in_browser'),
        subtitle: url,
        icon: 'icon:globe',
        priority: 'top',
        primaryActionLabel: t('features.url_opener.open'),
        actionPayload: { url },
      },
    ];
  }

  async executeSearchResult(_rowId: string, payload?: unknown): Promise<void> {
    const url = urlFromPayload(payload);
    if (!url) return;
    try {
      await openerService.open(null, url);
      await hideWindow();
    } catch (err) {
      void feedbackService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'error',
        retryable: false,
        context: { message: t('features.url_opener.open_failed', { url }) },
        developerDetail: String(err),
      });
    }
  }

  rowActions(_rowId: string, payload?: unknown): BuiltinRowAction[] {
    const url = urlFromPayload(payload);
    if (!url) return [];
    return [
      {
        id: 'url-opener:copy-url',
        label: t('features.url_opener.copy_url'),
        description: t('features.url_opener.copy_url_desc'),
        icon: 'icon:copy',
        execute: async () => {
          await writeText(url);
          await feedbackService.showHUD(t('features.url_opener.copied'));
        },
      },
    ];
  }
}

const extension = new UrlOpenerExtension();
registerBuiltinSearchProvider({
  extensionId: 'url-opener',
  search: (query) => extension.searchRows(query),
  execute: (rowId, payload) => extension.executeSearchResult(rowId, payload),
  rowActions: (rowId, payload) => extension.rowActions(rowId, payload),
});
export default extension;
