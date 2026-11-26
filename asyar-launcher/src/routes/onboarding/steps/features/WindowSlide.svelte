<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '../../../../services/i18n';
  import MiniLauncher from './MiniLauncher.svelte';

  const layouts = $derived([
    { label: t('onboarding.tour.window_left'), box: [0, 0, 50, 100] },
    { label: t('onboarding.tour.window_right'), box: [50, 0, 50, 100] },
    { label: t('onboarding.tour.window_max'), box: [0, 0, 100, 100] },
    { label: t('onboarding.tour.window_center'), box: [20, 12, 60, 76] },
  ]);
  const TYPE_TICKS = 14;
  const SNAP_TICK = TYPE_TICKS + 6;
  const HOLD_TICKS = 18;

  let index = $state(0);
  let tick = $state(0);
  let snapped = $state<number[]>([15, 10, 55, 65]);

  const current = $derived(layouts[index]);
  const typed = $derived(
    current.label.slice(
      0,
      Math.ceil((Math.min(tick, TYPE_TICKS) / TYPE_TICKS) * current.label.length),
    ),
  );

  onMount(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      snapped = layouts[0].box;
      tick = SNAP_TICK;
      return;
    }
    const timer = setInterval(() => {
      tick++;
      if (tick === SNAP_TICK) snapped = current.box;
      if (tick > SNAP_TICK + HOLD_TICKS) {
        tick = 0;
        index = (index + 1) % layouts.length;
      }
    }, 80);
    return () => clearInterval(timer);
  });
</script>

<div class="window-slide" aria-hidden="true">
  <div class="window-slide__desk">
    <div
      class="window-slide__window"
      style:left="{snapped[0]}%"
      style:top="{snapped[1]}%"
      style:width="{snapped[2]}%"
      style:height="{snapped[3]}%"
    >
      <span class="window-slide__dots"><i></i><i></i><i></i></span>
    </div>
    {#if tick < SNAP_TICK}
      <div class="window-slide__launcher">
        <MiniLauncher
          query={typed}
          rows={tick >= TYPE_TICKS ? [{ icon: 'icon:window', title: current.label }] : []}
        />
      </div>
    {/if}
  </div>
</div>

<style>
  .window-slide {
    padding: var(--space-4);
  }
  .window-slide__desk {
    position: relative;
    aspect-ratio: 16 / 8;
    border-radius: var(--radius-md);
    background: linear-gradient(
      135deg,
      color-mix(in srgb, var(--asyar-brand) 18%, var(--bg-tertiary)),
      var(--bg-tertiary)
    );
    overflow: hidden;
  }
  .window-slide__window {
    position: absolute;
    box-sizing: border-box;
    border-radius: var(--radius-md);
    background: var(--bg-secondary);
    box-shadow: var(--shadow-md);
    transition:
      left var(--dur-emerge) var(--ease-emerge),
      top var(--dur-emerge) var(--ease-emerge),
      width var(--dur-emerge) var(--ease-emerge),
      height var(--dur-emerge) var(--ease-emerge);
  }
  .window-slide__dots {
    display: flex;
    gap: var(--space-1);
    padding: var(--space-2);
  }
  .window-slide__dots i {
    width: var(--space-2);
    height: var(--space-2);
    border-radius: 50%;
    background: var(--text-tertiary);
  }
  .window-slide__launcher {
    position: absolute;
    top: 14%;
    left: 50%;
    width: 56%;
    transform: translateX(-50%);
    z-index: var(--z-raised);
    animation: launcher-in var(--dur-quick) var(--ease-emerge) both;
  }
  @keyframes launcher-in {
    from {
      opacity: 0;
      transform: translateX(-50%) scale(0.96);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .window-slide__window {
      transition: none;
    }
  }
</style>
