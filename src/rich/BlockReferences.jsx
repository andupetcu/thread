import "./rich.css";
import React, { createContext, useContext, useState } from "react";
import { resolveBlockReference, parseBlocks } from "../editor-model";
import { embedAddress } from "./model";
const EmbedTrail = createContext([]);
export function BlockEmbed({ noteId, blockId, notes, open, Render }) {
  const trail = useContext(EmbedTrail);
  const key = `${noteId}/${blockId}`;
  const target = resolveBlockReference(notes, noteId, blockId);
  if (!target)
    return (
      <aside className="block-embed missing">
        Referenced block is unavailable.
      </aside>
    );
  if (trail.includes(key) || trail.length >= 8)
    return (
      <aside className="block-embed missing">
        Circular block embed · {target.note.title}
      </aside>
    );
  const definitions = parseBlocks(target.note.body)
    .filter(
      (block) =>
        block.type === "definition" || block.type === "footnoteDefinition",
    )
    .map((block) => block.source)
    .join("\n\n");
  return (
    <aside className="block-embed" data-embed-block={key}>
      <button
        className="block-embed-origin"
        onClick={() => open(noteId, undefined, blockId)}
      >
        ↗ {target.note.title}
      </button>
      <EmbedTrail.Provider value={[...trail, key]}>
        <Render
          note={{
            ...target.note,
            body:
              target.block.source + (definitions ? "\n\n" + definitions : ""),
          }}
          notes={notes}
          open={open}
          offset={target.block.start}
        />
      </EmbedTrail.Provider>
    </aside>
  );
}
export function BlockReferenceLink({ href, children, notes, open, Render }) {
  const [preview, setPreview] = useState(false);
  const address = href.replace(/^(?:#)?block:/, "").split("/");
  let noteId, blockId;
  try {
    [noteId, blockId] = address.map(decodeURIComponent);
  } catch {
    return <span>Invalid block reference</span>;
  }
  const target = resolveBlockReference(notes, noteId, blockId);
  return (
    <span
      className="block-reference"
      onMouseEnter={() => setPreview(true)}
      onMouseLeave={() => setPreview(false)}
    >
      <button
        className="mention"
        onFocus={() => setPreview(true)}
        onBlur={() => setPreview(false)}
        onClick={() => open(noteId, undefined, blockId)}
        title={target?.block.source || "Referenced block is unavailable"}
      >
        ↗ {children}
      </button>
      {preview && (
        <span className="block-reference-preview" role="tooltip">
          {target
            ? `${target.note.title} · ${target.block.source.slice(0, 360)}`
            : "Referenced block is unavailable"}
        </span>
      )}
    </span>
  );
}
// Use in a ReactMarkdown `p` override, passing the original Markdown slice.
export function EmbeddedParagraph({ source, children, notes, open, Render }) {
  const address = embedAddress(source);
  return address ? (
    <BlockEmbed {...address} notes={notes} open={open} Render={Render} />
  ) : (
    <p>{children}</p>
  );
}
