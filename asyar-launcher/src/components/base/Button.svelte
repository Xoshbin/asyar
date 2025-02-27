<script lang="ts">
  export let type: "button" | "submit" = "button";
  export let disabled = false;
  export let fullWidth = false;
</script>

<button
  {type}
  {disabled}
  class="btn"
  class:btn-full={fullWidth}
  on:click
>
  <span class="result-title">
    <slot />
  </span>
</button>
