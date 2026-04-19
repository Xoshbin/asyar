import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const commandArgDefaultsGet = vi.fn<(ext: string, cmd: string) => Promise<Record<string, string>>>()
const commandArgDefaultsSet = vi.fn<(ext: string, cmd: string, v: Record<string, string>) => Promise<void>>()
vi.mock('../../lib/ipc/commandArgDefaultsCommands', () => ({
  commandArgDefaultsGet: (ext: string, cmd: string) => commandArgDefaultsGet(ext, cmd),
  commandArgDefaultsSet: (ext: string, cmd: string, v: Record<string, string>) =>
    commandArgDefaultsSet(ext, cmd, v),
}))

import { CommandArgumentsService } from './commandArgumentsService.svelte'
import type { CommandArgument } from 'asyar-sdk'

function makeDeps(opts: {
  args: CommandArgument[]
  extensionId?: string
  commandId?: string
  commandName?: string
  icon?: string
}) {
  const extensionId = opts.extensionId ?? 'org.asyar.demo'
  const commandId = opts.commandId ?? 'do-thing'
  const commandObjectId = `cmd_${extensionId}_${commandId}`
  const executeCommand = vi.fn<(id: string, args?: Record<string, unknown>) => Promise<unknown>>()
  const getManifestByCommandObjectId = vi.fn((id: string) => {
    if (id !== commandObjectId) return null
    return {
      extensionId,
      commandId,
      commandName: opts.commandName ?? 'Do Thing',
      icon: opts.icon,
      args: opts.args,
    }
  })
  return { executeCommand, getManifestByCommandObjectId, extensionId, commandId, commandObjectId }
}

