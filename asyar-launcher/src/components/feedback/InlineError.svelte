<script lang="ts">
  let { message }: { message: string } = $props();
</script>

<p class="inline-error">{message}</p>

<style>
  .inline-error {
    font-size: var(--font-size-xs);
    color: var(--accent-danger);
    margin: 0;
  }
</style>
