import { importDrawio } from "./native-diagram-helpers.js";
import {
  test,
  expect,
  BASE,
  PASSWORD,
  headers,
  login,
  workspace,
  savedNote,
} from "./helpers.js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { unzipSync, strFromU8 } from "fflate";

test("password setup, lock and login protect notes and attachments", async ({
  page,
  browser,
}) => {
  await page.goto(BASE);
  await expect(
    page.getByRole("heading", { name: "Create your administrator account" }),
  ).toBeVisible();
  expect((await page.request.get(BASE + "/api/workspace")).status()).toBe(401);
  await page.getByLabel("Workspace password", { exact: true }).fill(PASSWORD);
  await page
    .getByLabel("Confirm password", { exact: true })
    .fill("different-password");
  await page
    .getByRole("button", { name: "Create workspace", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Passwords do not match");
  await page.getByLabel("Confirm password", { exact: true }).fill(PASSWORD);
  await page
    .getByRole("button", { name: "Create workspace", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Lock", exact: true }),
  ).toBeVisible();
  const upload = await page.request.post(BASE + "/api/assets", {
    headers: {
      ...headers,
      "Content-Type": "text/plain",
      "X-Filename": "secret.txt",
    },
    data: Buffer.from("private attachment"),
  });
  expect(upload.status()).toBe(201);
  const asset = await upload.json();
  const stranger = await browser.newContext();
  expect((await stranger.request.get(BASE + asset.url)).status()).toBe(401);
  await stranger.close();
  await page.getByRole("button", { name: "Lock", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Unlock your workspace" }),
  ).toBeVisible();
  expect((await page.request.get(BASE + "/api/workspace")).status()).toBe(401);
  await page
    .getByLabel("Workspace password", { exact: true })
    .fill("wrong-password");
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Incorrect username or password",
  );
  await page.getByLabel("Workspace password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Lock", exact: true }),
  ).toBeVisible();
});

test("created and edited notes survive reload and a complete server restart", async ({
  page,
  durable,
}) => {
  await login(page);
  await page
    .getByRole("button", { name: "New note", exact: true })
    .first()
    .click();
  await page
    .getByRole("textbox", { name: "Note title", exact: true })
    .fill("Durable restart note");
  if (
    !(await page
      .getByRole("textbox", { name: "Markdown source", exact: true })
      .isVisible())
  ) {
    await page
      .getByRole("button", { name: "Edit Markdown", exact: true })
      .click();
  }
  await page
    .getByRole("textbox", { name: "Markdown source", exact: true })
    .fill("## Persisted content\n\nThis survives process restart. #durable");
  const note = await savedNote(page, "Durable restart note");
  await expect
    .poll(
      async () =>
        (await workspace(page)).notes.find((n) => n.id === note.id)?.body,
    )
    .toContain("This survives process restart.");
  expect(
    readFileSync(path.join(durable.dir, "notes", note.id + ".md"), "utf8"),
  ).toContain("This survives process restart.");
  await expect
    .poll(async () => (await workspace(page)).settings.layout?.panels)
    .toContain(note.id);
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Note title", exact: true }),
  ).toHaveValue("Durable restart note");
  await durable.restart();
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Note title", exact: true }),
  ).toHaveValue("Durable restart note");
  if (
    !(await page
      .getByRole("textbox", { name: "Markdown source", exact: true })
      .isVisible())
  ) {
    await page
      .getByRole("button", { name: "Edit Markdown", exact: true })
      .click();
  }
  await expect(
    page.getByRole("textbox", { name: "Markdown source", exact: true }),
  ).toHaveValue(/This survives process restart/);
});

test("second session revision conflicts preserve local draft and allow copying", async ({
  page,
  browser,
}) => {
  await login(page);
  await page
    .getByRole("button", { name: "New note", exact: true })
    .first()
    .click();
  await page
    .getByRole("textbox", { name: "Note title", exact: true })
    .fill("Conflict baseline");
  const note = await savedNote(page, "Conflict baseline");
  const second = await browser.newContext();
  const auth = await second.request.post(BASE + "/api/auth/login", {
    headers,
    data: { password: PASSWORD },
  });
  expect(auth.ok()).toBe(true);
  await page.route("**/api/workspace?since=*", (route) =>
    route.fulfill({ json: { unchanged: true, revision: 0 } }),
  );
  const update = await second.request.put(BASE + "/api/notes/" + note.id, {
    headers,
    data: {
      note: { ...note, title: "Other session version", body: "Remote content" },
      baseRevision: note.revision,
    },
  });
  expect(update.ok()).toBe(true);
  await page
    .getByRole("textbox", { name: "Note title", exact: true })
    .fill("My local draft");
  await expect(page.locator(".conflict-review")).toContainText(
    "Another session changed these notes",
  );
  expect(
    (await workspace(page)).notes.find((n) => n.id === note.id).title,
  ).toBe("Other session version");
  await page
    .getByRole("button", { name: "Keep local as a copy", exact: true })
    .click();
  await savedNote(page, "My local draft (local copy)");
  expect(
    (await workspace(page)).notes.find((n) => n.id === note.id).title,
  ).toBe("Other session version");
  await expect(page.locator(".conflict-review")).toHaveCount(0);
  await second.close();
});

