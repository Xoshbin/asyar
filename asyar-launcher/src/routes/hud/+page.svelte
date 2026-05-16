<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import { getHudState, type HudContent } from '../../lib/ipc/commands';
  import '../../resources/styles/style.css';

  let title = $state<string | null>(null);
  let spinning = $state<boolean>(false);
  let unlisten: UnlistenFn | null = null;

  onMount(async () => {
    // Belt: recover the most recently set state from Rust in case the
    // `hud:show` event was emitted before this listener attached. (The
    // HUD window is eagerly initialized at app startup; on the very
    // first `show_hud` call this fallback is what populates the pill
    // before the listener takes over for subsequent calls.)
    try {
      const initial = await getHudState();
      if (initial) {
        title = initial.title;
        spinning = initial.spinning;
      }
    } catch (err) {
      console.error('[hud] get_hud_state failed:', err);
    }

    try {
      unlisten = await listen<HudContent>('hud:show', (event) => {
        title = event.payload.title;
        spinning = event.payload.spinning;
      });
    } catch (err) {
      console.error('[hud] listen hud:show failed:', err);
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
  <title>Asyar HUD</title>
</svelte:head>

<div class="hud-root">
  {#if title}
    <div class="hud-pill">
      {#if spinning}
        <span class="hud-spinner" aria-hidden="true"></span>
      {/if}
      <span class="hud-title">{title}</span>
    </div>
  {/if}
</div>

<style>
  :global(html, body) {
    margin: 0;
    padding: 0;
    background: transparent !important;
    overflow: hidden;
  }

  .hud-root {
    width: 100vw;
    height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
  }

  /*
    Raycast-style HUD pill — frosted glass, no visible border.

    Key choices to match Raycast's look:
    - Warm coffee-brown base (rgb 68, 56, 58) — significantly warmer
      than a cool neutral grey, gives the pill its characteristic
      "smoky" feel.
    - Low base opacity (0.62) so the desktop colors REALLY bleed through
      the blur. On a dark wallpaper this still reads as dark warm; on a
      colorful wallpaper it picks up the wallpaper's hues like Raycast.
    - Heavy blur (60px) + strong saturation boost (200%) — what makes
      backdrop-filter feel like glass instead of plain transparency.
    - ZERO visible borders. No `border: 1px solid ...`, no inset/outset
      `box-shadow` ring. Raycast's pill has a perfectly clean edge —
      only the soft drop shadow tells you where it ends.
    - One large soft drop shadow lifts it off the desktop.

    Intentionally NOT using theme variables — this window is a standalone
    Tauri webview with no theme injection, so anything depending on
    `--bg-popup`, `--text-primary`, etc. would render as the unstyled
    fallback.
  */
  .hud-pill {
    padding: 16px 32px;
    background: rgba(68, 56, 58, 0.62);
    backdrop-filter: blur(60px) saturate(200%);
    -webkit-backdrop-filter: blur(60px) saturate(200%);
    border-radius: 9999px;
    display: inline-flex;
    align-items: center;
    gap: 12px;
    /*
      No box-shadow. The combination of an OS window shadow on a
      rectangular Tauri window + a CSS box-shadow on a pill that's
      smaller than the window creates a visible dark halo where the
      shadows clip against the window bounds. Both must be off:
      tauri.conf.json sets `"shadow": false`, and there's no CSS
      box-shadow here. The pill sits flat against the desktop — same
      as Raycast's HUD, which also has no visible drop shadow.
    */
    color: rgba(255, 255, 255, 0.97);
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display',
      'SF Pro Text', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    font-size: 15px;
    font-weight: 600;
    line-height: 1.3;
    letter-spacing: -0.01em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: calc(100vw - 40px);
  }

  /*
    Linux WebKitGTK doesn't reliably support backdrop-filter — fall back
    to a more opaque flat fill so the pill stays readable.
  */
  :global(html[data-platform='linux']) .hud-pill {
    background: rgba(68, 56, 58, 0.94);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }

  /*
    Spinner — concentric ring with one accent arc that rotates. Color and
    weight intentionally match the pill's text so the spinner reads as
    part of the title row, not a separate decoration.
  */
  .hud-spinner {
    display: inline-block;
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    border-radius: 50%;
    border: 2px solid rgba(255, 255, 255, 0.25);
    border-top-color: rgba(255, 255, 255, 0.95);
    animation: hud-spin 0.85s linear infinite;
  }

  .hud-title {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  @keyframes hud-spin {
    to { transform: rotate(360deg); }
  }
</style>
