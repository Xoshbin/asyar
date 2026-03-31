<script lang="ts">
  let {
    checked = $bindable(false),
    disabled = false,
    id = "",
    onchange
  }: {
    checked?: boolean;
    disabled?: boolean;
    id?: string;
    onchange?: (e: Event) => void;
  } = $props();
</script>

<label class="relative inline-flex items-center cursor-pointer" class:cursor-not-allowed={disabled}>
  <input
    type="checkbox"
    bind:checked
    {disabled}
    {id}
    class="sr-only peer"
    {onchange}
  >
  <div
    class="toggle-track peer peer-checked:after:translate-x-full
    rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white
    after:content-[''] after:absolute after:top-[2px] after:start-[2px]
    after:bg-white after:border-gray-300 after:border after:rounded-full
    after:h-5 after:w-5 after:transition-all peer-disabled:opacity-50"
  ></div>
</label>

<style>
  .toggle-track {
    width: 2.75rem;
    height: 1.5rem;
    background-color: var(--bg-hover);
    border-radius: var(--radius-full);
    transition: background-color var(--transition-normal);
  }
  .toggle-track:focus-within {
    outline: none;
    box-shadow: 0 0 0 3px var(--asyar-brand-muted);
  }
  :global(.peer:checked) ~ .toggle-track {
    background-color: var(--accent-primary);
  }
</style>
