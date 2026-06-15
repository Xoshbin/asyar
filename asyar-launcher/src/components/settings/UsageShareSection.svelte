<script lang="ts">
  import { SettingsSection, SettingsRow, SettingsRadioGroup, Button } from '../index';
  import { settingsService } from '../../services/settings/settingsService.svelte';
  import type { UsageShareMode } from '../../services/settings/types/AppSettingsType';
  import { usageShareState } from './usageShareState.svelte';

  const options: { value: string; label: string; description?: string }[] = [
    { value: 'off', label: 'Off', description: 'Nothing leaves your device.' },
    { value: 'ask', label: 'Ask me each time', description: 'Review the exact data before it is sent.' },
    { value: 'auto', label: 'Share automatically', description: 'Send anonymous daily counts in the background.' },
  ];

  let mode = $derived(settingsService.currentSettings.privacy.usageShareMode);

  async function choose(value: string) {
    await settingsService.updateSettings('privacy', { usageShareMode: value as UsageShareMode });
  }

  $effect(() => {
    void usageShareState.load();
  });
</script>

<SettingsSection
  title="Anonymous usage share"
  description="Help shape Asyar by sharing anonymous daily counts of which commands you run. No search text, no timestamps, no file paths. Off by default."
>
  <SettingsRadioGroup name="usage-share-mode" {options} value={mode} onchange={choose} />

  <SettingsRow
    label="Anonymous ID"
    description="A random id, not linked to your account. Reset it any time."
    noBorder
  >
    <span class="text-mono text-caption">{usageShareState.anonId}</span>
    <Button onclick={() => usageShareState.reset()}>Reset</Button>
  </SettingsRow>
</SettingsSection>
