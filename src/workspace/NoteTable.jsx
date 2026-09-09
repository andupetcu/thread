import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Filter,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import {
  defaultView,
  fieldValue,
  filterTable,
  saveView,
  standardFields,
  tableFields,
} from "./table-model.js";
import "./workspace-tools.css";

const labels = {
  title: "Note",
  status: "Status",
  priority: "Priority",
  owner: "Owner",
  dueDate: "Due date",
  updated: "Modified",
  created: "Created",
};
const statuses = [
  "Planned",
  "In progress",
  "In review",
  "Done",
  "Blocked",
  "Archived",
];
const priorities = ["P0", "P1", "P2", "P3"];
const copy = (value) => JSON.parse(JSON.stringify(value));
function PropertyCell({ note, field, update }) {
  const value = String(fieldValue(note, field));
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  function commit(next) {
    if (next !== value)
      update(note.id, { properties: { ...note.properties, [field]: next } });
  }
  const label = `${note.title || "Untitled note"} ${field}`;
  if (field === "status" || field === "priority") {
    const options = field === "status" ? statuses : priorities;
    return (
      <select
        className={`wt-property wt-${field}`}
        aria-label={label}
        value={value}
        onChange={(e) => commit(e.target.value)}
      >
        <option value="">—</option>
        {!["", ...options].includes(value) && <option>{value}</option>}
        {options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
    );
  }
  return (
    <input
      className="wt-property"
      type={field === "dueDate" ? "date" : "text"}
      aria-label={label}
      value={draft}
      placeholder="—"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          e.currentTarget.value = value;
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

export default function NoteTable({
  notes,
  update,
  open,
  settings = {},
  onSettingsChange = () => {},
}) {
  const saved = settings.tableViews || [];
  const selected = saved.find((v) => v.id === settings.tableActiveView);
  const [draft, setDraft] = useState(() => copy(selected || defaultView));
  const [name, setName] = useState(selected?.name || "");
  const [adding, setAdding] = useState(false),
    [propertyName, setPropertyName] = useState("");
  const [notice, setNotice] = useState(""),
    [page, setPage] = useState(0);
  useEffect(() => {
    setDraft(copy(selected || defaultView));
    setName(selected?.name || "");
    setPage(0);
  }, [settings.tableActiveView]);
  const fields = useMemo(
    () => tableFields(notes, settings.tableCustomFields || []),
    [notes, settings.tableCustomFields],
  );
  const rows = useMemo(() => filterTable(notes, draft), [notes, draft]);
  const pages = Math.max(1, Math.ceil(rows.length / 100)),
    currentPage = Math.min(page, pages - 1);
  const columns = [
    "title",
    ...(draft.columns || []).filter((field) => field !== "title"),
  ];
  function change(patch) {
    setDraft((d) => ({ ...d, ...patch }));
    setPage(0);
    setNotice("");
  }
  function changeFilter(index, patch) {
    change({
      filters: draft.filters.map((f, i) =>
        i === index ? { ...f, ...patch } : f,
      ),
    });
  }
  function save() {
    if (!name.trim()) {
      setNotice("Name your view before saving.");
      return;
    }
    const id = selected?.id || crypto.randomUUID();
    onSettingsChange({
      tableViews: saveView(saved, id, name, draft),
      tableActiveView: id,
    });
    setNotice("View saved.");
  }
  function addProperty(e) {
    e.preventDefault();
    const field = propertyName.trim();
    if (
      !field ||
      field.length > 64 ||
      ["__proto__", "prototype", "constructor", ...standardFields].includes(
        field,
      )
    ) {
      setNotice("Choose a unique property name, up to 64 characters.");
      return;
    }
    onSettingsChange({
      tableCustomFields: [
        ...new Set([...(settings.tableCustomFields || []), field]),
      ],
    });
    change({ columns: [...new Set([...columns, field])] });
    setPropertyName("");
    setAdding(false);
  }
  return (
    <section className="wt-table-view" aria-label="Notes property table">
      <header className="wt-heading">
        <div>
          <h1>Notes, organized.</h1>
          <p>Track decisions, owners, and delivery in one place.</p>
        </div>
        <span className="wt-count">
          {rows.length} of {notes.length} notes
        </span>
      </header>
      <div className="wt-tools">
        <label className="wt-inline-label">
          View
          <select
            aria-label="Saved table view"
            value={selected?.id || ""}
            onChange={(e) => {
              onSettingsChange({ tableActiveView: e.target.value });
              setDraft(
                copy(saved.find((v) => v.id === e.target.value) || defaultView),
              );
              setName(saved.find((v) => v.id === e.target.value)?.name || "");
            }}
          >
            <option value="">All notes</option>
            {saved.map((v) => (
              <option value={v.id} key={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() =>
            change({
              filters: [
                ...draft.filters,
                { field: "status", operator: "is", value: "Planned" },
              ],
            })
          }
        >
          <Filter size={14} />
          Add filter
        </button>
        <details className="wt-columns">
          <summary>
            <Columns3 size={14} />
            Columns
          </summary>
          <div>
            {fields.map((field) => (
              <label key={field}>
                <input
                  type="checkbox"
                  checked={columns.includes(field)}
                  disabled={field === "title"}
                  onChange={(e) =>
                    change({
                      columns: e.target.checked
                        ? [...columns, field]
                        : columns.filter((f) => f !== field),
                    })
                  }
                />
                {labels[field] || field}
              </label>
            ))}
          </div>
        </details>
        <button onClick={() => setAdding((v) => !v)}>
          <Plus size={14} />
          Add property
        </button>
        <div className="wt-view-save">
          <input
            aria-label="View name"
            placeholder="Name this view"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button onClick={save}>
            <Save size={14} />
            Save view
          </button>
          {selected && (
            <>
              <button
                aria-label="Duplicate view"
                onClick={() => {
                  const id = crypto.randomUUID();
                  onSettingsChange({
                    tableViews: saveView(
                      saved,
                      id,
                      `${name || selected.name} copy`,
                      draft,
                    ),
                    tableActiveView: id,
                  });
                }}
              >
                <Plus size={14} />
              </button>
              <button
                aria-label="Delete saved view"
                onClick={() =>
                  onSettingsChange({
                    tableViews: saved.filter((v) => v.id !== selected.id),
                    tableActiveView: "",
                  })
                }
              >
                <Trash2 size={14} />
              </button>
            </>
          )}
        </div>
      </div>
      {adding && (
        <form className="wt-property-form" onSubmit={addProperty}>
          <input
            autoFocus
            aria-label="Property name"
            value={propertyName}
            onChange={(e) => setPropertyName(e.target.value)}
            placeholder="e.g. Release or Estimate"
            maxLength={64}
          />
          <button type="submit">Create property</button>
          <button
            type="button"
            aria-label="Cancel property"
            onClick={() => setAdding(false)}
          >
            <X size={14} />
          </button>
        </form>
      )}
      {!!draft.filters.length && (
        <div className="wt-filters" aria-label="Table filters">
          {draft.filters.map((filter, index) => (
            <div key={index}>
              <span>{index ? "and" : "Where"}</span>
              <select
                aria-label={`Filter ${index + 1} field`}
                value={filter.field}
                onChange={(e) => changeFilter(index, { field: e.target.value })}
              >
                {fields.map((f) => (
                  <option value={f} key={f}>
                    {labels[f] || f}
                  </option>
                ))}
              </select>
              <select
                aria-label={`Filter ${index + 1} operator`}
                value={filter.operator}
                onChange={(e) =>
                  changeFilter(index, { operator: e.target.value })
                }
              >
                {Object.entries({
                  contains: "contains",
                  is: "is",
                  isNot: "is not",
                  empty: "is empty",
                  notEmpty: "is not empty",
                  before: "is before",
                  after: "is after",
                }).map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
              {!["empty", "notEmpty"].includes(filter.operator) && (
                <input
                  aria-label={`Filter ${index + 1} value`}
                  type={
                    ["dueDate", "updated", "created"].includes(filter.field)
                      ? "date"
                      : "text"
                  }
                  value={filter.value || ""}
                  onChange={(e) =>
                    changeFilter(index, { value: e.target.value })
                  }
                />
              )}
              <button
                aria-label={`Remove filter ${index + 1}`}
                onClick={() =>
                  change({
                    filters: draft.filters.filter((_, i) => i !== index),
                  })
                }
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
      {notice && (
        <p className="wt-notice" role="status">
          {notice}
        </p>
      )}
      <div className="wt-table-scroll">
        <table className="wt-property-table">
          <thead>
            <tr>
              {columns.map((field) => (
                <th
                  key={field}
                  aria-sort={
                    draft.sort.field === field
                      ? draft.sort.direction === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                >
                  <button
                    onClick={() =>
                      change({
                        sort: {
                          field,
                          direction:
                            draft.sort.field === field &&
                            draft.sort.direction === "asc"
                              ? "desc"
                              : "asc",
                        },
                      })
                    }
                  >
                    {labels[field] || field}
                    {draft.sort.field === field &&
                      (draft.sort.direction === "asc" ? (
                        <ArrowUp size={12} />
                      ) : (
                        <ArrowDown size={12} />
                      ))}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows
              .slice(currentPage * 100, (currentPage + 1) * 100)
              .map((note) => (
                <tr key={note.id}>
                  {columns.map((field) => (
                    <td key={field}>
                      {field === "title" ? (
                        <button
                          className="wt-note-link"
                          onClick={() => open(note.id)}
                        >
                          {note.pinned && <span title="Pinned">◆</span>}
                          {note.title || "Untitled note"}
                        </button>
                      ) : ["updated", "created"].includes(field) ? (
                        <time dateTime={note[field]}>
                          {note[field]
                            ? new Date(note[field]).toLocaleString([], {
                                month: "short",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : "—"}
                        </time>
                      ) : (
                        <PropertyCell
                          note={note}
                          field={field}
                          update={update}
                        />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
        {!rows.length && (
          <div className="wt-empty">
            <Filter size={28} />
            <p>No notes match this view.</p>
            <button onClick={() => change({ filters: [] })}>
              Clear table filters
            </button>
          </div>
        )}
      </div>
      <footer className="wt-table-footer">
        <small>
          Properties save when you leave a cell. Save a view to keep its
          filters, columns, and sort.
        </small>
        <div>
          <button
            aria-label="Previous table page"
            disabled={!currentPage}
            onClick={() => setPage(currentPage - 1)}
          >
            <ChevronLeft size={15} />
          </button>
          <span>
            {currentPage + 1} / {pages}
          </span>
          <button
            aria-label="Next table page"
            disabled={currentPage + 1 >= pages}
            onClick={() => setPage(currentPage + 1)}
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </footer>
    </section>
  );
}
