import { parseDiagram } from "./model.js";
import dagre from "@dagrejs/dagre";
const size = (n) => ({ width: n.width || 180, height: n.height || 90 });
const uid = () => crypto.randomUUID();
export function worldPosition(n, nodes) {
  let p = { ...n.position },
    parent = n.parentId;
  const seen = new Set([n.id]);
  while (parent && !seen.has(parent)) {
    seen.add(parent);
    const a = nodes.find((v) => v.id === parent);
    if (!a) break;
    p.x += a.position.x;
    p.y += a.position.y;
    parent = a.parentId;
  }
  return p;
}
function selectedIds(d, descendants = false) {
  const ids = new Set(d.nodes.filter((n) => n.selected).map((n) => n.id));
  if (descendants) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const n of d.nodes)
        if (ids.has(n.parentId) && !ids.has(n.id)) {
          ids.add(n.id);
          changed = true;
        }
    }
  }
  return ids;
}
export function selectedSubgraph(d) {
  const ids = selectedIds(d, true);
  return {
    version: 2,
    nodes: d.nodes
      .filter((n) => ids.has(n.id))
      .map((n) => {
        const v = structuredClone(n);
        if (v.parentId && !ids.has(v.parentId)) {
          v.position = worldPosition(n, d.nodes);
          delete v.parentId;
        }
        delete v.selected;
        return v;
      }),
    edges: d.edges
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .map((e) => ({ ...e, selected: false })),
  };
}
export function insertDiagram(d, addition, offset = { x: 40, y: 40 }) {
  const ids = new Map(addition.nodes.map((n) => [n.id, uid()]));
  return {
    ...d,
    nodes: [
      ...d.nodes.map((n) => ({ ...n, selected: false })),
      ...addition.nodes.map((n) => ({
        ...structuredClone(n),
        id: ids.get(n.id),
        parentId: n.parentId ? ids.get(n.parentId) : undefined,
        position: n.parentId
          ? { ...n.position }
          : { x: n.position.x + offset.x, y: n.position.y + offset.y },
        selected: true,
      })),
    ],
    edges: [
      ...d.edges.map((e) => ({ ...e, selected: false })),
      ...addition.edges.map((e) => ({
        ...e,
        id: uid(),
        source: ids.get(e.source),
        target: ids.get(e.target),
        selected: true,
      })),
    ],
  };
}
export const duplicateSelection = (d) => insertDiagram(d, selectedSubgraph(d));
export const styleSelection = (d, data) => ({
  ...d,
  nodes: d.nodes.map((n) =>
    n.selected && !n.locked ? { ...n, data: { ...n.data, ...data } } : n,
  ),
});
export const lockSelection = (d, locked) => ({
  ...d,
  nodes: d.nodes.map((n) => (n.selected ? { ...n, locked } : n)),
});
export function deleteSelection(d) {
  const ids = selectedIds(d, true);
  for (const n of d.nodes) if (n.locked) ids.delete(n.id);
  return {
    ...d,
    nodes: d.nodes
      .filter((n) => !ids.has(n.id))
      .map((n) => {
        if (!ids.has(n.parentId)) return n;
        const v = { ...n, position: worldPosition(n, d.nodes) };
        delete v.parentId;
        return v;
      }),
    edges: d.edges.filter(
      (e) => !e.selected && !ids.has(e.source) && !ids.has(e.target),
    ),
  };
}
export function groupSelection(d, shape = "group") {
  const candidates = d.nodes.filter((n) => n.selected && !n.locked);
  const ids = new Set(candidates.map((n) => n.id));
  const roots = candidates.filter((n) => !ids.has(n.parentId));
  if (!roots.length) return d;
  const positions = roots.map((n) => ({
    ...worldPosition(n, d.nodes),
    ...size(n),
  }));
  const x = Math.min(...positions.map((p) => p.x)) - 30,
    y = Math.min(...positions.map((p) => p.y)) - 50,
    id = uid();
  const group = {
    id,
    type: "diagramShape",
    position: { x, y },
    width: Math.max(...positions.map((p) => p.x + p.width)) - x + 30,
    height: Math.max(...positions.map((p) => p.y + p.height)) - y + 30,
    data: {
      shape,
      label: shape === "swimlane" ? "Swimlane" : "Group",
      color: "#e8eefc",
    },
    selected: true,
  };
  return {
    ...d,
    nodes: [
      group,
      ...d.nodes.map((n) =>
        roots.includes(n)
          ? {
              ...n,
              parentId: id,
              position: {
                x: worldPosition(n, d.nodes).x - x,
                y: worldPosition(n, d.nodes).y - y,
              },
              selected: false,
            }
          : { ...n, selected: false },
      ),
    ],
  };
}
export function ungroupSelection(d) {
  const ids = new Set(
    d.nodes
      .filter(
        (n) =>
          n.selected &&
          !n.locked &&
          ["group", "swimlane"].includes(n.data.shape),
      )
      .map((n) => n.id),
  );
  return {
    ...d,
    nodes: d.nodes
      .filter((n) => !ids.has(n.id))
      .map((n) => {
        if (!ids.has(n.parentId)) return n;
        const v = { ...n, position: worldPosition(n, d.nodes), selected: true };
        delete v.parentId;
        return v;
      }),
    edges: d.edges.filter((e) => !ids.has(e.source) && !ids.has(e.target)),
  };
}
export function alignSelection(d, mode) {
  const selected = new Set(
    d.nodes.filter((n) => n.selected && !n.locked).map((n) => n.id),
  );
  const chosen = d.nodes.filter((n) => {
    if (!selected.has(n.id)) return false;
    let parent = n.parentId;
    while (parent) {
      if (selected.has(parent)) return false;
      parent = d.nodes.find((v) => v.id === parent)?.parentId;
    }
    return true;
  });
  if (chosen.length < 2) return d;
  const entries = chosen.map((n) => ({
    n,
    p: worldPosition(n, d.nodes),
    s: size(n),
  }));
  const axis = ["top", "bottom", "middle", "vertical"].includes(mode)
      ? "y"
      : "x",
    dimension = axis === "x" ? "width" : "height";
  let targets = new Map();
  if (["horizontal", "vertical"].includes(mode)) {
    entries.sort((a, b) => a.p[axis] - b.p[axis]);
    const min = entries[0].p[axis],
      max = entries.at(-1).p[axis];
    entries.forEach((e, i) =>
      targets.set(e.n.id, min + ((max - min) * i) / (entries.length - 1)),
    );
  } else {
    const start = Math.min(...entries.map((e) => e.p[axis])),
      end = Math.max(...entries.map((e) => e.p[axis] + e.s[dimension]));
    for (const e of entries)
      targets.set(
        e.n.id,
        ["left", "top"].includes(mode)
          ? start
          : ["right", "bottom"].includes(mode)
            ? end - e.s[dimension]
            : (start + end - e.s[dimension]) / 2,
      );
  }
  return {
    ...d,
    nodes: d.nodes.map((n) =>
      targets.has(n.id)
        ? {
            ...n,
            position: {
              ...n.position,
              [axis]:
                n.position[axis] +
                targets.get(n.id) -
                worldPosition(n, d.nodes)[axis],
            },
          }
        : n,
    ),
  };
}
export function autoLayout(d, direction = "TB") {
  const nodes = d.nodes.map((n) => structuredClone(n));
  const pinned = new Set(nodes.filter((n) => n.locked).map((n) => n.id));
  for (const node of nodes.filter((n) => n.locked)) {
    let parent = node.parentId;
    while (parent) {
      pinned.add(parent);
      parent = nodes.find((n) => n.id === parent)?.parentId;
    }
  }

  for (const parent of new Set(nodes.map((n) => n.parentId))) {
    const siblings = nodes.filter((n) => n.parentId === parent);
    const ids = new Set(siblings.map((n) => n.id));
    const graph = new dagre.graphlib.Graph()
      .setGraph({ rankdir: direction, nodesep: 60, ranksep: 90 })
      .setDefaultEdgeLabel(() => ({}));
    for (const n of siblings) graph.setNode(n.id, size(n));
    for (const e of d.edges)
      if (ids.has(e.source) && ids.has(e.target))
        graph.setEdge(e.source, e.target);
    dagre.layout(graph);
    for (const n of siblings)
      if (!pinned.has(n.id)) {
        const p = graph.node(n.id);
        n.position = {
          x: p.x - size(n).width / 2 + (parent ? 30 : 0),
          y: p.y - size(n).height / 2 + (parent ? 50 : 0),
        };
      }
  }
  return { ...d, nodes };
}
export const draftKey = (context) =>
  context?.noteId
    ? `thread-diagram-draft:${encodeURIComponent(context.noteId)}:${encodeURIComponent(context.blockId || context.diagramIndex || 0)}`
    : null;
