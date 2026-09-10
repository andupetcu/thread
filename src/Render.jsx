import React, { createContext, useContext, useMemo, lazy } from "react";
import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import hljs from "highlight.js/lib/common";
import { parseBlocks } from "./editor-model";
import { BlockReferenceLink, EmbeddedParagraph } from "./rich/BlockReferences";
import { DiagramWorkspaceContext } from "./diagram/context.js";
import { diagramFences, replaceDiagramFence } from "./diagram/note-diagrams.js";
import { diagramRecoveryId } from "./diagram/recovery.js";
const DiagramBlock = lazy(() => import("./diagram/DiagramBlock"));
const MindMapBlock = lazy(() => import("./mindmap/MindMapBlock.jsx"));
export const EditContext = createContext(null);
const RenderContext = createContext(null);
function propsFor(blocks, node) {
  return {
    "data-block-id": blocks.get(node.position?.start.offset)?.id,
    tabIndex: -1,
  };
}
function container(tag) {
  return function MarkdownContainer({ node, children, className, start }) {
    const { blocks } = useContext(RenderContext);
    return React.createElement(
      tag,
      {
        ...propsFor(blocks, node),
        className,
        ...(tag === "ol" ? { start } : {}),
      },
      children,
    );
  };
}
const components = {
  ul: container("ul"),
  ol: container("ol"),
  blockquote: container("blockquote"),
  table: container("table"),
  p: function Paragraph({ node, children }) {
    const { note, notes, open, blocks } = useContext(RenderContext);
    return (
      <div {...propsFor(blocks, node)}>
        <EmbeddedParagraph
          source={note.body.slice(
            node.position?.start.offset,
            node.position?.end.offset,
          )}
          notes={notes}
          open={open}
          Render={Render}
        >
          {children}
        </EmbeddedParagraph>
      </div>
    );
  },
  pre: function CodeBlock({ node, children }) {
    const {
        note,
        notes,
        open,
        offset,
        edit,
        blocks,
        diagramWorkspace,
        resolveImage,
      } = useContext(RenderContext),
      code = node.children?.[0];
    const language = code?.properties?.className?.includes(
      "language-thread-mindmap",
    )
      ? "thread-mindmap"
      : "thread-diagram";
    if (code?.properties?.className?.includes(`language-${language}`)) {
      const value = code.children?.map((c) => c.value || "").join("") || "";
      const full = notes.find((n) => n.id === note.id) || note;
      const fences = diagramFences(full.body, language);
      const fence = fences.find(
        (item) => item.start === offset + node.position.start.offset,
      );
      const resolveAssetUrl = (url) => resolveImage?.(url) || url;
      const isBundleDocument = !!(full.okf || full.bundleId);
      const context = {
        noteId: note.id,
        diagramIndex: fence?.diagramIndex,
        blockId: fence?.blockId,
        revision: full.revision,
        retainRecoveryOnSave: isBundleDocument,
        notes: diagramWorkspace?.notes || notes,
        bundles: diagramWorkspace?.bundles || [],
        onOpenBundle: diagramWorkspace?.onOpenBundle,
        onOpenNote:
          diagramWorkspace?.onOpenNote ||
          ((id, blockId) => open(id, undefined, blockId)),
        onProposalApplied: diagramWorkspace?.onProposalApplied,
        beforeProposalApply: diagramWorkspace?.beforeProposalApply,
        resolveAssetUrl,
        resolveAsset: async (url) => {
          const target = resolveAssetUrl(url);
          if (!/^\/api\/(?:assets\/|okf\/bundles\/)/.test(target))
            throw new Error(`Cannot locate diagram image: ${url}`);
          const response = await fetch(target);
          if (!response.ok)
            throw new Error(`Cannot load diagram image (${response.status}).`);
          const blob = await response.blob();
          return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () =>
              reject(new Error("Cannot read diagram image."));
            reader.readAsDataURL(blob);
          });
        },
      };
      const VisualBlock =
        language === "thread-mindmap" ? MindMapBlock : DiagramBlock;
      return (
        <div {...propsFor(blocks, node)}>
          <VisualBlock
            value={value}
            context={context}
            recoveryKey={
              fence ? diagramRecoveryId(note.id, fence, fences) : undefined
            }
            readOnly={!edit}
            onChange={async (json) => {
              edit(note.id, {
                body: replaceDiagramFence(full.body, fence, json, language),
              });
              if (!isBundleDocument) await diagramWorkspace?.flush?.();
            }}
          />
        </div>
      );
    }
    return <pre {...propsFor(blocks, node)}>{children}</pre>;
  },
  code: function HighlightedCode({ className, children }) {
    const language = className?.replace("language-", "");
    if (language && hljs.getLanguage(language))
      return (
        <code
          className={className}
          dangerouslySetInnerHTML={{
            __html: hljs.highlight(String(children), { language }).value,
          }}
        />
      );
    return <code className={className}>{children}</code>;
  },
  a: function Reference({ href, children }) {
    const { notes, open } = useContext(RenderContext);
    if (href?.startsWith("#block:"))
      return (
        <BlockReferenceLink
          href={href}
          notes={notes}
          open={open}
          Render={Render}
        >
          {children}
        </BlockReferenceLink>
      );
    if (href?.startsWith("#note-"))
      return (
        <button
          className="mention"
          onClick={() => open(href.slice(6))}
          title={notes.find((n) => n.id === href.slice(6))?.body.slice(0, 360)}
        >
          ↗ {notes.find((n) => n.id === href.slice(6))?.title || children}
        </button>
      );
    return (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    );
  },
  ...Object.fromEntries(
    [1, 2, 3, 4, 5, 6].map((level) => [
      "h" + level,
      function Heading({ node, children }) {
        const { blocks, offset } = useContext(RenderContext);
        return React.createElement(
          "h" + level,
          {
            ...propsFor(blocks, node),
            "data-heading-start": offset + (node.position?.start.offset || 0),
          },
          children,
        );
      },
    ]),
  ),
};
// Remove reserved metadata from the rendered tree, not from the source: block
// references and diagram edits still depend on the original source offsets.
function hideBlockMetadata() {
  return function visit(node) {
    if (!node.children) return;
    node.children = node.children.filter(
      (child) =>
        !(
          child.type === "html" &&
          /^<!-- thread:block(?: id=[A-Za-z0-9_-]+)? -->$/.test(
            child.value.trim(),
          )
        ),
    );
    node.children.forEach(visit);
  };
}
const plugins = [remarkGfm, hideBlockMetadata];
function transform(url) {
  return url.startsWith("block:")
    ? "#" + url
    : url.startsWith("note:")
      ? "#note-" + url.slice(5)
      : defaultUrlTransform(url);
}
export default function Render({
  note,
  notes,
  open,
  offset = 0,
  resolveImage,
}) {
  const edit = useContext(EditContext),
    diagramWorkspace = useContext(DiagramWorkspaceContext),
    blocks = useMemo(
      () => new Map(parseBlocks(note.body).map((b) => [b.start, b])),
      [note.body],
    );
  return (
    <RenderContext.Provider
      value={{
        note,
        notes,
        open,
        offset,
        edit,
        blocks,
        diagramWorkspace,
        resolveImage,
      }}
    >
      <Markdown
        remarkPlugins={plugins}
        urlTransform={(url, key) =>
          transform(key === "src" && resolveImage ? resolveImage(url) : url)
        }
        components={components}
      >
        {note.body}
      </Markdown>
    </RenderContext.Provider>
  );
}
