import { describe, it, expect } from 'vitest'
import { NAMESPACES } from './namespaces'

describe('NAMESPACES', () => {
  it('contains every current canonical namespace', () => {
    expect(NAMESPACES).toEqual([
      'log', 'extensions', 'notifications', 'clipboard', 'commands',
      'actions', 'settings', 'preferences', 'statusBar', 'entitlements',
      'network', 'storage', 'cache', 'feedback', 'selection', 'ai',
      'oauth', 'opener', 'power', 'shell', 'systemEvents', 'appEvents',
      'applicationIndex', 'fs', 'interop', 'application', 'window', 'timers',
      'fsWatcher', 'state',
    ])
  })

  it('has no duplicates', () => {
    expect(new Set(NAMESPACES).size).toBe(NAMESPACES.length)
  })

  it('uses only lowercase-start identifiers (camelCase allowed)', () => {
    const invalid = NAMESPACES.filter(n => !/^[a-z][a-zA-Z0-9]*$/.test(n))
    expect(invalid).toEqual([])
  })
})
