import { describe, it, expect } from "vitest";
import * as m from "../src/mindmap/model.js";
const tree = () => ({
  version: 1,
  rootId: "root",
  layout: "both",
  nodes: [
    { id: "root", label: "Central idea" },
    { id: "a", parentId: "root", label: "A", color: "#dcf0e5" },
    { id: "b", parentId: "root", label: "B" },
    { id: "child", parentId: "a", label: "Child" },
  ],
});
describe("native mind map validation", () => {
  it("creates fresh single-root defaults and canonical round trips", () => {
    const d = m.defaultMindMap();
    expect(d.nodes).toHaveLength(1);
    expect(d.nodes[0].label).toBe("Central idea");
    expect(m.parseMindMap(JSON.stringify(tree()))).toEqual(tree());
    d.nodes.length = 0;
    expect(m.defaultMindMap().nodes).toHaveLength(1);
  });
  it("rejects duplicates, disconnected roots, cycles and oversized labels", () => {
    for (const change of [
      (d) => d.nodes.push({ ...d.nodes[1] }),
      (d) => delete d.nodes[1].parentId,
      (d) => {
        d.nodes[1].parentId = "child";
      },
      (d) => (d.nodes[0].parentId = "a"),
      (d) => (d.nodes[1].label = "a".repeat(501)),
      (d) => (d.nodes[1].parentId = "missing"),
    ]) {
      const d = tree();
      change(d);
      expect(() => m.parseMindMap(d)).toThrow();
    }
  });
  it("accepts protected note and OKF links while rejecting executable targets", () => {
    for (const link of [
      { kind: "note", noteId: "note-1" },
      { kind: "block", noteId: "note-1", blockId: "b" },
      { kind: "concept", noteId: "n", bundleId: "b", path: "ideas/a.md" },
      { kind: "bundle", bundleId: "bundle-1" },
      { kind: "url", url: "https://example.org" },
      { kind: "asset", url: "/api/assets/a.pdf", name: "A" },
    ]) {
      const d = tree();
      d.nodes[1].link = link;
      expect(m.parseMindMap(d).nodes[1].link).toEqual(link);
    }
    const d = tree();
    d.nodes[1].link = { kind: "url", url: "javascript:alert(1)" };
    expect(() => m.parseMindMap(d)).toThrow();
  });
  it("bounds node count, JSON and strips irrelevant raw positions", () => {
    const d = tree();
    d.nodes = Array.from({ length: 300 }, (_, i) => ({
      id: "n" + i,
      label: "Idea",
      ...(i ? { parentId: "n0" } : {}),
    }));
    d.rootId = "n0";
    expect(m.parseMindMap(d).nodes).toHaveLength(300);
    d.nodes.push({ id: "extra", parentId: "n0", label: "" });
    expect(() => m.parseMindMap(d)).toThrow();
    expect(() => m.parseMindMap(" ".repeat(1000001))).toThrow();
    const a = tree();
    a.nodes[1].position = { x: 9, y: 2 };
    expect(m.parseMindMap(a).nodes[1].position).toBeUndefined();
  });
});
describe("mind map layout", () => {
  it("is deterministic, balanced and projects no semantic parents", () => {
    const d = tree(),
      a = m.layoutMindMap(d),
      b = m.layoutMindMap(d);
    expect(a).toEqual(b);
    expect(a.version).toBe(2);
    expect(a.nodes.map((n) => n.id)).toEqual(d.nodes.map((n) => n.id));
    expect(a.nodes.every((n) => n.parentId === undefined)).toBe(true);
    expect(a.nodes.find((n) => n.id === "a").position.x).toBeGreaterThan(0);
    expect(a.nodes.find((n) => n.id === "b").position.x).toBeLessThan(0);
    expect(a.nodes.find((n) => n.id === "child").data.color).toBe("#dcf0e5");
  });
  it("honors branch sides, right layout and collapsed visibility without data loss", () => {
    const d = tree();
    d.nodes[1].side = "left";
    d.nodes[1].collapsed = true;
    expect(m.layoutMindMap(d).nodes.map((n) => n.id)).not.toContain("child");
    expect(m.layoutMindMap(d, { includeCollapsed: true }).nodes).toHaveLength(
      4,
    );
    expect(
      m.layoutMindMap(d).nodes.find((n) => n.id === "a").position.x,
    ).toBeLessThan(0);
    d.layout = "right";
    expect(
      m
        .layoutMindMap(d)
        .nodes.filter((n) => n.id !== "root")
        .every((n) => n.position.x > 0),
    ).toBe(true);
    expect(d.nodes).toHaveLength(4);
  });
  it("omits bundle links only in projection and generates escaped SVG", () => {
    const d = tree();
    d.nodes[1].link = { kind: "bundle", bundleId: "b" };
    d.nodes[1].label = "<script> &";
    expect(
      m.layoutMindMap(d).nodes.find((n) => n.id === "a").data.link,
    ).toBeUndefined();
    expect(m.mindMapToSvg(d)).toContain("&lt;script&gt; &amp;");
    expect(d.nodes[1].link.kind).toBe("bundle");
  });
});
describe("immutable tree editing", () => {
  it("adds children and siblings in order without changing input", () => {
    const d = tree(),
      added = m.addIdea(d, "a", "New", { id: "new", side: "left" });
    expect(d.nodes).toHaveLength(4);
    expect(added.nodes.at(-1)).toMatchObject({
      id: "new",
      parentId: "a",
      label: "New",
    });
    const sibling = m.addSibling(added, "new", "Sibling");
    expect(sibling.nodes.at(-1).parentId).toBe("a");
  });
  it("updates safe fields and rejects moves creating cycles", () => {
    const d = tree();
    expect(() => m.reparentIdea(d, "a", "child")).toThrow();
    expect(() => m.reparentIdea(d, "root", "a")).toThrow();
    const moved = m.reparentIdea(d, "child", "b");
    expect(moved.nodes.find((n) => n.id === "child").parentId).toBe("b");
    expect(
      m.updateIdea(d, "a", { label: "Changed", collapsed: true }).nodes[1],
    ).toMatchObject({ label: "Changed", collapsed: true });
    expect(d.nodes[1].label).toBe("A");
  });
  it("removes complete branches while retaining the root", () => {
    expect(m.removeBranch(tree(), "a").nodes.map((n) => n.id)).toEqual([
      "root",
      "b",
    ]);
    expect(m.removeBranch(tree(), "root").nodes).toEqual([
      { id: "root", label: "Central idea" },
    ]);
  });
  it("duplicates branches with remapped parents and retained links", () => {
    const d = tree();
    d.nodes[3].link = { kind: "note", noteId: "linked" };
    const copy = m.duplicateBranch(d, "a"),
      added = copy.nodes.slice(4);
    expect(added).toHaveLength(2);
    expect(added[0].id).not.toBe("a");
    expect(added[0].parentId).toBe("root");
    expect(added[1].parentId).toBe(added[0].id);
    expect(added[1].link).toEqual(d.nodes[3].link);
    expect(m.parseMindMap(copy)).toEqual(copy);
  });
});
describe("outline conversion", () => {
  it("round trips full tree including collapsed descendants and multiline labels", () => {
    const d = tree();
    d.nodes[1].collapsed = true;
    d.nodes[3].label = "Line one\n- literal bullet\\suffix";
    const imported = m.outlineToMindMap(m.mindMapToOutline(d));
    expect(imported.nodes.map((n) => n.label)).toEqual([
      "Central idea",
      "A",
      "Line one\n- literal bullet\\suffix",
      "B",
    ]);
    expect(imported.nodes[2].parentId).toBe(imported.nodes[1].id);
  });
  it("imports multiple root bullets as children of a central idea", () => {
    const d = m.outlineToMindMap("- A\n  - Child\n- B");
    expect(d.nodes.map((n) => n.label)).toEqual([
      "Central idea",
      "A",
      "Child",
      "B",
    ]);
    expect(d.nodes[1].parentId).toBe(d.rootId);
    expect(d.nodes[3].parentId).toBe(d.rootId);
  });
  it("rejects excessive nesting or malformed indentation", () => {
    expect(() =>
      m.outlineToMindMap(
        Array.from({ length: 66 }, (_, i) => "  ".repeat(i) + "- Deep").join(
          "\n",
        ),
      ),
    ).toThrow();
    expect(() => m.outlineToMindMap("- A\n  - B\n - C")).toThrow();
  });
});
it("lays out the largest shallow and deepest supported trees within shared diagram bounds", () => {
  for (const chain of [false, true]) {
    const d = {
      version: 1,
      rootId: "n0",
      layout: "right",
      nodes: Array.from({ length: 300 }, (_, i) => ({
        id: "n" + i,
        label: "Long idea ".repeat(50),
        ...(i ? { parentId: "n" + (chain ? i - 1 : 0) } : {}),
      })),
    };
    const projected = m.layoutMindMap(d);
    expect(projected.nodes).toHaveLength(300);
    expect(projected.edges).toHaveLength(299);
    for (const n of projected.nodes) {
      expect(Math.abs(n.position.x)).toBeLessThanOrEqual(100000);
      expect(Math.abs(n.position.y)).toBeLessThanOrEqual(100000);
    }
    expect(() => m.addIdea(d, "n0")).toThrow(/300/);
    expect(d.nodes).toHaveLength(300);
  }
});
it("inherits the nearest explicit branch color and can remove a color override", () => {
  let d = tree();
  d = m.updateIdea(d, "child", { color: "#fff0cc" });
  expect(
    m.layoutMindMap(d).nodes.find((n) => n.id === "child").data.color,
  ).toBe("#fff0cc");
  d = m.updateIdea(d, "child", { color: undefined });
  expect(
    m.layoutMindMap(d).nodes.find((n) => n.id === "child").data.color,
  ).toBe("#dcf0e5");
});
it("rejects editing identity fields and never mutates input on failed operations", () => {
  const d = tree(),
    before = JSON.stringify(d);
  for (const action of [
    () => m.updateIdea(d, "a", { id: "evil" }),
    () => m.updateIdea(d, "a", { parentId: "child" }),
    () => m.addIdea(d, "missing"),
    () => m.addIdea(d, "a", "New", { id: "root" }),
    () => m.removeBranch(d, "missing"),
  ])
    expect(action).toThrow();
  expect(JSON.stringify(d)).toBe(before);
});
it("duplicates the root as a child tree and expands destinations for new ideas", () => {
  const d = tree();
  d.nodes[0].collapsed = true;
  const copy = m.duplicateBranch(d, "root");
  expect(copy.nodes).toHaveLength(8);
  expect(copy.nodes[4].parentId).toBe("root");
  expect(copy.nodes.filter((n) => !n.parentId)).toHaveLength(1);
  expect(m.layoutMindMap(copy).nodes.length).toBeGreaterThan(1);
  const added = m.addIdea(d, "root");
  expect(added.nodes[0].collapsed).toBe(false);
  expect(d.nodes[0].collapsed).toBe(true);
});
it("imports ordinary nested bullets, tabs and numbered lists without losing order", () => {
  const d = m.outlineToMindMap("1. Plan\n\t- First\n\t\t* Detail\n\t+ Second");
  expect(d.nodes.map((n) => n.label)).toEqual([
    "Plan",
    "First",
    "Detail",
    "Second",
  ]);
  expect(d.nodes[2].parentId).toBe(d.nodes[1].id);
  expect(d.nodes[3].parentId).toBe(d.rootId);
});
