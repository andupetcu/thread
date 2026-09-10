import {
  test as base,
  expect,
  BASE,
  login,
  workspace,
  savedNote,
} from "./helpers.js";
const test = base.extend({
  mindmapWorker: [
    async ({}, use) => use(true),
    { scope: "worker", auto: true },
  ],
});
async function createMap(page, title) {
  await login(page);
  await page
    .getByRole("button", { name: "New note", exact: true })
    .first()
    .click();
  await page
    .getByRole("textbox", { name: "Note title", exact: true })
    .fill(title);
  if (
    !(await page
      .getByRole("textbox", { name: "Markdown source", exact: true })
      .isVisible())
  )
    await page
      .getByRole("button", { name: "Edit Markdown", exact: true })
      .click();
  await page
    .getByRole("textbox", { name: "Markdown source", exact: true })
    .fill(
      '```thread-mindmap\n{"version":1,"rootId":"root","layout":"both","nodes":[{"id":"root","label":"Central idea"}]}\n```',
    );
  const note = await savedNote(page, title);
  await expect
    .poll(
      async () =>
        (await workspace(page)).notes.find((n) => n.id === note.id)?.body,
    )
    .toContain("thread-mindmap");
  await page
    .getByRole("button", { name: "Edit mind map", exact: true })
    .click();
  return note;
}
async function savedMap(page, id) {
  const n = (await workspace(page)).notes.find((n) => n.id === id);
  return JSON.parse(n.body.match(/```thread-mindmap\s*([\s\S]*?)\n```/)[1]);
}
test("mind map captures children and siblings, collapses branches and survives reload", async ({
  page,
}, info) => {
  const note = await createMap(page, "Mind map ideas");
  await page.getByLabel("Idea label", { exact: true }).fill("Project");
  await page.getByRole("button", { name: "Add child", exact: true }).click();
  await page.getByLabel("Idea label", { exact: true }).fill("Research");
  await page.getByRole("button", { name: "Add sibling", exact: true }).click();
  await page.getByLabel("Idea label", { exact: true }).fill("Delivery");
  await page.getByRole("button", { name: "Add child", exact: true }).click();
  await page.getByLabel("Idea label", { exact: true }).fill("Launch");
  await page
    .getByLabel("Parent idea", { exact: true })
    .selectOption({ label: "Research" });
  await page
    .getByRole("button", { name: "Save mind map", exact: true })
    .click();
  await expect
    .poll(async () => (await savedMap(page, note.id)).nodes.length)
    .toBe(4);
  const d = await savedMap(page, note.id);
  expect(d.nodes.find((n) => n.label === "Launch").parentId).toBe(
    d.nodes.find((n) => n.label === "Research").id,
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Edit mind map", exact: true })
    .click();
  await expect(page.locator(".mindmap-canvas .react-flow__node")).toHaveCount(
    4,
  );
  await page
    .locator(".mindmap-canvas .react-flow__node")
    .filter({ hasText: "Research" })
    .click();
  await page
    .getByRole("button", { name: "Collapse branch", exact: true })
    .click();
  await expect(page.locator(".mindmap-canvas .react-flow__node")).toHaveCount(
    3,
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator(".mindmap-canvas .react-flow__node")).toHaveCount(
    4,
  );
  await page.screenshot({ path: info.outputPath("mindmap-desktop.png") });
  await page
    .getByRole("button", { name: "Save mind map", exact: true })
    .click();
});
test("mind map recovers unfinished changes and exports an editable outline", async ({
  page,
}, info) => {
  const note = await createMap(page, "Mind map recovery");
  await page.getByRole("button", { name: "Add child", exact: true }).click();
  await page.getByLabel("Idea label", { exact: true }).fill("Unfinished idea");
  await expect
    .poll(() =>
      page.evaluate(
        (id) =>
          Object.keys(localStorage).some(
            (k) =>
              k.startsWith("thread-mindmap-draft:") &&
              k.includes(id) &&
              !k.endsWith(":viewport"),
          ),
        note.id,
      ),
    )
    .toBe(true);
  page.on("dialog", (d) => d.accept());
  await page.reload();
  await page
    .getByRole("button", { name: "Edit mind map", exact: true })
    .click();
  const recoveredBefore = await page.evaluate(
    (id) =>
      Object.entries(localStorage).find(
        ([k]) =>
          k.startsWith("thread-mindmap-draft:") &&
          k.includes(id) &&
          !k.endsWith(":viewport"),
      )?.[1],
    note.id,
  );
  await page.keyboard.press("ControlOrMeta+s");
  await expect(
    page.getByRole("alertdialog", { name: "Recover mind map draft" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      (id) =>
        Object.entries(localStorage).find(
          ([k]) =>
            k.startsWith("thread-mindmap-draft:") &&
            k.includes(id) &&
            !k.endsWith(":viewport"),
        )?.[1],
      note.id,
    ),
  ).toBe(recoveredBefore);
  expect((await savedMap(page, note.id)).nodes).toHaveLength(1);
  await page
    .getByRole("button", { name: "Restore mind map draft", exact: true })
    .click();
  await expect(page.locator(".mindmap-canvas .react-flow__node")).toHaveCount(
    2,
  );
  await page.getByText("Import and export", { exact: true }).click();
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export outline", exact: true })
    .click();
  const dl = await pending;
  const file = info.outputPath("ideas.md");
  await dl.saveAs(file);
  const fs = await import("node:fs");
  expect(fs.readFileSync(file, "utf8")).toContain("Unfinished idea");
  await page
    .getByRole("button", { name: "Save mind map", exact: true })
    .click();
  await expect
    .poll(async () => (await savedMap(page, note.id)).nodes.length)
    .toBe(2);
});
test("mind map outline import requires review and linked notes navigate", async ({
  page,
}) => {
  const note = await createMap(page, "Mind map linked outline");
  await page.getByText("Import and export", { exact: true }).click();
  await page
    .getByLabel("Import outline", { exact: true })
    .fill("- Central plan\n  - Reference\n  - Deliverable");
  await page
    .getByRole("button", { name: "Review outline", exact: true })
    .click();
  await expect(
    page.getByRole("alertdialog", { name: "Review mind map import" }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Replace with imported mind map",
      exact: true,
    })
    .click();
  await expect(page.locator(".mindmap-canvas .react-flow__node")).toHaveCount(
    3,
  );
  await page
    .locator(".mindmap-canvas .react-flow__node")
    .filter({ hasText: "Reference" })
    .click();
  await page.getByText("Link idea", { exact: true }).click();
  await page
    .getByLabel("Link to note", { exact: true })
    .selectOption("welcome");
  await page
    .getByRole("button", { name: "Save mind map", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await savedMap(page, note.id)).nodes.find(
          (n) => n.label === "Reference",
        )?.link?.noteId,
    )
    .toBe("welcome");
  await page.getByRole("button", { name: "Reference ↗", exact: true }).click();
  await expect(page.locator("#render-welcome")).toBeVisible();
});
test("mind map keyboard capture and drag reparent preserve tree connectors", async ({
  page,
}) => {
  const note = await createMap(page, "Mind map keyboard drag");
  await page.locator(".mindmap-canvas .react-flow__node").first().focus();
  await page.keyboard.press("Tab");
  await page.getByLabel("Idea label", { exact: true }).fill("First branch");
  await page
    .locator(".mindmap-canvas .react-flow__node")
    .filter({ hasText: "First branch" })
    .focus();
  await page.keyboard.press("Enter");
  await page.getByLabel("Idea label", { exact: true }).fill("Second branch");
  await page.getByRole("button", { name: "Fit map", exact: true }).click();
  const source = await page
      .locator(".mindmap-canvas .react-flow__node")
      .filter({ hasText: "Second branch" })
      .boundingBox(),
    target = await page
      .locator(".mindmap-canvas .react-flow__node")
      .filter({ hasText: "First branch" })
      .boundingBox();
  await page.mouse.move(
    source.x + source.width / 2,
    source.y + source.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    target.x + target.width / 2,
    target.y + target.height / 2,
    { steps: 12 },
  );
  await page.mouse.up();
  await expect(page.getByLabel("Parent idea", { exact: true })).toHaveValue(
    await page
      .getByLabel("Parent idea", { exact: true })
      .locator("option")
      .filter({ hasText: "First branch" })
      .getAttribute("value"),
  );
  await expect(page.locator(".mindmap-canvas .react-flow__edge")).toHaveCount(
    2,
  );
  await page
    .getByRole("button", { name: "Save mind map", exact: true })
    .click();
  await expect
    .poll(async () => {
      const d = await savedMap(page, note.id);
      return (
        d.nodes.find((n) => n.label === "Second branch")?.parentId ===
        d.nodes.find((n) => n.label === "First branch")?.id
      );
    })
    .toBe(true);
});
test("mind map mobile editor saves and exports native JSON SVG and PNG", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await createMap(page, "Mind map mobile exports");
  await page.getByRole("button", { name: "Ideas panel", exact: true }).click();
  await page.getByLabel("Idea label", { exact: true }).fill("Pocket ideas");
  await page.getByRole("button", { name: "Add child", exact: true }).click();
  await page.getByLabel("Idea label", { exact: true }).fill("Capture anywhere");
  await page.getByText("Import and export", { exact: true }).click();
  for (const format of ["JSON", "SVG", "PNG"]) {
    const pending = page.waitForEvent("download");
    await page
      .getByRole("button", { name: `Export ${format}`, exact: true })
      .click();
    const dl = await pending,
      file = info.outputPath(`mindmap.${format.toLowerCase()}`);
    await dl.saveAs(file);
    const fs = await import("node:fs"),
      bytes = fs.readFileSync(file);
    if (format === "JSON")
      expect(JSON.parse(bytes).nodes.map((n) => n.label)).toContain(
        "Capture anywhere",
      );
    if (format === "SVG") expect(bytes.toString()).toContain("Pocket ideas");
    if (format === "PNG") expect(bytes.subarray(1, 4).toString()).toBe("PNG");
  }
  await page.getByRole("button", { name: "Ideas panel", exact: true }).click();
  await page.getByRole("button", { name: "Fit map", exact: true }).click();
  await page.screenshot({ path: info.outputPath("mindmap-mobile.png") });
  await page
    .getByRole("button", { name: "Save mind map", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
test("mind map arrows navigate without creating unsaved free positions", async ({
  page,
}) => {
  await createMap(page, "Mind map arrow navigation");
  await page.getByRole("button", { name: "Add child", exact: true }).click();
  await page.getByLabel("Idea label", { exact: true }).fill("Keyboard branch");
  const node = page
    .locator(".mindmap-canvas .react-flow__node")
    .filter({ hasText: "Keyboard branch" });
  await node.focus();
  const before = await node.getAttribute("style");
  await page.keyboard.press("Shift+ArrowRight");
  await expect(node).toHaveAttribute("style", before);
});
test("mind map long multiline labels stay within live idea bounds", async ({
  page,
}, info) => {
  await createMap(page, "Mind map fitted labels");
  const long = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`).join("\n");
  await page.getByLabel("Idea label", { exact: true }).fill(long);
  const node = page.locator(".mindmap-idea").first();
  const fits = () =>
    node.evaluate((el) => {
      const label = el.querySelector("svg text") || el.querySelector("span"),
        a = el.getBoundingClientRect(),
        b = label.getBoundingClientRect();
      return (
        b.top >= a.top - 1 &&
        b.bottom <= a.bottom + 1 &&
        b.left >= a.left - 1 &&
        b.right <= a.right + 1
      );
    });
  await expect.poll(fits).toBe(true);
  await page.getByRole("button", { name: "Add child", exact: true }).click();
  await page.getByLabel("Idea label", { exact: true }).fill(long);
  await page.getByRole("button", { name: "Fit map", exact: true }).click();
  for (const n of await page.locator(".mindmap-idea").all())
    expect(
      await n.evaluate((el) => {
        const a = el.getBoundingClientRect(),
          b = el.querySelector("svg text").getBoundingClientRect();
        return b.top >= a.top - 1 && b.bottom <= a.bottom + 1;
      }),
    ).toBe(true);
  await page.screenshot({ path: info.outputPath("mindmap-fitted-labels.png") });
});
test("mind map ArrowRight expands a collapsed branch before selecting its child", async ({
  page,
}) => {
  await createMap(page, "Mind map collapsed navigation");
  await page.getByRole("button", { name: "Add child", exact: true }).click();
  await page.getByLabel("Idea label", { exact: true }).fill("Parent branch");
  await page.getByRole("button", { name: "Add child", exact: true }).click();
  await page.getByLabel("Idea label", { exact: true }).fill("Hidden child");
  await page.getByRole("button", { name: "Fit map", exact: true }).click();
  const parent = page
    .locator(".mindmap-canvas .react-flow__node")
    .filter({ hasText: "Parent branch" });
  await parent.click();
  await page
    .getByRole("button", { name: "Collapse branch", exact: true })
    .click();
  await expect(page.locator(".mindmap-canvas .react-flow__node")).toHaveCount(
    2,
  );
  await parent.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByLabel("Idea label", { exact: true })).toHaveValue(
    "Parent branch",
  );
  await expect(page.locator(".mindmap-canvas .react-flow__node")).toHaveCount(
    3,
  );
  await page.keyboard.press("ArrowRight");
  await expect(page.getByLabel("Idea label", { exact: true })).toHaveValue(
    "Hidden child",
  );
});
