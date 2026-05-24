import { describe, it, expect, vi } from 'vitest'
import { validateManifest, type AsyarManifest } from './manifest'

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  readFileSync: vi.fn(),
}))

/**
 * Manifest corpus mirroring the real in-tree shapes (coffee, pomodoro,
 * sdk-playground) so a regression in the validator shows up as a failure
 * against the extensions we actually ship.
 */

const backgroundOnly: AsyarManifest = {
  id: 'org.asyar.test',
  name: 'Test Extension',
  version: '1.0.0',
  description: 'A test extension description that is long enough.',
  author: 'Test Author',
  type: 'extension',
  commands: [
    { id: 'do-thing', name: 'Do Thing', description: 'A background command', mode: 'background' },
  ],
  background: { main: 'dist/worker.js' },
}

const viewOnly: AsyarManifest = {
  id: 'org.asyar.test',
  name: 'Test Extension',
  version: '1.0.0',
  description: 'A test extension description that is long enough.',
  author: 'Test Author',
  type: 'extension',
  commands: [
    { id: 'open', name: 'Open', description: 'Open the view', mode: 'view', component: 'DefaultView' },
  ],
}

const dualMode: AsyarManifest = {
  id: 'org.asyar.test',
  name: 'Test Extension',
  version: '1.0.0',
  description: 'A test extension description that is long enough.',
  author: 'Test Author',
  type: 'extension',
  commands: [
    { id: 'run', name: 'Run', description: 'Headless command', mode: 'background' },
    { id: 'open', name: 'Open', description: 'Open view', mode: 'view', component: 'MainView' },
  ],
  background: { main: 'dist/worker.js' },
}

describe('manifest validation', () => {
  it('accepts a background-only extension with background.main', () => {
    const errors = validateManifest(backgroundOnly, './')
    expect(errors).toEqual([])
  })

  it('accepts a view-only extension without background.main', () => {
    const errors = validateManifest(viewOnly, './')
    expect(errors).toEqual([])
  })

  it('accepts a dual-mode extension', () => {
    const errors = validateManifest(dualMode, './')
    expect(errors).toEqual([])
  })

  it('requires mode on every command', () => {
    const manifest = {
      ...viewOnly,
      commands: [{ id: 'x', name: 'X', description: 'no mode' }],
    } as AsyarManifest
    const errors = validateManifest(manifest, './')
    expect(errors.some((e) => e.field === 'commands[0].mode')).toBe(true)
  })

  it('rejects an unknown mode value', () => {
    const manifest = {
      ...viewOnly,
      commands: [{ id: 'x', name: 'X', description: 'bad mode', mode: 'no-view' as unknown as 'view' }],
    } as AsyarManifest
    const errors = validateManifest(manifest, './')
    expect(errors.some((e) => e.field === 'commands[0].mode')).toBe(true)
  })

  it('requires component when mode is view', () => {
    const manifest: AsyarManifest = {
      ...viewOnly,
      commands: [{ id: 'open', name: 'Open', description: 'view without component', mode: 'view' }],
    }
    const errors = validateManifest(manifest, './')
    expect(errors.some((e) => e.field === 'commands[0].component')).toBe(true)
  })

  it('does not require component when mode is background', () => {
    const errors = validateManifest(backgroundOnly, './')
    expect(errors.filter((e) => e.field.includes('component'))).toHaveLength(0)
  })

  it('requires manifest.background.main when any command is mode=background', () => {
    const manifest: AsyarManifest = {
      ...backgroundOnly,
      background: undefined,
    }
    const errors = validateManifest(manifest, './')
    expect(errors.some((e) => e.field === 'background.main')).toBe(true)
  })

  it('requires manifest.background.main when searchable is true', () => {
    const manifest: AsyarManifest = {
      ...viewOnly,
      searchable: true,
    }
    const errors = validateManifest(manifest, './')
    expect(errors.some((e) => e.field === 'background.main')).toBe(true)
  })

  it('rejects the legacy resultType field', () => {
    const manifest = {
      ...viewOnly,
      commands: [
        { id: 'open', name: 'Open', description: 'view', resultType: 'view', component: 'DefaultView' },
      ],
    } as unknown as AsyarManifest
    const errors = validateManifest(manifest, './')
    expect(errors.some((e) => e.field === 'commands[0].resultType')).toBe(true)
  })

  it('rejects the legacy manifest.defaultView field', () => {
    const manifest = { ...viewOnly, defaultView: 'DefaultView' } as unknown as AsyarManifest
    const errors = validateManifest(manifest, './')
    expect(errors.some((e) => e.field === 'defaultView')).toBe(true)
  })

  it('rejects the legacy manifest.main field', () => {
    const manifest = { ...viewOnly, main: 'dist/index.js' } as unknown as AsyarManifest
    const errors = validateManifest(manifest, './')
    expect(errors.some((e) => e.field === 'main')).toBe(true)
  })

  it('rejects the legacy type values "view" and "result"', () => {
    const asView = { ...viewOnly, type: 'view' } as unknown as AsyarManifest
    const asResult = { ...viewOnly, type: 'result' } as unknown as AsyarManifest
    expect(validateManifest(asView, './').some((e) => e.field === 'type')).toBe(true)
    expect(validateManifest(asResult, './').some((e) => e.field === 'type')).toBe(true)
  })

  it('accepts theme type without commands', () => {
    const manifest = {
      id: 'org.asyar.mytheme',
      name: 'My Theme',
      version: '1.0.0',
      description: 'A theme with a long-enough description.',
      author: 'Test Author',
      type: 'theme',
      commands: [],
    } as AsyarManifest
    const errors = validateManifest(manifest, './')
    expect(errors).toEqual([])
  })
})

