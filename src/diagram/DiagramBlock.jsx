import React, { useState } from "react";
import { createPortal } from "react-dom";
import DiagramEditor from "./DiagramEditor.jsx";
import ReferencePanel from "../visual/ReferencePanel.jsx";
import { parseDiagram } from "./model.js";
import "./diagram.css";
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
  let data, error;
  try {
    data = parseDiagram(value);
  } catch (e) {
    error = e.message;
  }
  return (
    <div className="diagram-block" contentEditable={false}>
      {error ? (
        <p role="alert">{error}</p>
      ) : data.preview ? (
        <img
          className="diagram-preview"
          src={data.preview}
          alt="Diagram preview"
        />
      ) : (
        <div className="native-empty-preview">
          Diagram · Open the editor to draw and save a preview.
        </div>
      )}
      {!!data?.references.length && (
        <ReferencePanel references={data.references} context={context} />
      )}
      <div className="diagram-block-footer" data-export-ignore>
        <span>Diagram · draw.io</span>
        {!readOnly && data && (
          <button onClick={() => setOpen(true)}>Edit diagram</button>
        )}
      </div>
      {open &&
        createPortal(
          <DiagramEditor
            initial={data}
            context={context}
            recoveryKey={recoveryKey}
            onSave={async (next) => {
              await onChange(next);
              setOpen(false);
            }}
            onClose={() => setOpen(false)}
          />,
          document.body,
        )}
    </div>
  );
}
export default DiagramBlock;
