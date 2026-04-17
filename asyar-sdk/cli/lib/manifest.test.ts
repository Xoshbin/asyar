import { describe, it, expect, vi } from 'vitest'
import { validateManifest, AsyarManifest } from './manifest'
import * as fs from 'node:fs'

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  readFileSync: vi.fn(),
}))

describe('manifest validation', () => {
  const baseManifest: AsyarManifest = {
    id: 'com.test.ext',
    name: 'Test Extension',
    version: '1.0.0',
    description: 'A test extension description that is long enough.',
    author: 'Test Author',
    commands: [
      {
        id: 'cmd1',
        name: 'Command 1',
        description: 'Description 1',
        resultType: 'no-view'
      }
    ],
    type: 'result'
  }

  it('rejects intervalSeconds below minimum', () => {
    const manifest = {
      ...baseManifest,
      commands: [
        {
          ...baseManifest.commands[0],
          schedule: { intervalSeconds: 9 }
        }
      ]
    }
    const errors = validateManifest(manifest as any, './')
    expect(errors.some(e => e.message.includes('Minimum schedule interval is 10 seconds'))).toBe(true)
  })

  it('accepts intervalSeconds at new 10s floor', () => {
    const manifest = {
      ...baseManifest,
      commands: [
        {
          ...baseManifest.commands[0],
          schedule: { intervalSeconds: 10 }
        }
      ]
    }
    const errors = validateManifest(manifest as any, './')
    const scheduleErrors = errors.filter(e => e.field.includes('schedule'))
    expect(scheduleErrors).toHaveLength(0)
  })

  it('rejects intervalSeconds above maximum', () => {
    const manifest = {
      ...baseManifest,
      commands: [
        {
          ...baseManifest.commands[0],
          schedule: { intervalSeconds: 100000 }
        }
      ]
    }
    const errors = validateManifest(manifest as any, './')
    expect(errors.some(e => e.message.includes('Maximum schedule interval is 86400 seconds'))).toBe(true)
  })

  it('rejects schedule on view command', () => {
    const manifest = {
      ...baseManifest,
      commands: [
        {
          ...baseManifest.commands[0],
          resultType: 'view',
          schedule: { intervalSeconds: 300 }
        }
      ]
    }
    const errors = validateManifest(manifest as any, './')
    expect(errors.some(e => e.message.includes('Scheduled commands must have resultType "no-view"'))).toBe(true)
  })

  it('accepts valid schedule', () => {
    const manifest = {
      ...baseManifest,
      commands: [
        {
          ...baseManifest.commands[0],
          schedule: { intervalSeconds: 300 }
        }
      ]
    }
    const errors = validateManifest(manifest as any, './')
    const scheduleErrors = errors.filter(e => e.field.includes('schedule'))
    expect(scheduleErrors).toHaveLength(0)
  })

  it('passes commands without schedule (no regression)', () => {
    const errors = validateManifest(baseManifest, './')
    expect(errors).toHaveLength(0)
  })
})