describe('CommandArgumentsService', () => {
  beforeEach(() => {
    commandArgDefaultsGet.mockReset()
    commandArgDefaultsSet.mockReset()
    commandArgDefaultsGet.mockResolvedValue({})
    commandArgDefaultsSet.mockResolvedValue(undefined)
  })

  it('starts inactive', () => {
    const { executeCommand, getManifestByCommandObjectId } = makeDeps({ args: [] })
    const svc = new CommandArgumentsService({ executeCommand, getManifestByCommandObjectId })
    expect(svc.active).toBeNull()
  })

  it('enter() loads manifest args and defaults, focuses field 0', async () => {
    const args: CommandArgument[] = [
      { name: 'query', type: 'text', placeholder: 'Search' },
      { name: 'max', type: 'number', placeholder: 'Max results' },
    ]
    commandArgDefaultsGet.mockResolvedValueOnce({ query: 'prev-query' })
    const d = makeDeps({ args })
    const svc = new CommandArgumentsService(d)

    const ok = await svc.enter(d.commandObjectId)
    expect(ok).toBe(true)
    expect(svc.active).not.toBeNull()
    expect(svc.active!.extensionId).toBe(d.extensionId)
    expect(svc.active!.commandId).toBe(d.commandId)
    expect(svc.active!.args).toEqual(args)
    expect(svc.active!.values.query).toBe('prev-query')
    expect(svc.active!.currentFieldIdx).toBe(0)
    expect(commandArgDefaultsGet).toHaveBeenCalledWith(d.extensionId, d.commandId)
  })

  it('enter() seeds dropdown default when no persisted value exists', async () => {
    const args: CommandArgument[] = [
      {
        name: 'lang',
        type: 'dropdown',
        default: 'en',
        data: [
          { value: 'en', title: 'English' },
          { value: 'es', title: 'Spanish' },
        ],
      },
    ]
    const d = makeDeps({ args })
    const svc = new CommandArgumentsService(d)
    await svc.enter(d.commandObjectId)
    expect(svc.active!.values.lang).toBe('en')
  })

  it('enter() returns false for unknown command id', async () => {
    const d = makeDeps({ args: [] })
    const svc = new CommandArgumentsService(d)
    const ok = await svc.enter('cmd_unknown_x')
    expect(ok).toBe(false)
    expect(svc.active).toBeNull()
  })

  it('enter() returns false when command has no arguments', async () => {
    const d = makeDeps({ args: [] })
    const svc = new CommandArgumentsService(d)
    const ok = await svc.enter(d.commandObjectId)
    expect(ok).toBe(false)
    expect(svc.active).toBeNull()
  })

  it('setValue() updates field state', async () => {
    const args: CommandArgument[] = [{ name: 'q', type: 'text' }]
    const d = makeDeps({ args })
    const svc = new CommandArgumentsService(d)
    await svc.enter(d.commandObjectId)
    svc.setValue('q', 'hello')
    expect(svc.active!.values.q).toBe('hello')
  })

  it('focusField / next / prev move the cursor', async () => {
    const args: CommandArgument[] = [
      { name: 'a', type: 'text' },
      { name: 'b', type: 'text' },
      { name: 'c', type: 'text' },
    ]
    const d = makeDeps({ args })
    const svc = new CommandArgumentsService(d)
    await svc.enter(d.commandObjectId)
    expect(svc.active!.currentFieldIdx).toBe(0)
    svc.next()
    expect(svc.active!.currentFieldIdx).toBe(1)
    svc.next()
    svc.next()
    expect(svc.active!.currentFieldIdx).toBe(2)
    svc.prev()
    expect(svc.active!.currentFieldIdx).toBe(1)
    svc.focusField(0)
    expect(svc.active!.currentFieldIdx).toBe(0)
  })

  it('canSubmit() is false when a required text field is empty', async () => {
    const args: CommandArgument[] = [{ name: 'q', type: 'text', required: true }]
    const d = makeDeps({ args })
    const svc = new CommandArgumentsService(d)
    await svc.enter(d.commandObjectId)
    expect(svc.canSubmit()).toBe(false)
    svc.setValue('q', 'hi')
    expect(svc.canSubmit()).toBe(true)
  })

  it('canSubmit() is false when a required number field is not a valid number', async () => {
    const args: CommandArgument[] = [{ name: 'n', type: 'number', required: true }]
    const d = makeDeps({ args })
    const svc = new CommandArgumentsService(d)
    await svc.enter(d.commandObjectId)
    svc.setValue('n', 'abc')
    expect(svc.canSubmit()).toBe(false)
    svc.setValue('n', '42')
    expect(svc.canSubmit()).toBe(true)
  })

  it('canSubmit() is true with no required args and empty optional', async () => {
    const args: CommandArgument[] = [{ name: 'q', type: 'text' }]
    const d = makeDeps({ args })
    const svc = new CommandArgumentsService(d)
    await svc.enter(d.commandObjectId)
    expect(svc.canSubmit()).toBe(true)
  })

  it('submit() calls executeCommand with nested arguments and exits mode', async () => {
    const args: CommandArgument[] = [
      { name: 'q', type: 'text', required: true },
      { name: 'n', type: 'number' },
    ]
    const d = makeDeps({ args })
    const svc = new CommandArgumentsService(d)
    await svc.enter(d.commandObjectId)
    svc.setValue('q', 'hello')
    svc.setValue('n', '7')
    await svc.submit()

    expect(d.executeCommand).toHaveBeenCalledWith(d.commandObjectId, {
      arguments: { q: 'hello', n: 7 },
    })
    expect(svc.active).toBeNull()
  })

  it('submit() persists last non-password values', async () => {
    const args: CommandArgument[] = [
      { name: 'q', type: 'text', required: true },
      { name: 'apiKey', type: 'password' },
    ]
    const d = makeDeps({ args })
    const svc = new CommandArgumentsService(d)
    await svc.enter(d.commandObjectId)
    svc.setValue('q', 'hello')
    svc.setValue('apiKey', 'sk-secret')
    await svc.submit()

    expect(commandArgDefaultsSet).toHaveBeenCalledWith(d.extensionId, d.commandId, { q: 'hello' })
    // Password should NOT appear in persistence
    const persisted = commandArgDefaultsSet.mock.calls[0][2]
    expect(persisted).not.toHaveProperty('apiKey')
  })

  it('submit() does nothing when required fields are missing', async () => {
    const args: CommandArgument[] = [{ name: 'q', type: 'text', required: true }]
    const d = makeDeps({ args })
    const svc = new CommandArgumentsService(d)
    await svc.enter(d.commandObjectId)
    await svc.submit()
    expect(d.executeCommand).not.toHaveBeenCalled()
    expect(svc.active).not.toBeNull()
  })

  it('submit() preserves argument-mode when executeCommand throws', async () => {
    const args: CommandArgument[] = [{ name: 'q', type: 'text' }]
    const d = makeDeps({ args })
    d.executeCommand.mockRejectedValueOnce(new Error('boom'))
    const svc = new CommandArgumentsService(d)
    await svc.enter(d.commandObjectId)
    svc.setValue('q', 'hi')
    await expect(svc.submit()).rejects.toThrow('boom')
    expect(svc.active).not.toBeNull()
  })

  it('exit() clears state', async () => {
    const args: CommandArgument[] = [{ name: 'q', type: 'text' }]
    const d = makeDeps({ args })
    const svc = new CommandArgumentsService(d)
    await svc.enter(d.commandObjectId)
    svc.exit()
    expect(svc.active).toBeNull()
  })

  it('submit() drops empty-string values from the arguments payload', async () => {
    const args: CommandArgument[] = [
      { name: 'a', type: 'text', required: true },
      { name: 'b', type: 'text' },
    ]
    const d = makeDeps({ args })
    const svc = new CommandArgumentsService(d)
    await svc.enter(d.commandObjectId)
    svc.setValue('a', 'hi')
    // b is left as empty string
    await svc.submit()
    const payload = d.executeCommand.mock.calls[0][1] as { arguments: Record<string, unknown> }
    expect(payload.arguments).toEqual({ a: 'hi' })
    expect(payload.arguments).not.toHaveProperty('b')
  })
})
