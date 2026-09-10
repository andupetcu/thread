import { test, expect } from "@playwright/test";
import { importDrawio } from "./native-diagram-helpers.js";
test("local draw.io imports native XML, edits shapes, saves preview and exports source", async ({
  page,
}) => {
  const external = [];
  page.on("request", (r) => {
    if (
      /^https?:/.test(r.url()) &&
      !r.url().startsWith("http://127.0.0.1:5173")
    )
      external.push(r.url());
  });
  await page.goto("http://127.0.0.1:5173/tests/diagram-harness.html");
  await page.getByRole("button", { name: "Edit diagram", exact: true }).click();
  await importDrawio(page, "Native process");
  const editor = page.frameLocator('iframe[title="draw.io diagram editor"]');
  await expect(editor.locator(".geDiagramContainer")).toContainText(
    "Native process",
  );
  await page.getByRole("button", { name: "Save diagram", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Edit diagram", exact: true }),
  ).toHaveCount(0, { timeout: 30000 });
  const data = JSON.parse(await page.locator("#saved").textContent());
  expect(data.engine).toBe("drawio");
  expect(data.xml).toContain("Native process");
  expect(data.preview).toMatch(/^data:image\/png;base64,/);
  await expect(
    page.getByAltText("Diagram preview", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit diagram", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Save diagram", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "References and library", exact: true })
    .click();
  const wait = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export .drawio", exact: true })
    .click();
  expect((await wait).suggestedFilename()).toBe("diagram.drawio");
  expect(external).toEqual([]);
});
test("draw.io recovery and remote conflicts require explicit choices", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5173/tests/diagram-harness.html");
  await page.getByRole("button", { name: "Edit diagram", exact: true }).click();
  await importDrawio(page, "Unfinished");
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("thread-diagram-draft:harness")),
    )
    .toContain("Unfinished");
  await page.reload();
  await page.getByRole("button", { name: "Edit diagram", exact: true }).click();
  await expect(
    page.getByRole("alertdialog", { name: "Recover diagram draft" }),
  ).toBeVisible();
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.locator("#saved")).toBeEmpty();
  await page
    .getByRole("button", { name: "Recover draft", exact: true })
    .click();
  await expect(
    page.frameLocator("iframe").locator(".geDiagramContainer"),
  ).toContainText("Unfinished");
  await page.evaluate(() => document.querySelector("#external-update").click());
  await expect(
    page.getByRole("alertdialog", { name: "Diagram conflict" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save diagram", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Keep my draft", exact: true })
    .click();
  await page.getByRole("button", { name: "Save diagram", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Edit diagram", exact: true }),
  ).toHaveCount(0, { timeout: 30000 });
  expect(JSON.parse(await page.locator("#saved").textContent()).xml).toContain(
    "Unfinished",
  );
});
test("native shape text edits update recoverable source before Save", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:5173/tests/diagram-harness.html");
  await page.getByRole("button", { name: "Edit diagram", exact: true }).click();
  await importDrawio(page, "Edit this shape");
  const editor = page.frameLocator("iframe");
  await editor
    .locator(".geDiagramContainer")
    .getByText("Edit this shape", { exact: true })
    .dblclick();
  await editor.locator(".mxCellEditor").fill("Typed in draw.io");
  await editor
    .locator(".geDiagramContainer")
    .click({ position: { x: 20, y: 20 } });
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("thread-diagram-draft:harness")),
    )
    .toContain("Typed in draw.io");
  expect(errors).toEqual([]);
  await page.getByRole("button", { name: "Save diagram", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Edit diagram", exact: true }),
  ).toHaveCount(0);
  expect(JSON.parse(await page.locator("#saved").textContent()).xml).toContain(
    "Typed in draw.io",
  );
});
test("Save includes text still being edited inside the native iframe", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5173/tests/diagram-harness.html");
  await page.getByRole("button", { name: "Edit diagram", exact: true }).click();
  await importDrawio(page, "Original text");
  const editor = page.frameLocator("iframe");
  await editor
    .locator(".geDiagramContainer")
    .getByText("Original text", { exact: true })
    .dblclick();
  await editor.locator(".mxCellEditor").fill("Still typing at save");
  await page.getByRole("button", { name: "Save diagram", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Edit diagram", exact: true }),
  ).toHaveCount(0);
  expect(JSON.parse(await page.locator("#saved").textContent()).xml).toContain(
    "Still typing at save",
  );
});
test("invalid native autosave reports an error without losing the editable canvas", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:5173/tests/diagram-harness.html");
  await page.getByRole("button", { name: "Edit diagram", exact: true }).click();
  await importDrawio(page, "Keep valid draft");
  await page
    .frameLocator("iframe")
    .locator("body")
    .evaluate(() =>
      parent.postMessage(
        JSON.stringify({
          event: "autosave",
          xml: "<mxGraphModel><script>bad()</script></mxGraphModel>",
        }),
        location.origin,
      ),
    );
  await expect(page.getByRole("alert").first()).toContainText(
    /Invalid visual document/,
  );
  await expect(
    page.getByRole("button", { name: "Save diagram", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
