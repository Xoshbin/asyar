export type ListDensityPreset = 'dense' | 'balanced' | 'comfortable' | 'custom';

export interface ListDensity {
  rowHeight: number;
  iconSize: number;
  gap: number;
  titleSize: number;
  twoLine: boolean;
}

type DensityKey = Exclude<keyof ListDensity, 'twoLine'>;

export const LIST_DENSITY_PRESETS: Record<Exclude<ListDensityPreset, 'custom'>, ListDensity> = {
  dense: { rowHeight: 36, iconSize: 20, gap: 10, titleSize: 13, twoLine: false },
  balanced: { rowHeight: 40, iconSize: 24, gap: 12, titleSize: 14, twoLine: false },
  comfortable: { rowHeight: 48, iconSize: 32, gap: 12, titleSize: 14, twoLine: true },
};

export const LIST_DENSITY_OPTIONS: ReadonlyArray<{ value: ListDensityPreset; labelKey: string }> = [
  { value: 'dense', labelKey: 'settings.appearance.list_density_dense' },
  { value: 'balanced', labelKey: 'settings.appearance.list_density_balanced' },
  { value: 'comfortable', labelKey: 'settings.appearance.list_density_comfortable' },
  { value: 'custom', labelKey: 'settings.appearance.list_density_custom' },
];

export const DEFAULT_LIST_DENSITY: ListDensityPreset = 'balanced';

export const LIST_DENSITY_RANGES: Record<DensityKey, { min: number; max: number; step: number }> = {
  rowHeight: { min: 32, max: 56, step: 2 },
  iconSize: { min: 16, max: 40, step: 4 },
  gap: { min: 6, max: 20, step: 2 },
  titleSize: { min: 12, max: 16, step: 1 },
};

/** macOS app icons fill 80% of their canvas; full-bleed icons shrink to match. */
export const OPTICAL_ICON_RATIO = 0.8;

function clampTo(key: DensityKey, value: unknown): number {
  const { min, max, step } = LIST_DENSITY_RANGES[key];
  const fallback = LIST_DENSITY_PRESETS.balanced[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const snapped = min + Math.round((value - min) / step) * step;
  return Math.min(max, Math.max(min, snapped));
}

export function clampListDensity(value: Partial<ListDensity> | null | undefined): ListDensity {
  const v = value ?? {};
  const iconSize = clampTo('iconSize', v.iconSize);
  return {
    rowHeight: Math.max(clampTo('rowHeight', v.rowHeight), iconSize + 8),
    iconSize,
    gap: clampTo('gap', v.gap),
    titleSize: clampTo('titleSize', v.titleSize),
    twoLine: v.twoLine === true,
  };
}

export function resolveListDensity(appearance: {
  listDensity?: ListDensityPreset;
  customListDensity?: Partial<ListDensity>;
}): ListDensity {
  const preset = appearance.listDensity ?? DEFAULT_LIST_DENSITY;
  if (preset === 'custom') return clampListDensity(appearance.customListDensity);
  return (
    LIST_DENSITY_PRESETS[preset as keyof typeof LIST_DENSITY_PRESETS] ??
    LIST_DENSITY_PRESETS.balanced
  );
}
