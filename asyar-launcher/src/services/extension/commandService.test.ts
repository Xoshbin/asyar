import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CommandService, commandService } from './commandService.svelte'
import { logService } from '../log/logService';

vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

function freshService(): CommandService {
  return new CommandService()
}

function makeHandler(result: any = 'ok') {
  return { execute: vi.fn().mockResolvedValue(result) }
}

// ── registerCommand ───────────────────────────────────────────────────────────

describe('registerCommand', () => {
  it('stores the command and exposes it in getCommands()', () => {
    const svc = freshService()
    svc.registerCommand('my-cmd', makeHandler(), 'ext-a')
    expect(svc.getCommands()).toContain('my-cmd')
  })

  it('overwrites an existing command with the same id', () => {
    const svc = freshService()
    const h1 = makeHandler('first')
    const h2 = makeHandler('second')
    svc.registerCommand('dup', h1, 'ext-a')
    svc.registerCommand('dup', h2, 'ext-a')
    expect(svc.getCommands().filter((c) => c === 'dup')).toHaveLength(1)
  })

  it('updates the commands state', () => {
    const svc = freshService()
    svc.registerCommand('store-cmd', makeHandler(), 'ext-a')
    expect(svc.commands.has('store-cmd')).toBe(true)
  })
})

// ── unregisterCommand ─────────────────────────────────────────────────────────

describe('unregisterCommand', () => {
  it('removes the command from the registry', () => {
    const svc = freshService()
    svc.registerCommand('to-remove', makeHandler(), 'ext-a')
    svc.unregisterCommand('to-remove')
    expect(svc.getCommands()).not.toContain('to-remove')
  })

  it('updates the commands state on removal', () => {
    const svc = freshService()
    svc.registerCommand('store-remove', makeHandler(), 'ext-a')
    svc.unregisterCommand('store-remove')
    expect(svc.commands.has('store-remove')).toBe(false)
  })

  it('does not throw when removing a non-existent command', () => {
    const svc = freshService()
    expect(() => svc.unregisterCommand('ghost')).not.toThrow()
  })
})

// ── executeCommand ────────────────────────────────────────────────────────────

describe('executeCommand', () => {
  it('calls the handler execute function', async () => {
    const svc = freshService()
    const handler = makeHandler('result')
    svc.registerCommand('run', handler, 'ext-a')
    const result = await svc.executeCommand('run')
    expect(handler.execute).toHaveBeenCalledOnce()
    expect(result).toBe('result')
  })

  it('passes args to the handler', async () => {
    const svc = freshService()
    const handler = makeHandler()
    svc.registerCommand('with-args', handler, 'ext-a')
    await svc.executeCommand('with-args', { foo: 'bar' })
    expect(handler.execute).toHaveBeenCalledWith({ foo: 'bar' })
  })

  it('throws when the command does not exist', async () => {
    const svc = freshService()
    await expect(svc.executeCommand('missing')).rejects.toThrow('Command not found: missing')
  })

  it('re-throws errors from the handler', async () => {
    const svc = freshService()
    const handler = { execute: vi.fn().mockRejectedValue(new Error('handler error')) }
    svc.registerCommand('faulty', handler, 'ext-a')
    await expect(svc.executeCommand('faulty')).rejects.toThrow('handler error')
  })
})

// ── getCommandsForExtension ───────────────────────────────────────────────────

describe('getCommandsForExtension', () => {
  it('returns only commands belonging to the given extension', () => {
    const svc = freshService()
    svc.registerCommand('cmd-a1', makeHandler(), 'ext-a')
    svc.registerCommand('cmd-a2', makeHandler(), 'ext-a')
    svc.registerCommand('cmd-b1', makeHandler(), 'ext-b')
    expect(svc.getCommandsForExtension('ext-a')).toEqual(['cmd-a1', 'cmd-a2'])
    expect(svc.getCommandsForExtension('ext-b')).toEqual(['cmd-b1'])
  })

  it('returns an empty array when the extension has no commands', () => {
    const svc = freshService()
    expect(svc.getCommandsForExtension('nonexistent')).toEqual([])
  })
})

// ── clearCommandsForExtension ─────────────────────────────────────────────────

describe('clearCommandsForExtension', () => {
  it('removes all commands for the given extension', () => {
    const svc = freshService()
    svc.registerCommand('c1', makeHandler(), 'ext-a')
    svc.registerCommand('c2', makeHandler(), 'ext-a')
    svc.registerCommand('c3', makeHandler(), 'ext-b')
    svc.clearCommandsForExtension('ext-a')
    expect(svc.getCommands()).not.toContain('c1')
    expect(svc.getCommands()).not.toContain('c2')
    expect(svc.getCommands()).toContain('c3')
  })

  it('does nothing when the extension has no commands', () => {
    const svc = freshService()
    svc.registerCommand('keep', makeHandler(), 'ext-b')
    svc.clearCommandsForExtension('ext-a')
    expect(svc.getCommands()).toContain('keep')
  })
})
