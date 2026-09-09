import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { WorkspaceStore } from "../server/store.mjs";
const stores = [];
const setup = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "okf-store-"));
  const s = new WorkspaceStore(dir);
  stores.push(s);
  return s;
};
afterEach(() => {
  for (const s of stores.splice(0)) {
    s.close();
    rmSync(s.dir, { recursive: true, force: true });
  }
});
const source =
  "---\n# preserved\ntype: concept\nextension:\n  nested: [a, b]\n---\n# Hello\n";
it("stores canonical metadata separately, retains UUID/history across rename, and rejects stale writes", () => {
  const s = setup();
  let b = s.okf.create({ name: "Test" });
  b = s.okf.write(b.id, {
    path: "hello.md",
    source,
    expectedRevision: b.revision,
  });
  let e = b.entries.find((e) => e.path === "hello.md");
  expect(s.getNote(e.noteId).body).toBe("# Hello\n");
  expect(e.source).toBe(source);
  expect(() =>
    s.okf.write(b.id, { path: "hello.md", body: "bad", expectedRevision: 1 }),
  ).toThrow(/conflict/i);
  b = s.okf.rename(b.id, {
    from: "hello.md",
    to: "nested/hello.md",
    expectedRevision: b.revision,
  });
  expect(b.entries.find((e) => e.path === "nested/hello.md").noteId).toBe(
    e.noteId,
  );
  expect(s.history(e.noteId).length).toBeGreaterThan(0);
});
it("ordinary note writes preserve protected metadata and refuse bundle deletion or forged review", () => {
  const s = setup();
  let b = s.okf.create({ name: "Test" });
  b = s.okf.write(b.id, {
    path: "hello.md",
    source,
    expectedRevision: b.revision,
  });
  const e = b.entries.find((e) => e.path === "hello.md");
  const n = s.getNote(e.noteId);
  s.saveNote({ ...n, body: "Changed" }, n.revision);
  expect(
    s.okf.get(b.id).entries.find((e) => e.path === "hello.md").source,
  ).toContain("# preserved");
  expect(() => s.deleteNote(n.id, n.revision + 1)).toThrow(/bundle/i);
  expect(() =>
    s.okf.write(
      b.id,
      {
        path: "hello.md",
        metadata: { verified: [{ by: "Human" }] },
        expectedRevision: s.okf.get(b.id).revision,
      },
      { kind: "agent", id: "x" },
    ),
  ).toThrow(/verif|review/i);
});
it("backs up bundle source and assets and restores mappings with fresh revisions", () => {
  const s = setup();
  let b = s.okf.create({ name: "Test" });
  b = s.okf.write(b.id, {
    path: "hello.md",
    source,
    expectedRevision: b.revision,
  });
  const restored = setup();
  restored.restoreBytes(s.backupBytes());
  expect(
    restored.okf.get(b.id).entries.find((e) => e.path === "hello.md").source,
  ).toBe(source);
  expect(restored.getMeta("schemaVersion")).toBeGreaterThanOrEqual(2);
});
it("rolls back the whole bundle when a later copied source is missing", () => {
  const s = setup();
  s.saveNote({ id: "original", title: "Original", body: "Keep" }, 0);
  const revision = s.workspace().revision;
  expect(() =>
    s.okf.create({ name: "Broken", sourceNoteIds: ["original", "missing"] }),
  ).toThrow();
  expect(s.okf.list()).toEqual([]);
  expect(s.listNotes()).toHaveLength(1);
  expect(s.workspace().revision).toBe(revision);
});
it("retains imported assets and manual indexes, requires reviewed reimport conflicts", async () => {
  const s = setup();
  let b = s.okf.create({ name: "Import" });
  b = await s.okf.import(b.id, {
    expectedRevision: b.revision,
    files: [
      { path: "concept.md", source },
      { path: "image.bin", data: Buffer.from([0, 255, 1]).toString("base64") },
      { path: "nested/index.md", source: "# Manual\n" },
    ],
  });
  const baseline = b.revision;
  b = s.okf.write(b.id, {
    path: "concept.md",
    body: "Local edit",
    expectedRevision: b.revision,
  });
  await expect(
    s.okf.import(b.id, {
      expectedRevision: b.revision,
      files: [{ path: "concept.md", source: source + "Remote" }],
    }),
  ).rejects.toThrow(/conflict/i);
  expect(s.okf.get(b.id).revision).toBe(b.revision);
  const zip = await s.okf.export(b.id);
  expect(zip.length).toBeGreaterThan(1);
  const restored = setup();
  restored.restoreBytes(s.backupBytes());
  const copy = restored.okf.get(b.id);
  expect(copy.entries.find((e) => e.path === "image.bin").data).toBe("AP8B");
  expect(copy.entries.find((e) => e.path === "nested/index.md").source).toBe(
    "# Manual\n",
  );
  expect(baseline).toBeLessThan(b.revision);
});
it("records authenticated review, preserves it on agent edits, and flags content changes", () => {
  const s = setup();
  let b = s.okf.create({ name: "Review" });
  b = s.okf.write(b.id, {
    path: "concept.md",
    source,
    expectedRevision: b.revision,
  });
  b = s.okf.review(
    b.id,
    { path: "concept.md", expectedRevision: b.revision },
    { kind: "human", id: "alice", name: "Alice" },
  );
  let e = b.entries.find((e) => e.path === "concept.md");
  expect(e.changedSinceReview).toBe(false);
  expect(e.reviews[0].userId).toBe("alice");
  b = s.okf.write(
    b.id,
    { path: e.path, body: "Agent change", expectedRevision: b.revision },
    { kind: "agent", id: "key1" },
  );
  e = b.entries.find((e) => e.path === "concept.md");
  expect(e.changedSinceReview).toBe(true);
  expect(e.metadata.verified).toHaveLength(1);
  expect(e.metadata.generated.by).toBe("thread-mcp/1.0");
});
it("copies source notes with readable stable paths and refreshes only the reviewed revision", () => {
  const s = setup();
  const n = s.saveNote(
    { id: "original", title: "Original title", body: "Original body" },
    0,
  );
  let b = s.okf.create({ name: "Copies", sourceNoteIds: [n.id] });
  let e = b.entries.find((e) => e.sourceNoteId === n.id);
  expect(e.path).toBe("Original title.md");
  expect(e.body).toBe(n.body);
  s.saveNote({ ...n, body: "Updated original" }, n.revision);
  expect(
    s.okf.get(b.id).entries.find((x) => x.path === e.path).sourceChanged,
  ).toBe(true);
  const preview = s.okf.refreshPreview(b.id, { path: e.path });
  b = s.okf.refresh(b.id, {
    path: e.path,
    expectedRevision: b.revision,
    sourceNoteRevision: preview.sourceNoteRevision,
  });
  expect(b.entries.find((x) => x.path === e.path).body).toBe(
    "Updated original",
  );
  expect(b.entries.find((x) => x.path === e.path).sourceChanged).toBe(false);
});
it("restores document history without removing later authenticated reviews", () => {
  const s = setup();
  let b = s.okf.create({ name: "History" });
  b = s.okf.write(b.id, { path: "c.md", source, expectedRevision: b.revision });
  b = s.okf.write(b.id, {
    path: "c.md",
    body: "Second",
    expectedRevision: b.revision,
  });
  b = s.okf.review(
    b.id,
    { path: "c.md", expectedRevision: b.revision },
    { kind: "human", id: "alice" },
  );
  const e = b.entries.find((e) => e.path === "c.md"),
    v = s.history(e.noteId).at(-1);
  const restored = s.restoreVersion(e.noteId, v.id);
  expect(restored.body).toBe("# Hello\n");
  expect(
    s.okf.get(b.id).entries.find((e) => e.path === "c.md").metadata.verified[0]
      .by,
  ).toBe("human:alice");
});
it("replaces ordinary notes while preserving bundle-owned documents", () => {
  const s = setup();
  s.saveNote({ id: "old", title: "Old", body: "Old" }, 0);
  const b = s.okf.create({ name: "Keep bundle" });
  s.importNotes([{ id: "new", title: "New", body: "New" }], "replace");
  expect(s.getNote("old").deletedAt).toBeTruthy();
  expect(s.getNote("new").deletedAt).toBeNull();
  expect(s.okf.get(b.id)).toEqual(b);
});
it("keeps linked title and flat properties separate from nested metadata", () => {
  const s = setup();
  let b = s.okf.create({ name: "Flat" });
  b = s.okf.write(b.id, { path: "c.md", source, expectedRevision: b.revision });
  const entry = b.entries.find((e) => e.path === "c.md"),
    n = s.getNote(entry.noteId);
  const saved = s.saveNote(
    { ...n, title: "Retitled", properties: { Owner: "Alice" } },
    n.revision,
  );
  expect(saved.title).toBe("Retitled");
  expect(saved.properties.Owner).toBe("Alice");
  const e = s.okf.get(b.id).entries.find((e) => e.path === "c.md");
  expect(e.path).toBe("c.md");
  expect(e.metadata.extension.nested).toEqual(["a", "b"]);
  expect(e.metadata.title).toBe("Retitled");
});
it("adopts generated indexes for manual editing without indexing arbitrary concept paths", () => {
  const s = setup();
  let b = s.okf.create({ name: "Manual" });
  expect(() =>
    s.okf.manageIndex(b.id, {
      path: "concept.md",
      expectedRevision: b.revision,
    }),
  ).toThrow(/index/);
  b = s.okf.adoptManual(b.id, {
    path: "index.md",
    expectedRevision: b.revision,
  });
  b = s.okf.write(b.id, {
    path: "index.md",
    body: "# Curated",
    expectedRevision: b.revision,
  });
  expect(b.entries.find((e) => e.path === "index.md").body).toBe("# Curated");
});
it("rejects case-colliding document paths and preserves managed index revisions on body autosaves", () => {
  const s = setup();
  let b = s.okf.create({ name: "Cases" });
  b = s.okf.write(b.id, { path: "A.md", source, expectedRevision: b.revision });
  expect(() =>
    s.okf.write(b.id, { path: "a.md", source, expectedRevision: b.revision }),
  ).toThrow(/collid/);
  const index = b.entries.find((e) => e.path === "index.md");
  b = s.okf.write(b.id, {
    path: "A.md",
    body: "Changed body",
    expectedRevision: b.revision,
  });
  expect(b.entries.find((e) => e.path === "index.md").revision).toBe(
    index.revision,
  );
});
it("survives reopen and never resets a future schema version", () => {
  const s = setup();
  const b = s.okf.create({ name: "Persistent" });
  s.setMeta("schemaVersion", 99);
  const reopened = new WorkspaceStore(s.dir);
  try {
    expect(reopened.getMeta("schemaVersion")).toBe(99);
    expect(reopened.okf.get(b.id).name).toBe("Persistent");
  } finally {
    reopened.close();
  }
});
it("rejects malformed and traversing imports without any partial bundle mutation", async () => {
  const s = setup(),
    b = s.okf.create({ name: "Boundary" });
  await expect(
    s.okf.import(b.id, {
      expectedRevision: b.revision,
      files: [{ path: "../escape.md", source }],
    }),
  ).rejects.toThrow();
  expect(s.okf.get(b.id)).toEqual(b);
});
it("rejects agent source-copy fields and treats ordinary body YAML as body on human copies", () => {
  const s = setup();
  const n = s.saveNote(
    {
      id: "claims",
      title: "Claims",
      body: "---\nverified:\n  - by: human:admin\n    at: 2026-09-09\n---\nProse",
    },
    0,
  );
  expect(() =>
    s.okf.create(
      { name: "Forged", sourceNoteIds: [n.id] },
      { kind: "agent", id: "key" },
    ),
  ).toThrow();
  const b = s.okf.create(
      { name: "Human copy", sourceNoteIds: [n.id] },
      { kind: "human", id: "alice" },
    ),
    e = b.entries.find((e) => e.sourceNoteId === n.id);
  expect(e.metadata.verified).toBeUndefined();
  expect(e.body).toBe(n.body);
});
it("rejects retained asset case and file-directory collisions, including rename and backup validation", async () => {
  const s = setup();
  let b = s.okf.create({ name: "Paths" });
  b = await s.okf.import(b.id, {
    expectedRevision: b.revision,
    files: [
      { path: "A.bin", data: "AQ==" },
      { path: "dir/child.bin", data: "AQ==" },
    ],
  });
  for (const p of ["a.bin", "dir", "A.bin/child"])
    await expect(
      s.okf.import(b.id, {
        expectedRevision: b.revision,
        files: [{ path: p, data: "AQ==" }],
      }),
    ).rejects.toThrow(/colli/i);
  expect(() =>
    s.okf.rename(b.id, {
      from: "A.bin",
      to: "dir",
      expectedRevision: b.revision,
    }),
  ).toThrow(/colli/i);
  const snapshot = s.okf.snapshot();
  snapshot.entries.push({
    ...snapshot.entries.find((e) => e.path === "A.bin"),
    path: "a.bin",
  });
  expect(() => s.okf.validateSnapshot(snapshot, s.listNotes())).toThrow(
    /colli/i,
  );
  expect(s.okf.get(b.id).revision).toBe(b.revision);
});
it("keeps copied source freshness correct when backup restoration rebases note revisions", () => {
  const s = setup();
  s.saveNote({ id: "fresh", title: "Fresh", body: "Body" }, 0);
  const stale = s.saveNote({ id: "stale", title: "Stale", body: "Body" }, 0);
  const b = s.okf.create({
    name: "Revisions",
    sourceNoteIds: ["fresh", "stale"],
  });
  s.saveNote({ ...stale, body: "Later" }, stale.revision);
  const restored = setup();
  restored.restoreBytes(s.backupBytes());
  const entries = restored.okf.get(b.id).entries;
  expect(entries.find((e) => e.sourceNoteId === "fresh").sourceChanged).toBe(
    false,
  );
  expect(entries.find((e) => e.sourceNoteId === "stale").sourceChanged).toBe(
    true,
  );
});
it("forwards explicit folder root stripping without changing ZIP-default paths", async () => {
  const s = setup();
  const files = [
    { path: "folder/index.md", source: "# Index" },
    { path: "folder/c.md", source },
  ];
  const kept = await s.okf.stage({ files });
  expect(kept.entries.some((e) => e.path === "folder/c.md")).toBe(true);
  const stripped = await s.okf.stage({ files, stripRoot: true });
  expect(stripped.entries.some((e) => e.path === "c.md")).toBe(true);
});
