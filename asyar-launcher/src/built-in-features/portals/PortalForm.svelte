<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { readText as readClipboardText } from 'tauri-plugin-clipboard-x-api';
  import {
    AppIcon,
    FormField,
    FormView,
    Icon,
    Input,
    PlaceholderPicker,
    SearchableSelect,
    type SelectOption,
  } from '../../components';
  import { portalStore, type Portal } from './portalStore.svelte';
  import { portalsUiState } from './index.svelte';
  import { syncAllPortalsToIndex } from './portalLifecycle';
  import { tokenizePortalLink } from './portalPlaceholders';
  import {
    browserGetActiveTab,
    fetchPortalFavicon,
    listApplications,
    portalPickPath,
    setFocusLock,
  } from '../../lib/ipc/commands';
  import { feedbackService } from '../../services/feedback/feedbackService.svelte';
  import { viewManager } from '../../services/extension/viewManager.svelte';
  import { actionService } from '../../services/action/actionService.svelte';
  import { ActionContext } from 'asyar-sdk/contracts';
  import { openUrl } from '../../lib/ipc/commands';
  import { t } from '../../services/i18n';

  let {
    portal,
    isEditing,
    onsave,
    oncancel,
  }: {
    portal?: Partial<Portal>;
    isEditing?: boolean;
    onsave?: (portal: Portal) => void | Promise<void>;
    oncancel?: () => void;
  } = $props();

  const resolvedIsEditing = $derived(
    isEditing ?? (portalsUiState.formMode === 'edit' && Boolean(portalsUiState.editingPortal)),
  );
  const resolvedPortal = $derived<Partial<Portal>>(
    portal ?? (resolvedIsEditing ? (portalsUiState.editingPortal ?? {}) : {}),
  );

  let cancelled = false;
  onDestroy(() => {
    cancelled = true;
    if (faviconTimer) clearTimeout(faviconTimer);
  });

  let name = $state('');
  let url = $state('');
  let icon = $state('icon:link');
  let openWith = $state('');
  let tagsText = $state('');
  let iconTouched = $state(false);
  let iconMenuOpen = $state(false);

  let pickerOpen = $state(false);
  let urlTextareaEl: HTMLTextAreaElement | undefined = $state();
  let triggerCursorPos = $state(-1);
  let appOptions = $state<SelectOption[]>([
    { value: '', label: t('features.portals.ui.default_app') },
  ]);

  const QUICK_ICONS = [
    'icon:link',
    'icon:globe',
    'icon:search',
    'icon:folder',
    'icon:file-text',
    'icon:terminal',
    'icon:dev-tools',
    'icon:bookmark',
    'icon:star',
    'icon:pin',
  ];
  const QUICK_EMOJIS = ['🌐', '🔗', '🔍', '📖', '🐙', '📁', '⚡', '🛠️', '📝', '🎵'];

  $effect(() => {
    name = resolvedPortal.name ?? '';
    url = resolvedPortal.url ?? '';
    icon = resolvedPortal.icon ?? 'icon:link';
    openWith = resolvedPortal.openWith ?? '';
    tagsText = (resolvedPortal.tags ?? []).join(', ');
    iconTouched = resolvedIsEditing && Boolean(resolvedPortal.icon);
  });

  const highlightedSegments = $derived(tokenizePortalLink(url));

  let faviconTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleFaviconFetch(candidateUrl: string) {
    if (iconTouched) return;
    if (faviconTimer) clearTimeout(faviconTimer);
    const trimmed = candidateUrl.trim();
    if (!/^https?:\/\/[^/\s]+/i.test(trimmed)) return;

    faviconTimer = setTimeout(async () => {
      const favicon = await fetchPortalFavicon(trimmed);
      if (!cancelled && favicon && !iconTouched) {
        icon = favicon;
      }
    }, 450);
  }

  onMount(async () => {
    try {
      const apps = await listApplications();
      const sorted = [...apps].sort((a, b) => a.name.localeCompare(b.name));
      const opts: SelectOption[] = [{ value: '', label: t('features.portals.ui.default_app') }];
      for (const app of sorted) {
        opts.push({ value: app.path, label: app.name, icon: app.icon });
      }
      if (openWith && !opts.some((o) => o.value === openWith)) {
        const byName = sorted.find((a) => a.name.toLowerCase() === openWith.trim().toLowerCase());
        if (byName) {
          openWith = byName.path;
        } else {
          opts.push({ value: openWith, label: openWith, icon: 'icon:app-window' });
        }
      }
      appOptions = opts;
    } catch {
      // Keep Default option when application index is unavailable (e.g. unit tests)
    }

    // Autofill on Create: active browser tab first, then clipboard URL/path
    if (!resolvedIsEditing && !resolvedPortal.url && !url) {
      try {
        const tab = await browserGetActiveTab().catch(() => null);
        if (!cancelled && tab?.url && /^https?:\/\//i.test(tab.url)) {
          url = tab.url;
          if (!name && tab.title) {
            name = tab.title;
          }
          scheduleFaviconFetch(tab.url);
          return;
        }
      } catch {
        // Ignore browser bridge unavailability
      }

      try {
        const clip = (await readClipboardText().catch(() => ''))?.trim() ?? '';
        if (
          !cancelled &&
          clip &&
          (/^(https?:\/\/|[a-zA-Z][a-zA-Z0-9+.-]*:\/\/)/i.test(clip) ||
            clip.startsWith('~/') ||
            clip.startsWith('/'))
        ) {
          url = clip;
          scheduleFaviconFetch(clip);
        }
      } catch {
        // Ignore clipboard errors
      }
    }
  });

  async function saveToStore(nextPortal: Portal): Promise<void> {
    try {
      if (resolvedIsEditing && resolvedPortal.id) {
        const editingId = resolvedPortal.id;
        portalStore.update(editingId, nextPortal);
        await syncAllPortalsToIndex();
      } else {
        portalStore.add(nextPortal);
        await syncAllPortalsToIndex();
        const idx = portalsUiState.filteredPortals.findIndex((p) => p.id === nextPortal.id);
        if (idx >= 0) portalsUiState.selectedIndex = idx;
      }
    } catch (err) {
      feedbackService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'error',
        retryable: false,
        context: { message: t('features.portals.ui.save_failed', { error: String(err) }) },
      });
    } finally {
      portalsUiState.clearDraft();
      if (!cancelled && viewManager.activeView === 'portals/PortalFormView') {
        viewManager.goBack();
      }
    }
  }

  async function handleSave() {
    if (!name.trim() || !url.trim()) return;
    const tags = tagsText
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

    const nextPortal: Portal = {
      id: resolvedPortal.id ?? crypto.randomUUID(),
      name: name.trim(),
      url: url.trim(),
      icon: icon.trim() || 'icon:link',
      openWith: openWith.trim() || undefined,
      tags: tags.length > 0 ? tags : undefined,
      pinned: resolvedPortal.pinned,
      hiddenInRootSearch: resolvedPortal.hiddenInRootSearch,
      openCount: resolvedPortal.openCount,
      createdAt: resolvedPortal.createdAt ?? Date.now(),
      updatedAt: resolvedIsEditing ? Date.now() : resolvedPortal.updatedAt,
    };

    if (onsave) {
      await onsave(nextPortal);
      return;
    }
    await saveToStore(nextPortal);
  }

  function handleCancel() {
    if (pickerOpen) {
      closePicker();
      return false;
    }
    if (iconMenuOpen) {
      iconMenuOpen = false;
      return false;
    }
    cancelled = true;
    if (oncancel) {
      oncancel();
      return;
    }
    portalsUiState.clearDraft();
    viewManager.goBack();
  }

  $effect(() => {
    actionService.registerAction({
      id: 'portals:insert-placeholder',
      label: t('features.portals.ui.insert_placeholder'),
      icon: 'icon:code',
      shortcut: 'Mod+Shift+P',
      category: t('categories.portals'),
      extensionId: 'portals',
      context: ActionContext.EXTENSION_VIEW,
      execute: () => openPickerViaButton(),
    });
    return () => {
      actionService.unregisterAction('portals:insert-placeholder');
    };
  });

  function handleUrlInput(e: Event) {
    const input = e.target as HTMLTextAreaElement;
    const cursorPos = input.selectionStart ?? input.value.length;
    const charBefore = input.value[cursorPos - 1];
    if (charBefore === '{') {
      triggerCursorPos = cursorPos;
      pickerOpen = true;
    }
    scheduleFaviconFetch(input.value);
  }

  function openPickerViaButton() {
    triggerCursorPos = -1;
    pickerOpen = true;
    urlTextareaEl?.focus();
  }

  function handleInsert(token: string) {
    if (!urlTextareaEl) return;
    urlTextareaEl.focus();
    const insertion = token === 'query' ? '{argument}' : `{${token}}`;

    if (triggerCursorPos > 0) {
      const replaceStart = triggerCursorPos - 1;
      const replaceEnd = triggerCursorPos;
      urlTextareaEl.setRangeText(insertion, replaceStart, replaceEnd, 'end');
    } else {
      const start = urlTextareaEl.selectionStart ?? urlTextareaEl.value.length;
      const end = urlTextareaEl.selectionEnd ?? urlTextareaEl.value.length;
      urlTextareaEl.setRangeText(insertion, start, end, 'end');
    }

    url = urlTextareaEl.value;
  }

  function closePicker() {
    pickerOpen = false;
    triggerCursorPos = -1;
    urlTextareaEl?.focus();
  }

  async function handleBrowsePath() {
    await setFocusLock(true);
    try {
      const selected = await portalPickPath('file');
      if (typeof selected === 'string' && selected.trim()) {
        url = selected;
        if (!name.trim()) {
          name = selected.split(/[\\/]/).pop() ?? selected;
        }
        if (!iconTouched) {
          icon = 'icon:file-text';
        }
      }
    } finally {
      await setFocusLock(false);
    }
  }

  async function handleRefreshFavicon() {
    const favicon = await fetchPortalFavicon(url.trim());
    if (favicon) {
      icon = favicon;
      iconTouched = false;
    }
    iconMenuOpen = false;
  }
