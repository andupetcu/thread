const string = (v, max) => typeof v === "string" && v.length <= max;
export function isLocalAssetUrl(v) {
  if (!string(v, 2048) || !v || /[\\\s\x00-\x1f\x7f]/.test(v)) return false;
  if (v.startsWith("/api/assets/"))
    return (
      /^\/api\/assets\/[\w.-]+$/.test(v) &&
      !v.endsWith("/..") &&
      !v.endsWith("/.")
    );
  if (v.startsWith("/api/okf/bundles/")) {
    if (!/^\/api\/okf\/bundles\/[\w-]+\/files\?path=[^&#]+$/.test(v))
      return false;
    try {
      const path = decodeURIComponent(v.split("?path=")[1]);
      return (
        !!path &&
        !path.startsWith("/") &&
        !/[\\\x00-\x1f\x7f:]/.test(path) &&
        path.split("/").every((p) => p && p !== "." && p !== "..")
      );
    } catch {
      return false;
    }
  }
  return (
    !v.startsWith("/") &&
    !v.includes(":") &&
    !/[?#]/.test(v) &&
    v.split("/").every((part) => part && /^[\w.%-]+$/.test(part)) &&
    !/%(?:2e|2f|5c|00|3a)/i.test(v)
  );
}
export const MAX_VISUAL_JSON = 12000000;
export function invalid(detail) {
  throw new Error(
    `Invalid visual document: ${detail}. Keep the original source to recover it.`,
  );
}
const identifier = (v) =>
  typeof v === "string" &&
  v.length > 0 &&
  v.length <= 200 &&
  !/[\x00-\x1f\x7f]/.test(v);
export function safeUrl(url) {
  if (!string(url, 4096) || !url || /[\x00-\x20\x7f\\]/.test(url)) return false;
  if (/^(https?:|mailto:)/i.test(url)) {
    try {
      return ["http:", "https:", "mailto:"].includes(new URL(url).protocol);
    } catch {
      return false;
    }
  }
  if (
    url.includes(":") ||
    url.startsWith("//") ||
    /%(?:00|0a|0d|3a|5c)/i.test(url)
  )
    return false;
  const [path, fragment, ...rest] = url.split("#");
  return (
    !rest.length &&
    !!(path || fragment) &&
    (!path || isLocalAssetUrl(path)) &&
    (fragment === undefined || /^[\w.%~-]+$/.test(fragment))
  );
}
export function parseLink(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid("reference link");
  const { kind } = value;
  if (kind === "url") {
    if (!safeUrl(value.url)) invalid("link URL");
    return { kind, url: value.url };
  }
  if (kind === "asset") {
    if (
      !isLocalAssetUrl(value.url) ||
      (value.name !== undefined && !string(value.name, 500))
    )
      invalid("asset link");
    return {
      kind,
      url: value.url,
      ...(value.name !== undefined ? { name: value.name } : {}),
    };
  }
  if (kind === "bundle") {
    if (!identifier(value.bundleId)) invalid("bundle ID");
    return { kind, bundleId: value.bundleId };
  }
  if (!["note", "block", "concept"].includes(kind) || !identifier(value.noteId))
    invalid("note reference");
  const result = { kind, noteId: value.noteId };
  if (kind === "block") {
    if (!identifier(value.blockId)) invalid("block ID");
    result.blockId = value.blockId;
  }
  if (value.bundleId !== undefined) {
    if (!identifier(value.bundleId)) invalid("bundle ID");
    result.bundleId = value.bundleId;
  }
  return result;
}
export function parseReference(value) {
  if (!value || !identifier(value.id) || !string(value.label, 2000))
    invalid("reference ID or label");
  const result = { id: value.id, label: value.label };
  if (value.elementId !== undefined) {
    if (!identifier(value.elementId)) invalid("element ID");
    result.elementId = value.elementId;
  }
  result.link = parseLink(value.link);
  return result;
}
export function parseReferences(value = []) {
  if (!Array.isArray(value) || value.length > 2000) invalid("reference count");
  const ids = new Set();
  return value.map((v) => {
    const r = parseReference(v);
    if (ids.has(r.id)) invalid("duplicate reference ID");
    ids.add(r.id);
    return r;
  });
}
export function boundedJson(value) {
  let count = 0;
  const ancestors = new Set();
  function visit(v, depth) {
    if (++count > 200000 || depth > 64) invalid("JSON depth or size");
    if (v === null || typeof v === "boolean") return;
    if (typeof v === "number") {
      if (!Number.isFinite(v)) invalid("nonfinite number");
      return;
    }
    if (typeof v === "string") {
      if (v.length > MAX_VISUAL_JSON) invalid("string size");
      return;
    }
    if (
      !v ||
      typeof v !== "object" ||
      ancestors.has(v) ||
      (!Array.isArray(v) &&
        Object.getPrototypeOf(v) !== Object.prototype &&
        Object.getPrototypeOf(v) !== null)
    )
      invalid("JSON value");
    ancestors.add(v);
    for (const [key, child] of Object.entries(v)) {
      if (["__proto__", "prototype", "constructor"].includes(key))
        invalid("unsafe JSON key");
      if (
        /^(?:url|href|link|src)$/i.test(key) &&
        typeof child === "string" &&
        /^(?:(?:javascript|vbscript|file):|data:(?!image\/(?:png|jpeg|gif|webp)[;,]))/i.test(
          child.replace(/[\s\x00-\x1f]/g, ""),
        )
      )
        invalid("executable link");
      visit(child, depth + 1);
    }
    ancestors.delete(v);
  }
  visit(value, 0);
  const json = JSON.stringify(value);
  if (json.length > MAX_VISUAL_JSON) invalid("document size");
  return JSON.parse(json);
}
export function readEnvelope(value) {
  if (typeof value === "string") {
    if (value.length > MAX_VISUAL_JSON) invalid("document size");
    try {
      value = JSON.parse(value);
    } catch {
      invalid("JSON");
    }
  }
  return boundedJson(value);
}
export function parsePreview(value) {
  if (
    typeof value !== "string" ||
    value.length > 8000000 ||
    !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
  )
    invalid("PNG preview");
  const bytes = atob(value.slice(22));
  if (
    bytes.length < 24 ||
    !bytes.startsWith("\x89PNG\r\n\x1a\n") ||
    bytes.slice(12, 16) !== "IHDR"
  )
    invalid("PNG header");
  const uint = (i) =>
    bytes.charCodeAt(i) * 16777216 +
    (bytes.charCodeAt(i + 1) << 16) +
    (bytes.charCodeAt(i + 2) << 8) +
    bytes.charCodeAt(i + 3);
  const width = uint(16),
    height = uint(20);
  if (
    !width ||
    !height ||
    width > 16384 ||
    height > 16384 ||
    width * height > 64000000
  )
    invalid("PNG dimensions");
  return value;
}
export function savedPng(value) {
  if (!value.preview)
    throw new Error(
      "No saved PNG preview. Open the native editor and save to generate a preview.",
    );
  return value.preview;
}
export function previewSvg(value) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640"><image width="960" height="640" preserveAspectRatio="xMidYMid meet" href="${savedPng(value)}"/></svg>`;
}
