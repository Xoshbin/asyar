<script lang="ts">
  import { SettingsCard } from '../index';
  import CalendarAccessRows from './CalendarAccessRows.svelte';
  import OsPermissionRows from './OsPermissionRows.svelte';
  import { t } from '../../services/i18n';

  let calendarAvailable = $state(false);
  let osAvailable = $state(false);
  const available = $derived(calendarAvailable || osAvailable);
</script>

{#if available}
  <div class="section-header">{t('settings.privacy.section_system_access')}</div>
{/if}
<!-- Stays mounted while hidden: the rows component is what detects availability. -->
<div style:display={available ? undefined : 'none'}>
  <SettingsCard>
    <OsPermissionRows bind:available={osAvailable} />
    <CalendarAccessRows bind:available={calendarAvailable} />
  </SettingsCard>
</div>
