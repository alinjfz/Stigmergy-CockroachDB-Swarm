import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/integration/**"],
    env: {
      STIGMERGY_STORE: "memory",
      DATABASE_URL: "",
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});
