import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('tauri-plugin-clipboard-x-api', () => ({ writeText: vi.fn() }));
vi.mock('../../lib/ipc/invokeSafe', () => ({ invokeSafe: vi.fn() }));

import calculator from './index';
import { invokeSafe } from '../../lib/ipc/invokeSafe';
import { writeText } from 'tauri-plugin-clipboard-x-api';
import type { CalcResult } from '../../bindings';

const feedbackService = { sendBackground: vi.fn() };
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
    expect(await calculator.search('   ')).toEqual([]);
    expect(invokeSafe).not.toHaveBeenCalled();
  });

  it('maps Rust CalcResults to ExtensionResults', async () => {
    const rust: CalcResult[] = [{ value: '4', detail: '2+2', kind: 'math' }];
    vi.mocked(invokeSafe).mockResolvedValueOnce(rust);

    const results = await calculator.search('2+2');

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

    const results = await calculator.search('whatever');
    expect(results[0].icon).toBe('🕒');
    expect(results[1].icon).toBe('🎨');
  });

  it('returns [] when the invoke fails (null sentinel)', async () => {
    vi.mocked(invokeSafe).mockResolvedValueOnce(null);
    expect(await calculator.search('2+2')).toEqual([]);
  });

  it('initialize pushes preferences to Rust', async () => {
    await calculator.initialize(makeContext({ refreshInterval: 12, preferredCurrency: 'iqd' }));
    expect(invokeSafe).toHaveBeenCalledWith(
      'calculator_configure',
      { ttlHours: 12, preferredCurrency: 'iqd' },
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

    const [result] = await calculator.search('100 km to miles');
    await result.action?.();

    expect(writeText).toHaveBeenCalledWith('62.14 miles');
    expect(feedbackService.sendBackground).toHaveBeenCalled();
  });
});
