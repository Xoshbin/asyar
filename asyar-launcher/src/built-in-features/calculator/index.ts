import {
  registerBuiltinSearchProvider,
  type BuiltinSearchRow,
} from '../../services/search/builtinSearchProviders';
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

// Color rows show the typed query as their expression, so the HEX/RGB/HSL
// variants for the ⌘K copy actions live here, keyed by row id.
let colorFormats = new Map<string, string[]>();
const colorOrder = (value: string) => (value.startsWith('#') ? 0 : value.startsWith('rgb') ? 1 : 2);

/** HEX, RGB, HSL for a color row from the latest search, else undefined. */
export function colorFormatsFor(rowId: string): string[] | undefined {
  return colorFormats.get(rowId);
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

    colorFormats = new Map();
    results.forEach((r, index) => {
      if (r.kind !== 'color') return;
      const formats = [r.value, ...r.detail.split(' · ')];
      colorFormats.set(
        `calc_result_${index}`,
        formats.sort((a, b) => colorOrder(a) - colorOrder(b)),
      );
    });

    return results.map((r, index) => ({
      id: `calc_result_${index}`,
      score: 1.0,
      title: r.value,
      subtitle: r.kind === 'color' ? trimmed : r.detail || trimmed,
      icon: KIND_ICONS[r.kind] ?? '🧮',
      style: 'large',
      priority: 'top',
      actionPayload: { copyValue: r.value.replace(/^≈ /, '') },
    }));
  }
  async executeSearchResult(_id: string, payload?: unknown): Promise<void> {
    const copyValue = (payload as { copyValue?: unknown } | undefined)?.copyValue;
    if (typeof copyValue !== 'string') return;
    try {
      await writeText(copyValue);
      this.feedbackService?.sendBackground({ title: 'Calculator', body: `Copied: ${copyValue}` });
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
});
export default extension;
