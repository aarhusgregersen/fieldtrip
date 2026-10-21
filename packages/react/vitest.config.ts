import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { conditions: ["@fieldtrip/source"] },
  test: { environment: "jsdom" },
});
