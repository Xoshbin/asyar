import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  type: "module",
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
  },
};

export default config;
