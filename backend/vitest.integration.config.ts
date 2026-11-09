import { defineConfig } from "vitest/config";

// DB integration tests (Gate 3b). They need the running Docker MySQL and the repo-root .env.
// Run: npm run test:db. Kept out of `npm test`, which stays DB-free.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/integration/**/*.itest.ts"],
    setupFiles: ["src/integration/setup.ts"],
    fileParallelism: false,
    pool: "threads", // forked workers died at random on Windows + Node 24 ("Worker exited unexpectedly", ~5% of runs)
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
