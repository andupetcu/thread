import React, { useEffect, useState } from "react";
import { Network, LockKeyhole } from "lucide-react";
import { api } from "./api";
import { initialNotes, validateBackup } from "../model";
import { useWorkspace } from "./useWorkspace";
import "./storage.css";
function Connected({ initial, App, lock }) {
  const workspace = useWorkspace(initial);
  return (
    <App
      workspace={workspace}
      onLock={async () => {
        await workspace.flush();
        await api("/auth/logout", { method: "POST", body: {} });
        lock();
      }}
    />
  );
}
export default function WorkspaceGate({ App }) {
  const [auth, setAuth] = useState(null),
    [workspace, setWorkspace] = useState(null),
    [password, setPassword] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [migrationError, setMigrationError] = useState(false);
  async function load() {
    let data = await api("/workspace");
    if (!data.initialized) {
      let notes;
      try {
        const legacy = localStorage.getItem("thread.notes.v1");
        notes = legacy ? validateBackup(JSON.parse(legacy)) : initialNotes();
      } catch (e) {
        setMigrationError(true);
        setError(
          "The previous browser workspace could not be read. Its original data has been preserved.",
        );
        return;
      }
      data = await api("/workspace/initialize", {
        method: "POST",
        body: { notes },
      });
    }
    setWorkspace(data);
  }
  useEffect(() => {
    api("/auth/status")
      .then(async (a) => {
        setAuth(a);
        if (a.authenticated) await load();
      })
      .catch((e) => setError(e.message));
  }, []);
  if (workspace)
    return (
      <Connected
        App={App}
        initial={workspace}
        lock={() => {
          setWorkspace(null);
          setAuth({ configured: true, authenticated: false });
        }}
      />
    );
  const setup = auth && !auth.configured;
  return (
    <main className="workspace-gate">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          if (setup && password !== confirmation)
            return setError("Passwords do not match.");
          setBusy(true);
          try {
            await api("/auth/" + (setup ? "setup" : "login"), {
              method: "POST",
              body: { password },
            });
            setAuth({ configured: true, authenticated: true });
            setPassword("");
            setConfirmation("");
            await load();
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Network size={32} />
        <h1>
          thread<span> / local</span>
        </h1>
        <h2>
          {setup ? "Create your workspace password" : "Unlock your workspace"}
        </h2>
        <p>
          {setup
            ? "One password protects access to your notes on this device."
            : "Your notes are saved on this device."}
        </p>
        {auth && !migrationError && (
          <>
            <label>
              Workspace password
              <input
                autoFocus
                type="password"
                autoComplete={setup ? "new-password" : "current-password"}
                minLength={setup ? 8 : 1}
                maxLength={256}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {setup && (
              <label>
                Confirm password
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                />
              </label>
            )}
            <button className="primary" disabled={busy}>
              <LockKeyhole size={16} />
              {busy ? "Opening…" : setup ? "Create workspace" : "Unlock"}
            </button>
          </>
        )}
        {migrationError && (
          <>
            <button
              type="button"
              onClick={async () => {
                try {
                  const data = await api("/workspace/initialize", {
                    method: "POST",
                    body: { notes: [] },
                  });
                  setWorkspace(data);
                } catch (e) {
                  setError(e.message);
                }
              }}
            >
              Start empty workspace and keep recovery data
            </button>
            <button
              type="button"
              onClick={() => {
                try {
                  const raw = localStorage.getItem("thread.notes.v1");
                  const url = URL.createObjectURL(
                      new Blob([raw || ""], { type: "text/plain" }),
                    ),
                    a = document.createElement("a");
                  a.href = url;
                  a.download = "thread-browser-recovery.txt";
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                } catch (e) {
                  setError(e.message);
                }
              }}
            >
              Download original browser data
            </button>
          </>
        )}
        {error && <p role="alert">{error}</p>}
        {!auth && !error && <p>Connecting to local workspace…</p>}
        <small>
          Files stay local. The password controls app access; it does not
          encrypt files on disk.
        </small>
      </form>
    </main>
  );
}
