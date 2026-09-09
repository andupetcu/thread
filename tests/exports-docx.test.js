// @vitest-environment jsdom
import { it, expect } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { toDocx } from "../src/export-docx";
it("embeds actual image media and keeps nested headings and tables", async () => {
  const root = document.createElement("div");
  root.innerHTML =
    '<div><h2>Details</h2><p>A <strong>bold</strong> thought <img src="/image.png" alt="Photo"></p></div><table><tr><th>Heading</th></tr><tr><td>Cell</td></tr></table>';
  const blob = await toDocx("Report", root, {
    imageLoader: async () => ({
      data: new Uint8Array([137, 80, 78, 71]),
      width: 320,
      height: 180,
    }),
  });
  const buffer = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsArrayBuffer(blob);
  });
  const zip = unzipSync(new Uint8Array(buffer));
  expect(
    Object.keys(zip).some(
      (path) => path.startsWith("word/media/") && path.endsWith(".png"),
    ),
  ).toBe(true);
  const xml = strFromU8(zip["word/document.xml"]);
  expect(xml).toContain('w:val="Heading2"');
  expect(xml).toContain("<w:drawing>");
  expect(xml).toContain("<w:tbl>");
  expect(xml).toContain("bold");
});
