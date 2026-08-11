<script lang="ts">
  import { icons } from '../../lib/icons';

  let {
    name,
    size = 20,
    class: className = '',
    strokeWidth = 1.5,
  }: {
    name: string;
    size?: number;
    class?: string;
    strokeWidth?: number;
  } = $props();

  $effect(() => {
    if (import.meta.env.DEV && !icons[name]) {
      console.warn(`Icon: unrecognized icon name "${name}" — rendering a blank placeholder.`);
    }
  });
</script>

{#if icons[name]}
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width={strokeWidth}
    stroke-linecap="round"
    stroke-linejoin="round"
    class={className}
  >
    {@html icons[name]}
  </svg>
{:else}
  <span class="inline-block" style="width: {size}px; height: {size}px;"></span>
{/if}
