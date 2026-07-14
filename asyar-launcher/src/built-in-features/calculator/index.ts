import type {
  Extension,
  ExtensionContext,
  ExtensionResult,
  ILogService,
  IFeedbackService,
} from 'asyar-sdk/contracts';
import { writeText } from 'tauri-plugin-clipboard-x-api';

import { invokeSafe } from '../../lib/ipc/invokeSafe';
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

class CalculatorExtension implements Extension {
  private logService?: ILogService;
  private feedbackService?: IFeedbackService;

  onUnload: any;

  async initialize(context: ExtensionContext): Promise<void> {
    this.logService = context.getService<ILogService>('log');
    this.feedbackService = context.getService<IFeedbackService>('feedback');

    // Forward preferences to Rust, which owns the exchange-rate cache,
    // its TTL policy, and the implicit-conversion target currency.
    const interval = context.preferences.values.refreshInterval;
    const preferred = context.preferences.values.preferredCurrency;
    const args: Record<string, unknown> = {};
    if (typeof interval === 'number' && Number.isFinite(interval)) {
      args.ttlHours = interval;
    }
    if (typeof preferred === 'string' && preferred.trim()) {
      args.preferredCurrency = preferred.trim();
    }
    if (Object.keys(args).length > 0) {
      await invokeSafe('calculator_configure', args, { silent: true });
    }
  }

  async executeCommand(_commandId: string, _args?: Record<string, any>): Promise<any> {
    return;
  }

  async activate(): Promise<void> {
    // Warm the exchange-rate cache; Rust refreshes lazily on stale reads.
    await invokeSafe('calculator_refresh_rates', undefined, { silent: true });
  }

  async deactivate(): Promise<void> {}

  async search(query: string): Promise<ExtensionResult[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const results =
      (await invokeSafe<CalcResult[]>(
        'calculator_evaluate',
        { query: trimmed },
        { silent: true },
      )) ?? [];

    return results.map((r) => ({
      score: 1.0,
      title: r.value,
      subtitle: r.detail || trimmed,
      type: 'result',
      icon: KIND_ICONS[r.kind] ?? '🧮',
      style: 'large',
      priority: 'top',
      action: async () => {
        const copyValue = r.value.replace(/^≈ /, '');
        try {
          await writeText(copyValue);
          this.feedbackService?.sendBackground({
            title: 'Calculator',
            body: `Copied: ${copyValue}`,
          });
        } catch (e) {
          this.logService?.error('Copy failed: ' + e);
        }
      },
    }));
  }
}

// Export singleton instance
const extension = new CalculatorExtension();
export default extension;
