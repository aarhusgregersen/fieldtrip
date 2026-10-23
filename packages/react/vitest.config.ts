import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { conditions: ["@fieldtripjs/source"] },
  test: { environment: "jsdom" },
});
