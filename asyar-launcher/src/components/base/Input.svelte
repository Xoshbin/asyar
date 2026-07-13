<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';
  import { getTextIntentAttributes, type TextIntent } from './textIntent';

  let {
    value = $bindable(''),
    placeholder = '',
    disabled = false,
    type = 'text',
    ref = $bindable(),
    class: className = '',
    unstyled = false,
    textIntent = 'natural',
    ...rest
  }: HTMLInputAttributes & {
    value?: string;
    ref?: HTMLInputElement | null;
    unstyled?: boolean;
    textIntent?: TextIntent;
  } = $props();

  let textIntentAttributes = $derived(getTextIntentAttributes(textIntent));
</script>

<input
  {...textIntentAttributes}
  bind:this={ref}
  {type}
  {placeholder}
  {disabled}
  bind:value
  class={[!unstyled && 'input', className].filter(Boolean).join(' ')}
  {...rest}
/>
