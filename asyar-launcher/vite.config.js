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

export default defineConfig(({ mode }) => {
  const useLocalSdk = mode === "development" && existsSync(localSdkEntry);
  console.log(
    `\x1b[36m[Vite]\x1b[0m Asyar-SDK resolution: \x1b[33m${
      useLocalSdk ? "Local Source (" + localSdkEntry + ")" : "node_modules (NPM)"
    }\x1b[0m`
  );

  return {
    plugins: [sveltekit(), tailwindcss()],

    resolve: {
      alias: useLocalSdk
        ? {
            "asyar-sdk/dist": resolve(__dirname, "../asyar-sdk/src"),
            "@asyar-sdk-core": localSdkEntry,
          }
        : {
            "@asyar-sdk-core": "asyar-sdk", // Handled transparently by Vite
          },
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
    fs: {
      allow: [
        resolve(__dirname, ".."), // workspace root (for hoisted node_modules/.pnpm)
      ],
    },
  },
  };
});
