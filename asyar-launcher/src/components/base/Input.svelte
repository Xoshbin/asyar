<script lang="ts">
  export let value = "";
  export let placeholder = "";
  export let disabled = false;
  export let type = "text";
</script>

<input
  bind:this={$$restProps.ref}
  {type}
  {placeholder}
  {disabled}
  bind:value
  class="input"
  on:input
  on:keydown
  {...$$restProps}
/>
