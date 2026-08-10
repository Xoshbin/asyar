<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import { getSnapGuideState, type SnapGuideState } from '../../lib/ipc/commands';
  import '../../resources/styles/style.css';

  let leftX = $state(0);
  let rightX = $state(0);
  let y = $state(0);
  let snappedX = $state(false);
  let snappedY = $state(false);
  let unlisten: UnlistenFn | null = null;

  function applyState(state: SnapGuideState): void {
    leftX = state.leftX;
    rightX = state.rightX;
    y = state.y;
    snappedX = state.snappedX;
    snappedY = state.snappedY;
  }

  onMount(async () => {
    // Belt: recover state emitted before this listener attached — same
    // reason the HUD route calls get_hud_state on mount.
    try {
      const initial = await getSnapGuideState();
      if (initial) {
        applyState(initial);
      }
    } catch (err) {
      console.error('[snap-guides] get_snap_guide_state failed:', err);
    }

    try {
      unlisten = await listen<SnapGuideState>('snap-guides:state', (event) => {
        applyState(event.payload);
      });
    } catch (err) {
      console.error('[snap-guides] listen snap-guides:state failed:', err);
    }
  });

  onDestroy(() => {
    if (unlisten) {
      unlisten();
      unlisten = null;
    }
  });
</script>

<svelte:head>
  <title>Asyar Snap Guides</title>
</svelte:head>

<div
  class="guide-line guide-line--vertical"
  class:guide-line--active={snappedX}
  style:left="{leftX}px"
></div>
<div
  class="guide-line guide-line--vertical"
  class:guide-line--active={snappedX}
  style:left="{rightX}px"
></div>
<div
  class="guide-line guide-line--horizontal"
  class:guide-line--active={snappedY}
  style:top="{y}px"
></div>

<style>
  /*
    design-ok-file: standalone Tauri webview with no theme injection (this
    route is in +layout.svelte's BARE_ROUTES, same as hud/+page.svelte,
    which documents the same exemption). A guide line drawn over the
    desktop, not app chrome, so a fixed light color reads correctly
    regardless of the user's in-app theme choice.
  */
  :global(html, body) {
    margin: 0;
    padding: 0;
    background: transparent !important;
    overflow: hidden;
  }

  .guide-line {
    position: fixed;
    background: transparent;
    border: none;
    opacity: 0;
    transition: opacity 100ms ease;
    pointer-events: none;
    /* Dark halo around the white dash so it stays visible on light desktop
       backgrounds, not just dark ones. */
    filter: drop-shadow(0 0 1px rgba(0, 0, 0, 0.6)) drop-shadow(0 0 1px rgba(0, 0, 0, 0.6));
  }

  .guide-line--vertical {
    top: 0;
    bottom: 0;
    width: 0;
    border-left: 1.5px dashed rgba(255, 255, 255, 0.9);
  }

  .guide-line--horizontal {
    left: 0;
    right: 0;
    height: 0;
    border-top: 1.5px dashed rgba(255, 255, 255, 0.9);
  }

  .guide-line--active {
    opacity: 1;
  }
</style>
