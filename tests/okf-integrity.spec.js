import { test, expect } from "./legacy-fixture.js";

async function setup(
  page,
  request,
  files = [
    { path: "concepts/a.md", source: "---\ntype: concept\n---\n# Original\n" },
  ],
) {
  const name = `Integrity ${Date.now()}`;
  let { bundle } = await (
    await request.post("/api/okf/bundles", { data: { name } })
  ).json();
  const endpoint = `/api/okf/bundles/${bundle.id}`;
  const imported = await request.post(`${endpoint}/import`, {
    data: { expectedRevision: bundle.revision, files },
  });
  expect(imported.ok()).toBe(true);
  ({ bundle } = await imported.json());
  await page.goto("/");
  await page.getByRole("button", { name, exact: true }).last().click();
  await page
    .getByRole("treeitem", { name: "concepts/a.md", exact: true })
    .click();
  return { bundle, endpoint };
}
async function edit(page, body = "# Local draft\n") {
  await page.getByRole("button", { name: "Edit body", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Concept body", exact: true })
    .fill(body);
}
async function remote(request, endpoint, body) {
  const { bundle } = await (await request.get(endpoint)).json();
  const entry = bundle.entries.find((e) => e.path === "concepts/a.md");
  const response = await request.put(`${endpoint}/documents`, {
    data: {
      path: entry.path,
      body,
      expectedRevision: bundle.revision,
      baseRevision: entry.revision,
    },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()).bundle;
}

test("requires a saved draft before create, rename, import, review, index, refresh and exports", async ({
  page,
  request,
}) => {
  await setup(page, request);
  await edit(page);
  for (const name of [
    "New concept",
    "Rename or move",
    "Import",
    "Review concept",
    "Manage index",
    "Export original ZIP",
    "Export portable ZIP",
    "Reload bundle",
  ]) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "Concept body", exact: true }),
    ).toHaveValue("# Local draft\n");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("alert")).toContainText(
      "Save your draft before this action.",
    );
  }
});

test("locks the authoring surface and mutations while the real save is in flight", async ({
  page,
  request,
}) => {
  const { endpoint } = await setup(page, request);
  await edit(page);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route(`**${endpoint}/documents`, async (route) => {
    await gate;
    await route.continue();
  });
  try {
    await page
      .getByRole("button", { name: "Save concept", exact: true })
      .click();
    await expect(page.locator(".okf-workspace")).toHaveAttribute("inert", "");
  } finally {
    release();
  }
  await expect(
    page.getByRole("button", { name: "Save concept", exact: true }),
  ).toHaveCount(0);
  expect(
    (await (await request.get(endpoint)).json()).bundle.entries.find(
      (e) => e.path === "concepts/a.md",
    ).body,
  ).toBe("# Local draft\n");
});

