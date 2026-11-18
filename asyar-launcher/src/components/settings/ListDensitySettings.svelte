<script lang="ts">
  import Select from '../base/Select.svelte';
  import Toggle from '../base/Toggle.svelte';
  import LauncherListRow from '../list/LauncherListRow.svelte';
  import SettingsRow from './SettingsRow.svelte';
  import SettingsRangeSlider from './SettingsRangeSlider.svelte';
  import {
    clampListDensity,
    DEFAULT_LIST_DENSITY,
    LIST_DENSITY_OPTIONS,
    LIST_DENSITY_RANGES,
    resolveListDensity,
    type ListDensity,
    type ListDensityPreset,
  } from '../../lib/launcher/listDensity';
  import { settingsService } from '../../services/settings/settingsService.svelte';
  import { t } from '../../services/i18n';

  const appearance = $derived(settingsService.currentSettings.appearance);
  const preset = $derived(appearance.listDensity ?? DEFAULT_LIST_DENSITY);
  const density = $derived(resolveListDensity(appearance));

  const SLIDERS = [
    { key: 'rowHeight', labelKey: 'settings.appearance.list_density_row_height' },
    { key: 'iconSize', labelKey: 'settings.appearance.list_density_icon_size' },
    { key: 'gap', labelKey: 'settings.appearance.list_density_gap' },
    { key: 'titleSize', labelKey: 'settings.appearance.list_density_title_size' },
  ] as const;

  const preview = $derived([
    {
      icon: 'icon:clipboard',
      title: t('settings.appearance.list_density_preview_clipboard'),
      subtitle: t('settings.appearance.list_density_preview_builtin'),
    },
    {
      icon: '☕',
      title: t('settings.appearance.list_density_preview_snippet'),
      subtitle: t('settings.appearance.list_density_preview_snippet_sub'),
    },
    {
      icon: 'icon:folder',
      title: t('settings.appearance.list_density_preview_folder'),
      subtitle: t('settings.appearance.list_density_preview_folder_sub'),
    },
  ]);

  function selectPreset(value: string) {
    const listDensity = value as ListDensityPreset;
    // Custom starts from the current look, so switching to it changes nothing on screen.
    settingsService.updateSettings(
      'appearance',
      listDensity === 'custom' && preset !== 'custom'
        ? { listDensity, customListDensity: density }
        : { listDensity },
    );
  }

  function setCustom(patch: Partial<ListDensity>) {
    settingsService.updateSettings('appearance', {
      customListDensity: clampListDensity({ ...density, ...patch }),
    });
  }
</script>

<SettingsRow
  label={t('settings.appearance.list_density')}
  description={t('settings.appearance.list_density_description')}
>
  <Select
    value={preset}
    options={LIST_DENSITY_OPTIONS.map((option) => ({
      value: option.value,
      label: t(option.labelKey),
    }))}
    onchange={selectPreset}
  />
</SettingsRow>
{#if preset === 'custom'}
  {#each SLIDERS as slider}
    <SettingsRow label={t(slider.labelKey)}>
      <SettingsRangeSlider
        {...LIST_DENSITY_RANGES[slider.key]}
        value={density[slider.key]}
        suffix="px"
        onchange={(v) => setCustom({ [slider.key]: v })}
      />
    </SettingsRow>
  {/each}
  <SettingsRow label={t('settings.appearance.list_density_two_line')}>
    <Toggle checked={density.twoLine} onchange={() => setCustom({ twoLine: !density.twoLine })} />
  </SettingsRow>
{/if}
<div
  class="density-preview"
  role="group"
  aria-label={t('settings.appearance.list_density_preview')}
>
  {#each preview as row, i}
    <LauncherListRow
      {density}
      selected={i === 0}
      icon={row.icon}
      title={row.title}
      subtitle={row.subtitle}
      tabindex="-1"
    />
  {/each}
</div>

<style>
  .density-preview {
    display: flex;
    flex-direction: column;
    padding: var(--space-3);
    margin: 0 var(--space-6) var(--space-5);
    border-radius: var(--radius-lg);
    background: var(--bg-secondary);
    pointer-events: none;
  }
</style>
