import {
  test as base,
  expect,
  BASE,
  headers,
  login,
  workspace,
  savedNote,
} from "./helpers.js";
// Keep this suite's configured workspace separate from first-run authentication tests.
const test = base.extend({
  diagramSuite: [async ({}, use) => use(true), { scope: "worker", auto: true }],
});
async function createDiagram(page, title) {
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
    .fill('```thread-diagram\n{"version":2,"nodes":[],"edges":[]}\n```');
  const note = await savedNote(page, title);
  await expect
    .poll(
      async () =>
        (await workspace(page)).notes.find((n) => n.id === note.id)?.body,
    )
    .toContain("thread-diagram");
  await page.getByRole("button", { name: "Edit diagram", exact: true }).click();
  return note;
}
async function savedDiagram(page, id) {
  const n = (await workspace(page)).notes.find((n) => n.id === id);
  return JSON.parse(n.body.match(/```thread-diagram\s*([\s\S]*?)```/)[1]);
}
test("v2 grouping, dimensions and batch copies persist in an ordinary note", async ({
  page,
}) => {
  const note = await createDiagram(page, "V2 canvas persistence");
  await page.getByLabel("Diagram template").selectOption("flow");
  await page.getByRole("button", { name: "Shapes panel" }).click();
  const first = page.locator(".react-flow__node").first();
  await first.click();
  await page.getByLabel("Shape width", { exact: true }).fill("260");
  await first.focus();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+g");
  await expect(page.locator(".react-flow__node")).toHaveCount(4);
  await page.keyboard.press("ControlOrMeta+d");
  await expect(page.locator(".react-flow__node")).toHaveCount(8);
  await page.getByRole("button", { name: "Save diagram", exact: true }).click();
  await expect
    .poll(async () => (await savedDiagram(page, note.id)).nodes.length)
    .toBe(8);
  const d = await savedDiagram(page, note.id);
  expect(d.nodes.filter((n) => n.parentId)).toHaveLength(6);
  expect(d.nodes.filter((n) => n.width === 260)).toHaveLength(2);
  await page.reload();
  await page.getByRole("button", { name: "Edit diagram", exact: true }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(8);
});
test("shared templates insert and JSON export preserves the saved selection", async ({
  page,
}, info) => {
  await createDiagram(page, "V2 shared templates");
  await page.getByRole("button", { name: "Add process", exact: true }).click();
  await page.getByLabel("Shape label").fill("Reusable approval");
  await page.getByText("Templates, files and exports", { exact: true }).click();
  await page.getByLabel("Template name").fill("Approval unit");
  await page
    .getByRole("button", { name: "Save selection as template" })
    .click();
  await expect(
    page.getByLabel("Shared template", { exact: true }),
  ).toContainText("Approval unit");
  await page
    .getByLabel("Shared template", { exact: true })
    .selectOption({ label: "Approval unit" });
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON", exact: true }).click();
  const download = await pending;
  const file = info.outputPath("diagram.json");
  await download.saveAs(file);
  const fs = await import("node:fs");
  expect(
    JSON.parse(fs.readFileSync(file, "utf8")).nodes.map((n) => n.data.label),
  ).toEqual(["Reusable approval", "Reusable approval"]);
  await page.getByRole("button", { name: "Save diagram", exact: true }).click();
});
test("unfinished diagram draft recovers after reload without changing saved note", async ({
  page,
}) => {
  const note = await createDiagram(page, "V2 recovery");
  await page.getByRole("button", { name: "Add ellipse", exact: true }).click();
  await page.getByLabel("Shape label").fill("Unfinished draft");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Object.keys(localStorage).filter(
            (k) =>
              k.startsWith("thread-diagram-draft:") && !k.endsWith(":viewport"),
          ).length,
      ),
    )
    .toBeGreaterThan(0);
  page.on("dialog", (d) => d.accept());
  await page.reload();
  await page.getByRole("button", { name: "Edit diagram", exact: true }).click();
  await expect(
    page.getByRole("alertdialog", { name: "Recover diagram draft" }),
  ).toBeVisible();
  await page.keyboard.press("ControlOrMeta+s");
  await expect(
    page.getByRole("alertdialog", { name: "Recover diagram draft" }),
  ).toBeVisible();
  expect((await savedDiagram(page, note.id)).nodes).toHaveLength(0);
  await page
    .getByRole("button", { name: "Restore draft", exact: true })
    .click();
  await expect(page.locator(".react-flow__node")).toHaveCount(1);
  await page.getByRole("button", { name: "Save diagram", exact: true }).click();
  await expect
    .poll(async () => (await savedDiagram(page, note.id)).nodes[0]?.data.label)
    .toBe("Unfinished draft");
});
test("local images and reviewed JSON imports survive SVG export", async ({
  page,
}, info) => {
  const note = await createDiagram(page, "V2 local image import");
  await page.getByText("Templates, files and exports", { exact: true }).click();
  await page.getByLabel("Upload diagram asset").setInputFiles({
    name: "pixel.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await expect(page.locator(".react-flow__node image")).toHaveCount(1);
  const imported = {
    version: 2,
    nodes: [
      {
        id: "import",
        position: { x: 20, y: 20 },
        data: {
          shape: "document",
          label: "Imported specification",
          color: "#ffffff",
        },
      },
    ],
    edges: [],
  };
  await page.getByLabel("Import diagram JSON").setInputFiles({
    name: "diagram.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(imported)),
  });
  await expect(
    page.getByRole("group", { name: "Review imported diagram" }),
  ).toBeVisible();
  await expect(page.locator(".react-flow__node")).toHaveCount(1);
  await page.getByRole("button", { name: "Insert imported diagram" }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export SVG", exact: true }).click();
  const dl = await pending;
  const file = info.outputPath("embedded.svg");
  await dl.saveAs(file);
  const fs = await import("node:fs");
  expect(fs.readFileSync(file, "utf8")).toContain("data:image/png;base64,");
  await page.getByRole("button", { name: "Save diagram", exact: true }).click();
  await expect
    .poll(async () => (await savedDiagram(page, note.id)).nodes.length)
    .toBe(2);
  expect((await savedDiagram(page, note.id)).nodes[0].data.image.url).toMatch(
    /^\/api\/assets\//,
  );
});
test("direct labels and connector styles persist", async ({ page }) => {
  const note = await createDiagram(page, "V2 connector style");
  await page.getByLabel("Diagram template").selectOption("flow");
  const first = page.locator(".react-flow__node").first();
  await first.dblclick();
  await page.getByLabel("Edit label directly").fill("Directly edited");
  await page.getByLabel("Edit label directly").press("ControlOrMeta+Enter");
  const edgeBox = await page
    .locator(".react-flow__edge-interaction")
    .first()
    .boundingBox();
  await page.mouse.click(
    edgeBox.x + edgeBox.width / 2,
    edgeBox.y + edgeBox.height / 2,
  );
  await page.getByLabel("Connector label", { exact: true }).fill("approved");
  await page.getByLabel("Connector type").selectOption("orthogonal");
  await page.getByLabel("endArrow", { exact: true }).selectOption("diamond");
  await page.getByLabel("Dashed", { exact: true }).check();
  await page.getByRole("button", { name: "Save diagram", exact: true }).click();
  await expect
    .poll(async () => (await savedDiagram(page, note.id)).edges[0].kind)
    .toBe("orthogonal");
  const d = await savedDiagram(page, note.id);
  expect(d.nodes[0].data.label).toBe("Directly edited");
  expect(d.edges[0]).toMatchObject({
    label: "approved",
    dashed: true,
    endArrow: "diamond",
  });
});
test("linked notes navigate from preview and agent proposals require visual apply", async ({
  page,
}) => {
  const note = await createDiagram(page, "V2 reviewed proposal");
  await page.getByRole("button", { name: "Add process", exact: true }).click();
  await page.getByLabel("Shape label").fill("Open Start here");
  await page.getByText("Link shape", { exact: true }).click();
  await page
    .getByLabel("Link to note", { exact: true })
    .selectOption("welcome");
  await page.getByRole("button", { name: "Save diagram", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await savedDiagram(page, note.id)).nodes[0]?.data.link?.noteId,
    )
    .toBe("welcome");
  const current = (await workspace(page)).notes.find((n) => n.id === note.id);
  const key = await (
    await page.request.post(BASE + "/api/mcp/keys", {
      headers,
      data: { name: "Browser diagram agent" },
    })
  ).json();
  const proposalDiagram = await savedDiagram(page, note.id);
  proposalDiagram.nodes[0].data.label = "Reviewed by a human";
  const response = await page.request.post(
    BASE + "/api/agent/diagram-proposals",
    {
      headers: { ...headers, Authorization: `Bearer ${key.token}` },
      data: {
        noteId: note.id,
        diagramIndex: 0,
        baseRevision: current.revision,
        diagram: proposalDiagram,
        summary: "Rename linked process",
      },
    },
  );
  expect(response.ok()).toBe(true);
  expect((await savedDiagram(page, note.id)).nodes[0].data.label).toBe(
    "Open Start here",
  );
  await page.getByRole("button", { name: "Edit diagram", exact: true }).click();
  await page
    .getByRole("button", { name: "Review: Rename linked process", exact: true })
    .click();
  await expect(
    page.getByRole("alertdialog", { name: "Review diagram proposal" }),
  ).toBeVisible();
  await expect(
    page.getByAltText("Current draft", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByAltText("Proposed diagram", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Apply reviewed proposal", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect
    .poll(async () => (await savedDiagram(page, note.id)).nodes[0].data.label)
    .toBe("Reviewed by a human");
  await page
    .getByRole("button", { name: "Reviewed by a human ↗", exact: true })
    .click();
  await expect(page.locator("#render-welcome")).toBeVisible();
});
test("mobile panels leave a usable canvas and resized shapes can be saved", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await createDiagram(page, "V2 mobile canvas");
  await expect(page.locator(".diagram-palette")).toBeHidden();
  await page.getByRole("button", { name: "Shapes panel", exact: true }).click();
  await page.getByRole("button", { name: "Add process", exact: true }).click();
  await page.getByRole("button", { name: "Shapes panel", exact: true }).click();
  await page
    .getByRole("button", { name: "Inspector panel", exact: true })
    .click();
  await page.getByLabel("Shape label", { exact: true }).fill("Mobile draft");
  await page.getByLabel("Shape width", { exact: true }).fill("240");
  await page
    .getByRole("button", { name: "Inspector panel", exact: true })
    .click();
  await expect(page.locator(".diagram-canvas")).toBeVisible();
  await page.screenshot({ path: info.outputPath("mobile-editor.png") });
  await page.getByRole("button", { name: "Save diagram", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
test("delayed asset insertion preserves concurrent edits and undo restores that latest draft", async ({
  page,
}) => {
  const note = await createDiagram(page, "V2 delayed asset upload");
  await page.getByRole("button", { name: "Add process", exact: true }).click();
  await page.getByLabel("Shape label", { exact: true }).fill("Before upload");
  await page.getByText("Templates, files and exports", { exact: true }).click();
  let releaseUpload,
    uploadRequested = false;
  const uploadGate = new Promise((resolve) => {
    releaseUpload = resolve;
  });
  await page.route("**/api/assets", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    uploadRequested = true;
    await uploadGate;
    await route.continue();
  });
  try {
    await page.getByLabel("Upload diagram asset").setInputFiles({
      name: "delayed-pixel.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
        "base64",
      ),
    });
    await expect.poll(() => uploadRequested).toBe(true);
    await expect(
      page.getByRole("button", { name: "Save diagram", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Close diagram", exact: true }),
    ).toBeDisabled();
    await page
      .getByLabel("Shape label", { exact: true })
      .fill("Edited during upload");
    releaseUpload();
    await expect(page.locator(".react-flow__node")).toHaveCount(2);
    await expect(page.locator(".react-flow__node image")).toHaveCount(1);
    await expect(
      page
        .locator(".react-flow__node")
        .filter({ hasText: "Edited during upload" }),
    ).toHaveCount(1);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(page.locator(".react-flow__node")).toHaveCount(1);
    await expect(page.locator(".react-flow__node image")).toHaveCount(0);
    await expect(page.locator(".react-flow__node")).toContainText(
      "Edited during upload",
    );
    await page
      .getByRole("button", { name: "Save diagram", exact: true })
      .click();
    await expect
      .poll(
        async () => (await savedDiagram(page, note.id)).nodes[0]?.data.label,
      )
      .toBe("Edited during upload");
    expect((await savedDiagram(page, note.id)).nodes).toHaveLength(1);
  } finally {
    releaseUpload();
  }
});
test("reopening a saved diagram restores its captured viewport after visible measurement", async ({
  page,
}, info) => {
  const note = await createDiagram(page, "V2 viewport restoration");
  await page.getByLabel("Diagram template").selectOption("decision");
  await page.getByRole("button", { name: "Add database", exact: true }).click();
  await page
    .getByLabel("Shape label", { exact: true })
    .fill("Viewport archive");
  const storedViewport = () =>
    page.evaluate((noteId) => {
      const key = Object.keys(localStorage).find(
        (k) =>
          k.startsWith("thread-diagram-draft:") &&
          k.includes(noteId) &&
          k.endsWith(":viewport"),
      );
      return key ? JSON.parse(localStorage.getItem(key)) : null;
    }, note.id);
  await expect.poll(storedViewport).not.toBeNull();
  const before = await storedViewport();
  await page.getByRole("button", { name: "Save diagram", exact: true }).click();
  await expect
    .poll(async () => (await savedDiagram(page, note.id)).nodes.length)
    .toBe(4);
  await page.reload();
  await page.getByRole("button", { name: "Edit diagram", exact: true }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(4);
  await page.locator(".react-flow__node").first().click();
  await expect(page.getByLabel("Shape label", { exact: true })).toHaveValue(
    "Ready?",
  );
  await expect.poll(storedViewport).toEqual(before);
  const after = await storedViewport();
  await page.screenshot({
    path: info.outputPath("diagram-desktop-viewport.png"),
  });
  await info.attach("viewport-restoration.json", {
    body: JSON.stringify({ before, after }, null, 2),
    contentType: "application/json",
  });
  await page
    .getByRole("button", { name: "Close diagram", exact: true })
    .click();
});
