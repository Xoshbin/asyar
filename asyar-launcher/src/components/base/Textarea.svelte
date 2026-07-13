<script lang="ts">
  import type { HTMLTextareaAttributes } from 'svelte/elements';
  import { getTextIntentAttributes, type TextIntent } from './textIntent';

  let {
    value = $bindable(''),
    placeholder = '',
    disabled = false,
    rows,
    ref = $bindable(),
    unstyled = false,
    class: className = '',
    textIntent = 'natural',
    ...rest
  }: Omit<HTMLTextareaAttributes, 'rows'> & {
    value?: string;
    rows?: number | string;
    ref?: HTMLTextAreaElement | null;
    unstyled?: boolean;
    textIntent?: TextIntent;
  } = $props();

  let numericRows = $derived(rows !== undefined ? Number(rows) : undefined);
  let textIntentAttributes = $derived(getTextIntentAttributes(textIntent));
</script>

<textarea
  {...textIntentAttributes}
  bind:this={ref}
  rows={numericRows}
  {placeholder}
  {disabled}
  bind:value
  class={[!unstyled && 'input', className].filter(Boolean).join(' ')}
  {...rest}></textarea>
