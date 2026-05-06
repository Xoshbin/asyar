import { describe, it, expect } from 'vitest'

import { evaluateUnitExpression } from './units'

describe('evaluateUnitExpression — explicit target (baseline)', () => {
  it('units_explicit_target_still_works', () => {
    const result = evaluateUnitExpression('100 km to miles')
    expect(result).not.toBeNull()
    expect(result).toContain('miles')
  })
})

describe('evaluateUnitExpression — implicit target (metric ↔ imperial toggle)', () => {
  it('units_implicit_target_metric_to_imperial_km', () => {
    const result = evaluateUnitExpression('100 km')
    expect(result).not.toBeNull()
    expect(result).toContain('miles')
    const value = parseFloat(result!)
    expect(value).toBeCloseTo(62.14, 1)
  })

  it('units_implicit_target_imperial_to_metric_miles', () => {
    const result = evaluateUnitExpression('100 mi')
    expect(result).not.toBeNull()
    const lower = result!.toLowerCase()
    expect(lower.includes('km') || lower.includes('kilometer')).toBe(true)
    const value = parseFloat(result!)
    expect(value).toBeCloseTo(160.93, 1)
  })

  it('units_returns_null_for_unknown_unit', () => {
    expect(evaluateUnitExpression('100 zzz')).toBeNull()
  })

  it('units_temperature_celsius_to_fahrenheit', () => {
    const result = evaluateUnitExpression('100 c')
    expect(result).not.toBeNull()
    const lower = result!.toLowerCase()
    expect(lower.includes('fahrenheit') || lower.includes('°f') || lower.includes('f')).toBe(true)
    const value = parseFloat(result!)
    expect(value).toBeCloseTo(212, 0)
  })

  it('units_temperature_fahrenheit_to_celsius', () => {
    const result = evaluateUnitExpression('100 f')
    expect(result).not.toBeNull()
    const lower = result!.toLowerCase()
    expect(lower.includes('celsius') || lower.includes('°c') || lower.includes('c')).toBe(true)
    const value = parseFloat(result!)
    expect(value).toBeCloseTo(37.78, 1)
  })
})
