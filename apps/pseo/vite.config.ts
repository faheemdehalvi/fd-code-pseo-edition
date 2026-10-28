import { defineConfig } from "vite-plus";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  build: { target: "es2022" },
});
