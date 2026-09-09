import React, {
  useState,
  useEffect,
  useMemo,
  useRef,
  lazy,
  Suspense,
} from "react";
import { createRoot } from "react-dom/client";
import {
  Search,
  Plus,
  FileText,
  Network,
  Table2,
  PanelLeft,
  PanelRight,
  Layers3,
  Settings2,
  ChevronRight,
  Hash,
  Link,
  Pin,
  Download,
  Upload,
  Maximize2,
  Minimize2,
  GitCompare,
  Eye,
  Code2,
  X,
  Check,
  Trash2,
  ArrowUpRight,
  ZoomIn,
  ZoomOut,
  RotateCcw,
} from "lucide-react";
import Render, { EditContext } from "./Render";
import NotebookTools, {
  NoteLocation,
  orderedTree,
} from "./storage/NotebookTools";
import WorkspaceGate from "./storage/WorkspaceGate";
import WorkspaceSettings, {
  ConflictReview,
  Reauthenticate,
} from "./storage/WorkspaceSettings";
import { api } from "./storage/api";
import { defaultDiagram } from "./diagram/model";
const GraphView = lazy(() => import("./workspace/GraphView"));
const NoteTable = lazy(() => import("./workspace/NoteTable"));
const DiffView = lazy(() => import("./workspace/DiffView"));
import { metadata, searchNotes, validateBackup, initialNotes } from "./model";
import "./style.css";
const BlockEditor = lazy(() => import("./BlockEditor"));
import ContextPanel from "./ContextPanel";
import { parseBlocks, suggestions } from "./editor-model";
const KEY = "thread.notes.v1";
function safeTheme() {
  try {
    return localStorage.getItem("thread.theme") || "dark";
  } catch {
    return "dark";
  }
}