describe('manifest validation — schedule', () => {
  const scheduled = (intervalSeconds: number, mode: 'background' | 'view' = 'background'): AsyarManifest => ({
    ...backgroundOnly,
    commands: [
      {
        id: 'tick',
        name: 'Tick',
        description: 'Scheduled tick',
        mode,
        component: mode === 'view' ? 'TickView' : undefined,
        schedule: { intervalSeconds },
      },
    ],
  })

  it('rejects intervalSeconds below 10s floor', () => {
    const errors = validateManifest(scheduled(9), './')
    expect(errors.some((e) => e.message.includes('Minimum schedule interval is 10 seconds'))).toBe(true)
  })

  it('accepts intervalSeconds at the 10s floor', () => {
    const errors = validateManifest(scheduled(10), './')
    expect(errors.filter((e) => e.field.includes('schedule'))).toHaveLength(0)
  })

  it('rejects intervalSeconds above 86400s ceiling', () => {
    const errors = validateManifest(scheduled(100000), './')
    expect(errors.some((e) => e.message.includes('Maximum schedule interval is 86400 seconds'))).toBe(true)
  })

  it('rejects a scheduled command with mode=view', () => {
    const errors = validateManifest(scheduled(300, 'view'), './')
    expect(errors.some((e) => e.message.toLowerCase().includes('scheduled commands must have mode'))).toBe(true)
  })

  it('accepts a valid scheduled background command', () => {
    const errors = validateManifest(scheduled(300), './')
    expect(errors.filter((e) => e.field.includes('schedule'))).toHaveLength(0)
  })
})

