import type { HostPlatform } from '../keyboard/hostPlatform';

/** Surface opacity in percent; 100 is solid and turns the native blur off. */
export const WINDOW_OPACITY_RANGE = { min: 0, max: 100, step: 5 } as const;

/** Today's look per platform: macOS surfaces at 65%, the Windows Acrylic tint at 85%. */
export function defaultWindowOpacity(platform: HostPlatform): number {
  return platform === 'windows' ? 85 : 65;
}

export function resolveWindowOpacity(
  appearance: { windowOpacity?: number; activeTheme?: string | null },
  platform: HostPlatform,
): number {
  const { min, max, step } = WINDOW_OPACITY_RANGE;
  const value = appearance.windowOpacity;
  // A custom theme owns its own opacity.
  if (appearance.activeTheme || typeof value !== 'number' || !Number.isFinite(value)) {
    return defaultWindowOpacity(platform);
  }
  return Math.min(max, Math.max(min, min + Math.round((value - min) / step) * step));
}
