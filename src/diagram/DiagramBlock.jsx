import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  Handle,
  Position,
  MarkerType,
  applyNodeChanges,
  applyEdgeChanges,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./diagram.css";
import {
  COLORS,
  SHAPES,
  parseDiagram,
  diagramToSvg,
  templateDiagram,
} from "./model.js";
export {
  defaultDiagram,
  parseDiagram,
  diagramToSvg,
  diagramToPng,
} from "./model.js";
function Shape({ data, selected }) {
  return (
    <div
      className={`diagram-shape diagram-shape-${data.shape}${selected ? " is-selected" : ""}`}
      style={{ "--shape-color": data.color }}
    >
      <Handle id="in" type="target" position={Position.Top} />
      <div className="diagram-shape-body" />
      <span>{data.label}</span>
      <Handle id="out" type="source" position={Position.Bottom} />
    </div>
  );
}
const nodeTypes = { diagramShape: Shape };
const serial = (d) => JSON.stringify(parseDiagram(d));
function DiagramEditor({ initial, onSave, onClose }) {
  const [draft, setDraft] = useState(initial),
    [past, setPast] = useState([]),
    [future, setFuture] = useState([]),
    [discard, setDiscard] = useState(false),
    [conflict, setConflict] = useState(false),
    [error, setError] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  const dialog = useRef(null),
    dragStart = useRef(null),
    flow = useReactFlow();
  const baseline = useRef(serial(initial));
  const selected = draft.nodes.find((n) => n.selected),
    selectedEdge = draft.edges.find((e) => e.selected);
  const dirty = serial(draft) !== baseline.current;
  useEffect(() => {
    dialog.current.showModal();
    // React Flow initially measures a native dialog while it is still hidden.
    // Fit once it has a rendered canvas, rather than keeping that zero-size fit.
    const timer = setTimeout(() => flow.fitView({ padding: 0.2 }), 60);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    const warn = (e) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const change = (next) => {
    try {
      parseDiagram(next);
      setPast((p) => [...p.slice(-79), serial(draft)]);
      setFuture([]);
      setDraft(next);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  };
  const undo = () => {
    if (!past.length) return;
    setFuture((f) => [serial(draft), ...f]);
    setDraft(parseDiagram(past.at(-1)));
    setPast((p) => p.slice(0, -1));
  };
  const redo = () => {
    if (!future.length) return;
    setPast((p) => [...p, serial(draft)]);
    setDraft(parseDiagram(future[0]));
    setFuture((f) => f.slice(1));
  };
  const close = () =>
    conflict ? setConflict(false) : dirty ? setDiscard(true) : onClose();
  const save = (replace = false) => {
    if (!replace && serial(initial) !== baseline.current) {
      setConflict(true);
      return;
    }
    try {
      onSave(serial(draft));
    } catch (e) {
      setError(e.message);
    }
  };
  const downloadDraft = () => {
    const url = URL.createObjectURL(
      new Blob([serial(draft)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "diagram-draft.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const addShape = (shape, position) => {
    const p =
      position ||
      flow.screenToFlowPosition({
        x: window.innerWidth / 2 + (draft.nodes.length % 3) * 35,
        y: window.innerHeight / 2 + (draft.nodes.length % 3) * 35,
      });
    const id = crypto.randomUUID();
    change({
      ...draft,
      nodes: [
        ...draft.nodes.map((n) => ({ ...n, selected: false })),
        {
          id,
          type: "diagramShape",
          position: p,
          selected: true,
          data: {
            shape,
            label:
              shape === "text"
                ? "Add text"
                : shape[0].toUpperCase() + shape.slice(1),
            color: COLORS[0],
          },
        },
      ],
    });
  };
  const connect = (c) => {
    if (!c.source || !c.target) return;
    change({
      ...draft,
      edges: [
        ...draft.edges,
        {
          id: crypto.randomUUID(),
          source: c.source,
          target: c.target,
          sourceHandle: "out",
          targetHandle: "in",
          label: "",
        },
      ],
    });
  };
  const remove = () => {
    const ids = new Set(draft.nodes.filter((n) => n.selected).map((n) => n.id));
    change({
      ...draft,
      nodes: draft.nodes.filter((n) => !n.selected),
      edges: draft.edges.filter(
        (e) => !e.selected && !ids.has(e.source) && !ids.has(e.target),
      ),
    });
  };
  const updateNode = (data) =>
    change({
      ...draft,
      nodes: draft.nodes.map((n) =>
        n.id === selected.id ? { ...n, data: { ...n.data, ...data } } : n,
      ),
    });
  const onKeys = (e) => {
    if (e.key === "Escape") return;
    if (e.target.closest("input,textarea,select")) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
    }
    if (
      (e.key === "Delete" || e.key === "Backspace") &&
      (selected || selectedEdge)
    ) {
      e.preventDefault();
      remove();
    }
  };
  return (
    <dialog
      ref={dialog}
      className="diagram-dialog"
      aria-label="Edit diagram"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onKeyDown={onKeys}
    >
      <header className="diagram-header" inert={discard || conflict}>
        <div>
          <strong>Diagram</strong>
          <span>
            {draft.nodes.length} shapes · {draft.edges.length} connectors
            {dirty ? " · Unsaved changes" : ""}
          </span>
        </div>
        <div className="diagram-actions">
          <button onClick={undo} disabled={!past.length}>
            Undo
          </button>
          <button onClick={redo} disabled={!future.length}>
            Redo
          </button>
          <button onClick={close} aria-label="Close diagram">
            Close
          </button>
          <button className="diagram-save" onClick={() => save()}>
            Save diagram
          </button>
        </div>
      </header>
      <div className="diagram-workspace" inert={discard || conflict}>
        <aside className="diagram-palette">
          <h3>Shapes</h3>
          <p>Drag onto the canvas, or click to add.</p>
          {SHAPES.map((shape) => (
            <button
              key={shape}
              aria-label={`Add ${shape}`}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("application/thread-shape", shape);
                e.dataTransfer.effectAllowed = "copy";
              }}
              onClick={() => addShape(shape)}
            >
              <span aria-hidden="true">
                {
                  { process: "▭", decision: "◇", database: "▤", text: "T" }[
                    shape
                  ]
                }
              </span>
              {shape[0].toUpperCase() + shape.slice(1)}
            </button>
          ))}
          <h3>Start with a template</h3>
          <select
            aria-label="Diagram template"
            value=""
            onChange={(e) => {
              if (e.target.value) {
                change(templateDiagram(e.target.value));
                setTimeout(() => flow.fitView({ padding: 0.25 }), 50);
              }
            }}
          >
            <option value="">Choose a template…</option>
            <option value="flow">Simple flow</option>
            <option value="decision">Decision</option>
            <option value="data">Data pipeline</option>
            <option value="blank">Blank canvas</option>
          </select>
          <p>Templates replace the canvas. Undo restores your work.</p>
          <h3>Connect shapes</h3>
          <label>
            Connect from
            <select
              aria-label="Connect from"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            >
              <option value="">Choose shape…</option>
              {draft.nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.data.label || "Untitled shape"}
                </option>
              ))}
            </select>
          </label>
          <label>
            Connect to
            <select
              aria-label="Connect to"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            >
              <option value="">Choose shape…</option>
              {draft.nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.data.label || "Untitled shape"}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={
              !draft.nodes.some((n) => n.id === from) ||
              !draft.nodes.some((n) => n.id === to)
            }
            onClick={() => connect({ source: from, target: to })}
          >
            Add connector
          </button>
          <p>Or drag from a bottom dot to a top dot.</p>
        </aside>
        <div
          className="diagram-canvas"
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }}
          onDrop={(e) => {
            e.preventDefault();
            const shape = e.dataTransfer.getData("application/thread-shape");
            if (SHAPES.includes(shape))
              addShape(
                shape,
                flow.screenToFlowPosition({
                  x: e.clientX - 90,
                  y: e.clientY - 45,
                }),
              );
          }}
        >
          <ReactFlow
            nodes={draft.nodes}
            edges={draft.edges.map((e) => ({
              ...e,
              type: "default",
              markerEnd: { type: MarkerType.ArrowClosed },
              style: { stroke: "#758093" },
              labelStyle: { fill: "#334155" },
              labelBgStyle: { fill: "#fff" },
            }))}
            nodeTypes={nodeTypes}
            onNodesChange={(changes) => {
              const next = {
                ...draft,
                nodes: applyNodeChanges(changes, draft.nodes),
              };
              if (
                changes.some((c) => c.type === "position" && !c.dragging) &&
                !dragStart.current
              )
                change(next);
              else setDraft(next);
            }}
            onEdgesChange={(changes) =>
              setDraft({
                ...draft,
                edges: applyEdgeChanges(changes, draft.edges),
              })
            }
            onNodeDragStart={() => {
              dragStart.current = serial(draft);
            }}
            onNodeDragStop={() => {
              if (dragStart.current && dragStart.current !== serial(draft)) {
                const snapshot = dragStart.current;
                setPast((p) => [...p.slice(-79), snapshot]);
                setFuture([]);
              }
              dragStart.current = null;
            }}
            onConnect={connect}
            deleteKeyCode={null}
            fitView
            minZoom={0.15}
            maxZoom={3}
            defaultEdgeOptions={{ type: "default" }}
          >
            <Background color="#c5cbd5" gap={22} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
        <aside className="diagram-inspector">
          <h3>
            {selected ? "Shape" : selectedEdge ? "Connector" : "Inspector"}
          </h3>
          {selected ? (
            <>
              <label>
                Shape label
                <textarea
                  aria-label="Shape label"
                  value={selected.data.label}
                  maxLength={500}
                  onChange={(e) => updateNode({ label: e.target.value })}
                />
              </label>
              <label>
                Shape type
                <select
                  value={selected.data.shape}
                  onChange={(e) => updateNode({ shape: e.target.value })}
                >
                  {SHAPES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label>
                Shape color
                <input
                  aria-label="Shape color"
                  type="color"
                  value={selected.data.color}
                  onChange={(e) => updateNode({ color: e.target.value })}
                />
              </label>
              <div className="diagram-swatches">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    aria-label={`Use color ${c}`}
                    style={{ background: c }}
                    onClick={() => updateNode({ color: c })}
                  />
                ))}
              </div>
            </>
          ) : selectedEdge ? (
            <label>
              Connector label
              <input
                aria-label="Connector label"
                value={selectedEdge.label || ""}
                maxLength={200}
                onChange={(e) =>
                  change({
                    ...draft,
                    edges: draft.edges.map((edge) =>
                      edge.id === selectedEdge.id
                        ? { ...edge, label: e.target.value }
                        : edge,
                    ),
                  })
                }
              />
            </label>
          ) : (
            <p>
              Select a shape or connector to edit it. Arrow keys move a focused
              shape.
            </p>
          )}
          <button disabled={!selected && !selectedEdge} onClick={remove}>
            Delete selected
          </button>
          {error && <p role="alert">{error}</p>}
        </aside>
      </div>
      {conflict && (
        <div className="diagram-discard-backdrop">
          <div
            className="diagram-discard"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="diagram-conflict-title"
          >
            <h3 id="diagram-conflict-title">
              Diagram changed in another session
            </h3>
            <p>
              Your draft is still here. Download it to keep a separate copy, or
              explicitly replace the current diagram with your draft.
            </p>
            <button autoFocus onClick={() => setConflict(false)}>
              Keep editing
            </button>
            <button onClick={downloadDraft}>Download my draft</button>
            <button onClick={() => save(true)}>Replace with my diagram</button>
          </div>
        </div>
      )}
      {discard && (
        <div className="diagram-discard-backdrop">
          <div
            className="diagram-discard"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="diagram-discard-title"
          >
            <h3 id="diagram-discard-title">Discard diagram changes?</h3>
            <p>Your last saved diagram will be kept.</p>
            <button autoFocus onClick={() => setDiscard(false)}>
              Keep editing
            </button>
            <button onClick={onClose}>Discard changes</button>
          </div>
        </div>
      )}
    </dialog>
  );
}
export function DiagramBlock({ value, onChange, readOnly = false }) {
  const [open, setOpen] = useState(false);
  let data, svg, error;
  try {
    data = parseDiagram(value);
    svg = diagramToSvg(data);
  } catch (e) {
    error = e.message;
  }
  return (
    <div className="diagram-block" contentEditable={false}>
      {error ? (
        <p role="alert">{error}</p>
      ) : (
        <img
          className="diagram-preview"
          src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
          alt={
            data.nodes.length
              ? `Diagram: ${data.nodes.map((n) => n.data.label).join(", ")}`
              : "Empty diagram"
          }
        />
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
              onSave={(next) => {
                onChange(next);
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
