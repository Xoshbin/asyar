<script lang="ts">
  let {
    label,
    placeholder = '',
    prefill = '',
    multiline = false,
    enabled = false,
    disabledHint = 'Finish setup above to try it here',
    enabledHint = '',
  }: {
    label: string
    placeholder?: string
    prefill?: string
    multiline?: boolean
    enabled?: boolean
    disabledHint?: string
    enabledHint?: string
  } = $props()

  let value = $state(prefill)
</script>

<div class="testbox" class:testbox--disabled={!enabled}>
  <p class="testbox__label">{label}</p>
  {#if multiline}
    <textarea class="testbox__input" rows="3" {placeholder} bind:value disabled={!enabled}></textarea>
  {:else}
    <input class="testbox__input" type="text" {placeholder} bind:value disabled={!enabled} />
  {/if}
  <p class="testbox__hint">{enabled ? enabledHint : disabledHint}</p>
</div>

<style>
  .testbox { border: 1px dashed var(--separator); border-radius: var(--radius-md); padding: var(--space-3); background: var(--bg-subtle); }
  .testbox--disabled { opacity: 0.55; }
  .testbox__label { margin: 0 0 var(--space-2); font-size: var(--font-size-md); color: var(--text-secondary); }
  .testbox__input {
    width: 100%; box-sizing: border-box;
    background: var(--bg-primary); color: var(--text-primary);
    border: 1px solid var(--border-color); border-radius: var(--radius-md);
    padding: var(--space-2) var(--space-3); font-size: var(--font-size-md);
  }
  .testbox__hint { margin: var(--space-2) 0 0; font-size: var(--font-size-sm); color: var(--text-secondary); }
</style>
