import { it, expect } from "vitest";
import { strFromU8 } from "fflate";
import { portableMarkdownFiles } from "../src/export-markdown.js";
import { exportPortableBundle } from "../src/okf/export-portable.js";
import { defaultDiagram } from "../src/diagram/model.js";
const fence = (d) => "```thread-diagram\n" + JSON.stringify(d) + "\n```";
it("packages native XML and rebases attachment references without requiring a PNG", async () => {
  const data = {
    ...defaultDiagram(),
    references: [
      {
        id: "r",
        label: "Brief",
        link: { kind: "asset", url: "/api/assets/brief.pdf", name: "Brief" },
      },
    ],
  };
  data.xml = data.xml.replace(
    "<root>",
    '<root><mxCell id="image" style="image=/api/assets/photo.png;"/>',
  );
  const original = JSON.stringify(data),
    requested = [];
  const files = await portableMarkdownFiles(
    { title: "Native", body: fence(data) },
    {
      fetchAsset: async (u) => {
        requested.push(u);
        return new Uint8Array([1]);
      },
    },
  );
  expect(requested.sort()).toEqual([
    "/api/assets/brief.pdf",
    "/api/assets/photo.png",
  ]);
  expect(strFromU8(files["diagrams/diagram-1.drawio"])).toContain(
    "image=../assets/photo.png;",
  );
  expect(
    JSON.parse(strFromU8(files["diagrams/diagram-1.json"])).references[0].link
      .url,
  ).toBe("../assets/brief.pdf");
  expect(files["diagrams/diagram-1.png"]).toBeUndefined();
  expect(strFromU8(files["README.txt"])).toContain("no saved PNG");
  expect(JSON.stringify(data)).toBe(original);
});
it("rebases OKF references and retains native output with missing-preview warnings", async () => {
  const data = {
    ...defaultDiagram(),
    references: [
      {
        id: "r",
        label: "Target",
        link: { kind: "block", noteId: "target", blockId: "a" },
      },
    ],
  };
  const body = fence(data),
    target = "<!-- thread:block id=a -->\nTarget";
  const result = await exportPortableBundle({
    id: "bundle",
    entries: [
      { path: "guides/start.md", source: body, body },
      {
        path: "concepts/target.md",
        noteId: "target",
        source: target,
        body: target,
      },
    ],
  });
  expect(result.files["_thread-export/0/diagram-1.drawio"]).toBeTruthy();
  expect(
    JSON.parse(strFromU8(result.files["_thread-export/0/diagram-1.json"]))
      .references[0].link.url,
  ).toBe("../../concepts/target.md#block-a");
  expect(result.warnings.join()).toContain("no saved PNG");
});
it("copies relative images from imported OKF native XML with single quoted attributes", async () => {
  const d = {
    ...defaultDiagram(),
    xml: "<mxGraphModel><root><mxCell id='x' style='image=../assets/photo.png;'/></root></mxGraphModel>",
  };
  const body = fence(d),
    requested = [];
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
        return new Uint8Array([1]);
      },
    },
  );
  expect(
    strFromU8(result.files["_thread-export/0/diagram-1.drawio"]),
  ).toContain("image=../../assets/photo.png;");
  expect(requested).toHaveLength(1);
});
it("rebases single quoted native XML link attributes", async () => {
  const d = {
    ...defaultDiagram(),
    xml: "<mxGraphModel><root><mxCell id='x' link='guide.md#section'/></root></mxGraphModel>",
  };
  const files = await portableMarkdownFiles({
    title: "Native",
    body: fence(d),
  });
  expect(strFromU8(files["diagrams/diagram-1.drawio"])).toContain(
    'link="../guide.md#section"',
  );
});
it("resolves native Thread shape links through projected OKF references", async () => {
  const d = {
    ...defaultDiagram(),
    xml: '<mxGraphModel><root><mxCell id="x" link="thread:r"/></root></mxGraphModel>',
    references: [
      { id: "r", label: "Target", link: { kind: "note", noteId: "target" } },
    ],
  };
  const body = fence(d),
    result = await exportPortableBundle({
      id: "b",
      entries: [
        { path: "start.md", source: body, body },
        {
          path: "target.md",
          source: "Target",
          body: "Target",
          noteId: "target",
        },
      ],
    });
  expect(
    strFromU8(result.files["_thread-export/0/diagram-1.drawio"]),
  ).toContain('link="../../target.md"');
});
it("preserves unresolved native Thread links and emits the existing reference warning", async () => {
  const d = {
    ...defaultDiagram(),
    xml: '<mxGraphModel><root><mxCell id="x" link="thread:r"/></root></mxGraphModel>',
    references: [
      { id: "r", label: "Missing", link: { kind: "note", noteId: "missing" } },
    ],
  };
  const files = await portableMarkdownFiles({
    title: "Missing",
    body: fence(d),
  });
  expect(strFromU8(files["diagrams/diagram-1.drawio"])).toContain(
    'link="thread:r"',
  );
  expect(strFromU8(files["README.txt"])).toContain(
    "requires its Thread workspace: missing",
  );
});
