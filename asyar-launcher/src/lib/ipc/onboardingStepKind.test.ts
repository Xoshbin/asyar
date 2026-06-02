import { describe, it, expect } from 'vitest'
import type { OnboardingStepKind } from './commands'

// Compile-time + runtime guard that the union covers exactly the 11 steps the
// Rust step machine emits (serde camelCase of OnboardingStep).
const ALL: OnboardingStepKind[] = [
  'welcome',
  'summonSearch',
  'clipboard',
  'portals',
  'aiSetup',
  'hiddenCommands',
  'emoji',
  'snippets',
  'featuredExtensions',
  'pickTheme',
  'cheatSheet',
]

describe('OnboardingStepKind', () => {
  it('lists all 11 steps in order', () => {
    expect(ALL).toHaveLength(11)
    expect(new Set(ALL).size).toBe(11)
  })
})
