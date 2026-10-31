<script lang="ts">
  import type { ExtendedManifest } from '../../types/ExtendedManifest';
  import { viewManager } from '../../services/extension/viewManager.svelte';
  import AppIcon from '../base/AppIcon.svelte';

  let {
    activeViewManifest = null,
  }: {
    activeViewManifest?: ExtendedManifest | null;
  } = $props();

  let icon = $derived(activeViewManifest?.resolvedIcon ?? '🧩');
  let name = $derived(activeViewManifest?.name ?? '');
</script>

{#if activeViewManifest}
  <div class="info-chip">
    <span class="info-chip-badge">
      <AppIcon {icon} size={14} />
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
    width: var(--size-md);
    height: var(--size-md);
    flex-shrink: 0;
    border-radius: var(--radius-sm);
    background-color: var(--accent-primary-fill);
    color: var(--text-on-accent);
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