describe('manifest validation — command arguments', () => {
  const base = (args: unknown): AsyarManifest => ({
    ...backgroundOnly,
    commands: [
      {
        id: 'do-thing',
        name: 'Do Thing',
        description: 'Takes arguments',
        mode: 'background',
        arguments: args as AsyarManifest['commands'][number]['arguments'],
      },
    ],
  })

  it('accepts a single valid text argument', () => {
    const m = base([{ name: 'query', type: 'text', placeholder: 'Search', required: true }])
    const errors = validateManifest(m, './')
    expect(errors.filter((e) => e.field.includes('arguments'))).toHaveLength(0)
  })

  it('accepts text / number / password argument types', () => {
    const m = base([
      { name: 'q', type: 'text', placeholder: 'q', required: true },
      { name: 'n', type: 'number', placeholder: 'n' },
      { name: 'p', type: 'password', placeholder: 'p' },
    ])
    const errors = validateManifest(m, './')
    expect(errors.filter((e) => e.field.includes('arguments'))).toHaveLength(0)
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
    expect(errors.filter((e) => e.field.includes('arguments'))).toHaveLength(0)
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

  it('rejects duplicate argument names', () => {
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
    const m = base([{ name: 'x', type: 'checkbox' }])
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
    const m = base([{ name: 'n', type: 'number', default: 'not-a-number' }])
    const errors = validateManifest(m, './')
    expect(errors.some((e) => e.field.includes('arguments[0].default'))).toBe(true)
  })

  it('rejects text default that is not a string', () => {
    const m = base([{ name: 't', type: 'text', default: 42 }])
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
    expect(errors.filter((e) => e.field.includes('arguments'))).toHaveLength(0)
  })

  it('accepts commands without arguments (no regression)', () => {
    const errors = validateManifest(backgroundOnly, './')
    expect(errors).toEqual([])
  })
})

describe('manifest validation — searchBarAccessory', () => {
  const withAccessory = (
    accessory: unknown,
    mode: 'view' | 'background' = 'view'
  ): AsyarManifest => ({
    ...viewOnly,
    commands: [
      {
        id: 'open',
        name: 'Open',
        description: 'Open the view',
        mode,
        component: mode === 'view' ? 'DefaultView' : undefined,
        searchBarAccessory: accessory as AsyarManifest['commands'][number]['searchBarAccessory'],
      },
    ],
  })

  it('accepts a well-formed dropdown accessory', () => {
    const m = withAccessory({
      type: 'dropdown',
      default: 'all',
      options: [
        { value: 'all', title: 'All' },
        { value: 'text', title: 'Text' },
      ],
    })
    const errors = validateManifest(m, './')
    expect(errors.filter((e) => e.field.includes('searchBarAccessory'))).toHaveLength(0)
  })

  it('accepts a dropdown accessory without a default', () => {
    const m = withAccessory({
      type: 'dropdown',
      options: [{ value: 'all', title: 'All' }],
    })
    const errors = validateManifest(m, './')
    expect(errors.filter((e) => e.field.includes('searchBarAccessory'))).toHaveLength(0)
  })

  it('rejects empty options array', () => {
    const m = withAccessory({ type: 'dropdown', options: [] })
    const errors = validateManifest(m, './')
    expect(
      errors.some((e) => e.field.includes('searchBarAccessory.options'))
    ).toBe(true)
  })

  it('rejects missing options field', () => {
    const m = withAccessory({ type: 'dropdown' })
    const errors = validateManifest(m, './')
    expect(
      errors.some((e) => e.field.includes('searchBarAccessory.options'))
    ).toBe(true)
  })

  it('rejects default not in options', () => {
    const m = withAccessory({
      type: 'dropdown',
      default: 'missing',
      options: [{ value: 'all', title: 'All' }],
    })
    const errors = validateManifest(m, './')
    expect(
      errors.some((e) => e.field.includes('searchBarAccessory.default'))
    ).toBe(true)
  })

  it('rejects type other than dropdown', () => {
    const m = withAccessory({ type: 'search', options: [] })
    const errors = validateManifest(m, './')
    expect(
      errors.some((e) => e.field.includes('searchBarAccessory.type'))
    ).toBe(true)
  })

  it('rejects option with non-string value or title', () => {
    const mNumValue = withAccessory({
      type: 'dropdown',
      options: [{ value: 42, title: 'Forty-two' }],
    })
    expect(
      validateManifest(mNumValue, './').some((e) =>
        e.field.includes('searchBarAccessory.options[0]')
      )
    ).toBe(true)

    const mNullTitle = withAccessory({
      type: 'dropdown',
      options: [{ value: 'x', title: null }],
    })
    expect(
      validateManifest(mNullTitle, './').some((e) =>
        e.field.includes('searchBarAccessory.options[0]')
      )
    ).toBe(true)
  })

  it('rejects searchBarAccessory on mode=background', () => {
    const m: AsyarManifest = {
      ...backgroundOnly,
      commands: [
        {
          id: 'do-thing',
          name: 'Do Thing',
          description: 'A background command',
          mode: 'background',
          searchBarAccessory: {
            type: 'dropdown',
            options: [{ value: 'a', title: 'A' }],
          },
        } as AsyarManifest['commands'][number],
      ],
    }
    const errors = validateManifest(m, './')
    expect(
      errors.some(
        (e) =>
          e.field.includes('searchBarAccessory') && e.message.toLowerCase().includes('view')
      )
    ).toBe(true)
  })

  it('accepts searchBarAccessory on mode=view', () => {
    const m = withAccessory(
      {
        type: 'dropdown',
        options: [{ value: 'a', title: 'A' }],
      },
      'view'
    )
    const errors = validateManifest(m, './')
    expect(errors).toEqual([])
  })
})

describe('manifest validation — permissions', () => {
  // Mirror of the launcher's permissionGate.ts and Rust permissions.rs gates.
  // If the launcher gates a permission slug, the validator must accept it —
  // otherwise authors who declare the right permission can't publish.
  const launcherGatedPermissions = [
    'fs:watch',
    'diagnostics:report',
    'preferences:read',
    'preferences:write',
  ]

  for (const perm of launcherGatedPermissions) {
    it(`accepts the launcher-gated permission "${perm}"`, () => {
      const m: AsyarManifest = {
        ...viewOnly,
        permissions: [perm],
      }
      const errors = validateManifest(m, './')
      expect(
        errors.filter((e) => e.field === 'permissions'),
        `expected no permissions error for "${perm}"`
      ).toEqual([])
    })
  }

  it('still rejects an unknown permission slug', () => {
    const m: AsyarManifest = {
      ...viewOnly,
      permissions: ['definitely:not-a-real-permission'],
    }
    const errors = validateManifest(m, './')
    expect(
      errors.some(
        (e) =>
          e.field === 'permissions' &&
          e.message.includes('"definitely:not-a-real-permission" is not a valid permission')
      )
    ).toBe(true)
  })
})
