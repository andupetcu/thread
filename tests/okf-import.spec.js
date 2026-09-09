import { test, expect } from "./legacy-fixture.js";
import { zipSync, strToU8 } from "fflate";

const source = (body) => `---\ntype: concept\n---\n${body}`;
const archive = (body) => ({
  name: "bundle.zip",
  mimeType: "application/zip",
  buffer: Buffer.from(
    zipSync({
      "handbook/keep.md": strToU8(source(body)),
      "handbook/update.md": strToU8(source(body)),
      "handbook/copy.md": strToU8(source(body)),
      "handbook/asset.bin": new Uint8Array([0, 255, 17]),
    }),
  ),
});

test("imports a real ZIP and reimports with keep, update, and copy choices", async ({
  page,
  request,
}) => {
  const response = await request.post("/api/okf/bundles", {
    data: { name: "ZIP workflow" },
  });
  expect(response.ok()).toBe(true);
  let { bundle } = await response.json();
  const endpoint = `/api/okf/bundles/${bundle.id}`;
  await page.goto("/");
  await page.getByRole("button", { name: "ZIP workflow", exact: true }).click();
  async function stage(body) {
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await page
      .locator(".okf-dialog input[type=file]:not([webkitdirectory])")
      .setInputFiles(archive(body));
    const dialog = page.getByRole("dialog", { name: "Import bundle files" });
    await expect(
      dialog.getByText("handbook/keep.md", { exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByLabel("Remove enclosing folder"),
    ).not.toBeChecked();
    await dialog.getByLabel("Remove enclosing folder").check();
    await expect(dialog.getByText("keep.md", { exact: true })).toBeVisible();
    await expect(dialog.getByText("asset.bin", { exact: true })).toBeVisible();
    return dialog;
  }
  let dialog = await stage("Original");
  await dialog.getByRole("button", { name: "Import accepted files" }).click();
  await expect(dialog).not.toBeVisible();
  ({ bundle } = await (await request.get(endpoint)).json());
  expect(bundle.entries.some((e) => e.path === "bundle.zip")).toBe(false);
  expect(bundle.entries.find((e) => e.path === "asset.bin").data).toBe("AP8R");
  for (const path of ["keep.md", "update.md", "copy.md"]) {
    const entry = bundle.entries.find((e) => e.path === path);
    const edit = await request.put(`${endpoint}/documents`, {
      data: {
        path,
        body: "Local edit",
        baseRevision: entry.revision,
        expectedRevision: bundle.revision,
      },
    });
    expect(edit.ok()).toBe(true);
    ({ bundle } = await edit.json());
  }
  // Leave the opened bundle revision stale: apply must use the preview revision.
  dialog = await stage("Incoming");
  await dialog.getByLabel("Conflict choice for keep.md").selectOption("keep");
  await dialog
    .getByLabel("Conflict choice for update.md")
    .selectOption("update");
  await dialog.getByLabel("Conflict choice for copy.md").selectOption("copy");
  await dialog.getByRole("button", { name: "Import accepted files" }).click();
  await expect(dialog).not.toBeVisible();
  ({ bundle } = await (await request.get(endpoint)).json());
  expect(bundle.entries.find((e) => e.path === "keep.md").body).toBe(
    "Local edit",
  );
  expect(bundle.entries.find((e) => e.path === "update.md").body).toBe(
    "Incoming",
  );
  expect(bundle.entries.find((e) => e.path === "copy.md").body).toBe(
    "Local edit",
  );
  expect(
    bundle.entries.some(
      (e) =>
        e.path !== "copy.md" &&
        e.path.startsWith("copy") &&
        e.body === "Incoming",
    ),
  ).toBe(true);
});

test("invalidates accepted files while root options change and after a failed preview", async ({
  page,
  request,
}) => {
  const response = await request.post("/api/okf/bundles", {
    data: { name: "Staged preview" },
  });
  const { bundle } = await response.json();
  await page.goto("/");
  await page
    .getByRole("button", { name: "Staged preview", exact: true })
    .click();
  await page.getByRole("button", { name: "Import", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Import bundle files" });
  await dialog
    .locator("input[type=file]:not([webkitdirectory])")
    .setInputFiles(archive("Original"));
  await expect(
    dialog.getByRole("button", { name: "Import accepted files" }),
  ).toBeEnabled();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route(
    `**/api/okf/bundles/${bundle.id}/import/preview`,
    async (route) => {
      await gate;
      await route.fulfill({
        status: 409,
        json: { error: "Preview rejected for this root" },
      });
    },
  );
  try {
    await dialog.getByLabel("Remove enclosing folder").check();
    await expect(
      dialog.getByRole("button", { name: "Import accepted files" }),
    ).toHaveCount(0);
    await expect(dialog.getByLabel("Remove enclosing folder")).toBeDisabled();
    await expect(
      dialog.getByRole("button", { name: "Choose ZIP or files" }),
    ).toBeDisabled();
  } finally {
    release();
  }
  await expect(dialog.getByRole("alert")).toHaveText(
    "Preview rejected for this root",
  );
  await expect(
    dialog.getByRole("button", { name: "Import accepted files" }),
  ).toHaveCount(0);
  await page.unroute(`**/api/okf/bundles/${bundle.id}/import/preview`);
  await dialog.getByRole("button", { name: "Refresh import preview" }).click();
  await expect(dialog.getByText("keep.md", { exact: true })).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Import accepted files" }),
  ).toBeEnabled();
});
