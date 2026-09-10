import { afterEach, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { createServer } from "../server/http.mjs";
const clean = [];
afterEach(async () => {
  for (const f of clean.splice(0)) await f();
});
const diagram = (label) => ({
  version: 1,
  nodes: [
    {
      id: "a",
      position: { x: 0, y: 0 },
      data: { shape: "process", label, color: "#ffffff" },
    },
  ],
  edges: [],
});
const fence = (value) =>
  "```thread-diagram\n" + JSON.stringify(value) + "\n```";
async function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "diagram-api-")),
    app = createServer({ dir, staticDir: null });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  clean.push(async () => {
    await new Promise((r) => app.server.close(r));
    app.store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${app.server.address().port}/api`;
  let cookie;
  const request = (route, method = "GET", body, token) =>
    fetch(base + route, {
      method,
      headers: {
        "X-Thread-Request": "1",
        "Content-Type": "application/json",
        ...(cookie ? { cookie } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const setup = await request("/auth/setup", "POST", {
    password: "test-password",
  });
  cookie = setup.headers.get("set-cookie").split(";")[0];
  const key = await (
    await request("/mcp/keys", "POST", { name: "Diagrams" })
  ).json();
  return { app, request, key, setCookie: (value) => (cookie = value) };
}
it("reads without mutation, proposes inertly, applies only the selected AST fence and preserves history", async () => {
  const { app, request, key } = await fixture();
  const original =
    "Before\n\n<!-- thread:block id=stable -->\n\n" +
    fence(diagram("old")) +
    "\n\nAfter\n\n" +
    fence(diagram("other"));
  const note = app.store.saveNote(
    { id: "test", title: "Keep title", body: original, tags: ["keep"] },
    0,
  );
  const workspaceRevision = app.store.getMeta("revision");
  const listing = await (
    await request("/agent/diagrams?noteId=test", "GET", undefined, key.token)
  ).json();
  expect(listing.diagrams).toHaveLength(2);
  expect(listing.diagrams[0].blockId).toBe("stable");
  expect(app.store.getMeta("revision")).toBe(workspaceRevision);
  const input = {
    noteId: "test",
    diagramIndex: 0,
    baseRevision: note.revision,
    diagram: diagram("new"),
    summary: "Update label",
  };
  const proposal = await (
    await request("/agent/diagram-proposals", "POST", input, key.token)
  ).json();
  expect(proposal.proposal.id).toBeTruthy();
  expect(app.store.getNote("test").body).toBe(original);
  expect(
    (
      await request(
        `/agent/diagram-proposals/${proposal.proposal.id}/apply`,
        "POST",
        { expectedRevision: 1 },
        key.token,
      )
    ).status,
  ).toBe(404);
  const response = await request(
    `/diagram-proposals/${proposal.proposal.id}/apply`,
    "POST",
    { expectedRevision: 1 },
  );
  expect(response.status).toBe(200);
  const saved = (await response.json()).note;
  expect(saved.title).toBe(note.title);
  expect(
    saved.body.startsWith("Before\n\n<!-- thread:block id=stable -->\n\n"),
  ).toBe(true);
  expect(saved.body.endsWith("\n\nAfter\n\n" + fence(diagram("other")))).toBe(
    true,
  );
  expect(app.store.history("test")[0]).toBeTruthy();
  expect(
    (
      await request(
        `/diagram-proposals/${proposal.proposal.id}/apply`,
        "POST",
        { expectedRevision: 2 },
      )
    ).status,
  ).toBe(409);
});
it("strictly validates HTTP inputs, stale revisions, source identity and key revocation", async () => {
  const { app, request, key } = await fixture();
  app.store.saveNote(
    { id: "test", title: "Test", body: fence(diagram("old")) },
    0,
  );
  const input = {
    noteId: "test",
    diagramIndex: 0,
    baseRevision: 1,
    diagram: diagram("new"),
    summary: "Review",
  };
  for (const override of [
    { baseRevision: "1" },
    { diagramIndex: -1 },
    { diagramIndex: 0.1 },
    { actor: { kind: "human" } },
    { verified: true },
    { diagram: null },
    { summary: "" },
  ])
    expect(
      (
        await request(
          "/agent/diagram-proposals",
          "POST",
          { ...input, ...override },
          key.token,
        )
      ).status,
    ).toBe(400);
  const p = (
    await (
      await request("/agent/diagram-proposals", "POST", input, key.token)
    ).json()
  ).proposal;
  app.store.saveNote(
    {
      ...app.store.getNote("test"),
      body: "Unrelated\n\n" + fence(diagram("old")),
    },
    1,
  );
  expect(
    (
      await request(`/diagram-proposals/${p.id}/apply`, "POST", {
        expectedRevision: 2,
      })
    ).status,
  ).toBe(409);
  expect(
    (await request("/agent/diagram-proposals", "POST", input, key.token))
      .status,
  ).toBe(409);
  expect(
    (
      await request(`/diagram-proposals/${p.id}/reject`, "POST", {
        verified: true,
      })
    ).status,
  ).toBe(400);
  expect(
    (await request(`/diagram-proposals/${p.id}/reject`, "POST", {})).status,
  ).toBe(200);
  await request("/mcp/keys/" + key.key.id, "DELETE", {});
  expect(
    (
      await request(
        "/agent/diagram-proposals",
        "POST",
        { ...input, baseRevision: 2 },
        key.token,
      )
    ).status,
  ).toBe(401);
});
it("backs up templates and proposals atomically, invalidates restored pending proposals and accepts legacy backups", async () => {
  const { app, request, key } = await fixture();
  app.store.saveNote(
    { id: "test", title: "Test", body: fence(diagram("old")) },
    0,
  );
  const t = (
    await (
      await request("/diagram-templates", "POST", {
        name: "Custom",
        diagram: diagram("custom"),
      })
    ).json()
  ).template;
  expect(
    (
      await request("/diagram-templates/" + t.id, "PUT", {
        name: "Next",
        baseRevision: 0,
      })
    ).status,
  ).toBe(400);
  const p = (
    await (
      await request(
        "/agent/diagram-proposals",
        "POST",
        {
          noteId: "test",
          diagramIndex: 0,
          baseRevision: 1,
          diagram: diagram("next"),
          summary: "Next",
        },
        key.token,
      )
    ).json()
  ).proposal;
  const bytes = app.store.backupBytes();
  const files = unzipSync(bytes),
    snapshot = JSON.parse(strFromU8(files["workspace.json"]));
  const corrupt = {
    ...snapshot,
    diagrams: { ...snapshot.diagrams, templates: [{ ...t, revision: "1" }] },
  };
  files["workspace.json"] = strToU8(JSON.stringify(corrupt));
  expect(() => app.store.restoreBytes(zipSync(files))).toThrow();
  expect(app.store.getNote("test").revision).toBe(1);
  app.store.restoreBytes(bytes);
  expect(app.store.diagrams.templates()[0].name).toBe("Custom");
  expect(app.store.diagrams.proposals("test")).toEqual([]);
  expect(() =>
    app.store.diagrams.resolve(
      p.id,
      "apply",
      { expectedRevision: app.store.getNote("test").revision },
      { kind: "human", id: "admin" },
    ),
  ).toThrow(/pending/);
  delete snapshot.diagrams;
  files["workspace.json"] = strToU8(JSON.stringify(snapshot));
  app.store.restoreBytes(zipSync(files));
  expect(app.store.diagrams.templates()).toEqual([]);
});
it("does not promote OKF verification when human applies a diagram proposal", async () => {
  const { app, request, key } = await fixture();
  let bundle = (
    await (await request("/okf/bundles", "POST", { name: "Diagrams" })).json()
  ).bundle;
  bundle = (
    await (
      await request(`/okf/bundles/${bundle.id}/documents`, "POST", {
        path: "concept.md",
        source: "---\ntype: concept\n---\n" + fence(diagram("old")),
        expectedRevision: bundle.revision,
      })
    ).json()
  ).bundle;
  const entry = bundle.entries.find((e) => e.path === "concept.md");
  const note = app.store.getNote(entry.noteId);
  const p = (
    await (
      await request(
        "/agent/diagram-proposals",
        "POST",
        {
          noteId: note.id,
          diagramIndex: 0,
          baseRevision: note.revision,
          diagram: diagram("new"),
          summary: "New label",
        },
        key.token,
      )
    ).json()
  ).proposal;
  const applied = await request(`/diagram-proposals/${p.id}/apply`, "POST", {
    expectedRevision: note.revision,
  });
  expect(applied.status).toBe(200);
  const saved = (await applied.json()).note;
  expect(saved.okf.source).not.toContain("verified: true");
  expect(saved.okf.source).toContain("new");
});
it("allows regular humans to share templates and apply proposals, and prevents agent template writes", async () => {
  const { app, request, key, setCookie } = await fixture();
  app.store.saveNote(
    { id: "test", title: "Test", body: fence(diagram("old")) },
    0,
  );
  const p = (
    await (
      await request(
        "/agent/diagram-proposals",
        "POST",
        {
          noteId: "test",
          diagramIndex: 0,
          baseRevision: 1,
          diagram: diagram("new"),
          summary: "Next",
        },
        key.token,
      )
    ).json()
  ).proposal;
  expect(
    (
      await request(
        "/agent/diagram-templates",
        "POST",
        { name: "No", diagram: diagram("old") },
        key.token,
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await request("/users", "POST", {
        username: "writer",
        password: "writer-test-password",
        role: "user",
      })
    ).status,
  ).toBe(201);
  const login = await request("/auth/login", "POST", {
    username: "writer",
    password: "writer-test-password",
  });
  setCookie(login.headers.get("set-cookie").split(";")[0]);
  const response = await request("/diagram-templates", "POST", {
    name: "Shared",
    diagram: diagram("old"),
  });
  expect(response.status).toBe(201);
  const t = (await response.json()).template;
  expect(
    (
      await request("/diagram-templates/" + t.id, "PUT", {
        name: "Updated",
        baseRevision: t.revision,
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await request("/diagram-templates/" + t.id, "PUT", {
        name: "Stale",
        baseRevision: t.revision,
      })
    ).status,
  ).toBe(409);
  expect((await request("/diagram-templates")).status).toBe(200);
  expect(
    (
      await request(`/diagram-proposals/${p.id}/apply`, "POST", {
        expectedRevision: 1,
      })
    ).status,
  ).toBe(200);
});
it("checks the original source hash and rolls back note history when proposal persistence fails", async () => {
  const { app, request, key } = await fixture();
  const note = app.store.saveNote(
    { id: "test", title: "Test", body: fence(diagram("old")) },
    0,
  );
  const p = (
    await (
      await request(
        "/agent/diagram-proposals",
        "POST",
        {
          noteId: "test",
          diagramIndex: 0,
          baseRevision: 1,
          diagram: diagram("new"),
          summary: "Next",
        },
        key.token,
      )
    ).json()
  ).proposal;
  app.store.db
    .prepare("UPDATE notes SET data=? WHERE id=?")
    .run(
      JSON.stringify({ ...note, body: fence(diagram("tampered")) }),
      note.id,
    );
  expect(
    (
      await request(`/diagram-proposals/${p.id}/apply`, "POST", {
        expectedRevision: 1,
      })
    ).status,
  ).toBe(409);
  app.store.db
    .prepare("UPDATE notes SET data=? WHERE id=?")
    .run(JSON.stringify(note), note.id);
  const history = app.store.history(note.id),
    workspaceRevision = app.store.getMeta("revision");
  app.store.db.exec(
    "CREATE TRIGGER diagram_failure BEFORE UPDATE ON diagram_proposals BEGIN SELECT RAISE(ABORT, 'test rollback'); END;",
  );
  expect(() =>
    app.store.diagrams.resolve(
      p.id,
      "apply",
      { expectedRevision: 1 },
      { kind: "human", id: "admin" },
    ),
  ).toThrow("test rollback");
  expect(app.store.getNote(note.id)).toEqual(note);
  expect(app.store.history(note.id)).toEqual(history);
  expect(app.store.getMeta("revision")).toBe(workspaceRevision);
  expect(app.store.diagrams.proposals(note.id)).toHaveLength(1);
});
it("never reuses template revisions across newer, older and empty backup restores", async () => {
  const { app, request } = await fixture();
  const emptyBackup = app.store.backupBytes();
  const first = (
    await (
      await request("/diagram-templates", "POST", {
        name: "One",
        diagram: diagram("one"),
      })
    ).json()
  ).template;
  const olderBackup = app.store.backupBytes();
  await request("/diagram-templates/" + first.id, "PUT", {
    name: "Two",
    baseRevision: first.revision,
  });
  const newerBackup = app.store.backupBytes();
  app.store.restoreBytes(newerBackup);
  const newer = app.store.diagrams.templates()[0];
  app.store.restoreBytes(olderBackup);
  const older = app.store.diagrams.templates()[0];
  expect(older.name).toBe("One");
  expect(older.revision).toBeGreaterThan(newer.revision);
  expect(
    (
      await request("/diagram-templates/" + first.id, "PUT", {
        name: "Stale overwrite",
        baseRevision: newer.revision,
      })
    ).status,
  ).toBe(409);
  app.store.restoreBytes(emptyBackup);
  expect(app.store.diagrams.templates()).toEqual([]);
  app.store.restoreBytes(olderBackup);
  const reintroduced = app.store.diagrams.templates()[0];
  expect(reintroduced.revision).toBeGreaterThan(older.revision);
  expect(
    (
      await request("/diagram-templates/" + first.id, "PUT", {
        name: "Stale after omission",
        baseRevision: older.revision,
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await request("/diagram-templates/" + first.id, "PUT", {
        name: "Fresh update",
        baseRevision: reintroduced.revision,
      })
    ).status,
  ).toBe(200);
});
