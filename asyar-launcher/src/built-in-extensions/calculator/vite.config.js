import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  plugins: [svelte({ inspector: false })],
  build: {
    lib: {
      entry: path.resolve(__dirname, 'index.ts'),
      name: 'CalculatorExtension',
      fileName: (format) => `index.${format}.js`,
      formats: ['es'],
    },
    rollupOptions: {
      external: [
        /^svelte(\/|$)/,
        'asyar-sdk'
      ],
    },
    outDir: 'dist',
    emptyOutDir: true,
  },
});
