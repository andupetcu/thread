import { it, expect } from "vitest";
import { strFromU8 } from "fflate";
import { portableMarkdownFiles } from "../src/export-markdown.js";
import { defaultMindMap } from "../src/mindmap/model.js";
it("exports Drawnix elements losslessly with native asset URLs rebased and saved PNG included", async () => {
  const preview =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=";
  const d = {
    ...defaultMindMap(),
    elements: [
      {
        id: "x",
        type: "image",
        points: [
          [0, 0],
          [100, 100],
        ],
        angle: 0,
        url: "/api/assets/photo.png",
        custom: { retained: true },
      },
    ],
    preview,
  };
  const files = await portableMarkdownFiles(
    { title: "Map", body: "```thread-mindmap\n" + JSON.stringify(d) + "\n```" },
    { fetchAsset: async () => new Uint8Array([1]) },
  );
  const native = JSON.parse(strFromU8(files["mindmaps/mindmap-1.drawnix"]));
  expect(native.elements[0]).toEqual({
    ...d.elements[0],
    url: "../assets/photo.png",
  });
  expect(files["mindmaps/mindmap-1.png"].slice(0, 4)).toEqual(
    new Uint8Array([137, 80, 78, 71]),
  );
  expect(strFromU8(files["Map.md"])).toContain("mindmap-1.drawnix");
});
