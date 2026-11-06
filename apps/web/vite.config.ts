import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@sf/sim": r("../../packages/sim/src/index.ts"),
      "@sf/data": r("../../packages/data/src/index.ts"),
    },
    dedupe: ["three", "react", "react-dom"],
  },
  server: { port: 5173, strictPort: false, host: "127.0.0.1" },
  build: { target: "es2022", chunkSizeWarningLimit: 2000, sourcemap: false },
});
