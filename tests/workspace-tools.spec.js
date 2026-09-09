import { test, expect } from "@playwright/test";
async function setup(page, mode) {
  const shell = await (await page.request.get("http://127.0.0.1:5173/")).text();
  await page.route("**/workspace-tools-test?*", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: shell.replace(
        /src="\/src\/main\.jsx[^\"]*"/,
        'src="/tests/workspace-tools-harness.jsx"',
      ),
    }),
  );
  await page.goto(`http://127.0.0.1:5173/workspace-tools-test?mode=${mode}`);
}
test("table edits properties, creates fields, and restores saved filter views", async ({
  page,
}) => {
  await setup(page, "table");
  await page
    .getByLabel("API status", { exact: true })
    .selectOption("In progress");
  await page.getByLabel("API owner", { exact: true }).fill("Grace");
  await page.getByLabel("API owner", { exact: true }).press("Tab");
  await page.getByRole("button", { name: "Add property", exact: true }).click();
  await page.getByLabel("Property name", { exact: true }).fill("release");
  await page
    .getByRole("button", { name: "Create property", exact: true })
    .click();
  await page.getByLabel("API release", { exact: true }).fill("v2");
  await page.getByLabel("API release", { exact: true }).press("Tab");
  await page.getByRole("button", { name: "Add filter", exact: true }).click();
  await page.getByLabel("Filter 1 field").selectOption("owner");
  await page.getByLabel("Filter 1 value").fill("Grace");
  await page.getByLabel("View name", { exact: true }).fill("My work");
  await page.getByRole("button", { name: "Save view", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.reload();
  await expect(page.getByLabel("API release", { exact: true })).toHaveValue(
    "v2",
  );
  await expect(page.locator("tbody tr")).toHaveCount(1);
});
test("graph supports shared tags, neighborhoods, keyboard positioning and opening notes", async ({
  page,
}) => {
  await setup(page, "graph");
  await expect(
    page.getByLabel("Relationship graph", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Shared tag connections", { exact: true }).check();
  await page
    .getByLabel("Neighborhood center", { exact: true })
    .selectOption("a");
  await expect(page.getByLabel("Graph summary")).toContainText("2 notes");
  await page.getByRole("button", { name: "Inspect API", exact: true }).click();
  await page
    .getByRole("button", { name: "Move selected node right", exact: true })
    .click();
  const positions = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("workspace-tools-test")).settings
        .graphPositions,
  );
  expect(positions.a.x).toEqual(expect.any(Number));
  await page
    .getByRole("button", { name: "Open selected note", exact: true })
    .click();
  await expect(page.getByLabel("Opened note")).toHaveText("a");
});
test("comparison aligns words, navigates changes, and synchronizes scrolling", async ({
  page,
}) => {
  await setup(page, "diff");
  await expect(page.locator(".wt-diff-column")).toHaveCount(3);
  await expect(
    page.locator(".wt-diff-column").nth(1).locator("mark").first(),
  ).toContainText("Changed");
  await page.getByRole("button", { name: "Next change", exact: true }).click();
  await page.getByRole("button", { name: "Next change", exact: true }).click();
  await expect(page.getByLabel("Change position")).toContainText("2 of 2");
  const scrolls = await page
    .locator(".wt-diff-scroll")
    .evaluateAll((nodes) => nodes.map((n) => n.scrollTop));
  expect(scrolls[0]).toBeGreaterThan(100);
  expect(Math.max(...scrolls) - Math.min(...scrolls)).toBeLessThan(2);
  await page
    .locator(".wt-diff-scroll")
    .nth(1)
    .evaluate((el) => {
      el.scrollTop = 120;
      el.dispatchEvent(new Event("scroll"));
    });
  await expect
    .poll(() =>
      page
        .locator(".wt-diff-scroll")
        .first()
        .evaluate((el) => el.scrollTop),
    )
    .toBe(120);
});
test("graph drag positions survive reload and remain pinned", async ({
  page,
}) => {
  await setup(page, "graph");
  await page.getByRole("button", { name: "Inspect API", exact: true }).click();
  await page
    .getByRole("button", { name: "Move selected node right", exact: true })
    .click();
  await page.getByRole("button", { name: "Inspect API", exact: true }).click();
  const before = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("workspace-tools-test")).settings
        .graphPositions.a,
  );
  const rect = await page
    .getByLabel("Relationship graph", { exact: true })
    .boundingBox();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    rect.x + rect.width / 2 + 80,
    rect.y + rect.height / 2 + 30,
    { steps: 5 },
  );
  await page.mouse.up();
  const after = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("workspace-tools-test")).settings
        .graphPositions.a,
  );
  expect(after.x).toBeGreaterThan(before.x + 20);
  expect(after.pinned).toBe(true);
  await page.reload();
  await expect(
    page.getByLabel("Relationship graph", { exact: true }),
  ).toBeVisible();
  const restored = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("workspace-tools-test")).settings
        .graphPositions.a,
  );
  expect(restored).toEqual(after);
});
test("five thousand notes remain searchable and inspectable in the graph", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "workspace-tools-test",
      JSON.stringify({
        notes: Array.from({ length: 5000 }, (_, i) => ({
          id: `large-${i}`,
          title: `Scale ${i}`,
          body: `#common\n${i ? `@[Previous](note:large-${i - 1})` : ""}`,
          properties: {},
        })),
        settings: { graphTags: true },
      }),
    ),
  );
  const start = Date.now();
  await setup(page, "graph");
  await expect(page.getByLabel("Graph summary")).toContainText("5000 notes");
  await page.getByLabel("Find graph note").fill("Scale 4999");
  await page
    .getByRole("button", { name: "Inspect Scale 4999", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open selected note", exact: true })
    .click();
  await expect(page.getByLabel("Opened note")).toHaveText("large-4999");
  test
    .info()
    .annotations.push({
      type: "benchmark",
      description: `5000-node load, search, inspect, open: ${Date.now() - start} ms`,
    });
});
