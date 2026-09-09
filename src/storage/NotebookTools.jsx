import React, { useState } from "react";
export default function NotebookTools({ workspace, value, onChange, onError }) {
  const [editing, setEditing] = useState(null),
    [name, setName] = useState("");
  async function save(e) {
    e.preventDefault();
    try {
      const items = [...workspace.notebooks];
      if (editing === "new") {
        const id = crypto.randomUUID();
        items.push({ id, name: name.trim() });
        await workspace.saveNotebooks(items);
        onChange(id);
      } else {
        await workspace.saveNotebooks(
          items.map((n) =>
            n.id === editing ? { ...n, name: name.trim() } : n,
          ),
        );
      }
      setEditing(null);
    } catch (e) {
      onError(e.message);
    }
  }
  return (
    <>
      <div className="notebook-tools">
        <select
          aria-label="Notebook"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">All notebooks</option>
          {workspace.notebooks.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name}
            </option>
          ))}
        </select>
        <button
          aria-label="New notebook"
          onClick={() => {
            setEditing("new");
            setName("");
          }}
        >
          +
        </button>
        {value && (
          <button
            aria-label="Rename notebook"
            onClick={() => {
              setEditing(value);
              setName(
                workspace.notebooks.find((n) => n.id === value)?.name || "",
              );
            }}
          >
            Rename
          </button>
        )}
      </div>
      {editing && (
        <form className="notebook-tools" onSubmit={save}>
          <input
            aria-label="Notebook name"
            value={name}
            maxLength={120}
            required
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
          <button>Save</button>
          <button type="button" onClick={() => setEditing(null)}>
            ×
          </button>
        </form>
      )}
    </>
  );
}
export function NoteLocation({ note, notes, notebooks, update }) {
  const children = new Set([note.id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const n of notes)
      if (n.parentId && children.has(n.parentId) && !children.has(n.id)) {
        children.add(n.id);
        changed = true;
      }
  }
  return (
    <div className="note-location">
      <select
        aria-label="Move to notebook"
        value={note.notebookId || ""}
        onChange={(e) =>
          update(note.id, {
            notebookId: e.target.value || null,
            parentId: null,
          })
        }
      >
        <option value="">Loose notes</option>
        {notebooks.map((n) => (
          <option key={n.id} value={n.id}>
            {n.name}
          </option>
        ))}
      </select>
      <select
        aria-label="Parent page"
        value={note.parentId || ""}
        onChange={(e) => update(note.id, { parentId: e.target.value || null })}
      >
        <option value="">Top-level page</option>
        {notes
          .filter(
            (n) => !children.has(n.id) && n.notebookId === note.notebookId,
          )
          .map((n) => (
            <option key={n.id} value={n.id}>
              {n.title}
            </option>
          ))}
      </select>
    </div>
  );
}
export function orderedTree(notes) {
  const byParent = new Map(),
    ids = new Set(notes.map((n) => n.id));
  for (const n of notes) {
    const parent = ids.has(n.parentId) ? n.parentId : null;
    const list = byParent.get(parent) || [];
    list.push(n);
    byParent.set(parent, list);
  }
  const result = [],
    seen = new Set();
  function walk(parent, depth) {
    for (const n of byParent.get(parent) || []) {
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      result.push({ ...n, treeDepth: depth });
      walk(n.id, depth + 1);
    }
  }
  walk(null, 0);
  return result;
}
