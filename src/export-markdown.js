import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { strToU8, zipSync } from "fflate";
import { parseMindMap, layoutMindMap } from "./mindmap/model.js";
import { diagramToPng, parseDiagram } from "./diagram/model";
import {
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
  return new Uint8Array(
    await (await fetch(await diagramToPng(value))).arrayBuffer(),
  );
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
  for (let i = 0; i < diagrams.length; i++) {
    const node = diagrams[i],
      data = parseDiagram(node.value),
      path = `diagrams/diagram-${i + 1}`;
    const project = (fromFile) =>
      projectDiagramResources(data, {
        relativeUrl: (url) => relocateDiagramUrl(url, name + ".md", fromFile),
        assetUrl: async (url) => {
          if (!localDiagramAsset(url))
            throw new Error(`Cannot locate diagram attachment: ${url}`);
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
            `Diagram reference requires its Thread workspace: ${link.noteId || link.path || link.blockId}`,
          );
        },
      });
    files[path + ".json"] = strToU8(
      JSON.stringify(await project(path + ".json"), null, 2),
    );
    files[path + ".png"] = await render(data);
    edits.push(
      projectedDiagramFence(
        body,
        node,
        JSON.stringify(await project(name + ".md")),
        `![Diagram ${i + 1}](${path}.png)`,
      ),
    );
  }
  for (let i = 0; i < mindmaps.length; i++) {
    const node = mindmaps[i],
      data = parseMindMap(node.value),
      path = `mindmaps/mindmap-${i + 1}`;
    const project = async (fromFile) => {
      const projected = parseMindMap(data);
      for (const idea of projected.nodes) {
        const link = idea.link;
        if (!link) continue;
        if (link.kind === "url")
          idea.link = {
            ...link,
            url: relocateDiagramUrl(link.url, name + ".md", fromFile),
          };
        else if (link.kind === "asset") {
          if (!localDiagramAsset(link.url))
            throw new Error(`Cannot locate mind map attachment: ${link.url}`);
          let target = assets.get(link.url);
          if (!target) {
            target = "assets/" + diagramAssetName(link.url);
            let suffix = 2;
            while ([...assets.values()].includes(target))
              target = `assets/${suffix++}-${diagramAssetName(link.url)}`;
            assets.set(link.url, target);
          }
          if (!files[target]) files[target] = await load(link.url);
          idea.link = { ...link, url: relativeDiagramPath(fromFile, target) };
        } else
          warnings.add(
            `Mind map reference requires its Thread workspace: ${link.noteId || link.path || link.blockId || link.bundleId}`,
          );
      }
      return parseMindMap(projected);
    };
    files[path + ".json"] = strToU8(
      JSON.stringify(await project(path + ".json"), null, 2),
    );
    files[path + ".png"] = await render(layoutMindMap(data));
    edits.push(
      projectedDiagramFence(
        body,
        node,
        JSON.stringify(await project(name + ".md")),
        `![Mind map ${i + 1}](${path}.png)\n\n[Editable mind map (Thread JSON)](${path}.json)`,
        "thread-mindmap",
      ),
    );
  }
  let portable = body;
  for (const edit of edits.sort((a, b) => b.start - a.start))
    portable =
      portable.slice(0, edit.start) + edit.value + portable.slice(edit.end);
  files[name + ".md"] = strToU8(`# ${title}\n\n${portable}\n`);
  files["README.txt"] = strToU8(
    "Open the Markdown file in any Markdown reader. Local attachments are in assets/. Diagrams and mind maps retain their editable thread-diagram/thread-mindmap JSON fences and include PNG previews. Note and block references use Thread addresses and require their source notes.\n" +
      [...warnings].join("\n"),
  );
  return files;
}
export async function toMarkdownBundle(note) {
  return new Blob([zipSync(await portableMarkdownFiles(note), { level: 6 })], {
    type: "application/zip",
  });
}
