<script lang="ts">
  import { onMount } from 'svelte';
  import ClipboardPrivacySection from '../../../components/settings/ClipboardPrivacySection.svelte';
  import { clipboardPrivacyService } from '../../../services/privacy/clipboardPrivacyService.svelte';

  // The settings window is a separate Tauri webview with its own JS context,
  // so the main launcher's appInitializer hasn't run here. Initialise the
  // service from this tab's onMount — same pattern as authService in
  // settings/+page.svelte.
  onMount(() => {
    clipboardPrivacyService.init();
  });
</script>

<div class="privacy-tab">
  <ClipboardPrivacySection />
</div>

<style>
  .privacy-tab {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }
</style>
