import { it, expect } from "vitest";
import { strFromU8 } from "fflate";
import { portableMarkdownFiles } from "../src/export-markdown.js";
import { parseDiagram } from "../src/diagram/model.js";
import { exportPortableBundle } from "../src/okf/export-portable.js";

function document() {
  return {
    version: 2,
    nodes: [
      {
        id: "image",
        type: "diagramShape",
        position: { x: 0, y: 0 },
        width: 220,
        height: 150,
        data: {
          shape: "image",
          label: "Screenshot",
          color: "#ffffff",
          image: { url: "/api/assets/photo.png", alt: "Screenshot" },
          link: { kind: "asset", url: "/api/assets/brief.pdf", name: "Brief" },
        },
      },
      {
        id: "concept",
        type: "diagramShape",
        position: { x: 300, y: 0 },
        width: 180,
        height: 90,
        data: {
          shape: "process",
          label: "Concept",
          color: "#ffffff",
          link: { kind: "note", noteId: "target" },
        },
      },
    ],
    edges: [],
  };
}
const fence = (data) => "```thread-diagram\n" + JSON.stringify(data) + "\n```";

it("packages diagram images and documents with paths relative to each editable representation", async () => {
  const original = document();
  const requested = [];
  const files = await portableMarkdownFiles(
    { title: "Diagram note", body: fence(original) },
    {
      fetchAsset: async (url) => {
        requested.push(url);
        return new Uint8Array([1, 2, 3]);
      },
      renderDiagram: async (data) => {
        expect(data.nodes[0].data.image.url).toBe("/api/assets/photo.png");
        return new Uint8Array([4]);
      },
    },
  );
  expect(requested.sort()).toEqual([
    "/api/assets/brief.pdf",
    "/api/assets/photo.png",
  ]);
  expect(files["assets/photo.png"]).toEqual(new Uint8Array([1, 2, 3]));
  const sidecar = parseDiagram(
    JSON.parse(strFromU8(files["diagrams/diagram-1.json"])),
  );
  expect(sidecar.nodes[0].data.image.url).toBe("../assets/photo.png");
  expect(sidecar.nodes[0].data.link.url).toBe("../assets/brief.pdf");
  expect(strFromU8(files["Diagram note.md"])).toContain(
    '"url":"assets/photo.png"',
  );
  expect(strFromU8(files["README.txt"])).toContain("target");
  expect(original.nodes[0].data.image.url).toBe("/api/assets/photo.png");
});

it("converts included diagram concept links and packages nested assets in OKF exports", async () => {
  const diagram = document();
  const body = fence(diagram);
  const result = await exportPortableBundle(
    {
      id: "bundle",
      entries: [
        {
          path: "guides/start.md",
          noteId: "start",
          body,
          source: "---\ntype: Guide\n---\n" + body,
        },
        {
          path: "concepts/target.md",
          noteId: "target",
          body: "Target",
          source: "---\ntype: Concept\n---\nTarget",
        },
      ],
    },
    {
      fetchAsset: async () => new Uint8Array([1]),
      renderDiagram: async () => new Uint8Array([2]),
    },
  );
  expect(result.warnings).toEqual([]);
  const sidecar = parseDiagram(
    JSON.parse(strFromU8(result.files["_thread-export/0/diagram-1.json"])),
  );
  expect(sidecar.nodes[0].data.image.url).toBe("../assets/photo.png");
  expect(sidecar.nodes[1].data.link).toEqual({
    kind: "url",
    url: "../../concepts/target.md",
  });
  const markdown = strFromU8(result.files["guides/start.md"]);
  expect(markdown).toContain('"url":"../_thread-export/assets/photo.png"');
  expect(markdown).toContain('"url":"../concepts/target.md"');
});

it("resolves imported relative bundle image bytes for PNG rendering and valid editable sidecars", async () => {
  const data = document();
  data.nodes = [data.nodes[0]];
  data.nodes[0].data.image.url = "../assets/photo.png";
  delete data.nodes[0].data.link;
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
  const requested = [],
    rendered = [];
  const body = fence(data);
  const result = await exportPortableBundle(
    {
      id: "imported",
      entries: [
        { path: "guides/start.md", source: body, body },
        { kind: "asset", path: "assets/photo.png" },
      ],
    },
    {
      fetchAsset: async (url) => {
        requested.push(url);
        return png;
      },
      renderDiagram: async (diagram, options) => {
        const value = await options.resolveAsset(
          diagram.nodes[0].data.image.url,
        );
        expect(value).toBe(
          "data:image/png;base64," + Buffer.from(png).toString("base64"),
        );
        rendered.push(value);
        return new Uint8Array([9]);
      },
    },
  );
  expect(result.warnings).toEqual([]);
  expect(rendered).toHaveLength(1);
  expect(requested).toEqual([
    "/api/okf/bundles/imported/files?path=assets%2Fphoto.png",
  ]);
  expect(result.files["assets/photo.png"]).toEqual(png);
  const sidecar = parseDiagram(
    JSON.parse(strFromU8(result.files["_thread-export/0/diagram-1.json"])),
  );
  expect(sidecar.nodes[0].data.image.url).toBe("../../assets/photo.png");
});

