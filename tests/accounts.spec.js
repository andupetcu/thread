import { test, expect } from "./legacy-fixture.js";
test("admin creates accounts and revocable MCP keys; users get shared notes without admin controls", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Workspace settings", exact: true })
    .click();
  await page.getByRole("button", { name: "Users", exact: true }).click();
  await page.getByLabel("New username", { exact: true }).fill("editor");
  await page
    .getByLabel("Temporary password", { exact: true })
    .fill("editor-test-password");
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  await expect(
    page.locator(".account-row").filter({ hasText: "editor" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "MCP", exact: true }).click();
  await page.getByLabel("Key name", { exact: true }).fill("Test assistant");
  await page
    .getByRole("button", { name: "Create agent key", exact: true })
    .click();
  await expect(page.getByLabel("New agent key", { exact: true })).toHaveValue(
    /^[A-Za-z0-9_-]{43}$/,
  );
  await expect(
    page.getByLabel("MCP configuration", { exact: true }),
  ).toContainText("server/mcp.mjs");
  const row = page
    .locator(".mcp-key-row")
    .filter({ hasText: "Test assistant" });
  await row.getByRole("button", { name: "Revoke" }).click();
  await expect(row).toHaveCount(0);
  await page
    .getByRole("button", { name: "Close workspace settings", exact: true })
    .click();
  // Do not invalidate the worker fixture's admin session.
  await page.context().clearCookies();
  await page.reload();
  await page.getByLabel("Username", { exact: true }).fill("editor");
  await page
    .getByLabel("Workspace password", { exact: true })
    .fill("editor-test-password");
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Lock", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Delete note", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Workspace settings", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Users", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "MCP", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Password", exact: true }),
  ).toBeVisible();
});

test("reauthentication retains the account identity and refreshes its changed role", async ({
  page,
  request,
}) => {
  const response = await request.post("/api/users", {
    data: {
      username: "role-test",
      password: "role-test-password",
      role: "user",
    },
  });
  expect(response.status()).toBe(201);
  const { user } = await response.json();
  await page.context().clearCookies();
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("role-test");
  await page
    .getByLabel("Workspace password", { exact: true })
    .fill("role-test-password");
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Lock", exact: true }),
  ).toBeVisible();
  expect(
    (
      await request.patch("/api/users/" + user.id, { data: { role: "admin" } })
    ).status(),
  ).toBe(200);
  const dialog = page.getByRole("dialog", {
    name: "Unlock to continue saving",
  });
  await expect(dialog).toBeVisible({ timeout: 10000 });
  await expect(dialog).toContainText("role-test");
  await dialog
    .getByLabel("Workspace password", { exact: true })
    .fill("role-test-password");
  await dialog.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Delete note", exact: true }).first(),
  ).toBeVisible();
});
