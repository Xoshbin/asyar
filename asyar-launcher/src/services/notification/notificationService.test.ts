import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockInvoke = vi.hoisted(() => vi.fn().mockResolvedValue('notif-123'))
const mockIsPermissionGranted = vi.hoisted(() => vi.fn().mockResolvedValue(true))
const mockRequestPermission = vi.hoisted(() => vi.fn().mockResolvedValue('granted'))

vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: mockInvoke }))

vi.mock('@tauri-apps/plugin-notification', () => ({
  isPermissionGranted: mockIsPermissionGranted,
  requestPermission: mockRequestPermission,
}))

import { NotificationService } from './notificationService'

function makeSvc() {
  return new NotificationService()
}

beforeEach(() => {
  mockInvoke.mockReset()
  mockInvoke.mockResolvedValue('notif-123')
  mockIsPermissionGranted.mockReset()
  mockIsPermissionGranted.mockResolvedValue(true)
  mockRequestPermission.mockReset()
  mockRequestPermission.mockResolvedValue('granted')
})

describe('checkPermission', () => {
  it('delegates to the plugin and returns its boolean', async () => {
    mockIsPermissionGranted.mockResolvedValueOnce(true)
    expect(await makeSvc().checkPermission()).toBe(true)
    mockIsPermissionGranted.mockResolvedValueOnce(false)
    expect(await makeSvc().checkPermission()).toBe(false)
  })
})

describe('requestPermission', () => {
  it('returns true only when the plugin reports "granted"', async () => {
    mockRequestPermission.mockResolvedValueOnce('granted')
    expect(await makeSvc().requestPermission()).toBe(true)
    mockRequestPermission.mockResolvedValueOnce('denied')
    expect(await makeSvc().requestPermission()).toBe(false)
  })
})

describe('send', () => {
  it('forwards title/body/actions to the Rust command and returns the notification id', async () => {
    mockInvoke.mockResolvedValueOnce('notif-xyz')
    const id = await makeSvc().send('org.asyar.coffee', {
      title: 'Coffee ending in 1 minute',
      body: 'Time to act',
      actions: [
        { id: 'extend', title: 'Extend 30m', commandId: 'coffee.extend', args: { minutes: 30 } },
        { id: 'stop', title: 'Stop now', commandId: 'coffee.stop' },
      ],
    })

    expect(id).toBe('notif-xyz')
    expect(mockInvoke).toHaveBeenCalledWith('send_notification', {
      title: 'Coffee ending in 1 minute',
      body: 'Time to act',
      actions: [
        { id: 'extend', title: 'Extend 30m', commandId: 'coffee.extend', args: { minutes: 30 } },
        { id: 'stop', title: 'Stop now', commandId: 'coffee.stop', args: null },
      ],
      callerExtensionId: 'org.asyar.coffee',
    })
  })

  it('defaults body to empty string and omits actions when unset', async () => {
    await makeSvc().send('org.asyar.test', { title: 'Hi' })
    expect(mockInvoke).toHaveBeenCalledWith('send_notification', {
      title: 'Hi',
      body: '',
      actions: null,
      callerExtensionId: 'org.asyar.test',
    })
  })

  it('rejects actions missing required fields before the IPC call', async () => {
    await expect(
      makeSvc().send('org.asyar.test', {
        title: 'x',
        actions: [{ id: '', title: 'T', commandId: 'c' }],
      }),
    ).rejects.toThrow(/id/i)
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('rejects actions whose args are not JSON-serialisable', async () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    await expect(
      makeSvc().send('org.asyar.test', {
        title: 'x',
        actions: [{ id: 'a', title: 'T', commandId: 'c', args: cyclic }],
      }),
    ).rejects.toThrow(/serial/i)
    expect(mockInvoke).not.toHaveBeenCalled()
  })
})

describe('dismiss', () => {
  it('invokes dismiss_notification with the notification id', async () => {
    mockInvoke.mockResolvedValueOnce(undefined)
    await makeSvc().dismiss('org.asyar.test', 'notif-abc')
    expect(mockInvoke).toHaveBeenCalledWith('dismiss_notification', {
      notificationId: 'notif-abc',
      callerExtensionId: 'org.asyar.test',
    })
  })
})
