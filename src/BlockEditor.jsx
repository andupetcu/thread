import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  GripVertical,
  Pencil,
  ArrowUp,
  ArrowDown,
  Copy,
  Trash2,
  Plus,
  Check,
  Undo2,
} from "lucide-react";
import {
  parseBlocks,
  replaceBlock,
  operateBlock,
  suggestions,
  ensureBlockIds,
  newBlockId,
  moveBlock,
  blockReference,
  blockEmbed,
} from "./editor-model";

import RichTextBlock from "./rich/RichTextBlock";
import { uploadAsset, assetMarkdown } from "./rich/model";
import { richEditingReason as richFallbackReason } from "./rich/extensions";
import "./rich/rich.css";

export default function BlockEditor({
  note,
  notes,
  tags,
  update,
  open,
  Render,
  positionCompletion,
}) {
  const [active, setActive] = useState(null),
    [menu, setMenu] = useState(null),
    [undo, setUndo] = useState(null),
    [completion, setCompletion] = useState(null),
    [choice, setChoice] = useState(0),
    [notice, setNotice] = useState(""),
    [mode, setMode] = useState("rich"),
    [dragging, setDragging] = useState(null);
  const input = useRef(),
    palette = useRef();
  const blocks = useMemo(() => {
    const list = parseBlocks(active?.base ?? note.body);
    if (active?.added) list.push(active.block);
    return list;
  }, [active?.base, active?.added, note.body]);
  const options = completion
    ? suggestions(completion.kind, completion.query, notes, tags, note.id)
    : [];
  useEffect(() => {
    if (active && note.body !== active.expected) {
      setActive(null);
      setCompletion(null);
      setNotice("Note changed in another panel. The block view has refreshed.");
    }
  }, [note.body]);
  useEffect(() => {
    if (active) {
      input.current?.focus();
      input.current?.setSelectionRange(
        active.draft.length,
        active.draft.length,
      );
    }
  }, [active?.index]);
  useEffect(() => {
    palette.current
      ?.querySelector(".active")
      ?.scrollIntoView({ block: "nearest" });
  }, [choice]);
  function begin(index) {
    setMenu(null);
    setCompletion(null);
    setNotice("");
    const base = ensureBlockIds(note.body);
    const block = parseBlocks(base)[index];
    setMode(
      richFallbackReason(block.source) &&
        !/^\s*(`{3,}|~{3,})thread-(?:diagram|mindmap)/.test(block.source)
        ? "source"
        : "rich",
    );
    setActive({ index, base, block, draft: block.source, expected: base });
    if (base !== note.body) update(note.id, { body: base });
  }
  function change(value, pos, detect = true) {
    const next = replaceBlock(active.base, active.block, value);
    setActive({ ...active, draft: value, expected: next });
    update(note.id, { body: next });
    if (detect) {
      const m = value.slice(0, pos).match(/(?:^|\s)([/@#])([^\n/@#]*)$/);
      setCompletion(
        m
          ? {
              kind: m[1],
              query: m[2],
              start: pos - m[2].length - 1,
              end: pos,
              position: input.current
                ? positionCompletion(input.current, pos)
                : {},
            }
          : null,
      );
      setChoice(0);
    }
  }
  function choose(option) {
    const value =
      active.draft.slice(0, completion.start) +
      option.value +
      active.draft.slice(completion.end);
    const pos = completion.start + option.value.length;
    change(value, pos, false);
    setCompletion(null);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(pos, pos);
    });
  }
  function finish() {
    const body = ensureBlockIds(note.body);
    if (active && body !== note.body) update(note.id, { body });
    setActive(null);
    setCompletion(null);
  }
  function action(index, type) {
    const before = note.body,
      next = operateBlock(before, index, type);
    setMenu(null);
    if (next !== before) {
      setUndo({ before, after: next });
      update(note.id, { body: next });
    }
  }
  function add() {
    const id = newBlockId();
    const base =
      note.body +
      (note.body.trim() ? "\n\n" : "") +
      `<!-- thread:block id=${id} -->\n\n`;
    setMode("rich");
    setActive({
      index: blocks.length,
      base,
      block: {
        type: "paragraph",
        id,
        source: "",
        start: base.length,
        end: base.length,
      },
      draft: "",
      expected: note.body,
      added: true,
    });
    setMenu(null);
    setCompletion(null);
    setNotice("");
  }
  async function copyReference(index, embed = false) {
    const body = ensureBlockIds(note.body),
      block = parseBlocks(body)[index];
    if (body !== note.body) update(note.id, { body });
    try {
      await navigator.clipboard.writeText(
        embed
          ? blockEmbed(note.id, block.id)
          : blockReference(
              note.id,
              block.id,
              `${note.title} · ${block.source.slice(0, 50)}`,
            ),
      );
      setNotice(embed ? "Block embed copied." : "Block reference copied.");
    } catch {
      setNotice(
        "Clipboard access was denied. Copy from Markdown source instead.",
      );
    }
    setMenu(null);
  }
  async function attachSource(files) {
    const snapshot = active;
    if (!snapshot) return;
    setNotice("Uploading attachment…");
    try {
      const assets = [];
      for (const file of files)
        assets.push(assetMarkdown(await uploadAsset(file)));
      // Leave an asynchronous upload independent of the currently edited block.
      const current = latestNote.current;
      const identified = parseBlocks(current.body).find(
        (b) => b.id === snapshot.block.id,
      );
      if (!identified && snapshot.added && current.body === snapshot.expected) {
        update(note.id, {
          body: replaceBlock(
            snapshot.base,
            snapshot.block,
            assets.join("\n\n"),
          ),
        });
        setActive(null);
        setNotice("Attachment added.");
        return;
      }
      if (!identified) {
        setNotice(
          "Attachment uploaded; the original block is no longer available.",
        );
        return;
      }
      const replacement = identified.source + "\n\n" + assets.join("\n\n");
      update(note.id, {
        body: replaceBlock(current.body, identified, replacement),
      });
      setActive(null);
      setNotice("Attachment added.");
    } catch (error) {
      setNotice(error.message);
    }
  }
  const latestNote = useRef(note);
  latestNote.current = note;
  const definitions = parseBlocks(note.body)
    .filter((b) => b.type === "definition" || b.type === "footnoteDefinition")
    .map((b) => b.source)
    .join("\n\n");
  return (
    <section className="block-editor" aria-label="Block editor">
      <div className="block-mode-bar">
        <span>
          <GripVertical size={14} />
          Blocks <small>Double-click a block to edit</small>
        </span>
        {undo && (
          <button
            aria-label="Undo block action"
            disabled={note.body !== undo.after}
            onClick={() => {
              update(note.id, { body: undo.before });
              setUndo(null);
              finish();
            }}
          >
            <Undo2 size={13} />
            Undo
          </button>
        )}
      </div>
      {notice && (
        <p className="block-notice" role="status">
          {notice}
        </p>
      )}
      {blocks.map((block, index) => (
        <div
          className={
            "document-block " + (active?.index === index ? "is-editing" : "")
          }
          key={block.id || index}
          id={block.id ? `block-${block.id}` : undefined}
          data-block-id={block.id}
          data-block-start={block.start}
          tabIndex={-1}
          onDragOver={(e) => {
            if (dragging !== null) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
            }
          }}
          onDrop={(e) => {
            if (dragging === null) return;
            e.preventDefault();
            const before = note.body,
              next = moveBlock(before, dragging, index);
            setDragging(null);
            if (before !== next) {
              setUndo({ before, after: next });
              update(note.id, { body: next });
            }
          }}
        >
          <div className="block-handle">
            <button
              aria-label={`Block ${index + 1} actions`}
              title="Drag to move or open block actions"
              draggable={!active}
              onDragStart={(e) => {
                setDragging(index);
                setMenu(null);
                e.dataTransfer.setData("text/thread-block", String(index));
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragEnd={() => setDragging(null)}
              disabled={!!active}
              onClick={() => setMenu(menu === index ? null : index)}
            >
              <GripVertical size={16} />
            </button>
            <button
              aria-label={`Edit block ${index + 1}`}
              title="Edit block"
              disabled={!!active}
              onClick={() => begin(index)}
            >
              <Pencil size={12} />
            </button>
          </div>
          {menu === index && (
            <div className="block-action-menu">
              <small>
                {block.type === "thematicBreak" ? "Divider" : block.type} block
              </small>
              <button onClick={() => begin(index)}>
                <Pencil size={13} />
                Edit block
              </button>
              <button
                aria-label="Move block up"
                disabled={index === 0}
                onClick={() => action(index, "up")}
              >
                <ArrowUp size={13} />
                Move up
              </button>
              <button
                aria-label="Move block down"
                disabled={index === blocks.length - 1}
                onClick={() => action(index, "down")}
              >
                <ArrowDown size={13} />
                Move down
              </button>
              <button
                aria-label="Duplicate block"
                onClick={() => action(index, "duplicate")}
              >
                <Copy size={13} />
                Duplicate
              </button>
              <button
                aria-label="Delete block"
                onClick={() => action(index, "delete")}
              >
                <Trash2 size={13} />
                Delete
              </button>
              <button onClick={() => copyReference(index)}>
                Copy block reference
              </button>
              <button onClick={() => copyReference(index, true)}>
                Copy block embed
              </button>
              <button onClick={() => setMenu(null)}>Close menu</button>
            </div>
          )}
          {active?.index === index ? (
            <div className="inline-block-editor">
              <div
                className="block-edit-modes"
                role="group"
                aria-label="Block editing mode"
              >
                <button
                  aria-pressed={mode === "rich"}
                  disabled={
                    !!richFallbackReason(active.draft) &&
                    !/^\s*(`{3,}|~{3,})thread-(?:diagram|mindmap)/.test(
                      active.draft,
                    )
                  }
                  onClick={() => {
                    setCompletion(null);
                    setMode("rich");
                  }}
                >
                  Formatted
                </button>
                <button
                  aria-pressed={mode === "source"}
                  onClick={() => setMode("source")}
                >
                  {/^\s*(`{3,}|~{3,})thread-(?:diagram|mindmap)/.test(
                    active.draft,
                  )
                    ? "Code edit"
                    : "Source"}
                </button>
              </div>
              {mode === "source" && richFallbackReason(active.draft) && (
                <small className="block-source-reason">
                  {richFallbackReason(active.draft)}
                </small>
              )}
              {mode === "rich" ? (
                /^\s*(`{3,}|~{3,})thread-(?:diagram|mindmap)/.test(
                  active.draft,
                ) ? (
                  <Render
                    note={{ ...note, body: active.draft }}
                    notes={notes}
                    open={open}
                    offset={active.block.start}
                  />
                ) : (
                  <RichTextBlock
                    key={`${note.id}-${active.index}`}
                    source={active.draft}
                    onChange={(value) => change(value, value.length, false)}
                    onDone={finish}
                    onSource={() => setMode("source")}
                    notes={notes}
                    tags={tags}
                    noteId={note.id}
                  />
                )
              ) : (
                <textarea
                  ref={input}
                  aria-label="Block Markdown"
                  onPaste={(e) => {
                    const files = Array.from(e.clipboardData.files);
                    if (files.length) {
                      e.preventDefault();
                      attachSource(files);
                    }
                  }}
                  onDragOver={(e) => {
                    if (e.dataTransfer.types.includes("Files"))
                      e.preventDefault();
                  }}
                  onDrop={(e) => {
                    const files = Array.from(e.dataTransfer.files);
                    if (files.length) {
                      e.preventDefault();
                      attachSource(files);
                    }
                  }}
                  onClick={() => setCompletion(null)}
                  value={active.draft}
                  spellCheck={false}
                  placeholder="Write a block, / for commands, @ for notes…"
                  onChange={(e) =>
                    change(e.target.value, e.target.selectionStart)
                  }
                  onKeyDown={(e) => {
                    if (
                      [
                        "ArrowLeft",
                        "ArrowRight",
                        "Home",
                        "End",
                        "PageUp",
                        "PageDown",
                      ].includes(e.key) ||
                      (e.shiftKey &&
                        ["ArrowUp", "ArrowDown"].includes(e.key)) ||
                      ((e.metaKey || e.ctrlKey) &&
                        ["a", "ArrowUp", "ArrowDown"].includes(e.key))
                    ) {
                      setCompletion(null);
                      return;
                    }
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                      e.preventDefault();
                      e.stopPropagation();
                      finish();
                      return;
                    }

                    if (completion && options.length) {
                      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                        e.preventDefault();
                        setChoice(
                          (p) =>
                            (p +
                              (e.key === "ArrowDown" ? 1 : -1) +
                              options.length) %
                            options.length,
                        );
                      }
                      if (e.key === "Enter" || e.key === "Tab") {
                        e.preventDefault();
                        choose(options[choice] || options[0]);
                        return;
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        e.stopPropagation();
                        setCompletion(null);
                        return;
                      }
                    }
                    if (
                      ((e.metaKey || e.ctrlKey) && e.key === "Enter") ||
                      e.key === "Escape"
                    ) {
                      e.preventDefault();
                      e.stopPropagation();
                      finish();
                    }
                  }}
                />
              )}
              <div className="inline-block-footer">
                <small>
                  {mode === "rich" ? "Formatted text" : "Markdown"} · changes
                  save as you type · paste or drop attachments
                </small>
                <button aria-label="Done editing block" onClick={finish}>
                  <Check size={14} />
                  Done <kbd>⌘ ↵</kbd>
                </button>
              </div>
              {completion && options.length > 0 && (
                <div
                  ref={palette}
                  className="autocomplete"
                  role="listbox"
                  style={completion.position}
                >
                  <div className="completion-heading">
                    {completion.kind === "/"
                      ? "Insert a block"
                      : completion.kind === "@"
                        ? "Link a note"
                        : "Add a tag"}
                  </div>
                  {options.map((o, i) => (
                    <button
                      key={o.label}
                      className={i === choice ? "active" : ""}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => choose(o)}
                    >
                      <span>{o.label}</span>
                      <small>{o.group}</small>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div
              className="block-content prose"
              onDoubleClick={(e) => {
                if (!active && !e.target.closest("button,a,input"))
                  begin(index);
              }}
            >
              {block.type === "definition" ||
              block.type === "footnoteDefinition" ? (
                <pre>
                  <code>{block.source}</code>
                </pre>
              ) : (
                <Render
                  note={{
                    ...note,
                    body:
                      block.source + (definitions ? "\n\n" + definitions : ""),
                  }}
                  notes={notes}
                  open={open}
                  offset={block.start}
                />
              )}
            </div>
          )}
        </div>
      ))}
      <button
        className="add-block"
        aria-label="Add block"
        disabled={!!active}
        onClick={add}
      >
        <Plus size={15} />
        Add block <span>/ commands · @ mentions · # tags</span>
      </button>
    </section>
  );
}
