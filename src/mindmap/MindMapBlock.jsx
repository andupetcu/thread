import React, { useState } from "react";
import { createPortal } from "react-dom";
import { parseMindMap } from "./model.js";
import MindMapEditor from "./MindMapEditor.jsx";
import "./mindmap.css";
export function followMindMapLink(link, context) {
  if (link.kind === "bundle") context?.onOpenBundle?.(link.bundleId);
  else if (["note", "block", "concept"].includes(link.kind))
    context?.onOpenNote?.(link.noteId, link.blockId);
  else
    window.open(
      context?.resolveAssetUrl?.(link.url) || link.url,
      "_blank",
      "noopener,noreferrer",
    );
}
export default function MindMapBlock({
  value,
  onChange,
  readOnly = false,
  context,
  recoveryKey,
}) {
  const [open, setOpen] = useState(false);
  let data, error;
  try {
    data = parseMindMap(value);
  } catch (e) {
    error = e.message;
  }
  return (
    <div className="mindmap-block" contentEditable={false}>
      {error ? (
        <p role="alert">{error}</p>
      ) : data.preview ? (
        <img
          className="mindmap-preview"
          src={data.preview}
          alt="Saved mind map preview"
        />
      ) : (
        <p className="mindmap-empty">
          Drawnix mind map · Open the editor to view and save a preview.
        </p>
      )}
      {!!data?.references.length && (
        <div className="mindmap-preview-links">
          {data.references.map((ref) => (
            <button
              key={ref.id}
              onClick={() => followMindMapLink(ref.link, context)}
            >
              {ref.label} ↗
            </button>
          ))}
        </div>
      )}
      <div className="mindmap-block-footer" data-export-ignore>
        <span>Mind map · Drawnix</span>
        {!readOnly && !error && (
          <button onClick={() => setOpen(true)}>Edit mind map</button>
        )}
      </div>
      {open &&
        createPortal(
          <MindMapEditor
            initial={data}
            context={context}
            recoveryKey={recoveryKey}
            onClose={() => setOpen(false)}
            onSave={async (next) => {
              await onChange(next);
              setOpen(false);
            }}
          />,
          document.body,
        )}
    </div>
  );
}
export { MindMapBlock };
