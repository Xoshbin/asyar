<script lang="ts">
  import { pickActiveSection, type SectionIntersection } from './settingsSectionNav.logic';

  let {
    sections,
    scrollRoot,
  }: {
    sections: { id: string; label: string }[];
    scrollRoot: HTMLElement | null;
  } = $props();

  let activeId = $state<string | null>(sections[0]?.id ?? null);

  $effect(() => {
    // Reset eagerly on every sections change (e.g. a tab switch) instead of
    // waiting for the IntersectionObserver's first callback below — avoids
    // a frame where the previous tab's pill is still shown active.
    activeId = sections[0]?.id ?? null;

    if (!scrollRoot || sections.length === 0) return;

    const state = new Map<string, SectionIntersection>();
    const observedIds = new Set<string>();
    const observer = new IntersectionObserver(
      (observed) => {
        for (const entry of observed) {
          const id = (entry.target as HTMLElement).id;
          state.set(id, {
            id,
            top: entry.boundingClientRect.top,
            isIntersecting: entry.isIntersecting,
          });
        }
        activeId = pickActiveSection([...state.values()], activeId);
      },
      // Bottom 70% margin: a section counts as "current" once its top has
      // scrolled into the upper third of the content column, matching how
      // people actually read a long settings form top-to-bottom.
      { root: scrollRoot, threshold: 0, rootMargin: '0px 0px -70% 0px' },
    );

    // A section's anchor element can mount after this effect's first pass —
    // e.g. ScheduledTasksSection only renders its wrapper once its async
    // task list finishes loading. Re-scan on every DOM mutation under the
    // scroll root until every section has been found, so a late-arriving
    // section still gets picked up by the scrollspy.
    const mutationObserver = new MutationObserver(() => observeAvailableSections());

    function observeAvailableSections() {
      for (const section of sections) {
        if (observedIds.has(section.id)) continue;
        const el = document.getElementById(section.id);
        if (el) {
          observer.observe(el);
          observedIds.add(section.id);
        }
      }
      if (observedIds.size === sections.length) mutationObserver.disconnect();
    }

    observeAvailableSections();
    if (observedIds.size < sections.length) {
      mutationObserver.observe(scrollRoot, { childList: true, subtree: true });
    }

    return () => {
      observer.disconnect();
      mutationObserver.disconnect();
    };
  });

  function scrollToSection(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
</script>

<nav class="section-nav" aria-label="Section navigation">
  {#each sections as section (section.id)}
    <button
      type="button"
      class="section-pill"
      class:active={activeId === section.id}
      aria-current={activeId === section.id ? 'true' : undefined}
      onclick={() => scrollToSection(section.id)}
    >
      {section.label}
    </button>
  {/each}
</nav>

<style>
  .section-nav {
    display: flex;
    gap: var(--space-2);
    padding: var(--space-5) var(--space-8);
    border-bottom: 1px solid var(--border-color);
    background: var(--bg-secondary);
    flex-shrink: 0;
    overflow-x: auto;
  }

  .section-pill {
    padding: var(--space-2) var(--space-5);
    border-radius: var(--radius-full);
    border: 1px solid var(--border-color);
    font-size: var(--font-size-xs);
    font-weight: 600;
    color: var(--text-secondary);
    background: transparent;
    white-space: nowrap;
    cursor: pointer;
    transition:
      background-color var(--transition-fast),
      color var(--transition-fast);
  }

  .section-pill:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .section-pill.active {
    background: var(--bg-selected);
    color: var(--text-primary);
  }
</style>
