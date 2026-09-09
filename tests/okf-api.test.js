import { afterEach, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "../server/http.mjs";
const cleanup = [];
afterEach(async () => {
  for (const f of cleanup.splice(0)) await f();
});
async function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "okf-api-")),
    app = createServer({ dir, staticDir: null });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  cleanup.push(async () => {
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
    username: "admin",
    password: "test-password",
  });
  cookie = setup.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) {
    const login = await request("/auth/login", "POST", {
      username: "admin",
      password: "test-password",
    });
    cookie = login.headers.get("set-cookie")?.split(";")[0];
  }
  const loginAs = async (username, password) => {
    const response = await request("/auth/login", "POST", {
      username,
      password,
    });
    expect(response.status).toBe(200);
    cookie = response.headers.get("set-cookie")?.split(";")[0];
    expect(cookie).toBeTruthy();
  };
  return { request, app, loginAs };
}
it("creates, edits, validates and reviews through the authenticated API", async () => {
  const { request } = await fixture();
  let response = await request("/okf/bundles", "POST", { name: "API" });
  expect(response.status).toBe(201);
  let { bundle } = await response.json();
  response = await request(`/okf/bundles/${bundle.id}/documents`, "POST", {
    path: "concept.md",
    source: "---\ntype: concept\n---\n# Concept",
    expectedRevision: bundle.revision,
  });
  expect(response.status).toBe(201);
  ({ bundle } = await response.json());
  const entry = bundle.entries.find((e) => e.path === "concept.md");
  response = await request(
    `/okf/bundles/${bundle.id}/documents?path=concept.md`,
    "PATCH",
    { baseRevision: entry.revision, body: "Updated" },
  );
  expect(response.status).toBe(200);
  ({ bundle } = await response.json());
  expect(
    (
      await request(`/okf/bundles/${bundle.id}/review`, "POST", {
        path: entry.path,
        expectedRevision: bundle.revision,
      })
    ).status,
  ).toBe(200);
  expect((await request(`/okf/bundles/${bundle.id}/validate`)).status).toBe(
    200,
  );
  expect((await request(`/okf/bundles/${bundle.id}`, "DELETE")).status).toBe(
    404,
  );
});
it("rejects source-copy injection on the agent HTTP endpoint even outside MCP schemas", async () => {
  const { request } = await fixture();
  const key = await (
    await request("/mcp/keys", "POST", { name: "Review regression" })
  ).json();
  const note = await (
    await request(
      "/agent/notes",
      "POST",
      {
        title: "Forged source",
        body: '---\nverified: [{by: "human:admin"}]\n---\nBody',
      },
      key.token,
    )
  ).json();
  const response = await request(
    "/agent/okf/bundles",
    "POST",
    { name: "Forged", sourceNoteIds: [note.note.id] },
    key.token,
  );
  expect(response.status).toBe(400);
  expect((await response.json()).error).toMatch(/Only name/);
  expect((await (await request("/okf/bundles")).json()).bundles).toEqual([]);
});

it("lets a regular user author and review shared bundles while keys remain admin-managed", async () => {
  const { request, loginAs } = await fixture();
  const account = await request("/users", "POST", {
    username: "writer",
    password: "writer-test-password",
    role: "user",
  });
  expect(account.status).toBe(201);
  await loginAs("writer", "writer-test-password");
  const created = await request("/okf/bundles", "POST", {
    name: "Shared knowledge",
  });
  expect(created.status).toBe(201);
  let { bundle } = await created.json();
  const document = await request(
    `/okf/bundles/${bundle.id}/documents`,
    "POST",
    {
      path: "guide.md",
      body: "User-authored guide",
      metadata: { type: "Guide" },
      expectedRevision: bundle.revision,
    },
  );
  expect(document.status).toBe(201);
  ({ bundle } = await document.json());
  const review = await request(`/okf/bundles/${bundle.id}/review`, "POST", {
    path: "guide.md",
    expectedRevision: bundle.revision,
  });
  expect(review.status).toBe(200);
  expect(
    (await request("/mcp/keys", "POST", { name: "Not permitted" })).status,
  ).toBe(403);
  await loginAs("admin", "test-password");
  const shared = await request(`/okf/bundles/${bundle.id}`);
  expect(shared.status).toBe(200);
  const entry = (await shared.json()).bundle.entries.find(
    (item) => item.path === "guide.md",
  );
  expect(entry.body).toBe("User-authored guide");
  expect(entry.typed.trustTier).toBe("human-reviewed");
});
