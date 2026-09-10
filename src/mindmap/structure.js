import { invalid } from "../visual/model.js";
// Minimum rendering contract from the pinned Plait 0.89 / Drawnix 0.4 models.
// Keep extension fields intact; only inspect fields consumed by native renderers.
const record = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const id = (v) =>
  typeof v === "string" &&
  v.length > 0 &&
  v.length <= 200 &&
  !/[\x00-\x1f\x7f]/.test(v);
const number = (v) =>
  typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 1e7;
const point = (v) => Array.isArray(v) && v.length === 2 && v.every(number);
const requireValue = (condition, detail) => {
  if (!condition) invalid(`Drawnix ${detail}`);
};
function points(value, min, max = 100000) {
  requireValue(
    Array.isArray(value) &&
      value.length >= min &&
      value.length <= max &&
      value.every(point),
    "coordinates",
  );
}
function text(value, depth = 0) {
  requireValue(record(value) && depth <= 32, "text");
  if (typeof value.text === "string") {
    requireValue(!("children" in value), "text leaf");
    return;
  }
  requireValue(
    Array.isArray(value.children) && value.children.length > 0,
    "text children",
  );
  value.children.forEach((child) => text(child, depth + 1));
}
function paragraph(value) {
  requireValue(record(value) && Array.isArray(value.children), "paragraph");
  text(value);
}
const shapes = new Set([
  "rectangle",
  "ellipse",
  "diamond",
  "roundRectangle",
  "parallelogram",
  "text",
  "triangle",
  "leftArrow",
  "trapezoid",
  "rightArrow",
  "cross",
  "star",
  "pentagon",
  "hexagon",
  "octagon",
  "pentagonArrow",
  "processArrow",
  "twoWayArrow",
  "comment",
  "roundComment",
  "cloud",
  "process",
  "decision",
  "data",
  "connector",
  "terminal",
  "manualInput",
  "preparation",
  "manualLoop",
  "merge",
  "delay",
  "storedData",
  "or",
  "summingJunction",
  "predefinedProcess",
  "offPage",
  "document",
  "multiDocument",
  "database",
  "hardDisk",
  "internalStorage",
  "noteCurlyRight",
  "noteCurlyLeft",
  "noteSquare",
  "display",
  "actor",
  "useCase",
  "container",
  "note",
  "simpleClass",
  "activityClass",
  "branchMerge",
  "port",
  "package",
  "combinedFragment",
  "class",
  "interface",
  "object",
  "component",
  "componentBox",
  "template",
  "activation",
  "deletion",
  "assembly",
  "providedInterface",
  "requiredInterface",
]);
const markers = new Set([
  "arrow",
  "none",
  "open-triangle",
  "solid-triangle",
  "sharp-arrow",
  "one-side-up",
  "one-side-down",
  "hollow-triangle",
  "single-slash",
]);
function table(element) {
  for (const [key, size] of [
    ["rows", "height"],
    ["columns", "width"],
  ]) {
    requireValue(
      Array.isArray(element[key]) && element[key].length > 0,
      "table " + key,
    );
    const ids = new Set();
    for (const item of element[key]) {
      requireValue(
        record(item) && id(item.id) && !ids.has(item.id),
        "table ID",
      );
      ids.add(item.id);
      if (item[size] !== undefined)
        requireValue(number(item[size]) && item[size] > 0, "table dimensions");
    }
  }
  requireValue(Array.isArray(element.cells), "table cells");
  const rows = new Set(element.rows.map((r) => r.id)),
    columns = new Set(element.columns.map((c) => c.id)),
    ids = new Set();
  for (const cell of element.cells) {
    requireValue(
      record(cell) &&
        id(cell.id) &&
        !ids.has(cell.id) &&
        rows.has(cell.rowId) &&
        columns.has(cell.columnId),
      "table cell",
    );
    ids.add(cell.id);
    for (const key of ["rowspan", "colspan"])
      if (cell[key] !== undefined)
        requireValue(
          Number.isSafeInteger(cell[key]) && cell[key] > 0 && cell[key] < 10000,
          "table span",
        );
    if (cell.text !== undefined) paragraph(cell.text);
  }
}
export function validateNativeElements(elements) {
  const ids = new Set();
  let count = 0;
  function common(e) {
    requireValue(record(e) && id(e.id) && !ids.has(e.id), "element ID");
    ids.add(e.id);
    requireValue(++count <= 10000, "element count");
    for (const key of [
      "angle",
      "strokeWidth",
      "branchWidth",
      "manualWidth",
      "opacity",
    ])
      if (e[key] !== undefined) requireValue(number(e[key]), key);
  }
  function mind(e, depth, root) {
    common(e);
    requireValue(
      depth <= 32 &&
        (root
          ? ["mind", "mindmap"]
          : ["mind_child", "mind", "mindmap"]
        ).includes(e.type),
      "mind type or depth",
    );
    if (root) points(e.points, 1, 1);
    else if (e.points !== undefined) points(e.points, 1);
    requireValue(
      record(e.data) && Array.isArray(e.children),
      "mind data and children",
    );
    paragraph(e.data.topic);
    if (e.layout !== undefined)
      requireValue(
        [
          "right",
          "left",
          "standard",
          "upward",
          "downward",
          "right-bottom-indented",
          "right-top-indented",
          "left-top-indented",
          "left-bottom-indented",
        ].includes(e.layout),
        "mind layout",
      );
    if (e.data.image !== undefined) {
      const image = e.data.image;
      requireValue(
        record(image) &&
          typeof image.url === "string" &&
          number(image.width) &&
          image.width > 0 &&
          number(image.height) &&
          image.height > 0,
        "mind image",
      );
    }
    if (e.data.emojis !== undefined)
      requireValue(
        Array.isArray(e.data.emojis) &&
          e.data.emojis.every((x) => record(x) && typeof x.name === "string"),
        "mind emojis",
      );
    e.children.forEach((child) => mind(child, depth + 1, false));
  }
  for (const e of elements) {
    if (["mind", "mindmap"].includes(e.type)) {
      mind(e, 0, true);
      continue;
    }
    common(e);
    if (e.type === "group") continue;
    points(
      e.points,
      e.type === "freehand" ? 1 : 2,
      ["image", "geometry", "table", "swimlane"].includes(e.type) ? 2 : 100000,
    );
    if (e.type === "geometry") {
      requireValue(shapes.has(e.shape), "geometry shape");
      if (e.text !== undefined) paragraph(e.text);
      if (e.texts !== undefined) {
        requireValue(Array.isArray(e.texts), "geometry texts");
        for (const item of e.texts) {
          requireValue(record(item), "geometry text");
          paragraph(item.text);
        }
      }
      if (["class", "interface"].includes(e.shape)) table(e);
    } else if (["arrow-line", "line", "vector-line"].includes(e.type)) {
      requireValue(
        [
          "straight",
          "curve",
          ...(e.type === "vector-line" ? [] : ["elbow"]),
        ].includes(e.shape),
        "line shape",
      );
      if (e.type !== "vector-line") {
        for (const key of ["source", "target"]) {
          const handle = e[key];
          requireValue(
            record(handle) && markers.has(handle.marker),
            "line handle",
          );
          if (handle.connection !== undefined)
            requireValue(point(handle.connection), "line connection");
          if (handle.boundId !== undefined)
            requireValue(id(handle.boundId), "line bound ID");
        }
        requireValue(Array.isArray(e.texts), "line texts");
        for (const item of e.texts) {
          requireValue(
            record(item) && number(item.position),
            "line text position",
          );
          paragraph(item.text);
        }
      }
    } else if (e.type === "image")
      requireValue(typeof e.url === "string" && !!e.url, "image URL");
    else if (e.type === "freehand")
      requireValue(
        [
          "eraser",
          "nibPen",
          "feltTipPen",
          "artisticBrush",
          "markerHighlight",
        ].includes(e.shape),
        "freehand shape",
      );
    else if (["table", "swimlane"].includes(e.type)) {
      table(e);
      if (e.type === "swimlane")
        requireValue(
          ["swimlaneVertical", "swimlaneHorizontal"].includes(e.shape),
          "swimlane shape",
        );
    } else invalid("unsupported Drawnix element type");
  }
}
export function validateNativeViewport(viewport) {
  requireValue(
    number(viewport.zoom) && viewport.zoom > 0 && viewport.zoom <= 100,
    "viewport zoom",
  );
  if (viewport.origination !== undefined)
    requireValue(point(viewport.origination), "viewport origin");
}
