import { describe, it, expect } from "vitest";
import {
  templates,
  metadata,
  searchNotes,
  validateBackup,
} from "../src/model.js";
const notes = [
  {
    id: "a",
    title: "API plan",
    body: "Discuss @[Roadmap](note:b) #backend #api",
    updated: "2026-09-09T10:30:00Z",
    created: "2026-09-08T09:00:00Z",
  },
  {
    id: "b",
    title: "Roadmap",
    body: "Product #planning",
    updated: "2026-09-08T08:00:00Z",
    created: "2026-09-08T08:00:00Z",
  },
];
describe("note metadata", () => {
  it("extracts unique tags and stable mention IDs", () =>
    expect(metadata(notes[0].body)).toEqual({
      tags: ["backend", "api"],
      links: ["b"],
    }));
  it("ignores code fences and inline code", () =>
    expect(metadata("`#fake`\n```js\n#no\n```\n#real").tags).toEqual(["real"]));
});
describe("search", () => {
  it("searches title, body, tags and mention labels", () => {
    for (const query of ["API", "backend", "Roadmap"])
      expect(searchNotes(notes, { query }).some((n) => n.id === "a")).toBe(
        true,
      );
  });
  it("filters exact tags and timestamp ranges", () => {
    expect(
      searchNotes(notes, {
        tag: "api",
        from: "2026-09-09T10:00:00Z",
        to: "2026-09-09T11:00:00Z",
      }),
    ).toHaveLength(1);
    expect(searchNotes(notes, { from: "2026-09-09T11:00:00Z" })).toHaveLength(
      0,
    );
  });
});
it("rejects invalid and duplicate backup records", () => {
  expect(() => validateBackup([{ id: "a" }])).toThrow();
  expect(() => validateBackup([notes[0], notes[0]])).toThrow();
  expect(validateBackup(notes)).toEqual(notes);
});
it("searches the current title of linked notes after a rename", () => {
  const renamed = [notes[0], { ...notes[1], title: "New direction" }];
  expect(
    searchNotes(renamed, { query: "New direction" }).map((n) => n.id),
  ).toEqual(["a", "b"]);
});
it("includes basic Markdown and operational templates", () => {
  expect(templates.map((t) => t[0])).toEqual(
    expect.arrayContaining([
      "Bullet list",
      "Numbered list",
      "Image",
      "Runbook",
      "Incident report",
      "Test plan",
      "User story",
      "RFC",
    ]),
  );
});

it("collects complete stable note IDs from mentions, block references and embeds", () => {
  expect(
    metadata(
      "@[API](note:api-design) @[Block](block:other-note/abc) ![[third-note#xyz]]",
    ).links,
  ).toEqual(["api-design", "other-note", "third-note"]);
});
