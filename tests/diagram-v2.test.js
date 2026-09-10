import { describe, it, expect } from "vitest";
import * as m from "../src/diagram/model.js";
const node = (id = "a", extra = {}) => ({
  id,
  position: { x: 0, y: 0 },
  data: { shape: "process", label: "Hello", color: "#e8eefc" },
  ...extra,
});
const doc = (nodes = [node()], edges = []) => ({ version: 2, nodes, edges });
describe("diagram v2 documents", () => {
  it("migrates v1 without losing labels and normalizes defaults", () => {
    const d = m.parseDiagram({
      version: 1,
      nodes: [node("a"), node("b")],
      edges: [
        {
          id: "e",
          source: "a",
          target: "b",
          sourceHandle: "out",
          targetHandle: "in",
        },
      ],
    });
    expect(d.version).toBe(2);
    expect(d.nodes[0]).toMatchObject({ width: 180, height: 90 });
    expect(d.edges[0]).toMatchObject({
      sourceHandle: "out-bottom",
      targetHandle: "in-top",
      kind: "curve",
      endArrow: "arrow",
    });
  });
  it("round trips rich documents while stripping transient state", () => {
    const d = m.parseDiagram(
      doc(
        [
          node("group", {
            width: 600,
            height: 400,
            locked: true,
            data: { shape: "group", label: "Frame", color: "#ffffff" },
          }),
          node("a", {
            parentId: "group",
            width: 240,
            height: 130,
            selected: true,
            data: {
              shape: "annotation",
              label: "Full label",
              color: "#fff0cc",
              textColor: "#123456",
              fontSize: 22,
              fontWeight: 700,
              textAlign: "left",
              link: {
                kind: "concept",
                noteId: "note-1",
                bundleId: "b",
                path: "A.B",
              },
            },
          }),
        ],
        [
          {
            id: "loop",
            source: "a",
            target: "a",
            sourceHandle: "out-right",
            targetHandle: "in-left",
            kind: "orthogonal",
            color: "#334455",
            width: 4,
            dashed: true,
            startArrow: "diamond",
            endArrow: "circle",
            label: "Retry",
          },
        ],
      ),
    );
    expect(m.parseDiagram(JSON.stringify(d))).toEqual(d);
    expect(d.nodes[1].selected).toBeUndefined();
    expect(d.nodes[1].width).toBe(240);
  });
  it("rejects invalid parents, cycles, style values and executable links", () => {
    for (const n of [
      node("a", { parentId: "absent" }),
      node("a", { width: 0 }),
      node("a", {
        data: {
          ...node().data,
          link: { kind: "url", url: "javascript:alert(1)" },
        },
      }),
      node("a", {
        data: { ...node().data, image: { url: "https://evil/a.png", alt: "" } },
      }),
    ])
      expect(() => m.parseDiagram(doc([n]))).toThrow();
    expect(() =>
      m.parseDiagram(
        doc([
          node("a", {
            parentId: "b",
            data: { ...node().data, shape: "group" },
          }),
          node("b", {
            parentId: "a",
            data: { ...node().data, shape: "group" },
          }),
        ]),
      ),
    ).toThrow(/cycle|parent/i);
    expect(() =>
      m.parseDiagram(doc([node("a"), node("b", { parentId: "a" })])),
    ).toThrow(/parent/i);
  });
  it("enforces exact node, edge, coordinate and dimension limits", () => {
    const nodes = Array.from({ length: 300 }, (_, i) => node("n" + i));
    expect(m.parseDiagram(doc(nodes)).nodes).toHaveLength(300);
    expect(() => m.parseDiagram(doc([...nodes, node("extra")]))).toThrow();
    expect(
      m.parseDiagram(
        doc([
          node("a", {
            position: { x: 100000, y: -100000 },
            width: 4096,
            height: 24,
          }),
        ]),
      ).nodes[0].width,
    ).toBe(4096);
    expect(() => m.parseDiagram(doc([node("a", { width: 4097 })]))).toThrow();
    const edges = Array.from({ length: 1000 }, (_, i) => ({
      id: "e" + i,
      source: "a",
      target: "a",
    }));
    expect(m.parseDiagram(doc([node()], edges)).edges).toHaveLength(1000);
    expect(() =>
      m.parseDiagram(
        doc([node()], edges.concat({ id: "extra", source: "a", target: "a" })),
      ),
    ).toThrow();
  });
});
describe("shared diagram rendering", () => {
  it("resolves nested positions and renders all declared shapes", () => {
    const nodes = [
      node("g", {
        position: { x: 50, y: 80 },
        data: { ...node().data, shape: "group" },
      }),
      node("a", { parentId: "g", position: { x: 15, y: 25 } }),
    ];
    expect(m.absolutePosition(nodes[1], nodes)).toEqual({ x: 65, y: 105 });
    for (const shape of [
      "process",
      "decision",
      "database",
      "text",
      "terminator",
      "ellipse",
      "document",
      "annotation",
      "group",
      "swimlane",
      "image",
    ]) {
      expect(m.SHAPES).toContain(shape);
      const n = node("a", { data: { ...node().data, shape } });
      expect(m.diagramToSvg(doc([n]))).toContain("<svg");
    }
  });
  it("fits every character of long multiline labels without clipping", () => {
    const label = "Long label with words and symbols <>& ".repeat(12);
    const n = m.parseDiagram(
      doc([node("a", { data: { ...node().data, label } })]),
    ).nodes[0];
    const lines = m.nodeLabelLines(n);
    expect(lines.join("")).toBe(label);
    expect(m.nodeLabelLayout(n).fontSize).toBeLessThan(13);
    expect(m.diagramToSvg(doc([n]))).not.toContain("<>&");
  });
  it("keeps backward routes, self loops, labels and arrowheads inside export bounds", () => {
    const d = m.parseDiagram(
      doc(
        [node("a", { position: { x: 200, y: 300 } }), node("b")],
        [
          {
            id: "e",
            source: "a",
            target: "b",
            kind: "curve",
            label: "Back",
            startArrow: "diamond",
            endArrow: "circle",
          },
          { id: "s", source: "a", target: "a", kind: "orthogonal" },
        ],
      ),
    );
    for (const e of d.edges) {
      const g = m.edgeGeometry(e, d.nodes);
      expect(g.path).toMatch(/^M /);
      expect(g.bounds.minY).toBeLessThanOrEqual(g.sourceY);
      expect(g.bounds.maxY).toBeGreaterThanOrEqual(g.sourceY);
    }
    const svg = m.diagramToSvg(d, { background: "transparent" });
    expect(svg).toContain("marker-start=");
    expect(svg).toContain("<circle");
    expect(svg).not.toContain('fill="transparent"');
  });
  it("embeds local images for portable SVG and fails for missing or unsafe data", async () => {
    const d = doc([
      node("a", {
        data: {
          ...node().data,
          shape: "image",
          image: { url: "/api/assets/a.png", alt: "Portrait" },
        },
      }),
    ]);
    const data =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jM7sAAAAASUVORK5CYII=";
    const svg = await m.diagramToPortableSvg(d, {
      resolveAsset: async () => data,
    });
    expect(svg).toContain(data);
    expect(svg).not.toContain('href="/api/assets/');
    await expect(
      m.diagramToPortableSvg(d, { resolveAsset: async () => null }),
    ).rejects.toThrow(/asset|image/i);
    await expect(
      m.diagramToPortableSvg(d, {
        resolveAsset: async () => "data:image/svg+xml;base64,PHN2Zz4=",
      }),
    ).rejects.toThrow(/asset|image/i);
  });
  it("rejects invalid backgrounds/scales before rasterization", async () => {
    expect(() => m.diagramToSvg(doc(), { background: "url(evil)" })).toThrow();
    await expect(m.diagramToPng(doc(), { scale: Infinity })).rejects.toThrow(
      /scale/i,
    );
  });
  it("provides fresh valid built-in templates", () => {
    for (const name of [
      "flow",
      "decision",
      "data",
      "architecture",
      "approval",
      "knowledge",
      "swimlane",
    ]) {
      const d = m.templateDiagram(name);
      expect(d.nodes.length).toBeGreaterThan(0);
      expect(m.parseDiagram(d)).toEqual(d);
      d.nodes.length = 0;
      expect(m.templateDiagram(name).nodes.length).toBeGreaterThan(0);
    }
  });
});
describe("adversarial rendering and portable paths", () => {
  it("accepts bundle paths while rejecting disguised remote or executable assets", () => {
    for (const url of [
      "../assets/photo.png",
      "assets/a%20b.png",
      "/api/okf/bundles/bundle-1/files?path=assets%2Fphoto.png",
    ])
      expect(m.isLocalAssetUrl(url)).toBe(true);
    for (const url of [
      "//evil/p.png",
      "https://evil/p.png",
      "javascript:alert(1)",
      "assets/%2f%2fevil",
      "a\\b",
      "/api/okf/bundles/b/files?path=..%2Fx",
      "/api/okf/bundles/b/files?path=%00x",
      "data:image/png;base64,AAAA",
    ])
      expect(m.isLocalAssetUrl(url)).toBe(false);
  });
  it("fits the maximum explicit line count even inside minimum dimensions", () => {
    const n = node("a", {
      width: 24,
      height: 24,
      data: { ...node().data, label: "\n".repeat(499) },
    });
    const layout = m.nodeLabelLayout(n);
    expect(layout.lines).toHaveLength(500);
    expect(layout.lines.length * layout.lineHeight).toBeLessThanOrEqual(8);
  });
  it("routes reverse orthogonal ports around their endpoint boxes", () => {
    const nodes = [node("a", { position: { x: 0, y: 300 } }), node("b")];
    const g = m.edgeGeometry(
      {
        source: "a",
        target: "b",
        kind: "orthogonal",
        sourceHandle: "out-bottom",
        targetHandle: "in-top",
      },
      nodes,
    );
    expect(g.bounds.minX < -20 || g.bounds.maxX > 200).toBe(true);
  });
  it("rejects oversized decoded image dimensions before browser rasterization", async () => {
    const bytes = Buffer.alloc(33);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
    bytes.writeUInt32BE(13, 8);
    bytes.write("IHDR", 12);
    bytes.writeUInt32BE(100000, 16);
    bytes.writeUInt32BE(100000, 20);
    const data = "data:image/png;base64," + bytes.toString("base64");
    const d = doc([
      node("a", {
        data: {
          ...node().data,
          shape: "image",
          image: { url: "/api/assets/a.png", alt: "" },
        },
      }),
    ]);
    await expect(
      m.diagramToPortableSvg(d, { assetData: { "/api/assets/a.png": data } }),
    ).rejects.toThrow(/dimension|pixel/i);
  });
  it("rejects excessive raster dimensions before resolving images", async () => {
    const d = doc([
      node("a", { position: { x: -100000, y: 0 } }),
      node("b", { position: { x: 100000, y: 0 } }),
    ]);
    await expect(m.diagramToPng(d, { scale: 1 })).rejects.toThrow(
      /raster bounds/i,
    );
  });
});
it("round trips portable note links with fragments and encoded names", () => {
  for (const url of [
    "../concepts/a%20note.md#block-1",
    "#block-id",
    "notes/%E2%9C%93.md",
  ]) {
    const d = doc([
      node("a", { data: { ...node().data, link: { kind: "url", url } } }),
    ]);
    expect(m.parseDiagram(d).nodes[0].data.link.url).toBe(url);
  }
  for (const url of [
    "//evil.test",
    "#a\n",
    "javascript%3Aalert(1)",
    "../bad\\name.md",
  ])
    expect(() =>
      m.parseDiagram(
        doc([
          node("a", { data: { ...node().data, link: { kind: "url", url } } }),
        ]),
      ),
    ).toThrow();
});
it("uses all four handles at persisted sizes and absolute group positions", () => {
  const nodes = m.parseDiagram(
    doc([
      node("frame", {
        position: { x: 100, y: 200 },
        data: { ...node().data, shape: "group" },
      }),
      node("a", {
        parentId: "frame",
        width: 240,
        height: 120,
        position: { x: 10, y: 20 },
      }),
      node("b", { position: { x: 600, y: 600 } }),
    ]),
  ).nodes;
  for (const [side, x, y] of [
    ["top", 230, 220],
    ["right", 350, 280],
    ["bottom", 230, 340],
    ["left", 110, 280],
  ]) {
    const g = m.edgeGeometry(
      {
        source: "a",
        target: "b",
        sourceHandle: `out-${side}`,
        targetHandle: "in-top",
        kind: "straight",
      },
      nodes,
    );
    expect([g.sourceX, g.sourceY]).toEqual([x, y]);
  }
});
it("includes every self-loop side pair and its labels within the SVG viewbox", () => {
  for (const from of ["top", "right", "bottom", "left"])
    for (const to of ["top", "right", "bottom", "left"]) {
      const d = m.parseDiagram(
        doc(
          [node()],
          [
            {
              id: "e",
              source: "a",
              target: "a",
              sourceHandle: `out-${from}`,
              targetHandle: `in-${to}`,
              label: "x".repeat(200),
              width: 12,
              startArrow: "diamond",
              endArrow: "circle",
            },
          ],
        ),
      );
      const g = m.edgeGeometry(d.edges[0], d.nodes),
        b = m.diagramBounds(d);
      expect(g.path).not.toContain("NaN");
      expect(b.x).toBeLessThan(g.bounds.minX);
      expect(b.x + b.width).toBeGreaterThan(g.bounds.maxX);
      expect(b.y).toBeLessThan(g.bounds.minY);
      expect(b.y + b.height).toBeGreaterThan(g.bounds.maxY);
    }
});
it("rejects unknown handles, boolean coercion and cumulative parent coordinates", () => {
  for (const fields of [
    { sourceHandle: "out-diagonal" },
    { targetHandle: 23 },
    { dashed: "false" },
    { width: 13 },
    { startArrow: "evil" },
  ])
    expect(() =>
      m.parseDiagram(
        doc([node()], [{ id: "e", source: "a", target: "a", ...fields }]),
      ),
    ).toThrow();
  expect(() =>
    m.parseDiagram(
      doc([
        node("frame", {
          position: { x: 100000, y: 0 },
          data: { ...node().data, shape: "group" },
        }),
        node("child", { parentId: "frame", position: { x: 1, y: 0 } }),
      ]),
    ),
  ).toThrow(/absolute/);
});
it("draws frames before edges and foreground nodes regardless of input order", () => {
  const d = doc(
    [
      node("child", { parentId: "frame" }),
      node("frame", { data: { ...node().data, shape: "group" } }),
    ],
    [{ id: "e", source: "child", target: "child" }],
  );
  const svg = m.diagramToSvg(d);
  expect(svg.indexOf('data-node-id="frame"')).toBeLessThan(
    svg.indexOf('data-node-id="child"'),
  );
  expect(svg.indexOf('data-node-id="frame"')).toBeLessThan(
    svg.indexOf("marker-end="),
  );
});
it("requires a caller resolver for relative portable assets", async () => {
  const d = doc([
    node("a", {
      data: {
        ...node().data,
        shape: "image",
        image: { url: "../assets/picture.png", alt: "" },
      },
    }),
  ]);
  await expect(m.diagramToPortableSvg(d)).rejects.toThrow(/resolver/);
});
it("wraps wide glyphs within the label area", () => {
  const n = node("a", { data: { ...node().data, label: "W".repeat(100) } }),
    layout = m.nodeLabelLayout(n);
  for (const line of layout.lines)
    expect(line.length * layout.fontSize * 0.944).toBeLessThanOrEqual(156);
});
it("includes wide connector labels in export bounds", () => {
  const d = m.parseDiagram(
      doc(
        [node()],
        [{ id: "e", source: "a", target: "a", label: "W".repeat(200) }],
      ),
    ),
    g = m.edgeGeometry(d.edges[0], d.nodes),
    b = m.diagramBounds(d);
  expect(b.x + b.width).toBeGreaterThan(g.labelX + (200 * 12 * 0.944) / 2);
  expect(b.x).toBeLessThan(g.labelX - (200 * 12 * 0.944) / 2);
});
it("rejects JSON arrays as edge handles before they reach renderers", () => {
  for (const fields of [
    { sourceHandle: ["out-top"] },
    { targetHandle: ["in-left"] },
  ]) {
    const value = JSON.stringify(
      doc([node()], [{ id: "e", source: "a", target: "a", ...fields }]),
    );
    expect(() => m.parseDiagram(value)).toThrow(/edge handle/);
  }
});
it("budgets every embedded image occurrence in synchronous and portable SVG", async () => {
  const bytes = Buffer.alloc(128 * 1024);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12);
  bytes.writeUInt32BE(1, 16);
  bytes.writeUInt32BE(1, 20);
  const data = "data:image/png;base64," + bytes.toString("base64");
  const d = doc(
    Array.from({ length: 241 }, (_, i) =>
      node("n" + i, {
        data: {
          ...node().data,
          shape: "image",
          image: { url: "/api/assets/repeated.png", alt: "" },
        },
      }),
    ),
  );
  expect(() =>
    m.diagramToSvg(d, { assetData: { "/api/assets/repeated.png": data } }),
  ).toThrow(/30 MB/);
  let error;
  try {
    await m.diagramToPortableSvg(d, { resolveAsset: async () => data });
  } catch (e) {
    error = e;
  }
  expect(error?.message).toMatch(/30 MB/);
});
it("preserves retained image data but only renders or resolves it on image shapes", async () => {
  const d = doc([
    node("a", {
      data: {
        ...node().data,
        image: { url: "/api/assets/retained.png", alt: "Retained" },
      },
    }),
  ]);
  expect(m.parseDiagram(d).nodes[0].data.image.url).toBe(
    "/api/assets/retained.png",
  );
  expect(m.diagramToSvg(d)).not.toContain("<image");
  const svg = await m.diagramToPortableSvg(d, {
    resolveAsset: async () => {
      throw new Error("Retained image must not resolve");
    },
  });
  expect(svg).not.toContain("<image");
});
