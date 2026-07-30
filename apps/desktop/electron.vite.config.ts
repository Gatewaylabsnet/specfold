import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

const coreEntry = resolve(__dirname, "../../packages/core/src/index.ts");

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ["@openapi-collection-studio/core"] })],
    resolve: {
      alias: {
        "@openapi-collection-studio/core": coreEntry
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs",
          chunkFileNames: "chunks/[name]-[hash].cjs"
        }
      }
    }
  },
  renderer: {
    plugins: [react()],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("node_modules/react") || id.includes("node_modules/scheduler")) {
              return "react-vendor";
            }
            if (id.includes("node_modules/lucide-react")) return "icons";
            if (id.includes("packages/core/src")) return "specfold-core";
            return undefined;
          }
        }
      }
    },
    resolve: {
      alias: {
        "@openapi-collection-studio/core": coreEntry,
        "@renderer": resolve(__dirname, "src/renderer")
      }
    }
  }
});
