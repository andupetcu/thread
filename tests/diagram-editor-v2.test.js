import { describe, it, expect } from "vitest";
import * as ops from "../src/diagram/editor-operations.js";
const node = (id, x, y, extra = {}) => ({
  id,
  type: "diagramShape",
  position: { x, y },
  width: 180,
  height: 90,
  data: { shape: "process", label: id, color: "#ffffff" },
  ...extra,
});
const fixture = () => ({
  version: 2,
  nodes: [
    node("a", 10, 20, { selected: true }),
    node("b", 300, 200, { selected: true }),
    node("c", 600, 30, { locked: true }),
  ],
  edges: [
    { id: "ab", source: "a", target: "b", label: "yes" },
    { id: "bc", source: "b", target: "c" },
  ],
});
describe("diagram editing operations", () => {
  it("copies only internal edges and remaps IDs on insertion", () => {
    const d = fixture(),
      copy = ops.selectedSubgraph(d),
      next = ops.insertDiagram(d, copy);
    expect(copy.edges).toHaveLength(1);
    expect(next.nodes).toHaveLength(5);
    expect(new Set(next.nodes.map((n) => n.id)).size).toBe(5);
    expect(next.edges.at(-1).source).toBe(next.nodes[3].id);
  });
  it("groups and ungroups without moving shapes in world coordinates", () => {
    const d = fixture(),
      g = ops.groupSelection(d);
    const group = g.nodes.find((n) => n.data.shape === "group");
    expect(group).toBeTruthy();
    expect(g.nodes.find((n) => n.id === "a").parentId).toBe(group.id);
    const u = ops.ungroupSelection(g);
    expect(u.nodes.find((n) => n.id === "a").position).toEqual(
      d.nodes[0].position,
    );
  });
  it("aligns selected shapes but preserves locked shapes", () => {
    const d = fixture();
    d.nodes[2].selected = true;
    const n = ops.alignSelection(d, "left");
    expect(n.nodes[1].position.x).toBe(10);
    expect(n.nodes[2].position.x).toBe(600);
  });
  it("layout preserves pinned nodes and valid group-relative positions", () => {
    const d = fixture(),
      n = ops.autoLayout(d, "LR");
    expect(n.nodes[2].position).toEqual(d.nodes[2].position);
    expect(n.nodes[1].position.x).toBeGreaterThan(n.nodes[0].position.x);
  });
  it("styles selected nodes together and removes descendants with their group", () => {
    const g = ops.groupSelection(fixture());
    const styled = ops.styleSelection(fixture(), { color: "#112233" });
    expect(styled.nodes[1].data.color).toBe("#112233");
    expect(ops.deleteSelection(g).nodes.map((n) => n.id)).toEqual(["c"]);
  });
  it("recovery keys distinguish note and block identities", () => {
    expect(ops.draftKey({ noteId: "n", diagramIndex: 0 })).not.toBe(
      ops.draftKey({ noteId: "n", diagramIndex: 1 }),
    );
    expect(ops.draftKey()).toBe(null);
  });
});
it("layout keeps locked descendants pinned in world space", () => {
  const d = {
    version: 2,
    nodes: [
      node("frame", 300, 200, {
        data: { shape: "group", label: "frame", color: "#ffffff" },
        width: 500,
        height: 400,
      }),
      node("pin", 30, 40, { parentId: "frame", locked: true }),
      node("other", 10, 10),
    ],
    edges: [],
  };
  const next = ops.autoLayout(d);
  expect(ops.worldPosition(next.nodes[1], next.nodes)).toEqual({
    x: 330,
    y: 240,
  });
});
it("grouping nested groups preserves descendant ownership on ungroup", () => {
  const d = ops.groupSelection(fixture());
  d.nodes[0].selected = true;
  const g = ops.groupSelection(d);
  const u = ops.ungroupSelection(g);
  expect(u.nodes.find((n) => n.id === "a").parentId).toBe(d.nodes[0].id);
});
it("orders parents before children for the live canvas without moving nodes", () => {
  const d = {
    version: 2,
    nodes: [
      node("child", 20, 30, { parentId: "group" }),
      node("group", 100, 100, {
        data: { shape: "group", label: "group", color: "#ffffff" },
      }),
    ],
    edges: [],
  };
  expect(ops.parentFirst(d.nodes).map((n) => n.id)).toEqual(["group", "child"]);
  expect(d.nodes[0].position).toEqual({ x: 20, y: 30 });
});
it("accepts only supported diagram image formats and rejects oversized images before upload", () => {
  expect(ops.diagramAssetKind({ type: "image/png", size: 1024 })).toBe("image");
  expect(ops.diagramAssetKind({ type: "image/tiff", size: 1024 })).toBe(
    "document",
  );
  expect(ops.diagramAssetKind({ type: "image/svg+xml", size: 1024 })).toBe(
    "document",
  );
  expect(() =>
    ops.diagramAssetKind({ type: "image/jpeg", size: 10 * 1024 * 1024 + 1 }),
  ).toThrow(/10 MB/);
});
it("rejects invalid live dimensions and coordinates without accepting a broken draft", () => {
  const d = fixture();
  expect(() =>
    ops.prepareEditorChange(d, {
      ...d,
      nodes: [{ ...d.nodes[0], width: 4097 }, ...d.nodes.slice(1)],
    }),
  ).toThrow(/dimensions/);
  expect(() =>
    ops.prepareEditorChange(d, {
      ...d,
      nodes: [
        { ...d.nodes[0], position: { x: 100001, y: 0 } },
        ...d.nodes.slice(1),
      ],
    }),
  ).toThrow(/coordinates/);
  expect(d.nodes[0].width).toBe(180);
});
it("late functional insertion uses current edits and snapshots them for undo", () => {
  const start = fixture();
  const later = ops.styleSelection(start, { label: "Concurrent edit" });
  const result = ops.prepareEditorChange(later, (current) =>
    ops.insertDiagram(current, {
      version: 2,
      nodes: [node("uploaded", 0, 0)],
      edges: [],
    }),
  );
  expect(result.diagram.nodes[0].data.label).toBe("Concurrent edit");
  expect(JSON.parse(result.before).nodes[0].data.label).toBe("Concurrent edit");
  expect(result.diagram.nodes).toHaveLength(4);
});
it("aligns only selected roots so children do not move twice with their group", () => {
  const d = {
    version: 2,
    nodes: [
      node("group", 100, 0, {
        selected: true,
        data: { shape: "group", label: "Group", color: "#ffffff" },
      }),
      node("child", 50, 30, { parentId: "group", selected: true }),
      node("other", 0, 200, { selected: true }),
    ],
    edges: [],
  };
  const aligned = ops.alignSelection(d, "left");
  expect(aligned.nodes[0].position.x).toBe(0);
  expect(aligned.nodes[1].position.x).toBe(50);
  expect(ops.worldPosition(aligned.nodes[1], aligned.nodes).x).toBe(50);
});
it("ignores identical ordinary saved recovery but retains uncommitted OKF recovery", () => {
  const d = fixture(),
    record = {
      baseline: "old baseline",
      diagram: d,
      viewport: { x: 1, y: 2, zoom: 1 },
    };
  expect(ops.recoveryNeedsReview(record, d, false)).toBe(false);
  expect(ops.recoveryNeedsReview(record, d, true)).toBe(true);
  const different = ops.styleSelection(d, { label: "Unsaved" });
  expect(
    ops.recoveryNeedsReview({ ...record, diagram: different }, d, false),
  ).toBe(true);
});
it("preserves live node measurements during content edits without persisting them", () => {
  const d = fixture();
  d.nodes = d.nodes.map((n) => ({
    ...n,
    measured: { width: n.width, height: n.height },
  }));
  const result = ops.prepareEditorChange(
    d,
    ops.styleSelection(d, { label: "Changed" }),
  );
  expect(result.diagram.nodes[0].measured).toEqual({ width: 180, height: 90 });
  expect(JSON.parse(result.before).nodes[0]).not.toHaveProperty("measured");
});
