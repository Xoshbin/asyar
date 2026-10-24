import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('tauri-plugin-clipboard-x-api', () => ({ writeText: vi.fn() }));
vi.mock('../../lib/ipc/invokeSafe', () => ({ invokeSafe: vi.fn() }));

import calculator from './index';
import { invokeSafe } from '../../lib/ipc/invokeSafe';
import { writeText } from 'tauri-plugin-clipboard-x-api';
import type { CalcResult } from '../../bindings';

const feedbackService = { showHUD: vi.fn() };
const logService = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function makeContext(prefs: Record<string, unknown> = {}) {
  return {
    getService: vi.fn((name: string) => (name === 'feedback' ? feedbackService : logService)),
    preferences: { values: prefs },
  } as any;
}

describe('calculator extension (thin presenter)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns [] for empty queries without invoking Rust', async () => {
    expect(await calculator.searchRows('   ')).toEqual([]);
    expect(invokeSafe).not.toHaveBeenCalled();
  });

  it('maps Rust CalcResults to ExtensionResults', async () => {
    const rust: CalcResult[] = [{ value: '4', detail: '2+2', kind: 'math' }];
    vi.mocked(invokeSafe).mockResolvedValueOnce(rust);

    const results = await calculator.searchRows('2+2');

    expect(invokeSafe).toHaveBeenCalledWith(
      'calculator_evaluate',
      { query: '2+2' },
      { silent: true },
    );
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('4');
    expect(results[0].subtitle).toBe('2+2');
    expect(results[0].priority).toBe('top');
    expect(results[0].style).toBe('large');
    expect(results[0].icon).toBe('🧮');
  });

  it('picks kind-specific icons', async () => {
    const rust: CalcResult[] = [
      { value: '21:00', detail: 'Asia/Tokyo', kind: 'time' },
      { value: 'rgb(255, 136, 0)', detail: '#FF8800', kind: 'color' },
    ];
    vi.mocked(invokeSafe).mockResolvedValueOnce(rust);

    const results = await calculator.searchRows('whatever');
    expect(results[0].icon).toBe('🕒');
    expect(results[1].icon).toBe('🎨');
  });

  it('color rows show the query as expression and carry HEX/RGB/HSL in their payload', async () => {
    const rust: CalcResult[] = [
      { value: 'rgb(17, 34, 51)', detail: '#112233 · hsl(210, 50%, 13%)', kind: 'color' },
    ];
    vi.mocked(invokeSafe).mockResolvedValueOnce(rust);

    const [result] = await calculator.searchRows('#112233');
    expect(result.subtitle).toBe('#112233');
    expect(result.actionPayload).toEqual({
      copyValue: 'rgb(17, 34, 51)',
      colorFormats: ['#112233', 'rgb(17, 34, 51)', 'hsl(210, 50%, 13%)'],
    });
  });

  it('a "to <format>" clause is not part of the color expression', async () => {
    vi.mocked(invokeSafe).mockResolvedValueOnce([
      { value: 'hsl(210, 50%, 13%)', detail: '#112233 · rgb(17, 34, 51)', kind: 'color' },
    ] satisfies CalcResult[]);

    const [result] = await calculator.searchRows('#112233 to hsl');
    expect(result.subtitle).toBe('#112233');
    expect((result.actionPayload as { colorFormats: string[] }).colorFormats).toEqual([
      '#112233',
      'rgb(17, 34, 51)',
      'hsl(210, 50%, 13%)',
    ]);
  });

  it('rowActions offers one copy action per color format and copies that exact value', async () => {
    vi.mocked(invokeSafe).mockResolvedValueOnce([
      { value: 'rgb(17, 34, 51)', detail: '#112233 · hsl(210, 50%, 13%)', kind: 'color' },
    ] satisfies CalcResult[]);
    const [row] = await calculator.searchRows('#112233');

    const actions = calculator.rowActions(row.id, row.actionPayload);
    expect(actions.map((a) => a.id)).toEqual([
      'calculator:copy-color-hex',
      'calculator:copy-color-rgb',
      'calculator:copy-color-hsl',
    ]);

    await actions[2].execute();
    expect(writeText).toHaveBeenCalledWith('hsl(210, 50%, 13%)');
  });

  it('rowActions is empty for non-color rows', async () => {
    vi.mocked(invokeSafe).mockResolvedValueOnce([
      { value: '4', detail: '2+2', kind: 'math' },
    ] satisfies CalcResult[]);
    const [row] = await calculator.searchRows('2+2');
    expect(calculator.rowActions(row.id, row.actionPayload)).toEqual([]);
  });

  it('explicitly treats evaluation failure as best-effort empty results', async () => {
    vi.mocked(invokeSafe).mockRejectedValueOnce(new Error('calculator unavailable'));
    expect(await calculator.searchRows('2+2')).toEqual([]);
  });

  it('initialize pushes preferences to Rust', async () => {
    await calculator.initialize(
      makeContext({ refreshInterval: 12, preferredCurrency: 'iqd', numberFormat: 'comma' }),
    );
    expect(invokeSafe).toHaveBeenCalledWith(
      'calculator_configure',
      { ttlHours: 12, preferredCurrency: 'iqd', numberFormat: 'comma' },
      { silent: true },
    );
  });

  it('initialize forwards a return to the automatic number format', async () => {
    // Rust reads "auto" as "follow the host locale", so switching back
    // has to reach it — skipping it would strand the old override.
    await calculator.initialize(makeContext({ numberFormat: 'auto' }));
    expect(invokeSafe).toHaveBeenCalledWith(
      'calculator_configure',
      { numberFormat: 'auto' },
      { silent: true },
    );
  });

  it('initialize skips configure when no preferences are set', async () => {
    await calculator.initialize(makeContext({}));
    expect(invokeSafe).not.toHaveBeenCalledWith(
      'calculator_configure',
      expect.anything(),
      expect.anything(),
    );
  });

  it('activate warms the exchange-rate cache', async () => {
    await calculator.activate();
    expect(invokeSafe).toHaveBeenCalledWith('calculator_refresh_rates', undefined, {
      silent: true,
    });
  });

  it('copy action writes the value without the approx marker', async () => {
    await calculator.initialize(makeContext({}));
    vi.clearAllMocks();
    const rust: CalcResult[] = [{ value: '≈ 62.14 miles', detail: '100 km', kind: 'unit' }];
    vi.mocked(invokeSafe).mockResolvedValueOnce(rust);

    const [result] = await calculator.searchRows('100 km to miles');
    await calculator.executeSearchResult(result.id, result.actionPayload);

    expect(writeText).toHaveBeenCalledWith('62.14 miles');
    expect(feedbackService.showHUD).toHaveBeenCalledWith('Copied: 62.14 miles');
  });

  it('search returns empty when deactivated and resumes when reactivated', async () => {
    const rust: CalcResult[] = [{ value: '4', detail: '2+2', kind: 'math' }];
    vi.mocked(invokeSafe).mockResolvedValue(rust);

    await calculator.deactivate();
    expect(await calculator.searchRows('2+2')).toEqual([]);

    await calculator.activate();
    const results = await calculator.searchRows('2+2');
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('4');
  });

  it('rows label the Enter action as a copy', async () => {
    vi.mocked(invokeSafe).mockResolvedValueOnce([
      { value: '4', detail: '2+2', kind: 'math' },
    ] satisfies CalcResult[]);
    const [row] = await calculator.searchRows('2+2');
    expect(row.primaryActionLabel).toBe('Copy');
  });
});

it('registers calculator as a typed platform search provider', async () => {
  const { searchBuiltinProviders } = await import('../../services/search/builtinSearchProviders');
  const search = vi.spyOn(calculator, 'searchRows').mockResolvedValueOnce([]);
  const rows = await searchBuiltinProviders('2+2', (id) => id === 'calculator');
  expect(search).toHaveBeenCalled();
  search.mockRestore();
  expect(rows.every((row) => typeof (row as any).action !== 'function')).toBe(true);
});
