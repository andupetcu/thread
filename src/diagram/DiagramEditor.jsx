import React, { useEffect, useRef, useState } from "react";
import { parseDiagram } from "./model.js";
import { drawioUrl, readDrawioMessage } from "./protocol.js";
import ReferencePanel, { followReference } from "../visual/ReferencePanel.jsx";
import EditorLibrary from "./EditorLibrary.jsx";
const stringify = (d) => JSON.stringify(parseDiagram(d));
function download(value, name, type = "application/xml") {
  const url = URL.createObjectURL(
    value instanceof Blob ? value : new Blob([value], { type }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function DiagramEditor({
  initial,
  context,
  recoveryKey,
  onSave,
  onClose,
}) {
  const frame = useRef(null),
    dialog = useRef(null),
    pending = useRef(new Map()),
    completed = useRef(false);
  const [draft, setDraft] = useState(() => parseDiagram(initial)),
    [baseline, setBaseline] = useState(() => stringify(initial));
  const [ready, setReady] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [panel, setPanel] = useState(false),
    [discard, setDiscard] = useState(false),
    [imported, setImported] = useState(null),
    [review, setReview] = useState(null);
  const key = recoveryKey ? `thread-diagram-draft:${recoveryKey}` : null;
  const [recovery, setRecovery] = useState(() => {
    try {
      const stored = key && localStorage.getItem(key);
      if (!stored) return null;
      const record = JSON.parse(stored),
        data = parseDiagram(record.diagram);
      return stringify(data) !== stringify(initial) ||
        context?.retainRecoveryOnSave
        ? { ...record, diagram: data }
        : null;
    } catch {
      return null;
    }
  });
  const state = useRef();
  state.current = {
    draft,
    baseline,
    initial,
    context,
    onSave,
    onClose,
    recovery,
    discard,
    imported,
    review,
    saving,
  };
  const dirty = stringify(draft) !== baseline;
  const conflict = stringify(initial) !== baseline;
  const blocked =
    saving || !!recovery || discard || !!imported || conflict || !!review;
  const post = (data) =>
    frame.current?.contentWindow?.postMessage(
      JSON.stringify(data),
      location.origin,
    );
  const change = (next) => setDraft(parseDiagram(next));
  const load = (data) => {
    change(data);
    post({
      action: "load",
      xml: data.xml,
      autosave: 1,
      title: "Thread diagram",
    });
  };
  const persist = () => {
    const s = state.current;
    if (
      !key ||
      completed.current ||
      s.recovery ||
      s.review ||
      stringify(s.draft) === s.baseline
    )
      return;
    try {
      localStorage.setItem(
        key,
        JSON.stringify({ baseline: s.baseline, diagram: s.draft }),
      );
    } catch {
      setError(
        "Browser draft storage is full. Save the diagram to keep your changes.",
      );
    }
  };
  useEffect(() => {
    dialog.current.showModal();
    return () => {
      for (const request of pending.current.values()) {
        clearTimeout(request.timer);
        request.reject(new Error("Editor closed."));
      }
      pending.current.clear();
    };
  }, []);
  useEffect(() => {
    const timer = setTimeout(persist, 250);
    const unload = (e) => {
      persist();
      if (stringify(state.current.draft) !== state.current.baseline) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("beforeunload", unload);
    };
  }, [draft, baseline, recovery, review]);
  useEffect(() => () => persist(), []);
  const requestExport = (format) =>
    new Promise((resolve, reject) => {
      // draw.io commits cell text on F2. Clicking the parent toolbar does not
      // commit the iframe's active contenteditable, so finish it before export.
      const cellEditor =
        frame.current?.contentDocument?.querySelector(".mxCellEditor");
      if (cellEditor?.isContentEditable) {
        const EditorKeyboardEvent = frame.current.contentWindow.KeyboardEvent;
        cellEditor.dispatchEvent(
          new EditorKeyboardEvent("keydown", {
            key: "F2",
            code: "F2",
            keyCode: 113,
            which: 113,
            bubbles: true,
            cancelable: true,
          }),
        );
      }
      const requestId = crypto.randomUUID();
      const timer = setTimeout(() => {
        pending.current.delete(requestId);
        reject(
          new Error(
            "The editor did not finish exporting. Your draft is retained; try again.",
          ),
        );
      }, 25000);
      pending.current.set(requestId, { resolve, reject, timer });
      post({
        action: "export",
        format,
        requestId,
        background: "#ffffff",
        scale: 1,
        border: 16,
      });
    });
  const save = async () => {
    const s = state.current;
    if (
      !ready ||
      s.saving ||
      s.recovery ||
      s.discard ||
      s.imported ||
      s.review ||
      stringify(s.initial) !== s.baseline
    )
      return;
    setSaving(true);
    setError("");
    try {
      const result = await requestExport("png");
      const next = parseDiagram({
        ...state.current.draft,
        xml: result.xml,
        preview: result.data,
      });
      setDraft(next);
      // Retain the exported source if persistence fails.
      if (key) {
        try {
          localStorage.setItem(
            key,
            JSON.stringify({ baseline: s.baseline, diagram: next }),
          );
        } catch {
          /* Disk save remains available when browser storage is full. */
        }
      }
      await state.current.onSave(JSON.stringify(next));
      completed.current = true;
      if (key && !state.current.context?.retainRecoveryOnSave)
        localStorage.removeItem(key);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  const close = () => {
    if (state.current.saving) return;
    if (dirty || review) setDiscard(true);
    else {
      completed.current = true;
      onClose();
    }
  };
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const timeout = setTimeout(
      () =>
        setError(
          "The local diagram editor is taking longer than expected to load. Check that npm run setup:drawio completed.",
        ),
      20000,
    );
    const message = async (event) => {
      const data = readDrawioMessage(
        event,
        frame.current?.contentWindow,
        location.origin,
      );
      if (!data) return;
      try {
        if (data.event === "configure")
          post({
            action: "configure",
            config: {
              compressXml: false,
              defaultLibraries: "general;basic;arrows2;flowchart",
              suppressNewWindows: true,
              enableCustomLibraries: false,
            },
          });
        else if (data.event === "init") {
          clearTimeout(timeout);
          setError("");
          post({
            action: "load",
            xml: state.current.draft.xml,
            autosave: 1,
            title: "Thread diagram",
          });
        } else if (data.event === "load") setReady(true);
        else if (
          data.event === "autosave" &&
          typeof data.xml === "string" &&
          !state.current.recovery &&
          !state.current.review
        ) {
          const { preview, ...source } = state.current.draft;
          setDraft(parseDiagram({ ...source, xml: data.xml }));
        } else if (data.event === "save") saveRef.current();
        else if (data.event === "exit") closeRef.current();
        else if (data.event === "export") {
          const source =
            typeof data.message === "string"
              ? JSON.parse(data.message)
              : data.message;
          const request = pending.current.get(source?.requestId);
          if (request) {
            clearTimeout(request.timer);
            pending.current.delete(source.requestId);
            data.error
              ? request.reject(new Error(data.error))
              : request.resolve(data);
          }
        } else if (data.event === "openLink" && typeof data.href === "string") {
          const ref = state.current.draft.references.find(
            (r) => data.href === `thread:${r.id}`,
          );
          if (ref) {
            const s = state.current;
            if (
              stringify(s.draft) !== s.baseline ||
              s.saving ||
              s.recovery ||
              s.review
            ) {
              setError(
                "Save or close this diagram before opening a reference.",
              );
              return;
            }
            completed.current = true;
            s.onClose();
            followReference(ref.link, s.context);
          } else if (/^https?:\/\//i.test(data.href))
            window.open(data.href, "_blank", "noopener,noreferrer");
        } else if (data.event === "error")
          setError(data.message || "The diagram editor reported an error.");
      } catch (e) {
        setError(e.message);
      }
    };
    window.addEventListener("message", message);
    return () => {
      clearTimeout(timeout);
      window.removeEventListener("message", message);
    };
  }, []);
  const exportFile = async (format) => {
    setSaving(true);
    setError("");
    try {
      const data = await requestExport(format);
      if (format === "xml") download(data.xml, "diagram.drawio");
      else {
        const response = await fetch(data.data);
        download(await response.blob(), `diagram.${format}`);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };
  const importFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      if (file.size > 8_000_000)
        throw new Error("Keep diagram imports below 8 MB.");
      const text = await file.text();
      setImported(
        parseDiagram(
          text.trim().startsWith("{")
            ? JSON.parse(text)
            : { version: 3, engine: "drawio", xml: text, references: [] },
        ),
      );
    } catch (error) {
      setError(error.message);
    }
  };
  return (
    <dialog
      ref={dialog}
      className="diagram-dialog native-diagram-dialog"
      aria-label="Edit diagram"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          save();
        }
      }}
    >
      <header className="native-editor-header">
        <div>
          <strong>Diagram</strong>
          <small>draw.io · {dirty ? "Unsaved changes" : "Saved source"}</small>
        </div>
        <button onClick={() => setPanel(!panel)} aria-expanded={panel}>
          References and library
        </button>
        <button disabled={!ready || blocked} onClick={save}>
          Save diagram
        </button>
        <button disabled={saving} onClick={close}>
          Close
        </button>
      </header>
      {error && (
        <p className="native-editor-error" role="alert">
          {error}
        </p>
      )}
      <div className="native-editor-body">
        <div className="native-canvas-wrap">
          <iframe
            ref={frame}
            title="draw.io diagram editor"
            src={drawioUrl()}
            className="native-drawio-frame"
            sandbox="allow-scripts allow-same-origin allow-downloads"
          />
          {(!ready || blocked) && (
            <div className="native-canvas-shield">
              {!ready ? "Loading local editor…" : saving ? "Saving…" : ""}
            </div>
          )}
        </div>
        {panel && (
          <aside className="native-editor-sidebar">
            <ReferencePanel
              references={draft.references}
              context={context}
              onOpen={(link) => {
                if (dirty || blocked) {
                  setError(
                    "Save or close this diagram before opening a reference.",
                  );
                  return;
                }
                completed.current = true;
                onClose();
                followReference(link, context);
              }}
              disabled={blocked}
              onChange={(references) => change({ ...draft, references })}
            />
            <p className="native-help">
              References stay with this diagram. To link a shape, use its
              draw.io link field with a reference address below.
            </p>
            {draft.references.map((r) => (
              <label className="native-ref-address" key={r.id}>
                {r.label}
                <input
                  readOnly
                  aria-label={`Reference address ${r.label}`}
                  value={`thread:${r.id}`}
                  onFocus={(e) => e.target.select()}
                />
              </label>
            ))}
            <section className="native-file-tools">
              <h3>Files</h3>
              <button
                disabled={!ready || blocked}
                onClick={() => exportFile("xml")}
              >
                Export .drawio
              </button>
              <button
                disabled={!ready || blocked}
                onClick={() => exportFile("svg")}
              >
                Export SVG
              </button>
              <button
                disabled={!ready || blocked}
                onClick={() => exportFile("png")}
              >
                Export PNG
              </button>
              <label>
                Import diagram
                <input
                  type="file"
                  accept=".drawio,.xml,.json"
                  disabled={blocked}
                  onChange={importFile}
                />
              </label>
            </section>
            <EditorLibrary
              context={context}
              draft={draft}
              disabled={blocked || !ready}
              dirty={dirty}
              getDocument={async () => {
                const result = await requestExport("png");
                return parseDiagram({
                  ...state.current.draft,
                  xml: result.xml,
                  preview: result.data,
                });
              }}
              onLoad={setImported}
              onReview={(proposal) => {
                setReview(proposal);
                load(parseDiagram(proposal.diagram));
              }}
            />
          </aside>
        )}
      </div>
      {recovery && (
        <div
          className="native-decision"
          role="alertdialog"
          aria-label="Recover diagram draft"
        >
          <h2>Recover unfinished diagram?</h2>
          <p>
            A browser draft is available. Recover it or continue with the saved
            note.
          </p>
          <button
            onClick={() => {
              const old = recovery;
              setRecovery(null);
              setBaseline(old.baseline || baseline);
              load(old.diagram);
            }}
          >
            Recover draft
          </button>
          <button
            onClick={() => {
              if (key) localStorage.removeItem(key);
              setRecovery(null);
            }}
          >
            Use saved diagram
          </button>
        </div>
      )}
      {conflict && !recovery && (
        <div
          className="native-decision"
          role="alertdialog"
          aria-label="Diagram conflict"
        >
          <h2>The saved diagram changed</h2>
          <p>
            Your draft is retained. Choose which source to continue editing
            before saving.
          </p>
          <button
            onClick={() => {
              setBaseline(stringify(initial));
              load(parseDiagram(initial));
              if (key) localStorage.removeItem(key);
            }}
          >
            Use latest saved
          </button>
          <button onClick={() => setBaseline(stringify(initial))}>
            Keep my draft
          </button>
        </div>
      )}
      {imported && (
        <div
          className="native-decision"
          role="alertdialog"
          aria-label="Review diagram import"
        >
          <h2>Replace this diagram?</h2>
          <p>
            The imported native source will replace the current canvas when you
            continue. Save diagram persists it.
          </p>
          <details>
            <summary>Imported XML</summary>
            <pre>{imported.xml}</pre>
          </details>
          <button
            onClick={() => {
              load(imported);
              setImported(null);
            }}
          >
            Replace canvas
          </button>
          <button onClick={() => setImported(null)}>Cancel import</button>
        </div>
      )}
      {review && (
        <div className="native-proposal-bar">
          <strong>Reviewing agent proposal: {review.summary}</strong>
          <button
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await context?.beforeProposalApply?.();
                const { api } = await import("../storage/api.js");
                await api(`/diagram-proposals/${review.id}/apply`, {
                  method: "POST",
                  body: { expectedRevision: context.revision },
                });
                await context?.onProposalApplied?.();
                completed.current = true;
                onClose();
              } catch (e) {
                setError(e.message);
              } finally {
                setSaving(false);
              }
            }}
          >
            Apply reviewed proposal
          </button>
          <button
            disabled={saving}
            onClick={() => {
              setReview(null);
              load(parseDiagram(initial));
            }}
          >
            Finish review
          </button>
        </div>
      )}
      {discard && (
        <div
          className="native-decision"
          role="alertdialog"
          aria-label="Discard diagram changes"
        >
          <h2>Discard unsaved changes?</h2>
          <button
            onClick={() => {
              completed.current = true;
              if (key) localStorage.removeItem(key);
              onClose();
            }}
          >
            Discard changes
          </button>
          <button onClick={() => setDiscard(false)}>Keep editing</button>
        </div>
      )}
    </dialog>
  );
}
