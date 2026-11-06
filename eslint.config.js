// ESLint 10 flat config: TypeScript/TSX (src, packages, apps, e2e) + node-скрипты tools/.
// Базовый набор: eslint recommended + typescript-eslint recommended; правила, дающие шум
// в игровом/тестовом коде (any, unused в прототипах и т.п.), понижены до warn — линт-гейт CI
// падает только на ошибках (eslint . без --max-warnings).
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

const sharedGlobals = {
  process: "readonly", Buffer: "readonly", console: "readonly", WebSocket: "readonly",
  fetch: "readonly", URL: "readonly", URLSearchParams: "readonly", performance: "readonly",
  setTimeout: "readonly", clearTimeout: "readonly", setInterval: "readonly", clearInterval: "readonly",
  setImmediate: "readonly", structuredClone: "readonly", crypto: "readonly", atob: "readonly", btoa: "readonly",
  window: "readonly", document: "readonly", localStorage: "readonly", navigator: "readonly",
  requestAnimationFrame: "readonly", cancelAnimationFrame: "readonly", ResizeObserver: "readonly",
  KeyboardEvent: "readonly", MouseEvent: "readonly", Event: "readonly", HTMLElement: "readonly",
  HTMLCanvasElement: "readonly", HTMLInputElement: "readonly", Node: "readonly", Text: "readonly",
  getComputedStyle: "readonly", matchMedia: "readonly",
};

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**", "**/dist/**", ".data/**", "test-results/**", "playwright-report/**",
      "**/*.d.ts", "docs/**", "pnpm-lock.yaml",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,mjs,js}"],
    languageOptions: { globals: sharedGlobals },
    rules: {
      // Базовый TS-проект: шумные правила — warn (не блокируют CI), реальные ошибки — error.
      "no-undef": "off", // TS-компилятор отвечает за имена
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-empty-object-type": "warn",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-this-alias": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-expressions": "warn",
      "no-useless-assignment": "off", // прототипный код часто переприсваивает «для читаемости»
      "preserve-caught-error": "warn",
      "no-unused-labels": "warn",
      "@typescript-eslint/ban-ts-comment": "warn",
      "no-empty": "warn",
      "no-constant-condition": "warn",
      "no-console": "off",
      "no-debugger": "error",
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-alert": "warn",
      "no-var": "warn",
      "prefer-const": "warn",
      "eqeqeq": ["warn", "smart"],
      "no-fallthrough": "warn",
      "no-useless-escape": "warn",
      "no-prototype-builtins": "off",
    },
  },
  {
    files: ["**/*.tsx", "**/*.jsx"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    files: ["**/*.test.ts", "**/*.spec.ts", "packages/sim/test/**", "apps/web/e2e/**"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
);