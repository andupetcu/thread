import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:" + (process.env.THREAD_API_PORT || "4317"),
        changeOrigin: false,
      },
    },
  },
  test: { include: ["tests/**/*.test.js"] },
});
