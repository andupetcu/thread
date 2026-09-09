import React, { useRef, useState } from "react";
import { api } from "../storage/api";

async function encoded(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

export default function BundleTransfer({ bundle, onBundle, onClose, onError }) {
  const input = useRef();
  const locked = useRef(false);
  const [preview, setPreview] = useState(null);
  const [staged, setStaged] = useState(null);
  const [stripRoot, setStripRoot] = useState(false);
  const [choices, setChoices] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function begin() {
    if (locked.current) return false;
    locked.current = true;
    setBusy(true);
    setError("");
    setPreview(null);
    setChoices({});
    return true;
  }
  function finish() {
    locked.current = false;
    setBusy(false);
  }
  function fail(error) {
    setError(error.message);
    onError?.(error.message);
  }
  async function loadPreview(payload, removeRoot) {
    const request = { ...payload, stripRoot: removeRoot };
    const result = await api(`/okf/bundles/${bundle.id}/import/preview`, {
      method: "POST",
      body: request,
    });
    setChoices(
      Object.fromEntries(
        (result.entries || [])
          .filter((entry) => entry.action === "conflict")
          .map((entry) => [entry.path, "keep"]),
      ),
    );
    setPreview({ ...result, request });
  }
  async function choose(fileList) {
    const files = [...fileList];
    if (!files.length || !begin()) return;
    setStaged(null);
    setStripRoot(false);
    try {
      const archive = files.length === 1 && /\.zip$/i.test(files[0].name);
      if (files.length > 2000) throw new Error("Choose at most 2,000 files.");
      const total = files.reduce((sum, file) => sum + file.size, 0);
      // Base64 must also fit the server's JSON request limit.
      if (total > 50 * 1024 * 1024)
        throw new Error(
          "This import exceeds the 50 MiB upload limit. Import a smaller ZIP or split the files into batches.",
        );
      if (!archive && files.some((file) => file.size > 20 * 1024 * 1024))
        throw new Error("Each imported file must be at most 20 MiB.");
      const payload = archive
        ? { zip: await encoded(files[0]) }
        : {
            files: await Promise.all(
              files.map(async (file) => ({
                path: file.webkitRelativePath || file.name,
                data: await encoded(file),
              })),
            ),
          };
      setStaged(payload);
      await loadPreview(payload, false);
    } catch (error) {
      fail(error);
    } finally {
      finish();
    }
  }
  async function changeRoot(value) {
    if (!staged || !begin()) return;
    setStripRoot(value);
    try {
      await loadPreview(staged, value);
    } catch (error) {
      fail(error);
    } finally {
      finish();
    }
  }
  async function apply() {
    if (!preview || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await api(`/okf/bundles/${bundle.id}/import`, {
        method: "POST",
        body: {
          ...preview.request,
          choices,
          expectedRevision: preview.revision,
        },
      });
      onBundle(result.bundle || result);
      onClose();
    } catch (error) {
      // Any failure requires a fresh preview, including stale bundle revisions.
      setPreview(null);
      setChoices({});
      fail(error);
    } finally {
      finish();
    }
  }
  return (
    <div className="okf-dialog-backdrop">
      <section
        className="okf-dialog"
        role="dialog"
        aria-label="Import bundle files"
        aria-busy={busy}
      >
        <header>
          <h2>Import bundle files</h2>
          <button onClick={onClose} disabled={busy} aria-label="Close import">
            ×
          </button>
        </header>
        <p>
          Select a ZIP or a folder. Thread previews every file and conflict
          before writing. Missing incoming files are retained.
        </p>
        <p>
          Up to 2,000 files, 20 MiB per extracted file, and 50 MiB per upload.
          ZIP contents are checked before import.
        </p>
        <div className="okf-transfer-picks">
          <button onClick={() => input.current?.click()} disabled={busy}>
            Choose ZIP or files
          </button>
          <label className="okf-file-button">
            Choose folder
            <input
              type="file"
              webkitdirectory=""
              multiple
              disabled={busy}
              onChange={(event) => {
                void choose(event.target.files);
                event.target.value = "";
              }}
            />
          </label>
          <input
            ref={input}
            hidden
            type="file"
            multiple
            disabled={busy}
            aria-label="Choose ZIP or files"
            onChange={(event) => {
              void choose(event.target.files);
              event.target.value = "";
            }}
          />
        </div>
        {staged && (
          <label className="okf-check">
            <input
              type="checkbox"
              checked={stripRoot}
              disabled={busy}
              onChange={(event) => void changeRoot(event.target.checked)}
            />
            Remove enclosing folder
          </label>
        )}
        {busy && <p role="status">Preparing import…</p>}
        {error && <p role="alert">{error}</p>}
        {!preview && staged && !busy && (
          <button onClick={() => void changeRoot(stripRoot)}>
            Refresh import preview
          </button>
        )}
        {preview && (
          <div className="okf-import-preview">
            <h3>Import preview</h3>
            {preview.detectedRoot && (
              <p>
                Detected enclosing folder:{" "}
                <strong>{preview.detectedRoot}</strong>.{" "}
                {preview.root
                  ? "This folder will be removed."
                  : "This folder will be retained."}
              </p>
            )}
            {(preview.diagnostics || []).map((item, i) => (
              <p key={i} role="status">
                {item.path ? `${item.path}: ` : ""}
                {item.severity ? `${item.severity}: ` : ""}
                {item.message || String(item)}
              </p>
            ))}
            <p>{(preview.entries || []).length} files previewed</p>
            {(preview.entries || []).map((entry) => (
              <div key={entry.path}>
                <strong>{entry.path}</strong> <span>{entry.action}</span>
                {entry.action === "conflict" && (
                  <label>
                    Resolve {entry.path}
                    <select
                      aria-label={`Conflict choice for ${entry.path}`}
                      value={choices[entry.path] || "keep"}
                      disabled={busy}
                      onChange={(event) =>
                        setChoices((current) => ({
                          ...current,
                          [entry.path]: event.target.value,
                        }))
                      }
                    >
                      <option value="keep">Keep local</option>
                      <option value="update">Use incoming</option>
                      <option value="copy">Import a copy</option>
                    </select>
                  </label>
                )}
              </div>
            ))}
            <button
              className="primary"
              disabled={busy || !(preview.entries || []).length}
              onClick={() => void apply()}
            >
              Import accepted files
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
