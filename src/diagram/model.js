import { SaxesParser } from "saxes";
import { parseFragment } from "parse5";
import {
  readEnvelope,
  invalid,
  parseReferences,
  parsePreview,
  savedPng,
  previewSvg,
} from "../visual/model.js";
export { isLocalAssetUrl } from "../visual/model.js";
// Inspect interpreted markup and URL values, never ordinary label text.
const unsafeTags = new Set([
  "script",
  "iframe",
  "object",
  "embed",
  "base",
  "meta",
  "link",
  "style",
]);
function decodedUrl(value) {
  let result = value;
  for (let i = 0; i < 4; i++)
    result = result
      .replace(/&amp;/gi, "&")
      .replace(/&colon;/gi, ":")
      .replace(/&(?:Tab|NewLine);/gi, "")
      .replace(/&#(?:x([\da-f]+)|(\d+));/gi, (_, h, n) =>
        String.fromCodePoint(parseInt(h || n, h ? 16 : 10)),
      );
  return result.replace(/[\x00-\x20\x7f]/g, "");
}
function validateUrl(value) {
  if (
    /^(?:javascript|vbscript|file):|^data:(?!image\/(?:png|jpeg|gif|webp)[;,])/i.test(
      decodedUrl(value),
    )
  )
    invalid("unsafe XML link URL");
}
function validateMarkup(name, attrs) {
  if (unsafeTags.has(name.toLowerCase())) invalid("unsafe XML/HTML tag");
  for (const attr of attrs) {
    const key = attr.name.toLowerCase();
    if (/^on[a-z]+$/.test(key) || key === "srcdoc")
      invalid("unsafe XML/HTML attribute");
    if (
      [
        "link",
        "href",
        "src",
        "xlink:href",
        "action",
        "formaction",
        "poster",
        "background",
      ].includes(key)
    )
      validateUrl(attr.value);
    if (key === "style") {
      if (/expression\s*\(/i.test(attr.value))
        invalid("unsafe style expression");
      for (const match of attr.value.matchAll(
        /(?:^|;)image=([^;]+)|url\(\s*["']?([^"')]+)["']?\s*\)/gi,
      ))
        validateUrl(match[1] ?? match[2]);
    }
  }
}
function validateHtmlLabel(html) {
  const root = parseFragment(html);
  let count = 0;
  function visit(node, depth) {
    if (++count > 50000 || depth > 64) invalid("HTML label complexity");
    if (node.tagName) validateMarkup(node.tagName, node.attrs || []);
    for (const child of node.childNodes || []) visit(child, depth + 1);
    if (node.content) visit(node.content, depth + 1);
  }
  visit(root, 0);
}
export const defaultDiagram = () => ({
  version: 3,
  engine: "drawio",
  xml: '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>',
  references: [],
});
export function parseDiagram(value) {
  if (value == null || value === "") return defaultDiagram();
  const d = readEnvelope(value);
  if (
    d.version !== 3 ||
    d.engine !== "drawio" ||
    typeof d.xml !== "string" ||
    d.xml.length > 4000000
  )
    invalid("native draw.io envelope");
  const xml = d.xml;
  if (!/^\s*(?:<\?xml[^?]*\?>\s*)?<(mxGraphModel|mxfile)(?:\s|>)/.test(xml))
    invalid("unsupported draw.io XML root");
  const parser = new SaxesParser();
  let elements = 0,
    hasModel = false;
  const ancestors = [];
  parser.on("error", () => invalid("malformed XML"));
  parser.on("doctype", () => invalid("XML DTD"));
  parser.on("opentag", (tag) => {
    if (++elements > 50000) invalid("XML element count");
    if (tag.name === "mxGraphModel") hasModel = true;
    validateMarkup(
      tag.name,
      Object.entries(tag.attributes).map(([name, value]) => ({ name, value })),
    );
    if (/(?:^|;)html=1(?:;|$)/.test(tag.attributes.style || "")) {
      for (const attrs of [tag.attributes, ancestors.at(-1)?.attributes])
        for (const key of ["value", "label"])
          if (attrs?.[key]) validateHtmlLabel(attrs[key]);
    }
    ancestors.push(tag);
  });
  parser.on("closetag", () => ancestors.pop());
  parser.write(xml).close();
  if (!hasModel) invalid("uncompressed mxGraphModel required");
  const result = {
    version: 3,
    engine: "drawio",
    xml,
    references: parseReferences(d.references),
  };
  if (d.preview !== undefined) result.preview = parsePreview(d.preview);
  return result;
}
export const diagramToPng = (value) => savedPng(parseDiagram(value));
export const diagramToSvg = (value) => previewSvg(parseDiagram(value));
