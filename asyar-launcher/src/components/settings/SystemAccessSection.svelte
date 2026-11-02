<script lang="ts">
  import { SettingsCard } from '../index';
  import CalendarAccessRows from './CalendarAccessRows.svelte';
  import { t } from '../../services/i18n';

  let available = $state(false);
</script>

{#if available}
  <div class="section-header">{t('settings.privacy.section_system_access')}</div>
{/if}
<!-- Stays mounted while hidden: the rows component is what detects availability. -->
<div style:display={available ? undefined : 'none'}>
  <SettingsCard>
    <CalendarAccessRows bind:available />
  </SettingsCard>
</div>
