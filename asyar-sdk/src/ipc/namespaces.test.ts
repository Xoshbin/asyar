import { describe, it, expect } from 'vitest'
import { NAMESPACES } from './namespaces'

describe('NAMESPACES', () => {
  it('contains every current canonical namespace', () => {
    expect(NAMESPACES).toEqual([
      'log', 'extensions', 'notifications', 'clipboard', 'commands',
      'actions', 'settings', 'preferences', 'searchBar', 'statusBar', 'entitlements',
      'network', 'storage', 'cache', 'feedback', 'diagnostics', 'selection', 'ai',
      'oauth', 'opener', 'power', 'process', 'shell', 'systemEvents', 'appEvents',
      'applicationIndex', 'fs', 'interop', 'application', 'window', 'timers',
      'fsWatcher', 'state', 'onboarding', 'runs', 'tools', 'snippets',
      'browser', 'search',
    ])
  })

  it('has no duplicates', () => {
    expect(new Set(NAMESPACES).size).toBe(NAMESPACES.length)
  })

  it('uses only lowercase-start identifiers (camelCase allowed)', () => {
    const invalid = NAMESPACES.filter(n => !/^[a-z][a-zA-Z0-9]*$/.test(n))
    expect(invalid).toEqual([])
  })

  it('includes onboarding', () => {
    expect(NAMESPACES).toContain('onboarding')
  })

  it('includes browser', () => {
    expect(NAMESPACES).toContain('browser');
  })

  it('includes search', () => {
    expect(NAMESPACES).toContain('search');
  })
})
