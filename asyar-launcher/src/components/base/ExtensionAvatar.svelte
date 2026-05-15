<!-- src/components/base/ExtensionAvatar.svelte -->
<script lang="ts">
  import { nameToGradient, nameToInitials } from '../../lib/extensionAvatar';

  let {
    name,
    src = undefined,
    size = 'md',
  }: {
    name: string;
    src?: string;
    size?: 'sm' | 'md' | 'lg' | 'xl';
  } = $props();

  let imageError = $state(false);
  let gradient = $derived(nameToGradient(name));
  let initials = $derived(nameToInitials(name));
  let bg = $derived(`linear-gradient(135deg, ${gradient.from}, ${gradient.to})`);
  const sizeClass = $derived(`size-${size}`);
</script>

{#if src && !imageError}
  <div class="ext-avatar {sizeClass} image-container">
    <img {src} alt={name} onerror={() => imageError = true} />
  </div>
{:else}
  <div class="ext-avatar {sizeClass}" style="background: {bg};">
    {initials}
  </div>
{/if}

<style>
  .ext-avatar {
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    color: #fff;
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

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .size-sm { width: 36px; height: 36px; font-size: var(--font-size-sm); border-radius: var(--radius-md); }
  .size-md { width: 48px; height: 48px; font-size: var(--font-size-base); border-radius: var(--radius-lg); }
  .size-lg { width: 64px; height: 64px; font-size: var(--font-size-2xl); border-radius: var(--radius-xl); }
  .size-xl { width: 88px; height: 88px; font-size: 28px; border-radius: 16px; }
</style>
