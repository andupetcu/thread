import React, { useEffect, useState } from "react";
import { parseDiagram, diagramToPortableSvg, diagramToPng } from "./model.js";
import {
  selectedSubgraph,
  insertDiagram,
  diagramAssetKind,
} from "./editor-operations.js";
import { uploadAsset } from "../rich/model.js";
function PortablePreview({ diagram, label, resolveAsset }) {
  const [svg, setSvg] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setSvg(null);
    setError("");
    diagramToPortableSvg(diagram, { resolveAsset })
      .then((value) => {
        if (active) setSvg(value);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [diagram, resolveAsset]);
  return error ? (
    <p role="alert">
      {label}: {error}
    </p>
  ) : svg ? (
    <img
      className="diagram-preview"
      alt={label}
      src={`data:image/svg+xml,${encodeURIComponent(svg)}`}
    />
  ) : (
    <p role="status">Loading {label.toLowerCase()}…</p>
  );
}
export async function diagramRequest(url, body) {
  const r = await fetch(
    url,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Thread-Request": "1",
          },
          body: JSON.stringify(body),
        },
  );
  const data = await r.json();
  if (!r.ok) throw Error(data.error || `Request failed (${r.status})`);
  return data;
}
export function download(content, name, type) {
  const url =
    typeof content === "string" && content.startsWith("data:")
      ? content
      : URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function EditorLibrary({
  draft,
  change,
  context,
  setError,
  dirty,
  onClose,
  pendingUploads = 0,
  onUploadPending = () => {},
}) {
  const [templates, setTemplates] = useState([]),
    [name, setName] = useState(""),
    [imported, setImported] = useState(null),
    [proposals, setProposals] = useState([]),
    [review, setReview] = useState(null),
    [background, setBackground] = useState("#ffffff"),
    [scale, setScale] = useState(2);
  const run = async (fn) => {
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    }
  };
  useEffect(() => {
    let active = true;
    diagramRequest("/api/diagram-templates")
      .then((d) => {
        if (active) setTemplates(d.templates);
      })
      .catch(() => {});
    if (context?.noteId)
      diagramRequest(
        `/api/diagram-proposals?noteId=${encodeURIComponent(context.noteId)}`,
      )
        .then((d) => {
          if (active)
            setProposals(
              d.proposals.filter(
                (p) => p.diagramIndex === context.diagramIndex,
              ),
            );
        })
        .catch((e) => setError(e.message));
    return () => {
      active = false;
    };
  }, [context?.noteId, context?.diagramIndex]);
  return (
    <>
      <details>
        <summary>Templates, files and exports</summary>
        <label>
          Shared template
          <select
            aria-label="Shared template"
            value=""
            onChange={(e) => {
              const t = templates.find((t) => t.id === e.target.value);
              if (t) change(insertDiagram(draft, t.diagram));
            }}
          >
            <option value="">Choose saved template…</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Template name
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <button
          disabled={!name.trim() || !draft.nodes.some((n) => n.selected)}
          onClick={() =>
            run(async () => {
              const d = await diagramRequest("/api/diagram-templates", {
                name,
                diagram: parseDiagram(selectedSubgraph(draft)),
              });
              setTemplates((t) => [...t, d.template || d]);
              setName("");
            })
          }
        >
          Save selection as template
        </button>
        <label>
          Upload image or file
          <input
            type="file"
            aria-label="Upload diagram asset"
            onChange={(e) => {
              const file = e.target.files[0];
              if (file)
                run(async () => {
                  onUploadPending(1);
                  try {
                    const image = diagramAssetKind(file) === "image";
                    const a = await uploadAsset(file);
                    change((current) =>
                      insertDiagram(current, {
                        version: 2,
                        nodes: [
                          {
                            id: "asset",
                            type: "diagramShape",
                            position: { x: 0, y: 0 },
                            width: 220,
                            height: 140,
                            data: {
                              shape: image ? "image" : "document",
                              label: image ? "" : file.name,
                              color: "#ffffff",
                              ...(image
                                ? { image: { url: a.url, alt: file.name } }
                                : {
                                    link: {
                                      kind: "asset",
                                      url: a.url,
                                      name: file.name,
                                    },
                                  }),
                            },
                          },
                        ],
                        edges: [],
                      }),
                    );
                  } finally {
                    onUploadPending(-1);
                  }
                });
              e.target.value = "";
            }}
          />
        </label>
        <label>
          Import JSON
          <input
            type="file"
            accept=".json,application/json"
            aria-label="Import diagram JSON"
            onChange={(e) => {
              const f = e.target.files[0];
              if (f)
                run(async () => {
                  if (f.size > 1000000) throw Error("Diagram exceeds 1 MB");
                  setImported(parseDiagram(await f.text()));
                });
              e.target.value = "";
            }}
          />
        </label>
        {imported && (
          <div role="group" aria-label="Review imported diagram">
            <p>
              {imported.nodes.length} shapes · {imported.edges.length}{" "}
              connectors
            </p>
            <PortablePreview
              diagram={imported}
              label="Imported diagram preview"
              resolveAsset={context?.resolveAsset}
            />
            <button
              onClick={() => {
                change(insertDiagram(draft, imported));
                setImported(null);
              }}
            >
              Insert imported diagram
            </button>
            <button
              onClick={() => {
                if (
                  window.confirm(
                    "Replace the current canvas? Undo will restore it.",
                  )
                ) {
                  change(imported);
                  setImported(null);
                }
              }}
            >
              Replace with imported diagram
            </button>
            <button onClick={() => setImported(null)}>Cancel import</button>
          </div>
        )}
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
            {[1, 2, 3, 4].map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </label>
        {["JSON", "SVG", "PNG"].map((format) => (
          <button
            key={format}
            onClick={() =>
              run(async () =>
                download(
                  format === "JSON"
                    ? JSON.stringify(parseDiagram(draft), null, 2)
                    : format === "SVG"
                      ? await diagramToPortableSvg(draft, {
                          background,
                          resolveAsset: context?.resolveAsset,
                        })
                      : await diagramToPng(draft, {
                          background,
                          scale,
                          resolveAsset: context?.resolveAsset,
                        }),
                  `diagram.${format.toLowerCase()}`,
                  format === "SVG" ? "image/svg+xml" : "application/json",
                ),
              )
            }
          >
            Export {format}
          </button>
        ))}
      </details>
      {!!proposals.length && (
        <details open>
          <summary>Agent proposals ({proposals.length})</summary>
          {proposals.map((p) => (
            <button key={p.id} onClick={() => setReview(p)}>
              Review: {p.summary || "Diagram update"}
            </button>
          ))}
        </details>
      )}
      {review && (
        <div className="diagram-discard-backdrop">
          <section
            className="diagram-discard diagram-proposal"
            role="alertdialog"
            aria-label="Review diagram proposal"
          >
            <h3>Review diagram proposal</h3>
            <p>{review.summary}</p>
            <div className="diagram-proposal-comparison">
              {[
                [draft, "Current draft"],
                [review.diagram, "Proposed diagram"],
              ].map(([d, label]) => (
                <figure key={label}>
                  <figcaption>{label}</figcaption>
                  <PortablePreview
                    diagram={d}
                    label={label}
                    resolveAsset={context?.resolveAsset}
                  />
                </figure>
              ))}
            </div>
            {dirty && (
              <p>
                Save or discard your local changes before applying this
                proposal. Your draft will be kept.
              </p>
            )}
            <button onClick={() => setReview(null)}>Keep editing</button>
            <button
              onClick={() =>
                run(async () => {
                  await diagramRequest(
                    `/api/diagram-proposals/${review.id}/reject`,
                    {},
                  );
                  setProposals((p) => p.filter((v) => v.id !== review.id));
                  setReview(null);
                })
              }
            >
              Reject proposal
            </button>
            <button
              disabled={
                dirty || !!pendingUploads || !context?.onProposalApplied
              }
              onClick={() =>
                run(async () => {
                  await context.beforeProposalApply?.();
                  const { note } = await diagramRequest(
                    `/api/diagram-proposals/${review.id}/apply`,
                    { expectedRevision: context.revision },
                  );
                  await context.onProposalApplied(note);
                  onClose();
                })
              }
            >
              Apply reviewed proposal
            </button>
          </section>
        </div>
      )}
    </>
  );
}
export function LinkInspector({ selected, updateNode, context, openLink }) {
  const link = selected.data.link;
  return (
    <details>
      <summary>Link shape</summary>
      <label>
        Note or OKF note
        <select
          aria-label="Link to note"
          value={link?.noteId || ""}
          onChange={(e) =>
            updateNode({
              link: e.target.value
                ? { kind: "note", noteId: e.target.value }
                : undefined,
            })
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
              updateNode({
                link: e.target.value
                  ? {
                      kind: "block",
                      noteId: link.noteId,
                      blockId: e.target.value,
                    }
                  : { kind: "note", noteId: link.noteId },
              })
            }
          />
        </label>
      )}
      <label>
        URL
        <input
          aria-label="Shape URL"
          type="url"
          defaultValue={link?.kind === "url" ? link.url : ""}
          key={selected.id}
          onBlur={(e) => {
            if (e.target.value)
              updateNode({ link: { kind: "url", url: e.target.value } });
          }}
        />
      </label>
      {link && (
        <>
          <button onClick={() => openLink(link)}>Open linked target</button>
          <button onClick={() => updateNode({ link: undefined })}>
            Remove link
          </button>
        </>
      )}
    </details>
  );
}
