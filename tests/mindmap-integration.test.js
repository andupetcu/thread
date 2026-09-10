import { it, expect } from "vitest";
import {
  diagramFences,
  replaceDiagramFence,
} from "../src/diagram/note-diagrams.js";
import { metadata, templates } from "../src/model.js";
import { defaultMindMap, addIdea, updateIdea } from "../src/mindmap/model.js";
import { clearPersistedMindMapDrafts } from "../src/mindmap/recovery.js";
import { richFallbackReason } from "../src/rich/model.js";
const fence = (language, value) =>
  "```" + language + "\n" + JSON.stringify(value) + "\n```";
it("keeps diagram ordinals independent of mind maps and edits nested map fences safely", () => {
  const map = defaultMindMap();
  const diagram = { version: 2, nodes: [], edges: [] };
  const body =
    fence("thread-diagram", diagram) +
    "\n\n> " +
    fence("thread-mindmap", map).replaceAll("\n", "\n> ") +
    "\n\n" +
    fence("thread-diagram", diagram);
  expect(diagramFences(body).map((f) => f.diagramIndex)).toEqual([0, 1]);
  const maps = diagramFences(body, "thread-mindmap");
  expect(maps).toHaveLength(1);
  const changed = updateIdea(map, map.rootId, { label: "Changed idea" });
  const next = replaceDiagramFence(
    body,
    maps[0],
    JSON.stringify(changed),
    "thread-mindmap",
  );
  expect(diagramFences(next)).toHaveLength(2);
  expect(
    JSON.parse(diagramFences(next, "thread-mindmap")[0].value).nodes[0].label,
  ).toBe("Changed idea");
});
it("adds mind-map links to backlinks and protects its native source in rich editing", () => {
  let map = defaultMindMap();
  map = updateIdea(map, map.rootId, {
    link: { kind: "note", noteId: "target" },
  });
  const body = fence("thread-mindmap", map);
  expect(metadata(body).links).toContain("target");
  expect(metadata("````md\n" + body + "\n````").links).toEqual([]);
  expect(richFallbackReason(body)).toContain("visual editor");
  expect(templates.find((t) => t[0] === "Mind map")[1]).toContain(
    "thread-mindmap",
  );
});
it("clears only mind-map recovery matching a successful outer concept save", () => {
  const map = defaultMindMap(),
    changed = addIdea(map, map.rootId, "Pending");
  const key = "thread-mindmap-draft:note:diagram-0";
  const values = new Map([[key, JSON.stringify({ document: changed })]]);
  const storage = {
    getItem: (k) => values.get(k),
    removeItem: (k) => values.delete(k),
  };
  clearPersistedMindMapDrafts("note", fence("thread-mindmap", map), storage);
  expect(values.has(key)).toBe(true);
  clearPersistedMindMapDrafts(
    "note",
    fence("thread-mindmap", changed),
    storage,
  );
  expect(values.has(key)).toBe(false);
});
