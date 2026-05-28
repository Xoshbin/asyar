import { defineConfig } from 'vitest/config'
import { existsSync } from 'fs'
import { fileURLToPath, URL } from 'url'
import { resolve } from 'path'
import { sveltekit } from '@sveltejs/kit/vite'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const sdkSrcDir = resolve(__dirname, '../asyar-sdk/src')
const sdkSubpaths = ['contracts', 'worker', 'view'] as const
const useLocalSdk = sdkSubpaths.every((sub) =>
  existsSync(resolve(sdkSrcDir, `${sub}.ts`))
)

const sdkAliases = useLocalSdk
  ? Object.fromEntries(
      sdkSubpaths.map((sub) => [
        `asyar-sdk/${sub}`,
        resolve(sdkSrcDir, `${sub}.ts`),
      ])
    )
  : {}

export default defineConfig({
  plugins: [sveltekit()],
  resolve: {
    alias: sdkAliases,
    // Pick Svelte's browser/client bundle so @testing-library/svelte's
    // mount() works under jsdom. Without this, vitest's default 'node'
    // conditions resolve to svelte's SSR build and component tests fail
    // with `lifecycle_function_unavailable: mount(...) is not available
    // on the server`.
    conditions: ['browser'],
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,js}', 'scripts/**/*.test.mjs'],
  },
})
