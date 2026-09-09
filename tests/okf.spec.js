import { test, expect } from "./legacy-fixture.js";

async function createCopiedBundle(request, name) {
  const response = await request.post("/api/okf/bundles", {
    data: { name, sourceNoteIds: ["welcome"] },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()).bundle;
}

test("creates from selected notes and explicitly saves body and metadata without leakage", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(
    page.getByText("Knowledge bundles", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Create knowledge bundle" }).click();
  await page.getByLabel("Bundle name").fill("Research notes");
  await page.getByLabel("Copy selected notes").check();
  await page.getByRole("checkbox", { name: "Start here" }).check();
  await page
    .getByRole("button", { name: "Create from selected notes" })
    .click();
  const listing = await request.get("/api/okf/bundles");
  const summary = (await listing.json()).bundles.find(
    (item) => item.name === "Research notes",
  );
  const detail = await request.get(`/api/okf/bundles/${summary.id}`);
  const created = (await detail.json()).bundle;
  const concept = created.entries.find(
    (entry) => entry.metadata?.type === "concept",
  );
  await page.getByRole("treeitem", { name: concept.path }).click();
  await expect(page.locator(".okf-prose")).not.toContainText("type: concept");
  await page.screenshot({ path: "/tmp/thread-okf-editor.png", fullPage: true });
  await page.getByRole("button", { name: "Edit body" }).click();
  await page
    .getByRole("textbox", { name: "Concept body" })
    .fill("## Authentication\n\nUpdated guidance.");
  await page.getByLabel("Description").fill("Token policy");
  await page.getByRole("button", { name: "Save concept" }).click();
  await expect(page.getByRole("button", { name: "Save concept" })).toHaveCount(
    0,
  );
  const persisted = await request.get(`/api/okf/bundles/${summary.id}`);
  const saved = (await persisted.json()).bundle.entries.find(
    (entry) => entry.path === concept.path,
  );
  expect(saved.body).toBe("## Authentication\n\nUpdated guidance.");
  expect(saved.metadata.description).toBe("Token policy");
  expect(saved.source).toContain("type: concept");
  expect(saved.body).not.toContain("type: concept");
  await page.getByRole("button", { name: "Full source" }).click();
  const sourceEditor = page.getByRole("textbox", {
    name: "Full concept source",
  });
  await sourceEditor.fill(
    (await sourceEditor.inputValue()).replace(
      "type: concept",
      "type: concept\nx-private: remove-me",
    ),
  );
  await page.getByRole("button", { name: "Save concept" }).click();
  await page.getByRole("button", { name: "Full source" }).click();
  await sourceEditor.fill(
    (await sourceEditor.inputValue()).replace("x-private: remove-me\n", ""),
  );
  await page.getByRole("button", { name: "Body", exact: true }).click();
  await page.getByRole("button", { name: "Edit body" }).click();
  await page
    .getByRole("textbox", { name: "Concept body" })
    .fill("## Authentication\n\nDeletion retained.");
  await page.getByRole("button", { name: "Save concept" }).click();
  const afterDeletion = await request.get(`/api/okf/bundles/${summary.id}`);
  expect(
    (await afterDeletion.json()).bundle.entries.find(
      (item) => item.path === concept.path,
    ).source,
  ).not.toContain("x-private");
  await page.reload();
  await page
    .getByRole("button", { name: "Research notes", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Authentication", level: 2 }),
  ).toBeVisible();
});

test("uses real revisions for source, rename, review, index, graph, and history", async ({
  page,
  request,
}) => {
  const bundle = await createCopiedBundle(request, "Platform handbook");
  const concept = bundle.entries.find(
    (entry) => entry.metadata?.type === "concept",
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "Platform handbook", exact: true })
    .click();
  await page.getByRole("treeitem", { name: concept.path }).click();
  await page.getByRole("button", { name: "Full source" }).click();
  await expect(
    page.getByRole("textbox", { name: "Full concept source" }),
  ).toContainText("type: concept");
  await page.getByRole("button", { name: "Body", exact: true }).click();
  await page.getByRole("button", { name: "Edit body" }).click();
  await page
    .getByRole("textbox", { name: "Concept body" })
    .fill("# Start here\n\nSee [the index](./index.md).\n");
  await page.getByRole("button", { name: "Save concept" }).click();
  await page.getByRole("button", { name: "History" }).click();
  await expect(page.getByText(/Revision \d/).first()).toBeVisible();
  await page.getByRole("button", { name: "Rename or move" }).click();
  await page.getByLabel("New bundle path").fill("concepts/start.md");
  await page.getByRole("button", { name: "Preview rename" }).click();
  await page.getByRole("button", { name: "Apply rename" }).click();
  await expect(
    page.getByText("concepts/start.md", { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Review concept" }).click();
  await page.getByRole("button", { name: "Manage index" }).click();
  await expect(
    page.getByRole("dialog", { name: "Manage index" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close index preview" }).click();
  await page.getByRole("button", { name: "Graph", exact: true }).click();
  await expect(
    page.getByRole("img", { name: /concepts and \d+ relationships/ }),
  ).toBeVisible();
  await page.screenshot({ path: "/tmp/thread-okf-graph.png", fullPage: true });
  const persisted = await request.get(`/api/okf/bundles/${bundle.id}`);
  const current = (await persisted.json()).bundle;
  const renamed = current.entries.find(
    (entry) => entry.path === "concepts/start.md",
  );
  expect(renamed).toBeTruthy();
  expect(renamed.metadata.verified.length).toBeGreaterThan(0);
});

test("bundle-owned documents stay out of the ordinary notes workspace", async ({
  page,
  request,
}) => {
  await createCopiedBundle(request, "Sidebar isolation");
  await page.goto("/");
  await expect(page.locator(".note-list .note-link")).toHaveCount(7);
  await expect(page.getByRole("button", { name: "All notes" })).toContainText(
    "7",
  );
  await expect(
    page.getByRole("button", { name: "Sidebar isolation" }),
  ).toBeVisible();
});
