<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    type = "button",
    disabled = false,
    fullWidth = false,
    class: className = '',
    onclick,
    children
  }: {
    type?: "button" | "submit";
    disabled?: boolean;
    fullWidth?: boolean;
    class?: string;
    onclick?: (e: MouseEvent) => void;
    children?: Snippet;
  } = $props();
</script>

<button
  {type}
  {disabled}
  {onclick}
  class="btn {className}"
  class:btn-full={fullWidth}
>
  <span class="result-title">
    {@render children?.()}
  </span>
</button>
