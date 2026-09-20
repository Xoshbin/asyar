import { defineConfig } from 'vitest/config';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const resolveCompat = (id: string) => require.resolve(id, { paths: [__dirname] });

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    alias: {
      '@raycast/api': path.resolve(__dirname, 'src/index.ts'),
      '@raycast/utils': path.resolve(__dirname, 'src/utils/index.ts'),
      '@asyar/raycast-compat/runner': path.resolve(__dirname, 'src/runner/index.ts'),
      '@asyar/raycast-compat/utils': path.resolve(__dirname, 'src/utils/index.ts'),
      '@asyar/raycast-compat': path.resolve(__dirname, 'src/index.ts'),
      'react/jsx-runtime': resolveCompat('react/jsx-runtime'),
      'react/jsx-dev-runtime': resolveCompat('react/jsx-dev-runtime'),
      'react-dom/client': resolveCompat('react-dom/client'),
      'react-dom': resolveCompat('react-dom'),
      react: resolveCompat('react'),
      'js-base64': path.resolve(
        __dirname,
        '../../extensions/raycast-base64/node_modules/js-base64/index.js',
      ),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
