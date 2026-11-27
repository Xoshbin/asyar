import {
  registerBuiltinSearchProvider,
  type BuiltinRowAction,
  type BuiltinSearchRow,
} from '../../services/search/builtinSearchProviders';
import { t } from '../../services/i18n';
import { colorFormatOf, sortColorFormats, splitColorQuery } from '../../lib/colorFormat';
import type {
  Extension,
  ExtensionContext,
  ILogService,
  IFeedbackService,
} from 'asyar-sdk/contracts';
import { writeText } from 'tauri-plugin-clipboard-x-api';

import {
  calculatorConfigure,
  calculatorEvaluate,
  calculatorRefreshRates,
} from '../../lib/ipc/commands';
import type { CalcResult } from '../../bindings';

// All evaluation lives in Rust (src-tauri/src/calculator). This extension
// only forwards the query and renders the results.
const KIND_ICONS: Record<CalcResult['kind'], string> = {
  math: '🧮',
  unit: '📏',
  currency: '💵',
  date: '📅',
  time: '🕒',
  base: '🔢',
  color: '🎨',
  percent: '％',
  ratio: '➗',
};

type BaseFormat = 'DEC' | 'BIN' | 'OCT' | 'HEX';

const BASE_FORMAT_ORDER: readonly BaseFormat[] = ['DEC', 'BIN', 'OCT', 'HEX'];

function baseFormatOf(value: string): BaseFormat | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('0b')) return 'BIN';
  if (lower.startsWith('0o')) return 'OCT';
  if (lower.startsWith('0x')) return 'HEX';
  if (/^[\d,.\s]+$/.test(trimmed)) return 'DEC';
  return null;
}

function sortBaseFormats(values: string[]): string[] {
  const byFormat = new Map<BaseFormat, string>();
  for (const value of values) {
    const trimmed = value.trim();
    const format = baseFormatOf(trimmed);
    if (format && !byFormat.has(format)) {
      byFormat.set(format, trimmed);
    }
  }
  return BASE_FORMAT_ORDER.flatMap((fmt) => {
    const v = byFormat.get(fmt);
    return v ? [v] : [];
  });
}

class CalculatorExtension implements Extension {
  private logService?: ILogService;
  private feedbackService?: IFeedbackService;
  private enabled = true;

  onUnload: any;

  async initialize(context: ExtensionContext): Promise<void> {
    this.logService = context.getService<ILogService>('log');
    this.feedbackService = context.getService<IFeedbackService>('feedback');

    // Forward preferences to Rust, which owns the exchange-rate cache,
    // its TTL policy, and the implicit-conversion target currency.
    const interval = context.preferences.values.refreshInterval;
    const preferred = context.preferences.values.preferredCurrency;
    const numberFormat = context.preferences.values.numberFormat;
    const args: Record<string, unknown> = {};
    if (typeof interval === 'number' && Number.isFinite(interval)) {
      args.ttlHours = interval;
    }
    if (typeof preferred === 'string' && preferred.trim()) {
      args.preferredCurrency = preferred.trim();
    }
    // Always forwarded, including "auto": Rust reads anything it does not
    // recognize as "follow the host locale", so switching back to
    // Automatic has to reach it too.
    if (typeof numberFormat === 'string' && numberFormat.trim()) {
      args.numberFormat = numberFormat.trim();
    }
    if (Object.keys(args).length > 0) {
      await calculatorConfigure(args);
    }
  }

  async executeCommand(_commandId: string, _args?: Record<string, any>): Promise<any> {
    return;
  }

  async activate(): Promise<void> {
    this.enabled = true;
    // Warm the exchange-rate cache; Rust refreshes lazily on stale reads.
    await calculatorRefreshRates();
  }

  async deactivate(): Promise<void> {
    this.enabled = false;
  }

  async searchRows(query: string): Promise<BuiltinSearchRow[]> {
    if (!this.enabled) return [];
    const trimmed = query.trim();
    if (!trimmed) return [];

    const results = await calculatorEvaluate(trimmed);

    return results.map((r, index) => ({
      id: `calc_result_${index}`,
      score: 1.0,
      title: r.value,
      subtitle: r.kind === 'color' ? splitColorQuery(trimmed).color : r.detail || trimmed,
      icon: KIND_ICONS[r.kind] ?? '🧮',
      style: 'large',
      priority: 'top',
      primaryActionLabel: t('common.copy'),
      actionPayload: {
        copyValue: r.value.replace(/^≈ /, ''),
        // Every notation of a color or number base, so ⌘K can offer each one
        // without another round-trip. Plain data: it travels with the row.
        ...(r.kind === 'color' && {
          colorFormats: sortColorFormats([r.value, ...r.detail.split(' · ')]),
        }),
        ...(r.kind === 'base' && {
          baseFormats: sortBaseFormats([r.value, ...r.detail.split(' · ')]),
        }),
      },
    }));
  }

  rowActions(rowId: string, payload?: unknown): BuiltinRowAction[] {
    const data = payload as { colorFormats?: unknown; baseFormats?: unknown } | undefined;
    const actions: BuiltinRowAction[] = [];

    if (Array.isArray(data?.colorFormats)) {
      for (const value of data.colorFormats) {
        const format = typeof value === 'string' ? colorFormatOf(value) : null;
        if (!format) continue;
        actions.push({
          id: `calculator:copy-color-${format.toLowerCase()}`,
          label: t('selection_actions.copy_color_as', { format }),
          description: t('selection_actions.copy_color_as_desc', { format }),
          icon: 'icon:copy',
          category: t('components.calc_card.color'),
          execute: () => this.executeSearchResult(rowId, { copyValue: value }),
        });
      }
    }

    if (Array.isArray(data?.baseFormats)) {
      for (const value of data.baseFormats) {
        const format = typeof value === 'string' ? baseFormatOf(value) : null;
        if (!format) continue;
        actions.push({
          id: `calculator:copy-base-${format.toLowerCase()}`,
          label: t('selection_actions.copy_color_as', { format }),
          description: t('selection_actions.copy_base_as_desc', { format }),
          icon: 'icon:copy',
          category: t('components.calc_card.base'),
          execute: () => this.executeSearchResult(rowId, { copyValue: value }),
        });
      }
    }

    return actions;
  }

  async executeSearchResult(_id: string, payload?: unknown): Promise<void> {
    const copyValue = (payload as { copyValue?: unknown } | undefined)?.copyValue;
    if (typeof copyValue !== 'string') return;
    try {
      await writeText(copyValue);
      await this.feedbackService?.showHUD(`Copied: ${copyValue}`);
    } catch (e) {
      this.logService?.error('Copy failed: ' + e);
    }
  }
}

// Export singleton instance
const extension = new CalculatorExtension();
registerBuiltinSearchProvider({
  extensionId: 'calculator',
  search: (query) => extension.searchRows(query),
  execute: (id, payload) => extension.executeSearchResult(id, payload),
  rowActions: (id, payload) => extension.rowActions(id, payload),
});
export default extension;
