import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(
    mode,
    fileURLToPath(new URL("../../", import.meta.url)),
    "API_BASE_URL",
  );
  const proxy = {
    "/api": {
      target:
        process.env.API_BASE_URL ?? env.API_BASE_URL ?? "http://127.0.0.1:8000",
      rewrite: (path: string): string => path.replace(/^\/api/, ""),
    },
  };

  return {
    plugins: [react()],
    cacheDir: "../../.cache/vite-web",
    server: { port: 5173, strictPort: true, proxy },
    preview: { port: 5173, strictPort: true, proxy },
  };
});
