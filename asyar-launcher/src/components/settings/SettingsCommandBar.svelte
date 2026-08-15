<script lang="ts">
  import { Badge, Icon } from '..';
  import { developmentBuildIndicator } from '../../lib/developmentBuild';
  import { getCommandBarKeyAction } from './settingsCommandBar.logic';
  import { platform } from '@tauri-apps/plugin-os';

  let {
    query = $bindable(''),
  }: {
    query: string;
  } = $props();

  // Module-scope pattern matches src/services/action/actionService.svelte.ts's
  // existing sync platform check — the settings window has no `data-platform`
  // attribute of its own to read (only the launcher/onboarding layouts set it).
  const IS_MACOS = (() => {
    try {
      return platform() === 'macos';
    } catch {
      return true;
    }
  })();
  const SEARCH_HINT = IS_MACOS ? '⌘F' : 'Ctrl+F';

  let inputEl = $state<HTMLInputElement | undefined>();
  let isFocused = $state(false);

  function handleKeydown(e: KeyboardEvent) {
    const action = getCommandBarKeyAction(e, isFocused, query.trim().length > 0);
    if (action === 'focus-search') {
      e.preventDefault();
      inputEl?.focus();
    } else if (action === 'clear-search') {
      e.preventDefault();
      query = '';
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="command-bar" data-tauri-drag-region>
  <span class="command-bar-title" data-tauri-drag-region>Asyar Settings</span>

  <div class="command-bar-search-wrap">
    <label class="command-bar-search" class:focused={isFocused}>
      <Icon name="search" size={13} strokeWidth={2} class="command-bar-search-icon" />
      <input
        bind:this={inputEl}
        bind:value={query}
        onfocus={() => (isFocused = true)}
        onblur={() => (isFocused = false)}
        type="text"
        placeholder="Search every setting…"
        aria-label="Search settings"
        class="command-bar-input"
      />
      <span class="command-bar-hint">{SEARCH_HINT}</span>
    </label>
  </div>

  {#if developmentBuildIndicator}
    <span
      class="command-bar-dev-badge"
      title={developmentBuildIndicator.title}
      aria-label={developmentBuildIndicator.title}
    >
      <Badge text={developmentBuildIndicator.text} variant="warning" mono bordered />
    </span>
  {/if}
</div>

<style>
  .command-bar {
    display: flex;
    align-items: center;
    gap: var(--space-7);
    height: var(--shell-header-h);
    padding: 0 var(--space-6);
    background: var(--bg-primary);
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  .command-bar-title {
    font-size: var(--font-size-md);
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
  }

  .command-bar-search-wrap {
    flex: 1;
    display: flex;
    justify-content: center;
    min-width: 0;
  }

  .command-bar-search {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    max-width: 460px;
    padding: var(--space-3) var(--space-5);
    border-radius: var(--radius-lg);
    background: var(--bg-secondary-full-opacity);
    border: 1px solid var(--border-color);
    transition: border-color var(--transition-fast);
  }

  .command-bar-search.focused {
    border-color: var(--accent-primary);
    box-shadow: var(--shadow-focus);
  }

  :global(.command-bar-search-icon) {
    color: var(--text-tertiary);
    flex-shrink: 0;
  }

  .command-bar-input {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: none;
    outline: none;
    font-size: var(--font-size-md);
    color: var(--text-primary);
    font-family: var(--font-ui);
  }

  .command-bar-input::placeholder {
    color: var(--text-tertiary);
  }

  .command-bar-hint {
    font-family: var(--font-mono);
    font-size: var(--font-size-2xs);
    color: var(--text-tertiary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-xs);
    padding: var(--space-0-5) var(--space-2);
    flex-shrink: 0;
  }

  .command-bar-dev-badge {
    flex-shrink: 0;
  }
</style>
