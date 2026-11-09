import { defineConfig } from "vitest/config";

// Own config, so vitest doesn't walk up to the frontend's vitest.config.ts (jsdom + src/test/setup.ts).
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
