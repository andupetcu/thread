import { test, expect } from "./legacy-fixture.js";

test("OKF diagram save stays a recoverable concept draft until Save concept", async ({
  page,
  request,
}) => {
  const created = await request.post("/api/okf/bundles", {
    data: { name: "Diagram integration" },
  });
  let { bundle } = await created.json();
  const endpoint = `/api/okf/bundles/${bundle.id}`;
  const body =
    'Before diagram\n\n```thread-diagram\n{"version":1,"nodes":[],"edges":[]}\n```\n\nAfter diagram';
  ({ bundle } = await (
    await request.post(`${endpoint}/import`, {
      data: {
        expectedRevision: bundle.revision,
        files: [
          {
            path: "guide.md",
            source: "---\ntype: Guide\nx-preserved: yes\n---\n" + body,
          },
        ],
      },
    })
  ).json());
  await page.goto("/");
  await page
    .getByRole("button", { name: "Diagram integration", exact: true })
    .click();
  await page.getByRole("treeitem", { name: "guide.md", exact: true }).click();
  await page.getByRole("button", { name: "Edit diagram", exact: true }).click();
  await page.getByRole("button", { name: "Add process", exact: true }).click();
  await page.getByLabel("Shape label", { exact: true }).fill("Concept draft");
  await page.getByRole("button", { name: "Save diagram", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Save concept", exact: true }),
  ).toBeVisible();
  const readEntry = async () =>
    (await (await request.get(endpoint)).json()).bundle.entries.find(
      (e) => e.path === "guide.md",
    );
  expect((await readEntry()).body).toBe(body);
  // The outer concept has not persisted yet; browser recovery must remain.
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
  await page.getByRole("button", { name: "Save concept", exact: true }).click();
  await expect
    .poll(async () => (await readEntry()).body)
    .toContain("Concept draft");
  const saved = await readEntry();
  expect(saved.body).toContain("Before diagram");
  expect(saved.body).toContain("After diagram");
  expect(saved.source).toContain("x-preserved: yes");
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter(
        (k) =>
          k.startsWith("thread-diagram-draft:") && !k.endsWith(":viewport"),
      ),
    ),
  ).toEqual([]);
  await page.reload();
  await page
    .getByRole("button", { name: "Diagram integration", exact: true })
    .click();
  await page.getByRole("treeitem", { name: "guide.md", exact: true }).click();
  await expect(
    page.getByAltText("Diagram: Concept draft", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit diagram", exact: true }).click();
  await expect(
    page.getByRole("alertdialog", { name: "Recover diagram draft" }),
  ).toHaveCount(0);
});
