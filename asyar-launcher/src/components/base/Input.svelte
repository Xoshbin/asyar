<script lang="ts">
  let {
    value = $bindable(""),
    placeholder = "",
    disabled = false,
    type = "text",
    ref = $bindable(null as HTMLInputElement | null),
    ...rest
  }: {
    value?: string;
    placeholder?: string;
    disabled?: boolean;
    type?: string;
    ref?: HTMLInputElement | null;
    [key: string]: any;
  } = $props();
</script>

<input
  bind:this={ref}
  {type}
  {placeholder}
  {disabled}
  bind:value
  class="input"
  {...rest}
/>
