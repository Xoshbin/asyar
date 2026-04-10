import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MessageBroker } from '../ipc/MessageBroker'

// Mock MessageBroker before importing InteropServiceProxy
vi.mock('../ipc/MessageBroker', () => ({
  MessageBroker: {
    getInstance: vi.fn(),
  },
}))

import { InteropServiceProxy } from './InteropServiceProxy'

describe('InteropServiceProxy', () => {
  let mockBroker: any
  let proxy: InteropServiceProxy

  beforeEach(() => {
    vi.clearAllMocks()
    mockBroker = {
      invoke: vi.fn(),
    }
    vi.mocked(MessageBroker.getInstance).mockReturnValue(mockBroker)
    proxy = new InteropServiceProxy()
  })

  it('calls broker.invoke with correct command and parameters', async () => {
    mockBroker.invoke.mockResolvedValueOnce(undefined)

    await proxy.launchCommand('com.example.calc', 'run', { query: '5+3' })

    expect(mockBroker.invoke).toHaveBeenCalledWith('InteropService:launchCommand', {
      extensionId: 'com.example.calc',
      commandId: 'run',
      args: { query: '5+3' },
    })
  })

  it('defaults args to null if not provided', async () => {
    mockBroker.invoke.mockResolvedValueOnce(undefined)

    await proxy.launchCommand('com.example.calc', 'run')

    expect(mockBroker.invoke).toHaveBeenCalledWith('InteropService:launchCommand', {
      extensionId: 'com.example.calc',
      commandId: 'run',
      args: null,
    })
  })

  it('resolves when broker resolves', async () => {
    mockBroker.invoke.mockResolvedValueOnce(undefined)
    await expect(proxy.launchCommand('ext', 'cmd')).resolves.toBeUndefined()
  })

  it('rejects when broker rejects', async () => {
    mockBroker.invoke.mockRejectedValueOnce(new Error('Invoke failed'))
    await expect(proxy.launchCommand('ext', 'cmd')).rejects.toThrow('Invoke failed')
  })
})
