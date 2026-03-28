import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { get } from 'svelte/store'

vi.mock('../log/logService', () => ({
  logService: {
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(),
    error: vi.fn(), custom: vi.fn(), success: vi.fn(),
  },
}))

import { performanceService, extensionPerformance, appPerformance } from './performanceService'

const svc = performanceService as any

function resetStores() {
  extensionPerformance.set({})
  appPerformance.set({ startupTime: 0, totalMemoryUsage: 0, extensionLoadCount: 0, maxMemoryUsage: 0, startTimestamp: Date.now() })
  svc.loadingStartTimes.clear()
  svc.executionStartTimes.clear()
  svc.lazyLoadingViolations.clear()
  svc.initialized = false
}

// ── formatMemory ──────────────────────────────────────────────────────────────

describe('formatMemory', () => {
  it('returns "N/A" for zero bytes', () => {
    expect(svc.formatMemory(0)).toBe('N/A')
  })

  it('formats values under 1 KB as Bytes', () => {
    expect(svc.formatMemory(512)).toBe('512.00 Bytes')
  })

  it('formats values just over 1 KB as KB', () => {
    expect(svc.formatMemory(1025)).toMatch(/KB$/)
  })

  it('formats values just over 1 MB as MB', () => {
    // 1 MB + 1 byte triggers the second division
    expect(svc.formatMemory(1048577)).toMatch(/MB$/)
  })

  it('formats values just over 1 GB as GB', () => {
    expect(svc.formatMemory(1073741825)).toMatch(/GB$/)
  })

  it('returns a two-decimal string', () => {
    const result = svc.formatMemory(1500)
    expect(result).toMatch(/^\d+\.\d{2} /)
  })
})

// ── formatTime ────────────────────────────────────────────────────────────────

describe('formatTime', () => {
  it('formats 0 ms as 0.0s', () => {
    expect(svc.formatTime(0)).toBe('0.0s')
  })

  it('formats values under 60 s with one decimal and "s" suffix', () => {
    expect(svc.formatTime(30000)).toBe('30.0s')
    expect(svc.formatTime(1500)).toBe('1.5s')
  })

  it('formats exactly 60 s as "1m 0s"', () => {
    expect(svc.formatTime(60000)).toBe('1m 0s')
  })

  it('formats 90 s as "1m 30s"', () => {
    expect(svc.formatTime(90000)).toBe('1m 30s')
  })

  it('formats exactly 60 minutes as "1h 0m"', () => {
    expect(svc.formatTime(3600000)).toBe('1h 0m')
  })

  it('formats 90 minutes as "1h 30m"', () => {
    expect(svc.formatTime(5400000)).toBe('1h 30m')
  })
})

// ── startTiming / stopTiming ──────────────────────────────────────────────────

