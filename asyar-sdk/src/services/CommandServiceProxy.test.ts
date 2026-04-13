import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MessageBroker } from '../ipc/MessageBroker'

vi.mock('../ipc/MessageBroker', () => ({
  MessageBroker: {
    getInstance: vi.fn(),
  },
}))

import { CommandServiceProxy } from './CommandServiceProxy'

// setExtensionId patches broker.invoke so it forwards extensionId as the 3rd
// argument: originalInvoke(cmd, payload, extensionId, timeoutMs).
// Tests destructure mock.calls[0] to assert only cmd and payload.

function makeProxy() {
  const mockInvoke = vi.fn()
  vi.mocked(MessageBroker.getInstance).mockReturnValue({ invoke: mockInvoke } as any)
  const proxy = new CommandServiceProxy()
  proxy.setExtensionId('com.example.ext')
  return { proxy, mockInvoke }
}

describe('CommandServiceProxy.updateCommandMetadata', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('invokes command:updateCommandMetadata with extensionId, commandId, and subtitle string', async () => {
    const { proxy, mockInvoke } = makeProxy()
    mockInvoke.mockResolvedValueOnce(undefined)

    await proxy.updateCommandMetadata('myCommand', { subtitle: 'Hello World' })

    const [cmd, payload] = mockInvoke.mock.calls[0]
    expect(cmd).toBe('command:updateCommandMetadata')
    expect(payload).toEqual({ extensionId: 'com.example.ext', commandId: 'myCommand', subtitle: 'Hello World' })
  })

  it('sends null subtitle when metadata.subtitle is undefined', async () => {
    const { proxy, mockInvoke } = makeProxy()
    mockInvoke.mockResolvedValueOnce(undefined)

    await proxy.updateCommandMetadata('myCommand', {})

    const [cmd, payload] = mockInvoke.mock.calls[0]
    expect(cmd).toBe('command:updateCommandMetadata')
    expect(payload).toEqual({ extensionId: 'com.example.ext', commandId: 'myCommand', subtitle: null })
  })

  it('sends null subtitle when metadata.subtitle is explicitly undefined', async () => {
    const { proxy, mockInvoke } = makeProxy()
    mockInvoke.mockResolvedValueOnce(undefined)

    await proxy.updateCommandMetadata('myCommand', { subtitle: undefined })

    const [cmd, payload] = mockInvoke.mock.calls[0]
    expect(cmd).toBe('command:updateCommandMetadata')
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
