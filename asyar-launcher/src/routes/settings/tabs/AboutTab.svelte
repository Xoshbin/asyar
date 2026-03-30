<script lang="ts">
  import { SettingsSection, Button } from '../../../components';
  import type { SettingsHandler } from '../settingsHandlers.svelte';

  let {
    handler,
  }: {
    handler: SettingsHandler;
  } = $props();
</script>

<SettingsSection title="About">
  <div class="p-6">
    <div class="flex flex-col items-center justify-center pb-8 mb-8 border-b border-[var(--border-color)]">
      <div class="w-24 h-24 rounded-xl mx-auto mb-4 shadow-xl flex items-center justify-center">
        <img src="/src/resources/images/Square142x142Logo.png" alt="">
      </div>
      <h2 class="text-2xl font-bold mt-4 text-[var(--text-primary)]">Asyar</h2>
      <p class="text-[var(--text-secondary)] mt-2">Version 0.1.0</p>
    </div>
    
    <div class="grid md:grid-cols-2 gap-8">
      <div>
        <h3 class="text-lg font-medium mb-3 text-[var(--text-primary)]">Description</h3>
        <p class="text-[var(--text-secondary)] leading-relaxed">
          Asyar is a lightweight, keyboard-driven application launcher for macOS.
          Find and launch applications quickly with just a few keystrokes.
        </p>
      </div>
      
      <div>
        <h3 class="text-lg font-medium mb-3 text-[var(--text-primary)]">Credits</h3>
        <p class="text-[var(--text-secondary)] mb-2">
          <strong>Created by:</strong> Khoshbin Ali
        </p>
        <p class="text-[var(--text-secondary)] mb-2">
          <strong>Built with:</strong> Tauri, Rust, Svelte, TypeScript
        </p>
      </div>
    </div>
    
    <div class="flex gap-4 mt-8 pt-6 border-t border-[var(--border-color)]">
      <Button>
        Check for Updates
      </Button>
      <Button>
        View on GitHub
      </Button>
      <div class="grow"></div>
      <Button>
        Privacy Policy
      </Button>
      <Button>
        License
      </Button>
    </div>
  </div>
</SettingsSection>
