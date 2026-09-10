import { test, expect } from "./legacy-fixture.js";
import { defaultMindMap } from "../src/mindmap/model.js";

test("OKF mind-map draft saves with concept metadata and clears only persisted recovery", async ({
  page,
  request,
}) => {
  let { bundle } = await (
    await request.post("/api/okf/bundles", {
      data: { name: "Mind map knowledge" },
    })
  ).json();
  const endpoint = `/api/okf/bundles/${bundle.id}`;
  const body =
    "Before\n\n```thread-mindmap\n" +
    JSON.stringify(defaultMindMap()) +
    "\n```\n\nAfter";
  const imported = await request.post(endpoint + "/import", {
    data: {
      expectedRevision: bundle.revision,
      files: [
        {
          path: "ideas.md",
          source: "---\ntype: Guide\nx-kept: yes\n---\n" + body,
        },
      ],
    },
  });
  expect(imported.ok()).toBe(true);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Mind map knowledge", exact: true })
    .click();
  await page.getByRole("treeitem", { name: "ideas.md", exact: true }).click();
  await page
    .getByRole("button", { name: "Edit mind map", exact: true })
    .click();
  await page
    .getByLabel("Import Markdown", { exact: true })
    .fill("# Research questions\n- Evidence\n- Next steps");
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
    .getByRole("button", { name: "Save mind map", exact: true })
    .click();
  const read = async () =>
    (await (await request.get(endpoint)).json()).bundle.entries.find(
      (e) => e.path === "ideas.md",
    );
  expect((await read()).body).toBe(body);
  await expect(
    page.getByRole("button", { name: "Save concept", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Object.keys(localStorage).filter(
            (k) =>
              k.startsWith("thread-mindmap-draft:") && !k.endsWith(":viewport"),
          ).length,
      ),
    )
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "Save concept", exact: true }).click();
  await expect
    .poll(async () => (await read()).body)
    .toContain("Research questions");
  expect((await read()).source).toContain("x-kept: yes");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Object.keys(localStorage).filter(
            (k) =>
              k.startsWith("thread-mindmap-draft:") && !k.endsWith(":viewport"),
          ).length,
      ),
    )
    .toBe(0);
  await page.reload();
  await page
    .getByRole("button", { name: "Mind map knowledge", exact: true })
    .click();
  await page.getByRole("treeitem", { name: "ideas.md", exact: true }).click();
  await expect(
    page.getByAltText("Saved mind map preview", { exact: true }),
  ).toBeVisible();
});

test("mind-map bundle and OKF note references navigate to their actual workspace content", async ({
  page,
  request,
}) => {
  let { bundle } = await (
    await request.post("/api/okf/bundles", {
      data: { name: "Linked knowledge" },
    })
  ).json();
  ({ bundle } = await (
    await request.post(`/api/okf/bundles/${bundle.id}/import`, {
      data: {
        expectedRevision: bundle.revision,
        files: [
          {
            path: "target.md",
            source: "---\ntype: Guide\n---\n# Linked concept target",
          },
        ],
      },
    })
  ).json());
  const target = bundle.entries.find((e) => e.path === "target.md");
  const current = (
    await (await request.get("/api/workspace")).json()
  ).notes.find((n) => n.id === "welcome");
  let map = defaultMindMap();
  map.references = [
    {
      id: "r",
      label: "Open knowledge",
      link: { kind: "bundle", bundleId: bundle.id },
    },
  ];
  const body = "```thread-mindmap\n" + JSON.stringify(map) + "\n```";
  const saved = await request.put("/api/notes/welcome", {
    data: { note: { ...current, body }, baseRevision: current.revision },
  });
  expect(saved.ok()).toBe(true);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Open knowledge ↗", exact: true })
    .click();
  await expect(
    page.getByRole("treeitem", { name: "target.md", exact: true }),
  ).toBeVisible();
  const latest = (
    await (await request.get("/api/workspace")).json()
  ).notes.find((n) => n.id === "welcome");
  map.references = [
    {
      id: "r",
      label: "Open concept",
      link: { kind: "concept", noteId: target.noteId, bundleId: bundle.id },
    },
  ];
  expect(
    (
      await request.put("/api/notes/welcome", {
        data: {
          note: {
            ...latest,
            body: "```thread-mindmap\n" + JSON.stringify(map) + "\n```",
          },
          baseRevision: latest.revision,
        },
      })
    ).ok(),
  ).toBe(true);
  await page
    .getByRole("button", { name: "All notes", exact: false })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "Open concept ↗", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Open concept ↗", exact: true })
    .click();
  await expect(
    page
      .locator("article")
      .getByRole("heading", { name: "Linked concept target", exact: true }),
  ).toBeVisible();
});

test("an unavailable bundle reference reports an error without navigating to another API resource", async ({
  page,
  request,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const current = (
    await (await request.get("/api/workspace")).json()
  ).notes.find((n) => n.id === "welcome");
  const map = {
    ...defaultMindMap(),
    references: [
      {
        id: "r",
        label: "Unavailable reference",
        link: { kind: "bundle", bundleId: "../settings" },
      },
    ],
  };
  expect(
    (
      await request.put("/api/notes/welcome", {
        data: {
          note: {
            ...current,
            body: "```thread-mindmap\n" + JSON.stringify(map) + "\n```",
          },
          baseRevision: current.revision,
        },
      })
    ).ok(),
  ).toBe(true);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Unavailable reference ↗", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(/not found/i);
  await page
    .getByRole("button", { name: "All notes", exact: false })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "Edit mind map", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
