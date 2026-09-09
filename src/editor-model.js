import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { templates } from "./model";
const BOUNDARY = "<!-- thread:block -->";
const parser = unified().use(remarkParse).use(remarkGfm);
const ID_MARKER = /^<!-- thread:block id=([A-Za-z0-9_-]+) -->$/;
export const newBlockId = () => globalThis.crypto.randomUUID();
export function parseBlocks(body) {
  const blocks = [];
  let marker = null;
  for (const node of parser.parse(body).children) {
    const match = node.type === "html" && node.value.trim().match(ID_MARKER);
    if (match) {
      marker = {
        id: match[1],
        markerStart: node.position.start.offset,
        markerEnd: node.position.end.offset,
      };
      continue;
    }
    if (node.type === "html" && node.value.trim() === BOUNDARY) continue;
    blocks.push({
      type: node.type,
      ...(marker || {}),
      start: node.position.start.offset,
      end: node.position.end.offset,
      source: body.slice(node.position.start.offset, node.position.end.offset),
    });
    marker = null;
  }
  return blocks;
}
export function ensureBlockIds(body, createId = newBlockId) {
  const seen = new Set();
  const edits = [];
  for (const block of parseBlocks(body)) {
    if (block.id && !seen.has(block.id)) {
      seen.add(block.id);
      continue;
    }
    const id = createId();
    seen.add(id);
    edits.push({
      start: block.markerStart ?? block.start,
      end: block.markerEnd ?? block.start,
      value:
        `<!-- thread:block id=${id} -->` +
        (block.markerEnd == null ? "\n\n" : ""),
    });
  }
  for (const edit of edits.reverse())
    body = body.slice(0, edit.start) + edit.value + body.slice(edit.end);
  return body;
}
export function blockById(body, id) {
  return parseBlocks(body).find((block) => block.id === id) || null;
}
export function blockReference(noteId, blockId, label) {
  return `@[${label.replace(/[\[\]\n]/g, "")}](block:${encodeURIComponent(noteId)}/${encodeURIComponent(blockId)})`;
}
export function blockEmbed(noteId, blockId) {
  return `![[${noteId}#${blockId}]]`;
}
export function resolveBlockReference(notes, noteId, blockId) {
  const note = notes.find((note) => note.id === noteId);
  const block = note && blockById(note.body, blockId);
  return block ? { note, block } : null;
}
function text(node) {
  return node.value || node.alt || (node.children || []).map(text).join("");
}
export function outline(body) {
  const result = [];
  function visit(node) {
    if (node.type === "heading")
      result.push({
        title: text(node),
        depth: node.depth,
        start: node.position.start.offset,
      });
    for (const child of node.children || []) visit(child);
  }
  visit(parser.parse(body));
  return result;
}
export function replaceBlock(body, block, replacement) {
  return body.slice(0, block.start) + replacement + body.slice(block.end);
}
export function moveBlock(body, from, to) {
  return operateBlock(body, from, { to });
}
export function operateBlock(body, index, action) {
  const original = parseBlocks(body);
  if (!original[index]) return body;
  const blocks = original.map((block, i) => ({ ...block, originalIndex: i }));
  if (action === "delete") blocks.splice(index, 1);
  else if (action === "duplicate")
    blocks.splice(index + 1, 0, {
      ...blocks[index],
      id: blocks[index].id ? newBlockId() : undefined,
      originalIndex: -1,
    });
  else if (action === "up" || action === "down") {
    const next = index + (action === "up" ? -1 : 1);
    if (next < 0 || next >= blocks.length) return body;
    [blocks[index], blocks[next]] = [blocks[next], blocks[index]];
  } else if (
    typeof action === "object" &&
    Number.isInteger(action.to) &&
    action.to >= 0 &&
    action.to < blocks.length
  ) {
    blocks.splice(action.to, 0, blocks.splice(index, 1)[0]);
  } else return body;
  if (!blocks.length) return "";
  blocks.forEach((block, index) => {
    if (block.type !== "code" || index === blocks.length - 1) return;
    const lines = block.source.split(/\r?\n/);
    const opening = lines[0].match(/^ {0,3}(`{3,}|~{3,})/);
    if (!opening) return;
    const fence = opening[1];
    const closing = new RegExp(
      "^ {0,3}" + fence[0] + "{" + fence.length + ",}[ \\t]*$",
    );
    if (!lines.slice(1).some((line) => closing.test(line))) {
      block.source += (block.source.endsWith("\n") ? "" : "\n") + fence;
    }
  });
  const markedSource = (block) =>
    block.id
      ? `<!-- thread:block id=${block.id} -->\n\n${block.source}`
      : block.source;
  let result =
    body.slice(0, original[0].markerStart ?? original[0].start) +
    markedSource(blocks[0]);
  for (let i = 1; i < blocks.length; i++) {
    const previous = blocks[i - 1],
      current = blocks[i];
    let gap =
      current.originalIndex === previous.originalIndex + 1
        ? body.slice(previous.end, current.markerStart ?? current.start)
        : "\n\n";
    // CommonMark merges adjacent lists/quotes even across blank lines. A standard
    // invisible comment keeps independently moved or duplicated blocks distinct.
    if (
      previous.type === current.type &&
      ["list", "blockquote", "code"].includes(current.type) &&
      !gap.includes(BOUNDARY)
    )
      gap = "\n\n" + BOUNDARY + "\n\n";
    result += gap + markedSource(current);
  }
  return result + body.slice(original.at(-1).end);
}
export function suggestions(kind, query, notes, tags, noteId) {
  return (
    kind === "/"
      ? templates.map(([label, value, group]) => ({ label, value, group }))
      : kind === "@"
        ? [
            ...notes
              .filter((n) => n.id !== noteId)
              .map((n) => ({
                label: n.title,
                value: `@[${n.title.replace(/[\[\]]/g, "")}](note:${n.id}) `,
                group: "Note",
              })),
            ...notes.flatMap((n) =>
              parseBlocks(n.body)
                .filter((b) => b.id)
                .flatMap((b) => {
                  const label = `${n.title} · ${b.source.replace(/[#*`\n]/g, " ").slice(0, 72)}`;
                  return [
                    {
                      label,
                      value: blockReference(n.id, b.id, label) + " ",
                      group: "Block",
                    },
                    {
                      label: `Embed ${label}`,
                      value: blockEmbed(n.id, b.id) + " ",
                      group: "Embed",
                    },
                  ];
                }),
            ),
          ]
        : tags.map((t) => ({ label: t, value: "#" + t + " ", group: "Tag" }))
  ).filter((o) => o.label.toLowerCase().includes(query.toLowerCase()));
}
export function referenceExcerpt(body, id) {
  const lines = body.split("\n");
  const line = lines.find((l) => l.includes(`](note:${id})`)) || body;
  return line
    .replace(/@\[([^\]]+)\]\(note:[^)]+\)/g, "@$1")
    .replace(/[#*`]/g, "")
    .trim()
    .slice(0, 180);
}
