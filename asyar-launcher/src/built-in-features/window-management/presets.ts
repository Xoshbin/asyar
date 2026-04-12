import type { WindowBoundsUpdate } from '../../lib/ipc/commands'

export interface PresetResult {
  bounds?: WindowBoundsUpdate
  fullscreen?: boolean
}

/**
 * Returns the target bounds for a preset given available screen dimensions.
 * Screen dimensions must be passed in (do not read window.screen here — keeps
 * this module pure and testable without a DOM).
 * Returns null if presetId is not recognised.
 */
export function getPresetBounds(
  presetId: string,
  screenWidth: number,
  screenHeight: number,
): PresetResult | null {
  const sw = screenWidth
  const sh = screenHeight

  switch (presetId) {
    case 'left-half':
      return { bounds: { x: 0, y: 0, width: sw / 2, height: sh } }
    case 'right-half':
      return { bounds: { x: sw / 2, y: 0, width: sw / 2, height: sh } }
    case 'top-half':
      return { bounds: { x: 0, y: 0, width: sw, height: sh / 2 } }
    case 'bottom-half':
      return { bounds: { x: 0, y: sh / 2, width: sw, height: sh / 2 } }
    case 'top-left-quarter':
      return { bounds: { x: 0, y: 0, width: sw / 2, height: sh / 2 } }
    case 'top-right-quarter':
      return { bounds: { x: sw / 2, y: 0, width: sw / 2, height: sh / 2 } }
    case 'bottom-left-quarter':
      return { bounds: { x: 0, y: sh / 2, width: sw / 2, height: sh / 2 } }
    case 'bottom-right-quarter':
      return { bounds: { x: sw / 2, y: sh / 2, width: sw / 2, height: sh / 2 } }
    case 'left-third':
      return { bounds: { x: 0, y: 0, width: sw / 3, height: sh } }
    case 'center-third':
      return { bounds: { x: sw / 3, y: 0, width: sw / 3, height: sh } }
    case 'right-third':
      return { bounds: { x: (sw / 3) * 2, y: 0, width: sw / 3, height: sh } }
    case 'left-two-thirds':
      return { bounds: { x: 0, y: 0, width: (sw / 3) * 2, height: sh } }
    case 'right-two-thirds':
      return { bounds: { x: sw / 3, y: 0, width: (sw / 3) * 2, height: sh } }
    case 'center':
      return { bounds: { x: sw * 0.1, y: sh * 0.1, width: sw * 0.8, height: sh * 0.8 } }
    case 'almost-maximize':
      return { bounds: { x: sw * 0.05, y: sh * 0.05, width: sw * 0.9, height: sh * 0.9 } }
    case 'maximize':
      return { fullscreen: true }
    default:
      return null
  }
}

/** All preset IDs that apply a layout (excludes 'restore' and 'manage-layouts'). */
export const PRESET_IDS: readonly string[] = [
  'left-half', 'right-half', 'top-half', 'bottom-half',
  'top-left-quarter', 'top-right-quarter', 'bottom-left-quarter', 'bottom-right-quarter',
  'left-third', 'center-third', 'right-third',
  'left-two-thirds', 'right-two-thirds',
  'center', 'almost-maximize', 'maximize',
] as const
