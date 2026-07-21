<script lang="ts">
  import { onDestroy } from 'svelte';
  import {
    Input,
    Textarea,
    SplitListDetail,
    LauncherListRow,
    ActionFooter,
    EmptyState,
    Button,
    Badge,
  } from '../../components';
  import { noteStore, type Note } from './noteStore.svelte';
  import { noteViewState } from './noteViewState.svelte';
  import { extractTags, findWikilinkAtCursor } from './noteLinks';
  import { noteBacklinks } from '../../lib/ipc/commands';
  import WikilinkPicker from './WikilinkPicker.svelte';

  let filteredNotes = $derived(noteViewState.getFilteredNotes());
  let selectedIndex = $derived(noteViewState.selectedIndex);
  let selectedNote = $derived(noteViewState.selectedNote);

  // Directly-editable copies, reloaded only when the selection changes (by
  // id), so our own debounced autosave never clobbers what's being typed.
  let formTitle = $state('');
  let formBody = $state('');
  let loadedNoteId = $state<string | null>(null);
  let titleEl: HTMLInputElement | undefined = $state();
  let bodyEl: HTMLTextAreaElement | undefined = $state();

  let wikilinkPickerOpen = $state(false);
  let wikilinkTriggerPos = $state(-1);
  let wikilinkQuery = $state('');

  $effect(() => {
    const n = selectedNote;
    if (n && n.id !== loadedNoteId) {
      formTitle = n.title;
      formBody = n.body;
      loadedNoteId = n.id;
      wikilinkPickerOpen = false;
      if (noteViewState.justCreatedId === n.id) {
        noteViewState.justCreatedId = null;
        requestAnimationFrame(() => titleEl?.focus());
      }
    } else if (!n) {
      loadedNoteId = null;
    }
  });

  let tags = $derived(extractTags(formBody));

  // Backlinks are a corpus scan → Rust (note_backlinks). Fetch only when the
  // selected note's id changes (a note's backlinks don't depend on its own
  // body, so editing it must not re-query); guard against stale responses.
  let selectedId = $derived(selectedNote?.id ?? null);
  let backlinks = $state<Note[]>([]);
  $effect(() => {
    const id = selectedId;
    if (!id) {
      backlinks = [];
      return;
    }
    noteBacklinks(id).then((rows) => {
      if (selectedId === id) backlinks = rows ?? [];
    });
  });
  let wikilinkCandidates = $derived(
    wikilinkPickerOpen
      ? noteStore.notes
          .filter(
            (n) =>
              n.id !== loadedNoteId &&
              n.title.trim() &&
              n.title.toLowerCase().includes(wikilinkQuery.trim().toLowerCase()),
          )
          .slice(0, 8)
      : [],
  );

  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  function scheduleSave() {
    const id = loadedNoteId;
    if (!id) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      noteStore.update(id, { title: formTitle, body: formBody });
    }, 400);
  }

  function flushSave() {
    const id = loadedNoteId;
    if (!id) return;
    clearTimeout(saveTimer);
    saveTimer = undefined;
    noteStore.update(id, { title: formTitle, body: formBody });
  }

  onDestroy(flushSave);

  function jumpToNote(id: string) {
    flushSave();
    void noteViewState.selectAfterMutation(id);
  }

  // Typing "[[" opens a note-title picker; keep typing to filter it, "]" or
  // a newline abandons it, Enter/click inserts "Title]]" at the cursor (the
  // "[[" the user already typed stays as-is).
  function handleBodyInput(e: Event) {
    scheduleSave();
    const input = e.target as HTMLTextAreaElement;
    const cursorPos = input.selectionStart ?? input.value.length;

    if (wikilinkPickerOpen) {
      if (cursorPos < wikilinkTriggerPos) {
        wikilinkPickerOpen = false;
        return;
      }
      const slice = input.value.slice(wikilinkTriggerPos, cursorPos);
      if (slice.includes(']') || slice.includes('\n')) {
        wikilinkPickerOpen = false;
      } else {
        wikilinkQuery = slice;
      }
      return;
    }

    const before = input.value.slice(Math.max(0, cursorPos - 2), cursorPos);
    if (before === '[[') {
      wikilinkTriggerPos = cursorPos;
      wikilinkQuery = '';
      wikilinkPickerOpen = true;
    }
  }

  function handleWikilinkInsert(title: string) {
    if (!bodyEl) return;
    const cursorPos = bodyEl.selectionStart ?? wikilinkTriggerPos;
    bodyEl.setRangeText(title + ']]', wikilinkTriggerPos, cursorPos, 'end');
    formBody = bodyEl.value;
    wikilinkPickerOpen = false;
    scheduleSave();
    bodyEl.focus();
  }

  // ⌘Enter follows the [[link]] the cursor is inside/adjacent to.
  function handleBodyKeydown(e: KeyboardEvent) {
    if (!((e.metaKey || e.ctrlKey) && e.key === 'Enter')) return;
    e.preventDefault();
    const cursorPos = bodyEl?.selectionStart ?? 0;
    const title = findWikilinkAtCursor(formBody, cursorPos);
    if (!title) return;
    const target = noteStore.notes.find(
      (n) => n.id !== loadedNoteId && n.title.trim().toLowerCase() === title.trim().toLowerCase(),
    );
    if (target) jumpToNote(target.id);
  }

  function previewOf(body: string): string {
    const firstLine = body.split('\n').find((l) => l.trim().length > 0);
    return firstLine?.trim() ?? '';
  }

  const relativeFormat = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  function relativeTime(ms: number): string {
    const diffSeconds = Math.round((ms - Date.now()) / 1000);
    const abs = Math.abs(diffSeconds);
    if (abs < 60) return 'just now';
    if (abs < 3600) return relativeFormat.format(Math.round(diffSeconds / 60), 'minute');
    if (abs < 86400) return relativeFormat.format(Math.round(diffSeconds / 3600), 'hour');
    return relativeFormat.format(Math.round(diffSeconds / 86400), 'day');
  }

  let wordCount = $derived(formBody.trim() ? formBody.trim().split(/\s+/).length : 0);
