import DiagramEditor from "./DiagramEditor.jsx";
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./diagram.css";
import {
  parseDiagram,
  diagramToSvg,
  diagramToPortableSvg,
  diagramBounds,
  absolutePosition,
  nodeSize,
} from "./model.js";
export {
  defaultDiagram,
  parseDiagram,
  diagramToSvg,
  diagramToPng,
} from "./model.js";
export function DiagramBlock({
  value,
  onChange,
  readOnly = false,
  context,
  recoveryKey,
}) {
  const [open, setOpen] = useState(false);
  const [portable, setPortable] = useState(null),
    [assetError, setAssetError] = useState("");
  useEffect(() => {
    let active = true;
    setPortable(null);
    setAssetError("");
    try {
      const d = parseDiagram(value);
      if (d.nodes.some((n) => n.data.image))
        diagramToPortableSvg(d, { resolveAsset: context?.resolveAsset })
          .then((svg) => {
            if (active) setPortable(svg);
          })
          .catch((e) => {
            if (active) setAssetError(e.message);
          });
    } catch {}
    return () => {
      active = false;
    };
  }, [value, context?.resolveAsset]);
  let data, svg, error;
  try {
    data = parseDiagram(value);
    svg = diagramToSvg(data);
  } catch (e) {
    error = e.message;
  }
  const follow = (link) => {
    if (["note", "block", "concept"].includes(link.kind))
      context?.onOpenNote?.(link.noteId, link.blockId);
    else
      window.open(
        context?.resolveAssetUrl?.(link.url) || link.url,
        "_blank",
        "noopener,noreferrer",
      );
  };
  const bounds = data ? diagramBounds(data) : null;
  return (
    <div className="diagram-block" contentEditable={false}>
      {error ? (
        <p role="alert">{error}</p>
      ) : (
        <div className="diagram-preview-container">
          <img
            className="diagram-preview"
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(portable || svg)}`}
            alt={
              data.nodes.length
                ? `Diagram: ${data.nodes.map((n) => n.data.label).join(", ")}`
                : "Empty diagram"
            }
          />
          {data.nodes.some((n) => n.data.link) && (
            <svg
              className="diagram-preview-hotspots"
              viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`}
              aria-label="Diagram links"
            >
              {data.nodes
                .filter((n) => n.data.link)
                .map((n) => {
                  const p = absolutePosition(n, data.nodes),
                    size = nodeSize(n);
                  return (
                    <g
                      key={n.id}
                      role="link"
                      tabIndex={0}
                      aria-label={`Open diagram link: ${n.data.label}`}
                      onClick={() => follow(n.data.link)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") follow(n.data.link);
                      }}
                    >
                      <rect
                        x={p.x}
                        y={p.y}
                        width={size.width}
                        height={size.height}
                        fill="transparent"
                      />
                    </g>
                  );
                })}
            </svg>
          )}
        </div>
      )}
      {assetError && <p role="alert">{assetError}</p>}
      {!!data?.nodes.some((n) => n.data.link) && (
        <div className="diagram-preview-links">
          {data.nodes
            .filter((n) => n.data.link)
            .map((n) => (
              <button key={n.id} onClick={() => follow(n.data.link)}>
                {n.data.label || n.data.link.name || "Open linked target"} ↗
              </button>
            ))}
        </div>
      )}
      <div className="diagram-block-footer">
        <span>Diagram{data ? ` · ${data.nodes.length} shapes` : ""}</span>
        {!readOnly && !error && (
          <button onClick={() => setOpen(true)}>Edit diagram</button>
        )}
      </div>
      {open &&
        createPortal(
          <ReactFlowProvider>
            <DiagramEditor
              initial={data}
              context={context}
              recoveryKey={recoveryKey}
              onSave={async (next) => {
                await onChange(next);
                setOpen(false);
              }}
              onClose={() => setOpen(false)}
            />
          </ReactFlowProvider>,
          document.body,
        )}
    </div>
  );
}
export default DiagramBlock;
