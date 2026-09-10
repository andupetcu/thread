import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { strToU8, zipSync } from "fflate";
import { parseMindMap } from "../mindmap/model.js";
import { parseDiagram } from "../diagram/model.js";
import {
  nativeVisualFile,
  projectDiagramResources,
  projectedDiagramFence,
  relocateDiagramUrl,
  relativeDiagramPath,
  localDiagramAsset,
  diagramAssetName,
} from "../diagram/portable.js";
import { resolveBundleReference } from "../../shared/okf/paths.mjs";

const parser = unified().use(remarkParse).use(remarkGfm);
const href = (path) => "/" + path.split("/").map(encodeURIComponent).join("/");
async function fetchAsset(url) {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Cannot export attachment (${response.status}).`);
  return new Uint8Array(await response.arrayBuffer());
}
async function renderDiagram(data, options) {
  return new Uint8Array(await (await fetch(data.preview)).arrayBuffer());
}

export function bundleExportWarnings(bundle) {
  const possibleCredential =
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bAKIA[A-Z0-9]{16}\b/;
  return (bundle.entries || [])
    .filter(
      (entry) =>
        typeof entry.source === "string" &&
        possibleCredential.test(entry.source),
    )
    .map(
      (entry) =>
        `${entry.path}: possible credential content. Review before sharing; export preserves authored text.`,
    );
}

// Export is a projection: the stored source and its review history are never changed.
export async function exportPortableBundle(bundle, options = {}) {
  const files = Object.create(null),
    warnings = bundleExportWarnings(bundle),
    entries = bundle.entries || [];
  const load = options.fetchAsset || fetchAsset,
    render = options.renderDiagram || renderDiagram;
  const paths = new Set(
    entries.map((entry) => entry.path.normalize("NFC").toLowerCase()),
  );
  let folder = "_thread-export",
    suffix = 2;
  while (
    [...paths].some((path) => path === folder || path.startsWith(folder + "/"))
  )
    folder = `_thread-export-${suffix++}`;
  const assetTargets = new Map(),
    loadedAssets = new Map();
  const ownedAsset = (item) =>
    item.kind === "asset" || typeof item.source !== "string";
  const assetAddress = (item) =>
    item.url ||
    `/api/okf/bundles/${encodeURIComponent(bundle.id)}/files?path=${encodeURIComponent(item.path)}`;
  const loadOnce = (url) => {
    if (!loadedAssets.has(url))
      loadedAssets.set(
        url,
        Promise.resolve().then(() => load(url)),
      );
    return loadedAssets.get(url);
  };
  const allocateAsset = (url) => {
    if (assetTargets.has(url)) return assetTargets.get(url);
    const owned = entries.find(
      (item) => ownedAsset(item) && assetAddress(item) === url,
    );
    let target = owned?.path;
    if (!target) {
      const base = `${folder}/assets/${diagramAssetName(url)}`;
      target = base;
      let number = 2;
      const dot = base.lastIndexOf("."),
        slash = base.lastIndexOf("/");
      while (paths.has(target.normalize("NFC").toLowerCase()))
        target =
          dot > slash
            ? `${base.slice(0, dot)}-${number++}${base.slice(dot)}`
            : `${base}-${number++}`;
      paths.add(target.normalize("NFC").toLowerCase());
    }
    assetTargets.set(url, target);
    return target;
  };
  const resource = async (entry, url) => {
    let target, address;
    if (localDiagramAsset(url)) {
      target = allocateAsset(url);
      address = url;
    } else {
      const resolved = resolveBundleReference(entry.path, url);
      const owned = entries.find(
        (item) => ownedAsset(item) && item.path === resolved.path,
      );
      if (!owned) throw new Error(`Missing diagram attachment: ${url}`);
      target = owned.path;
      address = assetAddress(owned);
    }
    if (!files[target]) files[target] = await loadOnce(address);
    return { target, bytes: files[target] };
  };
  const notes = new Map();
  for (const entry of entries) {
    if (entry.noteId) notes.set(entry.noteId, entry);
    if (entry.sourceNoteId) notes.set(entry.sourceNoteId, entry);
  }
  const blockSource = (entry, id) => {
    const body = entry.body || "";
    const marker = `<!-- thread:block id=${id} -->`;
    const start = body.indexOf(marker);
    if (start < 0) return null;
    return body
      .slice(start + marker.length)
      .split(/<!-- thread:block(?: id=[A-Za-z0-9_-]+)? -->/)[0]
      .trim();
  };
  for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
    const entry = entries[entryIndex];
    if (typeof entry.source !== "string") {
      const url =
        entry.url ||
        `/api/okf/bundles/${encodeURIComponent(bundle.id)}/files?path=${encodeURIComponent(entry.path)}`;
      if (!files[entry.path]) files[entry.path] = await loadOnce(url);
      continue;
    }
    const body = entry.body ?? entry.source;
    if (!entry.source.endsWith(body))
      throw new Error(
        `Source and body disagree for ${entry.path}. Reload before exporting.`,
      );
    const prefix = entry.source.slice(0, entry.source.length - body.length);
    const edits = [],
      assets = new Map(),
      diagrams = [],
      mindmaps = [];
    function replaceUrl(node, next) {
      const start = node.position.start.offset,
        end = node.position.end.offset;
      const original = body.slice(start, end);
      const after =
        node.type === "definition"
          ? original.indexOf("]:") + 2
          : original.lastIndexOf("](") + 2;
      const at = original.indexOf(node.url, Math.max(0, after));
      if (at < 0) {
        warnings.push(
          `${entry.path}: reference could not be converted: ${node.url}`,
        );
        return;
      }
      edits.push({
        start: start + at,
        end: start + at + node.url.length,
        value: next,
      });
    }
    function visit(node) {
      if (["link", "image", "definition"].includes(node.type)) {
        if (/^\/api\/assets\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(node.url)) {
          const path = allocateAsset(node.url);
          assets.set(node.url, path);
          replaceUrl(node, href(path));
        } else if (/^(note|block):/.test(node.url)) {
          const [kind, raw] = node.url.split(":", 2);
          let id, block;
          try {
            [id, block] = raw.split("/").map(decodeURIComponent);
          } catch {
            id = raw;
          }
          const target = notes.get(id);
          if (
            target &&
            (kind === "note" || (block && blockSource(target, block) !== null))
          )
            replaceUrl(
              node,
              href(target.path) +
                (kind === "block" ? `#block-${encodeURIComponent(block)}` : ""),
            );
          else
            warnings.push(
              `${entry.path}: excluded or missing reference ${node.url}`,
            );
        }
      }
      if (node.type === "html") {
        const marker = node.value
          .trim()
          .match(/^<!-- thread:block id=([A-Za-z0-9_-]+) -->$/);
        if (marker)
          edits.push({
            start: node.position.start.offset,
            end: node.position.end.offset,
            value: `<a id="block-${marker[1]}"></a>`,
          });
      }
      if (node.type === "text") {
        const text = body.slice(
          node.position.start.offset,
          node.position.end.offset,
        );
        for (const match of text.matchAll(
          /!\[\[([A-Za-z0-9_-]+)#([A-Za-z0-9_-]+)\]\]/g,
        )) {
          const target = notes.get(match[1]),
            excerpt = target && blockSource(target, match[2]);
          if (excerpt == null)
            warnings.push(
              `${entry.path}: excluded or missing embed ${match[0]}`,
            );
          else {
            // Nested embeds and Thread links are retained visibly with a diagnostic.
            if (/!\[\[|\]\((?:note|block):/.test(excerpt))
              warnings.push(
                `${entry.path}: embedded excerpt contains Thread references; review its source.`,
              );
            edits.push({
              start: node.position.start.offset + match.index,
              end: node.position.start.offset + match.index + match[0].length,
              value:
                excerpt
                  .split("\n")
                  .map((line) => "> " + line)
                  .join("\n") +
                `\n\n[Source](${href(target.path)}#block-${match[2]})`,
            });
          }
        }
      }
      if (node.type === "code" && node.lang === "thread-diagram")
        diagrams.push(node);
      if (node.type === "code" && node.lang === "thread-mindmap")
        mindmaps.push(node);
      for (const child of node.children || []) visit(child);
    }
    visit(parser.parse(body));
    for (const [url, path] of assets)
      if (!files[path]) files[path] = await loadOnce(url);
    for (const [nodes, language, label, stem] of [
      [diagrams, "thread-diagram", "Diagram", "diagram"],
      [mindmaps, "thread-mindmap", "Mind map", "mindmap"],
    ]) {
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i],
          path = `${folder}/${entryIndex}/${stem}-${i + 1}`;
        try {
          const data =
            language === "thread-diagram"
              ? parseDiagram(node.value)
              : parseMindMap(node.value);
          const project = (fromFile) =>
            projectDiagramResources(data, {
              relativeUrl: (url) =>
                relocateDiagramUrl(url, entry.path, fromFile),
              assetUrl: async (url) =>
                relativeDiagramPath(
                  fromFile,
                  (await resource(entry, url)).target,
                ),
              linkUrl: (link) => {
                const target =
                  link.kind === "bundle"
                    ? link.bundleId === bundle.id &&
                      entries.find(
                        (e) =>
                          e.path === "index.md" && typeof e.source === "string",
                      )
                    : notes.get(link.noteId);
                if (
                  target &&
                  (link.kind !== "block" ||
                    blockSource(target, link.blockId) !== null)
                )
                  return (
                    relativeDiagramPath(fromFile, target.path) +
                    (link.kind === "block"
                      ? `#block-${encodeURIComponent(link.blockId)}`
                      : "")
                  );
                const warning = `${entry.path}: excluded or missing ${stem} reference ${link.noteId || link.bundleId}`;
                if (!warnings.includes(warning)) warnings.push(warning);
              },
            });
          const sidecar = await project(path + ".json");
          files[path + ".json"] = strToU8(JSON.stringify(sidecar, null, 2));
          const native = nativeVisualFile(sidecar);
          files[path + native.extension] = strToU8(native.content);
          let preview = "";
          if (data.preview) {
            files[path + ".png"] = await render(data);
            preview = `![${label} ${i + 1}](${href(path)}.png)\n\n`;
          } else
            warnings.push(
              `${entry.path}: ${stem} ${i + 1}: no saved PNG preview; native editable source included.`,
            );
          edits.push(
            projectedDiagramFence(
              body,
              node,
              JSON.stringify(await project(entry.path)),
              preview +
                `[Editable ${label.toLowerCase()}](${href(path)}${native.extension})`,
              language,
            ),
          );
        } catch (error) {
          warnings.push(
            `${entry.path}: ${stem} ${i + 1} retained as source; ${error.message}`,
          );
        }
      }
    }
    let result = body;
    for (const edit of edits.sort((a, b) => b.start - a.start))
      result =
        result.slice(0, edit.start) + edit.value + result.slice(edit.end);
    files[entry.path] = strToU8(prefix + result);
  }
  return {
    files,
    warnings,
    blob: new Blob([zipSync(files, { level: 6 })], { type: "application/zip" }),
  };
}
