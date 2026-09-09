export const SHAPES = ["process", "decision", "database", "text"];
export const COLORS = [
  "#e8eefc",
  "#dcf0e5",
  "#fff0cc",
  "#f5dce6",
  "#eae2f8",
  "#ffffff",
];
export const NODE_WIDTH = 180;
export const NODE_HEIGHT = 90;
export const defaultDiagram = () => ({ version: 1, nodes: [], edges: [] });
const fail = () => {
  throw new Error(
    "This diagram contains invalid or unsupported data. Keep the original source to recover it.",
  );
};
export function parseDiagram(value) {
  if (value === "" || value == null) return defaultDiagram();
  if (typeof value === "string" && value.length > 1000000) fail();
  let d;
  try {
    d = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    fail();
  }
  if (
    !d ||
    (d.version !== undefined && d.version !== 1) ||
    !Array.isArray(d.nodes) ||
    !Array.isArray(d.edges) ||
    d.nodes.length > 300 ||
    d.edges.length > 1000
  )
    fail();
  const ids = new Set();
  const nodes = d.nodes.map((n) => {
    if (
      !n ||
      typeof n.id !== "string" ||
      !/^[\w-]{1,100}$/.test(n.id) ||
      ids.has(n.id) ||
      !n.position ||
      !Number.isFinite(n.position.x) ||
      !Number.isFinite(n.position.y) ||
      Math.abs(n.position.x) > 100000 ||
      Math.abs(n.position.y) > 100000 ||
      !SHAPES.includes(n.data?.shape) ||
      typeof n.data.label !== "string" ||
      n.data.label.length > 500 ||
      !/^#[0-9a-f]{6}$/i.test(n.data.color)
    )
      fail();
    ids.add(n.id);
    return {
      id: n.id,
      type: "diagramShape",
      position: { x: n.position.x, y: n.position.y },
      data: { shape: n.data.shape, label: n.data.label, color: n.data.color },
    };
  });
  const edgeIds = new Set();
  const edges = d.edges.map((e) => {
    if (
      !e ||
      typeof e.id !== "string" ||
      !/^[\w-]{1,100}$/.test(e.id) ||
      edgeIds.has(e.id) ||
      !ids.has(e.source) ||
      !ids.has(e.target) ||
      (e.label != null && (typeof e.label !== "string" || e.label.length > 200))
    )
      fail();
    edgeIds.add(e.id);
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: "out",
      targetHandle: "in",
      label: e.label || "",
    };
  });
  return { version: 1, nodes, edges };
}
export function templateDiagram(name) {
  const node = (id, shape, label, x, y, color = COLORS[0]) => ({
    id,
    type: "diagramShape",
    position: { x, y },
    data: { shape, label, color },
  });
  const edge = (source, target, label = "") => ({
    id: `${source}-${target}`,
    source,
    target,
    sourceHandle: "out",
    targetHandle: "in",
    label,
  });
  if (name === "flow")
    return {
      version: 1,
      nodes: [
        node("start", "process", "Start", 0, 0),
        node("work", "process", "Do the work", 0, 170, COLORS[1]),
        node("finish", "process", "Finish", 0, 340),
      ],
      edges: [edge("start", "work"), edge("work", "finish")],
    };
  if (name === "decision")
    return {
      version: 1,
      nodes: [
        node("check", "decision", "Ready?", 140, 0, COLORS[2]),
        node("yes", "process", "Continue", 0, 190, COLORS[1]),
        node("no", "process", "Revise", 280, 190, COLORS[3]),
      ],
      edges: [edge("check", "yes", "Yes"), edge("check", "no", "No")],
    };
  if (name === "data")
    return {
      version: 1,
      nodes: [
        node("input", "process", "Collect", 0, 0),
        node("store", "database", "Store", 0, 180, COLORS[4]),
      ],
      edges: [edge("input", "store", "Save")],
    };
  return defaultDiagram();
}
const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c],
  );
function labelLines(text, width = 23) {
  const lines = [];
  for (const p of text.split("\n")) {
    if (!p) lines.push("");
    else
      for (let i = 0; i < p.length; i += width)
        lines.push(p.slice(i, i + width));
  }
  return lines.slice(0, 5);
}
export function diagramToSvg(value) {
  const d = parseDiagram(value);
  const xs = d.nodes.map((n) => n.position.x),
    ys = d.nodes.map((n) => n.position.y);
  const x = xs.length ? Math.min(...xs) - 60 : 0,
    y = ys.length ? Math.min(...ys) - 60 : 0,
    w = xs.length ? Math.max(...xs) + NODE_WIDTH + 60 - x : 480,
    h = ys.length ? Math.max(...ys) + NODE_HEIGHT + 60 - y : 180;
  const nodesById = new Map(d.nodes.map((n) => [n.id, n]));
  const edges = d.edges
    .map((e) => {
      const a = nodesById.get(e.source),
        b = nodesById.get(e.target),
        sx = a.position.x + 90,
        sy = a.position.y + 90,
        tx = b.position.x + 90,
        ty = b.position.y,
        cy = Math.max(45, Math.abs(ty - sy) / 2);
      return `<path d="M ${sx} ${sy} C ${sx} ${sy + cy}, ${tx} ${ty - cy}, ${tx} ${ty}" fill="none" stroke="#758093" stroke-width="2" marker-end="url(#arrow)"/>${e.label ? `<text x="${(sx + tx) / 2}" y="${(sy + ty) / 2 - 8}" text-anchor="middle" paint-order="stroke" stroke="#fff" stroke-width="5" fill="#334155" font-size="12">${escape(e.label)}</text>` : ""}`;
    })
    .join("");
  const nodes = d.nodes
    .map((n) => {
      const { shape, color, label } = n.data;
      let geometry = "";
      if (shape === "decision")
        geometry = `<polygon points="90,0 180,45 90,90 0,45" fill="${color}" stroke="#7a8699"/>`;
      else if (shape === "database")
        geometry = `<path d="M 0 16 C 0 -5 180 -5 180 16 L 180 74 C 180 95 0 95 0 74 Z" fill="${color}" stroke="#7a8699"/><ellipse cx="90" cy="16" rx="90" ry="16" fill="${color}" stroke="#7a8699"/>`;
      else if (shape === "process")
        geometry = `<rect x="0" y="0" width="180" height="90" rx="10" fill="${color}" stroke="#7a8699"/>`;
      const lines = labelLines(label, shape === "decision" ? 15 : 23);
      const text = lines
        .map((l, i) => `<tspan x="90" dy="${i ? 15 : 0}">${escape(l)}</tspan>`)
        .join("");
      return `<g transform="translate(${n.position.x} ${n.position.y})">${geometry}<text x="90" y="${49 - (lines.length - 1) * 7.5}" text-anchor="middle" fill="#202b40" font-size="13">${text}</text></g>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}" role="img" aria-label="Diagram" style="font-family:Arial,sans-serif"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#758093"/></marker></defs><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fff"/>${edges}${nodes}${!nodes ? '<text x="240" y="90" text-anchor="middle" fill="#758093" font-size="16">Add a shape to begin</text>' : ""}</svg>`;
}
export async function diagramToPng(value) {
  const svg = diagramToSvg(value);
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () =>
        reject(new Error("Diagram image could not be rendered."));
      img.src = url;
    });
    const scale = Math.min(2, 4096 / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(img.width * scale));
    canvas.height = Math.max(1, Math.ceil(img.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image export is unavailable.");
    context.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}
