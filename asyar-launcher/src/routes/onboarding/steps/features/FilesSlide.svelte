<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '../../../../services/i18n';
  import FileSearchView from '../../../../built-in-features/file-search/DefaultView.svelte';
  import { fileSearchViewState } from '../../../../built-in-features/file-search/state.svelte';
  import LauncherFrame from './LauncherFrame.svelte';

  onMount(() => () => {
    fileSearchViewState.searchQuery = '';
  });
</script>

<LauncherFrame
  placeholder={t('onboarding.tour.files_placeholder')}
  onquery={(q) => (fileSearchViewState.searchQuery = q)}
  onmove={(d) => fileSearchViewState.moveSelection(d)}
>
  <FileSearchView />
</LauncherFrame>
