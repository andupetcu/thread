import { expect } from "@playwright/test";
import { defaultDiagram } from "../src/diagram/model.js";
export function nativeDiagram(label = "Process") {
  const value = label
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");
  return {
    ...defaultDiagram(),
    xml: `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="process" value="${value}" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="100" y="100" width="180" height="80" as="geometry"/></mxCell></root></mxGraphModel>`,
  };
}
export async function importDrawio(page, label) {
  await expect(
    page.getByRole("button", { name: "Save diagram", exact: true }),
  ).toBeEnabled({ timeout: 30000 });
  const toggle = page.getByRole("button", {
    name: "References and library",
    exact: true,
  });
  if ((await toggle.getAttribute("aria-expanded")) === "false")
    await toggle.click();
  await page
    .getByLabel("Import diagram", { exact: true })
    .setInputFiles({
      name: "sample.drawio",
      mimeType: "application/xml",
      buffer: Buffer.from(nativeDiagram(label).xml),
    });
  await page
    .getByRole("button", { name: "Replace canvas", exact: true })
    .click();
  await expect(
    page
      .frameLocator('iframe[title="draw.io diagram editor"]')
      .locator(".geDiagramContainer"),
  ).toBeVisible();
}
