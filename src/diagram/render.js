import { imageDataDimensions } from "./image-data.js";
import { parseDiagram, validColor, isLocalAssetUrl } from "./document.js";
import {
  absolutePosition,
  nodeSize,
  nodeShapeSvg,
  nodeLabelLayout,
  edgeGeometry,
  escapeSvg as esc,
} from "./geometry.js";
const backgroundValue = (options) => {
  const color = options.background ?? "#ffffff";
  if (color !== "transparent" && !validColor(color))
    throw new Error("Invalid diagram background.");
  return color;
};
export function diagramBounds(d) {
  if (!d.nodes.length) return { x: 0, y: 0, width: 480, height: 180 };
  const byId = new Map(d.nodes.map((n) => [n.id, n])),
    boxes = d.nodes.map((n) => {
      const p = absolutePosition(n, byId),
        s = nodeSize(n);
      return {
        minX: p.x - 1,
        minY: p.y - 1,
        maxX: p.x + s.width + 1,
        maxY: p.y + s.height + 1,
      };
    });
  for (const edge of d.edges) boxes.push(edgeGeometry(edge, byId).bounds);
  const x = Math.min(...boxes.map((b) => b.minX)) - 40,
    y = Math.min(...boxes.map((b) => b.minY)) - 40;
  return {
    x,
    y,
    width: Math.max(...boxes.map((b) => b.maxX)) + 40 - x,
    height: Math.max(...boxes.map((b) => b.maxY)) + 40 - y,
  };
}
const MAX_IMAGE_BYTES = 10 * 1024 * 1024,
  MAX_TOTAL_IMAGE_BYTES = 30 * 1024 * 1024;
