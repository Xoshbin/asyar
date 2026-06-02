import { describe, it, expect, vi, beforeEach } from 'vitest'

const add = vi.hoisted(() => vi.fn())
const portals = vi.hoisted(() => vi.fn().mockReturnValue([]))
vi.mock('../../../built-in-features/portals/portalStore.svelte', () => ({
  portalStore: { add, get portals() { return portals() } },
}))

import { seedSamplePortal } from './portalsSetup'

describe('seedSamplePortal', () => {
  beforeEach(() => vi.clearAllMocks())
  it('adds a Search GitHub portal with a {query} placeholder', () => {
    seedSamplePortal()
    expect(add).toHaveBeenCalledTimes(1)
    const portal = add.mock.calls[0][0]
    expect(portal.name).toBe('Search GitHub')
    expect(portal.url).toContain('{query}')
  })
  it('does not add a duplicate when one already exists', () => {
    portals.mockReturnValueOnce([{ id: '1', name: 'Search GitHub', url: 'x{query}', icon: '', createdAt: 0 }])
    seedSamplePortal()
    expect(add).not.toHaveBeenCalled()
  })
})
