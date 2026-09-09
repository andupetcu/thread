import React, { useMemo, useState } from "react";
import {
  ListTree,
  Link2,
  ArrowUpRight,
  Columns2,
  X,
  FileText,
} from "lucide-react";
import { outline, referenceExcerpt } from "./editor-model";
import { metadata } from "./model";
export default function ContextPanel({
  note,
  notes,
  onClose,
  jump,
  open,
  openBeside,
}) {
  const [tab, setTab] = useState("outline");
  const headings = useMemo(() => outline(note.body), [note.body]);
  const incoming = notes.filter((n) =>
    metadata(n.body).links.includes(note.id),
  );
  const outgoing = metadata(note.body)
    .links.map((id) => notes.find((n) => n.id === id))
    .filter(Boolean);
  function card(n, direction) {
    return (
      <div className="reference-card" key={n.id}>
        <div>
          <button onClick={() => open(n.id)}>
            <FileText size={13} />
            {n.title || "Untitled note"}
          </button>
          <button
            aria-label={`Open ${n.title} beside`}
            title="Open beside"
            onClick={() => openBeside(n.id)}
          >
            <Columns2 size={13} />
          </button>
        </div>
        <p>
          {referenceExcerpt(
            direction === "in" ? n.body : note.body,
            direction === "in" ? note.id : n.id,
          )}
        </p>
      </div>
    );
  }
  return (
    <aside className="context-panel" aria-label="Document context">
      <div className="context-header">
        <span>Document context</span>
        <button aria-label="Close document context" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      <div className="context-document">
        <FileText size={15} />
        <strong>{note.title || "Untitled note"}</strong>
      </div>
      <div className="context-tabs">
        <button
          className={tab === "outline" ? "selected" : ""}
          onClick={() => setTab("outline")}
        >
          <ListTree size={14} />
          Outline
        </button>
        <button
          aria-label="References"
          className={tab === "references" ? "selected" : ""}
          onClick={() => setTab("references")}
        >
          <Link2 size={14} />
          References <span>{incoming.length + outgoing.length}</span>
        </button>
      </div>
      <div className="context-scroll">
        {tab === "outline" ? (
          <>
            <p className="context-hint">Jump to a section</p>
            {headings.length ? (
              <nav aria-label="Document outline">
                {headings.map((h) => (
                  <button
                    key={h.start}
                    style={{ paddingLeft: 10 + (h.depth - 1) * 10 }}
                    aria-label={"Go to " + h.title}
                    onClick={() => jump(h)}
                  >
                    <span className="heading-depth">H{h.depth}</span>
                    <span>{h.title}</span>
                  </button>
                ))}
              </nav>
            ) : (
              <div className="context-empty">
                <ListTree size={24} />
                <p>Give your ideas some structure.</p>
                <small>
                  Add headings with /Heading or Markdown to build an outline.
                </small>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="reference-heading">
              <Link2 size={13} />
              Backlinks <span>{incoming.length}</span>
            </div>
            {incoming.length ? (
              incoming.map((n) => card(n, "in"))
            ) : (
              <p className="context-hint">
                Notes that mention this page will appear here.
              </p>
            )}
            <div className="reference-heading">
              <ArrowUpRight size={13} />
              Outgoing links <span>{outgoing.length}</span>
            </div>
            {outgoing.length ? (
              outgoing.map((n) => card(n, "out"))
            ) : (
              <p className="context-hint">
                Use @ to connect this note to another page.
              </p>
            )}
          </>
        )}
      </div>
      <div className="context-summary">
        <span>{headings.length} headings</span>
        <span>{incoming.length} backlinks</span>
        <span>{outgoing.length} links</span>
      </div>
    </aside>
  );
}