test("compares a real 409 and explicitly reapplies a retained canonical draft", async ({
  page,
  request,
}) => {
  const { endpoint } = await setup(page, request);
  await edit(page, "# Local conflict\n");
  await remote(request, endpoint, "# Remote conflict\n");
  await page.getByRole("button", { name: "Save concept", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Resolve bundle conflict" });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText("# Remote conflict", { exact: false }),
  ).toBeVisible();
  await expect(
    dialog.getByText("# Local conflict", { exact: false }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download my draft" }).click();
  expect((await download).suggestedFilename()).toBe("a.md");
  await dialog
    .getByRole("button", { name: "Reapply my draft to latest revision" })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(
    (await (await request.get(endpoint)).json()).bundle.entries.find(
      (e) => e.path === "concepts/a.md",
    ).body,
  ).toBe("# Local conflict\n");
});

test("refreshes clean remote edits and keeps changed-since-review distinct from historical tier", async ({
  page,
  request,
}) => {
  const { endpoint } = await setup(page, request);
  await page
    .getByRole("button", { name: "Review concept", exact: true })
    .click();
  await expect(page.locator(".okf-document-head")).toContainText(
    "Historical trust: human-reviewed",
  );
  await remote(request, endpoint, "# Changed remotely\n");
  await expect(page.locator(".okf-prose")).toContainText("Changed remotely", {
    timeout: 10000,
  });
  for (const mode of ["Tree", "List", "Health"]) {
    await page.getByRole("button", { name: mode, exact: true }).click();
    await expect(page.locator(".okf-workspace")).toContainText(
      "Changed since review",
    );
    await expect(page.locator(".okf-workspace")).toContainText(
      "Historical trust: human-reviewed",
    );
  }
  await page.getByRole("button", { name: "Tree", exact: true }).click();
  await edit(page);
  await remote(request, endpoint, "# Remote again\n");
  await expect(
    page.getByText(
      "Changes arrived from another workspace session. Your local draft is retained.",
      { exact: true },
    ),
  ).toBeVisible({ timeout: 10000 });
  await expect(
    page.getByRole("textbox", { name: "Concept body", exact: true }),
  ).toHaveValue("# Local draft\n");
});

test("resolves inline bundle images without changing canonical source or editor offsets", async ({
  page,
  request,
}) => {
  const { endpoint } = await setup(page, request, [
    {
      path: "concepts/a.md",
      source:
        "---\ntype: concept\n---\n# Original\n\n![Chart](../assets/chart.png)\n",
    },
    {
      path: "assets/chart.png",
      data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=",
    },
  ]);
  await expect(page.locator(".okf-prose img")).toHaveAttribute(
    "src",
    `${endpoint}/files?path=assets%2Fchart.png`,
  );
  await expect
    .poll(() =>
      page.locator(".okf-prose img").evaluate((img) => img.naturalWidth),
    )
    .toBe(1);
  await page.getByRole("button", { name: "Edit body", exact: true }).click();
  await expect(page.locator(".okf-concept img").first()).toHaveAttribute(
    "src",
    `${endpoint}/files?path=assets%2Fchart.png`,
  );
  expect(
    (await (await request.get(endpoint)).json()).bundle.entries.find(
      (e) => e.path === "concepts/a.md",
    ).body,
  ).toContain("../assets/chart.png");
});

test("previews rewritten source and ambiguous references and invalidates destination edits", async ({
  page,
  request,
}) => {
  await setup(page, request, [
    { path: "concepts/a.md", source: "---\ntype: concept\n---\n# Original\n" },
    {
      path: "b.md",
      source:
        "---\ntype: concept\nx-custom: concepts/a.md\n---\n[Original](concepts/a.md)\n",
    },
  ]);
  await page
    .getByRole("button", { name: "Rename or move", exact: true })
    .click();
  await page.getByLabel("New bundle path").fill("concepts/renamed.md");
  await page
    .getByRole("button", { name: "Preview rename", exact: true })
    .click();
  await expect(page.locator(".okf-change-preview")).toContainText(
    "[Original](./concepts/renamed.md)",
  );
  await expect(page.locator(".okf-change-preview")).toContainText("x-custom");
  await page.getByLabel("New bundle path").fill("concepts/unpreviewed.md");
  await expect(
    page.getByRole("button", { name: "Apply rename", exact: true }),
  ).toHaveCount(0);
});

test("keeps malformed metadata repairable in list and graph", async ({
  page,
  request,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await setup(page, request, [
    {
      path: "concepts/a.md",
      source:
        "---\ntype: {custom: value}\nstatus: {custom: value}\nsources:\n - resource: {custom: value}\n---\n# Malformed\n",
    },
  ]);
  await page.getByRole("button", { name: "List", exact: true }).click();
  await expect(page.locator(".okf-list")).toContainText("Needs type");
  await page.getByRole("button", { name: "Graph", exact: true }).click();
  await expect(page.getByRole("img", { name: /concepts and/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test("opens directory indexes inside the bundle and discovers remotely created bundles", async ({
  page,
  request,
}) => {
  await setup(page, request, [
    { path: "concepts/a.md", source: "---\ntype: concept\n---\n# Original\n" },
    { path: "concepts/index.md", source: "# Concepts\n\n[Up](../)\n" },
  ]);
  await page.getByRole("treeitem", { name: "index.md", exact: true }).click();
  await page
    .locator(".okf-prose")
    .getByRole("link", { name: "concepts", exact: true })
    .click();
  await expect(page.locator(".okf-document-head small")).toHaveText(
    "concepts/index.md",
  );
  await page
    .locator(".okf-prose")
    .getByRole("link", { name: "Up", exact: true })
    .click();
  await expect(page.locator(".okf-document-head small")).toHaveText("index.md");
  const name = `Remote bundle ${Date.now()}`;
  const created = await request.post("/api/okf/bundles", { data: { name } });
  expect(created.ok()).toBe(true);
  await expect(page.getByRole("button", { name, exact: true })).toBeVisible({
    timeout: 10000,
  });
});

test("notifies changed copied sources and guards refresh while a draft is dirty", async ({
  page,
  request,
}) => {
  const name = `Copy integrity ${Date.now()}`;
  const created = await request.post("/api/okf/bundles", {
    data: { name, sourceNoteIds: ["welcome"] },
  });
  const { bundle } = await created.json();
  await page.goto("/");
  await page.getByRole("button", { name, exact: true }).click();
  const { notes } = await (await request.get("/api/workspace")).json();
  const note = notes.find((n) => n.id === "welcome");
  const response = await request.put("/api/notes/welcome", {
    data: {
      note: { ...note, body: note.body + "\nChanged source" },
      baseRevision: note.revision,
    },
  });
  expect(response.ok()).toBe(true);
  await expect(
    page.getByRole("button", { name: "Refresh from source note", exact: true }),
  ).toBeVisible({ timeout: 10000 });
  await page.getByLabel("Description").fill("Local copy draft");
  await page
    .getByRole("button", { name: "Refresh from source note", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Save your draft before this action.",
  );
  await expect(page.getByLabel("Description")).toHaveValue("Local copy draft");
  expect(
    (
      await (await request.get(`/api/okf/bundles/${bundle.id}`)).json()
    ).bundle.entries.find((e) => e.sourceNoteId === "welcome").body,
  ).not.toContain("Changed source");
});

test("retains full-source edits when clicking the already active source tab", async ({
  page,
  request,
}) => {
  await setup(page, request);
  await edit(page, "# Body edit\n");
  await page.getByRole("button", { name: "Full source", exact: true }).click();
  const source = page.getByRole("textbox", {
    name: "Full concept source",
    exact: true,
  });
  await source.fill(
    "---\ntype: changed-type\nx-extra: retained\n---\n# Source edit\n",
  );
  await page.getByRole("button", { name: "Full source", exact: true }).click();
  await expect(source).toHaveValue(
    "---\ntype: changed-type\nx-extra: retained\n---\n# Source edit\n",
  );
});

test("follows the stable note identity when a clean selected concept is renamed remotely", async ({
  page,
  request,
}) => {
  const { endpoint, bundle } = await setup(page, request);
  const moved = await request.post(`${endpoint}/rename`, {
    data: {
      from: "concepts/a.md",
      to: "concepts/remote-name.md",
      expectedRevision: bundle.revision,
    },
  });
  expect(moved.ok()).toBe(true);
  await expect(page.locator(".okf-document-head small")).toHaveText(
    "concepts/remote-name.md",
    { timeout: 10000 },
  );
  await expect(page.locator(".okf-prose")).toContainText("Original");
});

test("locks authoring and parent navigation throughout a delayed real review response", async ({
  page,
  request,
}) => {
  const { endpoint } = await setup(page, request);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route(`**${endpoint}/review`, async (route) => {
    await gate;
    await route.continue();
  });
  try {
    await page
      .getByRole("button", { name: "Review concept", exact: true })
      .click();
    await expect(page.locator(".okf-workspace")).toHaveAttribute("inert", "");
    await page.getByRole("button", { name: "Start here", exact: true }).click();
    await expect(page.locator(".okf-workspace")).toBeVisible();
  } finally {
    release();
  }
  await expect(page.locator(".okf-document-head")).toContainText(
    "Historical trust: human-reviewed",
  );
});
