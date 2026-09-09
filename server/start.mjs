import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "./http.mjs";
process.umask(0o077);
const dir =
  process.env.THREAD_DATA_DIR ||
  path.join(homedir(), "Documents", "Thread Workspace");
const port = Number(process.env.THREAD_PORT || 4317);
const app = createServer({
  dir,
  staticDir: path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../dist",
  ),
});
app.server.listen(port, "127.0.0.1", () =>
  console.log(`Thread workspace: http://127.0.0.1:${port}\nData: ${dir}`),
);
const backup = () => {
  try {
    if (app.store.getMeta("initialized")) app.store.createBackup();
  } catch (e) {
    console.error("Automatic backup failed:", e.message);
  }
};
backup();
const interval = setInterval(backup, 15 * 60 * 1000);
interval.unref();
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    clearInterval(interval);
    app.server.close(() => {
      app.store.close();
      process.exit(0);
    });
  });
