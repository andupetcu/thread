import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { strToU8, zipSync } from "fflate";
import { diagramToPng, parseDiagram } from "../diagram/model.js";

const parser = unified().use(remarkParse).use(remarkGfm);
const href = (path) => "/" + path.split("/").map(encodeURIComponent).join("/");
async function fetchAsset(url) {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Cannot export attachment (${response.status}).`);
  return new Uint8Array(await response.arrayBuffer());
}
async function renderDiagram(data) {
  return new Uint8Array(
    await (await fetch(await diagramToPng(data))).arrayBuffer(),
  );
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
      files[entry.path] = await load(url);
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
      diagrams = [];
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
          const path = `${folder}/assets/${node.url.split("/").at(-1)}`;
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
      for (const child of node.children || []) visit(child);
    }
    visit(parser.parse(body));
    for (const [url, path] of assets)
      if (!files[path]) files[path] = await load(url);
    for (let i = 0; i < diagrams.length; i++) {
      const node = diagrams[i],
        path = `${folder}/${entryIndex}/diagram-${i + 1}`;
      try {
        const data = parseDiagram(node.value);
        files[path + ".json"] = strToU8(JSON.stringify(data, null, 2));
        files[path + ".png"] = await render(data);
        edits.push({
          start: node.position.end.offset,
          end: node.position.end.offset,
          value: `\n\n![Diagram ${i + 1}](${href(path)}.png)\n\n[Editable diagram (Thread JSON)](${href(path)}.json)`,
        });
      } catch (error) {
        warnings.push(
          `${entry.path}: diagram ${i + 1} retained as source; ${error.message}`,
        );
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
