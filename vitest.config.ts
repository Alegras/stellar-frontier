import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/sim/test/**/*.test.ts", "packages/data/test/**/*.test.ts", "packages/battle-grid/test/**/*.test.ts", "apps/web/src/ui/grid-battle/**/*.test.ts"],
    environment: "node",
    reporters: "default",
    testTimeout: 300_000,
    hookTimeout: 300_000,
    // Тяжёлые property-тесты (галактика 100 seed) под coverage-инструментацией
    // блокируют worker > watchdog: один форк + отключённая файловая параллельность.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage",
      include: ["packages/sim/src/**/*.ts", "packages/data/src/**/*.ts"],
      exclude: ["**/*.d.ts", "packages/data/src/validate.ts"],
      // Факт на 2026-11-04: stmts/lines 88.9%, branch 79.0%, funcs 90.3%.
      // Порог ставим ниже факта (защита от регрессий), цель GDD — sim ≥70%.
      thresholds: { lines: 80, functions: 80, branches: 70, statements: 80 },
    },
  },
});