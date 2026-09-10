import React, { useState } from "react";
import { parseReference } from "./model.js";
import { parseBlocks } from "../editor-model.js";
export function followReference(link, context) {
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
export default function ReferencePanel({
  references = [],
  onChange,
  context,
  elementId,
  disabled = false,
  onOpen,
}) {
  const [kind, setKind] = useState("note"),
    [target, setTarget] = useState(""),
    [block, setBlock] = useState(""),
    [error, setError] = useState("");
  const notes = context?.notes || [],
    bundles = context?.bundles || [];
  const note = notes.find((n) => n.id === target);
  const add = () => {
    try {
      const link =
        kind === "bundle"
          ? { kind, bundleId: target }
          : kind === "url"
            ? { kind, url: target }
            : {
                kind:
                  kind === "block" ? "block" : note?.okf ? "concept" : "note",
                noteId: target,
                ...(kind === "block" ? { blockId: block } : {}),
              };
      const label =
        kind === "bundle"
          ? bundles.find((b) => b.id === target)?.name
          : kind === "url"
            ? target
            : note?.title;
      const ref = parseReference({
        id: crypto.randomUUID(),
        label: label || target,
        link,
        ...(elementId ? { elementId } : {}),
      });
      onChange([...references, ref]);
      setError("");
      setTarget("");
      setBlock("");
    } catch (e) {
      setError(e.message);
    }
  };
  return (
    <section className="native-references" aria-label="Workspace references">
      <h3>Workspace references</h3>
      {references.map((ref) => (
        <div className="native-reference" key={ref.id}>
          <button
            type="button"
            onClick={() =>
              onOpen ? onOpen(ref.link) : followReference(ref.link, context)
            }
          >
            {ref.label} ↗
          </button>
          {onChange && (
            <button
              type="button"
              disabled={disabled}
              aria-label={`Remove reference ${ref.label}`}
              onClick={() =>
                onChange(references.filter((r) => r.id !== ref.id))
              }
            >
              ×
            </button>
          )}
        </div>
      ))}
      {onChange && (
        <fieldset disabled={disabled}>
          <label>
            Reference type
            <select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                setTarget("");
                setBlock("");
              }}
            >
              <option value="note">Note or OKF document</option>
              <option value="block">Note block</option>
              <option value="bundle">OKF bundle</option>
              <option value="url">Web link</option>
            </select>
          </label>
          <label>
            Reference target
            {kind === "url" ? (
              <input
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="https://…"
              />
            ) : (
              <select
                value={target}
                onChange={(e) => {
                  setTarget(e.target.value);
                  setBlock("");
                }}
              >
                <option value="">Choose…</option>
                {(kind === "bundle" ? bundles : notes).map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.title || n.name}
                  </option>
                ))}
              </select>
            )}
          </label>
          {kind === "block" && (
            <label>
              Reference block
              <select value={block} onChange={(e) => setBlock(e.target.value)}>
                <option value="">Choose block…</option>
                {parseBlocks(note?.body || "")
                  .filter((b) => b.id)
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.source.replace(/\s+/g, " ").slice(0, 70) || b.id}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <button
            type="button"
            disabled={!target || (kind === "block" && !block)}
            onClick={add}
          >
            Add reference
          </button>
        </fieldset>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
