import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { sync as globSync } from "glob";
import fs from "fs";
import path from "path";

// Function to get all plugin dependencies
function getPluginDependencies() {
  const pluginDeps = new Set<string>();

  try {
    // Find all plugin package.json files
    const pluginPackages = globSync("src/plugins/*/package.json", {
      absolute: true,
    });

    for (const packagePath of pluginPackages) {
      try {
        const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf-8"));
        if (packageJson.dependencies) {
          Object.keys(packageJson.dependencies).forEach((dep) =>
            pluginDeps.add(dep)
          );
        }
      } catch (err) {
        console.warn(
          `Failed to parse plugin package.json at ${packagePath}:`,
          err
        );
      }
    }
  } catch (err) {
    console.warn("Failed to scan for plugin dependencies:", err);
  }

  return Array.from(pluginDeps);
}

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        format: "esm",
      },
    },
  },
  optimizeDeps: {
    exclude: ["@tauri-apps/api"],
    include: getPluginDependencies(), // Automatically include plugin dependencies
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  resolve: {
    alias: {
      "@": "/src",
      "@material-symbols": "material-symbols",
      "@asyar/api": "/src/api",
    },
  },
});
