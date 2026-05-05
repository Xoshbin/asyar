<script lang="ts">
  import {
    SettingsSection,
    SettingsRow,
    Input,
    Button,
    Badge,
    EmptyState,
  } from '../index';
  import { clipboardPrivacyService } from '../../services/privacy/clipboardPrivacyService.svelte';

  let newEntry = $state('');

  let totalSkipped = $derived(
    Object.values(clipboardPrivacyService.sessionStats).reduce((a, b) => a + b, 0),
  );

  let isLinux = $derived(
    typeof document !== 'undefined' &&
      document.documentElement.dataset.platform === 'linux',
  );

  async function handleAdd() {
    const trimmed = newEntry.trim();
    if (!trimmed) return;
    await clipboardPrivacyService.addToDenylist(trimmed);
    newEntry = '';
  }
</script>

<SettingsSection
  title="Clipboard Privacy"
  description="Asyar will not store clipboard items that the OS or source app has marked private."
>
  {#if isLinux}
    <SettingsRow
      label="Platform note"
      description="Your Linux desktop does not provide a standard clipboard exclusion API. Source-app filtering only."
    >
      {#snippet children()}
        <Badge text="Source filter only" variant="info" />
      {/snippet}
    </SettingsRow>
  {/if}

  <SettingsRow
    label="This session"
    description="Clipboard items skipped since the launcher started."
  >
    {#snippet children()}
      <Badge text={`${totalSkipped} skipped`} variant="info" />
    {/snippet}
  </SettingsRow>

  <SettingsRow
    label="Default denylist"
    description="Built-in password managers — always blocked, not editable."
  >
    {#snippet children()}
      {#if clipboardPrivacyService.defaultDenylist.length === 0}
        <EmptyState message="No defaults loaded" />
      {:else}
        <ul class="denylist">
          {#each clipboardPrivacyService.defaultDenylist as bundleId}
            <li class="denylist-row text-caption">{bundleId}</li>
          {/each}
        </ul>
      {/if}
    {/snippet}
  </SettingsRow>

  <SettingsRow
    label="Add bundle id"
    description="Bundle id (macOS), executable name (Windows), or .desktop id (Linux)."
  >
    {#snippet children()}
      <div class="add-row">
        <Input bind:value={newEntry} placeholder="com.example.YourVault" />
        <Button onclick={handleAdd} disabled={newEntry.trim().length === 0}>
          Add
        </Button>
      </div>
    {/snippet}
  </SettingsRow>

  <SettingsRow
    label="Your additions"
    description="Apps you have added to the denylist."
    noBorder
  >
    {#snippet children()}
      {#if clipboardPrivacyService.userDenylist.length === 0}
        <EmptyState message="No custom entries yet" />
      {:else}
        <ul class="denylist">
          {#each clipboardPrivacyService.userDenylist as bundleId}
            <li class="denylist-row user-row">
              <span class="text-body">{bundleId}</span>
              <Button
                onclick={() => clipboardPrivacyService.removeFromDenylist(bundleId)}
              >
                Remove
              </Button>
            </li>
          {/each}
        </ul>
      {/if}
    {/snippet}
  </SettingsRow>
</SettingsSection>

<style>
  .denylist {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .denylist-row {
    color: var(--text-secondary);
  }

  .user-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .add-row {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }
</style>
