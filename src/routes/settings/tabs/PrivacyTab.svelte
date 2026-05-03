<script lang="ts">
  import { onMount } from 'svelte';
  import ClipboardPrivacySection from '../../../components/settings/ClipboardPrivacySection.svelte';
  import SecretRedactionSection from '../../../components/settings/SecretRedactionSection.svelte';
  import { clipboardPrivacyService } from '../../../services/privacy/clipboardPrivacyService.svelte';
  import { secretRedactionService } from '../../../services/privacy/secretRedactionService.svelte';

  // The settings window is a separate Tauri webview with its own JS context,
  // so the main launcher's appInitializer hasn't run here. Initialise the
  // services from this tab's onMount — same pattern as authService in
  // settings/+page.svelte.
  onMount(() => {
    clipboardPrivacyService.init();
    secretRedactionService.init();
  });
</script>

<div class="privacy-tab">
  <ClipboardPrivacySection />
  <SecretRedactionSection />
</div>

<style>
  .privacy-tab {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }
</style>
