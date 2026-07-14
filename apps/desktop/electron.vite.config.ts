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
    resolve: {
      alias: {
        "@openapi-collection-studio/core": coreEntry,
        "@renderer": resolve(__dirname, "src/renderer")
      }
    }
  }
});
