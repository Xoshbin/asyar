import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../ipc/MessageBroker', () => ({
  MessageBroker: {
    getInstance: vi.fn().mockReturnValue({ invoke: vi.fn() }),
  },
}))

import { MessageBroker } from '../ipc/MessageBroker'
import { WindowManagementServiceProxy } from './WindowManagementService'

describe('WindowManagementServiceProxy', () => {
  let mockBroker: { invoke: ReturnType<typeof vi.fn> }
  let proxy: WindowManagementServiceProxy

  beforeEach(() => {
    vi.clearAllMocks()
    mockBroker = MessageBroker.getInstance() as any
    proxy = new WindowManagementServiceProxy()
  })

  it('getWindowBounds calls correct IPC key', async () => {
    const bounds = { x: 0, y: 0, width: 1280, height: 800 }
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce(bounds)

    const result = await proxy.getWindowBounds()

    expect(mockBroker.invoke).toHaveBeenCalledWith('WindowManagementService:getWindowBounds')
    expect(result).toEqual(bounds)
  })

  it('setWindowBounds calls correct IPC key with partial update', async () => {
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce(undefined)

    await proxy.setWindowBounds({ width: 800, height: 600 })

    expect(mockBroker.invoke).toHaveBeenCalledWith(
      'WindowManagementService:setWindowBounds',
      { x: undefined, y: undefined, width: 800, height: 600 }
    )
  })

  it('setFullscreen calls correct IPC key with enable=true', async () => {
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce(undefined)

    await proxy.setFullscreen(true)

    expect(mockBroker.invoke).toHaveBeenCalledWith(
      'WindowManagementService:setFullscreen',
      { enable: true }
    )
  })

  it('setFullscreen calls correct IPC key with enable=false', async () => {
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce(undefined)

    await proxy.setFullscreen(false)

    expect(mockBroker.invoke).toHaveBeenCalledWith(
      'WindowManagementService:setFullscreen',
      { enable: false }
    )
  })
})
