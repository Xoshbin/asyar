import { describe, it, expect } from 'vitest'

import { evaluateMath } from './math'

describe('evaluateMath — baseline', () => {
  it('evaluateMath_returns_value_for_complete_expression', () => {
    expect(evaluateMath('7+8')).toBe('15')
  })

  it('evaluateMath_handles_existing_complete_paren_expression', () => {
    expect(evaluateMath('(2+3)*4')).toBe('20')
  })
})

describe('evaluateMath — tolerant (trailing operators)', () => {
  it('evaluateMath_strips_trailing_plus', () => {
    expect(evaluateMath('7+')).toBe('7')
  })

  it('evaluateMath_strips_trailing_times', () => {
    expect(evaluateMath('7+8*')).toBe('15')
  })

  it('evaluateMath_strips_trailing_open_paren', () => {
    expect(evaluateMath('7+8*(')).toBe('15')
  })

  it('evaluateMath_strips_multiple_trailing_operators', () => {
    expect(evaluateMath('5+3-')).toBe('8')
  })
})

describe('evaluateMath — null cases', () => {
  it('evaluateMath_returns_null_for_pure_text', () => {
    expect(evaluateMath('abc')).toBeNull()
  })

  it('evaluateMath_returns_null_for_only_operators', () => {
    expect(evaluateMath('++')).toBeNull()
  })

  it('evaluateMath_returns_null_for_empty', () => {
    expect(evaluateMath('')).toBeNull()
  })
})