test("history, persistent trash and ZIP restoration recover content and attachments", async ({
  page,
}, testInfo) => {
  await login(page);
  await page
    .getByRole("button", { name: "New note", exact: true })
    .first()
    .click();
  await page
    .getByRole("textbox", { name: "Note title", exact: true })
    .fill("Recovery original");
  const original = await savedNote(page, "Recovery original");
  await page
    .getByRole("textbox", { name: "Note title", exact: true })
    .fill("Recovery edited");
  await savedNote(page, "Recovery edited");
  await page
    .getByRole("button", { name: "Workspace settings", exact: true })
    .click();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page
    .getByRole("button", { name: "Restore version", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Confirm restore", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Restore complete");
  await page
    .getByRole("button", { name: "Close workspace settings", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Note title", exact: true }),
  ).toHaveValue("Recovery original");
  await page.getByRole("button", { name: "Delete note", exact: true }).click();
  await expect
    .poll(async () =>
      (await workspace(page)).trash.some((n) => n.id === original.id),
    )
    .toBe(true);
  await page.reload();
  await page
    .getByRole("button", { name: "Workspace settings", exact: true })
    .click();
  await page.getByRole("button", { name: "Trash", exact: true }).click();
  await page
    .locator(".settings-row")
    .filter({ hasText: "Recovery original" })
    .getByRole("button", { name: "Restore note", exact: true })
    .click();
  await savedNote(page, "Recovery original");
  await expect(
    page.getByText("Trash is empty.", { exact: true }),
  ).toBeVisible();
  const upload = await page.request.post(BASE + "/api/assets", {
    headers: {
      ...headers,
      "Content-Type": "text/plain",
      "X-Filename": "recovery.txt",
    },
    data: Buffer.from("attachment survives restore"),
  });
  const asset = await upload.json();
  await page.getByRole("button", { name: "Backups", exact: true }).click();
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download workspace ZIP", exact: true })
    .click();
  const download = await pending;
  const zipPath = testInfo.outputPath("workspace.zip");
  await download.saveAs(zipPath);
  const zip = readFileSync(zipPath);
  const files = unzipSync(zip);
  expect(strFromU8(files["assets/" + asset.id])).toBe(
    "attachment survives restore",
  );
  const current = (await workspace(page)).notes.find(
    (n) => n.id === original.id,
  );
  expect(
    (
      await page.request.put(BASE + "/api/notes/" + original.id, {
        headers,
        data: {
          note: { ...current, title: "After backup" },
          baseRevision: current.revision,
        },
      })
    ).ok(),
  ).toBe(true);
  await page.getByLabel("Restore ZIP", { exact: true }).setInputFiles({
    name: "workspace.zip",
    mimeType: "application/zip",
    buffer: zip,
  });
  await page
    .getByRole("button", { name: "Confirm restore", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Restore complete");
  await savedNote(page, "Recovery original");
  expect(await (await page.request.get(BASE + asset.url)).text()).toBe(
    "attachment survives restore",
  );
});

async function createPage(page, title, body = "") {
  await page.getByRole("button", { name: "1 panels", exact: true }).click();
  await page
    .getByRole("button", { name: "New note", exact: true })
    .first()
    .click();
  await page
    .getByRole("textbox", { name: "Note title", exact: true })
    .fill(title);
  if (body) {
    const source = page.getByRole("textbox", {
      name: "Markdown source",
      exact: true,
    });
    if (!(await source.isVisible()))
      await page
        .getByRole("button", { name: "Edit Markdown", exact: true })
        .click();
    await source.fill(body);
  }
  return savedNote(page, title);
}

test("integrated diagram saves as a visual note block and reopens on mobile", async ({
  page,
}, testInfo) => {
  await login(page);
  const note = await createPage(page, "Integrated diagram");
  await page
    .getByRole("button", { name: "Insert visual diagram", exact: true })
    .click();
  await page.getByRole("button", { name: "Edit diagram", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Edit diagram", exact: true }),
  ).toBeVisible();
  await importDrawio(page, "Decision archive");
  await page.getByRole("button", { name: "Save diagram", exact: true }).click();
  await expect(page.locator(".diagram-preview:visible")).toBeVisible();
  await expect
    .poll(
      async () =>
        (await workspace(page)).notes.find((n) => n.id === note.id)?.body,
    )
    .toContain("Decision archive");
  await expect
    .poll(async () => (await workspace(page)).settings.layout?.panels)
    .toContain(note.id);
  await page.reload();
  await expect(page.locator(".diagram-preview:visible")).toBeVisible();
  await page.getByRole("button", { name: "Edit diagram", exact: true }).click();
  await importDrawio(page, "Uncommitted mobile edit");
  const disk = (await workspace(page)).notes.find((n) => n.id === note.id);
  const fence = disk.body.match(/```thread-diagram\n([\s\S]*?)\n```/);
  const remoteDiagram = JSON.parse(fence[1]);
  remoteDiagram.xml = remoteDiagram.xml.replace(
    "Decision archive",
    "Remote diagram change",
  );
  const remoteSave = await page.request.put(BASE + "/api/notes/" + note.id, {
    headers,
    data: {
      note: {
        ...disk,
        body: disk.body.replace(fence[1], JSON.stringify(remoteDiagram)),
      },
      baseRevision: disk.revision,
    },
  });
  expect(remoteSave.ok()).toBe(true);
  await expect(
    page.getByRole("alertdialog", { name: "Diagram conflict" }),
  ).toBeVisible({ timeout: 10000 });
  await page.screenshot({ path: testInfo.outputPath("diagram-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "Save diagram", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("diagram-mobile.png") });
  await expect(
    page.getByRole("button", { name: "Save diagram", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Keep my draft", exact: true })
    .click();
  await page.getByRole("button", { name: "Save diagram", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await workspace(page)).notes.find((n) => n.id === note.id)?.body,
    )
    .toContain("Uncommitted mobile edit");
});

test("notebook moves, nested pages, open tabs and resized panes persist", async ({
  page,
}, testInfo) => {
  await login(page);
  await page.getByRole("button", { name: "New notebook", exact: true }).click();
  await page
    .getByLabel("Notebook name", { exact: true })
    .fill("Integration notebook");
  await page
    .locator("form.notebook-tools")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  const parent = await createPage(page, "Notebook parent", "Parent content");
  const child = await createPage(page, "Notebook child", "Child content");
  await page.getByLabel("Parent page", { exact: true }).selectOption(parent.id);
  await expect
    .poll(
      async () =>
        (await workspace(page)).notes.find((n) => n.id === child.id)?.parentId,
    )
    .toBe(parent.id);
  await page.getByLabel("Move to notebook", { exact: true }).selectOption("");
  await expect
    .poll(
      async () =>
        (await workspace(page)).notes.find((n) => n.id === child.id)?.parentId,
    )
    .toBe(null);
  const notebook = (await workspace(page)).notebooks.find(
    (n) => n.name === "Integration notebook",
  );
  await page
    .getByLabel("Move to notebook", { exact: true })
    .selectOption(notebook.id);
  await page.getByLabel("Parent page", { exact: true }).selectOption(parent.id);
  await expect(
    page.getByRole("tab", { name: "Notebook parent", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Notebook child", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "2 panels", exact: true }).click();
  await page.getByLabel("Note in panel 1").selectOption(parent.id);
  await page.getByLabel("Note in panel 2").selectOption(child.id);
  const resize = page.getByRole("separator", {
    name: "Resize panels 1 and 2",
    exact: true,
  });
  const box = await resize.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 90, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await resize.focus();
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(async () => (await workspace(page)).settings.layout?.widths?.[0])
    .toBeGreaterThan(1.1);
  const layout = (await workspace(page)).settings.layout;
  await page.reload();
  await expect(page.locator(".note-pane")).toHaveCount(2);
  await expect(page.getByLabel("Note in panel 1")).toHaveValue(parent.id);
  await expect(page.getByLabel("Note in panel 2")).toHaveValue(child.id);
  await expect(
    page.getByRole("separator", { name: "Resize panels 1 and 2", exact: true }),
  ).toHaveAttribute(
    "aria-valuenow",
    String(Math.round(layout.widths[0] * 100)),
  );
  await expect(
    page.getByLabel("Parent page", { exact: true }).nth(1),
  ).toHaveValue(parent.id);
  await expect(
    page.getByLabel("Move to notebook", { exact: true }).nth(1),
  ).toHaveValue(notebook.id);
  await expect(
    page.getByRole("tab", { name: "Notebook parent", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Notebook child", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Toggle sidebar", exact: true })
    .click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("nested-pages-mobile.png"),
  });
});

test("copied block references and embeds navigate and update live", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: BASE,
  });
  await login(page);
  const source = await createPage(
    page,
    "Live block source",
    "## Source heading\n\nLive paragraph original.",
  );
  await page.getByRole("button", { name: "Edit blocks", exact: true }).click();
  await page
    .getByRole("button", { name: "Block 2 actions", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Copy block reference", exact: true })
    .click();
  const reference = await page.evaluate(() => navigator.clipboard.readText());
  expect(reference).toContain("](block:");
  await page
    .getByRole("button", { name: "Block 2 actions", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Copy block embed", exact: true })
    .click();
  const embed = await page.evaluate(() => navigator.clipboard.readText());
  expect(embed).toMatch(/^!\[\[/);
  const blockId = embed.match(/#([^\]]+)/)[1];
  const target = await createPage(
    page,
    "Live block consumer",
    reference + "\n\n" + embed,
  );
  await page.getByRole("button", { name: "Preview note", exact: true }).click();
  await expect(page.locator(".block-embed:visible")).toContainText(
    "Live paragraph original.",
  );
  await page.locator(".block-reference:visible .mention").hover();
  await expect(page.getByRole("tooltip")).toContainText(
    "Live paragraph original.",
  );
  const saved = (await workspace(page)).notes.find((n) => n.id === source.id);
  const changed = await page.request.put(BASE + "/api/notes/" + source.id, {
    headers,
    data: {
      note: {
        ...saved,
        body: saved.body.replace(
          "Live paragraph original.",
          "Live paragraph updated.",
        ),
      },
      baseRevision: saved.revision,
    },
  });
  expect(changed.ok()).toBe(true);
  await expect(page.locator(".block-embed:visible")).toContainText(
    "Live paragraph updated.",
    { timeout: 10000 },
  );
  await page.locator(".block-embed-origin:visible").click();
  await expect(
    page.getByRole("textbox", { name: "Note title", exact: true }),
  ).toHaveValue("Live block source");
  await expect(
    page.locator(`[data-block-id="${blockId}"]:visible`),
  ).toBeFocused();
  await page
    .getByRole("tab", { name: "Live block consumer", exact: true })
    .click();
  await expect(page.locator(".block-embed:visible")).toContainText(
    "Live paragraph updated.",
  );
  await page.locator(".block-reference:visible .mention").click();
  await expect(
    page.locator(`[data-block-id="${blockId}"]:visible`),
  ).toBeFocused();
  expect(
    (await workspace(page)).notes.find((n) => n.id === target.id).body,
  ).toContain(embed);
});

test("restoring a different same-size workspace applies its note tabs and pane layout", async ({
  page,
}) => {
  await login(page);
  const created = new Date().toISOString();
  const first = {
    id: "restore-layout-a",
    title: "Restored workspace page",
    body: "Restored body",
    created,
    updated: created,
  };
  expect(
    (
      await page.request.post(BASE + "/api/import", {
        headers,
        data: { notes: [first], mode: "replace" },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await page.request.put(BASE + "/api/settings", {
        headers,
        data: {
          layout: {
            panels: [first.id],
            tabs: [first.id],
            widths: [0.7, 1.3, 1],
            view: "notes",
          },
        },
      })
    ).ok(),
  ).toBe(true);
  const zip = await (await page.request.get(BASE + "/api/backup")).body();
  const second = {
    ...first,
    id: "restore-layout-b",
    title: "Replaced workspace page",
  };
  await page.request.post(BASE + "/api/import", {
    headers,
    data: { notes: [second], mode: "replace" },
  });
  await page.request.put(BASE + "/api/settings", {
    headers,
    data: {
      layout: {
        panels: [second.id],
        tabs: [second.id],
        widths: [1, 1, 1],
        view: "notes",
      },
    },
  });
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Note title", exact: true }),
  ).toHaveValue(second.title);
  await page
    .getByRole("button", { name: "Workspace settings", exact: true })
    .click();
  await page.locator(".workspace-settings input[type=file]").setInputFiles({
    name: "restore.zip",
    mimeType: "application/zip",
    buffer: zip,
  });
  await page
    .getByRole("button", { name: "Confirm restore", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Restore complete");
  await page
    .getByRole("button", { name: "Close workspace settings", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Note title", exact: true }),
  ).toHaveValue(first.title);
  await expect(
    page.getByRole("tab", { name: first.title, exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => page.locator(".note-pane").evaluate((el) => el.style.flexGrow))
    .toBe("0.7");
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Note title", exact: true }),
  ).toHaveValue(first.title);
});
