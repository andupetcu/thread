import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { strToU8, zipSync } from "fflate";
import { parseMindMap } from "./mindmap/model.js";
import { parseDiagram } from "./diagram/model.js";
import {
  nativeVisualFile,
  projectDiagramResources,
  projectedDiagramFence,
  relocateDiagramUrl,
  relativeDiagramPath,
  localDiagramAsset,
  diagramAssetName,
} from "./diagram/portable.js";
const parser = unified().use(remarkParse).use(remarkGfm);
async function fetchAsset(url) {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Cannot export attachment: ${url} (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}
async function renderDiagram(value) {
  return new Uint8Array(await (await fetch(value.preview)).arrayBuffer());
}
export async function portableMarkdownFiles(note, options = {}) {
  const load = options.fetchAsset || fetchAsset,
    render = options.renderDiagram || renderDiagram;
  const title = note.title.replace(/[\r\n]/g, " "),
    name =
      title
        .replace(/[^\p{L}\p{N} ._-]/gu, "_")
        .replace(/^\.+/, "")
        .slice(0, 100) || "Untitled";
  const body = note.body,
    files = {},
    edits = [],
    assets = new Map(),
    diagrams = [],
    mindmaps = [],
    warnings = new Set();
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
    if (node.type === "code" && node.lang === "thread-mindmap")
      mindmaps.push(node);
    (node.children || []).forEach(visit);
  }
  visit(parser.parse(body));
  for (const [url, path] of assets) files[path] = await load(url);
  for (const [nodes, language, directory, label] of [
    [diagrams, "thread-diagram", "diagrams", "Diagram"],
    [mindmaps, "thread-mindmap", "mindmaps", "Mind map"],
  ]) {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i],
        data =
          language === "thread-diagram"
            ? parseDiagram(node.value)
            : parseMindMap(node.value),
        path = `${directory}/${language === "thread-diagram" ? "diagram" : "mindmap"}-${i + 1}`;
      const project = (fromFile) =>
        projectDiagramResources(data, {
          relativeUrl: (url) => relocateDiagramUrl(url, name + ".md", fromFile),
          assetUrl: async (url) => {
            if (!localDiagramAsset(url))
              throw new Error(`Cannot locate attachment: ${url}`);
            let target = assets.get(url);
            if (!target) {
              target = "assets/" + diagramAssetName(url);
              let suffix = 2;
              while ([...assets.values()].includes(target))
                target = `assets/${suffix++}-${diagramAssetName(url)}`;
              assets.set(url, target);
            }
            if (!files[target]) files[target] = await load(url);
            return relativeDiagramPath(fromFile, target);
          },
          linkUrl: (link) => {
            warnings.add(
              `${label} reference requires its Thread workspace: ${link.noteId || link.bundleId}`,
            );
          },
        });
      const sidecar = await project(path + ".json");
      files[path + ".json"] = strToU8(JSON.stringify(sidecar, null, 2));
      const native = nativeVisualFile(sidecar);
      files[path + native.extension] = strToU8(native.content);
      let preview = "";
      if (data.preview) {
        files[path + ".png"] = await render(data);
        preview = `![${label} ${i + 1}](${path}.png)\n\n`;
      } else
        warnings.add(
          `${label} ${i + 1}: no saved PNG preview; native editable source included.`,
        );
      edits.push(
        projectedDiagramFence(
          body,
          node,
          JSON.stringify(await project(name + ".md")),
          preview +
            `[Editable ${label.toLowerCase()}](${path}${native.extension})`,
          language,
        ),
      );
    }
  }
  let portable = body;
  for (const edit of edits.sort((a, b) => b.start - a.start))
    portable =
      portable.slice(0, edit.start) + edit.value + portable.slice(edit.end);
  files[name + ".md"] = strToU8(`# ${title}\n\n${portable}\n`);
  files["README.txt"] = strToU8(
    "Open the Markdown file in any Markdown reader. Local attachments are in assets/. Diagrams and mind maps retain their editable thread-diagram/thread-mindmap JSON fences and include native .drawio/.drawnix files plus saved PNG previews when available. Note and block references use Thread addresses and require their source notes.\n" +
      [...warnings].join("\n"),
  );
  return files;
}
export async function toMarkdownBundle(note) {
  return new Blob([zipSync(await portableMarkdownFiles(note), { level: 6 })], {
    type: "application/zip",
  });
}
