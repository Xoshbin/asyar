<script lang="ts">
  import type { Snippet } from 'svelte';
  import { entitlementService } from '../../services/auth/entitlementService.svelte';
  import { authService } from '../../services/auth/authService.svelte';
  import { openUrl } from '@tauri-apps/plugin-opener';

  let {
    entitlement,
    featureName,
    children,
  }: {
    /** The entitlement string to check (e.g. "sync:settings"). */
    entitlement: string;
    /** Human-readable name of the feature for the upsell message. */
    featureName: string;
    children: Snippet;
  } = $props();

  const result = $derived(entitlementService.gate(entitlement));
</script>

{#if result.allowed}
  {@render children()}
{:else}
  <!-- Upsell overlay — only shown when user IS logged in but lacks the entitlement -->
  <div
    class="relative rounded-lg overflow-hidden"
    style="border: 1px solid var(--separator); background: var(--bg-secondary);"
    role="region"
    aria-label="{featureName} — upgrade required"
  >
    <!-- Blurred placeholder slot -->
    <div class="pointer-events-none select-none opacity-30 blur-sm" aria-hidden="true">
      {@render children()}
    </div>

    <!-- Overlay -->
    <div
      class="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center"
      style="background: color-mix(in srgb, var(--bg-primary) 85%, transparent);"
    >
      <div style="color: var(--text-secondary)" aria-hidden="true">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
          <path d="M7 11V7a5 5 0 0110 0v4"/>
        </svg>
      </div>
      <p class="text-sm font-medium" style="color: var(--text-primary)">
        {featureName} requires a subscription
      </p>
      {#if !authService.isLoggedIn}
        <p class="text-xs" style="color: var(--text-secondary)">Sign in to see available plans</p>
      {/if}
      <button
        class="mt-1 px-4 py-2 rounded-lg text-sm font-medium"
        style="background: var(--bg-tertiary); border: 1px solid var(--separator); color: var(--text-primary); cursor: pointer;"
        onclick={() => openUrl('https://asyar.org/pricing')}
      >
        View Plans
      </button>
    </div>
  </div>
{/if}
