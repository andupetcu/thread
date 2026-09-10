import {
  test as base,
  expect,
  login,
  workspace,
  savedNote,
} from "./helpers.js";
// Native-editor fixtures must not reuse the workspace replaced by durability tests.
const test = base.extend({
  mindMapSuite: [async ({}, use) => use(true), { scope: "worker", auto: true }],
});
async function createMap(
  page,
  title,
  initial = { version: 2, engine: "drawnix", elements: [], references: [] },
) {
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
    .fill("```thread-mindmap\n" + JSON.stringify(initial) + "\n```");
  const note = await savedNote(page, title);
  await expect
    .poll(
      async () =>
        (await workspace(page)).notes.find((n) => n.id === note.id)?.body,
    )
    .toContain("drawnix");
  await page.getByRole("button", { name: "Preview note", exact: true }).click();
  await page
    .getByRole("button", { name: "Edit mind map", exact: true })
    .click();
  return note;
}
async function savedMap(page, id) {
  return JSON.parse(
    (await workspace(page)).notes
      .find((n) => n.id === id)
      .body.match(/```thread-mindmap\s*([\s\S]*?)\n```/)[1],
  );
}
test("native Drawnix Markdown import saves editable elements and PNG preview", async ({
  page,
}) => {
  const note = await createMap(page, "Native mind map");
  await expect(page.locator(".mindmap-canvas .drawnix")).toBeVisible();
  await page
    .getByLabel("Import Markdown")
    .fill("# Project\n## Research\n## Delivery");
  await page
    .getByRole("button", { name: "Review Markdown", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Replace with imported mind map",
      exact: true,
    })
    .click();
  await expect(page.locator(".mindmap-canvas")).toContainText("Research");
  expect((await savedMap(page, note.id)).elements).toEqual([]);
  await page
    .getByRole("button", { name: "Save mind map", exact: true })
    .click();
  await expect
    .poll(async () => (await savedMap(page, note.id)).elements.length)
    .toBeGreaterThan(0);
  const saved = await savedMap(page, note.id);
  expect(saved.engine).toBe("drawnix");
  expect(saved.preview).toMatch(/^data:image\/png;base64,/);
  await page.reload();
  await expect(page.getByAltText("Saved mind map preview")).toBeVisible();
});
test("native mind map recovers draft and exports native JSON", async ({
  page,
}) => {
  await createMap(page, "Native recovery");
  await page
    .getByLabel("Import Markdown")
    .fill("# Recovered project\n## Unfinished idea");
  await page
    .getByRole("button", { name: "Review Markdown", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Replace with imported mind map",
      exact: true,
    })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.values(localStorage).some((v) => v.includes("Unfinished idea")),
      ),
    )
    .toBe(true);
  page.on("dialog", (d) => d.accept());
  await page.reload();
  await page
    .getByRole("button", { name: "Edit mind map", exact: true })
    .click();
  await expect(
    page.getByRole("alertdialog", { name: "Recover mind map draft" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Restore mind map draft", exact: true })
    .click();
  await expect(page.locator(".mindmap-canvas")).toContainText(
    "Unfinished idea",
  );
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export Drawnix", exact: true })
    .click();
  expect((await pending).suggestedFilename()).toBe("mind-map.drawnix");
});
test("native keyboard editing and workspace references persist on mobile", async ({
  page,
}, info) => {
  const note = await createMap(page, "Native keyboard references");
  await page
    .getByLabel("Import Markdown")
    .fill("# Keyboard project\n## Research");
  await page
    .getByRole("button", { name: "Review Markdown", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Replace with imported mind map",
      exact: true,
    })
    .click();
  await page
    .locator(".mindmap-canvas")
    .getByText("Research", { exact: true })
    .click();
  await page.keyboard.press("Tab");
  await expect
    .poll(() => page.locator(".mindmap-canvas [plait-data-id]").count())
    .toBeGreaterThan(2);
  await page
    .getByRole("combobox", { name: "Reference target", exact: true })
    .selectOption("welcome");
  await page
    .getByRole("button", { name: "Add reference", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Mind map tools", exact: true })
    .click();
  await page.getByRole("button", { name: "Fit map", exact: true }).click();
  await page.screenshot({ path: info.outputPath("native-mindmap-mobile.png") });
  await page
    .getByRole("button", { name: "Save mind map", exact: true })
    .click();
  await expect
    .poll(async () => (await savedMap(page, note.id)).references.length)
    .toBe(1);
  const saved = await savedMap(page, note.id);
  expect(saved.elements[0].children[0].children).toHaveLength(1);
  expect(saved.references[0].link.noteId).toBe("welcome");
  expect(saved.references[0].elementId).toBeTruthy();
  await page
    .getByRole("button", { name: "Edit mind map", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Mind map editor" }),
  ).toContainText("Saved");
  await page
    .getByRole("button", { name: "Close mind map", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Mind map editor" }),
  ).toHaveCount(0);
});
test("recovery quota failure does not block native import or disk save", async ({
  page,
}) => {
  const note = await createMap(page, "Recovery quota");
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("thread-mindmap-draft:"))
        throw new DOMException("Storage full", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  await page
    .getByLabel("Import Markdown")
    .fill("# Quota project\n## Save anyway");
  await page
    .getByRole("button", { name: "Review Markdown", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Replace with imported mind map",
      exact: true,
    })
    .click();
  await expect(page.locator(".mindmap-canvas")).toContainText("Save anyway");
  await expect(page.getByRole("alert")).toContainText(
    "Recovery storage is unavailable",
  );
  await page
    .getByRole("button", { name: "Save mind map", exact: true })
    .click();
  await expect
    .poll(async () => (await savedMap(page, note.id)).elements.length)
    .toBe(1);
  await expect(
    page.getByRole("dialog", { name: "Mind map editor" }),
  ).toHaveCount(0);
});
test("minimal native Drawnix imports without optional viewport and theme", async ({
  page,
}) => {
  await createMap(page, "Minimal native import");
  await page.getByLabel("Import Drawnix").setInputFiles({
    name: "minimal.drawnix",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ type: "drawnix", elements: [] })),
  });
  await expect(
    page.getByRole("alertdialog", { name: "Review mind map import" }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Replace with imported mind map",
      exact: true,
    })
    .click();
  await expect(page.locator(".mindmap-canvas .drawnix")).toBeVisible();
});
test("native renderer failure retains recoverable document controls", async ({
  page,
}) => {
  await page.route("**/src/mindmap/MindMapEditor.jsx", async (route) => {
    const response = await route.fetch();
    let body = await response.text();
    expect(body).toContain("board.current = b;");
    body = body.replace(
      "board.current = b;",
      'throw new Error("Injected native renderer failure");',
    );
    await route.fulfill({ response, body });
  });
  await createMap(page, "Native renderer failure");
  await expect(page.getByRole("alert")).toContainText(
    "Drawnix could not display this document",
  );
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download preserved mind map", exact: true })
    .click();
  expect((await pending).suggestedFilename()).toBe("mind-map-preserved.json");
  await expect(page.getByLabel("Import Drawnix")).toBeVisible();
});
async function orangePixels(page, src) {
  return page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (
        pixels[i] > 200 &&
        pixels[i + 1] > 90 &&
        pixels[i + 1] < 210 &&
        pixels[i + 2] < 80 &&
        pixels[i + 3] > 100
      )
        count++;
    return count;
  }, src);
}
test("native typed labels paint on canvas and refresh an existing blank PNG", async ({
  page,
}, info) => {
  const elements = [
    {
      id: "ejixN",
      type: "mindmap",
      data: {
        topic: { children: [{ text: "asdasdasdasd" }], type: "paragraph" },
      },
      children: [
        {
          id: "MJBzN",
          type: "mind_child",
          data: {
            topic: {
              children: [
                { text: "asdasdasdasdsadasdasdasdasdas", color: "#FFA500ff" },
              ],
              type: "paragraph",
            },
          },
          children: [],
        },
      ],
      layout: "right",
      isRoot: true,
      points: [[-11.3125, 104.05078125]],
    },
  ];
  // An existing valid document with a stale blank preview, matching the reported case.
  const preview =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
  const note = await createMap(page, "Native label geometry", {
    version: 2,
    engine: "drawnix",
    elements,
    viewport: { zoom: 1 },
    theme: { themeColorMode: "default" },
    references: [],
    preview,
  });
  await page.getByRole("button", { name: "Fit map", exact: true }).click();
  const geometry = await page
    .locator(".mindmap-canvas [data-slate-string]")
    .evaluateAll((els) =>
      els.map((el) => {
        const text = el.getBoundingClientRect(),
          frame = el.closest("foreignObject").getBoundingClientRect();
        return {
          top: text.top,
          bottom: text.bottom,
          height: text.height,
          frameTop: frame.top,
          frameBottom: frame.bottom,
        };
      }),
    );
  expect(geometry).toHaveLength(2);
  for (const g of geometry) {
    expect(g.height).toBeGreaterThan(0);
    expect(g.top).toBeGreaterThanOrEqual(g.frameTop - 1);
    expect(g.bottom).toBeLessThanOrEqual(g.frameBottom + 1);
  }
  // DOM visibility/bounds alone do not detect WebKit's foreignObject paint failure.
  const screen = await page.screenshot({
    path: info.outputPath("native-labels.png"),
  });
  expect(
    await orangePixels(
      page,
      "data:image/png;base64," + screen.toString("base64"),
    ),
  ).toBeGreaterThan(30);
  const root = page
    .locator(".mindmap-canvas")
    .getByText("asdasdasdasd", { exact: true });
  await root.dblclick();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Typed root remains visible");
  await page
    .getByRole("button", { name: "Save mind map", exact: true })
    .click();
  await expect
    .poll(async () => (await savedMap(page, note.id)).preview)
    .not.toBe(preview);
  const saved = await savedMap(page, note.id);
  expect(saved.elements[0].data.topic.children[0].text).toBe(
    "Typed root remains visible",
  );
  expect(await orangePixels(page, saved.preview)).toBeGreaterThan(30);
  await page.reload();
  await expect(page.getByAltText("Saved mind map preview")).toBeVisible();
  await page
    .getByRole("button", { name: "Edit mind map", exact: true })
    .click();
  await expect(page.locator(".mindmap-canvas")).toContainText(
    "Typed root remains visible",
  );
});