export function validateImageData(data) {
  if (
    typeof data !== "string" ||
    data.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 100 ||
    !/^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/]+={0,2}$/i.test(data)
  )
    throw new Error(
      "Image asset must be a PNG, JPEG, GIF or WebP data URL under 10 MB.",
    );
  imageDataDimensions(data);
  return data;
}
const rendersImage = (node) => node.data.shape === "image" && node.data.image;
function imageOccurrences(document) {
  const occurrences = new Map();
  for (const node of document.nodes)
    if (rendersImage(node)) {
      const url = node.data.image.url;
      occurrences.set(url, (occurrences.get(url) ?? 0) + 1);
    }
  return occurrences;
}
function embeddedBytes(data) {
  const payloadLength = data.length - data.indexOf(",") - 1;
  return (
    payloadLength * 0.75 -
    (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0)
  );
}
function checkImageBudget(total) {
  if (total > MAX_TOTAL_IMAGE_BYTES)
    throw new Error("Diagram embedded image assets exceed 30 MB.");
}
function prepareEmbeddedImages(document, assetData) {
  const images = new Map();
  let total = 0;
  for (const [url, count] of imageOccurrences(document)) {
    const data = assetData?.[url];
    if (data === undefined) continue;
    validateImageData(data);
    total += embeddedBytes(data) * count;
    checkImageBudget(total);
    images.set(url, data);
  }
  return images;
}
function arrowMarker(id, kind, color) {
  const geometry =
    kind === "circle"
      ? '<circle cx="5" cy="5" r="4"/>'
      : kind === "diamond"
        ? '<path d="M 0 5 L 5 0 L 10 5 L 5 10 Z"/>'
        : '<path d="M 0 0 L 10 5 L 0 10 Z"/>';
  return `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse" fill="${color}">${geometry}</marker>`;
}
export function diagramToSvg(value, options = {}) {
  const d = parseDiagram(value),
    background = backgroundValue(options),
    b = diagramBounds(d),
    byId = new Map(d.nodes.map((n) => [n.id, n])),
    embeddedImages = prepareEmbeddedImages(d, options.assetData);
  let defs = "";
  const edges = d.edges
    .map((e, i) => {
      const g = edgeGeometry(e, byId);
      let arrows = "";
      for (const [position, kind] of [
        ["start", e.startArrow],
        ["end", e.endArrow],
      ])
        if (kind !== "none") {
          const id = `edge-${i}-${position}`;
          defs += arrowMarker(id, kind, e.color);
          arrows += ` marker-${position}="url(#${id})"`;
        }
      return `<path d="${g.path}" fill="none" stroke="${e.color}" stroke-width="${e.width}"${e.dashed ? ' stroke-dasharray="8 5"' : ""}${arrows}/>${e.label ? `<text x="${g.labelX}" y="${g.labelY}" text-anchor="middle" paint-order="stroke" stroke="${background === "transparent" ? "#ffffff" : background}" stroke-width="4" fill="#334155" font-size="12">${esc(e.label)}</text>` : ""}`;
    })
    .join("");
  const renderNode = (n) => {
    const p = absolutePosition(n, byId),
      s = nodeSize(n),
      layout = nodeLabelLayout(n);
    let geometry = nodeShapeSvg(n);
    if (rendersImage(n)) {
      const url = n.data.image.url,
        embedded = embeddedImages.get(url);
      geometry += `<image x="1" y="1" width="${s.width - 2}" height="${s.height - 2}" href="${esc(embedded ?? url)}" preserveAspectRatio="xMidYMid meet"><title>${esc(n.data.image.alt)}</title></image>`;
    }
    const text = `<text x="${layout.x}" y="${layout.y}" text-anchor="${layout.textAnchor}" fill="${n.data.textColor ?? "#202b40"}" font-size="${layout.fontSize}" font-weight="${n.data.fontWeight ?? 400}">${layout.lines.map((line, i) => `<tspan x="${layout.x}" dy="${i ? layout.lineHeight : 0}">${esc(line)}</tspan>`).join("")}</text>`;
    const content = `<g data-node-id="${n.id}" transform="translate(${p.x} ${p.y})"><title>${esc(n.data.label)}</title>${geometry}${text}</g>`;
    return ["url", "asset"].includes(n.data.link?.kind)
      ? `<a href="${esc(n.data.link.url)}">${content}</a>`
      : content;
  };
  // Frames sit behind connections; sort ancestors before descendants independent of input order.
  const depth = (n) => {
    let level = 0;
    while (n.parentId) {
      level++;
      n = byId.get(n.parentId);
    }
    return level;
  };
  const frames = d.nodes
    .filter((n) => ["group", "swimlane"].includes(n.data.shape))
    .sort((a, b) => depth(a) - depth(b))
    .map(renderNode)
    .join("");
  const nodes = d.nodes
    .filter((n) => !["group", "swimlane"].includes(n.data.shape))
    .map(renderNode)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${b.width}" height="${b.height}" viewBox="${b.x} ${b.y} ${b.width} ${b.height}" role="img" aria-label="Diagram" style="font-family:Arial,sans-serif"><defs>${defs}</defs>${background === "transparent" ? "" : `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" fill="${background}"/>`}${frames}${edges}${nodes}${!d.nodes.length ? '<text x="240" y="90" text-anchor="middle" fill="#758093" font-size="16">Add a shape to begin</text>' : ""}</svg>`;
}
async function fetchImage(url) {
  if (!isLocalAssetUrl(url) || !url.startsWith("/api/"))
    throw new Error(`Image asset ${url} needs a local resolver.`);
  const response = await fetch(url, {
    credentials: "same-origin",
    redirect: "error",
  });
  if (!response.ok) throw new Error(`Image asset could not be loaded: ${url}`);
  const mime = response.headers
    .get("content-type")
    ?.split(";")[0]
    .trim()
    .toLowerCase();
  if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(mime))
    throw new Error(`Unsupported image asset: ${url}`);
  if (Number(response.headers.get("content-length")) > MAX_IMAGE_BYTES)
    throw new Error("Image asset exceeds 10 MB.");
  const reader = response.body?.getReader();
  let bytes;
  if (reader) {
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_IMAGE_BYTES)
          throw new Error("Image asset exceeds 10 MB.");
        chunks.push(value);
      }
    } catch (error) {
      await reader.cancel();
      throw error;
    }
    bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
  } else {
    bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > MAX_IMAGE_BYTES)
      throw new Error("Image asset exceeds 10 MB.");
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return `data:${mime};base64,${btoa(binary)}`;
}
export async function diagramToPortableSvg(value, options = {}) {
  const d = parseDiagram(value),
    assetData = Object.create(null);
  let total = 0;
  for (const [url, count] of imageOccurrences(d)) {
    let data = options.assetData?.[url];
    if (data === undefined)
      data = await (options.resolveAsset ?? fetchImage)(url);
    validateImageData(data);
    total += embeddedBytes(data) * count;
    checkImageBudget(total);
    assetData[url] = data;
  }
  return diagramToSvg(d, { ...options, assetData });
}
export async function diagramToPng(value, options = {}) {
  const d = parseDiagram(value),
    b = diagramBounds(d);
  backgroundValue(options);
  const scale =
    options.scale ?? Math.min(2, 4096 / Math.max(b.width, b.height));
  if (!Number.isFinite(scale) || scale <= 0 || scale > 8)
    throw new Error("Image export scale must be greater than 0 and at most 8.");
  const width = Math.max(1, Math.ceil(b.width * scale)),
    height = Math.max(1, Math.ceil(b.height * scale));
  if (width > 8192 || height > 8192 || width * height > 16777216)
    throw new Error(
      "Image export exceeds raster bounds (8192 pixels per side, 16 megapixels). Reduce scale.",
    );
  const svg = await diagramToPortableSvg(d, options),
    url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () =>
        reject(new Error("Diagram image could not be rendered."));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image export is unavailable.");
    context.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}
