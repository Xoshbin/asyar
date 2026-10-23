export const UI_SCALE_OPTIONS: ReadonlyArray<{ value: number; labelKey: string }> = [
  { value: 1, labelKey: 'settings.appearance.interface_size_default' },
  { value: 1.1, labelKey: 'settings.appearance.interface_size_large' },
  { value: 1.2, labelKey: 'settings.appearance.interface_size_larger' },
];

export const DEFAULT_UI_SCALE = 1;

export function clampUiScale(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_UI_SCALE;
  }

  return UI_SCALE_OPTIONS.reduce((nearest, option) => {
    const nearestDistance = Math.abs(value - nearest.value);
    const optionDistance = Math.abs(value - option.value);

    return optionDistance < nearestDistance - Number.EPSILON ? option : nearest;
  }).value;
}
