import { describe, it, expect, beforeEach } from 'vitest'

// whatsNewStore uses a class with a $state field — supported by the Svelte 5
// compiler in the Vitest transform pipeline (same pattern as appUpdateStore).

import { whatsNewStore } from './whatsNewStore.svelte'

describe('whatsNewStore', () => {
  beforeEach(() => {
    whatsNewStore.version = null
  })

  it('starts with version null', () => {
    expect(whatsNewStore.version).toBeNull()
  })

  it('stores a version when set', () => {
    whatsNewStore.version = '1.2.3'
    expect(whatsNewStore.version).toBe('1.2.3')
  })

  it('clears version when set to null', () => {
    whatsNewStore.version = '1.0.0'
    whatsNewStore.version = null
    expect(whatsNewStore.version).toBeNull()
  })
})
