<script lang="ts">
  import { onMount } from 'svelte';
  import AppIcon from '../../../components/base/AppIcon.svelte';
  import KeyboardHint from '../../../components/base/KeyboardHint.svelte';
  import AliasCapture from '../../../built-in-features/aliases/AliasCapture.svelte';
  import { aliasStore } from '../../../built-in-features/aliases/aliasStore.svelte';
  import { aliasService } from '../../../built-in-features/aliases/aliasService';
  import ShortcutCapture from '../../../built-in-features/shortcuts/ShortcutCapture.svelte';
  import {
    shortcutStore,
    type ItemShortcut,
  } from '../../../built-in-features/shortcuts/shortcutStore.svelte';
  import { shortcutService } from '../../../built-in-features/shortcuts/shortcutService';
  import { toDisplayString } from '../../../built-in-features/shortcuts/shortcutFormatter';
  import { logService } from '../../../services/log/logService';
  import { t } from '../../../services/i18n';
  import type { HostCommand } from '../../../types/ExtendedManifest';
  import type { ExtensionItem } from '../settingsHandlers.svelte';

  /**
   * The command rows of one extension, with inline alias / hotkey capture.
   * Rendered inside the table's grid (expanded row) and on the drill-down page,
   * so both places configure a command the same way. Columns come from the
   * parent's `--ext-cols`.
   */
  let {
    extension,
    showType = true,
    indented = false,
    onselect,
  }: {
    extension: ExtensionItem;
    /** Render the Type cell (the table shows it for third-party rows). */
    showType?: boolean;
    /** Indent the name under its parent row (table only). */
    indented?: boolean;
    onselect?: (cmd: HostCommand) => void;
  } = $props();

  type CaptureTarget = { objectId: string; name: string; currentAlias?: string };

  let editingAliasTarget = $state<CaptureTarget | null>(null);
  let editingShortcutTarget = $state<CaptureTarget | null>(null);

  const shortcutsByObjectId = $derived(
    new Map<string, ItemShortcut>(shortcutStore.shortcuts.map((s) => [s.objectId, s])),
  );

  onMount(() => {
    void aliasStore.refresh().catch((e) => {
      logService.warn(`ExtensionCommandRows: failed to refresh alias store: ${e}`);
    });
  });

  function commandObjectId(cmd: HostCommand): string {
    return extension.id ? `cmd_${extension.id}_${cmd.id}` : '';
  }

  function openAliasCapture(cmd: HostCommand): void {
    const objectId = commandObjectId(cmd);
    if (!objectId) return;
    editingAliasTarget = {
      objectId,
      name: cmd.name,
      currentAlias: aliasStore.byObjectId.get(objectId),
    };
  }

  async function removeAlias(cmd: HostCommand): Promise<void> {
    const alias = aliasStore.byObjectId.get(commandObjectId(cmd));
    if (!alias) return;
    try {
      await aliasService.unregister(alias);
      aliasStore.removeOptimistic(alias);
    } catch (e) {
      logService.warn(`Failed to remove alias for ${cmd.name}: ${e}`);
    }
  }

  function openShortcutCapture(cmd: HostCommand): void {
    const objectId = commandObjectId(cmd);
    if (!objectId) return;
    editingShortcutTarget = { objectId, name: cmd.name };
  }

  async function saveShortcut(detail: { modifier: string; key: string }): Promise<string | true> {
    if (!editingShortcutTarget) return 'No command selected';
    const result = await shortcutService.register(
      editingShortcutTarget.objectId,
      editingShortcutTarget.name,
      'command',
      `${detail.modifier}+${detail.key}`,
    );
    if (!result.ok) {
      return `Could not assign: ${result.conflict?.itemName ?? 'Unsupported key or OS error'}`;
    }
    return true;
  }

  async function removeShortcut(cmd: HostCommand): Promise<void> {
    try {
      await shortcutService.unregister(commandObjectId(cmd));
    } catch (e) {
      logService.warn(`Failed to remove shortcut for ${cmd.name}: ${e}`);
    }
  }
</script>

