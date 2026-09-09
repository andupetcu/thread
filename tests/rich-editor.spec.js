import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.goto("http://127.0.0.1:5173/tests/rich-editor-harness.html");
});
test("formatted editing, Markdown source and stable block suggestions", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Edit block 1", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "Rich block text" });
  await expect(editor.locator("strong")).toHaveText("paragraph");
  await editor.press("End");
  await editor.press("Space");
  await editor.pressSequentially("@decision");
  await page
    .getByRole("button", { name: /Project · A stable decision Block/ })
    .click();
  await expect(page.getByTestId("markdown")).toContainText(
    "(block:n2/decision)",
  );
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Block Markdown" }),
  ).toContainText("@[Project");
  await page.getByRole("button", { name: "Done editing block" }).click();
  await expect(page.locator("[data-block-id]")).toHaveCount(2);
});
test("slash commands insert rich structures and drag reorder retains IDs", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Add block", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "Rich block text" });
  await editor.pressSequentially("/heading");
  await page.getByRole("listbox").getByRole("button").first().click();
  await expect(editor.locator("h1,h2,h3")).toBeVisible();
  await page.getByRole("button", { name: "Done editing block" }).click();
  const id = await page
    .locator(".document-block")
    .first()
    .getAttribute("data-block-id");
  await page
    .getByRole("button", { name: "Block 1 actions", exact: true })
    .dragTo(page.locator(".document-block").nth(1));
  await expect(page.locator(".document-block").nth(1)).toHaveAttribute(
    "data-block-id",
    id,
  );
  await expect(page.locator(".document-block").nth(1)).toContainText(
    "First paragraph.",
  );
});
test("uploads a pasted image and stores a portable asset URL", async ({
  page,
}) => {
  await page.route("**/api/assets", async (route) => {
    expect(route.request().headers()["x-thread-request"]).toBe("1");
    expect(route.request().headers()["x-filename"]).toBe("pasted.png");
    await route.fulfill({
      json: {
        url: "/api/assets/image-1",
        name: "pasted.png",
        mime: "image/png",
      },
    });
  });
  await page.getByRole("button", { name: "Edit block 1", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Rich block text" })
    .evaluate((el) => {
      const data = new DataTransfer();
      data.items.add(
        new File([new Uint8Array([137, 80, 78, 71])], "pasted.png", {
          type: "image/png",
        }),
      );
      el.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
  await expect(page.getByTestId("markdown")).toContainText(
    "![pasted.png](/api/assets/image-1)",
  );
});
