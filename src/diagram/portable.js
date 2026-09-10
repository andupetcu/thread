import { replaceDiagramFence } from "./note-diagrams.js";
import { parseMindMap } from "../mindmap/model.js";
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

// Rebase sidecar references and native editor resource fields without changing live data.
export async function projectDiagramResources(
  value,
  { assetUrl, linkUrl, relativeUrl },
) {
  const data =
    value.engine === "drawnix" ? parseMindMap(value) : parseDiagram(value);
  for (const ref of data.references) {
    const link = ref.link;
    if (link.kind === "asset")
      ref.link = { ...link, url: await assetUrl(link.url) };
    else if (link.kind === "url" && relativeUrl)
      ref.link = { ...link, url: relativeUrl(link.url) };
    else if (link.kind !== "url") {
      const url = linkUrl?.(link);
      if (url) ref.link = { kind: "url", url };
    }
  }
  const projectedReferences = new Map(
    data.references.map((ref) => [ref.id, ref.link]),
  );
  const projectUrl = async (url) => {
    if (url.startsWith("thread:")) {
      let referenceId = url.slice(7);
      try {
        referenceId = decodeURIComponent(referenceId);
      } catch {
        /* Preserve unresolved reference. */
      }
      const link = projectedReferences.get(referenceId);
      return link && ["url", "asset"].includes(link.kind) ? link.url : url;
    }
    return localDiagramAsset(url)
      ? assetUrl(url)
      : relativeUrl
        ? relativeUrl(url)
        : url;
  };
  if (data.engine === "drawnix") {
    async function walk(value) {
      if (!value || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value)) {
        if (
          typeof child === "string" &&
          /^(url|src|href|link)$/i.test(key) &&
          !child.startsWith("data:")
        )
          value[key] = await projectUrl(child);
        else await walk(child);
      }
    }
    await walk(data.elements);
  } else {
    const escape = (s) =>
      s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    const decode = (s) =>
      s
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");
    const matches = [
      ...data.xml.matchAll(
        /\b(link|href|src)=(?:"([^"]*)"|'([^']*)')|image=([^;"'<>]+);/g,
      ),
    ];
    for (const m of matches.reverse()) {
      const original = decode(m[2] ?? m[3] ?? m[4]);
      if (original.startsWith("data:")) continue;
      const next = escape(await projectUrl(original));
      const replacement = m[1] ? `${m[1]}="${next}"` : `image=${next};`;
      data.xml =
        data.xml.slice(0, m.index) +
        replacement +
        data.xml.slice(m.index + m[0].length);
    }
  }
  return data;
}
export function nativeVisualFile(data) {
  if (data.engine === "drawio")
    return { extension: ".drawio", content: data.xml };
  const { elements, viewport, theme } = data;
  return {
    extension: ".drawnix",
    content: JSON.stringify(
      {
        type: "drawnix",
        elements,
        ...(viewport ? { viewport } : {}),
        ...(theme ? { theme } : {}),
      },
      null,
      2,
    ),
  };
}