</script>

<FormView
  actionId="portals:save"
  submitLabel={resolvedIsEditing ? 'Update Portal' : 'Save Portal'}
  extensionId="portals"
  category={t('categories.portals')}
  submitDisabled={!name.trim() || !url.trim()}
  restoreSearchFocusOnCancel={true}
  onsubmit={handleSave}
  oncancel={handleCancel}
>
  {#snippet header()}
    <div class="form-top-bar">
      <h2 class="form-title">{resolvedIsEditing ? 'Update Portal' : 'Create Portal'}</h2>
      <button
        type="button"
        class="guide-link"
        onclick={() => void openUrl('https://docs.asyar.org')}
      >
        {t('features.portals.ui.guide')}
      </button>
    </div>
  {/snippet}

  <div class="link-field-wrap">
    <FormField label={t('features.portals.ui.link')} id="portal-url">
      <div class="link-box">
        <div class="link-highlight-backdrop" aria-hidden="true">
          {#each highlightedSegments as seg}
            <span class:token-highlight={seg.isPlaceholder}>{seg.text}</span>
          {/each}
          {#if url.endsWith('\n')}&nbsp;{/if}
        </div>
        <textarea
          id="portal-url"
          bind:this={urlTextareaEl}
          bind:value={url}
          class="link-textarea custom-scrollbar"
          rows={3}
          spellcheck={false}
          autocomplete="off"
          placeholder="https://www.google.com/search?q={'{argument}'}"
          oninput={handleUrlInput}></textarea>
        <div class="link-inline-actions">
          <button
            type="button"
            class="inline-icon-btn"
            tabindex={-1}
            title={t('features.portals.ui.insert_placeholder')}
            onclick={openPickerViaButton}
          >
            <Icon name="dev-tools" size={14} />
          </button>
          <button
            type="button"
            class="inline-icon-btn"
            tabindex={-1}
            title="Choose file or folder"
            onclick={handleBrowsePath}
          >
            <Icon name="folder" size={14} />
          </button>
        </div>
      </div>
    </FormField>

    {#if pickerOpen}
      <PlaceholderPicker onInsert={handleInsert} onClose={closePicker} />
    {/if}

    <p class="link-helper text-caption">
      Include
      <button type="button" class="inline-link" onclick={openPickerViaButton}>
        {'{Dynamic Placeholders}'}
      </button>
      to add arguments or context like the selected or copied text in the link
    </p>
  </div>

  <FormField label={t('features.portals.ui.name_and_icon')} id="portal-name">
    <div class="name-icon-row">
      <Input
        unstyled
        textIntent="natural"
        id="portal-name"
        class="name-input"
        type="text"
        bind:value={name}
        placeholder={t('features.portals.ui.portal_name_placeholder')}
      />
      <div class="icon-picker-wrap">
        <button
          type="button"
          class="icon-picker-btn"
          title="Choose Icon"
          onclick={() => (iconMenuOpen = !iconMenuOpen)}
        >
          <AppIcon {icon} size={16} glyphSize={14} />
          <svg class="picker-caret" viewBox="0 0 10 6" fill="none" aria-hidden="true">
            <path
              d="M1 1l4 4 4-4"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
        {#if iconMenuOpen}
          <div class="icon-popover launcher-popup" role="dialog" aria-label="Portal Icon">
            <div class="icon-grid">
              {#each QUICK_ICONS as qIcon}
                <button
                  type="button"
                  class="icon-choice"
                  class:selected={icon === qIcon}
                  onclick={() => {
                    icon = qIcon;
                    iconTouched = true;
                    iconMenuOpen = false;
                  }}
                >
                  <AppIcon icon={qIcon} size={16} glyphSize={14} />
                </button>
              {/each}
              {#each QUICK_EMOJIS as emoji}
                <button
                  type="button"
                  class="icon-choice"
                  class:selected={icon === emoji}
                  onclick={() => {
                    icon = emoji;
                    iconTouched = true;
                    iconMenuOpen = false;
                  }}
                >
                  <span>{emoji}</span>
                </button>
              {/each}
            </div>
            <div class="icon-custom-row">
              <Input
                unstyled
                textIntent="exact"
                class="icon-custom-input"
                type="text"
                bind:value={icon}
                oninput={() => (iconTouched = true)}
                placeholder="Emoji or icon:name"
              />
              {#if /^https?:\/\//i.test(url.trim())}
                <button
                  type="button"
                  class="btn-secondary favicon-btn"
                  onclick={handleRefreshFavicon}
                >
                  Favicon
                </button>
              {/if}
            </div>
          </div>
        {/if}
      </div>
    </div>
  </FormField>

  <FormField label={t('features.portals.ui.open_with')} id="portal-open-with">
    <SearchableSelect
      id="portal-open-with"
      bind:value={openWith}
      options={appOptions}
      placeholder={t('features.portals.ui.default_app')}
      filterPlaceholder="Search applications..."
    />
  </FormField>

  <FormField label={t('features.portals.ui.tags')} id="portal-tags">
    <Input
      unstyled
      textIntent="natural"
      id="portal-tags"
      class="field-input"
      type="text"
      bind:value={tagsText}
      placeholder={t('features.portals.ui.tags_placeholder')}
    />
  </FormField>
</FormView>

<style>
  .form-top-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--space-2);
  }
  .form-title {
    font-size: var(--font-size-lg);
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }
  .guide-link {
    background: none;
    border: none;
    padding: 0;
    color: var(--text-secondary);
    font-size: var(--font-size-xs);
    text-decoration: underline;
    cursor: default;
  }
  .guide-link:hover {
    color: var(--text-primary);
  }
  .link-field-wrap {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .link-box {
    position: relative;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    min-height: 84px;
    transition: border-color var(--dur-quick) var(--ease-travel);
  }
  .link-box:focus-within {
    border-color: var(--accent-primary);
    box-shadow: var(--shadow-focus);
  }
  .link-highlight-backdrop,
  .link-textarea {
    font-family: var(--font-ui);
    font-size: var(--font-size-md);
    line-height: 1.5;
    padding: var(--space-3) var(--space-4) var(--space-8);
    margin: 0;
    width: 100%;
    box-sizing: border-box;
    white-space: pre-wrap;
    word-break: break-all;
  }
  .link-highlight-backdrop {
    position: absolute;
    inset: 0;
    color: var(--text-primary);
    pointer-events: none;
    overflow: hidden;
  }
  .token-highlight {
    color: var(--accent-success);
  }
  .link-textarea {
    position: relative;
    background: transparent;
    color: transparent;
    caret-color: var(--text-primary);
    border: none;
    outline: none;
    resize: none;
    min-height: 84px;
  }
  .link-textarea::placeholder {
    color: var(--text-tertiary);
  }
  .link-inline-actions {
    position: absolute;
    right: var(--space-2);
    bottom: var(--space-2);
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .inline-icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--size-lg);
    height: var(--size-lg);
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-color);
    background: var(--bg-secondary);
    color: var(--text-secondary);
    cursor: default;
  }
  .inline-icon-btn:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }
  .link-helper {
    margin: 0;
    line-height: 1.4;
  }
  .inline-link {
    background: none;
    border: none;
    padding: 0;
    color: var(--accent-primary);
    font: inherit;
    cursor: default;
  }
  .inline-link:hover {
    text-decoration: underline;
  }
  .name-icon-row {
    display: flex;
    align-items: center;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    height: var(--size-xl);
  }
  .name-icon-row:focus-within {
    border-color: var(--accent-primary);
    box-shadow: var(--shadow-focus);
  }
  :global(.name-icon-row .name-input) {
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0 var(--space-4);
    background: transparent;
    border: none;
    color: var(--text-primary);
    font-size: var(--font-size-md);
    outline: none;
  }
  .icon-picker-wrap {
    position: relative;
    flex-shrink: 0;
    height: 100%;
    border-left: 1px solid var(--border-color);
  }
  .icon-picker-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    height: 100%;
    padding: 0 var(--space-3);
    background: transparent;
    border: none;
    color: var(--text-secondary);
    cursor: default;
  }
  .icon-picker-btn:hover {
    color: var(--text-primary);
  }
  .picker-caret {
    width: 10px;
    height: 6px;
    flex-shrink: 0;
  }
  .icon-popover {
    position: absolute;
    right: 0;
    top: calc(100% + var(--space-1));
    z-index: var(--z-dropdown);
    width: 240px;
    padding: var(--space-3);
    background: var(--bg-popup);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-popup);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .icon-grid {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: var(--space-1);
  }
  .icon-choice {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: var(--size-lg);
    border-radius: var(--radius-sm);
    border: 1px solid transparent;
    background: transparent;
    color: var(--text-primary);
    cursor: default;
  }
  .icon-choice:hover,
  .icon-choice.selected {
    background: var(--bg-hover);
    border-color: var(--border-color);
  }
  .icon-custom-row {
    display: flex;
    gap: var(--space-1);
    align-items: center;
  }
  :global(.icon-custom-input) {
    flex: 1;
    min-width: 0;
    height: var(--size-lg);
    padding: 0 var(--space-2);
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-size: var(--font-size-xs);
  }
  .favicon-btn {
    height: var(--size-lg);
    padding: 0 var(--space-2);
    font-size: var(--font-size-xs);
  }
</style>
