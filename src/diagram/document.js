export const SHAPES = [
  "process",
  "decision",
  "database",
  "text",
  "terminator",
  "ellipse",
  "document",
  "annotation",
  "group",
  "swimlane",
  "image",
];
export const COLORS = [
  "#e8eefc",
  "#dcf0e5",
  "#fff0cc",
  "#f5dce6",
  "#eae2f8",
  "#ffffff",
];
export const NODE_WIDTH = 180,
  NODE_HEIGHT = 90;
export const defaultDiagram = () => ({ version: 2, nodes: [], edges: [] });
const fail = (detail = "unsupported data") => {
  throw new Error(
    `Invalid diagram: ${detail}. Keep the original source to recover it.`,
  );
};
const id = (v) => typeof v === "string" && /^[\w-]{1,100}$/.test(v);
const string = (v, max) => typeof v === "string" && v.length <= max;
const number = (v, min, max) => Number.isFinite(v) && v >= min && v <= max;
export const validColor = (v) =>
  typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
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

function link(value) {
  if (!value || typeof value !== "object") fail("link");
  const { kind } = value;
  if (kind === "url") {
    if (!string(value.url, 2048) || /[\x00-\x20\x7f\\]/.test(value.url))
      fail("link URL");
    if (!value.url.includes(":")) {
      const [path, fragment, ...rest] = value.url.split("#");
      if (
        rest.length ||
        (!path && !fragment) ||
        (path && !isLocalAssetUrl(path)) ||
        (fragment !== undefined && !/^[\w.%~-]+$/.test(fragment)) ||
        /%(?:00|0a|0d|3a|5c)/i.test(value.url)
      )
        fail("portable link URL");
    } else
      try {
        const u = new URL(value.url);
        if (!["https:", "http:", "mailto:"].includes(u.protocol))
          fail("link URL protocol");
      } catch {
        fail("link URL");
      }
    return { kind, url: value.url };
  }
  if (kind === "asset") {
    if (!isLocalAssetUrl(value.url) || !string(value.name, 500))
      fail("asset link");
    return { kind, url: value.url, name: value.name };
  }
  if (
    !["note", "block", "concept"].includes(kind) ||
    !string(value.noteId, 200) ||
    !value.noteId ||
    /[\x00-\x1f]/.test(value.noteId)
  )
    fail("note link");
  const result = { kind, noteId: value.noteId };
  for (const key of kind === "block"
    ? ["blockId"]
    : kind === "concept"
      ? ["bundleId", "path"]
      : []) {
    if (
      !string(value[key], 1000) ||
      !value[key] ||
      /[\x00-\x1f]/.test(value[key])
    )
      fail(`link ${key}`);
    result[key] = value[key];
  }
  return result;
}
export function parseDiagram(value) {
  if (value === "" || value == null) return defaultDiagram();
  if (typeof value === "string" && value.length > 1000000)
    fail("document exceeds 1,000,000 characters");
  let d;
  try {
    d = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    fail("JSON");
  }
  if (
    !d ||
    ![undefined, 1, 2].includes(d.version) ||
    !Array.isArray(d.nodes) ||
    !Array.isArray(d.edges) ||
    d.nodes.length > 300 ||
    d.edges.length > 1000
  )
    fail("version or size (maximum 300 nodes / 1,000 edges)");
  const ids = new Set();
  const nodes = d.nodes.map((n) => {
    if (!n || !id(n.id) || ids.has(n.id)) fail("duplicate or invalid node ID");
    ids.add(n.id);
    if (
      !n.position ||
      !number(n.position.x, -100000, 100000) ||
      !number(n.position.y, -100000, 100000)
    )
      fail("node coordinates");
    if (
      !SHAPES.includes(n.data?.shape) ||
      !string(n.data.label, 500) ||
      !validColor(n.data.color)
    )
      fail("node shape, label or color");
    const width = n.width ?? NODE_WIDTH,
      height = n.height ?? NODE_HEIGHT;
    if (!number(width, 24, 4096) || !number(height, 24, 4096))
      fail("node dimensions (24–4096)");
    const data = {
      shape: n.data.shape,
      label: n.data.label,
      color: n.data.color,
    };
    for (const [key, valid] of [
      ["textColor", validColor],
      ["fontSize", (v) => number(v, 6, 96)],
      ["fontWeight", (v) => [400, 500, 600, 700, "normal", "bold"].includes(v)],
      ["textAlign", (v) => ["left", "center", "right"].includes(v)],
    ]) {
      if (n.data[key] !== undefined) {
        if (!valid(n.data[key])) fail(`node ${key}`);
        data[key] = n.data[key];
      }
    }
    if (n.data.link !== undefined) data.link = link(n.data.link);
    if (n.data.image !== undefined) {
      if (!isLocalAssetUrl(n.data.image?.url) || !string(n.data.image.alt, 500))
        fail("image asset");
      data.image = { url: n.data.image.url, alt: n.data.image.alt };
    }
    const result = {
      id: n.id,
      type: "diagramShape",
      position: { x: n.position.x, y: n.position.y },
      width,
      height,
      data,
    };
    if (n.parentId !== undefined) {
      if (!id(n.parentId)) fail("parent ID");
      result.parentId = n.parentId;
    }
    if (n.locked !== undefined) {
      if (typeof n.locked !== "boolean") fail("locked");
      result.locked = n.locked;
    }
    return result;
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    let p = n;
    const visited = new Set([n.id]);
    let x = n.position.x,
      y = n.position.y;
    while (p.parentId) {
      p = byId.get(p.parentId);
      if (!p || !["group", "swimlane"].includes(p.data.shape))
        fail("parent must be a group or swimlane");
      if (visited.has(p.id)) fail("parent cycle");
      visited.add(p.id);
      x += p.position.x;
      y += p.position.y;
    }
    if (!number(x, -100000, 100000) || !number(y, -100000, 100000))
      fail("absolute node coordinates");
  }
  const edgeIds = new Set();
  const edges = d.edges.map((e) => {
    if (
      !e ||
      !id(e.id) ||
      edgeIds.has(e.id) ||
      !ids.has(e.source) ||
      !ids.has(e.target)
    )
      fail("edge ID or endpoint");
    edgeIds.add(e.id);
    if (e.label != null && !string(e.label, 200)) fail("edge label");
    const sourceHandle =
      e.sourceHandle == null || e.sourceHandle === "out"
        ? "out-bottom"
        : e.sourceHandle;
    const targetHandle =
      e.targetHandle == null || e.targetHandle === "in"
        ? "in-top"
        : e.targetHandle;
    if (
      typeof sourceHandle !== "string" ||
      typeof targetHandle !== "string" ||
      !/^out-(top|right|bottom|left)$/.test(sourceHandle) ||
      !/^in-(top|right|bottom|left)$/.test(targetHandle)
    )
      fail("edge handle");
    const kind = e.kind ?? "curve",
      color = e.color ?? "#758093",
      width = e.width ?? 2,
      dashed = e.dashed ?? false,
      startArrow = e.startArrow ?? "none",
      endArrow = e.endArrow ?? "arrow";
    if (
      !["curve", "straight", "orthogonal"].includes(kind) ||
      !validColor(color) ||
      !number(width, 0.5, 12) ||
      typeof dashed !== "boolean" ||
      ![startArrow, endArrow].every((a) =>
        ["none", "arrow", "diamond", "circle"].includes(a),
      )
    )
      fail("edge style");
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle,
      targetHandle,
      label: e.label || "",
      kind,
      color,
      width,
      dashed,
      startArrow,
      endArrow,
    };
  });
  const result = { version: 2, nodes, edges };
  if (JSON.stringify(result).length > 1000000)
    fail("document exceeds 1,000,000 characters");
  return result;
}
