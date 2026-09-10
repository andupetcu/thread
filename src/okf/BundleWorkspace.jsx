import React, {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Archive,
  BookOpen,
  CheckCircle2,
  Download,
  FilePlus2,
  FileText,
  FolderArchive,
  GitBranch,
  HeartPulse,
  History,
  List,
  Network,
  Pencil,
  RefreshCw,
  Save,
} from "lucide-react";
import Render, { EditContext } from "../Render";
import { clearPersistedDiagramDrafts } from "../diagram/recovery.js";
import { clearPersistedMindMapDrafts } from "../mindmap/recovery.js";
import { api } from "../storage/api";
import ConceptMetadata from "./ConceptMetadata";
import BundleTransfer from "./BundleTransfer";
import { parseDocument, patchFrontmatter } from "../../shared/okf/document.mjs";
import {
  listMarkdownReferences,
  resolveBundleReference,
} from "../../shared/okf/paths.mjs";
import { bundleExportWarnings, exportPortableBundle } from "./export-portable";
import "./okf.css";

const BlockEditor = lazy(() => import("../BlockEditor"));

function TextAssetPreview({ entry }) {
  const text = useMemo(() => {
    if (
      !/\.(txt|json|ya?ml|csv|tsv|sql|py|js|ts|css|html?|xml|sh|toml|ini)$/i.test(
        entry.path,
      ) ||
      typeof entry.data !== "string" ||
      entry.data.length > 175000
    )
      return null;
    try {
      const bytes = Uint8Array.from(atob(entry.data), (char) =>
        char.charCodeAt(0),
      );
      if (bytes.includes(0)) return null;
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return null;
    }
  }, [entry.path, entry.data]);
  return text === null ? null : (
    <pre className="okf-text-asset" aria-label="Text asset preview">
      {text}
    </pre>
  );
}
const unwrap = (result) => result?.bundle || result;
const textValue = (value, fallback) =>
  typeof value === "string" && value.trim() ? value : fallback;
