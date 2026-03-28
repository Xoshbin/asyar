import { describe, it, expect } from 'vitest'
import { isHtml } from './isHtml'

describe('isHtml', () => {
  it('returns true for a bare tag', () => {
    expect(isHtml('<div>')).toBe(true)
  })

  it('returns true for a tag with attributes', () => {
    expect(isHtml('<p class="foo">text</p>')).toBe(true)
  })

  it('returns true for a self-closing tag without space', () => {
    expect(isHtml('<br/>')).toBe(true)
  })

  it('returns true for a self-closing tag with space', () => {
    expect(isHtml('<br />')).toBe(true)
  })

  it('returns true for an img tag', () => {
    expect(isHtml('<img src="x" />')).toBe(true)
  })

  it('returns true for a script tag', () => {
    expect(isHtml('<script>')).toBe(true)
  })

  it('returns false for plain text', () => {
    expect(isHtml('hello world')).toBe(false)
  })

  it('returns false for a less-than comparison (no closing angle bracket)', () => {
    expect(isHtml('1 < 2')).toBe(false)
  })

  it('returns false for an empty string', () => {
    expect(isHtml('')).toBe(false)
  })

  it('returns false for an empty angle-bracket pair', () => {
    expect(isHtml('<>')).toBe(false)
  })

  it('returns false for a tag whose name starts with digits', () => {
    expect(isHtml('<123>')).toBe(false)
  })

  it('returns false for null', () => {
    expect(isHtml(null)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isHtml(undefined)).toBe(false)
  })

  it('returns false for a number', () => {
    expect(isHtml(42)).toBe(false)
  })
})
