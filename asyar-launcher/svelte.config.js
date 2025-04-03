// Tauri doesn't have a Node.js server to do proper SSR
// so we will use adapter-static to prerender the app (SSG)
// See: https://v2.tauri.app/start/frontend/sveltekit/ for more info
import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    alias: {
      // this will match a file
      // "my-file": "path/to/my-file.js",

      // this will match a directory and its contents
      // (`my-directory/x` resolves to `path/to/my-directory/x`)
      "src": "./src",

      // an alias ending /* will only match
      // the contents of a directory, not the directory itself
      // "my-directory/*": "path/to/my-directory/*",
    },
  },
};

export default config;
