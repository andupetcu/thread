import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
const parser = unified().use(remarkParse).use(remarkGfm);
export function richFallbackReason(source) {
  if (/^\s*(`{3,}|~{3,})thread-diagram\b/.test(source))
    return "Diagram data stays in Markdown; use the diagram editor in the preview.";
  if (/!\[\[[^\]]+\]\]/.test(source))
    return "Block embeds stay in Markdown and update in the preview.";
  if (/!?\[[^\]]*\]\[[^\]]*\]|\[\^[^\]]+\]/.test(source))
    return "Reference-style links and footnotes stay in Markdown to preserve their definitions.";
  let reason = "";
  function visit(node) {
    if (
      [
        "html",
        "definition",
        "footnoteDefinition",
        "footnoteReference",
        "linkReference",
        "imageReference",
      ].includes(node.type)
    )
      reason =
        "This block uses Markdown syntax that is preserved in source mode.";
    if (node.type === "code" && node.meta)
      reason = "Code fence metadata is preserved in source mode.";
    (node.children || []).forEach(visit);
  }
  visit(parser.parse(source));
  return reason;
}
export function assetMarkdown({ name, url, mime }) {
  const label = name.replace(/[\\[\]]/g, "\\$&").replace(/[\r\n]/g, " ");
  return `${mime.startsWith("image/") ? "!" : ""}[${label}](${url})`;
}
export function embedAddress(source) {
  const match = source.trim().match(/^!\[\[([^\s#\]]+)#([A-Za-z0-9_-]+)\]\]$/);
  return match ? { noteId: match[1], blockId: match[2] } : null;
}
export async function uploadAsset(file) {
  const response = await fetch("/api/assets", {
    method: "POST",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "X-Thread-Request": "1",
      "X-Filename": encodeURIComponent(file.name || "pasted-image.png"),
    },
    body: file,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Upload failed (${response.status})`);
  }
  return response.json();
}

export function markdownMeaning(source) {
  return JSON.stringify(parser.parse(source), (key, value) =>
    ["position", "spread"].includes(key) ? undefined : value,
  );
}
