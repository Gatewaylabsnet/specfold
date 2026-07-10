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
    plugins: [externalizeDepsPlugin()]
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

