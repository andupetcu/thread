import { it, expect } from "vitest";
import { strFromU8 } from "fflate";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { portableMarkdownFiles } from "../src/export-markdown.js";
import { exportPortableBundle } from "../src/okf/export-portable.js";
import { parseMindMap } from "../src/mindmap/model.js";
import { parseDiagram } from "../src/diagram/model.js";
const fence = (value) =>
  "```thread-mindmap\n" + JSON.stringify(value) + "\n```";
const map = () => ({
  version: 1,
  rootId: "root",
  layout: "both",
  nodes: [
    { id: "root", label: "Ideas" },
    { id: "child", parentId: "root", label: "Branch", collapsed: true },
    { id: "hidden", parentId: "child", label: "Retained hidden idea" },
  ],
});
const native = (files, path) =>
  parseMindMap(JSON.parse(strFromU8(files[path])));
it("exports native editable mind map JSON, projected PNGs and document links without changing source", async () => {
  const data = map();
  data.nodes[0].link = {
    kind: "asset",
    url: "/api/assets/brief.pdf",
    name: "Brief",
  };
  data.nodes[1].link = { kind: "note", noteId: "missing" };
  data.nodes[2].link = { kind: "url", url: "guide.md#section" };
  const original = JSON.stringify(data),
    requests = [],
    rendered = [];
  const files = await portableMarkdownFiles(
    { title: "Ideas", body: fence(data) },
    {
      fetchAsset: async (url) => {
        requests.push(url);
        return new Uint8Array([1, 2]);
      },
      renderDiagram: async (value) => {
        rendered.push(parseDiagram(value));
        return new Uint8Array([3]);
      },
    },
  );
  const sidecar = native(files, "mindmaps/mindmap-1.json");
  expect(sidecar.version).toBe(1);
  expect(sidecar.rootId).toBe("root");
  expect(sidecar.nodes).toHaveLength(3);
  expect(sidecar.nodes[2].link.url).toBe("../guide.md#section");
  expect(sidecar.nodes[0].link.url).toBe("../assets/brief.pdf");
  expect(requests).toEqual(["/api/assets/brief.pdf"]);
  expect(rendered).toHaveLength(1);
  expect(rendered[0].nodes).toHaveLength(2);
  expect(strFromU8(files["Ideas.md"])).toContain("```thread-mindmap");
  expect(strFromU8(files["README.txt"])).toContain("missing");
  expect(JSON.stringify(data)).toBe(original);
});
it("rewrites included OKF note/block/concept/bundle links and relative assets in native sidecars", async () => {
  const data = map();
  const links = [
    { kind: "note", noteId: "target" },
    { kind: "block", noteId: "target", blockId: "stable" },
    {
      kind: "concept",
      noteId: "target",
      bundleId: "bundle",
      path: "concepts/target.md",
    },
    { kind: "bundle", bundleId: "bundle" },
    { kind: "asset", url: "../assets/brief.pdf", name: "Brief" },
    { kind: "url", url: "../concepts/target.md#part" },
    { kind: "bundle", bundleId: "excluded" },
  ];
  data.nodes = [
    { id: "root", label: "Ideas" },
    ...links.map((link, index) => ({
      id: "idea-" + index,
      parentId: "root",
      label: "Idea " + index,
      link,
    })),
  ];
  const body = fence(data),
    target = "<!-- thread:block id=stable -->\n\nTarget";
  const result = await exportPortableBundle(
    {
      id: "bundle",
      entries: [
        { path: "guides/start.md", body, source: body },
        { path: "index.md", body: "Index", source: "Index" },
        {
          path: "concepts/target.md",
          noteId: "target",
          body: target,
          source: target,
        },
        { kind: "asset", path: "assets/brief.pdf" },
      ],
    },
    {
      fetchAsset: async () => new Uint8Array([1]),
      renderDiagram: async (value) => {
        expect(parseDiagram(value).version).toBe(2);
        return new Uint8Array([2]);
      },
    },
  );
  const sidecar = native(result.files, "_thread-export/0/mindmap-1.json");
  expect(sidecar.nodes.slice(1, 7).map((node) => node.link.url)).toEqual([
    "../../concepts/target.md",
    "../../concepts/target.md#block-stable",
    "../../concepts/target.md",
    "../../index.md",
    "../../assets/brief.pdf",
    "../../concepts/target.md#part",
  ]);
  expect(sidecar.nodes[7].link).toEqual({
    kind: "bundle",
    bundleId: "excluded",
  });
  expect(result.warnings).toEqual([
    "guides/start.md: excluded or missing mind map reference excluded",
  ]);
  expect(strFromU8(result.files["guides/start.md"])).toContain(
    '"url":"../concepts/target.md"',
  );
  expect(result.files["assets/brief.pdf"]).toEqual(new Uint8Array([1]));
});
it.each(["> ", "- ", "> 1. "])(
  "preserves mind map and preview containers (%s) in both exporters",
  async (prefix) => {
    const continuation = prefix.replace(/(?:[-+*]|\d+[.)])\s/g, (marker) =>
      " ".repeat(marker.length),
    );
    const body =
        prefix +
        fence(map())
          .split("\n")
          .join("\n" + continuation),
      options = { renderDiagram: async () => new Uint8Array([1]) };
    const plain = await portableMarkdownFiles(
        { title: "Nested", body },
        options,
      ),
      bundle = await exportPortableBundle(
        { id: "nested", entries: [{ path: "nested.md", body, source: body }] },
        options,
      );
    expect(bundle.warnings).toEqual([]);
    for (const markdown of [
      strFromU8(plain["Nested.md"]),
      strFromU8(bundle.files["nested.md"]),
    ]) {
      const found = [];
      const walk = (node, ancestors = []) => {
        if (["code", "image"].includes(node.type))
          found.push({ node, ancestors });
        for (const child of node.children || [])
          walk(child, [...ancestors, node.type]);
      };
      walk(unified().use(remarkParse).parse(markdown));
      const code = found.find((item) => item.node.type === "code"),
        image = found.find((item) => item.node.type === "image");
      expect(code.node.lang).toBe("thread-mindmap");
      expect(parseMindMap(code.node.value).nodes).toHaveLength(3);
      expect(image).toBeTruthy();
      for (const type of ["blockquote", "listItem"].filter((type) =>
        type === "blockquote"
          ? prefix.includes(">")
          : prefix.includes("-") || prefix.includes("1."),
      )) {
        expect(code.ancestors).toContain(type);
        expect(image.ancestors).toContain(type);
      }
    }
  },
);
it("retains invalid mind map source with a visible OKF export diagnostic", async () => {
  const body = '```thread-mindmap\n{"version":99}\n```';
  const result = await exportPortableBundle(
    { id: "bundle", entries: [{ path: "invalid.md", source: body, body }] },
    {
      renderDiagram: async () => {
        throw new Error("Must not render");
      },
    },
  );
  expect(strFromU8(result.files["invalid.md"])).toBe(body);
  expect(result.warnings[0]).toMatch(/mind map 1 retained as source/);
});
it("exports mixed diagram and mind map fences with independent editable formats and numbering", async () => {
  const diagram = { version: 2, nodes: [], edges: [] };
  const body =
    "```thread-diagram\n" +
    JSON.stringify(diagram) +
    "\n```\n\n" +
    fence(map());
  const options = { renderDiagram: async () => new Uint8Array([1]) };
  const files = await portableMarkdownFiles({ title: "Mixed", body }, options);
  expect(
    parseDiagram(JSON.parse(strFromU8(files["diagrams/diagram-1.json"])))
      .version,
  ).toBe(2);
  expect(native(files, "mindmaps/mindmap-1.json").version).toBe(1);
  const bundle = await exportPortableBundle(
    { id: "mixed", entries: [{ path: "mixed.md", body, source: body }] },
    options,
  );
  expect(bundle.warnings).toEqual([]);
  expect(
    parseDiagram(
      JSON.parse(strFromU8(bundle.files["_thread-export/0/diagram-1.json"])),
    ).version,
  ).toBe(2);
  expect(native(bundle.files, "_thread-export/0/mindmap-1.json").version).toBe(
    1,
  );
});
