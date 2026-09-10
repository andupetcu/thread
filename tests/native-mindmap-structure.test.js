import { it, expect } from "vitest";
import { parseMindMap } from "../src/mindmap/model.js";
import { mindNode } from "./native-mindmap-helpers.js";
const parse = (element) =>
  parseMindMap({
    version: 2,
    engine: "drawnix",
    elements: [element],
    references: [],
  });
it("rejects native mind fields that would crash Plait before mounting", () => {
  const root = mindNode();
  for (const patch of [
    { points: [] },
    { points: [[0, "bad"]] },
    { children: null },
    { data: {} },
    { data: { topic: { children: [{}] } } },
    { children: [{ id: "child", type: "mind_child", children: [] }] },
  ])
    expect(() => parse({ ...root, ...patch })).toThrow();
  expect(() =>
    parse({ ...root, children: [{ ...mindNode(), type: "mind_child" }] }),
  ).toThrow(/ID/);
});
it("validates drawing coordinates, required line handles, supported shapes and viewport", () => {
  for (const value of [
    { id: "x", type: "geometry", points: [[0, 0]], shape: "rectangle" },
    {
      id: "x",
      type: "geometry",
      points: [
        [0, 0],
        [1, 1],
      ],
      shape: "unknown",
    },
    {
      id: "x",
      type: "arrow-line",
      points: [
        [0, 0],
        [1, 1],
      ],
      shape: "straight",
    },
    {
      id: "x",
      type: "image",
      points: [
        [0, 0],
        [1, 1],
      ],
    },
  ])
    expect(() => parse(value)).toThrow();
  expect(() =>
    parseMindMap({
      version: 2,
      engine: "drawnix",
      elements: [],
      references: [],
      viewport: { zoom: 0 },
    }),
  ).toThrow();
});
it("preserves valid native mind, geometry, image, freehand, group and arrow documents", () => {
  const values = [
    mindNode(),
    {
      id: "shape",
      type: "geometry",
      shape: "rectangle",
      points: [
        [0, 0],
        [100, 100],
      ],
      text: { children: [{ text: "Hello", bold: true }] },
      plugin: { custom: true },
    },
    {
      id: "image",
      type: "image",
      url: "/api/assets/a.png",
      angle: 0,
      points: [
        [0, 0],
        [100, 100],
      ],
    },
    {
      id: "pen",
      type: "freehand",
      shape: "nibPen",
      points: [
        [0, 0],
        [1, 1],
        [2, 1],
      ],
    },
    { id: "group", type: "group" },
    {
      id: "line",
      type: "arrow-line",
      shape: "straight",
      points: [
        [0, 0],
        [100, 100],
      ],
      source: { marker: "none" },
      target: { marker: "arrow" },
      texts: [],
    },
  ];
  for (const value of values) expect(parse(value).elements[0]).toEqual(value);
});
