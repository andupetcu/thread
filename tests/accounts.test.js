import { it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer, passwordRecord } from "../server/http.mjs";
import { Accounts } from "../server/auth.mjs";
import { WorkspaceStore } from "../server/store.mjs";
import { createHash } from "node:crypto";
import { unzipSync, strFromU8 } from "fflate";
const cleanup = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0)) await fn();
});
async function fixture(legacy = false) {
  const dir = mkdtempSync(path.join(tmpdir(), "thread-accounts-"));
  if (legacy) {
    const s = new WorkspaceStore(dir);
    s.setMeta("password", await passwordRecord("test-password"));
    s.saveNote(
      { id: "before-migration", title: "Existing note", body: "Keep me" },
      0,
    );
    s.db
      .prepare("INSERT INTO sessions(hash,expires) VALUES(?,?)")
      .run(
        createHash("sha256").update("legacy-session-test-only").digest("hex"),
        Date.now() + 60000,
      );
    s.close();
  }
  const app = createServer({ dir, staticDir: null });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  cleanup.push(async () => {
    await new Promise((r) => app.server.close(r));
    app.store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${app.server.address().port}`;
  const request = (route, method = "GET", body, cookie, token) =>
    fetch(url + "/api" + route, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Thread-Request": "1",
        ...(cookie ? { cookie } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const login = async (username = "admin", password = "test-password") =>
    (await request("/auth/login", "POST", { username, password })).headers
      .get("set-cookie")
      ?.split(";")[0];
  if (!legacy)
    await request("/auth/setup", "POST", {
      username: "admin",
      password: "test-password",
    });
  return { app, url, request, login };
}
it("migrates the existing password to admin and does not expose credentials", async () => {
  const f = await fixture(true),
    cookie = await f.login();
  const w = await (
    await f.request("/workspace", "GET", undefined, cookie)
  ).json();
  expect(w.user).toMatchObject({ username: "admin", role: "admin" });
  expect(JSON.stringify(w)).not.toContain("salt");
  expect(f.app.store.getMeta("password")).toBeNull();
  expect(w.notes.map((n) => n.id)).toContain("before-migration");
  const migratedSession = await f.request(
    "/workspace",
    "GET",
    undefined,
    "thread_session=legacy-session-test-only",
  );
  expect(migratedSession.status).toBe(200);
  expect((await migratedSession.json()).user.role).toBe("admin");
});
it("users edit shared notes but cannot manage access or delete through alternate routes", async () => {
  const f = await fixture(),
    admin = await f.login();
  const created = await f.request(
    "/users",
    "POST",
    { username: "Alice", password: "alice-password", role: "user" },
    admin,
  );
  expect(created.status).toBe(201);
  const user = await f.login("alice", "alice-password");
  const note = { id: "shared", title: "Shared", body: "Hello" };
  expect(
    (await f.request("/notes/shared", "PUT", { note, baseRevision: 0 }, user))
      .status,
  ).toBe(200);
  for (const [route, method, body] of [
    ["/users", "GET"],
    ["/mcp/keys", "POST", { name: "agent" }],
    ["/notes/shared", "DELETE", {}],
    [
      "/notes/shared",
      "PUT",
      {
        note: { ...note, deletedAt: new Date().toISOString() },
        baseRevision: 1,
      },
    ],
    ["/restore", "POST", {}],
    ["/import", "POST", { notes: [], mode: "replace" }],
  ])
    expect((await f.request(route, method, body, user)).status, route).toBe(
      403,
    );
  expect(f.app.store.getNote("shared").deletedAt).toBeFalsy();
});
it("protects the last admin and immediately revokes disabled users", async () => {
  const f = await fixture(),
    admin = await f.login();
  const users = await (
    await f.request("/users", "GET", undefined, admin)
  ).json();
  expect(users.users).toHaveLength(1);
  expect(
    (
      await f.request(
        "/users/" + users.users[0].id,
        "PATCH",
        { role: "user" },
        admin,
      )
    ).status,
  ).toBe(409);
  const alice = await (
    await f.request(
      "/users",
      "POST",
      { username: "alice", password: "alice-password", role: "user" },
      admin,
    )
  ).json();
  const cookie = await f.login("alice", "alice-password");
  expect(
    (
      await f.request(
        "/users/" + alice.user.id,
        "PATCH",
        { disabled: true },
        admin,
      )
    ).status,
  ).toBe(200);
  expect((await f.request("/workspace", "GET", undefined, cookie)).status).toBe(
    401,
  );
});
it("agent keys only read and create new notes, and can be revoked", async () => {
  const f = await fixture(),
    admin = await f.login();
  const r = await f.request("/mcp/keys", "POST", { name: "Test agent" }, admin);
  expect(r.status).toBe(201);
  const key = await r.json();
  expect(
    new Accounts(f.app.store).agent({
      headers: { authorization: `Bearer ${key.token}` },
    }),
  ).toMatchObject({ id: key.key.id });
  const create = await f.request(
    "/agent/notes",
    "POST",
    { title: "Agent note", body: "Markdown" },
    undefined,
    key.token,
  );
  expect(create.status).toBe(201);
  const note = (await create.json()).note;
  expect(
    (
      await f.request(
        "/agent/notes/" + note.id,
        "GET",
        undefined,
        undefined,
        key.token,
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await f.request(
        "/agent/notes",
        "POST",
        { id: note.id, title: "Overwrite", body: "" },
        undefined,
        key.token,
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await f.request(
        "/agent/notes",
        "POST",
        { title: "Trash", body: "", deletedAt: "today" },
        undefined,
        key.token,
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await f.request(
        "/agent/notes/" + note.id,
        "DELETE",
        {},
        undefined,
        key.token,
      )
    ).status,
  ).toBe(404);
  expect(
    (await f.request("/notes/" + note.id, "DELETE", {}, undefined, key.token))
      .status,
  ).toBe(401);
  const listed = await (
    await f.request("/mcp/keys", "GET", undefined, admin)
  ).json();
  expect(JSON.stringify(listed)).not.toContain(key.token);
  await f.request("/mcp/keys/" + key.key.id, "DELETE", {}, admin);
  expect(
    (await f.request("/agent/notes", "GET", undefined, undefined, key.token))
      .status,
  ).toBe(401);
});

it("account password changes revoke only that account’s sessions and agent keys", async () => {
  const f = await fixture(),
    admin = await f.login();
  await f.request(
    "/users",
    "POST",
    { username: "alice", password: "alice-password", role: "user" },
    admin,
  );
  const alice = await f.login("alice", "alice-password");
  const key = await (
    await f.request("/mcp/keys", "POST", { name: "Old key" }, admin)
  ).json();
  const changed = await f.request(
    "/auth/password",
    "POST",
    { currentPassword: "test-password", password: "replacement-password" },
    admin,
  );
  expect(changed.status).toBe(200);
  expect((await f.request("/workspace", "GET", undefined, admin)).status).toBe(
    401,
  );
  expect((await f.request("/workspace", "GET", undefined, alice)).status).toBe(
    200,
  );
  expect(
    (await f.request("/agent/notes", "GET", undefined, undefined, key.token))
      .status,
  ).toBe(401);
  expect(
    (
      await f.request(
        "/workspace",
        "GET",
        undefined,
        await f.login("admin", "replacement-password"),
      )
    ).status,
  ).toBe(200);
});
it("local recovery replaces an admin password while retaining accounts and notes", async () => {
  const f = await fixture(),
    cookie = await f.login();
  await f.request(
    "/notes/retained",
    "PUT",
    {
      note: { id: "retained", title: "Retained", body: "Safe" },
      baseRevision: 0,
    },
    cookie,
  );
  const { recoverAdmin } = await import("../server/recovery.mjs");
  const result = await recoverAdmin(f.app.store, "admin");
  expect(result.username).toBe("admin");
  expect((await f.request("/workspace", "GET", undefined, cookie)).status).toBe(
    401,
  );
  const next = await f.login("admin", result.password);
  expect((await f.request("/workspace", "GET", undefined, next)).status).toBe(
    200,
  );
  expect(f.app.store.listNotes().map((n) => n.id)).toContain("retained");
});
it("portable backup restoration preserves destination accounts and excludes access credentials", async () => {
  const f = await fixture(),
    cookie = await f.login();
  const secret = await (
    await f.request("/mcp/keys", "POST", { name: "Assistant" }, cookie)
  ).json();
  const zip = f.app.store.backupBytes(),
    snapshot = strFromU8(unzipSync(zip)["workspace.json"]);
  expect(snapshot).not.toContain(secret.token);
  expect(snapshot).not.toContain("password");
  expect(snapshot).not.toContain("mcp_keys");
  await f.request(
    "/users",
    "POST",
    { username: "retained", password: "retained-password", role: "user" },
    cookie,
  );
  f.app.store.restoreBytes(zip);
  expect(
    (
      await f.request(
        "/workspace",
        "GET",
        undefined,
        await f.login("retained", "retained-password"),
      )
    ).status,
  ).toBe(200);
  expect(
    (await f.request("/agent/notes", "GET", undefined, undefined, secret.token))
      .status,
  ).toBe(200);
});
