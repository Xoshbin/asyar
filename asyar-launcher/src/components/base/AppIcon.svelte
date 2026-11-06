<!--
  The one renderer for every icon kind. Extension images only ever reach an
  <img> or a CSS mask, never {@html}, so script inside an SVG cannot run.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  import { toResolvedIcon, type IconSource } from '../../lib/icon';
  import { resolveRemoteIcon } from '../../services/icon/remoteIconService';

  let {
    icon,
    extensionId,
    size = 16,
    glyphSize = size,
    emojiSize = Math.round(size * 0.75),
    tile = false,
    alt = '',
    fallback,
  }: {
    icon: IconSource;
    /**
     * Owner of a remote (`https://`) icon. Remote icons are fetched by the
     * host, never loaded by the webview, so the owner is required for the
     * permission check and the per-extension cache key.
     */
    extensionId?: string;
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
  const remoteUrl = $derived(resolved?.kind === 'remote' ? resolved.url : null);
  let remoteSrc = $state<string | null>(null);
  let remoteState = $state<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  let requestToken = 0;

  // Resolve remote icons after paint: typing never waits on the network, and
  // the row keeps its fallback until the host returns a local URL.
  $effect(() => {
    const url = remoteUrl;
    const owner = extensionId;
    const token = ++requestToken;

    remoteSrc = null;
    remoteState = url ? 'loading' : 'idle';
    if (!url) return;

    void resolveRemoteIcon(owner, url).then((iconUrl) => {
      if (token !== requestToken) return;
      remoteSrc = iconUrl;
      remoteState = iconUrl ? 'ready' : 'failed';
    });

    return () => {
      // A late response for an unmounted or re-rendered row must not write.
      requestToken += 1;
    };
  });

  const src = $derived(
    resolved?.kind === 'image' ? resolved.src : resolved?.kind === 'remote' ? remoteSrc : null,
  );
  const tileColor = $derived(
    // design-ok: every TileColor has a --tile-* token in style.css
    resolved?.kind === 'glyph' && resolved.color ? `var(--tile-${resolved.color})` : undefined,
  );
  let failedSrc = $state<string | null>(null);
  // Both variants are rendered and the theme picks one in CSS.
  const darkSrc = $derived(
    resolved?.kind === 'image' && resolved.dark !== failedSrc ? resolved.dark : null,
  );
</script>

{#if resolved?.kind === 'glyph'}
  <span
    class="app-icon"
    class:app-icon-tile={tile || !!resolved.color}
    class:app-icon-colored={!!resolved.color}
    style:width="{size}px"
    style:height="{size}px"
    style:background-color={tileColor}
  >
    <Icon name={resolved.name} size={glyphSize} />
  </span>
{:else if resolved?.kind === 'image' && resolved.tint}
  <span
    class="app-icon app-icon-mask"
    role={alt ? 'img' : undefined}
    aria-label={alt || undefined}
    style:width="{size}px"
    style:height="{size}px"
    style:--mask={`url("${resolved.src.replaceAll('"', '%22')}")`}
  ></span>
{:else if src && src !== failedSrc}
  <img
    class="app-icon"
    class:app-icon-light={darkSrc}
    {src}
    {alt}
    width={size}
    height={size}
    decoding="async"
    onerror={() => (failedSrc = src)}
  />
  {#if darkSrc}
    <img
      class="app-icon app-icon-dark"
      src={darkSrc}
      {alt}
      width={size}
      height={size}
      decoding="async"
      onerror={() => (failedSrc = darkSrc ?? null)}
    />
  {/if}
{:else if resolved?.kind === 'remote'}
  {#if fallback && (remoteState === 'failed' || remoteSrc === failedSrc)}
    {@render fallback()}
  {:else if remoteState !== 'ready' || remoteSrc === failedSrc}
    <span
      class="app-icon app-icon-placeholder"
      aria-hidden="true"
      style:width="{size}px"
      style:height="{size}px"
    ></span>
  {/if}
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

  /* Remote icons resolve after paint; this keeps the row's layout stable
     without showing a broken image or the extension's live URL. */
  .app-icon-placeholder {
    background-color: var(--bg-hover);
  }

  /* `tint: true`: the image is a one-colour mask filled with the text colour. */
  .app-icon-mask {
    background-color: currentColor;
    -webkit-mask: var(--mask) center / contain no-repeat;
    mask: var(--mask) center / contain no-repeat;
  }

  .app-icon-dark,
  :global(:root[data-theme='dark']) .app-icon-light {
    display: none;
  }
  :global(:root[data-theme='dark']) .app-icon-dark {
    display: inline-flex;
  }
  /* Before a theme is applied, follow the OS like the tokens in style.css. */
  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme])) .app-icon-light {
      display: none;
    }
    :global(:root:not([data-theme])) .app-icon-dark {
      display: inline-flex;
    }
  }
</style>
