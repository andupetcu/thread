import { test, expect } from "@playwright/test";
import { unzipSync, strFromU8 } from "fflate";
import { writeFile } from "node:fs/promises";
test("exports multipage PDF, Word with real images and portable diagram bundle", async ({
  page,
}, testInfo) => {
  test.setTimeout(90000);
  await page.goto("http://127.0.0.1:5173/tests/exports-harness.html");
  await page.waitForFunction(() => typeof window.exportSample === "function");
  const pdf = Buffer.from(
    await page.evaluate(() => window.exportSample("pdf")),
  );
  expect(pdf.length).toBeGreaterThan(100000);
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  expect(
    (pdf.toString("latin1").match(/\/Type \/Page\b/g) || []).length,
  ).toBeGreaterThan(1);
  await writeFile(testInfo.outputPath("sample.pdf"), pdf);
  const docx = Buffer.from(
    await page.evaluate(() => window.exportSample("docx")),
  );
  const files = unzipSync(docx);
  expect(
    Object.keys(files).some(
      (path) => path.startsWith("word/media/") && path.endsWith(".png"),
    ),
  ).toBe(true);
  expect(strFromU8(files["word/document.xml"])).toContain("Decision 32");
  await writeFile(testInfo.outputPath("sample.docx"), docx);
  const zip = unzipSync(
    new Uint8Array(await page.evaluate(() => window.exportSample("markdown"))),
  );
  expect(zip["diagrams/diagram-1.png"].subarray(0, 4)).toEqual(
    new Uint8Array([137, 80, 78, 71]),
  );
  expect(strFromU8(zip["Diagram.md"])).toContain("```thread-diagram");
});
