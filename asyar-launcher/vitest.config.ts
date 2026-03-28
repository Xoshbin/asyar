import { defineConfig } from 'vitest/config'
import { existsSync } from 'fs'
import { fileURLToPath, URL } from 'url'
import { resolve } from 'path'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const localSdkEntry = resolve(__dirname, '../asyar-sdk/src/index.ts')
const useLocalSdk = existsSync(localSdkEntry)

export default defineConfig({
  resolve: {
    alias: useLocalSdk
      ? {
          'asyar-sdk/dist': resolve(__dirname, '../asyar-sdk/src'),
          'asyar-sdk': localSdkEntry,
          '@asyar-sdk-core': localSdkEntry,
        }
      : {
          '@asyar-sdk-core': 'asyar-sdk',
        },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,js}'],
  },
})
