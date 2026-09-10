import { unified } from "unified";
import remarkParse from "remark-parse";

const parser = unified().use(remarkParse);
export function diagramFences(body, language = "thread-diagram") {
  const result = [];
  function visit(node, inheritedId) {
    let blockId = inheritedId;
    for (const child of node.children || []) {
      if (child.type === "html") {
        const marker = child.value
          .trim()
          .match(/^<!-- thread:block id=([A-Za-z0-9_-]+) -->$/);
        if (marker) blockId = marker[1];
        else if (child.value.trim() === "<!-- thread:block -->")
          blockId = undefined;
      }
      if (child.type === "code" && child.lang === language)
        result.push({
          diagramIndex: result.length,
          blockId,
          value: child.value,
          start: child.position.start.offset,
          end: child.position.end.offset,
        });
      visit(child, blockId);
    }
  }
  visit(parser.parse(body));
  return result;
}

export function replaceDiagramFence(
  body,
  fence,
  json,
  language = "thread-diagram",
) {
  if (!["thread-diagram", "thread-mindmap"].includes(language))
    throw new Error("Unsupported visual block type.");
  if (!fence || body.slice(fence.start, fence.end).indexOf(language) < 0)
    throw new Error("This diagram moved. Reopen it before saving.");
  const lineStart = body.lastIndexOf("\n", fence.start - 1) + 1;
  const prefix = body.slice(lineStart, fence.start);
  const continuation = prefix.replace(/(?:[-+*]|\d+[.)])\s/g, (marker) =>
    " ".repeat(marker.length),
  );
  const delimiter = "`".repeat(
    Math.max(3, ...[...json.matchAll(/`+/g)].map((m) => m[0].length + 1)),
  );
  const replacement = [delimiter + language, json, delimiter].join(
    "\n" + continuation,
  );
  return body.slice(0, fence.start) + replacement + body.slice(fence.end);
}
