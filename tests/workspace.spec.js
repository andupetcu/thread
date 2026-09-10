import {
  test,
  expect,
  savedNote,
  waitForSaved,
  blockSource,
} from "./legacy-fixture.js";
test("edit, autocomplete, persist, compare and explore", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "A little space for big ideas" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit Markdown" }).click();
  const editor = page.getByRole("textbox", { name: "Markdown source" });
  await editor.fill("Hello #testing");
  await waitForSaved(page);
  await page.reload();
  await page.getByRole("button", { name: "Edit Markdown" }).click();
  await expect(editor).toHaveValue("Hello #testing");
  await editor.fill("/");
  await expect(page.getByRole("button", { name: "PRD Product" })).toBeVisible();
  await page.getByRole("button", { name: "PRD Product" }).click();
  await expect(editor).toHaveValue(/## Problem/);
  await page.getByRole("button", { name: "2 panels" }).click();
  await expect(page.locator(".note-pane")).toHaveCount(2);
  await page.getByRole("button", { name: "Compare notes" }).click();
  await expect(page.locator(".wt-diff-title").first()).toContainText(
    "Baseline",
  );
  await page.getByRole("button", { name: "Graph view" }).click();
  await expect(page.getByLabel("Graph summary")).toContainText("7 notes");
  await page.getByRole("button", { name: "Table view" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(7);
});

test("mentions survive renaming, tags complete, three panels show diff", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Edit Markdown" }).click();
  const editor = page.getByRole("textbox", { name: "Markdown source" });
  await editor.fill("@Auth");
  await page.getByRole("button", { name: "Authentication API Note" }).click();
  await expect(editor).toHaveValue(/note:api/);
  await editor.fill((await editor.inputValue()) + "#eng");
  await page.getByRole("button", { name: "engineering Tag" }).click();
  await expect(editor).toHaveValue(/#engineering/);
  await page.getByRole("button", { name: "3 panels" }).click();
  await expect(page.locator(".note-pane")).toHaveCount(3);
  await page.getByLabel("Note in panel 3", { exact: true }).selectOption("api");
  await page
    .getByRole("textbox", { name: "Note title" })
    .nth(2)
    .fill("Renamed API");
  await page.getByRole("button", { name: "Preview note" }).first().click();
  await expect(page.locator(".prose .mention").first()).toHaveText(
    /Renamed API/,
  );
  await page.getByRole("button", { name: "Compare notes" }).click();
  await expect(page.locator(".wt-diff-column")).toHaveCount(3);
  await expect(page.locator(".wt-diff-row.added").first()).toBeVisible();
});

test("search, time filters, focus, themes and delete undo", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Table view" }).click();
  await page.getByPlaceholder("Search anything…").fill("TokenResponse");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByRole("button", { name: "Search filters" }).click();
  await page.getByLabel("From date and hour").fill("2099-01-01T12:30");
  await expect(page.locator("tbody tr")).toHaveCount(0);
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByLabel("Color theme").selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByLabel("Color theme").selectOption("system");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "All notes", exact: true }).click();
  await page.getByRole("button", { name: "Focus mode" }).click();
  await expect(page.locator(".sidebar")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.locator(".sidebar")).toBeVisible();
  await page.getByRole("button", { name: "Delete note" }).click();
  await expect(page.getByText("Deleted “Start here”")).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator(".note-link")).toHaveCount(7);
});

test("exports Markdown, formatted DOCX and a downloadable PDF", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Edit Markdown" }).click();
  await page
    .getByRole("textbox", { name: "Markdown source" })
    .fill(
      "## Export check\n\n**Bold text** and *italic text*.\n\n| Name | Status |\n| --- | --- |\n| API | Ready |\n\n- [x] Done\n\n```js\nconst answer = 42;\n```",
    );
  for (const type of ["MD", "DOCX", "PDF"]) {
    await page
      .getByRole("button", { name: "Export note", exact: true })
      .click();
    const pending = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Export " + type, exact: true })
      .click();
    const file = await pending;
    const path = testInfo.outputPath(file.suggestedFilename());
    await file.saveAs(path);
    if (type === "DOCX") {
      const { execFileSync } = await import("node:child_process");
      const xml = execFileSync("unzip", ["-p", path, "word/document.xml"], {
        encoding: "utf8",
      });
      expect(xml).toContain("<w:tbl>");
      expect(xml).toContain("<w:b/>");
      expect(xml).not.toContain("**Bold text**");
    }
    if (type === "PDF") {
      const { readFile } = await import("node:fs/promises");
      const bytes = await readFile(path);
      expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
      expect(bytes.length).toBeGreaterThan(5000);
    }
  }
});