export function parentFirst(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const depth = (n) => {
    let count = 0,
      p = n.parentId;
    const seen = new Set();
    while (p && !seen.has(p)) {
      seen.add(p);
      count++;
      p = byId.get(p)?.parentId;
    }
    return count;
  };
  return [...nodes].sort((a, b) => depth(a) - depth(b));
}
export function diagramAssetKind(file) {
  if (
    !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type)
  )
    return "document";
  if (file.size > 10 * 1024 * 1024)
    throw Error("Diagram images must be 10 MB or smaller.");
  return "image";
}

export function prepareEditorChange(current, update) {
  const next = typeof update === "function" ? update(current) : update;
  const clean = parseDiagram(next);
  return {
    before: JSON.stringify(parseDiagram(current)),
    diagram: {
      ...clean,
      nodes: clean.nodes.map((n) => ({
        ...n,
        selected: next.nodes.find((v) => v.id === n.id)?.selected,
        measured: next.nodes.find((v) => v.id === n.id)?.measured,
      })),
      edges: clean.edges.map((e) => ({
        ...e,
        selected: next.edges.find((v) => v.id === e.id)?.selected,
      })),
    },
  };
}
export function recoveryNeedsReview(record, current, retain = false) {
  return (
    retain ||
    JSON.stringify(parseDiagram(record.diagram)) !==
      JSON.stringify(parseDiagram(current))
  );
}

export function retainMeasurements(current, next) {
  return {
    ...next,
    nodes: next.nodes.map((n) => {
      const previous = current.nodes.find((v) => v.id === n.id);
      return !n.measured &&
        previous?.measured &&
        previous.width === n.width &&
        previous.height === n.height
        ? { ...n, measured: previous.measured }
        : n;
    }),
  };
}
