import { it, expect } from "vitest";
import {
  clearPersistedDiagramDrafts,
  diagramRecoveryId,
} from "../src/diagram/recovery.js";
import { diagramFences } from "../src/diagram/note-diagrams.js";
import { defaultDiagram } from "../src/diagram/model.js";
const empty = defaultDiagram();
const fence = (d) => "```thread-diagram\n" + JSON.stringify(d) + "\n```";
it("distinguishes multiple diagrams under an inherited block marker", () => {
  const body =
    "<!-- thread:block id=shared -->\n" + fence(empty) + "\n\n" + fence(empty);
  const fences = diagramFences(body);
  expect(
    new Set(fences.map((f) => diagramRecoveryId("note", f, fences))).size,
  ).toBe(2);
});
it("clears only matching persisted recovery and preserves a different tab draft and viewport", () => {
  const body = fence(empty) + "\n\n" + fence(empty);
  const different = {
    ...empty,
    xml: empty.xml.replace('id="0"', 'id="0" value="unsaved"'),
  };
  const saved = "thread-diagram-draft:note:diagram-0",
    pending = "thread-diagram-draft:note:diagram-1";
  const values = new Map([
    [saved, JSON.stringify({ diagram: empty })],
    [saved + ":viewport", "{}"],
    [pending, JSON.stringify({ diagram: different })],
  ]);
  clearPersistedDiagramDrafts("note", body, {
    getItem: (k) => values.get(k),
    removeItem: (k) => values.delete(k),
  });
  expect(values.has(saved)).toBe(false);
  expect(values.has(saved + ":viewport")).toBe(true);
  expect(values.has(pending)).toBe(true);
});
