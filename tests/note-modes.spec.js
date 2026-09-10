import { defaultDiagram } from "../src/diagram/model.js";
import { importDrawio } from "./native-diagram-helpers.js";
import { test, expect, savedNote } from "./legacy-fixture.js";
import { ensureBlockIds } from "../src/editor-model.js";
const diagram =
  "```thread-diagram\n" +
  JSON.stringify({
    ...defaultDiagram(),
    preview:
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=",
  }) +
  "\n```";
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
    preview.getByRole("img", { name: "Diagram preview", exact: true }),
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
  ).toHaveCount(0);
  await expect(page.locator(".block-editor")).not.toContainText(
    "data:image/png;base64",
  );
  expect((await savedNote(request, "welcome")).body).toBe(body);
  await expect(
    page
      .getByRole("img", { name: "Diagram preview", exact: true })
      .filter({ visible: true }),
  ).toBeVisible();
  await page
    .locator(".block-editor")
    .getByRole("button", { name: "Edit diagram", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Save diagram", exact: true }),
  ).toBeVisible();
  await importDrawio(page, "Updated from Markdown");
  await page.getByRole("button", { name: "Save diagram", exact: true }).click();
  await page.getByRole("button", { name: "Code edit", exact: true }).click();
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
      name: "Diagram preview",
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
      name: "Diagram preview",
      exact: true,
    }),
  ).toBeVisible();
});

test("visual blocks expose code only on request and preserve payloads while prose changes", async ({
  page,
  request,
}) => {
  const original = await savedNote(request, "welcome");
  const legacy =
    '```thread-mindmap\n{"version":1,"rootId":"root","nodes":[{"id":"root","label":"Keep this"}]}\n```';
  const native =
    '```thread-mindmap\n{"version":2,"engine":"drawnix","elements":[],"references":[]}\n```';
  const body = ensureBlockIds(
    "Before\n\n" + diagram + "\n\n" + legacy + "\n\n" + native + "\n\nAfter",
  );
  expect(
    (
      await request.put("/api/notes/welcome", {
        data: { note: { ...original, body }, baseRevision: original.revision },
      })
    ).ok(),
  ).toBe(true);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Edit Markdown", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Markdown source", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".block-editor")).not.toContainText('"version"');
  // Ordinary prose editing must leave both legacy and native payloads intact.
  await page.getByRole("button", { name: "Edit block 1", exact: true }).click();
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Block Markdown", exact: true })
    .fill("Changed prose");
  await page
    .getByRole("button", { name: "Done editing block", exact: true })
    .click();
  await expect
    .poll(async () => (await savedNote(request, "welcome")).body)
    .toBe(body.replace("Before", "Changed prose"));
  for (const [index, value] of [
    [2, diagram],
    [3, legacy],
    [4, native],
  ]) {
    await page
      .getByRole("button", { name: `Edit block ${index}`, exact: true })
      .click();
    await expect(
      page.getByRole("textbox", { name: "Block Markdown", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("group", { name: "Block editing mode", exact: true })
      .getByRole("button", { name: "Code edit", exact: true })
      .click();
    await expect(
      page.getByRole("textbox", { name: "Block Markdown", exact: true }),
    ).toHaveValue(value);
    await page
      .getByRole("button", { name: "Done editing block", exact: true })
      .click();
  }
});
