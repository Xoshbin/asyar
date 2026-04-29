import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../services/onboarding/onboardingService.svelte', () => ({
  onboardingService: {
    advance: vi.fn(),
    goBack: vi.fn(),
    complete: vi.fn(),
  },
}))

vi.mock('../../built-in-features/store/storeFetch', () => ({
  fetchAllStoreItems: vi.fn(),
}))

import { advanceStep, goBackStep, completeStep, fetchTopThemes, fetchTopExtensions } from './stepLogic'
import { onboardingService } from '../../services/onboarding/onboardingService.svelte'
import { fetchAllStoreItems } from '../../built-in-features/store/storeFetch'

describe('stepLogic', () => {
  beforeEach(() => vi.clearAllMocks())

  it('advanceStep delegates to onboardingService.advance', async () => {
    await advanceStep()
    expect(onboardingService.advance).toHaveBeenCalledOnce()
  })

  it('goBackStep delegates to onboardingService.goBack', async () => {
    await goBackStep()
    expect(onboardingService.goBack).toHaveBeenCalledOnce()
  })

  it('completeStep delegates to onboardingService.complete', async () => {
    await completeStep()
    expect(onboardingService.complete).toHaveBeenCalledOnce()
  })
})

describe('fetchTopThemes', () => {
  beforeEach(() => vi.clearAllMocks())

  it('keeps only items with category=theme and sorts by install_count desc', async () => {
    vi.mocked(fetchAllStoreItems).mockResolvedValueOnce([
      { id: 1, name: 'A', category: 'theme', install_count: 5 } as any,
      { id: 2, name: 'B', category: 'utility', install_count: 99 } as any,
      { id: 3, name: 'C', category: 'Theme', install_count: 100 } as any,
      { id: 4, name: 'D', category: 'theme', install_count: 50 } as any,
    ])
    const out = await fetchTopThemes(2)
    expect(out.map((t) => t.id)).toEqual([3, 4])
  })

  it('returns empty array on fetch error', async () => {
    vi.mocked(fetchAllStoreItems).mockRejectedValueOnce(new Error('net'))
    const out = await fetchTopThemes(5)
    expect(out).toEqual([])
  })
})

describe('fetchTopExtensions', () => {
  beforeEach(() => vi.clearAllMocks())

  it('keeps non-theme items, filters by platform, sorts by install_count desc', async () => {
    vi.mocked(fetchAllStoreItems).mockResolvedValueOnce([
      { id: 1, name: 'A', category: 'utility', install_count: 10, manifest: { platforms: ['macos'] } } as any,
      { id: 2, name: 'B', category: 'theme', install_count: 99 } as any,
      { id: 3, name: 'C', category: 'utility', install_count: 100, manifest: { platforms: ['linux'] } } as any,
      { id: 4, name: 'D', category: 'productivity', install_count: 50 } as any,
    ])
    const out = await fetchTopExtensions(5, 'macos')
    expect(out.map((e) => e.id)).toEqual([4, 1])
  })

  it('returns empty array on fetch error', async () => {
    vi.mocked(fetchAllStoreItems).mockRejectedValueOnce(new Error('net'))
    const out = await fetchTopExtensions(5, 'macos')
    expect(out).toEqual([])
  })
})
