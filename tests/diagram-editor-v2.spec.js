import { test, expect, savedNote } from "./legacy-fixture.js";
import { nativeDiagram, importDrawio } from "./native-diagram-helpers.js";
async function prepare(page, request, label) {
  const note = await savedNote(request, "welcome");
  const body =
    "```thread-diagram\n" + JSON.stringify(nativeDiagram(label)) + "\n```";
  const result = await request.put("/api/notes/welcome", {
    data: { note: { ...note, body }, baseRevision: note.revision },
  });
  expect(result.ok()).toBe(true);
  await page.goto("/");
  await page.getByRole("button", { name: "Edit diagram", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Save diagram", exact: true }),
  ).toBeEnabled();
}
test("native diagram references and shared templates save with the note", async ({
  page,
  request,
}) => {
  await prepare(page, request, "Shared native template");
  await page
    .getByRole("button", { name: "References and library", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Reference target", exact: true })
    .selectOption("api");
  await page
    .getByRole("button", { name: "Add reference", exact: true })
    .click();
  await page
    .getByLabel("Template name", { exact: true })
    .fill("Native architecture");
  await page
    .getByRole("button", { name: "Save template", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Saved template", exact: true }).locator("option"),
  ).toContainText(["Choose…", "Native architecture"]);
  await page.getByRole("button", { name: "Save diagram", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Edit diagram", exact: true }),
  ).toHaveCount(0);
  const note = await savedNote(request, "welcome");
  expect(note.body).toContain('"noteId":"api"');
  await page
    .getByRole("button", { name: "Authentication API ↗", exact: true })
    .click();
  await expect(page.locator("#render-api")).toBeVisible();
});
test("native agent proposals stay inert until the draw.io preview is applied", async ({
  page,
  request,
}) => {
  await prepare(page, request, "Current diagram");
  await page.getByRole("button", { name: "Save diagram", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Edit diagram", exact: true }),
  ).toHaveCount(0);
  const note = await savedNote(request, "welcome");
  const { token } = await (
    await request.post("/api/mcp/keys", {
      data: { name: "Native diagram review" },
    })
  ).json();
  const proposed = nativeDiagram("Agent proposed design");
  const created = await request.post("/api/agent/diagram-proposals", {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      noteId: note.id,
      diagramIndex: 0,
      baseRevision: note.revision,
      diagram: proposed,
      summary: "Native architecture update",
    },
  });
  expect(created.ok()).toBe(true);
  expect((await savedNote(request, "welcome")).body).not.toContain(
    "Agent proposed design",
  );
  await page.getByRole("button", { name: "Edit diagram", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Save diagram", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "References and library", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Review proposal", exact: true })
    .click();
  await expect(
    page.frameLocator("iframe").locator(".geDiagramContainer"),
  ).toContainText("Agent proposed design");
  await expect(
    page.getByRole("button", { name: "Save diagram", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Apply reviewed proposal", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Edit diagram", exact: true }),
  ).toHaveCount(0);
  await expect
    .poll(async () => (await savedNote(request, "welcome")).body)
    .toContain("Agent proposed design");
});
