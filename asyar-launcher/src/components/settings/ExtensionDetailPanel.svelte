<script lang="ts">
  import { Badge, Toggle } from '../index';
  import type { ExtensionItem } from '../../routes/settings/settingsHandlers.svelte';
  import type { ExtensionCommand } from 'asyar-sdk';

  let {
    extension = null,
    command = null,
    isToggling = false,
    isUninstalling = false,
    onToggle,
    onUninstall,
  }: {
    extension?: ExtensionItem | null;
    command?: { cmd: ExtensionCommand; parent: ExtensionItem } | null;
    isToggling?: boolean;
    isUninstalling?: boolean;
    onToggle?: (ext: ExtensionItem) => void;
    onUninstall?: (ext: ExtensionItem) => void;
  } = $props();
</script>

{#if command}
  <div class="panel-header">
    <div class="panel-icon">
      {command.parent.title[0]?.toUpperCase() ?? 'E'}
    </div>
    <div class="panel-meta">
      <div class="panel-title">{command.cmd.name}</div>
      <div class="panel-parent">{command.parent.title}</div>
    </div>
  </div>

  <div class="panel-body">
    {#if command.cmd.description}
      <div class="panel-section">
        <div class="section-header">Description</div>
        <p class="panel-desc">{command.cmd.description}</p>
      </div>
    {/if}

    <div class="panel-section">
      <div class="section-header">Trigger</div>
      <code class="trigger-chip text-mono">{command.cmd.trigger}</code>
    </div>

    <div class="panel-section">
      <div class="section-header">Alias</div>
      <span class="placeholder-action">Add alias…</span>
    </div>

    <div class="panel-section">
      <div class="section-header">Hotkey</div>
      <span class="placeholder-action">Record hotkey…</span>
    </div>
  </div>

{:else if extension}
  <div class="panel-header">
    <div class="panel-icon">
      {#if extension.iconUrl}
        <img src={extension.iconUrl} alt={extension.title} class="icon-img" />
      {:else}
        {extension.title[0]?.toUpperCase() ?? 'E'}
      {/if}
    </div>
    <div class="panel-meta">
      <div class="panel-title">{extension.title}</div>
    </div>
    <div class="panel-actions">
      <Toggle
        checked={extension.enabled === true}
        disabled={isToggling}
        onchange={() => onToggle?.(extension!)}
      />
      <button
        class="uninstall-btn"
        onclick={() => onUninstall?.(extension!)}
        disabled={isUninstalling}
      >
        {isUninstalling ? 'Uninstalling…' : 'Uninstall'}
      </button>
    </div>
  </div>

  <div class="panel-body">
    {#if extension.subtitle}
      <div class="panel-section">
        <div class="section-header">Description</div>
        <p class="panel-desc">{extension.subtitle}</p>
      </div>
    {/if}

    <div class="panel-section panel-badges">
      {#if extension.type}
        <Badge text={extension.type.toUpperCase()} variant="info" />
      {/if}
      {#if extension.version}
        <Badge text="v{extension.version}" variant="default" mono />
      {/if}
      {#if extension.compatibility?.status === 'sdkMismatch'}
        <Badge text="Requires SDK {extension.compatibility.required}" variant="danger" />
      {/if}
      {#if extension.compatibility?.status === 'appVersionTooOld'}
        <Badge text="Requires app v{extension.compatibility.required}+" variant="danger" />
      {/if}
      {#if extension.compatibility?.status === 'platformNotSupported'}
        <Badge text="{extension.compatibility.platform} not supported" variant="danger" />
      {/if}
    </div>
  </div>

{:else}
  <div class="empty-panel">
    <p class="empty-panel-text">Select an extension or command</p>
  </div>
{/if}

<style>
  .panel-header {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-4) var(--space-3);
    border-bottom: 1px solid var(--separator);
  }

  .panel-icon {
    width: 36px;
    height: 36px;
    border-radius: var(--radius-md);
    background: var(--bg-tertiary);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--font-size-lg);
    font-weight: 600;
    color: var(--text-secondary);
    flex-shrink: 0;
  }

  .icon-img {
    width: 22px;
    height: 22px;
  }

  .panel-meta {
    flex: 1;
    min-width: 0;
  }

  .panel-title {
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--text-primary);
  }

  .panel-parent {
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
    margin-top: var(--space-1);
  }

  .panel-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-shrink: 0;
    margin-top: var(--space-1);
  }

  .uninstall-btn {
    font-size: var(--font-size-xs);
    color: var(--accent-danger);
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    transition: var(--transition-fast);
  }

  .uninstall-btn:hover {
    opacity: 0.8;
  }

  .uninstall-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .panel-body {
    padding: var(--space-3) var(--space-4);
  }

  .panel-section {
    margin-bottom: var(--space-4);
  }

  .panel-badges {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .panel-desc {
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    line-height: 1.5;
  }

  .trigger-chip {
    display: inline-block;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-xs);
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
  }

  .placeholder-action {
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
    font-style: italic;
  }

  .empty-panel {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: var(--space-8);
  }

  .empty-panel-text {
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
  }
</style>
