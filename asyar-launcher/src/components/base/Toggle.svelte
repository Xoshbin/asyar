<script lang="ts">
  let {
    checked = $bindable(false),
    disabled = false,
    id = '',
    title,
    onchange,
  }: {
    checked?: boolean;
    disabled?: boolean;
    id?: string;
    title?: string;
    onchange?: (e: Event) => void;
  } = $props();
</script>

<label class="relative inline-flex items-center cursor-default" {title}>
  <input type="checkbox" bind:checked {disabled} {id} class="sr-only peer" {onchange} />
  <div class="toggle-track peer peer-disabled:opacity-50"></div>
</label>

<style>
  /* macOS-desktop proportions: 32×18 track, 14px knob. */
  .toggle-track {
    position: relative;
    width: calc(var(--size-sm) * 2);
    height: calc(var(--size-sm) + var(--space-0-5));
    background-color: color-mix(in srgb, var(--text-primary) 16%, transparent);
    border-radius: var(--radius-full);
    transition: background-color var(--transition-normal);
    flex-shrink: 0;
  }

  /* The knob. Sized off the track so the two stay in proportion. */
  .toggle-track::after {
    content: '';
    position: absolute;
    top: var(--space-0-5);
    inset-inline-start: var(--space-0-5);
    width: calc(var(--size-xs) + var(--space-0-5));
    height: calc(var(--size-xs) + var(--space-0-5));
    background-color: var(--text-on-accent);
    border-radius: var(--radius-full);
    box-shadow: var(--shadow-xs);
    transition: transform var(--transition-normal);
  }

  :global(.peer:checked) ~ .toggle-track {
    background-color: var(--accent-primary-fill);
  }
  :global(.peer:checked) ~ .toggle-track::after {
    transform: translateX(calc(var(--size-xs) + var(--space-0-5)));
  }
  :global([dir='rtl']) :global(.peer:checked) ~ .toggle-track::after {
    transform: translateX(calc(-1 * (var(--size-xs) + var(--space-0-5))));
  }

  /* The checkbox is a *sibling* of the track, not an ancestor, so
     :focus-within on the track never matches. Mirror the :checked pattern
     above and drive the ring off the peer instead. */
  :global(.peer:focus-visible) ~ .toggle-track {
    box-shadow: var(--shadow-focus);
  }
</style>
