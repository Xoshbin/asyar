<script lang="ts">
  import type { HTMLTextareaAttributes } from 'svelte/elements';

  let {
    value = $bindable(''),
    placeholder = '',
    disabled = false,
    rows,
    ref = $bindable(),
    unstyled = false,
    class: className = '',
    ...rest
  }: Omit<HTMLTextareaAttributes, 'rows'> & {
    value?: string;
    rows?: number | string;
    ref?: HTMLTextAreaElement | null;
    unstyled?: boolean;
  } = $props();

  let numericRows = $derived(rows !== undefined ? Number(rows) : undefined);

  const nonStandardAttrs: Record<string, string> = {
    autocorrect: 'off',
  };
</script>

<textarea
  autocapitalize="none"
  {...nonStandardAttrs}
  spellcheck="false"
  bind:this={ref}
  rows={numericRows}
  {placeholder}
  {disabled}
  bind:value
  class={[!unstyled && 'input', className].filter(Boolean).join(' ')}
  {...rest}></textarea>
