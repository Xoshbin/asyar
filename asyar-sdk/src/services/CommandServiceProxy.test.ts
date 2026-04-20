import { describe, it, expect, vi, beforeEach } from 'vitest'
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
