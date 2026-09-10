import { nodeTypes, edgeTypes } from "./EditorShapes.jsx";
import { EditorLibrary, LinkInspector, download } from "./EditorLibrary.jsx";
import {
  parentFirst,
  prepareEditorChange,
  retainMeasurements,
  recoveryNeedsReview,
  duplicateSelection,
  selectedSubgraph,
  insertDiagram,
  styleSelection,
  lockSelection,
  deleteSelection,
  groupSelection,
  ungroupSelection,
  alignSelection,
  autoLayout,
  draftKey,
  worldPosition,
} from "./editor-operations.js";
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  MiniMap,
  Controls,
  Handle,
  Position,
  MarkerType,
  applyNodeChanges,
  applyEdgeChanges,
  useReactFlow,
  useNodesInitialized,
  getViewportForBounds,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./diagram.css";
import {
  COLORS,
  SHAPES,
  parseDiagram,
  diagramToSvg,
  diagramBounds,
  templateDiagram,
} from "./model.js";
export {
  defaultDiagram,
  parseDiagram,
  diagramToSvg,
  diagramBounds,
  diagramToPng,
} from "./model.js";
let diagramClipboard = null;
const serial = (d) => JSON.stringify(parseDiagram(d));
export default function DiagramEditor({
  initial,
  onSave,
  onClose,
  context,
  recoveryKey,
}) {
  const storageKey = recoveryKey
    ? `thread-diagram-draft:${recoveryKey}`
    : draftKey(context);
  const [initialViewport] = useState(() => {
    try {
      const value =
        storageKey &&
        JSON.parse(localStorage.getItem(`${storageKey}:viewport`));
      return value &&
        Number.isFinite(value.x) &&
        Number.isFinite(value.y) &&
        Number.isFinite(value.zoom) &&
        value.zoom >= 0.15 &&
        value.zoom <= 3
        ? value
        : null;
    } catch {
      return null;
    }
  });
  const viewportReady = useRef(false),
    initializingViewport = useRef(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [canvasReady, setCanvasReady] = useState(false);
  const completedSave = useRef(null);
  const nodesInitialized = useNodesInitialized();
  const [recovery, setRecovery] = useState(() => {
    try {
      const raw = storageKey && localStorage.getItem(storageKey);
      if (!raw || raw.length > 1200000) return null;
      const d = JSON.parse(raw);
      if (!recoveryNeedsReview(d, initial, !!context?.retainRecoveryOnSave)) {
        localStorage.removeItem(storageKey);
        return null;
      }
      return { ...d, diagram: parseDiagram(d.diagram) };
    } catch {
      return null;
    }
  });
  const [pendingUploads, setPendingUploads] = useState(0);
  const [snap, setSnap] = useState(true),
    [search, setSearch] = useState(""),
    [palette, setPalette] = useState(() => window.innerWidth > 700),
    [inspector, setInspector] = useState(() => window.innerWidth > 700),
    [menu, setMenu] = useState(null),
    [guides, setGuides] = useState([]);
  const clipboard = useRef(diagramClipboard),
    typing = useRef(null),
    viewport = useRef(null);
  const [draft, setDraftState] = useState(initial),
    [past, setPast] = useState([]),
    [future, setFuture] = useState([]),
    [discard, setDiscard] = useState(false),
    [conflict, setConflict] = useState(false),
    [error, setError] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  const latestDraft = useRef(draft);
  const setDraft = (update) => {
    try {
      const next = retainMeasurements(
        latestDraft.current,
        typeof update === "function" ? update(latestDraft.current) : update,
      );
      parseDiagram(next);
      latestDraft.current = next;
      setDraftState(next);
    } catch (e) {
      setError(e.message);
    }
  };
  const dialog = useRef(null),
    dragStart = useRef(null),
    flow = useReactFlow();
  const baseline = useRef(serial(initial));
  const selected = draft.nodes.find((n) => n.selected),
    selectedEdge = draft.edges.find((e) => e.selected);
  const dirty = serial(draft) !== baseline.current;
  useEffect(() => {
    dialog.current.showModal();
    setModalOpen(true);
  }, []);
  useEffect(() => {
    if (
      !modalOpen ||
      initializingViewport.current ||
      viewportReady.current ||
      (draft.nodes.length && !nodesInitialized)
    )
      return;
    const canvas = dialog.current?.querySelector(".diagram-canvas");
    if (!canvas?.clientWidth || !canvas?.clientHeight) return;
    let cancelled = false;
    const frame = requestAnimationFrame(async () => {
      if (cancelled) return;
      initializingViewport.current = true;
      try {
        if (initialViewport) await flow.setViewport(initialViewport);
        else if (latestDraft.current.nodes.length)
          await flow.fitView({ padding: 0.2 });
        else await flow.setViewport({ x: 0, y: 0, zoom: 1 });
        if (cancelled) return;
        viewport.current = flow.getViewport();
        viewportReady.current = true;
        setCanvasReady(true);
      } finally {
        initializingViewport.current = false;
      }
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [modalOpen, nodesInitialized, initialViewport, flow, draft.nodes.length]);
  useEffect(() => {
    const warn = (e) => {
      if (
        (dirty || pendingUploads) &&
        completedSave.current !== serial(latestDraft.current)
      ) {
        try {
          if (storageKey && !recovery)
            localStorage.setItem(
              storageKey,
              JSON.stringify({
                baseline: baseline.current,
                diagram: parseDiagram(draft),
                viewport: viewport.current,
              }),
            );
        } catch {}
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, draft, storageKey, recovery, pendingUploads]);
  useEffect(() => {
    if (!storageKey || recovery || !dirty) return;
    const timer = setTimeout(() => {
      if (completedSave.current === serial(latestDraft.current)) return;
      try {
        const value = JSON.stringify({
          baseline: baseline.current,
          diagram: parseDiagram(draft),
          viewport: viewport.current,
        });
        if (value.length > 1200000)
          throw Error("Draft is too large for recovery storage");
        localStorage.setItem(storageKey, value);
      } catch (e) {
        setError(`Draft recovery unavailable: ${e.message}`);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [draft, dirty, recovery, storageKey]);
  const clearRecovery = () => {
    try {
      if (storageKey) localStorage.removeItem(storageKey);
    } catch (e) {
      setError(e.message);
    }
  };
  const change = (next, transaction) => {
    try {
      const prepared = prepareEditorChange(latestDraft.current, next);
      next = prepared.diagram;
      if (!transaction || typing.current !== transaction)
        setPast((p) => [...p.slice(-79), prepared.before]);
      typing.current = transaction || null;
      setFuture([]);
      setDraft(next);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  };
  const fitDocument = async (next) => {
    setCanvasReady(false);
    try {
      const canvas = dialog.current.querySelector(".diagram-canvas");
      const { width, height } = canvas.getBoundingClientRect();
      if (!width || !height)
        throw Error("The diagram canvas is not ready to fit.");
      const target = getViewportForBounds(
        diagramBounds(parseDiagram(next)),
        width,
        height,
        0.15,
        3,
        0.25,
      );
      await flow.setViewport(target, { duration: 0 });
      viewport.current = target;
    } catch (e) {
      setError(e.message);
    } finally {
      setCanvasReady(true);
    }
  };
  const undo = () => {
    if (!past.length) return;
    typing.current = null;
    setFuture((f) => [serial(draft), ...f]);
    setDraft(parseDiagram(past.at(-1)));
    setPast((p) => p.slice(0, -1));
  };
  const redo = () => {
    if (!future.length) return;
    typing.current = null;
    setPast((p) => [...p, serial(draft)]);
    setDraft(parseDiagram(future[0]));
    setFuture((f) => f.slice(1));
  };
  const close = () => {
    if (pendingUploads) {
      setError("Wait for the asset upload to finish before closing.");
      return;
    }
    conflict ? setConflict(false) : dirty ? setDiscard(true) : onClose();
  };
  const save = async (replace = false) => {
    if (recovery || discard || (conflict && !replace)) return;
    if (pendingUploads) {
      setError("Wait for the asset upload to finish before saving.");
      return;
    }
    if (!replace && serial(initial) !== baseline.current) {
      setConflict(true);
      return;
    }
    try {
      if (context?.retainRecoveryOnSave && storageKey) {
        const recovery = JSON.stringify({
          baseline: baseline.current,
          diagram: parseDiagram(draft),
          viewport: viewport.current,
        });
        if (recovery.length > 1200000)
          throw Error("Draft is too large for recovery storage");
        localStorage.setItem(storageKey, recovery);
      }
      const saved = serial(latestDraft.current);
      await onSave(saved);
      if (!context?.retainRecoveryOnSave) {
        completedSave.current = saved;
        clearRecovery();
      }
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
          sourceHandle: c.sourceHandle || "out-bottom",
          targetHandle: c.targetHandle || "in-top",
          label: "",
        },
      ],
    });
  };
  const remove = () => change(deleteSelection(draft));
  const updateNode = (data) =>
    change(
      styleSelection(draft, data),
      Object.keys(data).length === 1
        ? `${selected?.id}:${Object.keys(data)[0]}`
        : undefined,
    );
  const updateEdge = (data) =>
    change({
      ...draft,
      edges: draft.edges.map((e) => (e.selected ? { ...e, ...data } : e)),
    });
  const openLink = (link) => {
    if (pendingUploads) {
      setError(
        "Wait for the asset upload to finish before opening a linked target.",
      );
      return;
    }
    if (dirty) {
      setError("Save or discard your changes before opening a linked target.");
      return;
    }
    if (["note", "block", "concept"].includes(link.kind)) {
      if (!context?.onOpenNote) {
        setError("Note navigation is unavailable here.");
        return;
      }
      onClose();
      context.onOpenNote(link.noteId, link.blockId);
    } else
      window.open(
        context?.resolveAssetUrl?.(link.url) || link.url,
        "_blank",
        "noopener,noreferrer",
      );
  };
  const fitSelection = () =>
    flow.fitView({
      nodes: draft.nodes.filter((n) => n.selected),
      padding: 0.3,
    });
  const onKeys = (e) => {
    if (recovery || discard || conflict) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s")
        e.preventDefault();
      return;
    }
    if (e.key === "Escape") return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      save();
      return;
    }
    if (e.target.closest("input,textarea,select")) return;
    if (e.metaKey || e.ctrlKey) {
      const key = e.key.toLowerCase();
      if (["a", "c", "v", "d", "g"].includes(key)) {
        e.preventDefault();
        if (key === "a")
          setDraft({
            ...draft,
            nodes: draft.nodes.map((n) => ({ ...n, selected: true })),
          });
        if (key === "c")
          diagramClipboard = clipboard.current = selectedSubgraph(draft);
        if (key === "v" && clipboard.current)
          change(insertDiagram(draft, clipboard.current));
        if (key === "d") change(duplicateSelection(draft));
        if (key === "g")
          change(e.shiftKey ? ungroupSelection(draft) : groupSelection(draft));
        return;
      }
    }
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
      onBlurCapture={() => {
        typing.current = null;
      }}
    >
      <header
        className="diagram-header"
        inert={discard || conflict || !!recovery}
      >
        <div>
          <strong>Diagram</strong>
          <span>
            {draft.nodes.length} shapes · {draft.edges.length} connectors
            {dirty ? " · Unsaved changes" : ""}
          </span>
        </div>
        <div className="diagram-actions">
          <button aria-pressed={palette} onClick={() => setPalette((v) => !v)}>
            Shapes panel
          </button>
          <button
            aria-pressed={inspector}
            onClick={() => setInspector((v) => !v)}
          >
            Inspector panel
          </button>
          <button onClick={undo} disabled={!past.length}>
            Undo
          </button>
          <button onClick={redo} disabled={!future.length}>
            Redo
          </button>
          <button
            onClick={close}
            aria-label="Close diagram"
            disabled={!!pendingUploads}
          >
            Close
          </button>
          <button
            className="diagram-save"
            onClick={() => save()}
            disabled={!!pendingUploads}
          >
            Save diagram
          </button>
        </div>
      </header>
      <div
        style={{
          gridTemplateColumns: `${palette ? "190px" : "0px"} minmax(0,1fr) ${inspector ? "210px" : "0px"}`,
        }}
        className="diagram-workspace"
        inert={discard || conflict || !!recovery}
      >
        <aside hidden={!palette} className="diagram-palette">
          <h3>Shapes</h3>
          <p>Drag onto the canvas, or click to add.</p>
          {SHAPES.map((shape) => (
            <button
              key={shape}
              aria-label={`Add ${shape}`}
              disabled={!canvasReady}
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
            disabled={!canvasReady}
            value=""
            onChange={(e) => {
              if (!e.target.value) return;
              let next;
              if (e.target.value === "blank") {
                if (
                  draft.nodes.length &&
                  !window.confirm("Clear this canvas? Undo restores your work.")
                )
                  return;
                next = templateDiagram("blank");
              } else {
                const template = parseDiagram(templateDiagram(e.target.value));
                next = draft.nodes.length
                  ? insertDiagram(draft, template)
                  : template;
              }
              change(next);
              fitDocument(next);
            }}
          >
            <option value="">Choose a template…</option>
            <option value="flow">Simple flow</option>
            <option value="decision">Decision</option>
            <option value="data">Data pipeline</option>
            <option value="architecture">Architecture</option>
            <option value="approval">Approval</option>
            <option value="knowledge">Knowledge map</option>
            <option value="swimlane">Swimlane</option>
            <option value="blank">Blank canvas</option>
          </select>
          <p>
            Templates insert into your canvas. Blank canvas asks before
            clearing.
          </p>
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
          <p>Drag between dots on any side.</p>
          <EditorLibrary
            draft={draft}
            change={change}
            context={context}
            setError={setError}
            dirty={dirty}
            pendingUploads={pendingUploads}
            onUploadPending={(delta) =>
              setPendingUploads((v) => Math.max(0, v + delta))
            }
            onClose={close}
          />
          <h3>Arrange</h3>
          <button
            onClick={() => change(duplicateSelection(draft))}
            disabled={!selected}
          >
            Duplicate selected
          </button>
          <button
            onClick={() => {
              diagramClipboard = clipboard.current = selectedSubgraph(draft);
            }}
            disabled={!selected}
          >
            Copy selected
          </button>
          <button
            onClick={() => {
              if (clipboard.current)
                change(insertDiagram(draft, clipboard.current));
            }}
          >
            Paste shapes
          </button>
          <button
            onClick={() => change(groupSelection(draft))}
            disabled={!selected}
          >
            Group selected
          </button>
          <button
            onClick={() => change(ungroupSelection(draft))}
            disabled={!selected}
          >
            Ungroup selected
          </button>
          <button
            onClick={() => change(lockSelection(draft, !selected?.locked))}
            disabled={!selected}
          >
            {selected?.locked ? "Unlock selected" : "Lock selected"}
          </button>
          <select
            aria-label="Align selected"
            value=""
            onChange={(e) => change(alignSelection(draft, e.target.value))}
          >
            <option value="">Align / distribute…</option>
            {[
              "left",
              "center",
              "right",
              "top",
              "middle",
              "bottom",
              "horizontal",
              "vertical",
            ].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
          <button onClick={() => change(autoLayout(draft, "TB"))}>
            Layout top down
          </button>
          <button onClick={() => change(autoLayout(draft, "LR"))}>
            Layout left to right
          </button>
          <label>
            <input
              type="checkbox"
              checked={snap}
              onChange={(e) => setSnap(e.target.checked)}
            />{" "}
            Snap to grid
          </label>
        </aside>
        <div
          className="diagram-canvas"
          inert={!canvasReady}
          aria-busy={!canvasReady}
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
          <div className="diagram-navigation">
            <input
              aria-label="Search shapes"
              placeholder="Find a shape…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                if (e.target.value) {
                  const matches = draft.nodes.filter((n) =>
                    n.data.label
                      .toLowerCase()
                      .includes(e.target.value.toLowerCase()),
                  );
                  if (matches.length)
                    flow.fitView({ nodes: matches, padding: 0.3 });
                }
              }}
            />
            <button onClick={fitSelection}>Zoom to selection</button>
          </div>
          <ReactFlow
            nodes={parentFirst(draft.nodes).map((n) => ({
              ...n,
              draggable: !n.locked,
              connectable: !n.locked,
              data: {
                ...n.data,
                image: n.data.image
                  ? {
                      ...n.data.image,
                      url:
                        context?.resolveAssetUrl?.(n.data.image.url) ||
                        n.data.image.url,
                    }
                  : undefined,
                _locked: n.locked,
                _update: (data) =>
                  change({
                    ...draft,
                    nodes: draft.nodes.map((v) =>
                      v.id === n.id
                        ? { ...v, data: { ...v.data, ...data } }
                        : v,
                    ),
                  }),
                _open: openLink,
              },
            }))}
            edges={draft.edges.map((e) => ({
              ...e,
              type: "diagramEdge",
              data: { edge: e, nodes: draft.nodes },
            }))}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            snapToGrid={snap}
            snapGrid={[20, 20]}
            onMoveEnd={(_, v) => {
              if (!viewportReady.current) return;
              viewport.current = v;
              try {
                if (storageKey)
                  localStorage.setItem(
                    `${storageKey}:viewport`,
                    JSON.stringify(v),
                  );
              } catch {}
            }}
            onPaneContextMenu={(e) => {
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY });
            }}
            onNodeContextMenu={(e, n) => {
              e.preventDefault();
              setDraft({
                ...draft,
                nodes: draft.nodes.map((v) => ({
                  ...v,
                  selected: v.id === n.id || v.selected,
                })),
              });
              setMenu({ x: e.clientX, y: e.clientY });
            }}
            onPaneClick={() => setMenu(null)}
            onReconnect={(old, c) =>
              change({
                ...draft,
                edges: draft.edges.map((e) =>
                  e.id === old.id ? { ...e, ...c } : e,
                ),
              })
            }
            onNodesChange={(changes) => {
              try {
                const draft = latestDraft.current;
                const next = {
                  ...draft,
                  nodes: applyNodeChanges(
                    changes.filter(
                      (c) =>
                        !draft.nodes.find((n) => n.id === c.id)?.locked ||
                        c.type === "select" ||
                        c.type === "dimensions",
                    ),
                    draft.nodes,
                  ),
                };
                parseDiagram(next);
                const resizing = changes.some(
                  (c) => c.type === "dimensions" && c.resizing,
                );
                if (resizing && !dragStart.current)
                  dragStart.current = serial(latestDraft.current);
                if (
                  changes.some(
                    (c) => c.type === "dimensions" && c.resizing === false,
                  ) &&
                  dragStart.current
                ) {
                  const snapshot = dragStart.current;
                  setPast((p) => [...p.slice(-79), snapshot]);
                  setFuture([]);
                  dragStart.current = null;
                }
                if (
                  changes.some((c) => c.type === "position" && !c.dragging) &&
                  !dragStart.current
                )
                  change(next);
                else
                  setDraft((current) => ({
                    ...current,
                    nodes: applyNodeChanges(
                      changes.filter(
                        (c) =>
                          !current.nodes.find((n) => n.id === c.id)?.locked ||
                          c.type === "select" ||
                          c.type === "dimensions",
                      ),
                      current.nodes,
                    ),
                  }));
              } catch (e) {
                setError(e.message);
              }
            }}
            onEdgesChange={(changes) =>
              setDraft((current) => ({
                ...current,
                edges: applyEdgeChanges(changes, current.edges),
              }))
            }
            onNodeDrag={(_, node) => {
              const p = worldPosition(node, draft.nodes);
              setGuides(
                draft.nodes
                  .filter((n) => n.id !== node.id)
                  .flatMap((n) => {
                    const q = worldPosition(n, draft.nodes);
                    return [
                      ...(Math.abs(p.x - q.x) < 6
                        ? [{ axis: "x", value: q.x }]
                        : []),
                      ...(Math.abs(p.y - q.y) < 6
                        ? [{ axis: "y", value: q.y }]
                        : []),
                    ];
                  }),
              );
            }}
            onNodeDragStart={() => {
              typing.current = null;
              dragStart.current = serial(latestDraft.current);
            }}
            onNodeDragStop={() => {
              if (
                dragStart.current &&
                dragStart.current !== serial(latestDraft.current)
              ) {
                const snapshot = dragStart.current;
                setPast((p) => [...p.slice(-79), snapshot]);
                setFuture([]);
              }
              dragStart.current = null;
              setGuides([]);
            }}
            onConnect={connect}
            deleteKeyCode={null}
            minZoom={0.15}
            maxZoom={3}
            defaultEdgeOptions={{ type: "default" }}
          >
            <Background color="#c5cbd5" gap={20} />
            <MiniMap pannable zoomable nodeColor={(n) => n.data.color} />
            {guides.map((g, i) => {
              const p = flow.flowToScreenPosition({ x: g.value, y: g.value });
              const bounds = dialog.current
                ?.querySelector(".diagram-canvas")
                ?.getBoundingClientRect();
              return (
                <div
                  key={i}
                  className={`diagram-guide diagram-guide-${g.axis}`}
                  style={
                    g.axis === "x"
                      ? { left: p.x - (bounds?.left || 0) }
                      : { top: p.y - (bounds?.top || 0) }
                  }
                />
              );
            })}
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
        <aside hidden={!inspector} className="diagram-inspector">
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
              <label>
                Font size
                <input
                  aria-label="Font size"
                  type="number"
                  min="8"
                  max="72"
                  value={selected.data.fontSize || 13}
                  onChange={(e) =>
                    updateNode({ fontSize: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                Text color
                <input
                  type="color"
                  value={selected.data.textColor || "#202b40"}
                  onChange={(e) => updateNode({ textColor: e.target.value })}
                />
              </label>
              <label>
                Text weight
                <select
                  value={selected.data.fontWeight || 400}
                  onChange={(e) =>
                    updateNode({ fontWeight: Number(e.target.value) })
                  }
                >
                  <option value="400">Regular</option>
                  <option value="700">Bold</option>
                </select>
              </label>
              <label>
                Text align
                <select
                  value={selected.data.textAlign || "center"}
                  onChange={(e) => updateNode({ textAlign: e.target.value })}
                >
                  {["left", "center", "right"].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              {["width", "height"].map((axis) => (
                <label key={axis}>
                  {axis}
                  <input
                    aria-label={`Shape ${axis}`}
                    type="number"
                    min="40"
                    max="4000"
                    value={selected[axis] || (axis === "width" ? 180 : 90)}
                    onChange={(e) =>
                      change(
                        {
                          ...draft,
                          nodes: draft.nodes.map((n) =>
                            n.selected && !n.locked
                              ? { ...n, [axis]: Number(e.target.value) }
                              : n,
                          ),
                        },
                        `${selected.id}:${axis}`,
                      )
                    }
                  />
                </label>
              ))}
              <button
                onClick={() =>
                  change({
                    ...draft,
                    nodes: draft.nodes.map((n) =>
                      n.selected && !n.locked
                        ? {
                            ...n,
                            width: Math.min(
                              1200,
                              Math.max(
                                180,
                                Math.sqrt(n.data.label.length) *
                                  (n.data.fontSize || 13) *
                                  3,
                              ),
                            ),
                            height: Math.min(
                              1200,
                              Math.max(
                                90,
                                Math.ceil(n.data.label.length / 30) *
                                  (n.data.fontSize || 13) *
                                  1.5 +
                                  40,
                              ),
                            ),
                          }
                        : n,
                    ),
                  })
                }
              >
                Fit to text
              </button>
              <LinkInspector
                selected={selected}
                updateNode={updateNode}
                context={context}
                openLink={openLink}
              />
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
            <>
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
              <label>
                Line type
                <select
                  aria-label="Connector type"
                  value={selectedEdge.kind || "curve"}
                  onChange={(e) => updateEdge({ kind: e.target.value })}
                >
                  {["curve", "straight", "orthogonal"].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <label>
                Line color
                <input
                  type="color"
                  value={selectedEdge.color || "#758093"}
                  onChange={(e) => updateEdge({ color: e.target.value })}
                />
              </label>
              <label>
                Line width
                <input
                  type="number"
                  min="1"
                  max="12"
                  value={selectedEdge.width || 2}
                  onChange={(e) =>
                    updateEdge({ width: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={!!selectedEdge.dashed}
                  onChange={(e) => updateEdge({ dashed: e.target.checked })}
                />
                Dashed
              </label>
              {["startArrow", "endArrow"].map((key) => (
                <label key={key}>
                  {key}
                  <select
                    aria-label={key}
                    value={selectedEdge[key] || "none"}
                    onChange={(e) => updateEdge({ [key]: e.target.value })}
                  >
                    {["none", "arrow", "diamond", "circle"].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </label>
              ))}
            </>
          ) : (
            <p>
              Select a shape or connector to edit it. Arrow keys move a focused
              shape.
            </p>
          )}
          <button disabled={!selected && !selectedEdge} onClick={remove}>
            Delete selected
          </button>
        </aside>
      </div>
      {!!pendingUploads && (
        <p className="diagram-upload-status" role="status">
          Uploading {pendingUploads} asset{pendingUploads === 1 ? "" : "s"}…
          Save and close will be available when finished.
        </p>
      )}
      {error && (
        <p className="diagram-error" role="alert">
          {error}
        </p>
      )}
      {menu && (
        <div
          className="diagram-context-menu"
          style={{ left: menu.x, top: menu.y }}
          role="menu"
        >
          {[
            [
              "Select all",
              () =>
                setDraft({
                  ...draft,
                  nodes: draft.nodes.map((n) => ({ ...n, selected: true })),
                }),
            ],
            ["Duplicate", () => change(duplicateSelection(draft))],
            ["Group", () => change(groupSelection(draft))],
            ["Delete", remove],
          ].map(([label, fn]) => (
            <button
              role="menuitem"
              key={label}
              onClick={() => {
                fn();
                setMenu(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {recovery && (
        <div className="diagram-discard-backdrop">
          <div
            className="diagram-discard"
            role="alertdialog"
            aria-label="Recover diagram draft"
          >
            <h3>Recover unsaved diagram?</h3>
            <p>
              {recovery.baseline !== serial(initial)
                ? "The saved diagram has changed. Restoring keeps your draft separate until you review the save conflict."
                : "An unfinished draft was found on this device."}
            </p>
            <button
              onClick={() => {
                setDraft(recovery.diagram);
                baseline.current = recovery.baseline;
                if (recovery.viewport) flow.setViewport(recovery.viewport);
                setRecovery(null);
              }}
            >
              Restore draft
            </button>
            <button
              onClick={() => {
                clearRecovery();
                setRecovery(null);
              }}
            >
              Discard recovered draft
            </button>
          </div>
        </div>
      )}
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
            <button
              onClick={() => {
                clearRecovery();
                onClose();
              }}
            >
              Discard changes
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
