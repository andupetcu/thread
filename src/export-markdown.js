import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { strToU8, zipSync } from "fflate";
import { diagramToPng, parseDiagram } from "./diagram/model";
const parser = unified().use(remarkParse).use(remarkGfm);
async function fetchAsset(url) {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Cannot export attachment: ${url} (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}
async function renderDiagram(value) {
  return new Uint8Array(
    await (await fetch(await diagramToPng(value))).arrayBuffer(),
  );
}
export async function portableMarkdownFiles(note, options = {}) {
  const load = options.fetchAsset || fetchAsset,
    render = options.renderDiagram || renderDiagram;
  const body = note.body,
    files = {},
    edits = [],
    assets = new Map(),
    diagrams = [];
  function visit(node) {
    if (
      ["link", "image", "definition"].includes(node.type) &&
      /^\/api\/assets\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(node.url)
    ) {
      const path = "assets/" + node.url.split("/").at(-1);
      assets.set(node.url, path);
      const original = body.slice(
          node.position.start.offset,
          node.position.end.offset,
        ),
        index = original.indexOf(
          node.url,
          node.type === "definition"
            ? original.indexOf("]:") + 2
            : original.lastIndexOf("](") + 2,
        );
      if (index >= 0)
        edits.push({
          start: node.position.start.offset + index,
          end: node.position.start.offset + index + node.url.length,
          value: path,
        });
    }
    if (node.type === "code" && node.lang === "thread-diagram")
      diagrams.push(node);
    (node.children || []).forEach(visit);
  }
  visit(parser.parse(body));
  for (const [url, path] of assets) files[path] = await load(url);
  for (let i = 0; i < diagrams.length; i++) {
    const node = diagrams[i],
      data = parseDiagram(node.value),
      path = `diagrams/diagram-${i + 1}`;
    files[path + ".json"] = strToU8(JSON.stringify(data, null, 2));
    files[path + ".png"] = await render(data);
    edits.push({
      start: node.position.end.offset,
      end: node.position.end.offset,
      value: `\n\n![Diagram ${i + 1}](${path}.png)`,
    });
  }
  let portable = body;
  for (const edit of edits.sort((a, b) => b.start - a.start))
    portable =
      portable.slice(0, edit.start) + edit.value + portable.slice(edit.end);
  const title = note.title.replace(/[\r\n]/g, " "),
    name =
      title
        .replace(/[^\p{L}\p{N} ._-]/gu, "_")
        .replace(/^\.+/, "")
        .slice(0, 100) || "Untitled";
  files[name + ".md"] = strToU8(`# ${title}\n\n${portable}\n`);
  files["README.txt"] = strToU8(
    "Open the Markdown file in any Markdown reader. Local attachments are in assets/. Diagrams retain their editable thread-diagram JSON fences and include PNG previews. Note and block references use Thread addresses and require their source notes.\n",
  );
  return files;
}
export async function toMarkdownBundle(note) {
  return new Blob([zipSync(await portableMarkdownFiles(note), { level: 6 })], {
    type: "application/zip",
  });
}
