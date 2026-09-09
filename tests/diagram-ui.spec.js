import { test, expect } from "@playwright/test";
test("visual diagram saves shapes and connectors, supports undo, and protects unsaved edits", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5173/tests/diagram-harness.html");
  await page.getByRole("button", { name: "Edit diagram", exact: true }).click();
  await page.getByRole("button", { name: "Add process", exact: true }).click();
  await page.getByLabel("Shape label").fill("First step");
  await page.getByRole("button", { name: "Add decision", exact: true }).click();
  await page.getByLabel("Shape label").fill("Ready?");
  await page.getByLabel("Connect from").selectOption({ label: "First step" });
  await page.getByLabel("Connect to").selectOption({ label: "Ready?" });
  await page
    .getByRole("button", { name: "Add connector", exact: true })
    .click();
  await page.getByRole("button", { name: "Save diagram", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  let data = JSON.parse(await page.locator("#saved").textContent());
  expect(data.nodes.map((n) => n.data.label)).toEqual(["First step", "Ready?"]);
  expect(data.edges).toHaveLength(1);
  await page.getByRole("button", { name: "Edit diagram", exact: true }).click();
  await page.getByRole("button", { name: "Add database", exact: true }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(3);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await expect(page.locator(".diagram-workspace")).toHaveAttribute("inert", "");
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await page
    .getByRole("button", { name: "Close diagram", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  await page.getByRole("button", { name: "Edit diagram", exact: true }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
});
test("drag positions undo and PNG export retains diagram content", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5173/tests/diagram-harness.html");
  await page.getByRole("button", { name: "Edit diagram", exact: true }).click();
  await page.getByLabel("Diagram template").selectOption("flow");
  const node = page.locator(".react-flow__node").first();
  const before = await node.boundingBox();
  await node.hover();
  await page.mouse.down();
  await page.mouse.move(
    before.x + before.width / 2 + 130,
    before.y + before.height / 2 + 80,
    { steps: 8 },
  );
  await page.mouse.up();
  const moved = await node.boundingBox();
  expect(moved.x).toBeGreaterThan(before.x + 50);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(3);
  await expect(node).toHaveAttribute("style", /translate\(0px, 0px\)/);
  await page.getByRole("button", { name: "Save diagram", exact: true }).click();
  const png = await page.evaluate(async () => {
    const { diagramToPng } = await import("/src/diagram/model.js");
    return diagramToPng(document.querySelector("#saved").textContent);
  });
  expect(png).toMatch(/^data:image\/png;base64,/);
  expect(png.length).toBeGreaterThan(3000);
});

test("palette drops and keyboard selection/delete work", async ({ page }) => {
  await page.goto("http://127.0.0.1:5173/tests/diagram-harness.html");
  await page.getByRole("button", { name: "Edit diagram", exact: true }).click();
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  await page
    .getByRole("button", { name: "Add database", exact: true })
    .dispatchEvent("dragstart", { dataTransfer: transfer });
  await page.locator(".diagram-canvas").dispatchEvent("drop", {
    dataTransfer: transfer,
    clientX: 600,
    clientY: 350,
  });
  await expect(page.locator(".react-flow__node")).toHaveCount(1);
  await expect(page.getByLabel("Shape label")).toHaveValue("Database");
  const node = page.locator(".react-flow__node");
  await node.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Delete");
  await expect(page.locator(".react-flow__node")).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(1);
});

test("external diagram updates require review and preserve a downloadable local draft", async ({
  page,
}, testInfo) => {
  await page.goto("http://127.0.0.1:5173/tests/diagram-harness.html");
  await page.getByRole("button", { name: "Edit diagram", exact: true }).click();
  await page.getByRole("button", { name: "Add process", exact: true }).click();
  await page.getByLabel("Shape label").fill("My unfinished draft");
  await page.evaluate(() => document.querySelector("#external-update").click());
  await page.getByRole("button", { name: "Save diagram", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toContainText(
    "Diagram changed in another session",
  );
  expect(
    JSON.parse(await page.locator("#saved").textContent()).nodes,
  ).toHaveLength(2);
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download my draft", exact: true })
    .click();
  const download = await pending;
  const file = testInfo.outputPath("diagram-draft.json");
  await download.saveAs(file);
  const { readFileSync } = await import("node:fs");
  expect(JSON.parse(readFileSync(file, "utf8")).nodes[0].data.label).toBe(
    "My unfinished draft",
  );
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(page.getByLabel("Shape label")).toHaveValue(
    "My unfinished draft",
  );
  await page.getByRole("button", { name: "Save diagram", exact: true }).click();
  await page
    .getByRole("button", { name: "Replace with my diagram", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    JSON.parse(await page.locator("#saved").textContent()).nodes[0].data.label,
  ).toBe("My unfinished draft");
});
