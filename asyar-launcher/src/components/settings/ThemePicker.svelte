<script lang="ts">
  import Icon from '../base/Icon.svelte';
  import { getThemeDefinition } from '../../lib/ipc/commands';
  import { logService } from '../../services/log/logService';
  import { t } from '../../services/i18n';

  type ThemeEntry = { id: string; name: string; author?: string; version: string };

  let {
    themes,
    activeId,
    onselect,
    ongetmore,
  }: {
    themes: ThemeEntry[];
    activeId: string | null;
    onselect: (id: string | null) => void;
    ongetmore: () => void;
  } = $props();

  const PREVIEW_VARS = [
    '--bg-primary',
    '--bg-selected',
    '--text-primary',
    '--text-secondary',
    '--accent-primary',
  ];

  let colors = $state<Record<string, Record<string, string>>>({});
  const requested = new Set<string>();

  $effect(() => {
    for (const theme of themes) {
      if (requested.has(theme.id)) continue;
      requested.add(theme.id);
      getThemeDefinition(theme.id)
        .then((definition) => {
          colors[theme.id] = Object.fromEntries(
            PREVIEW_VARS.filter((name) => definition.variables[name]).map((name) => [
              name,
              definition.variables[name],
            ]),
          );
        })
        .catch((e) => logService.warn(`Failed to load theme preview for ${theme.id}: ${e}`));
    }
  });

  const cards = $derived([
    {
      id: null,
      name: t('settings.general.default_theme'),
      meta: t('settings.general.default_theme_meta'),
    },
    ...themes.map((theme) => ({
      id: theme.id,
      name: theme.name,
      meta: theme.author ? `${theme.author} · v${theme.version}` : `v${theme.version}`,
    })),
  ]);
</script>

<div class="theme-grid" role="radiogroup" aria-label={t('settings.appearance.theme_picker_aria')}>
  {#each cards as card (card.id)}
    {@const vars = card.id ? (colors[card.id] ?? {}) : {}}
    <button
      type="button"
      class="theme-card"
      class:active={activeId === card.id}
      role="radio"
      aria-checked={activeId === card.id}
      onclick={() => onselect(card.id)}
    >
      <div
        class="mini"
        style:--m-bg={vars['--bg-primary']}
        style:--m-sel={vars['--bg-selected']}
        style:--m-text={vars['--text-primary']}
        style:--m-sub={vars['--text-secondary']}
        style:--m-accent={vars['--accent-primary']}
        aria-hidden="true"
      >
        <span class="mini-search"></span>
        <span class="mini-row selected"
          ><span class="mini-icon"></span><span class="mini-line"></span></span
        >
        <span class="mini-row"
          ><span class="mini-icon"></span><span class="mini-line short"></span></span
        >
      </div>
      <span class="card-name truncate">{card.name}</span>
      <span class="card-meta truncate">{card.meta}</span>
    </button>
  {/each}
  <button type="button" class="theme-card get-more" onclick={ongetmore}>
    <div class="mini mini-empty" aria-hidden="true">
      <Icon name="plus" size={20} />
    </div>
    <span class="card-name truncate">{t('settings.appearance.get_more_themes')}</span>
  </button>
</div>

<style>
  .theme-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: var(--space-5);
  }

  .theme-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
    padding: 0;
    border: none;
    background: none;
    text-align: left;
    cursor: default;
  }

  .theme-card:focus-visible {
    outline: none;
  }

  .mini {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    aspect-ratio: 16 / 10;
    padding: var(--space-2);
    border-radius: var(--radius-lg);
    border: 1px solid var(--border-color);
    background: var(--m-bg, var(--bg-primary));
    margin-bottom: var(--space-1);
    transition: box-shadow var(--transition-fast);
  }

  .theme-card.active .mini {
    box-shadow: 0 0 0 2px var(--accent-primary);
  }

  .theme-card:focus-visible .mini {
    box-shadow: var(--shadow-focus);
  }

  .mini-search {
    height: var(--space-2);
    width: 60%;
    border-radius: var(--radius-full);
    background: var(--m-sub, var(--text-secondary));
    opacity: 0.5;
    margin-bottom: var(--space-1);
  }

  .mini-row {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-0-5) var(--space-1);
    border-radius: var(--radius-xs);
  }

  .mini-row.selected {
    background: var(--m-sel, var(--bg-selected));
  }

  .mini-icon {
    width: var(--space-3);
    height: var(--space-3);
    border-radius: var(--radius-xs);
    background: var(--m-accent, var(--accent-primary));
    flex-shrink: 0;
  }

  .mini-line {
    height: var(--space-1);
    width: 70%;
    border-radius: var(--radius-full);
    background: var(--m-text, var(--text-primary));
    opacity: 0.8;
  }

  .mini-line.short {
    width: 45%;
    background: var(--m-sub, var(--text-secondary));
  }

  .mini-empty {
    align-items: center;
    justify-content: center;
    border-style: dashed;
    background: transparent;
    color: var(--text-secondary);
  }

  .get-more:hover .mini-empty {
    color: var(--text-primary);
    border-color: var(--text-tertiary);
  }

  .card-name {
    font-size: var(--font-size-md);
    font-weight: var(--font-weight-medium);
    color: var(--text-primary);
  }

  .card-meta {
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
  }

  .truncate {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
