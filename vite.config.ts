import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { sync as globSync } from "glob";
import fs from "fs";
import path from "path";

// Function to get all extension dependencies
function getExtensionDependencies() {
  const extensionDeps = new Set<string>();

  try {
    // Find all extension package.json files
    const extensionPackages = globSync("src/extensions/*/package.json", {
      absolute: true,
    });

    for (const packagePath of extensionPackages) {
      try {
        const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf-8"));
        if (packageJson.dependencies) {
          Object.keys(packageJson.dependencies).forEach((dep) =>
            extensionDeps.add(dep)
          );
        }
      } catch (err) {
        console.warn(
          `Failed to parse extension package.json at ${packagePath}:`,
          err
        );
      }
    }
  } catch (err) {
    console.warn("Failed to scan for extension dependencies:", err);
  }

  return Array.from(extensionDeps);
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
    include: getExtensionDependencies(), // Automatically include extension dependencies
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
      "@": path.resolve(__dirname, "./src"),
      "@material-symbols": "material-symbols",
      "@asyar/api": path.resolve(__dirname, "./src/api"),
    },
  },
});
