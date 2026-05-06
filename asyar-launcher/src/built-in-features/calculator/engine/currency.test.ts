import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../../services/log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { evaluateCurrencyExpression, refreshRates } from './currency'

function makeFetchStub(rates: Record<string, number>) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ rates }),
  })
}

const STUB_RATES: Record<string, number> = {
  USD: 1,
  EUR: 0.85,
  GBP: 0.73,
  IQD: 1309.0,
}

beforeEach(async () => {
  vi.stubGlobal('fetch', makeFetchStub(STUB_RATES))
  await refreshRates()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('evaluateCurrencyExpression — explicit target (baseline)', () => {
  it('currency_explicit_target_still_works', async () => {
    const result = await evaluateCurrencyExpression('100 usd to eur')
    expect(result).not.toBeNull()
    expect(result).toContain('EUR')
  })
})

describe('evaluateCurrencyExpression — implicit target from locale', () => {
  it('currency_implicit_target_uses_locale_iq', async () => {
    vi.stubGlobal('navigator', { language: 'ar-IQ' })
    const result = await evaluateCurrencyExpression('100 eur')
    expect(result).not.toBeNull()
    expect(result).toContain('IQD')
  })

  it('currency_implicit_target_uses_locale_us', async () => {
    vi.stubGlobal('navigator', { language: 'en-US' })
    const result = await evaluateCurrencyExpression('100 eur')
    expect(result).not.toBeNull()
    expect(result).toContain('USD')
  })

  it('currency_implicit_target_skips_when_source_equals_locale_currency', async () => {
    vi.stubGlobal('navigator', { language: 'en-US' })
    const result = await evaluateCurrencyExpression('100 usd')
    expect(result).toBeNull()
  })

  it('currency_implicit_target_falls_back_to_usd_for_unknown_region', async () => {
    vi.stubGlobal('navigator', { language: 'xx-ZZ' })
    const result = await evaluateCurrencyExpression('100 eur')
    expect(result).not.toBeNull()
    expect(result).toContain('USD')
  })

  it('currency_unknown_source_code_still_returns_null', async () => {
    vi.stubGlobal('navigator', { language: 'en-US' })
    const result = await evaluateCurrencyExpression('100 xyz')
    expect(result).toBeNull()
  })
})
