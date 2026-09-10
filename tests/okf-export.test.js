import { defaultDiagram } from "../src/diagram/model.js";
const nativeDiagram = () => ({
  ...defaultDiagram(),
  preview:
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=",
});
import { it, expect } from "vitest";
import { strFromU8 } from "fflate";
import {
  exportPortableBundle,
  bundleExportWarnings,
} from "../src/okf/export-portable.js";

it("reports possible credentials before export without repeating their contents", () => {
  const warnings = bundleExportWarnings({
    entries: [
      {
        path: "private.md",
        source:
          "-----BEGIN PRIVATE KEY-----\nexample\n-----END PRIVATE KEY-----",
      },
    ],
  });
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toContain("private.md");
  expect(warnings[0]).not.toContain("BEGIN PRIVATE KEY");
});

it("exports frontmatter first with unknown fields, stable paths, assets and visual diagram sidecars", async () => {
  const body =
    "![File](/api/assets/image.png)\n\n```thread-diagram\n" +
    JSON.stringify(nativeDiagram()) +
    "\n```";
  const source = "---\ntype: Guide\ncustom: {keep: null}\n---\n" + body;
  const result = await exportPortableBundle(
    {
      id: "bundle",
      entries: [
        {
          path: "guides/intro.md",
          kind: "document",
          noteId: "intro",
          source,
          body,
        },
        { path: "assets/original.txt", kind: "asset", url: "/api/okf/file" },
      ],
    },
    {
      fetchAsset: async () => new Uint8Array([1, 2]),
      renderDiagram: async () => new Uint8Array([3, 4]),
    },
  );
  const markdown = strFromU8(result.files["guides/intro.md"]);
  expect(markdown).toMatch(/^---\ntype: Guide\ncustom: \{keep: null\}\n---\n/);
  expect(markdown).not.toContain("/api/assets/");
  expect(markdown).toMatch(
    /!\[Diagram 1\]\(\/_thread-export\/0\/diagram-1.png\)/,
  );
  expect(result.files["_thread-export/0/diagram-1.json"]).toBeDefined();
  expect(result.files["assets/original.txt"]).toEqual(new Uint8Array([1, 2]));
  expect(result.warnings).toEqual([]);
});

it("converts included note and block references without touching code and reports excluded references", async () => {
  const target = "<!-- thread:block id=b1 -->\nTarget content";
  const body =
    "[Target](note:n2) [Block](block:n2/b1) [Missing](note:outside)\n\n`[code](note:n2)`\n\n![[n2#b1]]";
  const result = await exportPortableBundle({
    id: "bundle",
    entries: [
      {
        path: "a.md",
        kind: "document",
        noteId: "n1",
        source: "---\ntype: Guide\n---\n" + body,
        body,
      },
      {
        path: "nested/b.md",
        kind: "document",
        noteId: "n2",
        source: "---\ntype: Guide\n---\n" + target,
        body: target,
      },
    ],
  });
  const markdown = strFromU8(result.files["a.md"]);
  expect(markdown).toContain("[Target](/nested/b.md)");
  expect(markdown).toContain("[Block](/nested/b.md#block-b1)");
  expect(markdown).toContain("`[code](note:n2)`");
  expect(markdown).toContain("> Target content");
  expect(strFromU8(result.files["nested/b.md"])).toContain(
    '<a id="block-b1"></a>',
  );
  expect(result.warnings.some((warning) => warning.includes("outside"))).toBe(
    true,
  );
});

it("does not overwrite existing files when allocating generated diagram paths", async () => {
  const body =
    "```thread-diagram\n" + JSON.stringify(nativeDiagram()) + "\n```";
  const result = await exportPortableBundle(
    {
      id: "bundle",
      entries: [
        { path: "a.md", kind: "document", source: body, body },
        {
          path: "_thread-export/0/diagram-1.png",
          kind: "asset",
          url: "/original",
        },
      ],
    },
    {
      fetchAsset: async () => new Uint8Array([1]),
      renderDiagram: async () => new Uint8Array([2]),
    },
  );
  expect(result.files["_thread-export/0/diagram-1.png"]).toEqual(
    new Uint8Array([1]),
  );
  expect(result.files["_thread-export-2/0/diagram-1.png"]).toEqual(
    new Uint8Array([2]),
  );
});
