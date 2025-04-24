import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';
import { fileURLToPath } from 'url'; // Import fileURLToPath

// Helper to get __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  plugins: [svelte()],
  build: {
    lib: {
      // Could also be a dictionary or array of multiple entry points
      entry: path.resolve(__dirname, 'index.ts'), // Correct entry path
      name: 'StoreExtension', // The global variable name if not using module formats
      fileName: (format) => `index.${format}.js`, // Output file name pattern
      formats: ['es'], // Build for ES module format
    },
    rollupOptions: {
      // Make sure to externalize dependencies that are provided by the main application
      external: [
        'svelte',
        'svelte/store',
        'svelte/transition',
      ], // Ensure Svelte runtime isn't bundled
      // Removed output.globals as it's not needed for ES modules
    },
    outDir: 'dist', // Specify the output directory
    emptyOutDir: true, // Clear the output directory before building
  },
});