</script>

<SplitListDetail
  items={filteredNotes}
  {selectedIndex}
  leftWidth={280}
  minLeftWidth={220}
  maxLeftWidth={520}
  ariaLabel="Notes"
  emptyMessage={noteViewState.indexState === 'indexing'
    ? 'Still indexing your notes…'
    : 'No notes found'}
>
  {#snippet listItem(note, index)}
    {#if index === 0 && noteViewState.pinnedCount > 0}
      <div class="list-section">Pinned</div>
    {/if}
    {#if index === noteViewState.pinnedCount && noteViewState.pinnedCount > 0}
      <div class="list-section">All Notes</div>
    {/if}
    <LauncherListRow
      data-index={index}
      selected={selectedIndex === index}
      title={note.title || 'Untitled Note'}
      subtitle={previewOf(note.body) || undefined}
      onclick={() => noteViewState.selectItem(index)}
    >
      {#snippet leading()}
        <div class="leading-icon">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
        </div>
      {/snippet}
    </LauncherListRow>
  {/snippet}

  {#snippet detail()}
    {#if selectedNote}
      <div class="note-editor">
        <Input
          unstyled
          textIntent="natural"
          class="note-title-input"
          type="text"
          autocomplete="off"
          bind:ref={titleEl}
          bind:value={formTitle}
          oninput={scheduleSave}
          onblur={flushSave}
          placeholder="Untitled Note"
        />
        {#if tags.length > 0}
          <div class="tag-row">
            {#each tags as tag (tag)}
              <Badge text={'#' + tag} variant="default" />
            {/each}
          </div>
        {/if}
        <div class="body-wrapper">
          <Textarea
            unstyled
            textIntent="verbatim"
            class="note-body-input custom-scrollbar"
            autocomplete="off"
            bind:ref={bodyEl}
            bind:value={formBody}
            oninput={handleBodyInput}
            onkeydown={handleBodyKeydown}
            onblur={flushSave}
            placeholder="Start writing… ⌘Enter follows a [[link]] under the cursor."
          ></Textarea>
          {#if wikilinkPickerOpen}
            <WikilinkPicker
              candidates={wikilinkCandidates}
              query={wikilinkQuery}
              onInsert={handleWikilinkInsert}
              onClose={() => (wikilinkPickerOpen = false)}
            />
          {/if}
        </div>
        {#if backlinks.length > 0}
          <div class="backlinks-section custom-scrollbar">
            <div class="backlinks-header">Linked Mentions</div>
            {#each backlinks as n (n.id)}
              <button class="backlink-item" onclick={() => jumpToNote(n.id)}>
                {n.title || 'Untitled Note'}
              </button>
            {/each}
          </div>
        {/if}
      </div>
      <ActionFooter>
        {#snippet left()}
          <span class="text-caption" style="color: var(--text-tertiary)">
            Edited {relativeTime(selectedNote.updatedAt)} · {wordCount}
            {wordCount === 1 ? 'word' : 'words'}
          </span>
        {/snippet}
      </ActionFooter>
    {:else}
      <EmptyState
        message={filteredNotes.length === 0 ? 'No notes yet' : 'Select a note'}
        description={filteredNotes.length === 0
          ? 'Write your first note — it saves as you type.'
          : 'Choose a note from the list to read or edit it.'}
      >
        {#snippet icon()}
          <svg class="w-16 h-16 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.5"
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
        {/snippet}
        {#if filteredNotes.length === 0}
          <Button class="btn-primary mt-4" onclick={() => noteViewState.createNote()}
            >Create your first note</Button
          >
        {/if}
      </EmptyState>
    {/if}
  {/snippet}
</SplitListDetail>

<style>
  .leading-icon {
    opacity: 0.6;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-right: var(--space-1);
  }
  .list-section {
    padding: var(--space-2) var(--space-4);
    font-size: var(--font-size-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-tertiary);
  }

  .note-editor {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    padding: var(--space-7) var(--space-8) 0;
    gap: var(--space-3);
  }
  :global(.note-title-input) {
    font-size: var(--font-size-lg);
    font-weight: 600;
    color: var(--text-primary);
    border: none;
    background: transparent;
    padding: 0 0 var(--space-3);
    flex-shrink: 0;
  }
  :global(.note-body-input) {
    flex: 1;
    resize: none;
    border: none;
    background: transparent;
    color: var(--text-primary);
    font-size: var(--font-size-md);
    line-height: 1.7;
    padding: 0 0 var(--space-6);
  }

  .tag-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    flex-shrink: 0;
  }

  .body-wrapper {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    position: relative;
  }

  .backlinks-section {
    flex-shrink: 0;
    max-height: 140px;
    overflow-y: auto;
    padding: var(--space-3) 0 var(--space-6);
    border-top: 1px solid var(--separator);
  }
  .backlinks-header {
    font-size: var(--font-size-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-tertiary);
    margin-bottom: var(--space-2);
  }
  .backlink-item {
    display: block;
    width: 100%;
    text-align: left;
    background: transparent;
    border: none;
    padding: var(--space-2) 0;
    font-size: var(--font-size-sm);
    color: var(--accent-primary);
    cursor: pointer;
  }
  .backlink-item:hover {
    text-decoration: underline;
  }
</style>
