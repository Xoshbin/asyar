<script lang="ts">
  import Icon from '../base/Icon.svelte';

  // `glyph: null` is the Welcome hero: the app logo, larger.
  let { glyph }: { glyph: string | null } = $props();
</script>

<div class="stage" class:stage--hero={glyph === null} aria-hidden="true">
  {#if glyph}
    <div class="stage__tile"><Icon name={glyph} size={26} strokeWidth={1.75} /></div>
  {:else}
    <img class="stage__logo" src="/app-icon.png" alt="" />
  {/if}
</div>

<style>
  .stage {
    display: grid;
    place-items: center;
    width: 56px;
    height: 56px;
    margin: 0 auto;
    animation: stage-in var(--dur-emerge) var(--ease-emerge) both;
  }
  .stage--hero {
    width: 96px;
    height: 96px;
  }
  .stage__tile {
    display: grid;
    place-items: center;
    width: 100%;
    height: 100%;
    border-radius: 28%;
    color: var(--asyar-brand);
    background: var(--bg-secondary);
    border: 1px solid var(--separator);
  }
  .stage__logo {
    width: 100%;
    height: 100%;
  }

  @keyframes stage-in {
    from {
      opacity: 0;
      transform: scale(0.92);
    }
  }
</style>
