import { getLauncherPlacement, setLauncherPlacement } from '../../lib/ipc/commands';
import type { LauncherAnchor, LauncherMonitorChoice, LauncherPlacement } from '../../bindings';

/**
 * Mirrors `LauncherPlacement::default()` in
 * `src-tauri/src/launcher_placement/types.rs` — the pre-#596 behaviour, and
 * what Rust returns when nothing has been saved. Only used to render before
 * the real value arrives (and by Reset); Rust remains the source of truth.
 */
export const DEFAULT_PLACEMENT: LauncherPlacement = {
  monitor: 'cursor',
  anchor: { kind: 'topWeighted', bias: 0.16 },
};

const DEFAULT_BIAS = 0.16;

/** The three presets the Settings segmented control offers. A dragged
 *  position is none of them — see {@link LauncherPlacementService.vertical}. */
export type VerticalPreset = 'top' | 'center' | 'custom';

/**
 * Presenter for Settings → Appearance → Launcher Position.
 *
 * Deliberately thin: it holds the current value for rendering and forwards
 * edits to Rust, which owns every placement decision. No geometry is computed
 * here — see `src-tauri/src/launcher_placement/resolve.rs`.
 */
export class LauncherPlacementService {
  placement = $state<LauncherPlacement>(DEFAULT_PLACEMENT);
  /** False until the persisted value has arrived; gate the UI on it so the
   *  default doesn't flash through as a selected segment. */
  loaded = $state(false);

  async load(): Promise<void> {
    this.placement = (await getLauncherPlacement()) ?? DEFAULT_PLACEMENT;
    this.loaded = true;
  }

  /** Which segment is selected, or `null` when the position came from a drag
   *  and matches no preset. */
  get vertical(): VerticalPreset | null {
    const a = this.placement.anchor;
    if (a.kind === 'centered') return 'center';
    if (a.kind === 'topWeighted') return a.bias === DEFAULT_BIAS ? 'top' : 'custom';
    return null;
  }

  get isDragged(): boolean {
    return this.placement.anchor.kind === 'free';
  }

  /** The custom slider's value, as a whole percentage. */
  get biasPercent(): number {
    const a = this.placement.anchor;
    return Math.round((a.kind === 'topWeighted' ? a.bias : DEFAULT_BIAS) * 100);
  }

  setMonitor(monitor: LauncherMonitorChoice): Promise<void> {
    return this.commit({ ...this.placement, monitor });
  }

  setVertical(preset: VerticalPreset): Promise<void> {
    return this.commit({ ...this.placement, anchor: anchorFor(preset, this.placement.anchor) });
  }

  setBias(percent: number): Promise<void> {
    return this.commit({
      ...this.placement,
      anchor: { kind: 'topWeighted', bias: clampFraction(percent / 100) },
    });
  }

  reset(): Promise<void> {
    return this.commit(DEFAULT_PLACEMENT);
  }

  /** Persist first, adopt second: a failed write must not leave the UI
   *  showing a setting that isn't on disk. */
  private async commit(next: LauncherPlacement): Promise<void> {
    await setLauncherPlacement(next);
    this.placement = next;
  }
}

function anchorFor(preset: VerticalPreset, current: LauncherAnchor): LauncherAnchor {
  switch (preset) {
    case 'top':
      return { kind: 'topWeighted', bias: DEFAULT_BIAS };
    case 'center':
      return { kind: 'centered' };
    case 'custom':
      // Carry the current bias across so the slider appears where the
      // launcher already is instead of jumping to a default.
      return {
        kind: 'topWeighted',
        bias: current.kind === 'topWeighted' ? current.bias : DEFAULT_BIAS,
      };
  }
}

function clampFraction(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : DEFAULT_BIAS;
}

export const launcherPlacementService = new LauncherPlacementService();
