import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

vi.mock('../envService', () => ({
  envService: { isTauri: true, isBrowser: false },
}))

import { statusBarService, type StatusBarItem } from './statusBarService.svelte'
import { invoke } from '@tauri-apps/api/core'

function topItem(overrides: Partial<StatusBarItem> = {}): StatusBarItem {
  return {
    id: 't1',
    extensionId: 'ext-a',
    icon: '☕',
    text: 'Coffee',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(invoke).mockResolvedValue(undefined as any)
})

describe('registerItem', () => {
  it('invokes tray_register_item with the full item including extensionId', async () => {
    await statusBarService.registerItem(topItem())
    expect(invoke).toHaveBeenCalledWith(
      'tray_register_item',
      expect.objectContaining({
        item: expect.objectContaining({ id: 't1', extensionId: 'ext-a' }),
      }),
    )
  })

  it('forwards submenu trees verbatim', async () => {
    const item = topItem({
      submenu: [
        { id: 'p', extensionId: 'ext-a', text: 'Play', checked: true },
        { id: 'n', extensionId: 'ext-a', text: 'Next', enabled: false },
      ],
    })
    await statusBarService.registerItem(item)
    const arg = vi.mocked(invoke).mock.calls[0][1] as any
    expect(arg.item.submenu).toHaveLength(2)
    expect(arg.item.submenu[0]).toMatchObject({ id: 'p', checked: true })
  })

  it('rejects the caller when the Rust command fails', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('validation: top-level must provide icon'))
    await expect(statusBarService.registerItem(topItem())).rejects.toThrow(/validation/)
  })
})

describe('updateItem', () => {
  it('invokes tray_update_item with the merged item', async () => {
    const merged = topItem({ icon: '🍵', text: 'Tea' })
    await statusBarService.updateItem('ext-a', 't1', { item: merged })
    expect(invoke).toHaveBeenCalledWith(
      'tray_update_item',
      expect.objectContaining({
        item: expect.objectContaining({ id: 't1', icon: '🍵', text: 'Tea' }),
      }),
    )
  })
})

describe('unregisterItem', () => {
  it('invokes tray_unregister_item with extensionId + id', async () => {
    await statusBarService.unregisterItem('ext-a', 't1')
    expect(invoke).toHaveBeenCalledWith('tray_unregister_item', {
      extensionId: 'ext-a',
      id: 't1',
    })
  })
})

describe('clearItemsForExtension', () => {
  it('invokes tray_remove_all_for_extension', async () => {
    await statusBarService.clearItemsForExtension('ext-a')
    expect(invoke).toHaveBeenCalledWith('tray_remove_all_for_extension', {
      extensionId: 'ext-a',
    })
  })
})
