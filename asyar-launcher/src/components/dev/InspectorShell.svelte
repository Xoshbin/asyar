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
            onclick={() => inspectorStore.setActiveTab('runtime')}
          >Runtime</button>
          <button
            type="button"
            class:active={inspectorStore.activeTab === 'state'}
            onclick={() => inspectorStore.setActiveTab('state')}
          >State</button>
          <button
            type="button"
            class:active={inspectorStore.activeTab === 'subscriptions'}
            onclick={() => inspectorStore.setActiveTab('subscriptions')}
          >Subs</button>
          <button
            type="button"
            class:active={inspectorStore.activeTab === 'events'}
            onclick={() => inspectorStore.setActiveTab('events')}
          >Events</button>
          <button
            type="button"
            class:active={inspectorStore.activeTab === 'rpc'}
            onclick={() => inspectorStore.setActiveTab('rpc')}
          >RPCs</button>
          <button
            type="button"
            class:active={inspectorStore.activeTab === 'ipc'}
            onclick={() => inspectorStore.setActiveTab('ipc')}
          >IPC</button>
          <button
            type="button"
            class:active={inspectorStore.activeTab === 'help'}
            onclick={() => inspectorStore.setActiveTab('help')}
          >Help</button>
        </nav>

        <div class="panel-body">
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
    z-index: 200;
    display: flex;
    flex-direction: column;
    background: var(--color-surface-1, #1a1a1a);
    color: var(--color-text, #ddd);
    border-left: 1px solid var(--color-border, #333);
    font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, sans-serif);
    font-size: 12px;
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border-bottom: 1px solid var(--color-border, #333);
    background: var(--color-surface-2, #141414);
  }
  .title {
    font-weight: 600;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-text-muted, #999);
  }
  .close-btn {
    border: 0;
    background: transparent;
    color: var(--color-text, #ddd);
    cursor: pointer;
    padding: 2px 6px;
    font-size: 12px;
    border-radius: 3px;
  }
  .close-btn:hover {
    background: rgba(255, 255, 255, 0.08);
  }
  .body {
    flex: 1;
    display: grid;
    grid-template-columns: 180px 1fr;
    min-height: 0;
  }
  .sidebar {
    border-right: 1px solid var(--color-border, #333);
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: var(--color-surface-1b, #161616);
  }
  .main {
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
  }
  .tabs {
    display: flex;
    gap: 2px;
    padding: 4px 4px 0;
    border-bottom: 1px solid var(--color-border, #333);
  }
  .tabs button {
    border: 0;
    background: transparent;
    color: var(--color-text-muted, #888);
    padding: 6px 10px;
    font-size: 11px;
    cursor: pointer;
    border-radius: 3px 3px 0 0;
  }
  .tabs button:hover {
    color: var(--color-text, #ddd);
    background: rgba(255, 255, 255, 0.03);
  }
  .tabs button.active {
    color: var(--color-text, #ddd);
    background: var(--color-surface-2, #141414);
    border-bottom: 1px solid var(--color-surface-2, #141414);
    margin-bottom: -1px;
  }
  .panel-body {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }
  .empty-state {
    padding: 16px;
    color: var(--color-text-muted, #888);
    font-style: italic;
    font-size: 12px;
  }
</style>
