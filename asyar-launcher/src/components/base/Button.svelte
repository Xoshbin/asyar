<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    type = "button",
    disabled = false,
    fullWidth = false,
    class: className = '',
    onclick,
    children,
    ...rest
  }: {
    type?: "button" | "submit";
    disabled?: boolean;
    fullWidth?: boolean;
    class?: string;
    onclick?: (e: MouseEvent) => void;
    children?: Snippet;
    [key: string]: any;
  } = $props();
</script>

<button
  {type}
  {disabled}
  {onclick}
  class="btn {className}"
  class:btn-full={fullWidth}
  {...rest}
>
  <span class="result-title">
    {@render children?.()}
  </span>
</button>
