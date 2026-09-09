import React, { useEffect, useState } from "react";
import { api } from "./api";
export default function AccessSettings({ section, user }) {
  const [users, setUsers] = useState([]),
    [keys, setKeys] = useState([]),
    [script, setScript] = useState(""),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [role, setRole] = useState("user"),
    [name, setName] = useState(""),
    [secret, setSecret] = useState(null),
    [reset, setReset] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function refresh() {
    if (section === "users") setUsers((await api("/users")).users);
    else {
      const data = await api("/mcp/keys");
      setKeys(data.keys);
      setScript(data.script);
    }
  }
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, [section]);
  async function run(fn) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const config = JSON.stringify(
    {
      mcpServers: {
        thread: {
          command: "node",
          args: [script],
          env: {
            THREAD_API_URL: "http://127.0.0.1:4317",
            THREAD_MCP_TOKEN: "PASTE_YOUR_AGENT_KEY_HERE",
          },
        },
      },
    },
    null,
    2,
  );
  return (
    <>
      {section === "users" ? (
        <>
          <h3>People in this workspace</h3>
          <p>
            Everyone shares the same notes. Users can read, create and edit.
            Admins also manage accounts, delete notes and restore backups.
            Signed in as <strong>{user.username}</strong>.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await api("/users", {
                  method: "POST",
                  body: { username, password, role },
                });
                setUsername("");
                setPassword("");
                setMessage(
                  "Account created. Share the temporary password privately.",
                );
              });
            }}
          >
            <label>
              New username
              <input
                required
                autoComplete="off"
                maxLength={40}
                pattern="[a-zA-Z0-9_.\-]+"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </label>
            <label>
              Temporary password
              <input
                required
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={256}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <label>
              Account role
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            <button disabled={busy}>Add account</button>
          </form>
          {users.map((u) => (
            <div className="settings-row account-row" key={u.id}>
              <span>
                <strong>{u.username}</strong>
                <small>
                  {u.disabled
                    ? "Disabled"
                    : u.role === "admin"
                      ? "Administrator"
                      : "User"}
                  {u.id === user.id ? " · You" : ""}
                </small>
              </span>
              <select
                aria-label={"Role for " + u.username}
                value={u.role}
                disabled={busy || u.id === user.id}
                onChange={(e) =>
                  run(() =>
                    api("/users/" + u.id, {
                      method: "PATCH",
                      body: { role: e.target.value },
                    }),
                  )
                }
              >
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
              <button
                disabled={busy || u.id === user.id}
                onClick={() =>
                  run(() =>
                    api("/users/" + u.id, {
                      method: "PATCH",
                      body: { disabled: !u.disabled },
                    }),
                  )
                }
              >
                {u.disabled ? "Enable" : "Disable"}
              </button>
              <button
                disabled={busy || u.id === user.id}
                onClick={() =>
                  setReset({ id: u.id, username: u.username, password: "" })
                }
              >
                Reset password
              </button>
            </div>
          ))}
          {reset && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  await api("/users/" + reset.id, {
                    method: "PATCH",
                    body: { password: reset.password },
                  });
                  setReset(null);
                  setMessage(
                    "Password reset. Sessions and agent keys for this account were revoked.",
                  );
                });
              }}
            >
              <h4>Reset password for {reset.username}</h4>
              <label>
                Replacement password
                <input
                  required
                  type="password"
                  minLength={8}
                  maxLength={256}
                  autoComplete="new-password"
                  value={reset.password}
                  onChange={(e) =>
                    setReset({ ...reset, password: e.target.value })
                  }
                />
              </label>
              <button disabled={busy}>Save replacement password</button>
              <button type="button" onClick={() => setReset(null)}>
                Cancel
              </button>
            </form>
          )}
        </>
      ) : (
        <>
          <h3>Connect an AI agent</h3>
          <p>
            Agents can list, search and read active notes, and create new
            Markdown notes. They can edit existing notes, with revision checks.
            They cannot delete notes. Keep Thread running while connected.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                const data = await api("/mcp/keys", {
                  method: "POST",
                  body: { name },
                });
                setSecret(data);
                setName("");
              });
            }}
          >
            <label>
              Key name
              <input
                required
                maxLength={100}
                placeholder="e.g. My coding assistant"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <button disabled={busy}>Create agent key</button>
          </form>
          {secret && (
            <div className="agent-secret">
              <p>Copy this key now. It is shown only once.</p>
              <label>
                New agent key
                <input
                  readOnly
                  type="password"
                  value={secret.token}
                  onFocus={(e) => e.target.select()}
                />
              </label>
              <button
                onClick={() =>
                  run(async () => {
                    await navigator.clipboard.writeText(secret.token);
                    setMessage("Agent key copied.");
                  })
                }
              >
                Copy key
              </button>
              <button onClick={() => setSecret(null)}>Hide key</button>
            </div>
          )}
          <h4>MCP client configuration</h4>
          <p>
            Add this entry to your AI client's MCP settings and replace the key
            placeholder. If Thread uses a custom API port, update the URL. Keep
            the key in your client's private settings.
          </p>
          <pre className="mcp-config" aria-label="MCP configuration">
            {config}
          </pre>
          <button
            onClick={() =>
              run(async () => {
                await navigator.clipboard.writeText(config);
                setMessage(
                  "Configuration copied. Replace the key placeholder in your MCP client.",
                );
              })
            }
          >
            Copy configuration
          </button>
          {keys.map((k) => (
            <div className="settings-row mcp-key-row" key={k.id}>
              <span>
                <strong>{k.name}</strong>
                <small>
                  {k.username} · {new Date(k.created).toLocaleDateString()}
                </small>
              </span>
              <button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await api("/mcp/keys/" + k.id, {
                      method: "DELETE",
                      body: {},
                    });
                    if (secret?.key.id === k.id) setSecret(null);
                    setMessage("Agent key revoked.");
                  })
                }
              >
                Revoke
              </button>
            </div>
          ))}
          {!keys.length && <p>No active agent keys.</p>}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
    </>
  );
}
