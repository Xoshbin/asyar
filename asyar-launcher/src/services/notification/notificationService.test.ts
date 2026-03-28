import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockInvoke = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockIsPermissionGranted = vi.hoisted(() => vi.fn().mockResolvedValue(true))
const mockRequestPermission = vi.hoisted(() => vi.fn().mockResolvedValue('granted'))
const mockSendNotification = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: mockInvoke }))

vi.mock('@tauri-apps/plugin-notification', () => ({
  isPermissionGranted: mockIsPermissionGranted,
  requestPermission: mockRequestPermission,
  sendNotification: mockSendNotification,
  registerActionTypes: vi.fn().mockResolvedValue(undefined),
  onAction: vi.fn().mockResolvedValue(undefined),
  createChannel: vi.fn().mockResolvedValue(undefined),
  channels: vi.fn().mockResolvedValue([]),
  removeChannel: vi.fn().mockResolvedValue(undefined),
}))

import { NotificationService } from './notificationService'

function makeSvc() {
  return new NotificationService()
}

// ── checkPermission ───────────────────────────────────────────────────────────

describe('checkPermission', () => {
  it('returns true when permission is granted', async () => {
    mockIsPermissionGranted.mockResolvedValueOnce(true)
    expect(await makeSvc().checkPermission()).toBe(true)
  })

  it('returns false when permission is not granted', async () => {
    mockIsPermissionGranted.mockResolvedValueOnce(false)
    expect(await makeSvc().checkPermission()).toBe(false)
  })
})

// ── requestPermission ─────────────────────────────────────────────────────────

describe('requestPermission', () => {
  it('returns true when the user grants permission', async () => {
    mockRequestPermission.mockResolvedValueOnce('granted')
    expect(await makeSvc().requestPermission()).toBe(true)
  })

  it('returns false when the user denies permission', async () => {
    mockRequestPermission.mockResolvedValueOnce('denied')
    expect(await makeSvc().requestPermission()).toBe(false)
  })
})

// ── notify — production mode ──────────────────────────────────────────────────

describe('notify (production mode)', () => {
  beforeEach(() => {
    vi.stubEnv('DEV', false as any)
    mockIsPermissionGranted.mockClear()
    mockRequestPermission.mockClear()
    mockSendNotification.mockClear()
    mockInvoke.mockClear()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('sends notification directly when permission is already granted', async () => {
    mockIsPermissionGranted.mockResolvedValueOnce(true)
    await makeSvc().notify({ title: 'Hello' })
    expect(mockSendNotification).toHaveBeenCalledWith({ title: 'Hello' })
    expect(mockRequestPermission).not.toHaveBeenCalled()
  })

  it('requests permission first when not already granted, then sends', async () => {
    mockIsPermissionGranted.mockResolvedValueOnce(false)
    mockRequestPermission.mockResolvedValueOnce('granted')
    await makeSvc().notify({ title: 'Hi' })
    expect(mockRequestPermission).toHaveBeenCalledOnce()
    expect(mockSendNotification).toHaveBeenCalledWith({ title: 'Hi' })
  })

  it('does not send when permission is denied after request', async () => {
    mockIsPermissionGranted.mockResolvedValueOnce(false)
    mockRequestPermission.mockResolvedValueOnce('denied')
    await makeSvc().notify({ title: 'Hi' })
    expect(mockSendNotification).not.toHaveBeenCalled()
  })
})

// ── notify — dev mode ─────────────────────────────────────────────────────────

describe('notify (dev mode)', () => {
  beforeEach(() => {
    vi.stubEnv('DEV', true as any)
    mockInvoke.mockClear()
    mockSendNotification.mockClear()
    mockIsPermissionGranted.mockClear()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('uses invoke("send_notification") instead of the plugin', async () => {
    await makeSvc().notify({ title: 'Dev alert', body: 'test body' })
    expect(mockInvoke).toHaveBeenCalledWith('send_notification', {
      title: 'Dev alert',
      body: 'test body',
    })
    expect(mockSendNotification).not.toHaveBeenCalled()
  })

  it('passes empty string for missing title and body', async () => {
    await makeSvc().notify({})
    expect(mockInvoke).toHaveBeenCalledWith('send_notification', {
      title: '',
      body: '',
    })
  })

  it('does not check notification permission in dev mode', async () => {
    await makeSvc().notify({ title: 'x' })
    expect(mockIsPermissionGranted).not.toHaveBeenCalled()
  })
})

// ── other methods ─────────────────────────────────────────────────────────────

describe('registerActionTypes / listenForActions / createChannel / getChannels / removeChannel', () => {
  it('registerActionTypes delegates to plugin', async () => {
    const { registerActionTypes } = await import('@tauri-apps/plugin-notification')
    await makeSvc().registerActionTypes([])
    expect(registerActionTypes).toHaveBeenCalledWith([])
  })

  it('getChannels returns what the plugin returns', async () => {
    const { channels } = await import('@tauri-apps/plugin-notification')
    vi.mocked(channels).mockResolvedValueOnce([{ id: 'ch1' } as any])
    expect(await makeSvc().getChannels()).toEqual([{ id: 'ch1' }])
  })

  it('removeChannel delegates to plugin', async () => {
    const { removeChannel } = await import('@tauri-apps/plugin-notification')
    await makeSvc().removeChannel('ch1')
    expect(removeChannel).toHaveBeenCalledWith('ch1')
  })
})
