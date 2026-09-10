import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Drawnix, boardToImage } from "@drawnix/drawnix";
import { BoardTransforms, getSelectedElements } from "@plait/core";
import { parseMarkdownToDrawnix } from "@plait-board/markdown-to-drawnix";
import { parseMindMap } from "./model.js";
import ReferencePanel, { followReference } from "../visual/ReferencePanel.jsx";
import "drawnix.css";
const serial = (d) => JSON.stringify(parseMindMap(d));
function download(content, name, type = "application/json") {
  const url = content.startsWith("data:")
    ? content
    : URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
class NativeBoardBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="mindmap-error" role="alert">
        <p>
          Drawnix could not display this document. Your source is preserved.
          Download it or import another document to continue.
        </p>
        <button
          onClick={() =>
            download(serial(this.props.document), "mind-map-preserved.json")
          }
        >
          Download preserved mind map
        </button>
      </section>
    );
  }
}
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
  const [draft, setDraft] = useState(() => parseMindMap(initial)),
    latest = useRef(draft),
    baseline = useRef(serial(initial)),
    board = useRef(null),
    dialog = useRef(null);
  const [engineDocument, setEngineDocument] = useState(() => {
    // Drawnix owns this preference; its built-in provider defaults to Chinese.
    try {
      if (!localStorage.getItem("language"))
        localStorage.setItem("language", "en");
    } catch {}
    return structuredClone(draft);
  });
  const [epoch, setEpoch] = useState(0),
    [error, setError] = useState(""),
    [recoveryWarning, setRecoveryWarning] = useState(""),
    [engineFailed, setEngineFailed] = useState(false),
    [saving, setSaving] = useState(false),
    [discard, setDiscard] = useState(false),
    [conflict, setConflict] = useState(false),
    [imported, setImported] = useState(null),
    [markdown, setMarkdown] = useState(""),
    [selected, setSelected] = useState(null),
    [panel, setPanel] = useState(() => window.innerWidth > 650);
  const [recovery, setRecovery] = useState(() => {
    try {
      const raw = key && localStorage.getItem(key);
      if (!raw) return null;
      const r = JSON.parse(raw);
      r.document = parseMindMap(r.document);
      if (
        !context?.retainRecoveryOnSave &&
        serial(r.document) === serial(initial)
      ) {
        localStorage.removeItem(key);
        return null;
      }
      return r;
    } catch {
      return null;
    }
  });
  const dirty = serial(draft) !== baseline.current;
  function persist(next = latest.current) {
    try {
      if (key)
        localStorage.setItem(
          key,
          JSON.stringify({ baseline: baseline.current, document: next }),
        );
      setRecoveryWarning("");
    } catch {
      setRecoveryWarning(
        "Recovery storage is unavailable. Keep this editor open until you save or download your changes.",
      );
    }
  }
  function clearRecovery() {
    try {
      if (key) localStorage.removeItem(key);
    } catch {
      setRecoveryWarning(
        "Recovery storage is unavailable. A previous draft may remain in this browser.",
      );
    }
  }
  function update(next, remount = false) {
    try {
      const validated = parseMindMap(next);
      latest.current = validated;
      setDraft(validated);
      persist(validated);
      if (remount) {
        setEngineFailed(false);
        board.current = null;
        setSelected(null);
        setEngineDocument(structuredClone(validated));
        setEpoch((n) => n + 1);
      }
    } catch (e) {
      setError(e.message);
    }
  }
  useLayoutEffect(() => {
    dialog.current.showModal();
  }, []);
  useEffect(() => {
    const before = (e) => {
      if (serial(latest.current) !== baseline.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, []);
  function close() {
    if (saving) return;
    if (recovery) {
      onClose();
      return;
    }
    if (dirty) setDiscard(true);
    else onClose();
  }
  async function save(replace = false) {
    if (
      engineFailed ||
      saving ||
      recovery ||
      imported ||
      discard ||
      (conflict && !replace)
    )
      return;
    if (!replace && serial(initial) !== baseline.current) {
      setConflict(true);
      return;
    }
    setSaving(true);
    setError("");
    try {
      let next = latest.current;
      if (board.current && next.elements.length) {
        const preview = await boardToImage(board.current, {
          ratio: 1,
          fillStyle: "#ffffff",
        });
        if (!preview)
          throw Error(
            "Could not render mind map preview. Your draft is retained.",
          );
        next = parseMindMap({ ...next, preview });
      }
      persist(next);
      await onSave(serial(next));
      if (!context?.retainRecoveryOnSave) clearRecovery();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  function nativeChange(change) {
    if (!change.operations?.some((op) => op.type !== "set_selection")) return;
    const next = {
      ...latest.current,
      elements: change.children ?? latest.current.elements,
      ...(change.viewport !== undefined ? { viewport: change.viewport } : {}),
      ...(change.theme !== undefined ? { theme: change.theme } : {}),
    };
    delete next.preview;
    update(next);
  }
  function openReference(link) {
    if (dirty) {
      setError("Save or discard your changes before opening a linked target.");
      return;
    }
    onClose();
    followReference(link, context);
  }
  return (
    <dialog
      ref={dialog}
      className="mindmap-editor"
      aria-label="Mind map editor"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          e.stopPropagation();
          save();
        }
      }}
    >
      <header className="mindmap-toolbar">
        <strong>Mind map · Drawnix</strong>
        <span>{dirty ? "Unsaved changes" : "Saved"}</span>
        <button onClick={() => setPanel(!panel)}>Mind map tools</button>
        <button
          onClick={() =>
            board.current && BoardTransforms.fitViewport(board.current)
          }
        >
          Fit map
        </button>
        <button
          onClick={() => save()}
          disabled={engineFailed || saving || !!recovery || !!imported}
        >
          Save mind map
        </button>
        <button onClick={close} disabled={saving}>
          Close mind map
        </button>
      </header>
      {recoveryWarning && (
        <p className="mindmap-error" role="alert">
          {recoveryWarning}
        </p>
      )}
      {error && (
        <p className="mindmap-error" role="alert">
          {error}
        </p>
      )}
      <div className="mindmap-body">
        <div
          className="mindmap-canvas"
          inert={recovery || imported || saving ? true : undefined}
        >
          <NativeBoardBoundary
            key={epoch}
            document={draft}
            onError={() => {
              board.current = null;
              setEngineFailed(true);
            }}
          >
            <Drawnix
              value={engineDocument.elements}
              viewport={engineDocument.viewport}
              theme={engineDocument.theme}
              afterInit={(b) => {
                board.current = b;
              }}
              onChange={nativeChange}
              onSelectionChange={() => {
                const id =
                  board.current && getSelectedElements(board.current)[0]?.id;
                if (id) setSelected(id);
              }}
              tutorial={false}
            />
          </NativeBoardBoundary>
        </div>
        {panel && (
          <aside className="mindmap-panel">
            <h3>Import and export</h3>
            <label>
              Import Drawnix
              <input
                type="file"
                accept=".drawnix,.json,application/json"
                onChange={async (e) => {
                  try {
                    const f = e.target.files[0];
                    if (!f) return;
                    if (f.size > 20000000) throw Error("Import exceeds 20 MB.");
                    const raw = JSON.parse(await f.text());
                    setImported(
                      parseMindMap(
                        raw.engine
                          ? raw
                          : {
                              version: 2,
                              engine: "drawnix",
                              elements: raw.elements,
                              ...(raw.viewport !== undefined
                                ? { viewport: raw.viewport }
                                : {}),
                              ...(raw.theme !== undefined
                                ? { theme: raw.theme }
                                : {}),
                              references: [],
                            },
                      ),
                    );
                  } catch (err) {
                    setError(err.message);
                  }
                  e.target.value = "";
                }}
              />
            </label>
            <label>
              Import Markdown
              <textarea
                aria-label="Import Markdown"
                value={markdown}
                onChange={(e) => setMarkdown(e.target.value)}
              />
            </label>
            <button
              onClick={() => {
                try {
                  if (!markdown.trim())
                    throw Error("Enter Markdown to import.");
                  setImported(
                    parseMindMap({
                      version: 2,
                      engine: "drawnix",
                      elements: [
                        {
                          ...parseMarkdownToDrawnix(markdown),
                          points: [[0, 0]],
                        },
                      ],
                      references: [],
                    }),
                  );
                } catch (e) {
                  setError(e.message);
                }
              }}
            >
              Review Markdown
            </button>
            <button
              onClick={() =>
                download(
                  JSON.stringify({
                    type: "drawnix",
                    elements: draft.elements,
                    viewport: draft.viewport,
                    theme: draft.theme,
                  }),
                  "mind-map.drawnix",
                )
              }
            >
              Export Drawnix
            </button>
            <button
              onClick={() => download(serial(draft), "mind-map-thread.json")}
            >
              Export with Thread references
            </button>
            <button
              onClick={async () => {
                try {
                  const png = await boardToImage(board.current, {
                    ratio: 1,
                    fillStyle: "#ffffff",
                  });
                  if (!png) throw Error("Add content before exporting PNG.");
                  download(png, "mind-map.png");
                } catch (e) {
                  setError(e.message);
                }
              }}
            >
              Export PNG
            </button>
            <p>
              {selected
                ? "New references attach to the selected element."
                : "Select an element to attach a reference, or add a map reference."}
            </p>
            <ReferencePanel
              references={draft.references}
              onChange={(references) =>
                update({ ...latest.current, references })
              }
              context={context}
              elementId={selected}
              disabled={engineFailed || saving || !!recovery || !!imported}
              onOpen={openReference}
            />
          </aside>
        )}
      </div>
      {recovery && (
        <div className="mindmap-overlay">
          <section role="alertdialog" aria-label="Recover mind map draft">
            <h3>Recover mind map draft?</h3>
            <p>An unfinished local draft is available.</p>
            <button
              onClick={() => {
                baseline.current = recovery.baseline;
                update(recovery.document, true);
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
              Discard recovered draft
            </button>
          </section>
        </div>
      )}
      {imported && (
        <div className="mindmap-overlay">
          <section role="alertdialog" aria-label="Review mind map import">
            <h3>Replace this map with imported content?</h3>
            <p>
              {imported.elements.length} native elements. Save commits this
              replacement.
            </p>
            <button onClick={() => setImported(null)}>Cancel import</button>
            <button
              onClick={() => {
                update(imported, true);
                setImported(null);
              }}
            >
              Replace with imported mind map
            </button>
          </section>
        </div>
      )}
      {discard && (
        <div className="mindmap-overlay">
          <section role="alertdialog" aria-label="Discard mind map changes">
            <h3>Discard unsaved changes?</h3>
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
          <section role="alertdialog" aria-label="Mind map changed elsewhere">
            <h3>Mind map changed elsewhere</h3>
            <p>The saved block changed while you were editing.</p>
            <button onClick={() => setConflict(false)}>Keep editing</button>
            <button
              onClick={() => download(serial(draft), "mind-map-draft.json")}
            >
              Download mind map draft
            </button>
            <button onClick={() => save(true)}>Replace with my mind map</button>
          </section>
        </div>
      )}
    </dialog>
  );
}
