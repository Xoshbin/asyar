<script lang="ts">
  import { snippetsPreviewExpansion } from '../../../../lib/ipc/snippetCommands';

  let { placeholder }: { placeholder: string } = $props();

  let field: HTMLTextAreaElement;

  async function oninput(e: Event) {
    if ((e as InputEvent).inputType !== 'insertText') return;
    const value = field.value;
    const caret = field.selectionStart;
    const before = value.slice(0, caret);
    const hit = await snippetsPreviewExpansion(before.slice(-64));
    // A newer keystroke already changed the text; that one gets its own check.
    if (!hit || field.value !== value) return;
    const kept = Array.from(before).slice(0, -hit.keywordLen).join('') + hit.expansion;
    field.value = kept + value.slice(caret);
    field.setSelectionRange(kept.length, kept.length);
  }
</script>

<!-- svelte-ignore a11y_autofocus -->
<textarea class="expansion-field" bind:this={field} {placeholder} {oninput} autofocus></textarea>

<style>
  .expansion-field {
    display: block;
    width: 100%;
    min-height: calc(var(--font-size-md) * 6);
    padding: var(--space-4);
    border: none;
    resize: none;
    background: transparent;
    color: var(--text-primary);
    font: inherit;
    font-size: var(--font-size-md);
    outline: none;
  }
</style>
