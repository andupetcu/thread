import { COLORS, parseDiagram, diagramToSvg } from "../diagram/model.js";
const MAX_NODES = 300,
  MAX_JSON = 1000000;
const fail = (detail) => {
  throw new Error(
    `Invalid mind map: ${detail}. Keep the original source to recover it.`,
  );
};
const validId = (value) =>
  typeof value === "string" && /^[\w-]{1,100}$/.test(value);
const validColor = (value) =>
  typeof value === "string" && /^#[\da-f]{6}$/i.test(value);
export const defaultMindMap = () => ({
  version: 1,
  rootId: "root",
  layout: "both",
  nodes: [{ id: "root", label: "Central idea" }],
});
function validateLink(link) {
  if (link?.kind === "bundle") {
    if (
      typeof link.bundleId !== "string" ||
      !link.bundleId ||
      link.bundleId.length > 200 ||
      /[\x00-\x1f\x7f]/.test(link.bundleId)
    )
      fail("bundle link");
    return { kind: "bundle", bundleId: link.bundleId };
  }
  return parseDiagram({
    version: 2,
    nodes: [
      {
        id: "link-check",
        position: { x: 0, y: 0 },
        data: { shape: "process", label: "", color: "#ffffff", link },
      },
    ],
    edges: [],
  }).nodes[0].data.link;
}
export function parseMindMap(value) {
  if (value == null || value === "") return defaultMindMap();
  if (typeof value === "string" && value.length > MAX_JSON)
    fail("document exceeds 1 MB");
  let d;
  try {
    d = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    fail("JSON");
  }
  if (
    !d ||
    ![undefined, 1].includes(d.version) ||
    !validId(d.rootId) ||
    !["both", "right"].includes(d.layout ?? "both") ||
    !Array.isArray(d.nodes) ||
    !d.nodes.length ||
    d.nodes.length > MAX_NODES
  )
    fail("version, layout or node count (1–300)");
  const ids = new Set();
  const nodes = d.nodes.map((node) => {
    if (!node || !validId(node.id) || ids.has(node.id))
      fail("duplicate or invalid idea ID");
    ids.add(node.id);
    if (typeof node.label !== "string" || node.label.length > 500)
      fail("idea label (maximum 500 characters)");
    const result = { id: node.id, label: node.label };
    if (node.id === d.rootId) {
      if (node.parentId !== undefined) fail("root cannot have a parent");
    } else {
      if (!validId(node.parentId)) fail("nonroot idea requires a parent");
      result.parentId = node.parentId;
    }
    if (node.color !== undefined) {
      if (!validColor(node.color)) fail("idea color");
      result.color = node.color;
    }
    if (node.collapsed !== undefined) {
      if (typeof node.collapsed !== "boolean") fail("collapsed flag");
      result.collapsed = node.collapsed;
    }
    if (node.side !== undefined) {
      if (!["left", "right"].includes(node.side)) fail("branch side");
      result.side = node.side;
    }
    if (node.link !== undefined) result.link = validateLink(node.link);
    return result;
  });
  if (!ids.has(d.rootId)) fail("missing root");
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const node of nodes) {
    let current = node;
    const visited = new Set();
    while (current.id !== d.rootId) {
      if (visited.has(current.id)) fail("parent cycle");
      visited.add(current.id);
      current = byId.get(current.parentId);
      if (!current) fail("missing parent");
    }
  }
  const result = {
    version: 1,
    rootId: d.rootId,
    layout: d.layout ?? "both",
    nodes,
  };
  if (JSON.stringify(result).length > MAX_JSON) fail("document exceeds 1 MB");
  return result;
}
function treeIndex(d) {
  const byId = new Map(d.nodes.map((n) => [n.id, n])),
    children = new Map(d.nodes.map((n) => [n.id, []]));
  for (const n of d.nodes) if (n.parentId) children.get(n.parentId).push(n);
  return { byId, children };
}
function requireIdea(d, id) {
  const node = d.nodes.find((n) => n.id === id);
  if (!node) fail("idea does not exist");
  return node;
}
function freshId(ids) {
  let id;
  do {
    id =
      "idea-" +
      (globalThis.crypto?.randomUUID?.() ??
        Math.random().toString(36).slice(2) + Date.now().toString(36));
  } while (ids.has(id));
  ids.add(id);
  return id;
}
function branchIds(d, id) {
  requireIdea(d, id);
  const { children } = treeIndex(d),
    ids = new Set();
  const visit = (id) => {
    ids.add(id);
    for (const child of children.get(id)) visit(child.id);
  };
  visit(id);
  return ids;
}
export function addIdea(value, parentId, label = "New idea", options = {}) {
  const d = parseMindMap(value);
  requireIdea(d, parentId);
  const ids = new Set(d.nodes.map((n) => n.id));
  const id = options.id ?? freshId(ids);
  if (!validId(id) || d.nodes.some((n) => n.id === id)) fail("new idea ID");
  d.nodes.push({
    id,
    parentId,
    label,
    ...Object.fromEntries(
      ["color", "side", "link", "collapsed"]
        .filter((key) => options[key] !== undefined)
        .map((key) => [key, options[key]]),
    ),
  });
  const parent = d.nodes.find((n) => n.id === parentId);
  if (parent.collapsed) parent.collapsed = false;
  return parseMindMap(d);
}
export function addSibling(value, nodeId, label = "New idea") {
  const d = parseMindMap(value),
    node = requireIdea(d, nodeId);
  return addIdea(d, node.parentId ?? d.rootId, label);
}
export function removeBranch(value, nodeId) {
  const d = parseMindMap(value),
    ids = branchIds(d, nodeId);
  d.nodes = d.nodes.filter((n) => n.id === d.rootId || !ids.has(n.id));
  return parseMindMap(d);
}
export function reparentIdea(value, nodeId, parentId) {
  const d = parseMindMap(value),
    node = requireIdea(d, nodeId);
  requireIdea(d, parentId);
  if (nodeId === d.rootId) fail("cannot reparent the root");
  if (branchIds(d, nodeId).has(parentId))
    fail("reparenting would create a cycle");
  node.parentId = parentId;
  const parent = requireIdea(d, parentId);
  if (parent.collapsed) parent.collapsed = false;
  return parseMindMap(d);
}
export function updateIdea(value, nodeId, patch) {
  const d = parseMindMap(value),
    node = requireIdea(d, nodeId);
  if (!patch || typeof patch !== "object" || Array.isArray(patch))
    fail("idea update");
  for (const key of Object.keys(patch)) {
    if (!["label", "color", "collapsed", "side", "link"].includes(key))
      fail(`unsupported idea field ${key}`);
    if (patch[key] === undefined) delete node[key];
    else node[key] = patch[key];
  }
  return parseMindMap(d);
}
export function duplicateBranch(value, nodeId) {
  const d = parseMindMap(value),
    node = requireIdea(d, nodeId),
    branch = branchIds(d, nodeId),
    ids = new Set(d.nodes.map((n) => n.id)),
    mapping = new Map([...branch].map((id) => [id, freshId(ids)]));
  if (d.nodes.length + branch.size > MAX_NODES)
    fail("duplicated branch exceeds 300 ideas");
  const { children } = treeIndex(d),
    copies = [];
  const copy = (n) => {
    copies.push({
      ...n,
      id: mapping.get(n.id),
      parentId:
        n.id === nodeId ? (node.parentId ?? d.rootId) : mapping.get(n.parentId),
    });
    for (const child of children.get(n.id)) copy(child);
  };
  copy(node);
  d.nodes.push(...copies);
  const parent = requireIdea(d, node.parentId ?? d.rootId);
  if (parent.collapsed) parent.collapsed = false;
  return parseMindMap(d);
}
export function layoutMindMap(value, { includeCollapsed = false } = {}) {
  const d = parseMindMap(value),
    { byId, children } = treeIndex(d),
    root = byId.get(d.rootId),
    sizes = new Map(),
    heights = new Map(),
    positions = new Map(),
    sides = new Map(),
    colors = new Map();
  const visibleChildren = (n) =>
    !includeCollapsed && n.collapsed ? [] : children.get(n.id);
  for (const node of d.nodes) {
    const lines = node.label
      .split("\n")
      .reduce(
        (count, line) =>
          count + Math.max(1, Math.ceil(Array.from(line).length / 23)),
        0,
      );
    sizes.set(node.id, {
      width: node.id === d.rootId ? 220 : 200,
      height:
        node.id === d.rootId
          ? 90
          : Math.max(70, Math.min(480, lines * 18 + 28)),
    });
  }
  const measure = (node) => {
    const descendants = visibleChildren(node);
    const height = Math.max(
      sizes.get(node.id).height,
      descendants.reduce((sum, child) => sum + measure(child), 0) +
        Math.max(0, descendants.length - 1) * 28,
    );
    heights.set(node.id, height);
    return height;
  };
  measure(root);
  positions.set(root.id, { x: 0, y: 0 });
  colors.set(root.id, root.color ?? COLORS[0]);
  const branches = visibleChildren(root),
    branchSides = { left: [], right: [] },
    weight = { left: 0, right: 0 };
  branches.forEach((branch, index) => {
    const side =
      d.layout === "right"
        ? "right"
        : (branch.side ?? (weight.right <= weight.left ? "right" : "left"));
    branchSides[side].push(branch);
    weight[side] += heights.get(branch.id) + 36;
    colors.set(branch.id, branch.color ?? COLORS[(index + 1) % COLORS.length]);
  });
  const place = (node, side, depth, top, color) => {
    const size = sizes.get(node.id),
      height = heights.get(node.id);
    positions.set(node.id, {
      x:
        side === "right"
          ? 300 + (depth - 1) * 280
          : -80 - size.width - (depth - 1) * 280,
      y: top + (height - size.height) / 2,
    });
    sides.set(node.id, side);
    colors.set(node.id, node.color ?? color);
    const descendants = visibleChildren(node),
      total =
        descendants.reduce((sum, n) => sum + heights.get(n.id), 0) +
        Math.max(0, descendants.length - 1) * 28;
    let cursor = top + (height - total) / 2;
    for (const child of descendants) {
      place(child, side, depth + 1, cursor, colors.get(node.id));
      cursor += heights.get(child.id) + 28;
    }
  };
  for (const side of ["left", "right"]) {
    const list = branchSides[side],
      total =
        list.reduce((sum, n) => sum + heights.get(n.id), 0) +
        Math.max(0, list.length - 1) * 36;
    let top = 45 - total / 2;
    for (const branch of list) {
      place(branch, side, 1, top, colors.get(branch.id));
      top += heights.get(branch.id) + 36;
    }
  }
  const nodes = d.nodes
    .filter((n) => positions.has(n.id))
    .map((n) => ({
      id: n.id,
      type: "diagramShape",
      position: positions.get(n.id),
      ...sizes.get(n.id),
      data: {
        shape: n.id === d.rootId ? "ellipse" : "process",
        label: n.label,
        color: colors.get(n.id),
        ...(n.link && n.link.kind !== "bundle" ? { link: n.link } : {}),
      },
    }));
  const edges = d.nodes
    .filter((n) => n.id !== d.rootId && positions.has(n.id))
    .map((n, index) => ({
      id: "branch-" + index,
      source: n.parentId,
      target: n.id,
      sourceHandle: sides.get(n.id) === "right" ? "out-right" : "out-left",
      targetHandle: sides.get(n.id) === "right" ? "in-left" : "in-right",
      kind: "curve",
      color: colors.get(n.id),
      width: 2,
      startArrow: "none",
      endArrow: "none",
      label: "",
    }));
  return parseDiagram({ version: 2, nodes, edges });
}
// Outline labels use reversible backslash escapes for embedded newlines, so an
// idea containing a literal bullet line cannot accidentally become a child.
const encodeLabel = (label) =>
  label.replace(/\\/g, "\\\\").replace(/\r/g, "\\r").replace(/\n/g, "\\n");