function Button({ icon: Icon, children, title, ...props }) {
  return (
    <button title={title} aria-label={title} {...props}>
      {Icon && <Icon size={16} />} {children}
    </button>
  );
}
function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function App({ workspace, onLock }) {
  const { notes, setNotes } = workspace;
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notebook, setNotebook] = useState("");
  const [searchIds, setSearchIds] = useState(null);
  const [listLimit, setListLimit] = useState(200);
  const [tabs, setTabs] = useState(
    workspace.settings.layout?.tabs ||
      workspace.notes.slice(0, 1).map((n) => n.id),
  );
  const [widths, setWidths] = useState(
    workspace.settings.layout?.widths || [1, 1, 1],
  );
  const [panels, setPanels] = useState(
      workspace.settings.layout?.panels?.filter((id) =>
        notes.some((n) => n.id === id),
      ) || notes.slice(0, 1).map((n) => n.id),
    ),
    [view, setView] = useState(workspace.settings.layout?.view || "notes"),
    [query, setQuery] = useState(""),
    [tag, setTag] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [dateField, setDateField] = useState("updated"),
    [filters, setFilters] = useState(false),
    [focus, setFocus] = useState(false),
    [compare, setCompare] = useState(false),
    [theme, setTheme] = useState(safeTheme()),
    [toast, setToast] = useState(""),
    [sidebar, setSidebar] = useState(true),
    [sort, setSort] = useState("updated"),
    [trash, setTrash] = useState(null),
    [contextOpen, setContextOpen] = useState(() => innerWidth >= 1100),
    [activePanel, setActivePanel] = useState(0);
  useEffect(() => {
    const media = matchMedia("(max-width: 1100px)");
    const adapt = () => {
      if (media.matches) setContextOpen(false);
    };
    media.addEventListener("change", adapt);
    return () => media.removeEventListener("change", adapt);
  }, []);
  const fileRef = useRef(),
    searchRef = useRef();
  useEffect(() => {
    const timer = setTimeout(
      () => workspace.saveSettings({ layout: { panels, tabs, widths, view } }),
      650,
    );
    return () => clearTimeout(timer);
  }, [panels, tabs, widths, view]);
  const availableIds = notes.map((n) => n.id).join(",");
  useEffect(() => {
    setPanels((p) => {
      const next = p.filter((id) => notes.some((n) => n.id === id));
      return next.length === p.length
        ? p
        : next.length
          ? next
          : notes.slice(0, 1).map((n) => n.id);
    });
  }, [availableIds]);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () =>
      (document.documentElement.dataset.theme =
        theme === "system" ? (media.matches ? "dark" : "light") : theme);
    apply();
    try {
      localStorage.setItem("thread.theme", theme);
    } catch {}
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 3500);
      return () => clearTimeout(t);
    }
  }, [toast]);
  const create = () => {
    const n = {
      id: crypto.randomUUID(),
      title: "Untitled note",
      body: "",
      notebookId: notebook || null,
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    };
    setNotes((p) => [n, ...p]);
    setPanels((p) => [n.id, ...p.slice(1)]);
    setTabs((p) => [...p, n.id]);
    setView("notes");
    setCompare(false);
  };
  useEffect(() => {
    const key = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSidebar(true);
        setFocus(false);
        requestAnimationFrame(() => searchRef.current?.focus());
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        setFocus((p) => !p);
      }
      if (e.key === "Escape") setFocus(false);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const update = (id, patch) =>
    setNotes((p) =>
      p.map((n) =>
        n.id === id ? { ...n, ...patch, updated: new Date().toISOString() } : n,
      ),
    );
  const open = (id, index = 0, blockId) => {
    setTabs((p) => (p.includes(id) ? p : [...p, id]));
    if (!notes.some((n) => n.id === id)) {
      setToast("This linked note no longer exists.");
      return;
    }
    setPanels((p) => {
      const next = [...p];
      next[index] = id;
      return next;
    });
    setView("notes");
    if (blockId)
      setTimeout(() => {
        const el = document.querySelector(
          `[data-panel="${index}"] [data-block-id="${CSS.escape(blockId)}"]`,
        );
        el?.scrollIntoView({ block: "center" });
        el?.focus();
      }, 100);
  };
  const tags = useMemo(
    () => [...new Set(notes.flatMap((n) => metadata(n.body).tags))].sort(),
    [notes],
  );
  useEffect(() => {
    setListLimit(200);
    if (!query && !tag && !from && !to) {
      setSearchIds(null);
      return;
    }
    let alive = true;
    const timer = setTimeout(async () => {
      try {
        await workspace.flush();
        const params = new URLSearchParams({
          q: query,
          tag,
          from: from ? new Date(from).toISOString() : "",
          to: to ? new Date(to).toISOString() : "",
          dateField,
        });
        const result = await api("/search?" + params);
        if (alive) setSearchIds(new Set(result.ids));
      } catch (e) {
        if (alive) setError(e.message);
      }
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, tag, from, to, dateField, notes]);
  const visible = useMemo(
    () =>
      notes
        .filter(
          (n) =>
            (!notebook || n.notebookId === notebook) &&
            (!searchIds || searchIds.has(n.id)),
        )
        .sort((a, b) =>
          sort === "title"
            ? a.title.localeCompare(b.title)
            : b[sort].localeCompare(a[sort]),
        ),
    [notes, notebook, searchIds, sort],
  );
  const active = notes.find((n) => n.id === panels[0]);
  const contextIndex = Math.min(activePanel, Math.max(0, panels.length - 1));
  const contextNote = notes.find((n) => n.id === panels[contextIndex]);
  function jumpToHeading(heading) {
    const pane = document.querySelector(`[data-panel="${contextIndex}"]`);
    const source = pane?.querySelector(
      'textarea[aria-label="Markdown source"]',
    );
    if (source) {
      source.focus();
      source.setSelectionRange(
        heading.start,
        heading.start + heading.depth + 1 + heading.title.length,
      );
      return;
    }
    pane?.querySelector('[aria-label="Done editing block"]')?.click();
    requestAnimationFrame(() => {
      const target =
        pane?.querySelector(`[data-heading-start="${heading.start}"]`) ||
        pane?.querySelector(`[data-block-start="${heading.start}"]`);
      target?.scrollIntoView({
        block: "start",
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      });
      target?.focus({ preventScroll: true });
    });
  }
  function openBeside(id) {
    const next = panels.length < 3 ? panels.length : (contextIndex + 1) % 3;
    open(id, next);
    setActivePanel(next);
  }

  const panelCount = (count) => {
    setPanels((p) =>
      Array.from(
        { length: count },
        (_, i) => p[i] || notes[i % notes.length]?.id,
      ).filter(Boolean),
    );
    if (count === 1) setCompare(false);
  };
  const exportNote = async (note, type) => {
    try {
      const name = note.title.replace(/[/\\:*?"<>|]/g, "-") || "Untitled";
      if (type === "md")
        download(
          new Blob([`# ${note.title}\n\n${note.body}`], {
            type: "text/markdown",
          }),
          name + ".md",
        );
      if (type === "pdf") {
        const { toPdf } = await import("./export-pdf");
        setToast("Preparing PDF…");
        download(
          await toPdf(note.title, document.getElementById("render-" + note.id)),
          name + ".pdf",
        );
        setToast("PDF downloaded.");
      }
      if (type === "bundle") {
        const { toMarkdownBundle } = await import("./export-markdown");
        download(await toMarkdownBundle(note), name + ".zip");
      }
      if (type === "docx") {
        const { toDocx } = await import("./export-docx");
        download(
          await toDocx(
            note.title,
            document.getElementById("render-" + note.id),
          ),
          name + ".docx",
        );
      }
    } catch (e) {
      setError("Export failed: " + e.message);
    }
  };
  const importFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      let incoming;
      if (file.name.endsWith(".md")) {
        const now = new Date().toISOString();
        incoming = [
          {
            id: crypto.randomUUID(),
            title: file.name.replace(/\.md$/, ""),
            body: text,
            created: now,
            updated: now,
          },
        ];
      } else incoming = validateBackup(JSON.parse(text));
      setNotes((p) => {
        const ids = new Set(p.map((n) => n.id));
        return [...p, ...incoming.filter((n) => !ids.has(n.id))];
      });
      setToast("Imported new notes. Existing note IDs were preserved.");
    } catch (e) {
      setError(e.message);
    }
    e.target.value = "";
  };
  return (
    <Suspense fallback={<div className="workspace-gate">Opening editor…</div>}>
      <EditContext.Provider value={update}>
        <div
          className={
            "app " + (focus ? "focus " : "") + (!sidebar ? "collapsed" : "")
          }
        >
          {!focus && sidebar && (
            <aside className="sidebar">
              <div className="brand">
                <div className="brand-icon">
                  <Network size={23} />
                </div>
                <strong>
                  thread<span> / local</span>
                </strong>
                <span className="version">β</span>
              </div>
              <div className="workspace">
                <div className="avatar">A</div>
                <div>
                  Personal workspace<small>On this device</small>
                </div>
                <ChevronRight size={14} />
              </div>
              <label className="search">
                <Search size={16} />
                <input
                  ref={searchRef}
                  placeholder="Search anything…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <kbd>⌘ K</kbd>
              </label>
              <nav>
                {[
                  ["notes", FileText, "All notes"],
                  ["graph", Network, "Graph view"],
                  ["table", Table2, "Table view"],
                ].map(([v, I, label]) => (
                  <Button
                    key={v}
                    icon={I}
                    title={label}
                    className={view === v ? "selected" : ""}
                    onClick={() => setView(v)}
                  >
                    {label}
                    <span>
                      {v === "notes" ? notes.length : v === "graph" ? "⌘" : ""}
                    </span>
                  </Button>
                ))}
              </nav>
              <NotebookTools
                workspace={workspace}
                value={notebook}
                onChange={setNotebook}
                onError={setError}
              />
              <div className="section-label">
                Workspace{" "}
                <Button icon={Plus} title="New note" onClick={create} />
              </div>
              <div className="note-list">
                {orderedTree(
                  [...visible].sort(
                    (a, b) => Number(!!b.pinned) - Number(!!a.pinned),
                  ),
                )
                  .slice(0, listLimit)
                  .map((n) => (
                    <button
                      key={n.id}
                      style={{
                        paddingLeft: 12 + Math.min(n.treeDepth, 12) * 14,
                      }}
                      className={
                        "note-link " +
                        (panels.includes(n.id) && view === "notes"
                          ? "active"
                          : "")
                      }
                      onClick={() => open(n.id)}
                    >
                      <FileText size={15} />
                      <span>{n.title || "Untitled note"}</span>
                      {n.pinned && <Pin size={12} />}
                    </button>
                  ))}
                {visible.length > listLimit && (
                  <button onClick={() => setListLimit((n) => n + 200)}>
                    Show more notes ({visible.length - listLimit})
                  </button>
                )}
                {!visible.length && (
                  <p className="empty-small">No matching notes.</p>
                )}
              </div>
              <div className="section-label">
                Tags <span>{tags.length}</span>
              </div>
              <div className="tag-list">
                {tags.map((t) => (
                  <button
                    key={t}
                    className={tag === t ? "active" : ""}
                    onClick={() => setTag(tag === t ? "" : t)}
                  >
                    <Hash size={13} />
                    {t}
                    <span>
                      {
                        notes.filter((n) => metadata(n.body).tags.includes(t))
                          .length
                      }
                    </span>
                  </button>
                ))}
              </div>
              <div className="sidebar-bottom">
                <div className="local-status">
                  <span />
                  Local workspace <small>{workspace.status}</small>
                </div>
                <div className="bottom-actions">
                  <Button
                    icon={RotateCcw}
                    title="Download recovery data"
                    onClick={() => {
                      try {
                        const raw = localStorage.getItem(KEY + ".recovery");
                        if (raw)
                          download(
                            new Blob([raw], { type: "text/plain" }),
                            "thread-recovery.txt",
                          );
                        else
                          setToast(
                            "No damaged storage recovery copy is present.",
                          );
                      } catch {
                        setError("Storage cannot be accessed.");
                      }
                    }}
                  />

                  <Button
                    icon={Download}
                    title="Backup workspace"
                    onClick={async () => {
                      try {
                        await workspace.flush();
                        download(await api("/backup"), "thread-workspace.zip");
                      } catch (e) {
                        setError(e.message);
                      }
                    }}
                  >
                    Backup
                  </Button>
                  <Button
                    icon={Upload}
                    title="Import notes"
                    onClick={() => fileRef.current.click()}
                  >
                    Import
                  </Button>
                  <select
                    aria-label="Color theme"
                    value={theme}
                    onChange={(e) => setTheme(e.target.value)}
                  >
                    <option value="dark">Dark</option>
                    <option value="light">Light</option>
                    <option value="system">System</option>
                  </select>
                </div>
              </div>
            </aside>
          )}
          <main>
            <header className="topbar">
              <div>
                <Button
                  icon={focus ? Minimize2 : PanelLeft}
                  title={focus ? "Exit focus" : "Toggle sidebar"}
                  onClick={() =>
                    focus ? setFocus(false) : setSidebar((p) => !p)
                  }
                />
                <span className="breadcrumb">
                  Workspace <ChevronRight size={12} />{" "}
                  <strong>
                    {view === "notes"
                      ? "Notes"
                      : view === "graph"
                        ? "Knowledge graph"
                        : "All notes"}
                  </strong>
                </span>
              </div>
              <div className="top-actions">
                <span className="saved">
                  <Check size={13} />
                  {workspace.status}
                </span>
                <Button icon={Plus} onClick={create}>
                  New note
                </Button>
              </div>
            </header>
            {error && (
              <div className="error" role="alert">
                {error}
                <button onClick={() => setError("")}>Dismiss</button>
              </div>
            )}
            <div className="viewbar">
              <div className="view-title">
                {view === "notes" ? (
                  <>
                    <FileText size={16} />
                    {active?.title || "Notes"}
                    <span className="file-ext">.md</span>
                  </>
                ) : (
                  <>
                    <Network size={17} />
                    {view === "graph"
                      ? "Your connected thinking"
                      : "Note database"}
                  </>
                )}
              </div>
              <div className="view-controls">
                {view === "notes" && (
                  <Button
                    title="Toggle document context"
                    icon={PanelRight}
                    className={contextOpen ? "active" : ""}
                    onClick={() => setContextOpen((p) => !p)}
                  />
                )}
                <Button
                  icon={Settings2}
                  title="Workspace settings"
                  onClick={() => setSettingsOpen(true)}
                />
                <button
                  onClick={() => onLock().catch((e) => setError(e.message))}
                >
                  Lock
                </button>
                <Button
                  icon={Settings2}
                  title="Search filters"
                  className={filters ? "active" : ""}
                  onClick={() => setFilters((p) => !p)}
                />
                {view === "notes" && (
                  <>
                    <div className="panel-switch">
                      {[1, 2, 3].map((n) => (
                        <button
                          key={n}
                          aria-label={`${n} panels`}
                          className={panels.length === n ? "active" : ""}
                          onClick={() => panelCount(n)}
                        >
                          {Array.from({ length: n }, (_, i) => (
                            <i key={i} />
                          ))}
                        </button>
                      ))}
                    </div>
                    <Button
                      icon={GitCompare}
                      title="Compare notes"
                      disabled={panels.length < 2}
                      className={compare ? "active" : ""}
                      onClick={() => setCompare((p) => !p)}
                    />
                    <Button
                      icon={Maximize2}
                      title="Focus mode"
                      onClick={() => setFocus((p) => !p)}
                    />
                  </>
                )}
              </div>
            </div>
            {(filters || query || tag) && (
              <div className="filters">
                <input
                  aria-label="Search notes"
                  placeholder="Search title, content, @mentions, #tags"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <select
                  aria-label="Filter tag"
                  value={tag}
                  onChange={(e) => setTag(e.target.value)}
                >
                  <option value="">All tags</option>
                  {tags.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
                <select
                  aria-label="Date field"
                  value={dateField}
                  onChange={(e) => setDateField(e.target.value)}
                >
                  <option value="updated">Modified</option>
                  <option value="created">Created</option>
                </select>
                <label>
                  From
                  <input
                    aria-label="From date and hour"
                    type="datetime-local"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                  />
                </label>
                <label>
                  To
                  <input
                    aria-label="To date and hour"
                    type="datetime-local"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                  />
                </label>
                <Button
                  title="Clear filters"
                  icon={X}
                  onClick={() => {
                    setQuery("");
                    setTag("");
                    setFrom("");
                    setTo("");
                  }}
                />
                <small>{visible.length} results</small>
              </div>
            )}
            {view === "notes" && (
              <div
                className="workspace-tabs"
                role="tablist"
                aria-label="Open notes"
              >
                {tabs
                  .filter((id) => notes.some((n) => n.id === id))
                  .map((id) => (
                    <div
                      key={id}
                      className={
                        "workspace-tab " + (panels.includes(id) ? "active" : "")
                      }
                    >
                      <button
                        role="tab"
                        aria-selected={contextNote?.id === id}
                        tabIndex={contextNote?.id === id ? 0 : -1}
                        onKeyDown={(e) => {
                          if (
                            ["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                              e.key,
                            )
                          ) {
                            e.preventDefault();
                            const items = [
                                ...e.currentTarget
                                  .closest("[role=tablist]")
                                  .querySelectorAll("[role=tab]"),
                              ],
                              i = items.indexOf(e.currentTarget),
                              next =
                                e.key === "Home"
                                  ? 0
                                  : e.key === "End"
                                    ? items.length - 1
                                    : (i +
                                        (e.key === "ArrowRight" ? 1 : -1) +
                                        items.length) %
                                      items.length;
                            items[next]?.click();
                            items[next]?.focus();
                          }
                        }}
                        onClick={() => open(id, contextIndex)}
                      >
                        {notes.find((n) => n.id === id)?.title}
                      </button>
                      <button
                        aria-label={
                          "Close tab " + notes.find((n) => n.id === id)?.title
                        }
                        onClick={() => {
                          const remaining = tabs.filter((t) => t !== id);
                          setTabs(remaining);
                          setPanels((p) =>
                            p
                              .map((n) => (n === id ? remaining.at(-1) : n))
                              .filter(Boolean),
                          );
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
              </div>
            )}
            {view === "notes" ? (
              notes.length ? (
                <>
                  {!panels.length && (
                    <div className="empty">
                      <h2>Choose a note from the sidebar</h2>
                      <button onClick={create}>Create a note</button>
                    </div>
                  )}
                  <div className="document-layout">
                    <div className="panes">
                      {panels.map((id, i) => {
                        const n = notes.find((n) => n.id === id);
                        return (
                          n && (
                            <React.Fragment key={i + id}>
                              {i > 0 && (
                                <div
                                  role="separator"
                                  aria-label={
                                    "Resize panels " + i + " and " + (i + 1)
                                  }
                                  aria-orientation="vertical"
                                  aria-valuenow={Math.round(
                                    widths[i - 1] * 100,
                                  )}
                                  tabIndex={0}
                                  className="pane-resizer"
                                  onKeyDown={(e) => {
                                    if (
                                      ["ArrowLeft", "ArrowRight"].includes(
                                        e.key,
                                      )
                                    ) {
                                      e.preventDefault();
                                      setWidths((p) => {
                                        const next = [...p];
                                        next[i - 1] = Math.max(
                                          0.3,
                                          next[i - 1] +
                                            (e.key === "ArrowLeft"
                                              ? -0.1
                                              : 0.1),
                                        );
                                        return next;
                                      });
                                    }
                                  }}
                                  onPointerDown={(e) => {
                                    e.currentTarget.setPointerCapture(
                                      e.pointerId,
                                    );
                                    const start = e.clientX,
                                      initial = [...widths],
                                      total =
                                        e.currentTarget.parentElement
                                          .clientWidth;
                                    e.currentTarget.onpointermove = (ev) => {
                                      const delta =
                                        ((ev.clientX - start) / total) *
                                        panels.length;
                                      setWidths((p) => {
                                        const next = [...initial];
                                        next[i - 1] = Math.max(
                                          0.3,
                                          initial[i - 1] + delta,
                                        );
                                        next[i] = Math.max(
                                          0.3,
                                          initial[i] - delta,
                                        );
                                        return next;
                                      });
                                    };
                                    e.currentTarget.onpointerup = (ev) => {
                                      ev.currentTarget.onpointermove = null;
                                    };
                                  }}
                                />
                              )}
                              <NotePane
                                width={widths[i] || 1}
                                notebooks={workspace.notebooks}
                                note={n}
                                notes={notes}
                                index={i}
                                onActivate={() => setActivePanel(i)}
                                update={update}
                                open={(id, _index, blockId) =>
                                  open(id, i, blockId)
                                }
                                exportNote={exportNote}
                                tags={tags}
                                remove={() => {
                                  setTrash(n);
                                  setNotes((p) => p.filter((x) => x.id !== id));
                                  setPanels((p) =>
                                    p
                                      .map((x) =>
                                        x === id
                                          ? notes.find((y) => y.id !== id)?.id
                                          : x,
                                      )
                                      .filter(Boolean),
                                  );
                                }}
                              />
                            </React.Fragment>
                          )
                        );
                      })}
                    </div>
                    {contextOpen && !focus && contextNote && (
                      <ContextPanel
                        note={contextNote}
                        notes={notes}
                        onClose={() => setContextOpen(false)}
                        jump={jumpToHeading}
                        open={(id) => open(id, contextIndex)}
                        openBeside={openBeside}
                      />
                    )}
                  </div>
                  {compare && (
                    <DiffView
                      notes={panels
                        .map((id) => notes.find((n) => n.id === id))
                        .filter(Boolean)}
                      onClose={() => setCompare(false)}
                    />
                  )}
                </>
              ) : (
                <div className="empty">
                  <FileText size={40} />
                  <h2>Your next idea starts here.</h2>
                  <Button icon={Plus} onClick={create}>
                    Create a note
                  </Button>
                </div>
              )
            ) : view === "graph" ? (
              <GraphView
                notes={visible}
                open={open}
                settings={workspace.settings}
                onSettingsChange={workspace.saveSettings}
              />
            ) : (
              <NoteTable
                notes={visible}
                update={update}
                open={open}
                settings={workspace.settings}
                onSettingsChange={workspace.saveSettings}
              />
            )}
            <footer>
              <span>
                <span className="status-dot" />
                Thread local <span className="footer-divider">/</span>{" "}
                {notes.length} notes · {tags.length} tags
              </span>
              <span>
                <kbd>/</kbd> blocks <kbd>@</kbd> mentions <kbd>#</kbd> tags{" "}
                <span className="footer-divider">/</span> <kbd>⌘ Enter</kbd>{" "}
                focus
              </span>
            </footer>
          </main>
        </div>
        <input
          type="file"
          hidden
          ref={fileRef}
          accept=".json,.md"
          onChange={importFile}
        />
        {toast && (
          <div className="toast" role="status">
            {toast}
          </div>
        )}
        {trash && (
          <div className="toast">
            Deleted “{trash.title}”{" "}
            <button
              onClick={async () => {
                try {
                  await workspace.flush();
                  try {
                    await api("/notes/" + trash.id + "/restore", {
                      method: "POST",
                      body: {},
                    });
                  } catch (e) {
                    if (e.status !== 404) throw e;
                    setNotes((p) => [
                      ...p,
                      { ...trash, revision: 0, deletedAt: null },
                    ]);
                  }
                  await workspace.reload();
                  setTrash(null);
                } catch (e) {
                  setError(e.message);
                }
              }}
            >
              Undo
            </button>
            <button aria-label="Dismiss undo" onClick={() => setTrash(null)}>
              ×
            </button>
          </div>
        )}
        {settingsOpen && (
          <WorkspaceSettings
            workspace={workspace}
            note={contextNote}
            onRestore={(data) => {
              const layout = data.settings?.layout || {};
              setPanels(
                layout.panels || data.notes.slice(0, 1).map((n) => n.id),
              );
              setTabs(layout.tabs || data.notes.slice(0, 1).map((n) => n.id));
              setWidths(layout.widths || [1, 1, 1]);
              setView(layout.view || "notes");
              setNotebook("");
            }}
            onClose={() => setSettingsOpen(false)}
          />
        )}
        <ConflictReview workspace={workspace} />
        {workspace.needsUnlock && <Reauthenticate workspace={workspace} />}
        {workspace.error && (
          <div className="toast" role="alert">
            {workspace.error}
            <button onClick={() => workspace.flush().catch(() => {})}>
              Retry save
            </button>
          </div>
        )}
        <div className="print-only">
          <h1 id="print-title" />
          <div id="print-note" />
        </div>
      </EditContext.Provider>
    </Suspense>
  );
}
function completionPosition(input, pos) {
  const mirror = document.createElement("div");
  const style = getComputedStyle(input);
  for (const key of [
    "font",
    "lineHeight",
    "letterSpacing",
    "padding",
    "border",
    "boxSizing",
  ])
    mirror.style[key] = style[key];
  Object.assign(mirror.style, {
    position: "fixed",
    visibility: "hidden",
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
    width: input.clientWidth + "px",
    left: "-10000px",
    top: "0",
  });
  mirror.textContent = input.value.slice(0, pos);
  const caret = document.createElement("span");
  caret.textContent = "|";
  mirror.append(caret);
  document.body.append(mirror);
  const rect = input.getBoundingClientRect();
  const top = rect.top + caret.offsetTop - input.scrollTop + 24;
  const left = rect.left + caret.offsetLeft;
  mirror.remove();
  return {
    position: "fixed",
    top: Math.max(110, Math.min(innerHeight - 350, top)),
    left: Math.max(8, Math.min(innerWidth - 290, left)),
    width: 280,
  };
}
function NotePane({
  note,
  notes,
  index,
  update,
  open,
  exportNote,
  tags,
  remove,
  onActivate,
  width,
  notebooks,
}) {
  const [editing, setEditing] = useState(!note.body),
    [completion, setCompletion] = useState(null),
    [choice, setChoice] = useState(0),
    [find, setFind] = useState(""),
    [showFind, setShowFind] = useState(false),
    [exports, setExports] = useState(false),
    [blockMode, setBlockMode] = useState(false);
  const input = useRef();
  const sourceDiagrams = useMemo(
    () =>
      editing
        ? parseBlocks(note.body).filter(
            (block) =>
              block.type === "code" &&
              /^(`{3,}|~{3,})thread-diagram\b/.test(block.source),
          )
        : [],
    [editing, note.body],
  );
  const meta = metadata(note.body);
  const backlinks = notes.filter((n) =>
    metadata(n.body).links.includes(note.id),
  );
  const options = completion
    ? suggestions(completion.kind, completion.query, notes, tags, note.id)
    : [];
  const detect = (value, pos) => {
    const m = value.slice(0, pos).match(/(?:^|\s)([/@#])([^\n/@#]*)$/);
    setCompletion(
      m
        ? {
            kind: m[1],
            query: m[2],
            start: pos - m[2].length - 1,
            end: pos,
            position: completionPosition(input.current, pos),
          }
        : null,
    );
    setChoice(0);
  };
  const insert = (
    value,
    start = input.current?.selectionStart,
    end = input.current?.selectionEnd,
  ) => {
    const body = note.body.slice(0, start) + value + note.body.slice(end);
    update(note.id, { body });
    setCompletion(null);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(
        start + value.length,
        start + value.length,
      );
    });
  };
  const choose = (o) => insert(o.value, completion.start, completion.end);
  const format = (before, after = "") => {
    const t = input.current;
    insert(before + note.body.slice(t.selectionStart, t.selectionEnd) + after);
  };
  const findNext = () => {
    if (!find) return;
    setEditing(true);
    setBlockMode(false);
    requestAnimationFrame(() => {
      const el = input.current;
      const start = note.body
        .toLowerCase()
        .indexOf(find.toLowerCase(), el.selectionEnd);
      const pos =
        start < 0 ? note.body.toLowerCase().indexOf(find.toLowerCase()) : start;
      if (pos >= 0) {
        el.focus();
        el.setSelectionRange(pos, pos + find.length);
      }
    });
  };
  return (
    <article
      className="note-pane"
      style={{ flex: width + " 1 0%" }}
      data-panel={index}
      onPointerDown={onActivate}
      onFocusCapture={onActivate}
    >
      <NoteLocation
        note={note}
        notes={notes}
        notebooks={notebooks}
        update={update}
      />
      <div className="pane-toolbar">
        <select
          aria-label={`Note in panel ${index + 1}`}
          value={note.id}
          onChange={(e) => open(e.target.value, index)}
        >
          {notes.map((n) => (
            <option key={n.id} value={n.id}>
              {n.title || "Untitled note"}
            </option>
          ))}
        </select>
        <div>
          <Button
            icon={editing ? Eye : Code2}
            title={editing ? "Preview note" : "Edit Markdown"}
            onClick={() => {
              setEditing((p) => !p);
              setBlockMode(false);
              setCompletion(null);
            }}
          />
          <Button
            icon={Network}
            title="Insert visual diagram"
            onClick={() => {
              update(note.id, {
                body:
                  note.body +
                  "\n\n```thread-diagram\n" +
                  JSON.stringify(defaultDiagram()) +
                  "\n```\n",
              });
              setEditing(false);
              setBlockMode(true);
            }}
          />
          <Button
            icon={Layers3}
            title="Edit blocks"
            className={blockMode ? "active" : ""}
            onClick={() => {
              setBlockMode((p) => !p);
              setEditing(false);
              setCompletion(null);
            }}
          />
          <Button
            icon={Search}
            title="Find in note"
            onClick={() => setShowFind((p) => !p)}
          />
          <Button
            icon={Pin}
            title="Pin note"
            className={note.pinned ? "active" : ""}
            onClick={() => update(note.id, { pinned: !note.pinned })}
          />
          <div className="export-wrap">
            <Button
              icon={Download}
              title="Export note"
              onClick={() => setExports((p) => !p)}
            />
            {exports && (
              <div className="export-menu">
                {["md", "bundle", "docx", "pdf"].map((type) => (
                  <button
                    key={type}
                    onClick={() => {
                      exportNote(note, type);
                      setExports(false);
                    }}
                  >
                    Export{" "}
                    {type === "bundle"
                      ? "Markdown + assets ZIP"
                      : type.toUpperCase()}
                  </button>
                ))}
              </div>
            )}
          </div>
          <Button icon={Trash2} title="Delete note" onClick={remove} />
        </div>
      </div>
      {showFind && (
        <div className="find-bar">
          <input
            autoFocus
            aria-label="Find text in note"
            placeholder="Find in this note…"
            value={find}
            onChange={(e) => setFind(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && findNext()}
          />
          <small>
            {find
              ? note.body.toLowerCase().split(find.toLowerCase()).length - 1
              : 0}{" "}
            matches
          </small>
          <button onClick={findNext}>Next</button>
          <Button
            icon={X}
            title="Close find"
            onClick={() => setShowFind(false)}
          />
        </div>
      )}
      <div className="note-scroll">
        <div className="note-heading">
          <div className="document-icon">
            <FileText size={27} />
          </div>
          <input
            className="note-title"
            aria-label="Note title"
            value={note.title}
            placeholder="Untitled note"
            onChange={(e) => update(note.id, { title: e.target.value })}
          />
          <div className="note-meta">
            <span>
              Edited{" "}
              {new Date(note.updated).toLocaleString([], {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            <span>·</span>
            <span>
              {Math.max(1, Math.ceil(note.body.split(/\s+/).length / 200))} min
              read
            </span>
          </div>
          <div className="note-tags">
            {meta.tags.map((t) => (
              <span className="tag" key={t}>
                #{t}
              </span>
            ))}
          </div>
        </div>
        {editing && (
          <div className="formatbar">
            <button title="Bold" onClick={() => format("**", "**")}>
              <b>B</b>
            </button>
            <button title="Italic" onClick={() => format("*", "*")}>
              <i>I</i>
            </button>
            <button title="Inline code" onClick={() => format("`", "`")}>
              {"< >"}
            </button>
            <button title="Heading" onClick={() => format("## ")}>
              H2
            </button>
            <button title="Task" onClick={() => format("- [ ] ")}>
              ☑
            </button>
            <span>
              Markdown <span> / for blocks</span>
            </span>
          </div>
        )}
        {editing && sourceDiagrams.length > 0 && (
          <section
            className="source-diagrams"
            aria-label="Diagrams in this note"
          >
            <h3>Diagrams</h3>
            <p>
              Edit diagrams visually here. Their Markdown data remains in the
              source below.
            </p>
            {sourceDiagrams.map((block, index) => (
              <Render
                key={block.id || index}
                note={{ ...note, body: block.source }}
                notes={notes}
                open={open}
                offset={block.start}
              />
            ))}
          </section>
        )}
        {editing && (
          <div className="editor-wrap">
            <textarea
              ref={input}
              aria-label="Markdown source"
              spellCheck={false}
              value={note.body}
              placeholder="Start writing, or type / for a template…"
              onChange={(e) => {
                update(note.id, { body: e.target.value });
                detect(e.target.value, e.target.selectionStart);
              }}
              onClick={() => setCompletion(null)}
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
                  (e.shiftKey && ["ArrowUp", "ArrowDown"].includes(e.key)) ||
                  ((e.metaKey || e.ctrlKey) &&
                    ["a", "ArrowUp", "ArrowDown"].includes(e.key))
                ) {
                  setCompletion(null);
                  return;
                }
                if (completion && options.length) {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setChoice((p) => (p + 1) % options.length);
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setChoice((p) => (p - 1 + options.length) % options.length);
                  }
                  if (e.key === "Enter" || e.key === "Tab") {
                    e.preventDefault();
                    choose(options[choice] || options[0]);
                  }
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    setCompletion(null);
                  }
                }
                if ((e.metaKey || e.ctrlKey) && e.key === "b") {
                  e.preventDefault();
                  format("**", "**");
                }
              }}
            />
            {completion && options.length > 0 && (
              <div
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
        )}
        {blockMode && (
          <BlockEditor
            note={note}
            notes={notes}
            tags={tags}
            update={update}
            open={open}
            Render={Render}
            positionCompletion={completionPosition}
          />
        )}
        <div
          id={"render-" + note.id}
          className={"prose " + (editing || blockMode ? "hidden-render" : "")}
        >
          <Render note={note} notes={notes} open={open} />
        </div>
        <div className="relationships">
          <div>
            <Link size={14} />
            <strong>Connected notes</strong>
            <span>{meta.links.length + backlinks.length}</span>
          </div>
          {!meta.links.length && !backlinks.length ? (
            <p>Type @ while editing to connect this note to another idea.</p>
          ) : (
            <div className="relationship-links">
              {meta.links.map((id) => (
                <button key={"out" + id} onClick={() => open(id)}>
                  <ArrowUpRight size={13} />
                  {notes.find((n) => n.id === id)?.title || "Missing note"}
                  <small>outgoing</small>
                </button>
              ))}
              {backlinks.map((n) => (
                <button key={"in" + n.id} onClick={() => open(n.id)}>
                  <Link size={13} />
                  {n.title}
                  <small>backlink</small>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="pane-status">
        <span>Markdown</span>
        <span>
          {note.body.trim().split(/\s+/).filter(Boolean).length} words ·{" "}
          {note.body.length} characters
        </span>
      </div>
    </article>
  );
}
createRoot(document.getElementById("root")).render(<WorkspaceGate App={App} />);
