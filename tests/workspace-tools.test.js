import { describe, expect, it } from "vitest";
import {
  relationshipGraph,
  neighborhood,
} from "../src/workspace/graph-model.js";
import {
  filterTable,
  tableFields,
  saveView,
} from "../src/workspace/table-model.js";
import { alignedDiff } from "../src/workspace/diff-model.js";

const notes = [
  {
    id: "a",
    title: "API",
    body: "@[Build](note:b) #platform",
    properties: { status: "In progress", owner: "Ada", effort: "8" },
  },
  {
    id: "b",
    title: "Build",
    body: "#platform",
    properties: { status: "Done", owner: "Lin", effort: "2" },
  },
  {
    id: "c",
    title: "Cache",
    body: "@[Build](note:b)",
    properties: { status: "Planned", owner: "Ada", effort: "12" },
  },
  { id: "d", title: "Design", body: "#design", properties: {} },
];
describe("relationship graph", () => {
  it("includes valid directed references but no dangling links or code examples", () => {
    const graph = relationshipGraph([
      ...notes,
      {
        id: "e",
        title: "Example",
        body: "~~~md\n@[API](note:a) #platform\n~~~\n@[gone](note:missing)",
      },
    ]);
    expect(graph.edges.map((e) => [e.source, e.target])).toEqual([
      ["a", "b"],
      ["c", "b"],
    ]);
    expect(graph.nodes).toHaveLength(5);
  });
  it("represents shared tags with hubs, avoiding a quadratic clique", () => {
    const graph = relationshipGraph(notes, true);
    expect(
      graph.nodes.filter((n) => n.kind === "tag").map((n) => n.label),
    ).toEqual(["#platform"]);
    expect(graph.edges.filter((e) => e.kind === "tag")).toHaveLength(2);
    const large = relationshipGraph(
      Array.from({ length: 1000 }, (_, i) => ({
        id: String(i),
        body: "#common",
      })),
      true,
    );
    expect(large.edges).toHaveLength(1000);
  });
  it("filters neighborhoods bidirectionally without including unrelated notes", () => {
    const graph = relationshipGraph(notes, true);
    expect(
      neighborhood(graph, "a", 1)
        .nodes.filter((n) => n.kind === "note")
        .map((n) => n.id),
    ).toEqual(["a", "b"]);
    expect(
      neighborhood(graph, "a", 2)
        .nodes.filter((n) => n.kind === "note")
        .map((n) => n.id),
    ).toEqual(["a", "b", "c"]);
  });
  it("includes block references and embeds as note relationships", () => {
    const graph = relationshipGraph([
      {
        id: "a",
        body: "@[Section](block:b/block-1)\n![[c#block-2]]\n`![[d#example]]`",
      },
      { id: "b", body: "" },
      { id: "c", body: "" },
      { id: "d", body: "" },
    ]);
    expect(graph.edges.map((e) => [e.source, e.target])).toEqual([
      ["a", "b"],
      ["a", "c"],
    ]);
  });
  it("builds a five-thousand-note graph without multiplying common-tag edges", () => {
    const large = Array.from({ length: 5000 }, (_, i) => ({
      id: `scale-${i}`,
      title: `Note ${i}`,
      body: `#common\n${i ? `@[Previous](note:scale-${i - 1})` : ""}`,
    }));
    const graph = relationshipGraph(large, true);
    expect(graph.nodes).toHaveLength(5001);
    expect(graph.edges).toHaveLength(9999);
    expect(neighborhood(graph, "scale-0", 1).nodes).toHaveLength(5001);
  });
});
describe("property table", () => {
  it("combines property filters and numeric sorting without modifying notes", () => {
    const result = filterTable(notes, {
      filters: [{ field: "owner", operator: "is", value: "Ada" }],
      sort: { field: "effort", direction: "desc" },
    });
    expect(result.map((n) => n.id)).toEqual(["c", "a"]);
    expect(notes.map((n) => n.id)).toEqual(["a", "b", "c", "d"]);
  });
  it("finds custom properties and filters unset values", () => {
    expect(tableFields(notes, ["release"])).toContain("effort");
    expect(tableFields(notes, ["release"])).toContain("release");
    expect(
      filterTable(notes, {
        filters: [{ field: "owner", operator: "empty" }],
      }).map((n) => n.id),
    ).toEqual(["d"]);
  });
  it("saves independent snapshots and updates an existing view", () => {
    const draft = {
      columns: ["title", "owner"],
      filters: [],
      sort: { field: "title", direction: "asc" },
    };
    const views = saveView([], "v1", "Owners", draft);
    draft.columns.push("status");
    expect(views[0].columns).toEqual(["title", "owner"]);
    expect(saveView(views, "v1", "Assigned", draft)).toHaveLength(1);
  });
  it("matches calendar-date filters against timestamp properties", () => {
    expect(
      filterTable(
        [
          { id: "a", updated: "2026-09-09T12:30:00Z" },
          { id: "b", updated: "2026-09-08T12:30:00Z" },
        ],
        {
          filters: [{ field: "updated", operator: "is", value: "2026-09-09" }],
        },
      ).map((n) => n.id),
    ).toEqual(["a"]);
  });
});
describe("aligned comparison", () => {
  it("aligns additions and deletions across three independent notes", () => {
    const result = alignedDiff([
      "alpha\nbeta\ngamma",
      "alpha\ninsert\nbeta\ngamma",
      "alpha\ngamma",
    ]);
    expect(result.rows.map((r) => r.cells.map((c) => c.text))).toEqual([
      ["alpha", "alpha", "alpha"],
      [null, "insert", null],
      ["beta", "beta", null],
      ["gamma", "gamma", "gamma"],
    ]);
    expect(result.changeRows).toEqual([1]);
    expect(result.rows[2].cells[2].kind).toBe("missing");
  });
  it("highlights changed words, preserves whitespace, and keeps real line numbers", () => {
    const result = alignedDiff(["ship  red car\nnext", "ship  blue car\nnext"]);
    expect(
      result.rows[0].cells[1].parts
        .filter((p) => p.changed)
        .map((p) => p.text)
        .join(""),
    ).toBe("blue");
    expect(
      result.rows[0].cells[0].parts
        .filter((p) => p.changed)
        .map((p) => p.text)
        .join(""),
    ).toBe("red");
    expect(result.rows[0].cells[1].parts.map((p) => p.text).join("")).toBe(
      "ship  blue car",
    );
    expect(result.rows[1].cells.map((c) => c.lineNumber)).toEqual([2, 2]);
  });
  it("distinguishes empty notes and final newlines", () => {
    expect(alignedDiff(["", "one"]).rows[0].cells.map((c) => c.text)).toEqual([
      null,
      "one",
    ]);
    expect(alignedDiff(["one", "one\n"]).changeRows).toEqual([1]);
    expect(alignedDiff(["same", "same"]).changeRows).toEqual([]);
  });
  it("preserves every version when insertions and replacements have different lengths", () => {
    for (const bodies of [
      ["a\nb\nc", "start\na\nx\ny\nz\nc\nend", "a\nc"],
      ["", "first\nsecond", "third"],
      ["one\ntwo", "", "one\nthree\nfour"],
    ]) {
      const { rows } = alignedDiff(bodies);
      bodies.forEach((body, column) =>
        expect(
          rows
            .map((r) => r.cells[column].text)
            .filter((t) => t !== null)
            .join("\n"),
        ).toBe(body),
      );
    }
  });
});
