<script lang="ts">
  let { image, lean = 'right' }: { image: string; lean?: 'left' | 'right' } = $props()
</script>

<div class="stage" class:stage--left={lean === 'left'}>
  <img class="stage__bloom" src={image} alt="" aria-hidden="true" />
  <img class="stage__hero" src={image} alt="" />
</div>

<style>
  .stage { position: relative; height: 100%; overflow: hidden; }
  .stage__bloom,
  .stage__hero {
    position: absolute;
    top: 50%;
    left: 52%;
    width: 130%;
    border-radius: var(--radius-lg);
    transform: translate(-26%, -50%) rotate(6deg);
  }
  .stage__bloom {
    filter: blur(48px) saturate(1.4);
    opacity: 0.6;
    transform: translate(-26%, -50%) rotate(6deg) scale(1.12);
  }
  .stage__hero {
    box-shadow: var(--shadow-xl);
    border: 1px solid var(--border-color);
  }
  .stage--left .stage__hero { left: 48%; transform: translate(-74%, -50%) rotate(-6deg); }
  .stage--left .stage__bloom { left: 48%; transform: translate(-74%, -50%) rotate(-6deg) scale(1.12); }
  /* fade the INNER edge so the image melts into the content side */
  .stage::after {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: linear-gradient(90deg, var(--bg-popup), transparent 24%);
  }
  .stage--left::after { background: linear-gradient(270deg, var(--bg-popup), transparent 24%); }
</style>
