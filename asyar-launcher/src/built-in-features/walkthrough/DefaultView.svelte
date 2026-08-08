<script lang="ts">
  import { Badge, EmptyState, Icon, ListItem, MeterBar } from '../../components';
  import { getBuiltInIconName, isBuiltInIcon } from '../../lib/iconUtils';
  import { renderMarkdown } from '../../utils/markdown';
  import { scrollSelectedIntoView } from '../../lib/listScroll';
  import { taskProgressFraction, taskProgressLabel } from './taskProgressLabel';
  import { walkthroughService } from '../../services/walkthrough/walkthroughService.svelte';
  import { walkthroughViewState } from './walkthroughViewState.svelte';

  const progress = $derived(walkthroughService.progress);
  const task = $derived(walkthroughViewState.openTask);

  let listEl = $state<HTMLDivElement | undefined>();
  let detailEl = $state<HTMLElement | undefined>();

  // Keyboard selection lives in walkthroughViewState, so the DOM has to be
  // told to follow it. rAF waits for the row to exist after a re-render.
  $effect(() => {
    const index = walkthroughViewState.selectedIndex;
    if (walkthroughViewState.mode !== 'list' || !listEl) return;
    requestAnimationFrame(() => {
      if (listEl) scrollSelectedIntoView(listEl, index);
    });
  });

  // A task opened from halfway down the list must start at the top of its
  // own page, not inherit the list's scroll position.
  $effect(() => {
    const openId = walkthroughViewState.openTaskId;
    if (!openId || !detailEl) return;
    detailEl.parentElement?.scrollTo({ top: 0 });
  });

  /** Habit tasks say how many days they want, so the ask is never a surprise. */
  function requirement(completion: { type: string; distinctDays?: number; times?: number }) {
    if (completion.type === 'manual') return 'Tick when done';
    if (completion.type === 'count' && completion.distinctDays && completion.distinctDays > 1) {
      return `Use on ${completion.distinctDays} separate days`;
    }
    if (completion.type === 'count' && completion.times && completion.times > 1) {
      return `Use ${completion.times} times`;
    }
    return 'Completes as you use it';
  }
</script>

<div class="walkthrough">
  {#if walkthroughViewState.mode === 'detail' && task}
    <article class="detail" bind:this={detailEl}>
      <header class="detail-head">
        {#if isBuiltInIcon(task.icon ?? '')}
          <Icon name={getBuiltInIconName(task.icon ?? '')} size={24} />
        {/if}
        <h1 class="detail-title">{task.title}</h1>
        {#if task.completed}
          <Badge text={task.source === 'manual' ? 'Marked done' : 'Done'} variant="success" />
        {:else}
          <Badge text={requirement(task.completion)} variant="info" />
        {/if}
      </header>

      {#if !task.completed && taskProgressLabel(task.progress)}
        <div class="detail-progress">
          <MeterBar value={taskProgressFraction(task.progress)} />
          <span class="detail-progress-label">{taskProgressLabel(task.progress)}</span>
        </div>
      {/if}

      {#if task.image}
        <img class="detail-image" src={task.image} alt="" />
      {/if}

      {#if task.body}
        <div class="detail-body">{@html renderMarkdown(task.body)}</div>
      {:else if task.summary}
        <p class="detail-body">{task.summary}</p>
      {/if}
    </article>
  {:else}
    <header class="head">
      <div class="head-row">
        <span class="head-title">Beyond the basics</span>
        <span class="head-count">{progress.completed} of {progress.total}</span>
      </div>
      <MeterBar value={progress.total === 0 ? 0 : progress.completed / progress.total} />
    </header>

    {#if walkthroughViewState.visible.length === 0}
      <EmptyState
        message={walkthroughService.tasks.length === 0
          ? 'No walkthrough tasks yet'
          : 'No tasks match your search'}
        description={walkthroughService.tasks.length === 0
          ? 'Extensions add their own tasks here as you install them.'
          : undefined}
      />
    {:else}
      <div class="list" role="listbox" aria-label="Walkthrough tasks" bind:this={listEl}>
        {#each walkthroughViewState.visible as item, i (item.id)}
          <ListItem
            data-index={i}
            selected={i === walkthroughViewState.selectedIndex}
            title={item.title}
            subtitle={item.summary || requirement(item.completion)}
            onclick={() => walkthroughViewState.open(item.id)}
          >
            {#snippet leading()}
              <span class="check" class:done={item.completed}>
                {#if item.completed}
                  <Icon name="star" size={16} />
                {:else if isBuiltInIcon(item.icon ?? '')}
                  <Icon name={getBuiltInIconName(item.icon ?? '')} size={16} />
                {/if}
              </span>
            {/snippet}
            {#snippet trailing()}
              {#if item.completed && item.source === 'manual'}
                <Badge text="Marked" variant="default" />
              {:else if item.completed}
                <Badge text="Done" variant="success" />
              {:else if taskProgressLabel(item.progress)}
                <span class="row-progress">
                  <span class="row-progress-label">{taskProgressLabel(item.progress)}</span>
                  <span class="row-progress-meter">
                    <MeterBar value={taskProgressFraction(item.progress)} />
                  </span>
                </span>
              {/if}
            {/snippet}
          </ListItem>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .walkthrough {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-4);
    overflow-y: auto;
    height: 100%;
  }

  .head {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: 0 var(--space-2);
  }

  .head-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
  }

  .head-title {
    font-size: var(--font-size-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-tertiary);
    font-weight: 600;
  }

  .head-count {
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
  }

  .list {
    display: flex;
    flex-direction: column;
  }

  .check {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-6);
    height: var(--space-6);
    border-radius: var(--radius-full);
    border: 1px solid var(--separator);
    color: var(--text-tertiary);
  }

  .check.done {
    border-color: var(--accent-primary);
    color: var(--accent-primary);
  }

  .detail {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: 0 var(--space-2);
  }

  .detail-head {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .detail-title {
    font-size: var(--font-size-lg);
    color: var(--text-primary);
    margin: 0;
    flex: 1;
  }

  .row-progress {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--space-1);
  }

  .row-progress-label {
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
    white-space: nowrap;
  }

  /* Derived from the spacing scale rather than a magic px so the bar keeps
     its proportions if the scale is ever retuned. */
  .row-progress-meter {
    width: calc(var(--space-11) * 2);
  }

  .detail-progress {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .detail-progress-label {
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
  }

  .detail-image {
    width: 100%;
    border-radius: var(--radius-md);
    border: 1px solid var(--separator);
  }

  .detail-body {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    line-height: 1.6;
  }
</style>
