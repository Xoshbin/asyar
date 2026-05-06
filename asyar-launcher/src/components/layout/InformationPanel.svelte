<script lang="ts">
  import type { ExtensionManifest } from 'asyar-sdk/contracts';
  import { viewManager } from '../../services/extension/viewManager.svelte';
  import { isIconImage, isBuiltInIcon, getBuiltInIconName } from '../../lib/iconUtils';
  import Icon from '../base/Icon.svelte';

  let {
    activeViewManifest = null
  }: {
    activeViewManifest?: ExtensionManifest | null;
  } = $props();

  let icon = $derived(activeViewManifest?.icon ?? '🧩');
  let name = $derived(activeViewManifest?.name ?? '');
</script>

{#if activeViewManifest}
  <div class="info-chip">
    <span class="info-chip-badge">
      {#if isBuiltInIcon(icon)}
        <Icon name={getBuiltInIconName(icon)} size={14} />
      {:else if isIconImage(icon)}
        <img src={icon} alt="" class="info-chip-img" />
      {:else}
        <span class="info-chip-emoji">{icon}</span>
      {/if}
    </span>
    <span class="info-chip-label">{name}</span>
    {#if viewManager.activeViewSubtitle}
      <span class="info-chip-subtitle">{viewManager.activeViewSubtitle}</span>
    {/if}
  </div>
{/if}

<style>
  .info-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
  }
  .info-chip-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    flex-shrink: 0;
    border-radius: var(--radius-sm);
    background-color: var(--accent-primary);
    color: #fff;
  }
  .info-chip-img {
    width: 14px;
    height: 14px;
    object-fit: contain;
  }
  .info-chip-emoji {
    font-size: 13px;
    line-height: 1;
  }
  .info-chip-label {
    font-weight: 600;
    color: var(--text-primary);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .info-chip-subtitle {
    font-size: var(--font-size-xs);
    font-weight: 500;
    color: var(--text-secondary);
    flex-shrink: 0;
  }
</style>
