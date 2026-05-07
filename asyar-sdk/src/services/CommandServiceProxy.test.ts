import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { messageBroker } from '../ipc/MessageBroker'

vi.mock('../ipc/MessageBroker', () => ({
  messageBroker: { invoke: vi.fn().mockResolvedValue(undefined), on: vi.fn(), off: vi.fn() },
}))

import { CommandServiceProxy } from './CommandServiceProxy'

// setExtensionId patches broker.invoke so it forwards extensionId as the 3rd
// argument: originalInvoke(cmd, payload, extensionId, timeoutMs).
// Tests destructure mock.calls[0] to assert only cmd and payload.

function makeProxy() {
  const mockInvoke = vi.fn().mockResolvedValue(undefined)
  Object.assign(messageBroker, {
    invoke: mockInvoke, on: vi.fn(), off: vi.fn(),
  })
  const proxy = new CommandServiceProxy()
  proxy.setExtensionId('com.example.ext')
  return { proxy, mockInvoke }
}

describe('CommandServiceProxy.updateCommandMetadata', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('invokes commands:updateCommandMetadata with extensionId, commandId, and subtitle string', async () => {
    const { proxy, mockInvoke } = makeProxy()
    mockInvoke.mockResolvedValueOnce(undefined)

    await proxy.updateCommandMetadata('myCommand', { subtitle: 'Hello World' })

    const [cmd, payload] = mockInvoke.mock.calls[0]
    expect(cmd).toBe('commands:updateCommandMetadata')
    expect(payload).toEqual({ extensionId: 'com.example.ext', commandId: 'myCommand', subtitle: 'Hello World' })
  })

  it('sends null subtitle when metadata.subtitle is undefined', async () => {
    const { proxy, mockInvoke } = makeProxy()
    mockInvoke.mockResolvedValueOnce(undefined)

    await proxy.updateCommandMetadata('myCommand', {})

    const [cmd, payload] = mockInvoke.mock.calls[0]
    expect(cmd).toBe('commands:updateCommandMetadata')
    expect(payload).toEqual({ extensionId: 'com.example.ext', commandId: 'myCommand', subtitle: null })
  })

  it('sends null subtitle when metadata.subtitle is explicitly undefined', async () => {
    const { proxy, mockInvoke } = makeProxy()
    mockInvoke.mockResolvedValueOnce(undefined)

    await proxy.updateCommandMetadata('myCommand', { subtitle: undefined })

    const [cmd, payload] = mockInvoke.mock.calls[0]
    expect(cmd).toBe('commands:updateCommandMetadata')
    expect(payload).toEqual({ extensionId: 'com.example.ext', commandId: 'myCommand', subtitle: null })
  })

  it('resolves when broker resolves', async () => {
    const { proxy, mockInvoke } = makeProxy()
    mockInvoke.mockResolvedValueOnce(undefined)
    await expect(proxy.updateCommandMetadata('cmd', { subtitle: 'x' })).resolves.toBeUndefined()
  })

  it('rejects when broker rejects', async () => {
    const { proxy, mockInvoke } = makeProxy()
    mockInvoke.mockRejectedValueOnce(new Error('IPC error'))
    await expect(proxy.updateCommandMetadata('cmd', { subtitle: 'x' })).rejects.toThrow('IPC error')
  })
})

