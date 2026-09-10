import React, { useEffect, useState } from "react";
import { api } from "../storage/api.js";
export default function EditorLibrary({
  context,
  draft,
  disabled,
  dirty,
  getDocument,
  onLoad,
  onReview,
}) {
  const [templates, setTemplates] = useState([]),
    [proposals, setProposals] = useState([]),
    [name, setName] = useState(""),
    [selected, setSelected] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const refresh = async () => {
    const [library, pending] = await Promise.all([
      api("/diagram-templates"),
      context?.noteId
        ? api(`/diagram-proposals?noteId=${encodeURIComponent(context.noteId)}`)
        : Promise.resolve({ proposals: [] }),
    ]);
    setTemplates(library.templates || []);
    setProposals(
      (pending.proposals || []).filter(
        (p) => p.diagramIndex === context?.diagramIndex,
      ),
    );
  };
  useEffect(() => {
    let active = true;
    refresh().catch((e) => {
      if (active) setError(e.message);
    });
    return () => {
      active = false;
    };
  }, [context?.noteId]);
  const run = async (fn) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="native-library">
      <h3>Shared templates</h3>
      <label>
        Template name
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <button
        disabled={disabled || busy || !name.trim()}
        onClick={() =>
          run(async () => {
            const diagram = await getDocument();
            await api("/diagram-templates", {
              method: "POST",
              body: { name, diagram },
            });
            setName("");
            await refresh();
          })
        }
      >
        Save template
      </button>
      <label>
        Saved template
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="">Choose…</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <button
        disabled={disabled || busy || !selected}
        onClick={() => onLoad(templates.find((t) => t.id === selected).diagram)}
      >
        Load template
      </button>
      <h3>Agent proposals</h3>
      {!proposals.length && <p>No pending proposals.</p>}
      {dirty && (
        <p>Save or discard your changes before reviewing a proposal.</p>
      )}
      {proposals.map((p) => (
        <div key={p.id}>
          <p>{p.summary || "Diagram update"}</p>
          <button
            disabled={disabled || busy || dirty}
            onClick={() => onReview(p)}
          >
            Review proposal
          </button>
          <button
            disabled={disabled || busy}
            onClick={() =>
              run(async () => {
                await api(`/diagram-proposals/${p.id}/reject`, {
                  method: "POST",
                  body: {},
                });
                await refresh();
              })
            }
          >
            Reject proposal
          </button>
        </div>
      ))}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
