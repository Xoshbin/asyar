<script lang="ts">
  import { onMount } from 'svelte';

  // Types `before` key by key, swaps in `after`, then loops: the scripted stand-in for a live sandbox.
  let { before, after }: { before: string; after: string } = $props();

  let text = $state('');
  let done = $state(false);

  onMount(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      text = after;
      done = true;
      return;
    }
    let tick = 0;
    const typing = before.length;
    const timer = setInterval(() => {
      tick = (tick + 1) % (typing + 30);
      done = tick > typing + 4;
      text = done ? after : before.slice(0, Math.min(tick, typing));
    }, 70);
    return () => clearInterval(timer);
  });
</script>

<p class="typing-demo" class:typing-demo--done={done} aria-label={after}>
  {text}<span class="typing-demo__caret" aria-hidden="true"></span>
</p>

<style>
  .typing-demo {
    margin: 0;
    padding: var(--space-4);
    min-height: calc(var(--font-size-md) * 5);
    font-size: var(--font-size-md);
    color: var(--text-primary);
    line-height: 1.5;
    transition: color var(--dur-quick) var(--ease-travel);
  }
  .typing-demo--done {
    color: var(--asyar-brand);
  }
  .typing-demo__caret {
    display: inline-block;
    width: 1px;
    height: 1em;
    margin-left: var(--space-1);
    vertical-align: text-bottom;
    background: currentColor;
    animation: caret-blink 1s steps(1) infinite;
  }
  @keyframes caret-blink {
    50% {
      opacity: 0;
    }
  }
</style>
