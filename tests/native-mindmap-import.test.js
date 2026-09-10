// @vitest-environment jsdom
import { it, expect } from "vitest";
import { parseMarkdownToDrawnix } from "@plait-board/markdown-to-drawnix";
import { parseMindMap } from "../src/mindmap/model.js";
it("accepts the actual pinned native Markdown importer output losslessly", () => {
  const element = {
    ...parseMarkdownToDrawnix(
      "# Research\n## Evidence\n- Sources\n## Delivery",
    ),
    points: [[0, 0]],
  };
  const value = {
    version: 2,
    engine: "drawnix",
    elements: [element],
    references: [],
  };
  expect(parseMindMap(value)).toEqual(value);
  expect(element.children.length).toBeGreaterThan(0);
});
