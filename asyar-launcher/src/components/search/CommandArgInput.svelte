<script lang="ts">
  import { tick } from 'svelte';
  import type { CommandArgument } from 'asyar-sdk/contracts';

  let {
    arg,
    value,
    focused,
    onInput,
    onKeydown,
  }: {
    arg: CommandArgument;
    value: string;
    focused: boolean;
    onInput: (value: string) => void;
    onKeydown: (e: KeyboardEvent) => void;
  } = $props();

  let inputRef = $state<HTMLInputElement | HTMLSelectElement | null>(null);

  $effect(() => {
    if (focused && inputRef && document.activeElement !== inputRef) {
      tick().then(() => {
        if (document.activeElement !== inputRef) inputRef?.focus();
      });
    }
  });

  function handleInput(e: Event) {
    const target = e.currentTarget as HTMLInputElement | HTMLSelectElement;
    onInput(target.value);
  }
</script>

<div class="arg-chip" data-focused={focused}>
  {#if arg.type === 'dropdown'}
    <select
      bind:this={inputRef as HTMLSelectElement}
      class="arg-input arg-select"
      {value}
      onchange={handleInput}
      onkeydown={onKeydown}
      aria-label={arg.placeholder ?? arg.name}
    >
      {#each arg.data ?? [] as option}
        <option value={option.value}>{option.title}</option>
      {/each}
    </select>
  {:else}
    <input
      bind:this={inputRef as HTMLInputElement}
      class="arg-input"
      type={arg.type === 'password' ? 'password' : arg.type === 'number' ? 'number' : 'text'}
      placeholder={arg.placeholder ?? ''}
      {value}
      oninput={handleInput}
      onkeydown={onKeydown}
      autocomplete="off"
      spellcheck={arg.type === 'text' ? 'false' : undefined}
      inputmode={arg.type === 'number' ? 'decimal' : undefined}
      aria-label={arg.placeholder ?? arg.name}
    />
  {/if}
  {#if arg.required}
    <span class="arg-required" aria-label="required">*</span>
  {/if}
</div>

<style>
  .arg-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    padding: 3px var(--space-2);
    transition: border-color var(--transition-normal),
      box-shadow var(--transition-normal);
    min-width: 0;
  }
  .arg-chip[data-focused='true'] {
    border-color: var(--accent-primary);
    box-shadow: var(--shadow-focus);
  }
  .arg-input {
    border: none;
    outline: none;
    background: transparent;
    color: var(--text-primary);
    font-size: var(--font-size-base);
    font-family: var(--font-ui);
    padding: 0;
    min-width: 0;
    width: 120px;
  }
  .arg-input:focus {
    outline: none;
  }
  .arg-select {
    cursor: pointer;
  }
  .arg-input::placeholder {
    color: var(--text-tertiary);
  }
  .arg-required {
    color: var(--accent-danger);
    font-weight: 500;
    font-size: var(--font-size-base);
    user-select: none;
  }
</style>
