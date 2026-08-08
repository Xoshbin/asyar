<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';
  import ExtensionNav from './ExtensionNav.svelte';
  import HelpPanel from './HelpPanel.svelte';
  import PanelRuntime from './PanelRuntime.svelte';
  import PanelState from './PanelState.svelte';
  import PanelSubscriptions from './PanelSubscriptions.svelte';
  import PanelEvents from './PanelEvents.svelte';
  import PanelRpc from './PanelRpc.svelte';
  import PanelIpc from './PanelIpc.svelte';
  import { inspectorStore } from '../../services/dev/inspectorStore.svelte';
  import { logService } from '../../services/log/logService';

  // Dev-only side panel. Rendering of this component is gated in the route
  // by `{#if import.meta.env.DEV}` + dynamic import, so the module never
  // enters the production bundle. Keep the module side-effect-free (no
  // top-level window listeners) so tree-shaking stays predictable.

  const EXPANDED_WIDTH = 1400;

  let originalWidth: number | null = null;

  async function resizeWindow(targetWidth: number) {
    try {
      const win = getCurrentWindow();
      const size = await win.innerSize();
      const scale = await win.scaleFactor();
      const heightLogical = size.height / scale;
      if (originalWidth === null) {
        originalWidth = size.width / scale;
      }
      await win.setSize(new LogicalSize(targetWidth, heightLogical));
    } catch (err) {
      logService.debug(`[dev-inspector] resize failed: ${err}`);
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    const isDKey = event.key === 'D' || event.key === 'd' || event.code === 'KeyD';
    if (isDKey && event.metaKey && event.shiftKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      inspectorStore.toggle();
    }
  }

  $effect(() => {
    const isOpen = inspectorStore.isOpen;
    untrack(() => {
      if (isOpen) {
        void resizeWindow(EXPANDED_WIDTH);
        void inspectorStore.start();
      } else {
        void inspectorStore.stop();
        if (originalWidth !== null) {
          void resizeWindow(originalWidth);
        }
      }
    });
  });

  $effect(() => {
    if (inspectorStore.isOpen) {
      document.body.classList.add('asyar-dev-inspector-open');
      return () => document.body.classList.remove('asyar-dev-inspector-open');
    }
  });

  onMount(() => {
    window.addEventListener('keydown', handleKeydown, true);
    return () => {
      window.removeEventListener('keydown', handleKeydown, true);
      document.body.classList.remove('asyar-dev-inspector-open');
      void inspectorStore.stop();
    };
  });

  function onSelectExtension(id: string) {
    inspectorStore.selectExtension(id);
  }
</script>

{#if inspectorStore.isOpen}
  <aside class="dev-inspector" aria-label="Asyar Dev Inspector">
    <header class="header">
      <div class="title">Asyar DevEx</div>
      <button
        type="button"
        class="close-btn"
        onclick={() => (inspectorStore.isOpen = false)}
        title="Close (⌘⇧D)"
      >
        ✕
      </button>
    </header>

    <div class="body">
      <div class="sidebar">
        <ExtensionNav
          selectedId={inspectorStore.selectedExtensionId}
          onselect={onSelectExtension}
        />
      </div>

      <div class="main">
        <nav class="tabs" aria-label="Inspector sections">
          <button
            type="button"
            class:active={inspectorStore.activeTab === 'runtime'}
            onclick={() => inspectorStore.setActiveTab('runtime')}>Runtime</button
          >
          <button
            type="button"
            class:active={inspectorStore.activeTab === 'state'}
            onclick={() => inspectorStore.setActiveTab('state')}>State</button
          >
          <button
            type="button"
            class:active={inspectorStore.activeTab === 'subscriptions'}
            onclick={() => inspectorStore.setActiveTab('subscriptions')}>Subs</button
          >
          <button
            type="button"
            class:active={inspectorStore.activeTab === 'events'}
            onclick={() => inspectorStore.setActiveTab('events')}>Events</button
          >
          <button
            type="button"
            class:active={inspectorStore.activeTab === 'rpc'}
            onclick={() => inspectorStore.setActiveTab('rpc')}>RPCs</button
          >
          <button
            type="button"
            class:active={inspectorStore.activeTab === 'ipc'}
            onclick={() => inspectorStore.setActiveTab('ipc')}>IPC</button
          >
          <button
            type="button"
            class:active={inspectorStore.activeTab === 'help'}
            onclick={() => inspectorStore.setActiveTab('help')}>Help</button
          >
        </nav>

        <div class="panel-body custom-scrollbar">
          {#if inspectorStore.activeTab === 'help'}
            <HelpPanel />
          {:else if inspectorStore.selectedExtensionId === null}
            <div class="empty-state">Select an extension from the sidebar</div>
          {:else if inspectorStore.activeTab === 'runtime'}
            <PanelRuntime />
          {:else if inspectorStore.activeTab === 'state'}
            <PanelState />
          {:else if inspectorStore.activeTab === 'subscriptions'}
            <PanelSubscriptions />
          {:else if inspectorStore.activeTab === 'events'}
            <PanelEvents />
          {:else if inspectorStore.activeTab === 'rpc'}
            <PanelRpc />
          {:else if inspectorStore.activeTab === 'ipc'}
            <PanelIpc />
          {/if}
        </div>
      </div>
    </div>
  </aside>
{/if}

<style>
  .dev-inspector {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: 660px;
    z-index: var(--z-overlay);
    display: flex;
    flex-direction: column;
    background: var(--bg-primary);
    color: var(--text-primary);
    border-left: 1px solid var(--border-color);
    font-family: var(--font-ui);
    font-size: var(--font-size-sm);
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-3) var(--space-5);
    border-bottom: 1px solid var(--border-color);
    background: var(--bg-secondary);
  }
  .title {
    font-weight: 600;
    font-size: var(--font-size-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-secondary);
  }
  .close-btn {
    border: 0;
    background: transparent;
    color: var(--text-primary);
    cursor: pointer;
    padding: var(--space-0-5) var(--space-2);
    font-size: var(--font-size-sm);
    border-radius: var(--radius-xs);
  }
  .close-btn:hover {
    background: var(--bg-hover);
  }
  .body {
    flex: 1;
    display: grid;
    grid-template-columns: 180px 1fr;
    min-height: 0;
  }
  .sidebar {
    border-right: 1px solid var(--border-color);
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: var(--bg-secondary);
  }
  .main {
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
  }
  .tabs {
    display: flex;
    gap: var(--space-0-5);
    padding: var(--space-1) var(--space-1) 0;
    border-bottom: 1px solid var(--border-color);
  }
  .tabs button {
    border: 0;
    background: transparent;
    color: var(--text-secondary);
    padding: var(--space-2) var(--space-4);
    font-size: var(--font-size-xs);
    cursor: pointer;
    border-radius: var(--radius-xs) var(--radius-xs) 0 0;
  }
  .tabs button:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }
  .tabs button.active {
    color: var(--text-primary);
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--bg-secondary);
    margin-bottom: -var(--space-0-5);
  }
  .panel-body {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }
  .empty-state {
    padding: var(--space-6);
    color: var(--text-secondary);
    font-style: italic;
    font-size: var(--font-size-sm);
  }
</style>
