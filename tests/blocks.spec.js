import {
  test,
  expect,
  savedNote,
  waitForSaved,
  blockSource,
} from "./legacy-fixture.js";
test("block editing persists, keeps fenced code intact, and supports actions with undo", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Edit Markdown", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Markdown source" })
    .fill(
      "## Plan\n\nOriginal paragraph.\n\n```md\n# Code heading\n\nkeep this\n```",
    );
  await page.getByRole("button", { name: "Edit blocks", exact: true }).click();
  await expect(page.locator(".document-block")).toHaveCount(3);
  await page.getByRole("button", { name: "Edit block 2", exact: true }).click();
  await blockSource(page);
  await page
    .getByRole("textbox", { name: "Block Markdown" })
    .fill("Revised **paragraph**.");
  await page.getByRole("button", { name: "Done editing block" }).click();
  await expect(page.locator(".document-block").nth(1)).toContainText(
    "Revised paragraph.",
  );
  await page
    .getByRole("button", { name: "Block 2 actions", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Duplicate block", exact: true })
    .click();
  await expect(page.locator(".document-block")).toHaveCount(4);
  await page
    .getByRole("button", { name: "Undo block action", exact: true })
    .click();
  await expect(page.locator(".document-block")).toHaveCount(3);
  await page
    .getByRole("button", { name: "Block 2 actions", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Move block up", exact: true })
    .click();
  await expect(page.locator(".document-block").first()).toContainText(
    "Revised paragraph.",
  );
  await waitForSaved(page);
  await page.reload();
  await page
    .getByRole("button", { name: "Edit Markdown", exact: true })
    .click();
  const { parseBlocks } = await import("../src/editor-model.js");
  const saved = await page
    .getByRole("textbox", { name: "Markdown source" })
    .inputValue();
  expect(parseBlocks(saved).map((b) => b.source)).toEqual([
    "Revised **paragraph**.",
    "## Plan",
    "```md\n# Code heading\n\nkeep this\n```",
  ]);
  expect(parseBlocks(saved).every((b) => b.id)).toBe(true);
});
test("outline navigates headings and references open beside the active note", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("complementary", { name: "Document context" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Go to Today’s checklist", exact: true })
    .click();
  await expect(
    page.locator(".prose h3").filter({ hasText: "Today’s checklist" }),
  ).toBeInViewport();
  await page.getByRole("button", { name: "References", exact: true }).click();
  await expect(page.locator(".context-panel")).toContainText(
    "Platform roadmap",
  );
  await page
    .getByRole("button", { name: "Open Platform roadmap beside", exact: true })
    .click();
  await expect(page.locator(".note-pane")).toHaveCount(2);
  await expect(page.getByLabel("Note in panel 2")).toHaveValue("roadmap");
  await page.getByRole("button", { name: "Outline", exact: true }).click();
  await expect(page.locator(".context-panel")).toContainText(
    "Building the next chapter",
  );
});
test("block autocomplete inserts templates and mentions", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Edit blocks", exact: true }).click();
  await page.getByRole("button", { name: "Add block", exact: true }).click();
  await blockSource(page);
  let field = page.getByRole("textbox", { name: "Block Markdown" });
  await field.fill("/PRD");
  await page.getByRole("button", { name: "PRD Product", exact: true }).click();
  await expect(field).toHaveValue(/## Problem/);
  await page.getByRole("button", { name: "Done editing block" }).click();
  await page.getByRole("button", { name: "Add block", exact: true }).click();
  await blockSource(page);
  field = page.getByRole("textbox", { name: "Block Markdown" });
  await field.fill("@Auth");
  await page
    .getByRole("button", { name: "Authentication API Note", exact: true })
    .click();
  await expect(field).toHaveValue(/note:api/);
  await page.getByRole("button", { name: "Done editing block" }).click();
  await expect(page.locator(".block-editor .mention").last()).toContainText(
    "Authentication API",
  );
});

test("outline finishes active block editing and dock adapts to mobile", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Edit blocks", exact: true }).click();
  await page.getByRole("button", { name: "Edit block 2", exact: true }).click();
  await blockSource(page);
  await page
    .getByRole("textbox", { name: "Block Markdown" })
    .fill("Changed paragraph with a different length.");
  await page
    .getByRole("button", { name: "Go to Today’s checklist", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Block Markdown" }),
  ).toHaveCount(0);
  await expect(
    page.locator(".block-editor h3").filter({ hasText: "Today’s checklist" }),
  ).toBeInViewport();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Toggle sidebar", exact: true })
    .click();
  await expect(
    page.getByRole("complementary", { name: "Document context" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Toggle document context", exact: true })
    .click();
  await expect(
    page.getByRole("complementary", { name: "Document context" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Close document context", exact: true })
    .click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("moving the caret dismisses stale block autocomplete", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Edit blocks", exact: true }).click();
  await page.getByRole("button", { name: "Edit block 2", exact: true }).click();
  await blockSource(page);
  const field = page.getByRole("textbox", { name: "Block Markdown" });
  await field.fill("Original text @Auth");
  await expect(
    page.getByRole("button", { name: "Authentication API Note", exact: true }),
  ).toBeVisible();
  await field.press("Home");
  await field.press("Enter");
  await expect(field).not.toHaveValue(/note:api/);
});
