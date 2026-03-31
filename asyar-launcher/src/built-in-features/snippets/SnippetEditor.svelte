<script lang="ts">
  import { snippetStore, type Snippet } from './snippetStore.svelte';
  import { snippetService } from './snippetService';
  import { FormField, ModalOverlay } from '../../components';

  let { 
    snippet = undefined, 
    onclose 
  }: { 
    snippet?: Snippet; 
    onclose?: () => void 
  } = $props();

  let name = $state('');
  let keyword = $state('');
  let expansion = $state('');
  
  $effect(() => {
    name = snippet?.name ?? '';
    keyword = snippet?.keyword ?? '';
    expansion = snippet?.expansion ?? '';
  });

  let error = $state<string | null>(null);
  
  // Create a unique id once if creating
  let id = $derived(snippet ? snippet.id : crypto.randomUUID());

  async function handleSave() {
    if (!name.trim()) {
      error = "Name is required.";
      return;
    }
    if (!keyword.trim()) {
      error = "Keyword is required.";
      return;
    }
    if (!expansion.trim()) {
      error = "Expansion is required.";
      return;
    }

    // Keyword must be lowercase alpha+symbols. Using simple regex:
    if (/[A-Z]/.test(keyword) || /^[A-Za-z0-9_]*$/.test(keyword) && !keyword.startsWith(';') && !keyword.startsWith(':')) {
       // it's just a hint, we just check for uppercase really
       if (/[A-Z]/.test(keyword)) {
         error = "Keyword must be lowercase.";
         return;
       }
    }

    // Check for uniqueness
    const existing = snippetStore.getAll();
    const isDuplicate = existing.some(s => s.keyword === keyword && s.id !== id);
    if (isDuplicate) {
      error = "Keyword is already in use.";
      return;
    }

    const payload: Snippet = {
      id,
      name: name.trim(),
      keyword: keyword.trim().toLowerCase(),
      expansion: expansion,
      createdAt: snippet ? snippet.createdAt : Date.now()
    };

    if (snippet) {
      snippetStore.update(id, payload);
    } else {
      snippetStore.add(payload);
    }

    await snippetService.syncToRust();
    onclose?.();
  }
</script>

<ModalOverlay title={snippet ? 'Edit Snippet' : 'New Snippet'}>
  <div class="form">
    <FormField label="Name" id="name-input">
      <input id="name-input" type="text" bind:value={name} placeholder="e.g. My Email" />
    </FormField>

    <FormField label="Keyword" id="keyword-input" hint="Use a prefix like ; or /. Lowercase letters and symbols only.">
      <input id="keyword-input" type="text" bind:value={keyword} placeholder="e.g. ;email" />
    </FormField>

    <FormField label="Expansion" id="expansion-input">
      <textarea id="expansion-input" bind:value={expansion} placeholder="e.g. hello@example.com" rows="4"></textarea>
    </FormField>

    {#if error}
      <div class="message error">{error}</div>
    {/if}
  </div>

  {#snippet actions()}
    <button class="btn cancel" onclick={() => onclose?.()}>Cancel</button>
    <button class="btn save" onclick={handleSave}>Save</button>
  {/snippet}
</ModalOverlay>

<style>



  .form {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }





  input, textarea {
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    padding: 8px 12px;
    color: var(--text-primary);
    font-size: var(--font-size-md);
    outline: none;
    transition: border-color var(--transition-smooth);
  }

  input:focus, textarea:focus {
    border-color: var(--accent-primary);
  }

  textarea {
    resize: none;
    font-family: inherit;
  }



  .message.error {
    font-size: var(--font-size-sm);
    padding: 8px 10px;
    border-radius: var(--radius-sm);
    color: var(--accent-danger);
    background: color-mix(in srgb, var(--accent-danger) 10%, transparent);
  }


  .btn {
    padding: 6px 14px;
    border-radius: var(--radius-sm);
    font-size: var(--font-size-md);
    font-weight: 500;
    cursor: pointer;
    border: 1px solid transparent;
    transition: all var(--transition-smooth);
  }

  .btn.cancel {
    background: transparent;
    color: var(--text-secondary);
    border-color: var(--border-color);
  }

  .btn.cancel:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .btn.save {
    background: var(--accent-primary);
    color: white;
  }

  .btn.save:hover {
    filter: brightness(1.1);
  }
</style>
