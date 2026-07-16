import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@openapi-collection-studio/core": resolve(__dirname, "../../packages/core/src/index.ts")
    }
  }
});
