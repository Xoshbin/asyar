<script lang="ts">
  import ModalOverlay from '../layout/ModalOverlay.svelte';
  import { onMount } from 'svelte';
  
  interface Props {
    extensionName: string;
    extensionIcon?: string;
    program: string;
    resolvedPath: string;
    onAllow: () => void;
    onDeny: () => void;
  }
  
  let { extensionName, extensionIcon, program, resolvedPath, onAllow, onDeny }: Props = $props();
  
  const safePaths = [
    '/usr/bin',
    '/bin',
    '/usr/local/bin',
    '/opt/homebrew/bin',
    'C:\\Windows\\System32',
    'C:\\Program Files',
  ];
  
  const isSafe = $derived(safePaths.some(safe => resolvedPath.startsWith(safe)));
  
  function handleDeny() {
    onDeny();
  }
  
  function handleAllow() {
    onAllow();
  }
</script>

<ModalOverlay 
  title="Terminal Access Request" 
  subtitle="An extension wants to run a terminal command"
>
  <div class="flex flex-col gap-6 p-2">
    <!-- Extension Info -->
    <div class="flex items-center gap-4 p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-subtle)]">
      {#if extensionIcon}
        <img src={extensionIcon} alt={extensionName} class="w-12 h-12 rounded-lg shadow-sm" />
      {:else}
        <div class="w-12 h-12 rounded-lg bg-[var(--accent-primary)] flex items-center justify-center text-white font-bold text-xl">
          {extensionName.charAt(0).toUpperCase()}
        </div>
      {/if}
      <div class="flex flex-col">
        <span class="text-[var(--text-primary)] font-semibold text-lg">{extensionName}</span>
        <span class="text-[var(--text-secondary)] text-sm">wants to access the terminal</span>
      </div>
    </div>

    <!-- Binary Info -->
    <div class="flex flex-col gap-2">
      <div class="p-3 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] font-mono text-xs break-all leading-relaxed">
        <span class="text-[var(--accent-primary)] font-bold mr-1">$</span> {resolvedPath}
      </div>
      <div class="text-[var(--text-secondary)] text-[10px] px-1 flex items-center gap-1 opacity-70">
        <span>Alias:</span>
        <span class="font-semibold text-[var(--text-primary)]">{program}</span>
      </div>
    </div>

    {#if !isSafe}
      <div class="flex items-start gap-3 p-4 rounded-xl bg-orange-500/10 border border-orange-500/20 text-orange-200">
        <div class="mt-0.5">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
        </div>
        <div class="flex flex-col gap-1">
          <span class="font-semibold text-sm">Non-standard location</span>
          <p class="text-xs opacity-90 leading-relaxed">
            This binary is located outside of standard system directories. Only allow this if you trust the source of this program.
          </p>
        </div>
      </div>
    {/if}

    <div class="flex flex-col gap-2 mt-2">
      <p class="text-[var(--text-secondary)] text-[13px] leading-relaxed px-1">
        By allowing, this extension will be able to run this command at any time. You can revoke this permission in Settings.
      </p>
    </div>

    <!-- Buttons -->
    <div class="grid grid-cols-2 gap-3 mt-4">
      <button 
        class="h-11 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-[var(--text-primary)] font-medium hover:bg-[var(--bg-tertiary)] transition-colors"
        onclick={handleDeny}
      >
        Deny
      </button>
      <button 
        class="h-11 rounded-xl bg-[var(--accent-primary)] text-white font-semibold shadow-lg shadow-[var(--accent-primary)]/20 hover:brightness-110 active:scale-[0.98] transition-all"
        onclick={handleAllow}
      >
        Allow Always
      </button>
    </div>
  </div>
</ModalOverlay>
