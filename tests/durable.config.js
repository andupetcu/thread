import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "durable.spec.js",
  workers: 1,
  fullyParallel: false,
  timeout: 45000,
  outputDir: "/tmp/thread-durable-artifacts",
  use: {
    channel: "chrome",
    headless: true,
    baseURL: "http://127.0.0.1:5184",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
});
