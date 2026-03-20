import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath, URL } from 'url';
import { existsSync } from 'fs';
import { resolve } from 'path';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const localSdkEntry = resolve(__dirname, '../../asyar-sdk/src/index.ts');

export default defineConfig(({ mode }) => ({
  plugins: [svelte()],
  resolve: {
    alias:
      mode === 'development' && existsSync(localSdkEntry)
        ? { 'asyar-sdk': localSdkEntry }
        : undefined,
  },
}));