const titleOf = (entry) =>
  textValue(entry.metadata?.title, "") ||
  entry.body?.match(/^#{1,6}\s+(.+)$/m)?.[1] ||
  entry.path.split("/").at(-1).replace(/\.md$/i, "");
const isConcept = (entry) =>
  entry.kind === "document" && !/(^|\/)(index|log)\.md$/i.test(entry.path);
function mergedSource(entry) {
  const patched = patchFrontmatter(
    entry.source || entry.body || "",
    entry.metadata || {},
    { path: entry.path },
  );
  const parsed = parseDocument(patched, { path: entry.path });
  return (
    patched.slice(0, patched.length - parsed.body.length) + (entry.body || "")
  );
}

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob),
    anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function BundleSidebar({
  notes,
  activeId,
  onOpen,
  onError,
  workspaceRevision,
}) {
  const [bundles, setBundles] = useState([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [copy, setCopy] = useState(false);
  const [selected, setSelected] = useState([]);
  const load = () =>
    api("/okf/bundles")
      .then((data) => setBundles(data.bundles || data || []))
      .catch((error) => onError(error.message));
  useEffect(() => {
    void load();
  }, [workspaceRevision]);
  async function create() {
    try {
      const result = await api("/okf/bundles", {
        method: "POST",
        body: {
          name: name.trim(),
          ...(copy ? { sourceNoteIds: selected } : {}),
        },
      });
      const bundle = unwrap(result);
      setCreating(false);
      setName("");
      setSelected([]);
      setCopy(false);
      await load();
      onOpen(bundle.id);
    } catch (error) {
      onError(error.message);
    }
  }
  return (
    <section className="okf-sidebar" aria-label="Knowledge bundles">
      <div className="section-label">
        Knowledge bundles{" "}
        <button
          aria-label="Create knowledge bundle"
          onClick={() => setCreating(true)}
        >
          <FilePlus2 size={14} />
        </button>
      </div>
      <div className="okf-bundle-list">
        {bundles.map((bundle) => (
          <button
            key={bundle.id}
            className={activeId === bundle.id ? "active" : ""}
            aria-label={bundle.name}
            onClick={() => onOpen(bundle.id)}
          >
            <Archive size={14} />
            <span>{bundle.name}</span>
          </button>
        ))}
        {!bundles.length && <p className="empty-small">No bundles yet.</p>}
      </div>
      {creating && (
        <div className="okf-dialog-backdrop">
          <section
            className="okf-dialog"
            role="dialog"
            aria-label="Create knowledge bundle"
          >
            <header>
              <h2>Create knowledge bundle</h2>
              <button
                aria-label="Close create bundle"
                onClick={() => setCreating(false)}
              >
                ×
              </button>
            </header>
            <label>
              Bundle name
              <input
                aria-label="Bundle name"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="okf-check">
              <input
                type="checkbox"
                checked={copy}
                onChange={(e) => setCopy(e.target.checked)}
              />
              Copy selected notes
            </label>
            {copy && (
              <div className="okf-note-choices">
                {notes.map((note) => (
                  <label key={note.id}>
                    <input
                      type="checkbox"
                      checked={selected.includes(note.id)}
                      onChange={() =>
                        setSelected((items) =>
                          items.includes(note.id)
                            ? items.filter((id) => id !== note.id)
                            : [...items, note.id],
                        )
                      }
                    />
                    {note.title}
                  </label>
                ))}
              </div>
            )}
            <button
              className="primary"
              disabled={!name.trim() || (copy && !selected.length)}
              onClick={create}
            >
              {copy ? "Create from selected notes" : "Create empty bundle"}
            </button>
          </section>
        </div>
      )}
    </section>
  );
}

function EntryTree({ entries, selected, onSelect }) {
  return (
    <div className="okf-tree" role="tree">
      {[...entries]
        .sort((a, b) => a.path.localeCompare(b.path))
        .map((entry) => (
          <button
            role="treeitem"
            key={entry.path}
            aria-label={entry.path}
            className={selected === entry.path ? "active" : ""}
            onClick={() => onSelect(entry.path)}
          >
            {entry.kind === "asset" ? (
              <FolderArchive size={14} />
            ) : (
              <FileText size={14} />
            )}
            <span>{entry.path}</span>
            {entry.managed && <small>managed</small>}
          </button>
        ))}
    </div>
  );
}

function ReviewState({ entry }) {
  return (
    <span className="okf-review-state">
      <span>
        Historical trust: {textValue(entry.typed?.trustTier, "unverified")}
      </span>
      {entry.changedSinceReview && <strong>Changed since review</strong>}
      {entry.sourceChanged && <strong>Source note changed</strong>}
    </span>
  );
}

function ConceptList({ entries, diagnostics, onSelect }) {
  return (
    <div className="okf-list">
      <table>
        <thead>
          <tr>
            <th>Path</th>
            <th>Type</th>
            <th>Status</th>
            <th>Review</th>
          </tr>
        </thead>
        <tbody>
          {entries.filter(isConcept).map((entry) => {
            const issues = diagnostics.filter((d) => d.path === entry.path);
            return (
              <tr key={entry.path} onClick={() => onSelect(entry.path)}>
                <td>
                  <button>{entry.path}</button>
                </td>
                <td>{textValue(entry.metadata?.type, "Needs type")}</td>
                <td>{textValue(entry.metadata?.status, "stable")}</td>
                <td>
                  <ReviewState entry={entry} />
                  {issues.length
                    ? `${issues.length} issue${issues.length === 1 ? "" : "s"}`
                    : "Healthy"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ConceptGraph({ entries, onSelect }) {
  const concepts = entries.filter(isConcept);
  const paths = new Set(entries.map((entry) => entry.path));
  const links = concepts.flatMap((entry) => [
    ...listMarkdownReferences(entry.body || "").flatMap((reference) => {
      const resolved = resolveBundleReference(entry.path, reference.url);
      const to = resolved.path?.split(/[?#]/)[0];
      return to
        ? [{ from: entry.path, to, kind: "link", broken: !paths.has(to) }]
        : [];
    }),
    ...(Array.isArray(entry.metadata?.sources)
      ? entry.metadata.sources
      : []
    ).flatMap((source) => {
      const resource = typeof source === "string" ? source : source?.resource;
      if (typeof resource !== "string" || !resource) return [];
      const resolved = resolveBundleReference(entry.path, resource);
      const from = resolved.path?.split(/[?#]/)[0] || resource;
      return [
        {
          from,
          to: entry.path,
          kind: "source",
          broken: !!resolved.path && !paths.has(from),
        },
      ];
    }),
  ]);
  const positions = new Map(
    concepts.map((concept, index) => [
      concept.path,
      { x: 105 + (index % 4) * 190, y: 80 + Math.floor(index / 4) * 115 },
    ]),
  );
  return (
    <div className="okf-graph" aria-label="Bundle relationship graph">
      <Network size={28} />
      <h2>Bundle relationships</h2>
      <svg
        className="okf-graph-canvas"
        viewBox="0 0 820 500"
        role="img"
        aria-label={`${concepts.length} concepts and ${links.length} relationships`}
      >
        {links.map((link, index) => {
          const from = positions.get(link.from),
            to = positions.get(link.to);
          return from && to ? (
            <line
              key={index}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              className={`${link.kind} ${link.broken ? "broken" : ""}`}
            />
          ) : null;
        })}
        {concepts.map((concept) => {
          const point = positions.get(concept.path);
          return (
            <g
              key={concept.path}
              transform={`translate(${point.x - 70} ${point.y - 26})`}
              role="button"
              tabIndex="0"
              onClick={() => onSelect(concept.path)}
              onKeyDown={(event) =>
                event.key === "Enter" && onSelect(concept.path)
              }
            >
              <rect width="140" height="52" rx="6" />
              <text x="70" y="22">
                {titleOf(concept).slice(0, 20)}
              </text>
              <text x="70" y="39" className="type">
                {textValue(concept.metadata?.type, "unknown type")}
              </text>
            </g>
          );
        })}
      </svg>
      <section className="okf-edges">
        {links.length ? (
          links.map((link, index) => (
            <p key={`${link.from}-${link.to}-${index}`}>
              <strong>{link.from}</strong>
              <span>{link.kind === "source" ? "supports" : "links to"}</span>
              <strong>{link.to}</strong>
              {link.broken && <em>unresolved</em>}
            </p>
          ))
        ) : (
          <p>No document or source relationships yet.</p>
        )}
      </section>
    </div>
  );
}

function HealthView({ bundle, onSelect }) {
  const diagnostics = bundle.diagnostics || [];
  return (
    <div className="okf-health">
      <header>
        <HeartPulse size={25} />
        <div>
          <h2>Bundle health</h2>
          <p>
            {diagnostics.length
              ? `${diagnostics.length} item${diagnostics.length === 1 ? "" : "s"} need attention.`
              : "No maintenance issues found."}
          </p>
        </div>
      </header>
      {bundle.entries.filter(isConcept).map((entry) => (
        <button key={entry.path} onClick={() => onSelect(entry.path)}>
          <strong>{entry.path}</strong>
          <ReviewState entry={entry} />
        </button>
      ))}
      {diagnostics.map((item, index) => (
        <button
          key={`${item.path}-${index}`}
          onClick={() => item.path && onSelect(item.path)}
        >
          <span className={`okf-severity ${item.severity || "warning"}`} />{" "}
          <strong>{item.path || "Bundle"}</strong>
          <span>{item.message || item.code}</span>
        </button>
      ))}
    </div>
  );
}

export default function BundleWorkspace({
  bundleId,
  navigationTarget,
  workspaceRevision,
  notes,
  onError,
  onBundleName,
  onDirtyChange,
  onBusyChange,
  onOpenNote,
}) {
  const [bundle, setBundle] = useState(null),
    [path, setPath] = useState("");
  const [mode, setMode] = useState("tree"),
    [editing, setEditing] = useState(false);
  const [sourceMode, setSourceMode] = useState(false),
    [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false),
    [transfer, setTransfer] = useState(false);
  const [rename, setRename] = useState(null),
    [renamePreview, setRenamePreview] = useState(null);
  const [indexPreview, setIndexPreview] = useState(null),
    [newPath, setNewPath] = useState("");
  const [history, setHistory] = useState(null),
    [portable, setPortable] = useState(null),
    [historyPreview, setHistoryPreview] = useState(null);
  const latestRequest = useRef(0);
  const operationRunning = useRef(false);
  const localState = useRef({});
  const [remoteChanged, setRemoteChanged] = useState(false);
  const [conflict, setConflict] = useState(null);
  async function load() {
    const request = ++latestRequest.current;
    try {
      const next = unwrap(
        await api(`/okf/bundles/${encodeURIComponent(bundleId)}`),
      );
      if (request !== latestRequest.current) return;
      setBundle(next);
      setRemoteChanged(false);
      setConflict(null);
      onBundleName(next.name);
      setPath((current) =>
        next.entries.some((entry) => entry.path === current)
          ? current
          : next.entries.find(isConcept)?.path || next.entries[0]?.path || "",
      );
    } catch (error) {
      onError(error.message);
    }
  }
  useEffect(() => {
    setBundle(null);
    setPath("");
    load();
  }, [bundleId]);
  const entry = bundle?.entries.find((item) => item.path === path);
  useEffect(() => {
    if (!navigationTarget?.noteId) return;
    const target = bundle?.entries.find(
      (item) => item.noteId === navigationTarget.noteId,
    );
    if (!target) return;
    setPath(target.path);
    setMode("tree");
    if (navigationTarget.blockId) {
      const timer = setTimeout(() => {
        const element = document.querySelector(
          `.okf-document [data-block-id="${CSS.escape(navigationTarget.blockId)}"]`,
        );
        element?.scrollIntoView({ block: "center" });
        element?.focus();
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [bundle?.id, navigationTarget]);
  useEffect(() => {
    if (entry) setDraft({ ...entry, metadata: { ...(entry.metadata || {}) } });
    setEditing(false);
    setSourceMode(false);
  }, [entry?.path, entry?.revision]);
  const updateDraft = (_id, patch) =>
    setDraft((current) => ({ ...current, ...patch }));
  const renderNotes = useMemo(() => {
    const related = (bundle?.entries || [])
      .filter((item) => item.kind === "document")
      .map((item) => ({ ...item, id: item.noteId, title: titleOf(item) }));
    return entry && draft
      ? [
          ...notes,
          ...related.filter((item) => item.id !== entry.noteId),
          { ...draft, id: entry.noteId, title: titleOf(draft) },
        ]
      : [...notes, ...related];
  }, [notes, bundle, entry?.noteId, draft]);
  const dirty =
    entry &&
    draft &&
    (draft.body !== entry.body ||
      draft.source !== entry.source ||
      JSON.stringify(draft.metadata || {}) !==
        JSON.stringify(entry.metadata || {}));
  localState.current = { dirty: !!dirty, saving, bundle, path };
  useEffect(
    () => onDirtyChange?.(!!dirty || saving),
    [dirty, saving, onDirtyChange],
  );
  useEffect(() => {
    let cancelled = false;
    if (!bundleId) return;
    api(`/okf/bundles/${encodeURIComponent(bundleId)}`)
      .then((result) => {
        if (cancelled) return;
        const next = unwrap(result),
          current = localState.current;
        if (
          !current.bundle ||
          current.bundle.id !== next.id ||
          next.revision < current.bundle.revision ||
          (next.revision === current.bundle.revision &&
            JSON.stringify(next.entries) ===
              JSON.stringify(current.bundle.entries))
        )
          return;
        if (current.dirty || current.saving) {
          setRemoteChanged(true);
          return;
        }
        const selected = current.bundle.entries.find(
          (item) => item.path === current.path,
        );
        const match = next.entries.find((item) =>
          selected?.noteId
            ? item.noteId === selected.noteId
            : item.path === current.path,
        );
        setBundle(next);
        setPath(
          match?.path ||
            next.entries.find(isConcept)?.path ||
            next.entries[0]?.path ||
            "",
        );
        setRemoteChanged(false);
        setRenamePreview(null);
        setIndexPreview(null);
      })
      .catch((error) => {
        if (!cancelled) onError(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceRevision, bundleId]);
  useEffect(() => {
    setRenamePreview(null);
  }, [bundle?.revision]);
  async function runOperation(task) {
    if (operationRunning.current || !requireClean()) return;
    operationRunning.current = true;
    setSaving(true);
    onBusyChange?.(true);
    try {
      await task();
    } finally {
      operationRunning.current = false;
      setSaving(false);
      onBusyChange?.(false);
    }
  }
  function requireClean() {
    if (saving) return false;
    if (dirty) {
      onError("Save your draft before this action.");
      return false;
    }
    return true;
  }
  useEffect(() => {
    const guard = (event) => {
      if (!dirty && !saving) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty, saving]);
  function selectPath(next) {
    if (
      next !== path &&
      dirty &&
      !confirm("Discard the unsaved concept changes?")
    )
      return;
    setPath(next);
  }
  async function save(latest = null) {
    if (saving || operationRunning.current) return;
    // React click events are not revision snapshots.
    const base = latest?.entries ? latest : bundle;
    const baseEntry = base.entries.find((item) => item.path === entry.path);
    if (!baseEntry)
      return onError(
        "This path moved or was removed. Download your draft before choosing another document.",
      );
    operationRunning.current = true;
    setSaving(true);
    onBusyChange?.(true);
    try {
      const source = sourceMode ? draft.source : mergedSource(draft);
      const parsed = parseDocument(source, { path: entry.path });
      if (parsed.diagnostics.some((item) => item.severity === "error"))
        throw new Error("Repair the YAML errors before saving this concept.");
      const payload = {
        path: entry.path,
        source,
        expectedRevision: base.revision,
        baseRevision: baseEntry.revision,
      };
      const next = unwrap(
        await api(`/okf/bundles/${bundle.id}/documents`, {
          method: "PUT",
          body: payload,
        }),
      );
      setBundle(next);
      setDraft({ ...next.entries.find((item) => item.path === entry.path) });
      const persisted = next.entries.find((item) => item.path === entry.path);
      clearPersistedDiagramDrafts(
        persisted.noteId,
        persisted.body,
        localStorage,
      );
      clearPersistedMindMapDrafts(
        persisted.noteId,
        persisted.body,
        localStorage,
      );
      setConflict(null);
      setRemoteChanged(false);
      setEditing(false);
      setSourceMode(false);
    } catch (error) {
      if (error.status === 409) {
        try {
          const latest = unwrap(await api(`/okf/bundles/${bundle.id}`));
          setConflict({
            latest,
            source: sourceMode ? draft.source : mergedSource(draft),
            path: entry.path,
          });
        } catch (refreshError) {
          onError(refreshError.message);
        }
      } else onError(error.message);
    } finally {
      operationRunning.current = false;
      setSaving(false);
      onBusyChange?.(false);
    }
  }
  const resolveImage = useMemo(
    () => (url) => {
      if (!entry) return url;
      const target = resolveBundleReference(entry.path, url);
      return (
        bundle.entries.find(
          (item) => item.path === target.path?.split(/[?#]/)[0],
        )?.url || url
      );
    },
    [bundle, entry?.path],
  );
  const BundleRender = useMemo(
    () => (props) => <Render {...props} resolveImage={resolveImage} />,
    [resolveImage],
  );
  if (!bundle)
    return <div className="okf-loading">Opening knowledge bundle…</div>;
  function followBundleLink(event) {
    const anchor = event.target.closest("a");
    if (!anchor) return;
    const href = anchor.getAttribute("href");
    if (!href || /^(?:https?:|mailto:|#)/.test(href)) return;
    const target = resolveBundleReference(
      entry.path,
      href.replace(/\/(?=[?#]|$)/, "/index.md"),
    );
    const targetPath = target.path?.split(/[?#]/)[0];
    if (bundle.entries.some((item) => item.path === targetPath)) {
      event.preventDefault();
      selectPath(targetPath);
    }
  }
  function openNote(id) {
    const linked = bundle.entries.find(
      (item) => item.noteId === id || item.sourceNoteId === id,
    );
    if (linked) selectPath(linked.path);
    else onOpenNote?.(id);
  }
  return (
    <section className="okf-workspace" inert={saving ? true : undefined}>
      <header className="okf-toolbar">
        <div>
          <BookOpen size={18} />
          <strong>{bundle.name}</strong>
          <span>revision {bundle.revision}</span>
        </div>
        <div className="okf-view-switch">
          {[
            ["tree", List, "Tree"],
            ["list", FileText, "List"],
            ["graph", GitBranch, "Graph"],
            ["health", HeartPulse, "Health"],
          ].map(([value, Icon, label]) => (
            <button
              key={value}
              className={mode === value ? "active" : ""}
              onClick={() => setMode(value)}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
          <button
            aria-label="Reload bundle"
            onClick={() => {
              void runOperation(load);
            }}
          >
            <RefreshCw size={14} />
          </button>
        </div>
        <div>
          <button
            onClick={() => {
              if (requireClean()) setTransfer(true);
            }}
          >
            Import
          </button>
          <button
            onClick={() =>
              runOperation(async () => {
                if (!requireClean()) return;
                try {
                  const blob = await api(`/okf/bundles/${bundle.id}/export`);
                  const warnings = bundleExportWarnings(bundle);
                  if (warnings.length)
                    setPortable({ blob, warnings, original: true });
                  else
                    saveBlob(
                      blob,
                      `${bundle.name.replace(/[^\w.-]+/g, "-")}.zip`,
                    );
                } catch (error) {
                  onError(error.message);
                }
              })
            }
          >
            <Download size={14} />
            Export original ZIP
          </button>
          <button
            onClick={() =>
              runOperation(async () => {
                if (!requireClean()) return;
                try {
                  setPortable(await exportPortableBundle(bundle));
                } catch (error) {
                  onError(error.message);
                }
              })
            }
          >
            <Download size={14} />
            Export portable ZIP
          </button>
        </div>
      </header>
      {remoteChanged && (
        <p className="okf-remote-notice" role="status">
          Changes arrived from another workspace session. Your local draft is
          retained.
        </p>
      )}
      {mode === "health" ? (
        <HealthView
          bundle={bundle}
          onSelect={(value) => {
            selectPath(value);
            setMode("tree");
          }}
        />
      ) : mode === "graph" ? (
        <ConceptGraph
          entries={bundle.entries}
          onSelect={(value) => {
            selectPath(value);
            setMode("tree");
          }}
        />
      ) : mode === "list" ? (
        <ConceptList
          entries={bundle.entries}
          diagnostics={bundle.diagnostics || []}
          onSelect={(value) => {
            selectPath(value);
            setMode("tree");
          }}
        />
      ) : (
        <div className="okf-main">
          <aside className="okf-browser">
            <div className="okf-browser-title">
              <span>{bundle.entries.length} files</span>
              <button
                aria-label="New concept"
                onClick={() => {
                  if (requireClean()) setNewPath("concepts/new-concept.md");
                }}
              >
                <FilePlus2 size={14} />
              </button>
            </div>
            <EntryTree
              entries={bundle.entries}
              selected={path}
              onSelect={selectPath}
            />
          </aside>
          <main className="okf-document">
            {entry ? (
              entry.kind === "asset" ? (
                <div className="okf-asset">
                  <FolderArchive size={40} />
                  <h2>{entry.path}</h2>
                  {/\.(png|jpe?g|gif|webp|svg)$/i.test(entry.path) && (
                    <img src={entry.url} alt={entry.path} />
                  )}
                  <TextAssetPreview entry={entry} />
                  <a href={entry.url} download>
                    Download asset
                  </a>
                  <p>HTML, code, skills, and executor files remain inert.</p>
                </div>
              ) : (
                <EditContext.Provider value={updateDraft}>
                  <header className="okf-document-head">
                    <div>
                      <small>{entry.path}</small>
                      <h1>{titleOf(draft || entry)}</h1>
                      {isConcept(entry) && <ReviewState entry={entry} />}
                    </div>
                    <div>
                      <button
                        onClick={() =>
                          runOperation(async () => {
                            if (!requireClean()) return;
                            if (history) return setHistory(null);
                            try {
                              const result = await api(
                                `/notes/${entry.noteId}/history`,
                              );
                              setHistory(
                                result.history || result.versions || [],
                              );
                            } catch (error) {
                              onError(error.message);
                            }
                          })
                        }
                      >
                        <History size={14} />
                        History
                      </button>
                      {entry.managed && (
                        <button
                          onClick={() =>
                            runOperation(async () => {
                              if (!requireClean()) return;
                              try {
                                setBundle(
                                  unwrap(
                                    await api(
                                      `/okf/bundles/${bundle.id}/manual`,
                                      {
                                        method: "POST",
                                        body: {
                                          path: entry.path,
                                          expectedRevision: bundle.revision,
                                        },
                                      },
                                    ),
                                  ),
                                );
                              } catch (error) {
                                onError(error.message);
                              }
                            })
                          }
                        >
                          Edit managed file
                        </button>
                      )}
                      {entry.sourceChanged && (
                        <button
                          onClick={() =>
                            runOperation(async () => {
                              if (!requireClean()) return;
                              try {
                                const preview = await api(
                                  `/okf/bundles/${bundle.id}/refresh/preview`,
                                  {
                                    method: "POST",
                                    body: { path: entry.path },
                                  },
                                );
                                if (
                                  confirm(
                                    "Replace this copy with the updated source note?",
                                  )
                                )
                                  setBundle(
                                    unwrap(
                                      await api(
                                        `/okf/bundles/${bundle.id}/refresh`,
                                        {
                                          method: "POST",
                                          body: {
                                            path: entry.path,
                                            expectedRevision: bundle.revision,
                                            sourceNoteRevision:
                                              preview.sourceNoteRevision,
                                          },
                                        },
                                      ),
                                    ),
                                  );
                              } catch (error) {
                                onError(error.message);
                              }
                            })
                          }
                        >
                          Refresh from source note
                        </button>
                      )}
                      <button
                        onClick={() => {
                          if (requireClean()) setRename(entry.path);
                        }}
                      >
                        <Pencil size={14} />
                        Rename or move
                      </button>
                      {isConcept(entry) && (
                        <button
                          onClick={() =>
                            runOperation(async () => {
                              if (!requireClean()) return;
                              try {
                                setBundle(
                                  unwrap(
                                    await api(
                                      `/okf/bundles/${bundle.id}/review`,
                                      {
                                        method: "POST",
                                        body: {
                                          path: entry.path,
                                          expectedRevision: bundle.revision,
                                        },
                                      },
                                    ),
                                  ),
                                );
                              } catch (error) {
                                onError(error.message);
                              }
                            })
                          }
                        >
                          <CheckCircle2 size={14} />
                          Review concept
                        </button>
                      )}
                      <button
                        onClick={() =>
                          runOperation(async () => {
                            if (!requireClean()) return;
                            try {
                              setIndexPreview(
                                await api(
                                  `/okf/bundles/${bundle.id}/index/preview`,
                                  { method: "POST", body: {} },
                                ),
                              );
                            } catch (error) {
                              onError(error.message);
                            }
                          })
                        }
                      >
                        Manage index
                      </button>
                    </div>
                  </header>
                  {history && (
                    <div className="okf-history">
                      <strong>Document history</strong>
                      {history.length ? (
                        history.map((version) => (
                          <span
                            key={
                              version.id ||
                              version.note?.revision ||
                              version.revision
                            }
                          >
                            Revision{" "}
                            {version.note?.revision ?? version.revision} ·{" "}
                            {new Date(
                              version.savedAt ||
                                version.updated ||
                                version.created,
                            ).toLocaleString()}
                            <button onClick={() => setHistoryPreview(version)}>
                              Compare
                            </button>
                            {version.id != null && (
                              <button
                                onClick={() =>
                                  runOperation(async () => {
                                    if (!requireClean()) return;
                                    if (
                                      !confirm(
                                        `Restore revision ${version.note?.revision ?? version.revision}?`,
                                      )
                                    )
                                      return;
                                    try {
                                      await api(
                                        `/notes/${entry.noteId}/history/${version.id}/restore`,
                                        { method: "POST", body: {} },
                                      );
                                      setHistory(null);
                                      setHistoryPreview(null);
                                      await load();
                                    } catch (error) {
                                      onError(error.message);
                                    }
                                  })
                                }
                              >
                                Restore
                              </button>
                            )}
                          </span>
                        ))
                      ) : (
                        <span>No earlier versions.</span>
                      )}
                    </div>
                  )}
                  <div className="okf-editor-tabs">
                    <button
                      className={!sourceMode ? "active" : ""}
                      onClick={() => {
                        if (sourceMode) {
                          try {
                            const parsed = parseDocument(draft.source, {
                              path: entry.path,
                            });
                            if (
                              parsed.diagnostics.some(
                                (item) => item.severity === "error",
                              )
                            )
                              throw new Error(
                                "Repair the YAML errors before returning to the body editor.",
                              );
                            setDraft((current) => ({
                              ...current,
                              body: parsed.body,
                              metadata: parsed.metadata || current.metadata,
                            }));
                            setSourceMode(false);
                          } catch (error) {
                            onError(error.message);
                          }
                        }
                      }}
                    >
                      Body
                    </button>
                    <button
                      className={sourceMode ? "active" : ""}
                      onClick={() => {
                        if (sourceMode) return;
                        try {
                          setDraft((current) => ({
                            ...current,
                            source:
                              current.body === entry.body &&
                              JSON.stringify(current.metadata) ===
                                JSON.stringify(entry.metadata)
                                ? current.source
                                : mergedSource(current),
                          }));
                          setSourceMode(true);
                        } catch (error) {
                          onError(error.message);
                        }
                      }}
                    >
                      Full source
                    </button>
                    <span />
                    <button onClick={() => setEditing((value) => !value)}>
                      {editing ? "Preview body" : "Edit body"}
                    </button>
                  </div>
                  <div className="okf-authoring">
                    <article className="okf-concept">
                      {sourceMode ? (
                        <textarea
                          aria-label="Full concept source"
                          className="okf-source"
                          value={draft?.source || ""}
                          onChange={(e) =>
                            setDraft((current) => ({
                              ...current,
                              source: e.target.value,
                            }))
                          }
                        />
                      ) : editing ? (
                        <Suspense fallback={<p>Opening editor…</p>}>
                          <textarea
                            className="okf-body-source"
                            aria-label="Concept body"
                            value={draft?.body || ""}
                            onChange={(e) =>
                              updateDraft(entry.noteId, {
                                body: e.target.value,
                              })
                            }
                          />
                          <BlockEditor
                            note={{
                              ...draft,
                              id: entry.noteId,
                              title: titleOf(draft),
                            }}
                            notes={renderNotes}
                            tags={[]}
                            update={updateDraft}
                            open={openNote}
                            Render={BundleRender}
                            positionCompletion={() => ({})}
                          />
                        </Suspense>
                      ) : (
                        <div
                          className="prose okf-prose"
                          onClick={followBundleLink}
                        >
                          <Render
                            note={{
                              ...entry,
                              id: entry.noteId,
                              body: draft?.body || "",
                            }}
                            notes={renderNotes}
                            open={openNote}
                            resolveImage={resolveImage}
                          />
                        </div>
                      )}
                    </article>
                    {isConcept(entry) && !sourceMode && (
                      <ConceptMetadata
                        metadata={draft?.metadata || {}}
                        onChange={(metadata) =>
                          setDraft((current) => ({ ...current, metadata }))
                        }
                      />
                    )}
                  </div>
                  {dirty && (
                    <div className="okf-savebar">
                      <span>Changes stay local until you save.</span>
                      <button
                        className="primary"
                        disabled={saving}
                        onClick={save}
                      >
                        <Save size={14} />
                        {saving ? "Saving…" : "Save concept"}
                      </button>
                    </div>
                  )}
                </EditContext.Provider>
              )
            ) : (
              <div className="okf-asset">
                <BookOpen size={40} />
                <h2>This bundle is empty</h2>
                <p>Create a concept or import a folder to begin.</p>
              </div>
            )}
          </main>
        </div>
      )}
      {conflict && (
        <div className="okf-dialog-backdrop">
          <section
            className="okf-dialog okf-history-preview"
            role="dialog"
            aria-label="Resolve bundle conflict"
          >
            <header>
              <h2>Resolve bundle conflict</h2>
              <button
                aria-label="Close conflict comparison"
                onClick={() => setConflict(null)}
              >
                ×
              </button>
            </header>
            <p>
              The saved document changed elsewhere. Compare both canonical
              versions before replacing the latest version with your draft.
            </p>
            <div>
              <section>
                <h3>Latest saved source</h3>
                <pre>
                  {conflict.latest.entries.find(
                    (item) => item.path === conflict.path,
                  )?.source || "This path has moved or was removed."}
                </pre>
              </section>
              <section>
                <h3>Your local draft</h3>
                <pre>{conflict.source}</pre>
              </section>
            </div>
            <button
              onClick={() =>
                saveBlob(
                  new Blob([conflict.source], {
                    type: "text/markdown;charset=utf-8",
                  }),
                  conflict.path.split("/").at(-1),
                )
              }
            >
              Download my draft
            </button>
            <button
              disabled={
                !conflict.latest.entries.some(
                  (item) => item.path === conflict.path,
                )
              }
              onClick={() => save(conflict.latest)}
            >
              Reapply my draft to latest revision
            </button>
          </section>
        </div>
      )}
      {newPath && (
        <div className="okf-dialog-backdrop">
          <section
            className="okf-dialog"
            role="dialog"
            aria-label="New concept"
          >
            <header>
              <h2>New concept</h2>
              <button onClick={() => setNewPath("")}>×</button>
            </header>
            <label>
              Bundle path
              <input
                aria-label="Concept path"
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
              />
            </label>
            <button
              className="primary"
              onClick={() =>
                runOperation(async () => {
                  if (!requireClean()) return;
                  try {
                    const next = unwrap(
                      await api(`/okf/bundles/${bundle.id}/documents`, {
                        method: "POST",
                        body: {
                          path: newPath,
                          body: "# New concept\n",
                          metadata: { type: "concept", status: "draft" },
                          expectedRevision: bundle.revision,
                        },
                      }),
                    );
                    setBundle(next);
                    setPath(newPath);
                    setNewPath("");
                  } catch (error) {
                    onError(error.message);
                  }
                })
              }
            >
              Create concept
            </button>
          </section>
        </div>
      )}
      {rename && (
        <div className="okf-dialog-backdrop">
          <section
            className="okf-dialog"
            role="dialog"
            aria-label="Rename or move concept"
          >
            <header>
              <h2>Rename or move</h2>
              <button
                aria-label="Close rename preview"
                onClick={() => {
                  setRename(null);
                  setRenamePreview(null);
                }}
              >
                ×
              </button>
            </header>
            <label>
              New bundle path
              <input
                aria-label="New bundle path"
                value={rename}
                onChange={(e) => {
                  setRename(e.target.value);
                  setRenamePreview(null);
                }}
              />
            </label>
            <button
              onClick={() =>
                runOperation(async () => {
                  if (!requireClean()) return;
                  try {
                    const preview = await api(
                      `/okf/bundles/${bundle.id}/rename/preview`,
                      {
                        method: "POST",
                        body: {
                          from: entry.path,
                          to: rename,
                          expectedRevision: bundle.revision,
                        },
                      },
                    );
                    setRenamePreview({
                      ...preview,
                      from: entry.path,
                      to: rename,
                    });
                  } catch (error) {
                    onError(error.message);
                  }
                })
              }
            >
              Preview rename
            </button>
            {renamePreview &&
              renamePreview.to === rename &&
              renamePreview.revision === bundle.revision && (
                <div className="okf-change-preview">
                  <h3>References that will change</h3>
                  {(renamePreview.changes || []).map((change) => (
                    <div key={change.path}>
                      <strong>{change.path}</strong>
                      <pre>
                        {
                          renamePreview.entries?.find(
                            (item) =>
                              item.path ===
                              (change.path === renamePreview.from
                                ? renamePreview.to
                                : change.path),
                          )?.content
                        }
                      </pre>
                    </div>
                  ))}
                  {(renamePreview.ambiguous || []).map((item, index) => (
                    <p key={index}>
                      Manual repair needed: {item.path} · {item.field} ·{" "}
                      {String(item.value)}
                    </p>
                  ))}
                  <button
                    className="primary"
                    onClick={() =>
                      runOperation(async () => {
                        if (
                          !requireClean() ||
                          renamePreview.to !== rename ||
                          renamePreview.revision !== bundle.revision
                        )
                          return;
                        try {
                          const next = unwrap(
                            await api(`/okf/bundles/${bundle.id}/rename`, {
                              method: "POST",
                              body: {
                                from: renamePreview.from,
                                to: renamePreview.to,
                                expectedRevision: renamePreview.revision,
                              },
                            }),
                          );
                          setBundle(next);
                          setPath(rename);
                          setRename(null);
                          setRenamePreview(null);
                        } catch (error) {
                          onError(error.message);
                        }
                      })
                    }
                  >
                    Apply rename
                  </button>
                </div>
              )}
          </section>
        </div>
      )}
      {indexPreview && (
        <div className="okf-dialog-backdrop">
          <section
            className="okf-dialog"
            role="dialog"
            aria-label="Manage index"
          >
            <header>
              <h2>Manage index</h2>
              <button
                aria-label="Close index preview"
                onClick={() => setIndexPreview(null)}
              >
                ×
              </button>
            </header>
            <p>
              Review the deterministic index before replacing a manual index.
            </p>
            <pre>
              {indexPreview.source || indexPreview.after || "No index changes."}
            </pre>
            <button
              className="primary"
              onClick={() =>
                runOperation(async () => {
                  if (!requireClean()) return;
                  try {
                    setBundle(
                      unwrap(
                        await api(`/okf/bundles/${bundle.id}/index`, {
                          method: "POST",
                          body: { expectedRevision: bundle.revision },
                        }),
                      ),
                    );
                    setIndexPreview(null);
                  } catch (error) {
                    onError(error.message);
                  }
                })
              }
            >
              Apply generated index
            </button>
          </section>
        </div>
      )}
      {historyPreview && (
        <div className="okf-dialog-backdrop">
          <section
            className="okf-dialog okf-history-preview"
            role="dialog"
            aria-label="Compare document revision"
          >
            <header>
              <h2>
                Compare revision{" "}
                {historyPreview.note?.revision ?? historyPreview.revision}
              </h2>
              <button
                aria-label="Close history comparison"
                onClick={() => setHistoryPreview(null)}
              >
                ×
              </button>
            </header>
            <div>
              <section>
                <h3>Earlier version</h3>
                <pre>
                  {historyPreview.note?.okf?.source ??
                    historyPreview.source ??
                    historyPreview.note?.body ??
                    historyPreview.body ??
                    ""}
                </pre>
              </section>
              <section>
                <h3>Current version</h3>
                <pre>{entry?.source ?? entry?.body ?? ""}</pre>
              </section>
            </div>
          </section>
        </div>
      )}
      {transfer && (
        <BundleTransfer
          bundle={bundle}
          onBundle={(next) => {
            if (localState.current.bundle?.id === next.id) setBundle(next);
          }}
          onClose={() => setTransfer(false)}
          onError={onError}
        />
      )}
      {portable && (
        <div className="okf-dialog-backdrop">
          <section
            className="okf-dialog"
            role="dialog"
            aria-label="Portable export preview"
          >
            <header>
              <h2>Portable export preview</h2>
              <button onClick={() => setPortable(null)}>×</button>
            </header>
            {portable.warnings?.length ? (
              <>
                {portable.warnings.map((warning, index) => (
                  <p key={index}>{warning.message || warning}</p>
                ))}
              </>
            ) : (
              <p>All bundle references can be represented portably.</p>
            )}
            <button
              className="primary"
              onClick={() => {
                saveBlob(
                  portable.blob,
                  `${bundle.name.replace(/[^\w.-]+/g, "-")}${portable.original ? "" : "-portable"}.zip`,
                );
                setPortable(null);
              }}
            >
              Download portable ZIP
            </button>
          </section>
        </div>
      )}
    </section>
  );
}
