import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ReactFlowProvider } from "@xyflow/react";
import { parseMindMap, mindMapToSvg } from "./model.js";
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
  let data, svg, error;
  try {
    data = parseMindMap(value);
    svg = mindMapToSvg(data);
  } catch (e) {
    error = e.message;
  }
  return (
    <div className="mindmap-block" contentEditable={false}>
      {error ? (
        <p role="alert">{error}</p>
      ) : (
        <img
          className="mindmap-preview"
          src={`data:image/svg+xml,${encodeURIComponent(svg)}`}
          alt={`Mind map: ${data.nodes.map((n) => n.label).join(", ")}`}
        />
      )}
      {!!data?.nodes.some((n) => n.link) && (
        <div className="mindmap-preview-links">
          {data.nodes
            .filter((n) => n.link)
            .map((n) => (
              <button
                key={n.id}
                onClick={() => followMindMapLink(n.link, context)}
              >
                {n.label || "Open linked idea"} ↗
              </button>
            ))}
        </div>
      )}
      <div className="mindmap-block-footer" data-export-ignore>
        <span>Mind map{data ? ` · ${data.nodes.length} ideas` : ""}</span>
        {!readOnly && !error && (
          <button onClick={() => setOpen(true)}>Edit mind map</button>
        )}
      </div>
      {open &&
        createPortal(
          <ReactFlowProvider>
            <MindMapEditor
              initial={data}
              context={context}
              recoveryKey={recoveryKey}
              onClose={() => setOpen(false)}
              onSave={async (next) => {
                await onChange(next);
                setOpen(false);
              }}
            />
          </ReactFlowProvider>,
          document.body,
        )}
    </div>
  );
}
export { MindMapBlock };
