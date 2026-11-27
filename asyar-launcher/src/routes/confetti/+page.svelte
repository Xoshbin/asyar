<script lang="ts">
  import { onMount } from 'svelte';
  import { listen } from '@tauri-apps/api/event';
  import { BURST_MS, draw, fire, step, type Piece } from './confetti';

  let canvas: HTMLCanvasElement;
  let frame = 0;

  // The window starts at 1×1 and Rust resizes it just before emitting, so on
  // the first burst the webview can still report the old size.
  function whenSized(): Promise<void> {
    return new Promise((resolve) => {
      const check = () =>
        window.innerWidth > 1 && window.innerHeight > 1 ? resolve() : requestAnimationFrame(check);
      check();
    });
  }

  async function burst() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    await whenSized();
    const dpr = window.devicePixelRatio || 1;
    const w = (canvas.width = window.innerWidth * dpr);
    const h = (canvas.height = window.innerHeight * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // One shot from each bottom corner.
    let pieces: Piece[] = [...fire(0, h, 60, 200, w, h, dpr), ...fire(w, h, 120, 200, w, h, dpr)];

    cancelAnimationFrame(frame);
    const start = performance.now();
    let last = start;
    const tick = (now: number) => {
      const dt = Math.min((now - last) / (1000 / 60), 3);
      last = now;
      const progress = (now - start) / BURST_MS;
      ctx.clearRect(0, 0, w, h);
      if (progress >= 1) return;
      ctx.globalAlpha = progress < 0.75 ? 1 : (1 - progress) / 0.25;
      pieces = pieces.filter((p) => p.y < h + 50);
      for (const p of pieces) {
        step(p, dt);
        draw(ctx, p);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  }

  onMount(() => {
    const unlisten = listen('confetti:burst', burst);
    return () => {
      cancelAnimationFrame(frame);
      void unlisten.then((fn) => fn());
    };
  });
</script>

<canvas bind:this={canvas}></canvas>

<style>
  :global(html, body) {
    margin: 0;
    background: transparent !important;
    overflow: hidden;
  }
  canvas {
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100vh;
    pointer-events: none;
  }
</style>
