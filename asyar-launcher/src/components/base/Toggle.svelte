<script lang="ts">
  let {
    checked = $bindable(false),
    disabled = false,
    id = '',
    onchange,
  }: {
    checked?: boolean;
    disabled?: boolean;
    id?: string;
    onchange?: (e: Event) => void;
  } = $props();
</script>

<label class="relative inline-flex items-center cursor-pointer" class:cursor-not-allowed={disabled}>
  <input type="checkbox" bind:checked {disabled} {id} class="sr-only peer" {onchange} />
  <div class="toggle-track peer peer-disabled:opacity-50"></div>
</label>

<style>
  .toggle-track {
    position: relative;
    width: 2.75rem;
    height: 1.5rem;
    background-color: var(--bg-hover);
    border-radius: var(--radius-full);
    transition: background-color var(--transition-normal);
  }

  /* The knob. Sized off the track so the two stay in proportion. */
  .toggle-track::after {
    content: '';
    position: absolute;
    top: var(--space-0-5);
    inset-inline-start: var(--space-0-5);
    width: 1.25rem;
    height: 1.25rem;
    background-color: var(--control-knob);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-full);
    transition: transform var(--transition-normal);
  }

  :global(.peer:checked) ~ .toggle-track {
    background-color: var(--accent-primary);
  }
  :global(.peer:checked) ~ .toggle-track::after {
    transform: translateX(100%);
    border-color: var(--control-knob);
  }
  :global([dir='rtl']) :global(.peer:checked) ~ .toggle-track::after {
    transform: translateX(-100%);
  }

  /* The checkbox is a *sibling* of the track, not an ancestor, so
     :focus-within on the track never matches. Mirror the :checked pattern
     above and drive the ring off the peer instead. */
  :global(.peer:focus-visible) ~ .toggle-track {
    box-shadow: var(--shadow-focus);
  }
</style>
