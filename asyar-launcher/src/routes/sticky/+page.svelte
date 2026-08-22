<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import {
    noteFind,
    noteUpdate,
    stickyClose,
    stickyNew,
    stickyWindowLabel,
  } from '../../lib/ipc/commands';
  import { createWindowDragController } from '../../services/launcher/windowDragController';
  import '../../resources/styles/style.css';
  import { t } from '../../services/i18n';

  let noteId = $state<string | null>(null);
  let title = $state('');
  let body = $state('');
  let loaded = $state(false);
  let missing = $state(false);
  // While the user is in a field we skip inbound refreshes so a cross-window
  // update can't overwrite what they're mid-typing.
  let isEditing = $state(false);
  let unlisten: UnlistenFn | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  async function load(id: string) {
    const note = await noteFind(id);
    if (!note) {
      missing = true;
      loaded = true;
      return;
    }
    title = note.title;
    body = note.body;
    loaded = true;
  }

  function scheduleSave() {
    const id = noteId;
    if (!id) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      noteUpdate(id, { title, body }, Date.now()).catch((err) =>
        console.error('[sticky] save failed:', err),
      );
    }, 400);
  }

  function flushSave() {
    const id = noteId;
    if (!id) return;
    clearTimeout(saveTimer);
    saveTimer = undefined;
    noteUpdate(id, { title, body }, Date.now()).catch((err) =>
      console.error('[sticky] save failed:', err),
    );
  }

  onMount(async () => {
    const id = new URLSearchParams(window.location.search).get('id');
    if (!id) {
      missing = true;
      loaded = true;
      return;
    }
    noteId = id;
    await load(id);

    // Another window (launcher, AI tool, sync) changed this note — pick it up,
    // unless the user is actively typing here.
    unlisten = await listen<{ id: string }>('notes:changed', (event) => {
      if (event.payload?.id !== noteId || isEditing) return;
      void load(noteId);
    });
  });

  onDestroy(() => {
    flushSave();
    unlisten?.();
  });

  async function close() {
    flushSave();
    if (noteId) await stickyClose(noteId);
  }

  async function newSticky() {
    await stickyNew();
  }

  // Drag the window by its title bar. The mechanics live in the shared
  // controller — the launcher's search header uses the same one.
  let drag = $derived(noteId ? createWindowDragController(stickyWindowLabel(noteId)) : null);

  function onDragPointerDown(e: PointerEvent) {
    if (!drag) return;
    drag.onPointerDown(e);
    window.addEventListener('pointermove', onDragPointerMove);
    window.addEventListener('pointerup', onDragPointerUp, { once: true });
  }

  function onDragPointerMove(e: PointerEvent) {
    drag?.onPointerMove(e);
  }

  function onDragPointerUp() {
    window.removeEventListener('pointermove', onDragPointerMove);
    drag?.onPointerUp();
  }
</script>

<svelte:window on:beforeunload={flushSave} />

<div class="sticky">
  <!-- Borderless window: this bar is the drag handle. The note title lives in
       the editable field below, so it isn't repeated here. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <header class="sticky-bar" onpointerdown={onDragPointerDown}>
    <span class="sticky-grip"></span>
    <button
      class="sticky-btn"
      title={t('features.sticky.new_sticky')}
      onclick={newSticky}
      aria-label={t('features.sticky.new_sticky')}
    >
      +
    </button>
    <button
      class="sticky-btn"
      title={t('features.sticky.unstick')}
      onclick={close}
      aria-label={t('features.sticky.unstick')}
    >
      ×
    </button>
  </header>

  {#if !loaded}
    <div class="sticky-state">{t('common.loading')}</div>
  {:else if missing}
    <div class="sticky-state">{t('features.sticky.note_deleted')}</div>
  {:else}
    <input
      class="sticky-title"
      type="text"
      bind:value={title}
      placeholder={t('features.sticky.untitled_note')}
      oninput={scheduleSave}
      onfocus={() => (isEditing = true)}
      onblur={() => {
        isEditing = false;
        flushSave();
      }}
    />
    <textarea
      class="sticky-body custom-scrollbar"
      bind:value={body}
      placeholder={t('features.sticky.write_placeholder')}
      oninput={scheduleSave}
      onfocus={() => (isEditing = true)}
      onblur={() => {
        isEditing = false;
        flushSave();
      }}></textarea>
  {/if}
</div>

<style>
  :global(html),
  :global(body) {
    height: 100%;
    margin: 0;
    background: transparent;
  }

  .sticky {
    height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .sticky-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--separator);
    flex-shrink: 0;
    cursor: grab;
    /* A drag must not select text in the bar. */
    user-select: none;
  }
  .sticky-bar:active {
    cursor: grabbing;
  }

  /* Fills the bar so the whole strip is draggable, not just its edges. */
  .sticky-grip {
    flex: 1;
    align-self: stretch;
  }

  .sticky-btn {
    flex-shrink: 0;
    border: none;
    background: transparent;
    color: var(--text-tertiary);
    font-size: var(--font-size-md);
    line-height: 1;
    cursor: pointer;
    padding: 0 var(--space-1);
    border-radius: var(--radius-xs);
  }
  .sticky-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .sticky-state {
    padding: var(--space-5);
    font-size: var(--font-size-sm);
    color: var(--text-tertiary);
  }

  .sticky-title {
    border: none;
    background: transparent;
    color: var(--text-primary);
    font-size: var(--font-size-md);
    font-weight: 600;
    padding: var(--space-3) var(--space-4) var(--space-1);
    flex-shrink: 0;
    outline: none;
  }

  .sticky-body {
    flex: 1;
    resize: none;
    border: none;
    background: transparent;
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    line-height: 1.6;
    padding: var(--space-2) var(--space-4) var(--space-4);
    outline: none;
  }
</style>
