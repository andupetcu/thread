import { test, expect } from "./legacy-fixture.js";

test("previews text assets inertly and compares complete concept source in history", async ({
  page,
  request,
}) => {
  const name = `Preview ${Date.now()}`;
  let { bundle } = await (
    await request.post("/api/okf/bundles", { data: { name } })
  ).json();
  const endpoint = `/api/okf/bundles/${bundle.id}`;
  const html =
    "<script>window.bundleExecuted = true</script><h1>Stored HTML</h1>";
  ({ bundle } = await (
    await request.post(`${endpoint}/import`, {
      data: {
        expectedRevision: bundle.revision,
        files: [
          {
            path: "guide.md",
            source: "---\ntype: Guide\nx-custom: earlier\n---\nSame body\n",
          },
          {
            path: "assets/example.html",
            data: Buffer.from(html).toString("base64"),
          },
        ],
      },
    })
  ).json());
  const updated = await request.put(`${endpoint}/documents`, {
    data: {
      path: "guide.md",
      expectedRevision: bundle.revision,
      source: "---\ntype: Guide\nx-custom: current\n---\nSame body\n",
    },
  });
  expect(updated.ok()).toBe(true);
  await page.goto("/");
  await page.getByRole("button", { name, exact: true }).last().click();
  await page
    .getByRole("treeitem", { name: "assets/example.html", exact: true })
    .click();
  await expect(page.getByLabel("Text asset preview")).toHaveText(html);
  expect(await page.evaluate(() => window.bundleExecuted)).toBeUndefined();
  await expect(page.locator(".okf-asset script")).toHaveCount(0);
  await page.getByRole("treeitem", { name: "guide.md", exact: true }).click();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page
    .locator(".okf-history")
    .getByRole("button", { name: "Compare", exact: true })
    .first()
    .click();
  const comparison = page.getByRole("dialog", {
    name: "Compare document revision",
  });
  await expect(comparison).toContainText("x-custom: earlier");
  await expect(comparison).toContainText("x-custom: current");
});
