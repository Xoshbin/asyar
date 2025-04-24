import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';
import { fileURLToPath } from 'url'; // Import fileURLToPath

// Helper to get __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  plugins: [svelte({ inspector: false })],
  build: {
    lib: {
      // Could also be a dictionary or array of multiple entry points
      entry: path.resolve(__dirname, 'index.ts'), // Correct entry path
      name: 'StoreExtension', // The global variable name if not using module formats
      fileName: (format) => `index.${format}.js`, // Output file name pattern
      formats: ['es'], // Build for ES module format
    },
    rollupOptions: {
      // Ensure Svelte libraries are treated as external and not bundled
      external: [
        'svelte',
        'svelte/store',
        'svelte/transition'
        // 'asyar-api' should NOT be external, it needs to be bundled
      ],
      // No 'output.globals' needed for ES module format
    },
    outDir: 'dist', // Specify the output directory
    emptyOutDir: true, // Clear the output directory before building
  },
});
