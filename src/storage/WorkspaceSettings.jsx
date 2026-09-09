import React, { useEffect, useRef, useState } from "react";
import { api } from "./api";
export function ConflictReview({ workspace }) {
  return workspace.conflicts.length ? (
    <aside className="conflict-review" role="alert">
      <strong>Another session changed these notes.</strong>
      <p>Your local drafts are preserved. Choose which version to keep.</p>
      {workspace.conflicts.map((c) => (
        <div key={c.id}>
          <b>{c.local?.title || c.current?.title || "Deleted note"}</b>
          <details>
            <summary>Compare text</summary>
            <div className="conflict-text">
              <pre>{c.local?.body || "(locally deleted)"}</pre>
              <pre>{c.current?.body || "(deleted on disk)"}</pre>
            </div>
          </details>
          <button onClick={() => workspace.resolve(c.id, "copy")}>
            Keep local as a copy
          </button>
          <button onClick={() => workspace.resolve(c.id, "saved")}>
            Use disk version
          </button>
          <button onClick={() => workspace.resolve(c.id, "mine")}>
            Replace with local version
          </button>
        </div>
      ))}
    </aside>
  ) : null;
}
export default function WorkspaceSettings({
  workspace,
  note,
  onClose,
  onRestore,
}) {
  const dialog = useRef(),
    [section, setSection] = useState("backups"),
    [backups, setBackups] = useState([]),
    [trash, setTrash] = useState([]),
    [versions, setVersions] = useState([]),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [confirmation, setConfirmation] = useState(null),
    [currentPassword, setCurrentPassword] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState(null);
  async function refresh() {
    const [b, t, h] = await Promise.all([
      api("/backups"),
      api("/trash"),
      note
        ? api("/notes/" + note.id + "/history")
        : Promise.resolve({ versions: [] }),
    ]);
    setBackups(b.backups);
    setTrash(t.notes);
    setVersions(h.versions);
  }
  useEffect(() => {
    dialog.current.showModal();
    refresh().catch((e) => setError(e.message));
  }, []);
  async function run(fn) {
    setBusy(true);
    setError("");
    try {
      await workspace.flush();
      await fn();
      await workspace.reload();
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function download(blob, name) {
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <dialog
      className="workspace-settings"
      aria-labelledby="workspace-settings-title"
      ref={dialog}
      onCancel={onClose}
    >
      <header>
        <h2 id="workspace-settings-title">Workspace settings</h2>
        <button aria-label="Close workspace settings" onClick={onClose}>
          ×
        </button>
      </header>
      <nav>
        {["backups", "trash", "history", "password"].map((s) => (
          <button
            key={s}
            aria-pressed={section === s}
            onClick={() => setSection(s)}
          >
            {s[0].toUpperCase() + s.slice(1)}
          </button>
        ))}
      </nav>
      <div className="settings-body">
        {section === "backups" && (
          <>
            <h3>Saved on this device</h3>
            <p className="storage-path">{workspace.directory}</p>
            <p>
              Automatic snapshots every 15 minutes keep the latest 24 backups.
              Each backup includes notes, history, attachments, diagrams, and
              workspace settings.
            </p>
            <div className="settings-actions">
              <button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await api("/backups", { method: "POST", body: {} });
                    setMessage("Backup created.");
                  })
                }
              >
                Create backup
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  run(async () =>
                    download(await api("/backup"), "thread-workspace.zip"),
                  )
                }
              >
                Download workspace ZIP
              </button>
              <label className="file-button">
                Restore ZIP
                <input
                  type="file"
                  accept=".zip"
                  onChange={(e) => {
                    const file = e.target.files[0];
                    if (file)
                      setConfirmation({
                        title: "Restore this workspace backup?",
                        full: true,
                        detail:
                          "Current notes and settings will be replaced. A recovery backup is created first.",
                        action: () =>
                          api("/restore", {
                            method: "POST",
                            headers: { "Content-Type": "application/zip" },
                            body: file,
                          }),
                      });
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
            {backups.map((b) => (
              <div className="settings-row" key={b.id}>
                <span>
                  {new Date(b.created).toLocaleString()}
                  <small>{Math.round(b.size / 1024)} KB</small>
                </span>
                <button
                  disabled={busy}
                  onClick={() =>
                    setConfirmation({
                      title: "Restore this backup?",
                      full: true,
                      detail:
                        "A recovery backup of your current workspace is created before restoring.",
                      action: () =>
                        api("/restore", { method: "POST", body: { id: b.id } }),
                    })
                  }
                >
                  Restore
                </button>
              </div>
            ))}
            {!backups.length && (
              <p>No snapshots yet. Create your first backup above.</p>
            )}
          </>
        )}
        {section === "trash" && (
          <>
            <h3>Deleted notes</h3>
            <p>Deleted notes stay here until you restore them.</p>
            {trash.map((n) => (
              <div className="settings-row" key={n.id}>
                <span>
                  {n.title}
                  <small>{new Date(n.deletedAt).toLocaleString()}</small>
                </span>
                <button
                  disabled={busy}
                  onClick={() =>
                    run(() =>
                      api("/notes/" + n.id + "/restore", {
                        method: "POST",
                        body: {},
                      }),
                    )
                  }
                >
                  Restore note
                </button>
              </div>
            ))}
            {!trash.length && <p>Trash is empty.</p>}
          </>
        )}
        {section === "history" && (
          <>
            <h3>{note ? note.title : "Open a note to see its history"}</h3>
            <p>
              Up to 200 saved versions per note. Restoring a version also
              preserves the current version.
            </p>
            {versions.map((v) => (
              <div className="settings-row" key={v.id}>
                <span>{new Date(v.savedAt).toLocaleString()}</span>
                <button onClick={() => setPreview(v.note || v.data)}>
                  Preview
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    setConfirmation({
                      title: "Restore this note version?",
                      detail:
                        "The current version remains available in history.",
                      action: () =>
                        api(
                          "/notes/" + note.id + "/history/" + v.id + "/restore",
                          { method: "POST", body: {} },
                        ),
                    })
                  }
                >
                  Restore version
                </button>
              </div>
            ))}
            {preview && (
              <pre className="version-preview">
                {typeof preview === "string" ? preview : preview.body}
              </pre>
            )}
            {note && !versions.length && (
              <p>History appears after the next saved edit.</p>
            )}
          </>
        )}
        {section === "password" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await api("/auth/password", {
                  method: "POST",
                  body: { currentPassword, password },
                });
                setCurrentPassword("");
                setPassword("");
                setMessage(
                  "Password changed. Other sessions have been signed out.",
                );
              });
            }}
          >
            <h3>Workspace password</h3>
            <label>
              Current password
              <input
                type="password"
                required
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </label>
            <label>
              New password
              <input
                type="password"
                required
                minLength={8}
                maxLength={256}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <button disabled={busy}>Change password</button>
            <p>
              If you forget it, run <code>npm run reset-password</code> on this
              device. Notes remain intact.
            </p>
          </form>
        )}
        {confirmation && (
          <div className="restore-confirm" role="alert">
            <h3>{confirmation.title}</h3>
            <p>{confirmation.detail}</p>
            <button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const data = await confirmation.action();
                  if (confirmation.full) onRestore?.(data);
                  setConfirmation(null);
                  setMessage("Restore complete.");
                })
              }
            >
              Confirm restore
            </button>
            <button onClick={() => setConfirmation(null)}>Cancel</button>
          </div>
        )}
        {error && <p role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
      </div>
    </dialog>
  );
}

export function Reauthenticate({ workspace }) {
  const dialog = useRef(),
    [password, setPassword] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    dialog.current.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="workspace-settings"
      aria-labelledby="unlock-session-title"
      onCancel={(e) => e.preventDefault()}
    >
      <form
        className="settings-body"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api("/auth/login", { method: "POST", body: { password } });
            workspace.setNeedsUnlock(false);
            workspace.setError("");
            await workspace.flush();
          } catch (e) {
            setError(e.message);
          }
        }}
      >
        <h2 id="unlock-session-title">Unlock to continue saving</h2>
        <p>Your local drafts are preserved.</p>
        <label>
          Workspace password
          <input
            autoFocus
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <button>Unlock</button>
        {error && <p role="alert">{error}</p>}
      </form>
    </dialog>
  );
}