describe('startTiming / stopTiming', () => {
  beforeEach(() => {
    resetStores()
    vi.stubGlobal('window', { performance: {} })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('stopTiming returns a positive duration', async () => {
    svc.startTiming('op1')
    await new Promise(r => setTimeout(r, 5))
    const result = svc.stopTiming('op1')
    expect(result.duration).toBeGreaterThan(0)
  })

  it('stopTiming removes the operation from activeOperations', () => {
    svc.startTiming('op2')
    svc.stopTiming('op2')
    // A second stop should return duration 0 (not found)
    const second = svc.stopTiming('op2')
    expect(second.duration).toBe(0)
  })

  it('stopTiming for an unknown operation returns duration 0', () => {
    const result = svc.stopTiming('nonexistent')
    expect(result.duration).toBe(0)
  })

  it('stopTiming result includes start and end times', () => {
    svc.startTiming('op3')
    const result = svc.stopTiming('op3')
    expect(result.startTime).toBeDefined()
    expect(result.endTime).toBeDefined()
    expect(result.endTime).toBeGreaterThanOrEqual(result.startTime)
  })
})

// ── trackExtensionLoadStart / trackExtensionLoadEnd ───────────────────────────

describe('extension load tracking', () => {
  beforeEach(resetStores)

  it('trackExtensionLoadEnd increments loadCount', () => {
    svc.trackExtensionLoadStart('ext-a', true)
    svc.trackExtensionLoadEnd('ext-a')
    expect(get(extensionPerformance)['ext-a'].loadCount).toBe(1)
  })

  it('loadCount accumulates across multiple loads', () => {
    svc.trackExtensionLoadStart('ext-b', true)
    svc.trackExtensionLoadEnd('ext-b')
    svc.trackExtensionLoadStart('ext-b', true)
    svc.trackExtensionLoadEnd('ext-b')
    expect(get(extensionPerformance)['ext-b'].loadCount).toBe(2)
  })

  it('averageLoadTime is computed from all recorded load times', () => {
    svc.trackExtensionLoadStart('ext-c', true)
    svc.trackExtensionLoadEnd('ext-c')
    svc.trackExtensionLoadStart('ext-c', true)
    svc.trackExtensionLoadEnd('ext-c')
    const data = get(extensionPerformance)['ext-c']
    expect(data.loadTimes).toHaveLength(2)
    const expectedAvg = data.loadTimes.reduce((s: number, t: number) => s + t, 0) / 2
    expect(data.averageLoadTime).toBeCloseTo(expectedAvg, 5)
  })

  it('sets isCurrentlyLoaded to true after load end', () => {
    svc.trackExtensionLoadStart('ext-d', true)
    svc.trackExtensionLoadEnd('ext-d')
    expect(get(extensionPerformance)['ext-d'].isCurrentlyLoaded).toBe(true)
  })

  it('increments appPerformance.extensionLoadCount', () => {
    const before = get(appPerformance).extensionLoadCount
    svc.trackExtensionLoadStart('ext-e', true)
    svc.trackExtensionLoadEnd('ext-e')
    expect(get(appPerformance).extensionLoadCount).toBe(before + 1)
  })

  it('marks loadedWithoutUserAction when not user-initiated', () => {
    svc.trackExtensionLoadStart('ext-f', false)
    expect(get(extensionPerformance)['ext-f'].loadedWithoutUserAction).toBe(true)
  })

  it('trackExtensionLoadEnd is a no-op when load start was not recorded', () => {
    expect(() => svc.trackExtensionLoadEnd('unknown-ext')).not.toThrow()
  })
})

// ── trackExtensionUnload ──────────────────────────────────────────────────────

describe('trackExtensionUnload', () => {
  beforeEach(resetStores)

  it('increments unloadCount and clears isCurrentlyLoaded', () => {
    svc.trackExtensionLoadStart('ext-u', true)
    svc.trackExtensionLoadEnd('ext-u')
    svc.trackExtensionUnload('ext-u')
    const data = get(extensionPerformance)['ext-u']
    expect(data.unloadCount).toBe(1)
    expect(data.isCurrentlyLoaded).toBe(false)
  })

  it('is a no-op for an extension that was never loaded', () => {
    expect(() => svc.trackExtensionUnload('never-loaded')).not.toThrow()
  })
})

// ── trackMethodExecution ──────────────────────────────────────────────────────

describe('trackMethodExecution', () => {
  beforeEach(resetStores)

  it('records execution time in methodExecutionTimes', async () => {
    svc.trackExtensionLoadStart('ext-m', true)
    svc.trackExtensionLoadEnd('ext-m')
    svc.trackMethodExecutionStart('ext-m', 'run')
    await new Promise(r => setTimeout(r, 5))
    svc.trackMethodExecutionEnd('ext-m', 'run')
    const times = get(extensionPerformance)['ext-m'].methodExecutionTimes['run']
    expect(times).toHaveLength(1)
    expect(times[0]).toBeGreaterThan(0)
  })

  it('accumulates multiple executions for the same method', () => {
    svc.trackExtensionLoadStart('ext-n', true)
    svc.trackExtensionLoadEnd('ext-n')
    svc.trackMethodExecutionStart('ext-n', 'run')
    svc.trackMethodExecutionEnd('ext-n', 'run')
    svc.trackMethodExecutionStart('ext-n', 'run')
    svc.trackMethodExecutionEnd('ext-n', 'run')
    expect(get(extensionPerformance)['ext-n'].methodExecutionTimes['run']).toHaveLength(2)
  })

  it('trackMethodExecutionEnd is a no-op when start was not recorded', () => {
    expect(() => svc.trackMethodExecutionEnd('ext-o', 'run')).not.toThrow()
  })
})
