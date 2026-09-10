import { defaultDiagram } from "../src/diagram/model.js";
const nativeDiagram = () => ({
  ...defaultDiagram(),
  preview:
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=",
});
import { it, expect } from "vitest";
import { portableMarkdownFiles } from "../src/export-markdown";
it("collects only live attachment links and preserves code examples and block IDs", async () => {
  const source =
    "<!-- thread:block id=b1 -->\n\n![Photo](/api/assets/one.png)\n\n[File](/api/assets/report.pdf)\n\n```md\n![Example](/api/assets/ignore.png)\n```";
  const requested = [];
  const files = await portableMarkdownFiles(
    { id: "n1", title: "Report", body: source },
    {
      fetchAsset: async (url) => {
        requested.push(url);
        return new Uint8Array([1, 2, 3]);
      },
    },
  );
  expect(requested).toEqual(["/api/assets/one.png", "/api/assets/report.pdf"]);
  const body = new TextDecoder().decode(files["Report.md"]);
  expect(body).toContain("![Photo](assets/one.png)");
  expect(body).toContain("[File](assets/report.pdf)");
  expect(body).toContain("![Example](/api/assets/ignore.png)");
  expect(body).toContain("thread:block id=b1");
});
it("includes diagram source and PNG previews while retaining editable fenced JSON", async () => {
  const diagram = nativeDiagram();
  const files = await portableMarkdownFiles(
    {
      title: "Plan",
      body: "```thread-diagram\n" + JSON.stringify(diagram) + "\n```",
    },
    { renderDiagram: async () => new Uint8Array([137, 80, 78, 71]) },
  );
  expect(
    JSON.parse(new TextDecoder().decode(files["diagrams/diagram-1.json"])),
  ).toEqual(diagram);
  expect(files["diagrams/diagram-1.png"]).toEqual(
    new Uint8Array([137, 80, 78, 71]),
  );
  const body = new TextDecoder().decode(files["Plan.md"]);
  expect(body).toContain("```thread-diagram");
  expect(body).toContain("![Diagram 1](diagrams/diagram-1.png)");
});
it("fails the portable export visibly when an attachment cannot be fetched", async () => {
  await expect(
    portableMarkdownFiles(
      { title: "Test", body: "![Missing](/api/assets/missing.png)" },
      {
        fetchAsset: async () => {
          throw new Error("Missing attachment");
        },
      },
    ),
  ).rejects.toThrow("Missing attachment");
});
it("rewrites link destinations rather than matching attachment URLs in labels or titles", async () => {
  const files = await portableMarkdownFiles(
    {
      title: "Test",
      body: '[see /api/assets/a.png](/api/assets/a.png "/api/assets/a.png")\n\n[asset]: /api/assets/a.png "Keep title"',
    },
    { fetchAsset: async () => new Uint8Array([1]) },
  );
  const body = new TextDecoder().decode(files["Test.md"]);
  expect(body).toContain(
    '[see /api/assets/a.png](assets/a.png "/api/assets/a.png")',
  );
  expect(body).toContain('[asset]: assets/a.png "Keep title"');
});