test("backup, Markdown import, note search, graph inspection and responsive layout", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const failures = [];
  page.on("pageerror", (e) => failures.push(e.message));
  await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue(
    "Start here",
  );
  await page.screenshot({ path: testInfo.outputPath("workspace-dark.png") });
  await page.getByRole("button", { name: "Find in note", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Find text in note" })
    .fill("workspace");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect
    .poll(() =>
      page
        .getByRole("textbox", { name: "Markdown source" })
        .evaluate((el) => el.value.slice(el.selectionStart, el.selectionEnd)),
    )
    .toBe("workspace");
  await page.getByRole("button", { name: "Graph view", exact: true }).click();
  await page
    .getByRole("button", { name: "Inspect Authentication API", exact: true })
    .click();
  await page.locator(".wt-node-detail summary").click();
  await expect(page.locator(".wt-node-detail")).toContainText(
    "Architecture decisions",
  );
  const zoomBefore = Number(
    await page
      .locator(".wt-graph-controls span")
      .innerText()
      .then((s) => s.replace("%", "")),
  );
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect
    .poll(async () =>
      Number(
        (await page.locator(".wt-graph-controls span").innerText()).replace(
          "%",
          "",
        ),
      ),
    )
    .toBeGreaterThan(zoomBefore);
  await page.screenshot({ path: testInfo.outputPath("graph-dark.png") });
  await page
    .getByRole("button", { name: "Open selected note", exact: true })
    .click();
  await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue(
    "Authentication API",
  );
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Backup workspace", exact: true })
    .click();
  const backup = await download;
  const file = testInfo.outputPath("backup.zip");
  await backup.saveAs(file);
  const fs = await import("node:fs/promises");
  const { unzipSync, strFromU8 } = await import("fflate");
  const files = unzipSync(await fs.readFile(file));
  expect(
    JSON.parse(strFromU8(files["workspace.json"])).notes.filter(
      (n) => !n.deletedAt && !n.okf,
    ),
  ).toHaveLength(7);
  await page.locator('input[type="file"][accept=".json,.md"]').setInputFiles({
    name: "Imported.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Imported\n\nAn offline document #imported"),
  });
  await page.getByRole("button", { name: "Imported", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue(
    "Imported",
  );
  await page.getByLabel("Color theme").selectOption("light");
  await page.screenshot({ path: testInfo.outputPath("workspace-light.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Toggle sidebar" }).click();
  await page.screenshot({ path: testInfo.outputPath("workspace-mobile.png") });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(failures).toEqual([]);
});

test("two tabs preserve independent edits and disk notes survive damaged browser storage", async ({
  page,
  context,
  request,
}) => {
  await page.goto("/");
  const other = await context.newPage();
  await other.goto("/");
  await page.getByRole("textbox", { name: "Note title" }).fill("Tab A title");
  await other.getByLabel("Note in panel 1").selectOption("roadmap");
  await other.getByRole("textbox", { name: "Note title" }).fill("Tab B title");
  await expect
    .poll(async () => (await savedNote(request, "welcome")).title)
    .toBe("Tab A title");
  await expect
    .poll(async () => (await savedNote(request, "roadmap")).title)
    .toBe("Tab B title");
  await other.close();
  await page.evaluate(() =>
    localStorage.setItem("thread.notes.v1", "DAMAGED ORIGINAL"),
  );
  await page.reload();
  await page.getByLabel("Note in panel 1").selectOption("welcome");
  await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue(
    "Tab A title",
  );
  expect(
    await page.evaluate(() => localStorage.getItem("thread.notes.v1")),
  ).toBe("DAMAGED ORIGINAL");
  expect((await savedNote(request, "roadmap")).title).toBe("Tab B title");
});

test("code examples are preserved and autocomplete stays visible in long notes", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Edit Markdown" }).click();
  const editor = page.getByRole("textbox", { name: "Markdown source" });
  await editor.fill("```md\n@[Platform roadmap](note:roadmap)\n```");
  await page.getByRole("button", { name: "Preview note" }).click();
  await expect(page.locator(".prose pre code")).toHaveText(
    "@[Platform roadmap](note:roadmap)\n",
  );
  await page.getByRole("button", { name: "Edit Markdown" }).click();
  await editor.fill("Long note line\n".repeat(80));
  await editor.press("ControlOrMeta+End");
  await editor.press("/");
  await expect(page.locator(".autocomplete")).toBeInViewport();
  await page.getByRole("button", { name: "Toggle sidebar" }).click();
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByPlaceholder("Search anything…")).toBeFocused();
});

test("disk save failures keep drafts visibly unsaved and retry without losing edits", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.route("**/api/notes/welcome", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Disk unavailable" }),
        })
      : route.continue(),
  );
  await page.getByRole("textbox", { name: "Note title" }).fill("Unsaved title");
  await expect(page.getByRole("alert")).toContainText("Disk unavailable");
  await expect(page.locator(".saved")).toContainText("Not saved");
  expect((await savedNote(request, "welcome")).title).toBe("Start here");
  await page.unroute("**/api/notes/welcome");
  await page.getByRole("button", { name: "Retry save", exact: true }).click();
  await waitForSaved(page);
  expect((await savedNote(request, "welcome")).title).toBe("Unsaved title");
});

test("every developer, product and Markdown block inserts from the command palette", async ({
  page,
}) => {
  const { templates } = await import("../src/model.js");
  await page.goto("/");
  await page.getByRole("button", { name: "Edit Markdown" }).click();
  const editor = page.getByRole("textbox", { name: "Markdown source" });
  for (const [label, value, group] of templates) {
    await editor.fill("/");
    await page
      .getByRole("button", { name: label + " " + group, exact: true })
      .click();
    await expect(editor).toHaveValue(value);
  }
});

test("a pending insertion frame cannot overwrite the next source selection", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Edit Markdown" }).click();
  const editor = page.getByRole("textbox", { name: "Markdown source" });
  await editor.fill("/");
  // Hold the frame boundary so the next user selection precedes any deferred caret work.
  await page.evaluate(() => {
    const original = window.requestAnimationFrame;
    const callbacks = [];
    window.requestAnimationFrame = (callback) => callbacks.push(callback);
    window.releaseInsertionFrames = () => {
      window.requestAnimationFrame = original;
      callbacks.forEach((callback) => callback(performance.now()));
    };
  });
  await page.getByRole("button", { name: "Numbered list Structure", exact: true }).click();
  await expect(editor).toHaveValue("1. First step\n2. Second step\n");
  await editor.selectText();
  await page.evaluate(() => window.releaseInsertionFrames());
  await page.keyboard.insertText("/");
  await expect(editor).toHaveValue("/");
  await page.getByRole("button", { name: "Quote Structure", exact: true }).click();
  await expect(editor).toHaveValue("> A useful quotation.\n");
});
