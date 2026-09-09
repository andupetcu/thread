import {
  test as base,
  expect,
  request as playwrightRequest,
} from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "../server/http.mjs";
import { initialNotes } from "../src/model.js";

export { expect };
export const test = base.extend({
  legacyServer: [
    async ({}, use, workerInfo) => {
      const dir = await mkdtemp(path.join(os.tmpdir(), "thread-legacy-e2e-"));
      const uiPort = 5185 + workerInfo.workerIndex,
        apiPort = 4325 + workerInfo.workerIndex;
      const app = createServer({ dir });
      await new Promise((resolve) =>
        app.server.listen(apiPort, "127.0.0.1", resolve),
      );
      const child = spawn(
        process.execPath,
        [
          "node_modules/vite/bin/vite.js",
          "--host",
          "127.0.0.1",
          "--port",
          String(uiPort),
          "--strictPort",
        ],
        {
          env: {
            ...process.env,
            THREAD_API_PORT: String(apiPort),
            THREAD_DATA_DIR: dir,
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let log = "";
      child.stdout.on("data", (chunk) => (log += chunk));
      child.stderr.on("data", (chunk) => (log += chunk));
      const url = `http://127.0.0.1:${uiPort}`;
      const client = await playwrightRequest.newContext({
        baseURL: url,
        extraHTTPHeaders: { "x-thread-request": "1" },
      });
      try {
        await expect
          .poll(
            async () => {
              if (child.exitCode != null) throw new Error(log);
              try {
                return (await client.get("/api/auth/status")).status();
              } catch {
                return 0;
              }
            },
            { timeout: 20000 },
          )
          .toBe(200);
        const setup = await client.post("/api/auth/setup", {
          data: { password: "legacy-tests-only-password" },
        });
        expect(setup.ok()).toBe(true);
        await use({ url, storageState: await client.storageState(), dir });
      } finally {
        await client.dispose();
        child.kill("SIGTERM");
        await new Promise((resolve) => {
          if (child.exitCode != null) resolve();
          else {
            child.once("exit", resolve);
            setTimeout(() => {
              child.kill("SIGKILL");
              resolve();
            }, 3000).unref();
          }
        });
        await new Promise((resolve) => app.server.close(resolve));
        app.store.close();
        await rm(dir, { recursive: true, force: true });
      }
    },
    { scope: "worker" },
  ],
  baseURL: async ({ legacyServer }, use) => use(legacyServer.url),
  storageState: async ({ legacyServer }, use) => use(legacyServer.storageState),
  extraHTTPHeaders: async ({}, use) => use({ "x-thread-request": "1" }),
  resetWorkspace: [
    async ({ request }, use) => {
      const reset = await request.post("/api/import", {
        data: { notes: initialNotes(), mode: "replace" },
      });
      expect(reset.ok()).toBe(true);
      const settings = await request.put("/api/settings", {
        data: {
          layout: {
            panels: ["welcome"],
            tabs: ["welcome"],
            widths: [1, 1, 1],
            view: "notes",
          },
          graphPositions: {},
          graphFocus: "",
          graphTags: false,
          graphDepth: 1,
          tableViews: [],
          tableActiveView: "",
          tableCustomFields: [],
        },
      });
      expect(settings.ok()).toBe(true);
      await use();
    },
    { auto: true },
  ],
});

export async function savedNote(request, id) {
  const response = await request.get("/api/workspace");
  expect(response.ok()).toBe(true);
  return (await response.json()).notes.find((note) => note.id === id);
}

export async function waitForSaved(page) {
  await expect(page.locator(".saved")).toContainText("Saved to disk", {
    timeout: 10000,
  });
}

export async function blockSource(page) {
  await page.getByRole("button", { name: "Source", exact: true }).click();
  return page.getByRole("textbox", { name: "Block Markdown", exact: true });
}
