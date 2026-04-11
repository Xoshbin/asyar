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
  const useLocalSdk = existsSync(localSdkEntry);
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
            "asyar-sdk": localSdkEntry,
            "@asyar-sdk-core": localSdkEntry,
          }
        : {
            "@asyar-sdk-core": "asyar-sdk", // Handled transparently by Vite
          },
    },

    // When we're developing against the local SDK source (monorepo dev
    // workflow), EXCLUDE asyar-sdk from Vite's dep pre-bundling so every
    // edit in ../asyar-sdk/src hot-reloads immediately. Including it here
    // would freeze a bundled copy in node_modules/.vite/deps/asyar-sdk.js
    // that only invalidates when package.json changes — which caused hours
    // of "I fixed it but the launcher still shows the old code" debugging.
    //
    // When consuming the published npm package (useLocalSdk === false),
    // include it as before so Vite pre-bundles it normally.
    optimizeDeps: useLocalSdk
      ? { exclude: ['asyar-sdk'] }
      : { include: ['asyar-sdk'] },

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
