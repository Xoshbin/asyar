<script lang="ts">
  import { onDestroy } from 'svelte'
  import { ListItem, EmptyState, ActionFooter } from '../../components'
  import { windowManagementState } from './state.svelte'
  import { windowManagementService } from '../../services/windowManagement/windowManagementService'
  import { feedbackService } from '../../services/feedback/feedbackService.svelte'
  import { actionService } from '../../services/action/actionService.svelte'
  import type { IStorageService } from 'asyar-sdk'
  import { ActionContext } from 'asyar-sdk'

  interface Props {
    store?: IStorageService
  }
  let { store }: Props = $props()

  let selectedId = $state<string | null>(null)
  let layouts = $derived(windowManagementState.customLayouts)

  $effect(() => {
    if (!selectedId) {
      actionService.unregisterAction('window-management:delete-layout')
      return
    }
    const id = selectedId
    const layout = layouts.find(l => l.id === id)
    if (!layout) return

    actionService.registerAction({
      id: 'window-management:delete-layout',
      title: `Delete "${layout.name}"`,
      icon: 'icon:trash',
      extensionId: 'window-management',
      category: 'window-management',
      context: ActionContext.EXTENSION_VIEW,
      execute: async () => {
        if (!store) return
        const name = layout.name
        await windowManagementState.deleteCustomLayout(id, store)
        selectedId = null
        await feedbackService.showHUD(`Deleted "${name}"`)
      },
    })

    return () => {
      actionService.unregisterAction('window-management:delete-layout')
    }
  })

  onDestroy(() => {
    actionService.unregisterAction('window-management:delete-layout')
  })
</script>

<div class="view-container">
  <div class="list custom-scrollbar">
    {#if layouts.length === 0}
      <EmptyState
        message="No custom layouts yet"
        description="Use ⌘K → Save Current Window as Layout to capture a window position."
      />
    {:else}
      <div class="section-header">Custom Layouts</div>
      {#each layouts as layout (layout.id)}
        <ListItem
          title={layout.name}
          subtitle={`${Math.round(layout.bounds.width)}x${Math.round(layout.bounds.height)} at (${Math.round(layout.bounds.x)}, ${Math.round(layout.bounds.y)})`}
          selected={selectedId === layout.id}
          onclick={() => { selectedId = layout.id }}
        >
          {#snippet leading()}
            <div class="layout-icon">⊞</div>
          {/snippet}
        </ListItem>
      {/each}
    {/if}
  </div>

  <ActionFooter>
    {#snippet right()}
      <span class="count-label">
        {layouts.length} custom {layouts.length === 1 ? 'layout' : 'layouts'}
      </span>
    {/snippet}
  </ActionFooter>
</div>

<style>
  .list {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }

  .section-header {
    padding: 6px 12px 4px;
    font-size: var(--font-size-xs);
    font-weight: 600;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .layout-icon {
    width: 32px;
    height: 32px;
    border-radius: var(--radius-md);
    background: var(--bg-tertiary);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--font-size-lg);
  }

  .count-label {
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
  }
</style>
