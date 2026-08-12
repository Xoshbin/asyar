<script lang="ts">
  import { onMount } from 'svelte';
  import {
    ClipboardPrivacySection,
    CrashReportSection,
    EncryptionStatusSection,
    SecretRedactionSection,
    SettingsPaneHeader,
    ShellTrustManager,
    UsageShareSection,
  } from '../../../components';
  import { clipboardPrivacyService } from '../../../services/privacy/clipboardPrivacyService.svelte';
  import { secretRedactionService } from '../../../services/privacy/secretRedactionService.svelte';
  import { encryptionService } from '../../../services/privacy/encryptionService.svelte';

  // The settings window is a separate Tauri webview with its own JS context,
  // so the main launcher's appInitializer hasn't run here. Initialise the
  // services from this tab's onMount — same pattern as authService in
  // settings/+page.svelte.
  onMount(() => {
    clipboardPrivacyService.init();
    secretRedactionService.init();
    encryptionService.init();
  });
</script>

<div class="privacy-tab">
  <SettingsPaneHeader
    title="Privacy"
    subtitle="Control local encryption, crash reports, usage sharing, and sensitive data handling."
  />

  <div id="privacy-encryption" class="anchor-group">
    <EncryptionStatusSection />
  </div>

  <div id="privacy-reports" class="anchor-group">
    <CrashReportSection />
  </div>

  <div id="privacy-usage" class="anchor-group">
    <UsageShareSection />
  </div>

  <div id="privacy-clipboard" class="anchor-group">
    <ClipboardPrivacySection />
  </div>

  <div id="privacy-redaction" class="anchor-group">
    <SecretRedactionSection />
  </div>

  <div id="privacy-shell-trust" class="anchor-group">
    <ShellTrustManager />
  </div>
</div>

<style>
  .privacy-tab {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .anchor-group {
    scroll-margin-top: var(--space-6);
  }
</style>
