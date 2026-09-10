import { replaceDiagramFence } from "./note-diagrams.js";
import { parseDiagram } from "./model.js";

export function relativeDiagramPath(fromFile, toFile) {
  const from = fromFile.split("/").slice(0, -1),
    to = toFile.split("/");
  while (from.length && to.length && from[0] === to[0]) {
    from.shift();
    to.shift();
  }
  return [...from.map(() => ".."), ...to].map(encodeURIComponent).join("/");
}

export function projectedDiagramFence(
  body,
  node,
  json,
  preview,
  language = "thread-diagram",
) {
  const start = node.position.start.offset,
    end = node.position.end.offset;
  const replaced = replaceDiagramFence(body, { start, end }, json, language);
  const replacement = replaced.slice(
    start,
    replaced.length - (body.length - end),
  );
  const prefix = body.slice(body.lastIndexOf("\n", start - 1) + 1, start);
  const continuation = prefix.replace(/(?:[-+*]|\d+[.)])\s/g, (marker) =>
    " ".repeat(marker.length),
  );
  return {
    start,
    end,
    value:
      replacement + ("\n\n" + preview).split("\n").join("\n" + continuation),
  };
}

export function relocateDiagramUrl(url, sourceFile, fromFile) {
  if (/^(?:[A-Za-z][A-Za-z0-9+.-]*:|\/)/.test(url)) return url;
  const match = /^([^?#]*)([?#][\s\S]*)?$/.exec(url);
  const pathname = match[1],
    suffix = match[2] || "";
  if (sourceFile === fromFile) return url;
  let target = sourceFile;
  if (pathname) {
    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      decoded = pathname;
    }
    const parts = sourceFile.split("/").slice(0, -1);
    for (const part of decoded.split("/")) {
      if (!part || part === ".") continue;
      if (part === ".." && parts.length && parts.at(-1) !== "..") parts.pop();
      else parts.push(part);
    }
    target = parts.join("/");
  }
  return relativeDiagramPath(fromFile, target) + suffix;
}

export function localDiagramAsset(url) {
  return (
    /^\/api\/assets\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(url) ||
    /^\/api\/okf\/bundles\/[A-Za-z0-9_-]+\/files\?path=/.test(url)
  );
}

export function diagramAssetName(url) {
  if (url.startsWith("/api/assets/")) return url.split("/").at(-1);
  const parsed = new URL(url, "http://thread.local");
  return `${parsed.pathname.split("/")[4] || "bundle"}-${(parsed.searchParams.get("path") || "asset").replace(/[^\p{L}\p{N}._-]/gu, "_")}`;
}

// Canonical documents are never mutated. The same resource is projected with
// different relative addresses for Markdown fences and JSON sidecars.
export async function projectDiagramResources(
  value,
  { assetUrl, linkUrl, relativeUrl },
) {
  const data = parseDiagram(value);
  for (const node of data.nodes) {
    if (node.data.image)
      node.data.image = {
        ...node.data.image,
        url: await assetUrl(node.data.image.url),
      };
    const link = node.data.link;
    if (link?.kind === "asset")
      node.data.link = { ...link, url: await assetUrl(link.url) };
    else if (link?.kind === "url" && relativeUrl)
      node.data.link = { ...link, url: relativeUrl(link.url) };
    else if (link && link.kind !== "url") {
      const url = linkUrl?.(link);
      if (url) node.data.link = { kind: "url", url };
    }
  }
  return data;
}
