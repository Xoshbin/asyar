<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';

  let {
    value = $bindable(''),
    placeholder = '',
    disabled = false,
    type = 'text',
    ref = $bindable(),
    class: className = '',
    unstyled = false,
    ...rest
  }: HTMLInputAttributes & {
    value?: string;
    ref?: HTMLInputElement | null;
    unstyled?: boolean;
  } = $props();
</script>

<input
  autocapitalize="none"
  autocorrect="off"
  spellcheck="false"
  bind:this={ref}
  {type}
  {placeholder}
  {disabled}
  bind:value
  class={[!unstyled && 'input', className].filter(Boolean).join(' ')}
  {...rest}
/>
