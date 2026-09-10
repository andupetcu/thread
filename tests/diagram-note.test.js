import { it, expect } from "vitest";
import {
  diagramFences,
  replaceDiagramFence,
} from "../src/diagram/note-diagrams.js";
import { metadata } from "../src/model.js";

const source = '```thread-diagram\n{"version":1,"nodes":[],"edges":[]}\n```';
it("locates diagram ordinals and stable block identities across container syntax", () => {
  const body =
    "<!-- thread:block id=one -->\n" +
    source +
    "\n\n> " +
    source.replaceAll("\n", "\n> ");
  const found = diagramFences(body);
  expect(found.map((item) => item.diagramIndex)).toEqual([0, 1]);
  expect(found[0].blockId).toBe("one");
  expect(body.slice(found[0].start, found[0].end)).toBe(source);
});
it("replaces only the diagram while retaining list and quote indentation", () => {
  for (const [first, continuation] of [
    ["", ""],
    ["> ", "> "],
    ["- ", "  "],
    ["> - ", ">   "],
  ]) {
    const body =
      "Before\n\n" +
      first +
      source.replaceAll("\n", "\n" + continuation) +
      "\n\nAfter";
    const updated = replaceDiagramFence(
      body,
      diagramFences(body)[0],
      '{"version":2,"nodes":[],"edges":[]}',
    );
    expect(updated).toContain("Before");
    expect(updated).toContain("After");
    expect(diagramFences(updated)).toHaveLength(1);
    expect(JSON.parse(diagramFences(updated)[0].value).version).toBe(2);
  }
});
it("includes links from real diagram nodes in note backlinks but ignores code examples", () => {
  const diagram = {
    version: 3,
    engine: "drawio",
    xml: "<mxGraphModel><root/></mxGraphModel>",
    references: [
      { id: "x", label: "Linked", link: { kind: "note", noteId: "target" } },
    ],
  };
  const body = "```thread-diagram\n" + JSON.stringify(diagram) + "\n```";
  expect(metadata(body).links).toEqual(["target"]);
  expect(metadata("````md\n" + body + "\n````").links).toEqual([]);
});
