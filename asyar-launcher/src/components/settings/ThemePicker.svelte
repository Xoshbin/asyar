<script lang="ts">
  import Icon from '../base/Icon.svelte';
  import { getThemeDefinition } from '../../lib/ipc/commands';
  import type { ThemeDefinition } from '../../lib/ipc/commands';
  import { formatThemeId } from '../../lib/themeVariants';
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

  let definitions = $state<Record<string, ThemeDefinition>>({});
  const requested = new Set<string>();

  function pickPreviewVars(variables: Record<string, string>): Record<string, string> {
    return Object.fromEntries(
      PREVIEW_VARS.filter((name) => variables[name]).map((name) => [name, variables[name]]),
    );
  }

  $effect(() => {
    for (const theme of themes) {
      if (requested.has(theme.id)) continue;
      requested.add(theme.id);
      getThemeDefinition(theme.id)
        .then((definition) => {
          definitions[theme.id] = definition;
        })
        .catch((e) => logService.warn(`Failed to load theme preview for ${theme.id}: ${e}`));
    }
  });

  const cards = $derived([
    {
      id: null as string | null,
      name: t('settings.general.default_theme'),
      meta: t('settings.general.default_theme_meta'),
      vars: {} as Record<string, string>,
    },
    ...themes.flatMap((theme) => {
      const def = definitions[theme.id];
      const meta = theme.author ? `${theme.author} · v${theme.version}` : `v${theme.version}`;
      const variants = def?.variants ?? [];
      if (variants.length > 0) {
        return variants.map((variant) => ({
          id: formatThemeId(theme.id, variant.id),
          name: `${theme.name} · ${variant.name}`,
          meta,
          vars: pickPreviewVars({ ...(def.variables ?? {}), ...(variant.variables ?? {}) }),
        }));
      }
      return [
        {
          id: theme.id,
          name: theme.name,
          meta,
          vars: pickPreviewVars(def?.variables ?? {}),
        },
      ];
    }),
  ]);
</script>

<div class="theme-grid" role="radiogroup" aria-label={t('settings.appearance.theme_picker_aria')}>
  {#each cards as card (card.id)}
    {@const vars = card.vars}
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
        class:builtin={!card.id}
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
    --m-bg: var(--bg-primary);
    --m-sel: var(--bg-selected);
    --m-text: var(--text-primary);
    --m-sub: var(--text-secondary);
    --m-accent: var(--accent-primary);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    aspect-ratio: 16 / 10;
    padding: var(--space-2);
    border-radius: var(--radius-lg);
    border: 1px solid var(--border-color);
    background: var(--m-bg);
    margin-bottom: var(--space-1);
    transition: box-shadow var(--transition-fast);
  }

  /* The built-in palette, so the Default card stays accurate while a custom
     theme overrides the live tokens. Mirrors the settings-page surfaces in style.css. */
  .mini.builtin {
    --m-bg: rgb(245, 245, 247);
    --m-sel: rgba(60, 60, 67, 0.09);
    --m-text: rgba(15, 23, 42, 0.9);
    --m-sub: rgba(60, 60, 67, 0.7);
    --m-accent: #007aff;
  }

  :global(:root[data-theme='dark']) .mini.builtin {
    --m-bg: rgb(30, 30, 32);
    --m-sel: rgb(61, 61, 66);
    --m-text: rgba(255, 255, 255, 0.95);
    --m-sub: rgba(235, 235, 245, 0.65);
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
    background: var(--m-sub);
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
    background: var(--m-sel);
  }

  .mini-icon {
    width: var(--space-3);
    height: var(--space-3);
    border-radius: var(--radius-xs);
    background: var(--m-accent);
    flex-shrink: 0;
  }

  .mini-line {
    height: var(--space-1);
    width: 70%;
    border-radius: var(--radius-full);
    background: var(--m-text);
    opacity: 0.8;
  }

  .mini-line.short {
    width: 45%;
    background: var(--m-sub);
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
