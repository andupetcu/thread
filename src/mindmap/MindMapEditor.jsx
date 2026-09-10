import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ReactFlow,
  Handle,
  Position,
  Background,
  Controls,
  MiniMap,
  applyNodeChanges,
  useReactFlow,
  getViewportForBounds,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  parseMindMap,
  layoutMindMap,
  addIdea,
  addSibling,
  removeBranch,
  reparentIdea,
  updateIdea,
  duplicateBranch,
  mindMapToOutline,
  outlineToMindMap,
  mindMapToSvg,
} from "./model.js";
import {
  diagramBounds,
  diagramToPng,
  nodeShapeSvg,
  nodeLabelLayout,
} from "../diagram/model.js";
const serial = (d) => JSON.stringify(parseMindMap(d));
const colors = [
  "#e8eefc",
  "#dcf0e5",
  "#fff0cc",
  "#f5dce6",
  "#eae2f8",
  "#ffffff",
];
function download(content, name, type) {
  const url = content.startsWith("data:")
    ? content
    : URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function IdeaNode({ id, data, selected, width = 200, height = 70 }) {
  const [editing, setEditing] = useState(false),
    [text, setText] = useState("");
  const node = { id, data, width, height },
    labelLayout = nodeLabelLayout(node);
  const finish = () => {
    if (editing) {
      data.edit(id, text);
      setEditing(false);
    }
  };
  return (
    <div
      className={`mindmap-idea${selected ? " selected" : ""}`}
      style={{
        width,
        height,
        borderRadius: data.shape === "ellipse" ? "50%" : 10,
      }}
      onDoubleClick={() => {
        setText(data.label);
        setEditing(true);
      }}
    >
      {["Left", "Right", "Top", "Bottom"].flatMap((side) =>
        ["in", "out"].map((kind) => (
          <Handle
            key={kind + side}
            id={`${kind}-${side.toLowerCase()}`}
            type={kind === "in" ? "target" : "source"}
            position={Position[side]}
            isConnectable={false}
          />
        )),
      )}
      {editing ? (
        <textarea
          className="nodrag nowheel"
          autoFocus
          aria-label="Edit idea directly"
          maxLength={500}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={finish}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              finish();
            }
            if (e.key === "Escape") {
              setEditing(false);
            }
          }}
        />
      ) : (
        <svg className="mindmap-idea-art" width={width} height={height}>
          <g dangerouslySetInnerHTML={{ __html: nodeShapeSvg(node) }} />
          <text
            x={labelLayout.x}
            y={labelLayout.y}
            textAnchor={labelLayout.textAnchor}
            fill={data.textColor || "#202b40"}
            fontSize={labelLayout.fontSize}
            fontWeight={data.fontWeight || 400}
            fontFamily="Arial,sans-serif"
          >
            {labelLayout.lines.map((line, i) => (
              <tspan
                key={i}
                x={labelLayout.x}
                dy={i ? labelLayout.lineHeight : 0}
              >
                {line}
              </tspan>
            ))}
          </text>
        </svg>
      )}
      {data.childCount > 0 && (
        <button
          className="mindmap-collapse nodrag"
          aria-label={`${data.collapsed ? "Expand" : "Collapse"} ${data.label}`}
          onClick={(e) => {
            e.stopPropagation();
            data.collapse(id);
          }}
        >
          {data.collapsed ? `+${data.childCount}` : "−"}
        </button>
      )}
      {data.link && (
        <button
          className="mindmap-link nodrag"
          aria-label={`Open idea link: ${data.label}`}
          onClick={(e) => {
            e.stopPropagation();
            data.open(data.link);
          }}
        >
          ↗
        </button>
      )}
    </div>
  );
}
const nodeTypes = { mindmapIdea: IdeaNode };
export default function MindMapEditor({
  initial,
  onSave,
  onClose,
  context,
  recoveryKey,
}) {
  const key = recoveryKey
    ? `thread-mindmap-draft:${recoveryKey}`
    : context?.noteId
      ? `thread-mindmap-draft:${context.noteId}:${context.blockId || context.diagramIndex || 0}`
      : null;
  const [draft, setDraftState] = useState(initial),
    latest = useRef(initial),
    baseline = useRef(serial(initial));
  const [selectedId, setSelectedId] = useState(initial.rootId),
    [past, setPast] = useState([]),
    [future, setFuture] = useState([]),
    [error, setError] = useState(""),
    [discard, setDiscard] = useState(false),
    [conflict, setConflict] = useState(false),
    [saving, setSaving] = useState(false),
    [panel, setPanel] = useState(() => window.innerWidth > 650),
    [outline, setOutline] = useState(""),
    [imported, setImported] = useState(null),
    [background, setBackground] = useState("#ffffff"),
    [scale, setScale] = useState(2);
  const [recovery, setRecovery] = useState(() => {
    try {
      const raw = key && localStorage.getItem(key);
      if (!raw || raw.length > 1200000) return null;
      const stored = JSON.parse(raw);
      stored.document = parseMindMap(stored.document);
      if (
        !context?.retainRecoveryOnSave &&
        serial(stored.document) === serial(initial)
      ) {
        localStorage.removeItem(key);
        return null;
      }
      return stored;
    } catch {
      return null;
    }
  });
  const [viewport, setViewport] = useState(() => {
    try {
      const v = key && JSON.parse(localStorage.getItem(`${key}:viewport`));
      return v &&
        [v.x, v.y, v.zoom].every(Number.isFinite) &&
        v.zoom >= 0.1 &&
        v.zoom <= 3
        ? v
        : { x: 0, y: 0, zoom: 1 };
    } catch {
      return { x: 0, y: 0, zoom: 1 };
    }
  });
  const capturedViewport = useRef(viewport),
    viewportRef = useRef(viewport),
    ready = useRef(false),
    completed = useRef(null),
    typing = useRef(null),
    dialog = useRef(null),
    labelInput = useRef(null),
    flow = useReactFlow();
  const [opened, setOpened] = useState(false),
    [canvasReady, setCanvasReady] = useState(false),
    [flowNodes, setFlowNodes] = useState([]);
  const projection = useMemo(() => layoutMindMap(draft), [draft]);
  const selected = (() => {
      const visible = new Set(projection.nodes.map((n) => n.id));
      let node =
        draft.nodes.find((n) => n.id === selectedId) ||
        draft.nodes.find((n) => n.id === draft.rootId);
      while (node.parentId && !visible.has(node.id))
        node = draft.nodes.find((n) => n.id === node.parentId);
      return node;
    })(),
    dirty = serial(draft) !== baseline.current;
  useLayoutEffect(() => {
    if (selectedId !== selected.id) setSelectedId(selected.id);
  }, [selectedId, selected.id]);
  const updateViewport = (v) => {
    viewportRef.current = v;
    setViewport(v);
    if (ready.current && key)
      try {
        localStorage.setItem(`${key}:viewport`, JSON.stringify(v));
      } catch {}
  };
  const putDraft = (next) => {
    latest.current = next;
    setDraftState(next);
  };
  const transact = (operation, transaction) => {
    try {
      const previous = latest.current,
        next = parseMindMap(
          typeof operation === "function" ? operation(previous) : operation,
        );
      if (serial(previous) === serial(next)) return;
      if (!transaction || typing.current !== transaction)
        setPast((p) => [...p.slice(-79), serial(previous)]);
      typing.current = transaction || null;
      setFuture([]);
      putDraft(next);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  };
  const clearRecovery = () => {
    if (key) localStorage.removeItem(key);
  };
  const persist = () => {
    if (!key || completed.current === serial(latest.current)) return;
    const value = JSON.stringify({
      baseline: baseline.current,
      document: latest.current,
      viewport: viewportRef.current,
    });
    if (value.length > 1200000)
      throw Error("Mind map draft exceeds recovery storage limit");
    localStorage.setItem(key, value);
  };
  const close = () => {
    if (saving) return;
    if (conflict) {
      setConflict(false);
      return;
    }
    dirty ? setDiscard(true) : onClose();
  };
  const save = async (replace) => {
    if (saving || recovery || imported || discard || (conflict && !replace))
      return;
    if (!replace && serial(initial) !== baseline.current) {
      setConflict(true);
      return;
    }
    try {
      setSaving(true);
      persist();
      const value = serial(latest.current);
      await onSave(value);
      if (!context?.retainRecoveryOnSave) {
        completed.current = value;
        clearRecovery();
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };
  const openLink = (link) => {
    if (dirty || saving) {
      setError("Save or discard your changes before opening a linked target.");
      return;
    }
    if (link.kind === "bundle") {
      if (!context?.onOpenBundle) {
        setError("Bundle navigation is unavailable here.");
        return;
      }
      onClose();
      context.onOpenBundle(link.bundleId);
    } else if (["note", "block", "concept"].includes(link.kind)) {
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
  const edit = (id, label) =>
    transact((d) => updateIdea(d, id, { label }), `label:${id}`);
  const collapse = (id) =>
    transact((d) =>
      updateIdea(d, id, {
        collapsed: !d.nodes.find((n) => n.id === id).collapsed,
      }),
    );
  const displayNodes = () =>
    projection.nodes.map((n) => ({
      ...n,
      type: "mindmapIdea",
      selected: n.id === selected.id,
      draggable: n.id !== draft.rootId,
      connectable: false,
      data: {
        ...n.data,
        label: draft.nodes.find((v) => v.id === n.id)?.label || "",
        link: draft.nodes.find((v) => v.id === n.id)?.link,
        collapsed: !!draft.nodes.find((v) => v.id === n.id)?.collapsed,
        childCount: draft.nodes.filter((v) => v.parentId === n.id).length,
        edit,
        collapse,
        open: openLink,
      },
    }));
  useLayoutEffect(() => {
    setFlowNodes((previous) =>
      displayNodes().map((n) => {
        const old = previous.find((v) => v.id === n.id);
        return old?.measured && old.width === n.width && old.height === n.height
          ? { ...n, measured: old.measured }
          : n;
      }),
    );
  }, [projection, selectedId, dirty, saving]);
  const fit = (document = latest.current) => {
    const canvas = dialog.current?.querySelector(".mindmap-canvas");
    if (!canvas?.clientWidth || !canvas?.clientHeight) return;
    const v = getViewportForBounds(
      diagramBounds(layoutMindMap(document)),
      canvas.clientWidth,
      canvas.clientHeight,
      0.1,
      2,
      0.25,
    );
    updateViewport(v);
  };
  useLayoutEffect(() => {
    dialog.current.showModal();
    setOpened(true);
  }, []);
  useLayoutEffect(() => {
    if (!opened || ready.current) return;
    const canvas = dialog.current.querySelector(".mindmap-canvas");
    if (!canvas.clientWidth || !canvas.clientHeight) return;
    let stored = false;
    try {
      stored = !!(key && localStorage.getItem(`${key}:viewport`));
    } catch {}
    if (stored) updateViewport(capturedViewport.current);
    else fit();
    ready.current = true;
    setCanvasReady(true);
  }, [opened]);
  useEffect(() => {
    if (!key || recovery || !dirty) return;
    const timer = setTimeout(() => {
      try {
        persist();
      } catch (e) {
        setError(e.message);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [draft, dirty, recovery, key]);
  useEffect(() => {
    const warn = (e) => {
      if (dirty && completed.current !== serial(latest.current)) {
        try {
          persist();
        } catch {}
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const add = (kind) => {
    try {
      const current = latest.current,
        next =
          kind === "child"
            ? addIdea(current, selected.id)
            : addSibling(current, selected.id);
      transact(next);
      setSelectedId(next.nodes.at(-1).id);
      requestAnimationFrame(() => labelInput.current?.select());
    } catch (e) {
      setError(e.message);
    }
  };
  const undo = () => {
    if (!past.length) return;
    typing.current = null;
    setFuture((f) => [serial(latest.current), ...f]);
    putDraft(parseMindMap(past.at(-1)));
    setPast((p) => p.slice(0, -1));
  };
  const redo = () => {
    if (!future.length) return;
    typing.current = null;
    setPast((p) => [...p, serial(latest.current)]);
    putDraft(parseMindMap(future[0]));
    setFuture((f) => f.slice(1));
  };
  const keys = (e) => {
    if (recovery || imported || discard || conflict || saving) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s")
        e.preventDefault();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      save(false);
      return;
    }
    if (e.target.closest("input,textarea,select,button")) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
    } else if (e.key === "Tab") {
      e.preventDefault();
      add("child");
    } else if (e.key === "Enter") {
      e.preventDefault();
      add("sibling");
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      transact((d) => removeBranch(d, selected.id));
      setSelectedId(draft.rootId);
    }
  };
  const navigateKeys = (e) => {
    if (
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key) ||
      !e.target.closest(".react-flow__node") ||
      e.target.closest("input,textarea,select")
    )
      return;
    e.preventDefault();
    e.stopPropagation();
    if (recovery || imported || discard || conflict || saving) return;
    if (e.key === "ArrowRight" && selected.collapsed) {
      collapse(selected.id);
      return;
    }
    const siblings = draft.nodes.filter(
        (n) => n.parentId === selected.parentId,
      ),
      index = siblings.findIndex((n) => n.id === selected.id);
    const next =
      e.key === "ArrowLeft"
        ? draft.nodes.find((n) => n.id === selected.parentId)
        : e.key === "ArrowRight"
          ? draft.nodes.find((n) => n.parentId === selected.id)
          : e.key === "ArrowUp"
            ? siblings[Math.max(0, index - 1)]
            : siblings[Math.min(siblings.length - 1, index + 1)];
    if (next) {
      setSelectedId(next.id);
      requestAnimationFrame(() =>
        dialog.current?.querySelector(`[data-id="${next.id}"]`)?.focus(),
      );
    }
  };
  const link = selected.link,
    blocked = !!recovery || discard || conflict || !!imported || saving;
  const run = async (fn) => {
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    }
  };
  return (
    <dialog
      className="mindmap-dialog"
      aria-label="Edit mind map"
      ref={dialog}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onKeyDown={keys}
      onKeyDownCapture={navigateKeys}
      onBlurCapture={() => {
        typing.current = null;
      }}
    >
      <header className="mindmap-header" inert={blocked}>
        <div>
          <strong>Mind map</strong>
          <span>
            {draft.nodes.length} ideas{dirty ? " · Unsaved changes" : ""}
          </span>
        </div>
        <nav>
          <button onClick={() => setPanel((v) => !v)} aria-pressed={panel}>
            Ideas panel
          </button>
          <button onClick={undo} disabled={!past.length}>
            Undo
          </button>
          <button onClick={redo} disabled={!future.length}>
            Redo
          </button>
          <button onClick={close} aria-label="Close mind map">
            Close
          </button>
          <button className="mindmap-save" onClick={() => save(false)}>
            Save mind map
          </button>
        </nav>
      </header>
      <div className="mindmap-workspace" inert={blocked}>
        <div className="mindmap-canvas" inert={!canvasReady}>
          <div className="mindmap-canvas-tools">
            <button onClick={() => fit()}>Fit map</button>
            <button
              onClick={() =>
                flow.fitView({
                  nodes: flowNodes.filter((n) => n.id === selected.id),
                  padding: 0.5,
                  maxZoom: 1.5,
                })
              }
            >
              Zoom to idea
            </button>
            <span>
              Tab child · Enter sibling · Drag onto an idea to reparent
            </span>
          </div>
          <ReactFlow
            nodes={flowNodes}
            edges={projection.edges.map((e) => ({
              ...e,
              type: "smoothstep",
              style: { stroke: e.color || "#758093", strokeWidth: 2 },
              markerEnd: undefined,
            }))}
            nodeTypes={nodeTypes}
            viewport={viewport}
            onViewportChange={updateViewport}
            minZoom={0.1}
            maxZoom={3}
            nodesConnectable={false}
            deleteKeyCode={null}
            selectionOnDrag={false}
            multiSelectionKeyCode={null}
            onNodeClick={(_, n) => setSelectedId(n.id)}
            onNodesChange={(changes) =>
              setFlowNodes((nodes) => applyNodeChanges(changes, nodes))
            }
            onNodeDragStop={(_, node) => {
              const center = {
                x: node.position.x + (node.width || 200) / 2,
                y: node.position.y + (node.height || 70) / 2,
              };
              const parent = flow
                .getNodes()
                .find(
                  (n) =>
                    n.id !== node.id &&
                    center.x >= n.position.x &&
                    center.x <= n.position.x + (n.width || 200) &&
                    center.y >= n.position.y &&
                    center.y <= n.position.y + (n.height || 70),
                );
              if (parent) transact((d) => reparentIdea(d, node.id, parent.id));
              setFlowNodes((previous) =>
                displayNodes().map((n) => {
                  const old = previous.find((v) => v.id === n.id);
                  return old?.measured &&
                    old.width === n.width &&
                    old.height === n.height
                    ? { ...n, measured: old.measured }
                    : n;
                }),
              );
              setSelectedId(node.id);
            }}
          >
            <Background gap={24} color="#c8d0dc" />
            <Controls showInteractive={false} />
            <MiniMap nodeColor={(n) => n.data.color} pannable zoomable />
          </ReactFlow>
        </div>
        <aside className="mindmap-panel" hidden={!panel}>
          <h3>Selected idea</h3>
          <label>
            Idea label
            <textarea
              ref={labelInput}
              aria-label="Idea label"
              maxLength={500}
              value={selected.label}
              onChange={(e) => edit(selected.id, e.target.value)}
            />
          </label>
          <div className="mindmap-button-grid">
            <button onClick={() => add("child")}>Add child</button>
            <button
              onClick={() => add("sibling")}
              disabled={selected.id === draft.rootId}
            >
              Add sibling
            </button>
            <button
              onClick={() => collapse(selected.id)}
              disabled={!draft.nodes.some((n) => n.parentId === selected.id)}
            >
              {selected.collapsed ? "Expand branch" : "Collapse branch"}
            </button>
            <button
              onClick={() => {
                transact((d) => duplicateBranch(d, selected.id));
              }}
            >
              Duplicate branch
            </button>
            <button
              onClick={() => {
                transact((d) => removeBranch(d, selected.id));
                setSelectedId(draft.rootId);
              }}
            >
              {selected.id === draft.rootId
                ? "Clear branches"
                : "Delete branch"}
            </button>
          </div>
          <label>
            Parent idea
            <select
              aria-label="Parent idea"
              value={selected.parentId || ""}
              disabled={selected.id === draft.rootId}
              onChange={(e) =>
                transact((d) => reparentIdea(d, selected.id, e.target.value))
              }
            >
              {selected.id === draft.rootId && (
                <option value="">Root idea</option>
              )}
              {draft.nodes
                .filter((n) => n.id !== selected.id)
                .map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label || "Untitled idea"}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Branch color
            <input
              type="color"
              aria-label="Branch color"
              value={
                selected.color ||
                projection.nodes.find((n) => n.id === selected.id)?.data
                  .color ||
                colors[0]
              }
              onChange={(e) =>
                transact(
                  (d) => updateIdea(d, selected.id, { color: e.target.value }),
                  `color:${selected.id}`,
                )
              }
            />
          </label>
          <div className="mindmap-swatches">
            {colors.map((color) => (
              <button
                key={color}
                style={{ background: color }}
                aria-label={`Branch color ${color}`}
                onClick={() =>
                  transact((d) => updateIdea(d, selected.id, { color }))
                }
              />
            ))}
          </div>
          <button
            onClick={() =>
              transact((d) => updateIdea(d, selected.id, { color: undefined }))
            }
          >
            Inherit branch color
          </button>
          <label>
            Map layout
            <select
              aria-label="Map layout"
              value={draft.layout}
              onChange={(e) => {
                const next = { ...draft, layout: e.target.value };
                transact(next);
                fit(next);
              }}
            >
              <option value="both">Both sides</option>
              <option value="right">Right side</option>
            </select>
          </label>
          {selected.parentId === draft.rootId && (
            <label>
              Branch side
              <select
                value={selected.side || ""}
                onChange={(e) =>
                  transact((d) =>
                    updateIdea(d, selected.id, {
                      side: e.target.value || undefined,
                    }),
                  )
                }
              >
                <option value="">Automatic</option>
                <option value="left">Left</option>
                <option value="right">Right</option>
              </select>
            </label>
          )}
          <details>
            <summary>Link idea</summary>
            <label>
              Link to note
              <select
                aria-label="Link to note"
                value={link?.noteId || ""}
                onChange={(e) =>
                  transact((d) =>
                    updateIdea(d, selected.id, {
                      link: e.target.value
                        ? { kind: "note", noteId: e.target.value }
                        : undefined,
                    }),
                  )
                }
              >
                <option value="">No note link</option>
                {(context?.notes || []).map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.title || n.id}
                  </option>
                ))}
              </select>
            </label>
            {link?.noteId && (
              <label>
                Block ID
                <input
                  aria-label="Link block ID"
                  value={link.blockId || ""}
                  onChange={(e) =>
                    transact((d) =>
                      updateIdea(d, selected.id, {
                        link: e.target.value
                          ? {
                              kind: "block",
                              noteId: link.noteId,
                              blockId: e.target.value,
                            }
                          : { kind: "note", noteId: link.noteId },
                      }),
                    )
                  }
                />
              </label>
            )}
            <label>
              Knowledge bundle
              <select
                aria-label="Link to bundle"
                value={link?.bundleId || ""}
                onChange={(e) =>
                  transact((d) =>
                    updateIdea(d, selected.id, {
                      link: e.target.value
                        ? { kind: "bundle", bundleId: e.target.value }
                        : undefined,
                    }),
                  )
                }
              >
                <option value="">No bundle link</option>
                {(context?.bundles || []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name || b.title || b.id}
                  </option>
                ))}
              </select>
            </label>
            <label>
              URL
              <input
                aria-label="Idea URL"
                key={selected.id}
                type="url"
                defaultValue={link?.kind === "url" ? link.url : ""}
                onBlur={(e) => {
                  if (e.target.value)
                    transact((d) =>
                      updateIdea(d, selected.id, {
                        link: { kind: "url", url: e.target.value },
                      }),
                    );
                }}
              />
            </label>
            <label>
              Local file URL
              <input
                aria-label="Idea file URL"
                key={`asset-${selected.id}`}
                defaultValue={link?.kind === "asset" ? link.url : ""}
                placeholder="/api/assets/…"
                onBlur={(e) => {
                  if (e.target.value)
                    transact((d) =>
                      updateIdea(d, selected.id, {
                        link: {
                          kind: "asset",
                          url: e.target.value,
                          name: selected.label || "File",
                        },
                      }),
                    );
                }}
              />
            </label>
            {link && (
              <>
                <button onClick={() => openLink(link)}>
                  Open linked target
                </button>
                <button
                  onClick={() =>
                    transact((d) =>
                      updateIdea(d, selected.id, { link: undefined }),
                    )
                  }
                >
                  Remove link
                </button>
              </>
            )}
          </details>
          <details>
            <summary>Import and export</summary>
            <label>
              Import outline
              <textarea
                aria-label="Import outline"
                value={outline}
                onChange={(e) => setOutline(e.target.value)}
                placeholder={"- Central idea\n  - First branch"}
              />
            </label>
            <button
              disabled={!outline.trim()}
              onClick={() => run(() => setImported(outlineToMindMap(outline)))}
            >
              Review outline
            </button>
            <label>
              Import JSON
              <input
                type="file"
                aria-label="Import mind map JSON"
                accept=".json,application/json"
                onChange={(e) => {
                  const file = e.target.files[0];
                  if (file)
                    run(async () => {
                      if (file.size > 1000000)
                        throw Error("Mind map exceeds 1 MB");
                      setImported(parseMindMap(await file.text()));
                    });
                  e.target.value = "";
                }}
              />
            </label>
            <label>
              Export background
              <select
                value={background}
                onChange={(e) => setBackground(e.target.value)}
              >
                <option value="#ffffff">White</option>
                <option value="transparent">Transparent</option>
              </select>
            </label>
            <label>
              PNG scale
              <select
                value={scale}
                onChange={(e) => setScale(Number(e.target.value))}
              >
                {[1, 2, 3, 4].map((v) => (
                  <option key={v} value={v}>
                    {v}×
                  </option>
                ))}
              </select>
            </label>
            {["outline", "JSON", "SVG", "PNG"].map((format) => (
              <button
                key={format}
                onClick={() =>
                  run(async () => {
                    const content =
                      format === "outline"
                        ? mindMapToOutline(draft)
                        : format === "JSON"
                          ? JSON.stringify(parseMindMap(draft), null, 2)
                          : format === "SVG"
                            ? mindMapToSvg(draft, { background })
                            : await diagramToPng(layoutMindMap(draft), {
                                background,
                                scale,
                                resolveAsset: context?.resolveAsset,
                              });
                    download(
                      content,
                      `mind-map.${format === "outline" ? "md" : format.toLowerCase()}`,
                      format === "SVG"
                        ? "image/svg+xml"
                        : format === "outline"
                          ? "text/markdown"
                          : "application/json",
                    );
                  })
                }
              >
                Export {format}
              </button>
            ))}
          </details>
        </aside>
      </div>
      {error && (
        <p className="mindmap-error" role="alert">
          {error}
        </p>
      )}
      {saving && (
        <div className="mindmap-overlay">
          <p className="mindmap-modal" role="status">
            Saving mind map…
          </p>
        </div>
      )}
      {recovery && (
        <div className="mindmap-overlay">
          <section
            className="mindmap-modal"
            role="alertdialog"
            aria-label="Recover mind map draft"
          >
            <h3>Recover unsaved mind map?</h3>
            <p>
              {recovery.baseline !== serial(initial)
                ? "The saved source changed. Your recovered ideas remain separate until you review the save conflict."
                : "An unfinished mind map was found on this device."}
            </p>
            <button
              onClick={() => {
                putDraft(recovery.document);
                baseline.current = recovery.baseline;
                setSelectedId(recovery.document.rootId);
                if (recovery.viewport) updateViewport(recovery.viewport);
                setRecovery(null);
              }}
            >
              Restore mind map draft
            </button>
            <button
              onClick={() => {
                clearRecovery();
                setRecovery(null);
              }}
            >
              Discard recovered mind map
            </button>
          </section>
        </div>
      )}
      {discard && (
        <div className="mindmap-overlay">
          <section
            className="mindmap-modal"
            role="alertdialog"
            aria-label="Discard mind map changes"
          >
            <h3>Discard mind map changes?</h3>
            <button onClick={() => setDiscard(false)}>Keep editing</button>
            <button
              onClick={() => {
                clearRecovery();
                onClose();
              }}
            >
              Discard mind map changes
            </button>
          </section>
        </div>
      )}
      {conflict && (
        <div className="mindmap-overlay">
          <section
            className="mindmap-modal"
            role="alertdialog"
            aria-label="Mind map changed"
          >
            <h3>Mind map changed in another session</h3>
            <p>
              Your ideas remain here. Download your draft or explicitly replace
              the current map.
            </p>
            <button onClick={() => setConflict(false)}>Keep editing</button>
            <button
              onClick={() =>
                download(
                  serial(draft),
                  "mind-map-draft.json",
                  "application/json",
                )
              }
            >
              Download mind map draft
            </button>
            <button onClick={() => save(true)}>Replace with my mind map</button>
          </section>
        </div>
      )}
      {imported && (
        <div className="mindmap-overlay">
          <section
            className="mindmap-modal mindmap-import"
            role="alertdialog"
            aria-label="Review mind map import"
          >
            <h3>
              Replace this map with {imported.nodes.length} imported ideas?
            </h3>
            <p>
              Your current map remains unchanged until you choose Replace. Undo
              restores it.
            </p>
            <img
              alt="Imported mind map preview"
              src={`data:image/svg+xml,${encodeURIComponent(mindMapToSvg(imported))}`}
            />
            <button onClick={() => setImported(null)}>Cancel import</button>
            <button
              onClick={() => {
                transact(imported);
                setSelectedId(imported.rootId);
                fit(imported);
                setImported(null);
              }}
            >
              Replace with imported mind map
            </button>
          </section>
        </div>
      )}
    </dialog>
  );
}
