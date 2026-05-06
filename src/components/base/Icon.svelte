<script lang="ts">
  import { icons } from '../../lib/icons';
  import { sfSymbolFor, sfSymbolMask, type SymbolMask } from '../../lib/sfSymbols';

  let {
    name,
    size = 20,
    class: className = '',
    strokeWidth = 1.5,
    variant = 'lucide',
  }: {
    name: string;
    size?: number;
    class?: string;
    strokeWidth?: number;
    /** 'sf' opts into the SF Symbols mask on macOS, falling back to Lucide
     * when the symbol is unmapped or the OS doesn't ship it. */
    variant?: 'lucide' | 'sf';
  } = $props();

  let sfSymbol = $derived(variant === 'sf' ? sfSymbolFor(name) : null);
  let mask = $state<SymbolMask | null>(null);

  $effect(() => {
    if (!sfSymbol) {
      mask = null;
      return;
    }
    let cancelled = false;
    sfSymbolMask(name, size).then(m => {
      if (!cancelled) mask = m;
    });
    return () => { cancelled = true; };
  });
</script>

{#if mask}
  <span
    class={`sf-mask ${className}`}
    style="
      --sf-mask: url('{mask.url}');
      width: {size}px;
      height: {size}px;
    "
    aria-hidden="true"
  ></span>
{:else if icons[name]}
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

<style>
  .sf-mask {
    display: block;
    flex-shrink: 0;
    background-color: currentColor;
    -webkit-mask-image: var(--sf-mask);
    mask-image: var(--sf-mask);
    -webkit-mask-size: contain;
    mask-size: contain;
    -webkit-mask-repeat: no-repeat;
    mask-repeat: no-repeat;
    -webkit-mask-position: center;
    mask-position: center;
  }
</style>
