<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { SettingsRow, Button } from '../index';
  import {
    calendarAccessStatus,
    calendarRequestAccess,
    openSettingsPane,
    type CalendarAccessKind,
    type CalendarAccessState,
  } from '../../lib/ipc/commands';
  import { t } from '../../services/i18n';

  const PRIVACY_PANE = 'com.apple.settings.PrivacySecurity.extension';

  let { available = $bindable(false) }: { available?: boolean } = $props();

  let states = $state<Record<CalendarAccessKind, CalendarAccessState>>({
    calendar: 'unsupported',
    reminders: 'unsupported',
  });
  let busy = $state<CalendarAccessKind | null>(null);
  // Set when a request returned without macOS showing a prompt or deciding.
  let noPrompt = $state<Record<CalendarAccessKind, boolean>>({ calendar: false, reminders: false });

  const rows = $derived<{ kind: CalendarAccessKind; label: string; description: string }[]>([
    {
      kind: 'calendar',
      label: t('settings.privacy.calendar_access'),
      description: t('settings.privacy.calendar_access_desc'),
    },
    {
      kind: 'reminders',
      label: t('settings.privacy.reminders_access'),
      description: t('settings.privacy.reminders_access_desc'),
    },
  ]);

  async function refresh() {
    // Independent reads: one failing must not hide the other row. A failed
    // kind keeps its last known state and is re-read on the next window focus.
    await Promise.all(
      (['calendar', 'reminders'] as const).map(async (kind) => {
        try {
          states[kind] = (await calendarAccessStatus(kind)) ?? 'unsupported';
        } catch {
          // keep previous state
        }
      }),
    );
    available = states.calendar !== 'unsupported' || states.reminders !== 'unsupported';
  }

  async function allow(kind: CalendarAccessKind) {
    busy = kind;
    try {
      states[kind] = (await calendarRequestAccess(kind)) ?? states[kind];
      noPrompt[kind] = states[kind] === 'notDetermined';
    } finally {
      busy = null;
    }
  }

  // The user changes the decision in System Settings, so re-read on return.
  onMount(() => {
    void refresh();
    window.addEventListener('focus', refresh);
  });
  onDestroy(() => window.removeEventListener('focus', refresh));
</script>

{#if available}
  {#each rows as row (row.kind)}
    {@const state = states[row.kind]}
    <SettingsRow
      label={row.label}
      description={state === 'denied'
        ? t('settings.privacy.access_denied_hint')
        : noPrompt[row.kind] && state === 'notDetermined'
          ? t('settings.privacy.access_no_prompt')
          : state === 'writeOnly'
            ? t('settings.privacy.access_write_only')
            : row.description}
    >
      {#if state === 'granted'}
        <span class="text-caption">{t('settings.privacy.access_granted')}</span>
      {:else if state === 'notDetermined' && !noPrompt[row.kind]}
        <Button
          onclick={() => allow(row.kind)}
          disabled={busy === row.kind}
          aria-label={t('settings.privacy.access_allow_for', { name: row.label })}
        >
          {t('settings.privacy.access_allow')}
        </Button>
      {:else}
        <Button
          onclick={() => openSettingsPane(PRIVACY_PANE)}
          aria-label={t('settings.privacy.access_open_settings_for', { name: row.label })}
        >
          {t('settings.privacy.access_open_settings')}
        </Button>
      {/if}
    </SettingsRow>
  {/each}
{/if}
