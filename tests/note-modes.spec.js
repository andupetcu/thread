import { test, expect, savedNote } from "./legacy-fixture.js";
import { ensureBlockIds } from "../src/editor-model.js";
const diagram = '```thread-diagram\n{"version":1,"nodes":[],"edges":[]}\n```';
async function prepare(request) {
  const note = await savedNote(request, "welcome");
  const body = ensureBlockIds(
    "## Welcome\n\n" + diagram + "\n\nA **formatted** paragraph.",
  );
  const result = await request.put("/api/notes/welcome", {
    data: { note: { ...note, body }, baseRevision: note.revision },
  });
  expect(result.ok()).toBe(true);
  return body;
}
test("Start here preview hides metadata and retains its real diagram and formatting", async ({
  page,
  request,
}) => {
  const body = await prepare(request);
  await page.goto("/");
  const preview = page.locator("#render-welcome");
  await expect(
    preview.getByRole("img", { name: "Empty diagram", exact: true }),
  ).toBeVisible();
  await expect(preview).not.toContainText("thread:block");
  await expect(preview.locator("strong")).toHaveText("formatted");
  expect((await savedNote(request, "welcome")).body).toBe(body);
});
test("Markdown mode keeps the existing diagram visible and editable without adding another", async ({
  page,
  request,
}) => {
  const body = await prepare(request);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Edit Markdown", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Markdown source", exact: true }),
  ).toHaveValue(body);
  await expect(
    page
      .getByRole("img", { name: "Empty diagram", exact: true })
      .filter({ visible: true }),
  ).toBeVisible();
  await page
    .locator(".source-diagrams")
    .getByRole("button", { name: "Edit diagram", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Save diagram", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add process", exact: true }).click();
  await page.getByLabel("Shape label").fill("Updated from Markdown");
  await page.getByRole("button", { name: "Save diagram", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Markdown source", exact: true }),
  ).toHaveValue(/Updated from Markdown/);
  await expect
    .poll(
      async () =>
        (
          (await savedNote(request, "welcome")).body.match(
            /```thread-diagram/g,
          ) || []
        ).length,
    )
    .toBe(1);
  await page.getByRole("button", { name: "Preview note", exact: true }).click();
  await expect(
    page.locator("#render-welcome").getByRole("img", {
      name: "Diagram: Updated from Markdown",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator("#render-welcome")).not.toContainText(
    "thread:block",
  );
  await expect
    .poll(async () => (await savedNote(request, "welcome")).body)
    .toContain("Updated from Markdown");
  const updated = await savedNote(request, "welcome");
  expect(
    [...updated.body.matchAll(/<!-- thread:block id=([^ ]+) -->/g)].map(
      (m) => m[1],
    ),
  ).toEqual(
    [...body.matchAll(/<!-- thread:block id=([^ ]+) -->/g)].map((m) => m[1]),
  );
  await page.reload();
  await expect(
    page.locator("#render-welcome").getByRole("img", {
      name: "Diagram: Updated from Markdown",
      exact: true,
    }),
  ).toBeVisible();
});
