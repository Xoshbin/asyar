<script lang="ts">
  export let type: "button" | "submit" = "button";
  export let disabled = false;
  export let fullWidth = false;
  let className = '';
  export { className as class };
</script>

<button
  {type}
  {disabled}
  class="btn {className}"
  class:btn-full={fullWidth}
  on:click
>
  <span class="result-title">
    <slot />
  </span>
</button>
