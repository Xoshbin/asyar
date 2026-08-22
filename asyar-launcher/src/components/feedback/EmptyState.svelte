<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from '../../services/i18n';

  let {
    icon,
    message = t('common.no_items_found'),
    description,
    children,
    compact = false,
    bordered = false,
  }: {
    icon?: Snippet;
    message?: string;
    description?: string;
    children?: Snippet;
    /**
     * Inline variant for a panel or a section that is empty while the rest of
     * the view still has content — it drops the full-height centring and the
     * display-size icon. Use the default (full) variant when the empty state
     * IS the whole view.
     */
    compact?: boolean;
    /**
     * Dashed outline, for the "nothing here yet — add one" case where the
     * empty state doubles as the affordance to create the first item. Pair it
     * with a Button in the children snippet.
     */
    bordered?: boolean;
  } = $props();
</script>

<div class="empty-state" class:compact class:bordered>
  {#if icon}
    <div class="empty-state-icon">
      {@render icon()}
    </div>
  {/if}
  <div class="empty-state-message text-title">{message}</div>
  {#if description}
    <div class="empty-state-description text-caption">{description}</div>
  {/if}
  {#if children}
    <div class="empty-state-actions">
      {@render children()}
    </div>
  {/if}
</div>

<style>
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    gap: var(--space-2);
    padding: var(--space-6);
    width: 100%;
    min-height: 100%;
  }

  .empty-state.compact {
    min-height: 0;
    padding: var(--space-4);
  }

  .empty-state.bordered {
    border: 1px dashed var(--border-color);
    border-radius: var(--radius-md);
    background: var(--bg-secondary);
    padding: var(--space-6) var(--space-4);
  }

  .empty-state-icon {
    margin-bottom: var(--space-3);
    font-size: var(--font-size-display);
    opacity: 0.6;
    color: var(--text-tertiary);
  }

  .empty-state.compact .empty-state-icon {
    margin-bottom: var(--space-1);
    font-size: var(--font-size-2xl);
  }

  .empty-state-message {
    color: var(--text-primary);
  }

  .empty-state.compact .empty-state-message {
    color: var(--text-secondary);
  }

  .empty-state-description {
    max-width: 240px;
    color: var(--text-secondary);
  }
</style>