it("keeps colliding flattened asset URLs distinct across diagrams and Markdown entries", async () => {
  const urls = [
    "/api/okf/bundles/b/files?path=a%2Fb.png",
    "/api/okf/bundles/b/files?path=a_b.png",
    "/api/assets/b-a_b.png",
  ];
  const bytes = urls.map(
    (_, index) => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, index]),
  );
  const requested = [];
  const entries = urls.slice(0, 2).map((url, index) => {
    const data = document();
    data.nodes = [data.nodes[0]];
    data.nodes[0].data.image.url = url;
    delete data.nodes[0].data.link;
    const body = fence(data);
    return { path: `guide-${index}.md`, source: body, body };
  });
  entries.push({
    path: "plain.md",
    source: `![Image](${urls[2]})`,
    body: `![Image](${urls[2]})`,
  });
  const result = await exportPortableBundle(
    { id: "b", entries },
    {
      fetchAsset: async (url) => {
        requested.push(url);
        return bytes[urls.indexOf(url)];
      },
      renderDiagram: async (data, options) => {
        const index = urls.indexOf(data.nodes[0].data.image.url);
        expect(await options.resolveAsset(data.nodes[0].data.image.url)).toBe(
          "data:image/png;base64," +
            Buffer.from(bytes[index]).toString("base64"),
        );
        return new Uint8Array([9]);
      },
    },
  );
  expect(result.warnings).toEqual([]);
  expect(requested).toEqual(urls);
  const sidecars = [0, 1].map((index) =>
    parseDiagram(
      JSON.parse(
        strFromU8(result.files[`_thread-export/${index}/diagram-1.json`]),
      ),
    ),
  );
  const targets = sidecars.map((data) =>
    data.nodes[0].data.image.url.replace("../", "_thread-export/"),
  );
  expect(new Set(targets).size).toBe(2);
  targets.forEach((target, index) =>
    expect(result.files[target]).toEqual(bytes[index]),
  );
  expect(result.files["_thread-export/assets/b-a_b-3.png"]).toEqual(bytes[2]);
  expect(strFromU8(result.files["plain.md"])).toContain(
    "/_thread-export/assets/b-a_b-3.png",
  );
});

it.each(["> ", "- ", "> 1. "])(
  "preserves diagram fences and previews inside Markdown containers (%s)",
  async (prefix) => {
    const { unified } = await import("unified");
    const { default: remarkParse } = await import("remark-parse");
    const data = document();
    data.nodes = [data.nodes[1]];
    delete data.nodes[0].data.link;
    const continuation = prefix.replace(/(?:[-+*]|\d+[.)])\s/g, (marker) =>
      " ".repeat(marker.length),
    );
    const body =
      prefix +
      fence(data)
        .split("\n")
        .join("\n" + continuation);
    const options = { renderDiagram: async () => new Uint8Array([1]) };
    const plain = await portableMarkdownFiles(
      { title: "Nested", body },
      options,
    );
    const bundle = await exportPortableBundle(
      { id: "nested", entries: [{ path: "nested.md", source: body, body }] },
      options,
    );
    expect(bundle.warnings).toEqual([]);
    for (const markdown of [
      strFromU8(plain["Nested.md"]),
      strFromU8(bundle.files["nested.md"]),
    ]) {
      const found = [];
      const walk = (node, ancestors = []) => {
        if (node.type === "code" || node.type === "image")
          found.push({ node, ancestors });
        for (const child of node.children || [])
          walk(child, [...ancestors, node.type]);
      };
      walk(unified().use(remarkParse).parse(markdown));
      const code = found.find((item) => item.node.type === "code");
      expect(code.node.lang).toBe("thread-diagram");
      expect(parseDiagram(code.node.value).nodes).toHaveLength(1);
      const preview = found.find((item) => item.node.type === "image");
      expect(preview).toBeTruthy();
      for (const type of ["blockquote", "listItem"].filter((type) =>
        type === "blockquote"
          ? prefix.includes(">")
          : prefix.includes("-") || prefix.includes("1."),
      )) {
        expect(code.ancestors).toContain(type);
        expect(preview.ancestors).toContain(type);
      }
    }
  },
);

it("rebases existing relative URL links and fragments for sidecars while preserving external URLs", async () => {
  const data = document();
  const base = data.nodes[1];
  const urls = [
    "../concepts/target.md#part",
    "./other.md#local",
    "#local",
    "https://example.com/page#part",
  ];
  data.nodes = urls.map((url, index) => ({
    ...structuredClone(base),
    id: "node-" + index,
    data: { ...base.data, link: { kind: "url", url } },
  }));
  const body = fence(data);
  const result = await exportPortableBundle(
    {
      id: "relative",
      entries: [{ path: "guides/start.md", source: body, body }],
    },
    { renderDiagram: async () => new Uint8Array([1]) },
  );
  expect(result.warnings).toEqual([]);
  const sidecar = parseDiagram(
    JSON.parse(strFromU8(result.files["_thread-export/0/diagram-1.json"])),
  );
  expect(sidecar.nodes.map((node) => node.data.link.url)).toEqual([
    "../../concepts/target.md#part",
    "../../guides/other.md#local",
    "../../guides/start.md#local",
    urls[3],
  ]);
  expect(strFromU8(result.files["guides/start.md"])).toContain(
    "../concepts/target.md#part",
  );
  const plainData = structuredClone(data);
  plainData.nodes[0].data.link.url = "concepts/target.md#part";
  const plain = await portableMarkdownFiles(
    { title: "Diagram note", body: fence(plainData) },
    { renderDiagram: async () => new Uint8Array([1]) },
  );
  const plainSidecar = parseDiagram(
    JSON.parse(strFromU8(plain["diagrams/diagram-1.json"])),
  );
  expect(plainSidecar.nodes.map((node) => node.data.link.url)).toEqual([
    "../concepts/target.md#part",
    "../other.md#local",
    "../Diagram%20note.md#local",
    urls[3],
  ]);
});
