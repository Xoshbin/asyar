<!--
  The one renderer for every icon kind. Extension images only ever reach an
  <img>, never {@html}, so script inside an SVG cannot run.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  import { toResolvedIcon, type IconSource } from '../../lib/icon';

  let {
    icon,
    size = 16,
    glyphSize = size,
    emojiSize = Math.round(size * 0.75),
    tile = false,
    alt = '',
    fallback,
  }: {
    icon: IconSource;
    /** Box size in px; images and emoji fill it. */
    size?: number;
    /** Glyph size in px when it should sit smaller than the box. */
    glyphSize?: number;
    /** Font size in px for emoji and text icons. */
    emojiSize?: number;
    /** Draw glyphs on the accent tile used by built-in rows. */
    tile?: boolean;
    alt?: string;
    /** Rendered when there is no icon or the image fails to load. */
    fallback?: Snippet;
  } = $props();

  const resolved = $derived(toResolvedIcon(icon));
  const src = $derived(
    resolved?.kind === 'image' ? resolved.src : resolved?.kind === 'remote' ? resolved.url : null,
  );
  let failedSrc = $state<string | null>(null);
</script>

{#if resolved?.kind === 'glyph'}
  <span class="app-icon" class:app-icon-tile={tile} style:width="{size}px" style:height="{size}px">
    <Icon name={resolved.name} size={glyphSize} />
  </span>
{:else if src && src !== failedSrc}
  <img
    class="app-icon"
    {src}
    {alt}
    width={size}
    height={size}
    decoding="async"
    onerror={() => (failedSrc = src)}
  />
{:else if resolved?.kind === 'emoji'}
  <span
    class="app-icon app-icon-emoji"
    style:width="{size}px"
    style:height="{size}px"
    style:font-size="{emojiSize}px">{resolved.value}</span
  >
{:else if fallback}
  {@render fallback()}
{/if}

<style>
  .app-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    line-height: 1;
    object-fit: contain;
    border-radius: var(--radius-xs);
  }

  .app-icon-tile {
    border-radius: var(--radius-sm);
    background-color: var(--accent-primary-fill);
    color: var(--text-on-accent);
  }
</style>