const decodeLabel = (label) =>
  label.replace(/\\([\\nr])/g, (_, char) =>
    char === "n" ? "\n" : char === "r" ? "\r" : "\\",
  );
export function mindMapToOutline(value) {
  const d = parseMindMap(value),
    { byId, children } = treeIndex(d),
    lines = [];
  const visit = (n, depth) => {
    lines.push("  ".repeat(depth) + "- " + encodeLabel(n.label));
    for (const child of children.get(n.id)) visit(child, depth + 1);
  };
  visit(byId.get(d.rootId), 0);
  return lines.join("\n");
}
export function outlineToMindMap(text) {
  if (typeof text !== "string" || text.length > MAX_JSON)
    fail("outline exceeds 1 MB");
  if (!text.trim()) return defaultMindMap();
  const nodes = [],
    stack = [],
    roots = [];
  let previousIndent = 0;
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (!raw.trim()) continue;
    const line = raw.replace(/^\t+/, (tabs) => "  ".repeat(tabs.length)),
      match = /^( *)(?:[-*+] |\d+\. )(.*)$/.exec(line);
    if (!match) fail("outline must use Markdown bullets");
    const indent = match[1].length,
      label = decodeLabel(match[2]);
    if (!nodes.length && indent !== 0)
      fail("outline must start at the root indentation");
    if (indent > previousIndent && stack.length === 0)
      fail("outline indentation");
    while (stack.length && stack.at(-1).indent >= indent) stack.pop();
    if (indent > 0 && (!stack.length || indent <= stack.at(-1).indent))
      fail("outline indentation");
    // A dedent must return to an indentation level already established by a sibling.
    if (
      indent < previousIndent &&
      indent !== 0 &&
      indent !== stack.at(-1)?.childIndent
    )
      fail("inconsistent outline indentation");
    if (stack.length >= 64) fail("outline nesting exceeds 64 levels");
    const node = { id: "idea-" + (nodes.length + 1), label };
    if (stack.length) {
      node.parentId = stack.at(-1).node.id;
      if (
        stack.at(-1).childIndent !== undefined &&
        stack.at(-1).childIndent !== indent
      )
        fail("inconsistent outline indentation");
      stack.at(-1).childIndent = indent;
    } else roots.push(node);
    nodes.push(node);
    if (nodes.length > MAX_NODES) fail("outline exceeds 300 ideas");
    stack.push({ node, indent });
    previousIndent = indent;
  }
  if (roots.length === 1)
    return parseMindMap({
      version: 1,
      rootId: roots[0].id,
      layout: "both",
      nodes,
    });
  const root = { id: "root", label: "Central idea" };
  for (const node of roots) node.parentId = root.id;
  return parseMindMap({
    version: 1,
    rootId: root.id,
    layout: "both",
    nodes: [root, ...nodes],
  });
}
export function mindMapToSvg(value, options = {}) {
  return diagramToSvg(
    layoutMindMap(value, {
      includeCollapsed: options.includeCollapsed ?? false,
    }),
    options,
  );
}
