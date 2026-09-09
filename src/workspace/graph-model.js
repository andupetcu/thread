import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

const parser = unified().use(remarkParse).use(remarkGfm);
const cache = new Map();
function relationships(note) {
  const previous = cache.get(note.id);
  if (previous?.body === note.body) return previous;
  const links = new Set(),
    tags = new Set();
  function visit(node) {
    if (["code", "inlineCode", "html", "image"].includes(node.type)) return;
    if (node.type === "link" && node.url.startsWith("note:"))
      links.add(node.url.slice(5).split("#")[0]);
    if (node.type === "link" && node.url.startsWith("block:"))
      links.add(node.url.slice(6).split("/")[0]);
    if (node.type === "text") {
      for (const match of node.value.matchAll(/(?:^|\s)#([\p{L}\p{N}_-]+)/gu))
        tags.add(match[1]);
      for (const match of node.value.matchAll(/!\[\[([^\]#]+)#[^\]]+\]\]/g))
        links.add(match[1]);
    }
    for (const child of node.children || []) visit(child);
  }
  visit(parser.parse(note.body || ""));
  const result = { body: note.body, links: [...links], tags: [...tags] };
  cache.set(note.id, result);
  return result;
}

export function relationshipGraph(notes, sharedTags = false) {
  const ids = new Set(notes.map((n) => n.id));
  if (cache.size > Math.max(notes.length * 2, 5000))
    for (const id of cache.keys()) if (!ids.has(id)) cache.delete(id);
  const nodes = notes.map((note) => ({
    id: note.id,
    kind: "note",
    label: note.title || "Untitled note",
    tags: relationships(note).tags,
  }));
  const edges = [];
  const tagMembers = new Map();
  for (const note of notes) {
    const meta = relationships(note);
    for (const id of meta.links)
      if (ids.has(id) && id !== note.id)
        edges.push({ source: note.id, target: id, kind: "mention" });
    if (sharedTags)
      for (const tag of meta.tags) {
        if (!tagMembers.has(tag)) tagMembers.set(tag, []);
        tagMembers.get(tag).push(note.id);
      }
  }
  for (const [tag, members] of tagMembers) {
    if (members.length < 2) continue;
    let id = `tag:${tag}`;
    while (ids.has(id)) id = "tag:" + id;
    ids.add(id);
    nodes.push({ id, kind: "tag", label: "#" + tag, tags: [tag] });
    for (const member of members)
      edges.push({ source: member, target: id, kind: "tag" });
  }
  return { nodes, edges };
}

export function neighborhood(graph, focus, depth = 1) {
  if (!focus || !graph.nodes.some((n) => n.id === focus)) return graph;
  const adjacent = new Map(graph.nodes.map((n) => [n.id, new Set()]));
  const kinds = new Map(graph.nodes.map((n) => [n.id, n.kind]));
  for (const e of graph.edges) {
    adjacent.get(e.source)?.add(e.target);
    adjacent.get(e.target)?.add(e.source);
  }
  const visible = new Set([focus]),
    visitedTags = new Set();
  let frontier = [focus];
  for (
    let step = 0;
    step < Math.max(1, Math.min(10, Number(depth) || 1));
    step++
  ) {
    const next = new Set();
    for (const id of frontier)
      for (const neighbor of adjacent.get(id) || []) {
        if (kinds.get(neighbor) === "tag") {
          visible.add(neighbor);
          if (visitedTags.has(neighbor)) continue;
          visitedTags.add(neighbor);
          for (const member of adjacent.get(neighbor))
            if (!visible.has(member)) next.add(member);
        } else if (!visible.has(neighbor)) next.add(neighbor);
      }
    for (const id of next) visible.add(id);
    frontier = [...next];
  }
  return {
    nodes: graph.nodes.filter((n) => visible.has(n.id)),
    edges: graph.edges.filter(
      (e) => visible.has(e.source) && visible.has(e.target),
    ),
  };
}
