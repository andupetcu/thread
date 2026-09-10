import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  optimizeDeps: { entries: ["index.html", "tests/*-harness.html"] },
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      "drawnix.css": new URL(
        "./node_modules/@drawnix/drawnix/index.css",
        import.meta.url,
      ).pathname,
    },
  },
  plugins: [
    react(),
    {
      name: "local-drawio-policy",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url?.startsWith("/vendor/drawio/")) {
            res.setHeader(
              "Content-Security-Policy",
              "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' data: blob:; frame-src 'none'; object-src 'none'; form-action 'none'; frame-ancestors 'self'",
            );
          }
          next();
        });
      },
    },
  ],
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
