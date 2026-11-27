<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '../../../../services/i18n';
  import ClipboardView from '../../../../built-in-features/clipboard-history/DefaultView.svelte';
  import { clipboardViewState } from '../../../../built-in-features/clipboard-history/state.svelte';
  import { clipboardHistoryStore } from '../../../../services/clipboard/stores/clipboardHistoryStore.svelte';
  import LauncherFrame from './LauncherFrame.svelte';

  onMount(() => {
    const reload = () => {
      if (!clipboardViewState.searchQuery.trim()) void clipboardHistoryStore.loadInitial();
    };
    window.addEventListener('focus', reload);
    return () => {
      window.removeEventListener('focus', reload);
      clipboardViewState.setSearch('');
    };
  });
</script>

<LauncherFrame
  placeholder={t('onboarding.tour.clipboard_placeholder')}
  onquery={(q) => clipboardViewState.setSearch(q)}
  onmove={(d) => clipboardViewState.moveSelection(d)}
>
  <ClipboardView />
</LauncherFrame>
