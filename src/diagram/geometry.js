import { NODE_WIDTH, NODE_HEIGHT } from "./document.js";
export const escapeSvg = (s) =>
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
export const nodeSize = (n) => ({
  width: n.width ?? NODE_WIDTH,
  height: n.height ?? NODE_HEIGHT,
});
export function absolutePosition(node, nodes) {
  const byId =
    nodes instanceof Map ? nodes : new Map(nodes.map((n) => [n.id, n]));
  let x = node.position.x,
    y = node.position.y,
    p = node;
  const seen = new Set([p.id]);
  while (p.parentId) {
    p = byId.get(p.parentId);
    if (!p || seen.has(p.id)) throw new Error("Invalid diagram parent");
    seen.add(p.id);
    x += p.position.x;
    y += p.position.y;
  }
  return { x, y };
}
export function nodeShapeSvg(n) {
  const { width: w, height: h } = nodeSize(n),
    color = escapeSvg(n.data.color),
    style = `fill="${color}" stroke="#7a8699" stroke-width="1"`,
    shape = n.data.shape;
  if (shape === "text") return "";
  if (shape === "decision")
    return `<polygon points="${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}" ${style}/>`;
  if (shape === "ellipse")
    return `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2}" ry="${h / 2}" ${style}/>`;
  if (shape === "database") {
    const r = Math.min(16, h / 5);
    return `<path d="M 0 ${r} C 0 ${-r / 3} ${w} ${-r / 3} ${w} ${r} L ${w} ${h - r} C ${w} ${h + r / 3} 0 ${h + r / 3} 0 ${h - r} Z" ${style}/><ellipse cx="${w / 2}" cy="${r}" rx="${w / 2}" ry="${r}" ${style}/>`;
  }
  if (shape === "document") {
    const r = Math.min(16, h / 5);
    return `<path d="M 0 0 H ${w} V ${h - r} C ${w * 0.65} ${h - r * 3} ${w * 0.35} ${h + r} 0 ${h - r} Z" ${style}/>`;
  }
  if (shape === "annotation")
    return `<path d="M ${Math.min(16, w / 5)} 0 H 0 V ${h} H ${Math.min(16, w / 5)}" fill="none" stroke="#7a8699"/><rect x="1" y="1" width="${w - 2}" height="${h - 2}" fill="${color}" fill-opacity="0.4"/>`;
  const frame = ["group", "swimlane"].includes(shape);
  return `<rect x="0" y="0" width="${w}" height="${h}" rx="${shape === "terminator" ? Math.min(w, h) / 2 : frame ? 3 : 10}" ${style}${frame ? ' fill-opacity="0.35"' : ""}${shape === "group" ? ' stroke-dasharray="6 4"' : ""}/>${shape === "swimlane" ? `<path d="M 0 32 H ${w}" stroke="#7a8699"/>` : ""}`;
}
// Conservative text metrics are deterministic in browser and export. Shrink to fit,
// retaining every character and explicit paragraph break instead of clipping lines.
export function nodeLabelLayout(n) {
  const { width: w, height: h } = nodeSize(n),
    shape = n.data.shape,
    frame = ["group", "swimlane"].includes(shape);
  const inset = Math.min(12, w / 8),
    availableWidth = Math.max(
      4,
      (shape === "decision" ? w * 0.57 : shape === "ellipse" ? w * 0.72 : w) -
        inset * 2,
    ),
    availableHeight = Math.max(
      4,
      frame
        ? 24
        : shape === "decision"
          ? h * 0.52
          : shape === "database"
            ? h - 38
            : shape === "document"
              ? h - 32
              : h - 16,
    );
  const requested = n.data.fontSize ?? 13;
  const advance = (char) =>
    /[MWmw@%&#]/.test(char)
      ? 1
      : /[A-Z]/.test(char)
        ? 0.85
        : /[ilI.,'!|:;]/.test(char)
          ? 0.36
          : char.codePointAt(0) > 255
            ? 1.1
            : 0.67;
  const wrap = (size) =>
    n.data.label.split("\n").flatMap((paragraph) => {
      if (!paragraph) return [""];
      const lines = [];
      let line = "",
        width = 0;
      for (const char of Array.from(paragraph)) {
        const next = advance(char) * size;
        if (line && width + next > availableWidth) {
          lines.push(line);
          line = "";
          width = 0;
        }
        line += char;
        width += next;
      }
      lines.push(line);
      return lines;
    });
  let size = Math.min(requested, availableWidth / 1.1),
    lines = wrap(size);
  while (lines.length * size * 1.2 > availableHeight) {
    size = Math.min(size * 0.9, availableHeight / (lines.length * 1.2));
    lines = wrap(size);
  }
  const align = n.data.textAlign ?? "center",
    x =
      align === "left"
        ? (w - availableWidth) / 2
        : align === "right"
          ? (w + availableWidth) / 2
          : w / 2;
  return {
    lines,
    fontSize: size,
    lineHeight: size * 1.2,
    x,
    y: frame
      ? 16 - (lines.length - 1) * size * 0.6
      : h / 2 - (lines.length - 1) * size * 0.6 + size * 0.35,
    textAnchor:
      align === "left" ? "start" : align === "right" ? "end" : "middle",
  };
}
export const nodeLabelLines = (n) => nodeLabelLayout(n).lines;
const direction = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};
function port(n, handle, nodes) {
  const { x, y } = absolutePosition(n, nodes),
    { width: w, height: h } = nodeSize(n),
    side = handle.split("-")[1],
    v = direction[side];
  return { x: x + ((v.x + 1) * w) / 2, y: y + ((v.y + 1) * h) / 2, v };
}
function orthogonalRoute(s, t, a, b, nodes, gap) {
  const boxes = [a, b].map((n) => {
    const p = absolutePosition(n, nodes),
      z = nodeSize(n);
    return {
      left: p.x,
      right: p.x + z.width,
      top: p.y,
      bottom: p.y + z.height,
    };
  });
  const start = { x: s.x + s.v.x * gap, y: s.y + s.v.y * gap },
    end = { x: t.x + t.v.x * gap, y: t.y + t.v.y * gap };
  const left = Math.min(...boxes.map((r) => r.left)) - gap,
    right = Math.max(...boxes.map((r) => r.right)) + gap,
    top = Math.min(...boxes.map((r) => r.top)) - gap,
    bottom = Math.max(...boxes.map((r) => r.bottom)) + gap;
  const candidates = [
    [start, { x: end.x, y: start.y }, end],
    [start, { x: start.x, y: end.y }, end],
  ];
  for (const x of [left, right, (start.x + end.x) / 2])
    candidates.push([start, { x, y: start.y }, { x, y: end.y }, end]);
  for (const y of [top, bottom, (start.y + end.y) / 2])
    candidates.push([start, { x: start.x, y }, { x: end.x, y }, end]);
  for (const x of [left, right])
    for (const y of [top, bottom]) {
      candidates.push([
        start,
        { x, y: start.y },
        { x, y },
        { x: end.x, y },
        end,
      ]);
      candidates.push([
        start,
        { x: start.x, y },
        { x, y },
        { x, y: end.y },
        end,
      ]);
    }
  const intersects = (p, q, r) =>
    p.x === q.x
      ? p.x > r.left &&
        p.x < r.right &&
        Math.max(p.y, q.y) > r.top &&
        Math.min(p.y, q.y) < r.bottom
      : p.y > r.top &&
        p.y < r.bottom &&
        Math.max(p.x, q.x) > r.left &&
        Math.min(p.x, q.x) < r.right;
  const score = (points) =>
    points
      .slice(1)
      .reduce(
        (total, p, i) =>
          total +
          Math.abs(p.x - points[i].x) +
          Math.abs(p.y - points[i].y) +
          (boxes.some((r) => intersects(points[i], p, r)) ? 1e7 : 0),
        0,
      );
  candidates.sort((p, q) => score(p) - score(q));
  return [s, ...candidates[0], t];
}
function polylineMid(points) {
  const lengths = points
    .slice(1)
    .map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  let left = lengths.reduce((a, b) => a + b, 0) / 2;
  for (let i = 0; i < lengths.length; i++) {
    if (left <= lengths[i]) {
      const t = lengths[i] ? left / lengths[i] : 0;
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * t,
        y: points[i].y + (points[i + 1].y - points[i].y) * t,
      };
    }
    left -= lengths[i];
  }
  return points[0];
}
export function edgeGeometry(e, nodes) {
  const byId =
    nodes instanceof Map ? nodes : new Map(nodes.map((n) => [n.id, n]));
  const a = byId.get(e.source),
    b = byId.get(e.target);
  if (!a || !b) throw new Error("Invalid edge endpoint");
  const s = port(
      a,
      e.sourceHandle === "out" || !e.sourceHandle
        ? "out-bottom"
        : e.sourceHandle,
      byId,
    ),
    t = port(
      b,
      e.targetHandle === "in" || !e.targetHandle ? "in-top" : e.targetHandle,
      byId,
    );
  const gap = Math.max(45, Math.min(400, Math.hypot(t.x - s.x, t.y - s.y) / 2)),
    c1 = { x: s.x + s.v.x * gap, y: s.y + s.v.y * gap },
    c2 = { x: t.x + t.v.x * gap, y: t.y + t.v.y * gap };
  let points, path, label;
  if (e.source === e.target) {
    const pos = absolutePosition(a, byId),
      { width: w, height: h } = nodeSize(a),
      margin = 50,
      left = pos.x - margin,
      right = pos.x + w + margin,
      top = pos.y - margin,
      bottom = pos.y + h + margin;
    const outer = (p) => ({
      x: p.v.x < 0 ? left : p.v.x > 0 ? right : p.x,
      y: p.v.y < 0 ? top : p.v.y > 0 ? bottom : p.y,
    });
    const so = outer(s),
      to = outer(t);
    // Travel clockwise around the node's outer rectangle, avoiding its interior.
    const sideIndex = (p) =>
        p.v.y < 0 ? 0 : p.v.x > 0 ? 1 : p.v.y > 0 ? 2 : 3,
      corners = [
        { x: right, y: top },
        { x: right, y: bottom },
        { x: left, y: bottom },
        { x: left, y: top },
      ];
    points = [s, so];
    let side = sideIndex(s),
      end = sideIndex(t),
      steps = (end - side + 4) % 4;
    if (steps === 0) steps = 4;
    for (let i = 0; i < steps; i++) points.push(corners[(side + i) % 4]);
    points.push(to, t);
  } else if (e.kind === "straight") {
    points = [s, t];
  } else if (e.kind === "orthogonal") {
    points = orthogonalRoute(s, t, a, b, byId, 45);
  } else {
    path = `M ${s.x} ${s.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${t.x} ${t.y}`;
    points = [s, c1, c2, t];
    label = {
      x: (s.x + 3 * c1.x + 3 * c2.x + t.x) / 8,
      y: (s.y + 3 * c1.y + 3 * c2.y + t.y) / 8,
    };
  }
  if (!path) {
    path = points.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" ");
    label = polylineMid(points);
  }
  const padding = Math.max(12, (e.width ?? 2) * 9),
    labelHalf = (e.label?.length ?? 0) * 6.6;
  return {
    path,
    labelX: label.x,
    labelY: label.y - 8,
    sourceX: s.x,
    sourceY: s.y,
    targetX: t.x,
    targetY: t.y,
    bounds: {
      minX: Math.min(...points.map((p) => p.x), label.x - labelHalf) - padding,
      minY: Math.min(...points.map((p) => p.y), label.y - 22) - padding,
      maxX: Math.max(...points.map((p) => p.x), label.x + labelHalf) + padding,
      maxY: Math.max(...points.map((p) => p.y), label.y + 4) + padding,
    },
  };
}
