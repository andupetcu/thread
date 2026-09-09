import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, GitCompare, Link2, X } from "lucide-react";
import { alignedDiff } from "./diff-model.js";
import "./workspace-tools.css";

const ROW_HEIGHT = 26;
export default function DiffView({ notes, onClose }) {
  const compared = notes.filter(Boolean).slice(0, 3);
  const bodies = compared.map((n) => n.body || "");
  const diff = useMemo(
    () => alignedDiff(bodies),
    [bodies[0], bodies[1], bodies[2]],
  );
  const [position, setPosition] = useState(-1),
    [scrollTop, setScrollTop] = useState(0),
    [sync, setSync] = useState(true),
    [height, setHeight] = useState(400);
  const panels = useRef([]);
  useEffect(() => {
    setPosition(-1);
  }, [diff]);
  useEffect(() => {
    if (!panels.current[0]) return;
    const observer = new ResizeObserver(([entry]) =>
      setHeight(entry.contentRect.height),
    );
    observer.observe(panels.current[0]);
    return () => observer.disconnect();
  }, [compared.length]);
  function synchronize(source) {
    setScrollTop(source.scrollTop);
    if (!sync) return;
    for (const panel of panels.current)
      if (panel && panel !== source) {
        if (panel.scrollTop !== source.scrollTop)
          panel.scrollTop = source.scrollTop;
        if (panel.scrollLeft !== source.scrollLeft)
          panel.scrollLeft = source.scrollLeft;
      }
  }
  function navigate(direction) {
    if (!diff.changeRows.length) return;
    const next =
      position < 0
        ? direction > 0
          ? 0
          : diff.changeRows.length - 1
        : (position + direction + diff.changeRows.length) %
          diff.changeRows.length;
    setPosition(next);
    const top = Math.max(
      0,
      diff.changeRows[next] * ROW_HEIGHT - ROW_HEIGHT * 3,
    );
    for (const panel of panels.current) if (panel) panel.scrollTop = top;
    setScrollTop(top);
  }
  const from = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 10),
    to = Math.min(diff.rows.length, from + Math.ceil(height / ROW_HEIGHT) + 30);
  const selectedRow = position >= 0 ? diff.changeRows[position] : -1;
  return (
    <section className="wt-diff-view" aria-label="Note comparison">
      <header className="wt-diff-heading">
        <div>
          <GitCompare size={17} />
          <strong>Compare notes</strong>
          <small>First note is the baseline</small>
        </div>
        <div className="wt-diff-actions">
          <button
            aria-label="Previous change"
            disabled={!diff.changeRows.length}
            onClick={() => navigate(-1)}
          >
            <ChevronUp size={16} />
          </button>
          <span aria-label="Change position" role="status">
            {diff.changeRows.length
              ? `${position + 1} of ${diff.changeRows.length} changes`
              : "No differences"}
          </span>
          <button
            aria-label="Next change"
            disabled={!diff.changeRows.length}
            onClick={() => navigate(1)}
          >
            <ChevronDown size={16} />
          </button>
          <button
            aria-label="Synchronize comparison scrolling"
            aria-pressed={sync}
            className={sync ? "selected" : ""}
            onClick={() => {
              if (!sync && panels.current[0]) {
                const first = panels.current[0];
                for (const panel of panels.current)
                  if (panel) {
                    panel.scrollTop = first.scrollTop;
                    panel.scrollLeft = first.scrollLeft;
                  }
                setScrollTop(first.scrollTop);
              }
              setSync((v) => !v);
            }}
            title="Synchronize scrolling"
          >
            <Link2 size={15} />
          </button>
          {onClose && (
            <button aria-label="Close comparison" onClick={onClose}>
              <X size={16} />
            </button>
          )}
        </div>
      </header>
      {compared.length < 2 ? (
        <div className="wt-empty">
          <p>Open two or three notes to compare their content.</p>
        </div>
      ) : (
        <div className="wt-diff-columns">
          {compared.map((note, column) => (
            <div className="wt-diff-column" key={`${column}-${note.id}`}>
              <div className="wt-diff-title">
                <span>
                  {column === 0 ? "Baseline" : `Version ${column + 1}`}
                </span>
                <strong>{note.title || "Untitled note"}</strong>
              </div>
              <div
                className="wt-diff-scroll"
                ref={(el) => (panels.current[column] = el)}
                tabIndex={0}
                aria-label={`Comparison ${note.title || "Untitled note"}`}
                onScroll={(e) => synchronize(e.currentTarget)}
              >
                <div
                  className="wt-diff-lines"
                  style={{ height: diff.rows.length * ROW_HEIGHT }}
                >
                  {(sync ? diff.rows.slice(from, to) : diff.rows).map(
                    (row, offset) => {
                      const index = sync ? from + offset : offset,
                        cell = row.cells[column];
                      return (
                        <div
                          className={`wt-diff-row ${cell.kind} ${index === selectedRow ? "current-change" : ""}`}
                          data-diff-row={index}
                          key={index}
                          style={{
                            position: "absolute",
                            top: index * ROW_HEIGHT,
                            height: ROW_HEIGHT,
                          }}
                        >
                          <span className="wt-line-number" aria-hidden="true">
                            {cell.lineNumber ?? ""}
                          </span>
                          <span className="wt-line-sign" aria-hidden="true">
                            {cell.kind === "added"
                              ? "+"
                              : cell.kind === "removed"
                                ? "−"
                                : ""}
                          </span>
                          <code>
                            {cell.text === null ? (
                              <span
                                className="wt-missing"
                                aria-label="No corresponding line"
                              >
                                {" "}
                              </span>
                            ) : (
                              cell.parts.map((part, i) =>
                                part.changed ? (
                                  <mark key={i}>{part.text}</mark>
                                ) : (
                                  <React.Fragment key={i}>
                                    {part.text}
                                  </React.Fragment>
                                ),
                              )
                            )}
                            {cell.text === "" && (
                              <span
                                className="wt-empty-line"
                                title="Blank line"
                              >
                                ↵
                              </span>
                            )}
                          </code>
                        </div>
                      );
                    },
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <footer className="wt-diff-footer">
        <span>
          <i className="removed" />
          Removed or changed in baseline
        </span>
        <span>
          <i className="added" />
          Added or changed in comparison
        </span>
        <span>{diff.rows.length} aligned lines</span>
      </footer>
    </section>
  );
}
