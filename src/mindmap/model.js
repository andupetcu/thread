import { validateNativeElements, validateNativeViewport } from "./structure.js";
import {
  readEnvelope,
  invalid,
  parseReferences,
  parsePreview,
  savedPng,
  previewSvg,
} from "../visual/model.js";
export const defaultMindMap = () => ({
  version: 2,
  engine: "drawnix",
  elements: [],
  references: [],
});
export function parseMindMap(value) {
  if (value == null || value === "") return defaultMindMap();
  const d = readEnvelope(value);
  if (
    d.version !== 2 ||
    d.engine !== "drawnix" ||
    !Array.isArray(d.elements) ||
    d.elements.length > 10000 ||
    d.elements.some((v) => !v || typeof v !== "object" || Array.isArray(v))
  )
    invalid("native Drawnix envelope");
  validateNativeElements(d.elements);
  if (d.viewport !== undefined) validateNativeViewport(d.viewport);
  const result = { version: 2, engine: "drawnix", elements: d.elements };
  for (const key of ["viewport", "theme"])
    if (d[key] !== undefined) {
      if (!d[key] || typeof d[key] !== "object" || Array.isArray(d[key]))
        invalid(key);
      result[key] = d[key];
    }
  result.references = parseReferences(d.references);
  if (d.preview !== undefined) result.preview = parsePreview(d.preview);
  return result;
}
export const mindMapToPng = (value) => savedPng(parseMindMap(value));
export const mindMapToSvg = (value) => previewSvg(parseMindMap(value));