{#each extension.commands ?? [] as cmd (cmd.id)}
  {@const objectId = commandObjectId(cmd)}
  {@const alias = objectId ? aliasStore.byObjectId.get(objectId) : undefined}
  {@const shortcut = objectId ? shortcutsByObjectId.get(objectId) : undefined}
  <div
    class="cmd-row"
    class:clickable={!!onselect}
    role="row"
    tabindex={onselect ? 0 : -1}
    onclick={() => onselect?.(cmd)}
    onkeydown={(e) => e.key === 'Enter' && onselect?.(cmd)}
  >
    <div class="row-name-cell" class:cmd-indent={indented}>
      <div class="cmd-icon shrink-0">
        <AppIcon icon={cmd.resolvedIcon} size={16} glyphSize={14} alt={cmd.name}>
          {#snippet fallback()}
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            >
              <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
            </svg>
          {/snippet}
        </AppIcon>
      </div>
      <span class="ext-title">{cmd.name}</span>
    </div>
    {#if showType}
      <span class="row-type">{t('settings.extensions.type_command')}</span>
    {/if}
    <span class="cell">
      {#if alias}
        <button
          type="button"
          class="alias-cell-btn"
          onclick={(e) => {
            e.stopPropagation();
            openAliasCapture(cmd);
          }}
          title={t('settings.applications.change_alias_title')}
        >
          <span class="alias-pill text-mono">{alias}</span>
        </button>
        <button
          type="button"
          class="clear-btn"
          aria-label="Remove alias for {cmd.name}"
          onclick={(e) => {
            e.stopPropagation();
            void removeAlias(cmd);
          }}
        >
          ✕
        </button>
      {:else}
        <button
          type="button"
          class="row-action-btn"
          onclick={(e) => {
            e.stopPropagation();
            openAliasCapture(cmd);
          }}
        >
          {t('settings.extensions.add_alias')}
        </button>
      {/if}
    </span>
    <span class="cell">
      {#if shortcut}
        <button
          type="button"
          class="alias-cell-btn"
          onclick={(e) => {
            e.stopPropagation();
            openShortcutCapture(cmd);
          }}
          title={t('settings.applications.reassign_hotkey_title')}
        >
          <KeyboardHint keys={toDisplayString(shortcut.shortcut)} />
        </button>
        <button
          type="button"
          class="clear-btn"
          aria-label="Remove hotkey for {cmd.name}"
          onclick={(e) => {
            e.stopPropagation();
            void removeShortcut(cmd);
          }}
        >
          ✕
        </button>
      {:else}
        <button
          type="button"
          class="row-action-btn"
          onclick={(e) => {
            e.stopPropagation();
            openShortcutCapture(cmd);
          }}
        >
          {t('settings.extensions.record_hotkey')}
        </button>
      {/if}
    </span>
    <span class="row-check">✓</span>
  </div>
{/each}

{#if editingAliasTarget}
  <AliasCapture
    objectId={editingAliasTarget.objectId}
    itemName={editingAliasTarget.name}
    itemType="command"
    currentAlias={editingAliasTarget.currentAlias}
    onsave={() => (editingAliasTarget = null)}
    oncancel={() => (editingAliasTarget = null)}
  />
{/if}

{#if editingShortcutTarget}
  <ShortcutCapture
    onsave={saveShortcut}
    oncancel={() => (editingShortcutTarget = null)}
    ondone={() => (editingShortcutTarget = null)}
    excludeObjectId={editingShortcutTarget.objectId}
  />
{/if}

<style>
  .cmd-row {
    display: grid;
    grid-template-columns: var(
      --ext-cols
    ); /* design-ok: column template supplied by the parent grid */
    align-items: center;
    padding: var(--space-2) var(--space-3) var(--space-2) var(--space-2);
    border-bottom: 1px solid var(--separator);
    outline: none;
    transition: background-color var(--dur-instant) var(--ease-travel);
  }

  .cmd-row.clickable {
    cursor: pointer;
  }

  .cmd-row:hover {
    background: var(--bg-hover);
  }

  .cmd-row:focus-visible {
    box-shadow: var(--shadow-focus);
  }

  .row-name-cell {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
  }

  .cmd-indent {
    padding-left: calc(var(--space-8) + var(--space-2));
  }

  .cmd-icon {
    width: var(--size-lg);
    height: var(--size-lg);
    border-radius: var(--radius-xs);
    background: var(--bg-tertiary);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    overflow: hidden;
  }

  .cmd-icon svg {
    width: var(--size-xs);
    height: var(--size-xs);
    color: var(--text-tertiary);
  }

  .ext-title {
    font-size: var(--font-size-sm);
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .row-type {
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
  }

  .row-check {
    font-size: var(--font-size-sm);
    color: var(--accent-primary);
    text-align: center;
  }

  .alias-cell-btn,
  .row-action-btn {
    background: transparent;
    border: none;
    padding: 0;
    cursor: pointer;
    color: var(--text-secondary);
    font-size: var(--font-size-xs);
  }

  .row-action-btn:hover {
    color: var(--accent-primary);
    text-decoration: underline;
  }

  .clear-btn {
    background: transparent;
    border: none;
    padding: 0;
    margin-left: var(--space-1);
    cursor: pointer;
    color: var(--text-tertiary);
    font-size: var(--font-size-xs);
    line-height: 1;
  }

  .clear-btn:hover {
    color: var(--accent-danger);
  }

  .alias-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 18px; /* design-ok: alias chip metric, see design language launcher-density table */
    min-width: 18px; /* design-ok: alias chip metric */
    padding: 0 var(--space-2);
    border-radius: var(--radius-xs);
    background-color: color-mix(in srgb, var(--text-primary) 8%, transparent);
    color: var(--text-secondary);
    font-size: var(--font-size-2xs);
    font-weight: 500;
    line-height: 1;
    letter-spacing: var(--tracking-normal);
    user-select: none;
  }
</style>
