<!-- src/components/base/ExtensionAvatar.svelte -->
<script lang="ts">
  import AppIcon from './AppIcon.svelte';
  import { nameToGradient, nameToInitials } from '../../lib/extensionAvatar';
  import { toResolvedIcon, type IconSource } from '../../lib/icon';

  let {
    name,
    icon = undefined,
    size = 'md',
  }: {
    name: string;
    icon?: IconSource;
    /** A named size, or a box in px (initials scale with it). */
    size?: 'sm' | 'md' | 'lg' | 'xl' | number;
  } = $props();

  const PX = { sm: 36, md: 48, lg: 64, xl: 88 };
  let gradient = $derived(nameToGradient(name));
  let initials = $derived(nameToInitials(name));
  let bg = $derived(`linear-gradient(135deg, ${gradient.from}, ${gradient.to})`);
  const px = $derived(typeof size === 'number' ? size : PX[size]);
  const sizeClass = $derived(typeof size === 'number' ? 'size-px' : `size-${size}`);
  const pxStyle = $derived(
    typeof size === 'number'
      ? `width: ${size}px; height: ${size}px; font-size: ${Math.round(size * 0.4)}px;`
      : '',
  );
</script>

{#snippet initialsAvatar()}
  <div class="ext-avatar {sizeClass}" style="background: {bg}; {pxStyle}">
    {initials}
  </div>
{/snippet}

{#if toResolvedIcon(icon)}
  <div class="ext-avatar {sizeClass} image-container" style={pxStyle}>
    <AppIcon {icon} size={px} glyphSize={Math.round(px * 0.6)} alt={name}>
      {#snippet fallback()}
        {@render initialsAvatar()}
      {/snippet}
    </AppIcon>
  </div>
{:else}
  {@render initialsAvatar()}
{/if}

<style>
  .ext-avatar {
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    color: var(--text-on-accent);
    flex-shrink: 0;
    letter-spacing: -0.02em;
    user-select: none;
  }

  .image-container {
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    padding: 0;
    overflow: hidden;
  }

  .size-px {
    border-radius: var(--radius-sm);
  }
  .size-sm {
    width: 36px;
    height: 36px;
    font-size: var(--font-size-sm);
    border-radius: var(--radius-md);
  }
  .size-md {
    width: 48px;
    height: 48px;
    font-size: var(--font-size-base);
    border-radius: var(--radius-lg);
  }
  .size-lg {
    width: 64px;
    height: 64px;
    font-size: var(--font-size-2xl);
    border-radius: var(--radius-xl);
  }
  .size-xl {
    width: 88px;
    height: 88px;
    /* design-ok: glyph and corner scaled to the fixed 88px tile, not UI text */
    font-size: 28px;
    /* design-ok: corner proportional to the 88px tile; no radius token fits */
    border-radius: 16px;
  }
</style>
