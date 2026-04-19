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

describe('manifest validation — command arguments', () => {
  const base = (args: any): AsyarManifest => ({
    id: 'com.test.ext',
    name: 'Test Extension',
    version: '1.0.0',
    description: 'A test extension description that is long enough.',
    author: 'Test Author',
    type: 'result',
    commands: [
      {
        id: 'cmd1',
        name: 'Command 1',
        description: 'Description 1',
        resultType: 'no-view',
        arguments: args,
      } as any,
    ],
  })

  it('accepts a single valid text argument', () => {
    const m = base([{ name: 'query', type: 'text', placeholder: 'Search', required: true }])
    const errors = validateManifest(m, './')
    const argErrors = errors.filter((e) => e.field.includes('arguments'))
    expect(argErrors).toHaveLength(0)
  })

  it('accepts all four argument types', () => {
    const m = base([
      { name: 'q', type: 'text', placeholder: 'q', required: true },
      { name: 'n', type: 'number', placeholder: 'n' },
      { name: 'p', type: 'password', placeholder: 'p' },
    ])
    const errors = validateManifest(m, './')
    const argErrors = errors.filter((e) => e.field.includes('arguments'))
    expect(argErrors).toHaveLength(0)
  })

  it('accepts dropdown with data options', () => {
    const m = base([
      {
        name: 'lang',
        type: 'dropdown',
        placeholder: 'Language',
        data: [
          { value: 'en', title: 'English' },
          { value: 'es', title: 'Spanish' },
        ],
      },
    ])
    const errors = validateManifest(m, './')
    const argErrors = errors.filter((e) => e.field.includes('arguments'))
    expect(argErrors).toHaveLength(0)
  })

  it('rejects more than 3 arguments per command', () => {
    const m = base([
      { name: 'a', type: 'text' },
      { name: 'b', type: 'text' },
      { name: 'c', type: 'text' },
      { name: 'd', type: 'text' },
    ])
    const errors = validateManifest(m, './')
    expect(errors.some((e) => e.message.includes('at most 3'))).toBe(true)
  })

  it('rejects duplicate argument names within a command', () => {
    const m = base([
      { name: 'q', type: 'text' },
      { name: 'q', type: 'number' },
    ])
    const errors = validateManifest(m, './')
    expect(errors.some((e) => e.message.toLowerCase().includes('duplicate'))).toBe(true)
  })

  it('rejects invalid argument name characters', () => {
    const m = base([{ name: '1bad-name', type: 'text' }])
    const errors = validateManifest(m, './')
    expect(errors.some((e) => e.field.includes('arguments[0].name'))).toBe(true)
  })

  it('rejects unknown argument type', () => {
    const m = base([{ name: 'x', type: 'checkbox' as any }])
    const errors = validateManifest(m, './')
    expect(errors.some((e) => e.field.includes('arguments[0].type'))).toBe(true)
  })

  it('rejects dropdown with missing data[]', () => {
    const m = base([{ name: 'lang', type: 'dropdown' }])
    const errors = validateManifest(m, './')
    expect(errors.some((e) => e.field.includes('arguments[0].data'))).toBe(true)
  })

  it('rejects dropdown with empty data[]', () => {
    const m = base([{ name: 'lang', type: 'dropdown', data: [] }])
    const errors = validateManifest(m, './')
    expect(errors.some((e) => e.field.includes('arguments[0].data'))).toBe(true)
  })

  it('rejects dropdown option missing value or title', () => {
    const m = base([
      {
        name: 'lang',
        type: 'dropdown',
        data: [{ value: 'en' }, { title: 'Nope' }],
      },
    ])
    const errors = validateManifest(m, './')
    expect(errors.some((e) => e.field.includes('arguments[0].data[0]'))).toBe(true)
    expect(errors.some((e) => e.field.includes('arguments[0].data[1]'))).toBe(true)
  })

  it('rejects default not in dropdown data[]', () => {
    const m = base([
      {
        name: 'lang',
        type: 'dropdown',
        default: 'de',
        data: [
          { value: 'en', title: 'English' },
          { value: 'es', title: 'Spanish' },
        ],
      },
    ])
    const errors = validateManifest(m, './')
    expect(errors.some((e) => e.field.includes('arguments[0].default'))).toBe(true)
  })

  it('rejects number default that is not a number', () => {
    const m = base([{ name: 'n', type: 'number', default: 'not-a-number' as any }])
    const errors = validateManifest(m, './')
    expect(errors.some((e) => e.field.includes('arguments[0].default'))).toBe(true)
  })

  it('rejects text default that is not a string', () => {
    const m = base([{ name: 't', type: 'text', default: 42 as any }])
    const errors = validateManifest(m, './')
    expect(errors.some((e) => e.field.includes('arguments[0].default'))).toBe(true)
  })

  it('rejects required argument following optional argument', () => {
    const m = base([
      { name: 'a', type: 'text', required: false },
      { name: 'b', type: 'text', required: true },
    ])
    const errors = validateManifest(m, './')
    expect(
      errors.some((e) => e.message.toLowerCase().includes('required') && e.field.includes('arguments[1]'))
    ).toBe(true)
  })

  it('accepts required-then-optional ordering', () => {
    const m = base([
      { name: 'a', type: 'text', required: true },
      { name: 'b', type: 'text', required: false },
    ])
    const errors = validateManifest(m, './')
    const argErrors = errors.filter((e) => e.field.includes('arguments'))
    expect(argErrors).toHaveLength(0)
  })

  it('passes commands without arguments (no regression)', () => {
    const m: AsyarManifest = {
      id: 'com.test.ext',
      name: 'Test Extension',
      version: '1.0.0',
      description: 'A test extension description that is long enough.',
      author: 'Test Author',
      type: 'result',
      commands: [
        {
          id: 'cmd1',
          name: 'Command 1',
          description: 'Description 1',
          resultType: 'no-view',
        },
      ],
    }
    const errors = validateManifest(m, './')
    expect(errors).toHaveLength(0)
  })
})
