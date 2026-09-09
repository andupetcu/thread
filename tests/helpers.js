import { test as base, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import net from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
export const BASE = "http://127.0.0.1:5184";
export const PASSWORD = "durable-test-password-2026";
export const headers = { "X-Thread-Request": "1" };
async function requireFreePort(port) {
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", () =>
      reject(new Error("Refusing to use occupied test port " + port)),
    );
    probe.listen(port, "127.0.0.1", () => probe.close(resolve));
  });
}
async function waitReady(logs) {
  for (let i = 0; i < 100; i++) {
    try {
      const response = await fetch(BASE + "/api/auth/status");
      if (response.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Isolated dev server did not start: " + logs());
}
export const test = base.extend({
  durable: [
    async ({}, use) => {
      const dir = mkdtempSync(path.join(tmpdir(), "thread-durable-e2e-"));
      let child,
        output = "";
      async function start() {
        await requireFreePort(5184);
        await requireFreePort(4324);
        child = spawn(process.execPath, ["server/dev.mjs"], {
          cwd: process.cwd(),
          detached: true,
          env: {
            ...process.env,
            THREAD_DATA_DIR: dir,
            THREAD_UI_PORT: "5184",
            THREAD_API_PORT: "4324",
          },
          stdio: ["ignore", "pipe", "pipe"],
        });
        child.stdout.on("data", (d) => {
          output += d;
        });
        child.stderr.on("data", (d) => {
          output += d;
        });
        await waitReady(() => output);
      }
      async function stop() {
        if (!child) return;
        const current = child;
        await new Promise((resolve) => {
          const timeout = setTimeout(() => {
            try {
              process.kill(-current.pid, "SIGKILL");
            } catch {}
            resolve();
          }, 3000);
          current.once("exit", () => {
            clearTimeout(timeout);
            resolve();
          });
          try {
            process.kill(-current.pid, "SIGTERM");
          } catch {
            clearTimeout(timeout);
            resolve();
          }
        });
        child = null;
      }
      try {
        await start();
        await use({
          dir,
          restart: async () => {
            await stop();
            await start();
          },
        });
      } finally {
        await stop();
        rmSync(dir, { recursive: true, force: true });
      }
    },
    { scope: "worker", auto: true },
  ],
  appErrors: [
    async ({ page }, use) => {
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await use();
      expect(errors).toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };
export async function login(page) {
  await page.goto(BASE);
  const status = await (
    await page.request.get(BASE + "/api/auth/status")
  ).json();
  if (!status.configured) {
    await page.getByLabel("Workspace password", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Confirm password", { exact: true }).fill(PASSWORD);
    await page
      .getByRole("button", { name: "Create workspace", exact: true })
      .click();
  } else if (!status.authenticated) {
    await page.getByLabel("Workspace password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Unlock", exact: true }).click();
  }
  await expect(
    page.getByRole("button", { name: "Lock", exact: true }),
  ).toBeVisible();
}
export async function workspace(page) {
  return (await page.request.get(BASE + "/api/workspace")).json();
}
export async function savedNote(page, title) {
  let found;
  await expect
    .poll(async () => {
      found = (await workspace(page)).notes.find((n) => n.title === title);
      return !!found;
    })
    .toBe(true);
  return found;
}
