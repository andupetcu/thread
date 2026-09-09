import { test, expect, savedNote } from "./legacy-fixture.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { unzipSync } from "fflate";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1sAAAAASUVORK5CYII=",
  "base64",
);
const doc = Buffer.from("Local document attachment bytes");
async function upload(page, files) {
  await expect(
    page.getByRole("button", { name: "Attach files", exact: true }),
  ).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Attach files", exact: true }).click();
  await (await chooser).setFiles(files);
}

test("uploads images and documents from preview to disk, retaining links after reload and in backup", async ({
  page,
  request,
  legacyServer,
}) => {
  await page.goto("/");
  await upload(page, [
    { name: "local image.png", mimeType: "image/png", buffer: png },
    {
      name: "project brief.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: doc,
    },
  ]);
  const image = page
    .locator("#render-welcome")
    .getByRole("img", { name: "local image.png", exact: true });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((el) => el.naturalWidth)).toBe(1);
  const link = page
    .locator("#render-welcome")
    .getByRole("link", { name: "project brief.docx", exact: true });
  await expect(link).toBeVisible();
  const url = await link.getAttribute("href");
  expect(url).toMatch(/^\/api\/assets\//);
  await expect
    .poll(async () => (await savedNote(request, "welcome")).body)
    .toContain(url);
  expect(
    await readFile(
      path.join(legacyServer.dir, "assets", url.split("/").at(-1)),
    ),
  ).toEqual(doc);
  const response = await request.get(url);
  expect(response.headers()["content-disposition"]).toContain("attachment;");
  expect(await response.body()).toEqual(doc);
  const backup = unzipSync(await (await request.get("/api/backup")).body());
  expect(Buffer.from(backup["assets/" + url.split("/").at(-1)])).toEqual(doc);
  await page.reload();
  await expect(link).toBeVisible();
  await expect(image).toBeVisible();
  await page.screenshot({
    path: "/tmp/thread-note-attachments.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "Attach files", exact: true }),
  ).toBeInViewport();
  await page.screenshot({
    path: "/tmp/thread-note-attachments-mobile.png",
    fullPage: true,
  });
});

test("rejects invalid sizes before upload and retains successful files if a later file fails", async ({
  page,
  request,
}) => {
  await page.goto("/");
  let uploads = 0;
  await page.route("**/api/assets", async (route) => {
    uploads++;
    if (uploads === 2)
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Disk unavailable" }),
      });
    await route.continue();
  });
  await upload(page, [
    { name: "empty.txt", mimeType: "text/plain", buffer: Buffer.alloc(0) },
  ]);
  await expect(page.getByRole("alert")).toContainText(
    "between 1 byte and 20 MB",
  );
  await upload(page, [
    {
      name: "too-large.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.alloc(20_000_001),
    },
  ]);
  await expect(page.getByRole("alert")).toContainText("too-large.pdf");
  expect(uploads).toBe(0);
  await upload(page, [
    { name: "first.pdf", mimeType: "application/pdf", buffer: doc },
    { name: "failed.pdf", mimeType: "application/pdf", buffer: doc },
    { name: "later.pdf", mimeType: "application/pdf", buffer: doc },
  ]);
  await expect(page.getByRole("alert")).toContainText("1 file(s) added");
  await expect
    .poll(async () => (await savedNote(request, "welcome")).body)
    .toContain("first.pdf");
  expect((await savedNote(request, "welcome")).body).not.toContain(
    "failed.pdf",
  );
  expect(uploads).toBe(2);
});

test("keeps typing and the original note when upload finishes after switching notes", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Edit Markdown", exact: true })
    .click();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/api/assets", async (route) => {
    await gate;
    await route.continue();
  });
  try {
    await upload(page, [
      { name: "delayed.pdf", mimeType: "application/pdf", buffer: doc },
    ]);
    await page
      .getByRole("textbox", { name: "Markdown source", exact: true })
      .fill("Text typed while uploading.");
    await page.getByLabel("Note in panel 1").selectOption("roadmap");
  } finally {
    release();
  }
  await expect
    .poll(async () => (await savedNote(request, "welcome")).body)
    .toContain("delayed.pdf");
  expect((await savedNote(request, "welcome")).body).toContain(
    "Text typed while uploading.",
  );
  expect((await savedNote(request, "roadmap")).body).not.toContain(
    "delayed.pdf",
  );
});

test("reports a failed upload and allows selecting the same document again in block mode", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Edit blocks", exact: true }).click();
  await page.route("**/api/assets", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "Disk unavailable" }),
    }),
  );
  const file = { name: "retry.pdf", mimeType: "application/pdf", buffer: doc };
  await upload(page, [file]);
  await expect(page.getByRole("alert")).toContainText("Disk unavailable");
  await page.unroute("**/api/assets");
  await upload(page, [file]);
  await expect(
    page
      .locator(".block-editor")
      .getByRole("link", { name: "retry.pdf", exact: true }),
  ).toBeVisible();
});