describe('CommandServiceProxy canonical namespace', () => {
  beforeEach(() => vi.clearAllMocks())

  it('executeCommand → "commands:executeCommand"', async () => {
    const { proxy, mockInvoke } = makeProxy()
    mockInvoke.mockResolvedValue(undefined)
    await proxy.executeCommand('cmd-1', {})
    const call = mockInvoke.mock.calls.find(c => c[0] === 'commands:executeCommand')
    expect(call).toBeDefined()
  })

  it('registerCommand → "commands:registerCommand"', () => {
    const { proxy, mockInvoke } = makeProxy()
    proxy.registerCommand('cmd-1', { execute: () => {} }, 'ext-1', [])
    const call = mockInvoke.mock.calls.find(c => c[0] === 'commands:registerCommand')
    expect(call).toBeDefined()
  })

  it('unregisterCommand → "commands:unregisterCommand"', () => {
    const { proxy, mockInvoke } = makeProxy()
    proxy.unregisterCommand('cmd-1')
    const call = mockInvoke.mock.calls.find(c => c[0] === 'commands:unregisterCommand')
    expect(call).toBeDefined()
  })

  it('clearCommandsForExtension → "commands:clearCommandsForExtension"', () => {
    const { proxy, mockInvoke } = makeProxy()
    proxy.clearCommandsForExtension('ext-1')
    const call = mockInvoke.mock.calls.find(c => c[0] === 'commands:clearCommandsForExtension')
    expect(call).toBeDefined()
  })

  it('updateCommandMetadata → "commands:updateCommandMetadata"', async () => {
    const { proxy, mockInvoke } = makeProxy()
    mockInvoke.mockResolvedValue(undefined)
    await proxy.updateCommandMetadata('cmd-1', {})
    const call = mockInvoke.mock.calls.find(c => c[0] === 'commands:updateCommandMetadata')
    expect(call).toBeDefined()
  })
})

describe('CommandServiceProxy.replaceDynamicCommands', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(window as any).__ASYAR_ROLE__ = 'worker'
  })

  afterEach(() => {
    delete (window as any).__ASYAR_ROLE__
  })

  it('invokes commands:replaceDynamicCommands with extensionId and regs payload', async () => {
    const { proxy, mockInvoke } = makeProxy()
    mockInvoke.mockResolvedValueOnce(undefined)

    const regs = [
      { id: 'sc-1', name: 'Run lights', arguments: [{ name: 'value', type: 'text' as const }] },
      { id: 'sc-2', name: 'Send report' },
    ]
    await proxy.replaceDynamicCommands(regs)

    const [cmd, payload] = mockInvoke.mock.calls[0]
    expect(cmd).toBe('commands:replaceDynamicCommands')
    expect(payload).toEqual({ extensionId: 'com.example.ext', regs })
  })

  it('resolves when broker resolves', async () => {
    const { proxy, mockInvoke } = makeProxy()
    mockInvoke.mockResolvedValueOnce(undefined)
    await expect(proxy.replaceDynamicCommands([])).resolves.toBeUndefined()
  })

  it('rejects when broker rejects with the broker error', async () => {
    const { proxy, mockInvoke } = makeProxy()
    mockInvoke.mockRejectedValueOnce(new Error('argument validation failed'))
    await expect(proxy.replaceDynamicCommands([{ id: 'x', name: 'X' }])).rejects.toThrow(
      'argument validation failed'
    )
  })

  it('throws when called from view role', async () => {
    ;(window as any).__ASYAR_ROLE__ = 'view'
    const { proxy } = makeProxy()
    await expect(proxy.replaceDynamicCommands([])).rejects.toThrow(/worker-only/i)
  })

  it('throws when called with no role set (untrusted context)', async () => {
    delete (window as any).__ASYAR_ROLE__
    const { proxy } = makeProxy()
    await expect(proxy.replaceDynamicCommands([])).rejects.toThrow(/worker-only/i)
  })

  it('does not invoke broker when worker-only assertion fails', async () => {
    ;(window as any).__ASYAR_ROLE__ = 'view'
    const { proxy, mockInvoke } = makeProxy()
    await expect(proxy.replaceDynamicCommands([])).rejects.toThrow()
    expect(mockInvoke).not.toHaveBeenCalled()
  })
})

describe('CommandServiceProxy canonical namespace — replaceDynamicCommands', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(window as any).__ASYAR_ROLE__ = 'worker'
  })
  afterEach(() => {
    delete (window as any).__ASYAR_ROLE__
  })

  it('replaceDynamicCommands → "commands:replaceDynamicCommands"', async () => {
    const { proxy, mockInvoke } = makeProxy()
    mockInvoke.mockResolvedValue(undefined)
    await proxy.replaceDynamicCommands([])
    const call = mockInvoke.mock.calls.find(c => c[0] === 'commands:replaceDynamicCommands')
    expect(call).toBeDefined()
  })
})
