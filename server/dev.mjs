import { spawn } from "node:child_process";
const children = [
  spawn(process.execPath, ["server/start.mjs"], {
    stdio: "inherit",
    env: { ...process.env, THREAD_PORT: process.env.THREAD_API_PORT || "4317" },
  }),
  spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "--host",
      "127.0.0.1",
      "--port",
      process.env.THREAD_UI_PORT || "5173",
      "--strictPort",
    ],
    { stdio: "inherit", env: process.env },
  ),
];
let closing = false;
function stop(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 500).unref();
}
for (const child of children) child.on("exit", (code) => stop(code || 0));
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
