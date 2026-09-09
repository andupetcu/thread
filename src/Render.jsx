import React, { createContext, useContext, useMemo, lazy } from "react";
import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import hljs from "highlight.js/lib/common";
import { parseBlocks } from "./editor-model";
import { BlockReferenceLink, EmbeddedParagraph } from "./rich/BlockReferences";
const DiagramBlock = lazy(() => import("./diagram/DiagramBlock"));
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
    const { note, notes, open, offset, edit, blocks } =
        useContext(RenderContext),
      code = node.children?.[0];
    if (code?.properties?.className?.includes("language-thread-diagram")) {
      const value = code.children?.map((c) => c.value || "").join("") || "";
      return (
        <div {...propsFor(blocks, node)}>
          <DiagramBlock
            value={value}
            readOnly={!edit}
            onChange={(json) => {
              const full = notes.find((n) => n.id === note.id) || note,
                start = offset + node.position.start.offset,
                end = offset + node.position.end.offset;
              edit(note.id, {
                body:
                  full.body.slice(0, start) +
                  "```thread-diagram\n" +
                  json +
                  "\n```" +
                  full.body.slice(end),
              });
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
const plugins = [remarkGfm];
function transform(url) {
  return url.startsWith("block:")
    ? "#" + url
    : url.startsWith("note:")
      ? "#note-" + url.slice(5)
      : defaultUrlTransform(url);
}
export default function Render({ note, notes, open, offset = 0 }) {
  const edit = useContext(EditContext),
    blocks = useMemo(
      () => new Map(parseBlocks(note.body).map((b) => [b.start, b])),
      [note.body],
    );
  return (
    <RenderContext.Provider value={{ note, notes, open, offset, edit, blocks }}>
      <Markdown
        remarkPlugins={plugins}
        urlTransform={transform}
        components={components}
      >
        {note.body}
      </Markdown>
    </RenderContext.Provider>
  );
}
