import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "url";
import { existsSync } from "fs";
import { resolve } from "path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const localSdkEntry = resolve(__dirname, "../asyar-sdk/src/index.ts");

export default defineConfig(({ mode }) => ({
  plugins: [sveltekit(), tailwindcss()],

  resolve: {
    alias:
      mode === "development" && existsSync(localSdkEntry)
        ? { "asyar-sdk": localSdkEntry }
        : undefined,
  },

  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
