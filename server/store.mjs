import { DatabaseSync } from "node:sqlite";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  renameSync,
  readdirSync,
  statSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
const now = () => new Date().toISOString();
const SAFE = /^[a-zA-Z0-9_-]{1,128}$/;
export class StoreError extends Error {
  constructor(message, status = 400, details = {}) {
    super(message);
    this.status = status;
    Object.assign(this, details);
  }
}
export function validateNote(note) {
  if (
    !isRecord(note) ||
    typeof note.id !== "string" ||
    !SAFE.test(note.id) ||
    typeof note.title !== "string" ||
    note.title.length > 500 ||
    typeof note.body !== "string" ||
    note.body.length > 2_000_000
  )
    throw new StoreError("Invalid note: ID, title or content is not valid.");
  if (
    note.properties &&
    (!isRecord(note.properties) ||
      Object.keys(note.properties).length > 100 ||
      Object.values(note.properties).some(
        (v) => typeof v !== "string" || v.length > 10000,
      ))
  )
    throw new StoreError("Properties must be text values.");
  for (const key of ["parentId", "notebookId"])
    if (note[key] && (typeof note[key] !== "string" || !SAFE.test(note[key])))
      throw new StoreError("Invalid page location.");
  return {
    ...note,
    properties: note.properties || {},
    parentId: note.parentId || null,
    notebookId: note.notebookId || null,
  };
}
function isRecord(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
const ASSET_ID = /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]{0,199}$/;
const validDate = (value) =>
  typeof value === "string" &&
  value.length <= 40 &&
  Number.isFinite(Date.parse(value));
function validateHierarchy(notes, detachOrphans = false) {
  const map = new Map(notes.map((n) => [n.id, n]));
  for (const n of notes)
    if (n.parentId && (!map.has(n.parentId) || map.get(n.parentId).deletedAt)) {
      if (detachOrphans) n.parentId = null;
      else throw new StoreError("Parent page does not exist.");
    }
  const done = new Set();
  for (const n of notes) {
    let current = n;
    const visiting = new Set();
    while (current && !done.has(current.id)) {
      if (visiting.has(current.id))
        throw new StoreError("Nested pages cannot form a cycle.");
      visiting.add(current.id);
      current = map.get(current.parentId);
    }
    for (const id of visiting) done.add(id);
  }
  return notes;
}
function validateSettings(value) {
  const fail = () => {
    throw new StoreError("Invalid workspace settings.");
  };
  const strings = (v, limit = 1000) =>
    Array.isArray(v) &&
    v.length <= limit &&
    v.every((x) => typeof x === "string" && x.length <= 500);
  if (!isRecord(value) || JSON.stringify(value).length > 1000000) fail();
  if (value.layout !== undefined) {
    const l = value.layout;
    if (!isRecord(l)) fail();
    if (
      l.panels !== undefined &&
      (!strings(l.panels, 3) || l.panels.some((id) => !SAFE.test(id)))
    )
      fail();
    if (
      l.tabs !== undefined &&
      (!strings(l.tabs, 10000) || l.tabs.some((id) => !SAFE.test(id)))
    )
      fail();
    if (
      l.widths !== undefined &&
      (!Array.isArray(l.widths) ||
        l.widths.length > 3 ||
        l.widths.some((w) => !Number.isFinite(w) || w <= 0 || w > 1000))
    )
      fail();
    if (l.view !== undefined && !["notes", "graph", "table"].includes(l.view))
      fail();
  }
  if (
    value.tableCustomFields !== undefined &&
    !strings(value.tableCustomFields, 100)
  )
    fail();
  if (
    value.tableActiveView !== undefined &&
    typeof value.tableActiveView !== "string"
  )
    fail();
  if (value.tableViews !== undefined) {
    if (!Array.isArray(value.tableViews) || value.tableViews.length > 1000)
      fail();
    for (const v of value.tableViews) {
      if (
        !isRecord(v) ||
        typeof v.id !== "string" ||
        typeof v.name !== "string" ||
        !strings(v.columns, 100) ||
        !Array.isArray(v.filters) ||
        v.filters.length > 100 ||
        !isRecord(v.sort) ||
        typeof v.sort.field !== "string" ||
        !["asc", "desc"].includes(v.sort.direction)
      )
        fail();
      for (const f of v.filters)
        if (
          !isRecord(f) ||
          typeof f.field !== "string" ||
          (f.value !== undefined && typeof f.value !== "string") ||
          (f.operator !== undefined && typeof f.operator !== "string")
        )
          fail();
    }
  }
  if (value.graphPositions !== undefined) {
    if (!isRecord(value.graphPositions)) fail();
    for (const p of Object.values(value.graphPositions))
      if (!isRecord(p) || !Number.isFinite(p.x) || !Number.isFinite(p.y))
        fail();
  }
  if (value.graphDepth !== undefined && ![1, 2, 3].includes(value.graphDepth))
    fail();
  if (value.graphFocus !== undefined && typeof value.graphFocus !== "string")
    fail();
  if (value.graphTags !== undefined && typeof value.graphTags !== "boolean")
    fail();
  return value;
}
function validateSnapshot(snapshot, files) {
  if (
    !isRecord(snapshot) ||
    snapshot.format !== "thread-workspace" ||
    snapshot.version !== 1 ||
    !Array.isArray(snapshot.notes) ||
    snapshot.notes.length > 100000
  )
    throw new StoreError("Unsupported backup.");
  const notes = snapshot.notes.map((input) => {
    const n = validateNote(input);
    if (
      !validDate(n.created) ||
      !validDate(n.updated) ||
      !Number.isSafeInteger(n.revision) ||
      n.revision < 1 ||
      (n.deletedAt != null && !validDate(n.deletedAt))
    )
      throw new StoreError("Invalid backup note metadata.");
    return n;
  });
  if (new Set(notes.map((n) => n.id)).size !== notes.length)
    throw new StoreError("Backup contains duplicate note IDs.");
  validateHierarchy(notes, true);
  const settings = snapshot.settings ?? {},
    notebooks = snapshot.notebooks ?? [],
    versions = snapshot.versions ?? [],
    assets = snapshot.assets ?? [];
  try {
    validateSettings(settings);
  } catch {
    throw new StoreError("Invalid backup settings.");
  }
  if (
    !Array.isArray(notebooks) ||
    notebooks.length > 1000 ||
    notebooks.some(
      (n) =>
        !isRecord(n) ||
        typeof n.id !== "string" ||
        !SAFE.test(n.id) ||
        typeof n.name !== "string" ||
        !n.name.trim() ||
        n.name.length > 120,
    ) ||
    new Set(notebooks.map((n) => n.id)).size !== notebooks.length
  )
    throw new StoreError("Invalid backup notebooks.");
  const noteIds = new Set(notes.map((n) => n.id));
  if (!Array.isArray(versions) || versions.length > 1000000)
    throw new StoreError("Invalid backup history.");
  for (const v of versions) {
    if (
      !isRecord(v) ||
      !noteIds.has(v.noteId) ||
      !validDate(v.savedAt) ||
      typeof v.data !== "string" ||
      v.data.length > 2100000
    )
      throw new StoreError("Invalid backup history.");
    let n;
    try {
      n = validateNote(JSON.parse(v.data));
    } catch {
      throw new StoreError("Invalid backup history.");
    }
    if (
      n.id !== v.noteId ||
      !validDate(n.created) ||
      !validDate(n.updated) ||
      !Number.isSafeInteger(n.revision) ||
      n.revision < 1 ||
      (n.deletedAt != null && !validDate(n.deletedAt))
    )
      throw new StoreError("Invalid backup history.");
  }
  if (!Array.isArray(assets) || assets.length > 100000)
    throw new StoreError("Invalid backup attachments.");
  const assetIds = new Set();
  for (const a of assets) {
    if (
      !isRecord(a) ||
      typeof a.id !== "string" ||
      !ASSET_ID.test(a.id) ||
      assetIds.has(a.id) ||
      typeof a.name !== "string" ||
      !a.name ||
      a.name.length > 200 ||
      /[\x00-\x1f/\\]/.test(a.name) ||
      typeof a.mime !== "string" ||
      !a.mime ||
      a.mime.length > 100 ||
      /[\r\n]/.test(a.mime) ||
      !Number.isInteger(a.size) ||
      a.size < 1 ||
      a.size > 20000000 ||
      !files["assets/" + a.id] ||
      files["assets/" + a.id].length !== a.size
    )
      throw new StoreError("Backup attachment is invalid.");
    assetIds.add(a.id);
  }
  return { notes, settings, notebooks, versions, assets };
}
function tags(body) {
  body = body.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "");
  return [
    ...new Set(
      [...body.matchAll(/(?:^|\s)#([\p{L}\p{N}_-]+)/gu)].map((m) => m[1]),
    ),
  ];
}
export class WorkspaceStore {
  constructor(dir) {
    this.dir = dir;
    for (const folder of ["notes", "assets", "backups"])
      mkdirSync(path.join(dir, folder), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path.join(dir, "workspace.sqlite"));
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS notes(id TEXT PRIMARY KEY,title TEXT NOT NULL,body TEXT NOT NULL,created TEXT NOT NULL,updated TEXT NOT NULL,revision INTEGER NOT NULL,deletedAt TEXT,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS versions(id INTEGER PRIMARY KEY AUTOINCREMENT,noteId TEXT NOT NULL,savedAt TEXT NOT NULL,data TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS versions_note ON versions(noteId,id DESC);
 CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY,name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,expires INTEGER NOT NULL);
 CREATE VIRTUAL TABLE IF NOT EXISTS note_fts USING fts5(id UNINDEXED,title,body,keywords,tokenize='unicode61');`);
    if (!this.getMeta("workspaceId")) this.setMeta("workspaceId", randomUUID());
    if (!this.getMeta("revision")) this.setMeta("revision", 0);
    this.setMeta("schemaVersion", 1);
  }
  close() {
    this.db.close();
  }
  getMeta(key) {
    const row = this.db.prepare("SELECT value FROM meta WHERE key=?").get(key);
    return row ? JSON.parse(row.value) : null;
  }
  setMeta(key, value) {
    this.db
      .prepare(
        "INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(key, JSON.stringify(value));
  }
  tx(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      this.db.exec("COMMIT");
      return value;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  bump() {
    this.setMeta("revision", (this.getMeta("revision") || 0) + 1);
  }
  settings() {
    return this.getMeta("settings") || {};
  }
  updateSettings(patch) {
    if (!isRecord(patch) || JSON.stringify(patch).length > 1_000_000)
      throw new StoreError("Invalid workspace settings.");
    const value = validateSettings({ ...this.settings(), ...patch });
    this.setMeta("settings", value);
    this.bump();
    return value;
  }
  notebooks() {
    return this.getMeta("notebooks") || [];
  }
  saveNotebooks(items) {
    if (
      !Array.isArray(items) ||
      items.length > 1000 ||
      items.some(
        (n) =>
          !SAFE.test(n.id) ||
          typeof n.name !== "string" ||
          !n.name.trim() ||
          n.name.length > 120,
      ) ||
      new Set(items.map((n) => n.id)).size !== items.length
    )
      throw new StoreError("Invalid notebooks.");
    this.setMeta("notebooks", items);
    this.bump();
    return items;
  }
  getNote(id) {
    const row = this.db.prepare("SELECT data FROM notes WHERE id=?").get(id);
    return row ? JSON.parse(row.data) : null;
  }
  listNotes() {
    return this.db
      .prepare(
        "SELECT data FROM notes WHERE deletedAt IS NULL ORDER BY updated DESC",
      )
      .all()
      .map((r) => JSON.parse(r.data));
  }
  listTrash() {
    return this.db
      .prepare(
        "SELECT data FROM notes WHERE deletedAt IS NOT NULL ORDER BY deletedAt DESC",
      )
      .all()
      .map((r) => JSON.parse(r.data));
  }
  workspace() {
    return {
      notes: this.listNotes(),
      trash: this.listTrash(),
      settings: this.settings(),
      notebooks: this.notebooks(),
      revision: this.getMeta("revision"),
      workspaceId: this.getMeta("workspaceId"),
      initialized: !!this.getMeta("initialized"),
      directory: this.dir,
    };
  }
  index(note) {
    this.db.prepare("DELETE FROM note_fts WHERE id=?").run(note.id);
    if (note.deletedAt) return;
    const prose = note.body
      .replace(/```[\s\S]*?```/g, "")
      .replace(/`[^`]*`/g, "");
    const refs = [
      ...prose.matchAll(/\((?:note:|block:)([^/)\s]+)/g),
      ...prose.matchAll(/!\[\[([^#\]]+)#[^\]]+\]\]/g),
    ]
      .map((m) => this.getNote(m[1])?.title || "")
      .join(" ");
    this.db
      .prepare("INSERT INTO note_fts(id,title,body,keywords) VALUES(?,?,?,?)")
      .run(
        note.id,
        note.title,
        note.body,
        tags(note.body).join(" ") + " " + refs,
      );
  }
  mirror(note) {
    const file = path.join(this.dir, "notes", note.id + ".md");
    const metadata = {
      id: note.id,
      title: note.title,
      created: note.created,
      updated: note.updated,
      revision: note.revision,
      deletedAt: note.deletedAt || null,
      notebookId: note.notebookId,
      parentId: note.parentId,
      properties: note.properties,
    };
    const contents =
      "<!-- thread:note " +
      JSON.stringify(metadata).replace(/-->/g, "--\\u003e") +
      " -->\n# " +
      note.title +
      "\n\n" +
      note.body;
    writeFileSync(file + ".tmp", contents, { mode: 0o600 });
    renameSync(file + ".tmp", file);
  }
  saveNote(input, baseRevision) {
    const note = validateNote(input);
    const current = this.getNote(note.id);
    if ((current?.revision || 0) !== Number(baseRevision))
      throw new StoreError(
        "Revision conflict: this note changed elsewhere.",
        409,
        { current },
      );
    if (note.parentId === note.id)
      throw new StoreError("A note cannot be its own parent.");
    let parent = note.parentId;
    const seen = new Set([note.id]);
    while (parent) {
      if (seen.has(parent))
        throw new StoreError("Nested pages cannot form a cycle.");
      seen.add(parent);
      const target = this.getNote(parent);
      if (!target || target.deletedAt)
        throw new StoreError("Parent page does not exist.");
      parent = target.parentId;
    }
    const saved = {
      ...note,
      created:
        current?.created || (validDate(note.created) ? note.created : now()),
      updated: now(),
      revision: (current?.revision || 0) + 1,
      deletedAt: note.deletedAt ? now() : null,
    };
    const detached = [];
    this.tx(() => {
      if (saved.deletedAt) {
        for (const child of this.listNotes().filter(
          (n) => n.parentId === saved.id,
        )) {
          const next = {
            ...child,
            parentId: saved.parentId || null,
            revision: child.revision + 1,
            updated: now(),
          };
          this.db
            .prepare("INSERT INTO versions(noteId,savedAt,data) VALUES(?,?,?)")
            .run(child.id, now(), JSON.stringify(child));
          this.db
            .prepare("UPDATE notes SET revision=?,updated=?,data=? WHERE id=?")
            .run(next.revision, next.updated, JSON.stringify(next), next.id);
          detached.push(next);
        }
      }
      if (current) {
        this.db
          .prepare("INSERT INTO versions(noteId,savedAt,data) VALUES(?,?,?)")
          .run(note.id, now(), JSON.stringify(current));
        this.db
          .prepare(
            "DELETE FROM versions WHERE noteId=? AND id NOT IN (SELECT id FROM versions WHERE noteId=? ORDER BY id DESC LIMIT 200)",
          )
          .run(note.id, note.id);
      }
      this.db
        .prepare(
          `INSERT INTO notes(id,title,body,created,updated,revision,deletedAt,data) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,body=excluded.body,updated=excluded.updated,revision=excluded.revision,deletedAt=excluded.deletedAt,data=excluded.data`,
        )
        .run(
          saved.id,
          saved.title,
          saved.body,
          saved.created,
          saved.updated,
          saved.revision,
          saved.deletedAt,
          JSON.stringify(saved),
        );
      this.index(saved);
      if (current && current.title !== saved.title) {
        for (const row of this.db
          .prepare("SELECT data FROM notes WHERE body LIKE ?")
          .all("%" + saved.id + "%"))
          this.index(JSON.parse(row.data));
      }
      this.bump();
    });
    try {
      this.mirror(saved);
      for (const child of detached) this.mirror(child);
    } catch (e) {
      saved.warning =
        "Saved in database; Markdown mirror could not be updated: " + e.message;
    }
    return saved;
  }
  deleteNote(id, revision) {
    const n = this.getNote(id);
    if (!n) throw new StoreError("Note not found.", 404);
    return this.saveNote({ ...n, deletedAt: now() }, revision);
  }
  restorableParent(note) {
    let parent = note.parentId;
    const seen = new Set([note.id]);
    while (parent) {
      if (seen.has(parent)) return null;
      seen.add(parent);
      const target = this.getNote(parent);
      if (!target || target.deletedAt) return null;
      parent = target.parentId;
    }
    return note.parentId || null;
  }
  restoreNote(id) {
    const n = this.getNote(id);
    if (!n) throw new StoreError("Note not found.", 404);
    return this.saveNote(
      { ...n, parentId: this.restorableParent(n), deletedAt: null },
      n.revision,
    );
  }
  history(id) {
    return this.db
      .prepare(
        "SELECT id,savedAt,data FROM versions WHERE noteId=? ORDER BY id DESC",
      )
      .all(id)
      .map((r) => ({ ...r, note: JSON.parse(r.data), data: undefined }));
  }
  restoreVersion(id, version) {
    const v = this.db
      .prepare("SELECT data FROM versions WHERE noteId=? AND id=?")
      .get(id, Number(version));
    const n = this.getNote(id);
    if (!v || !n) throw new StoreError("Version not found.", 404);
    const previous = JSON.parse(v.data);
    return this.saveNote(
      {
        ...previous,
        parentId: this.restorableParent(previous),
        deletedAt: null,
      },
      n.revision,
    );
  }
  search({ q = "", tag = "", from = "", to = "", dateField = "updated" } = {}) {
    const tokens = q.match(/[\p{L}\p{N}_]+/gu) || [];
    let rows = tokens.length
      ? this.db
          .prepare(
            "SELECT n.data FROM note_fts JOIN notes n ON n.id=note_fts.id WHERE note_fts MATCH ? AND n.deletedAt IS NULL ORDER BY bm25(note_fts)",
          )
          .all(tokens.map((t) => '"' + t + '"*').join(" AND "))
      : this.db
          .prepare(
            "SELECT data FROM notes WHERE deletedAt IS NULL ORDER BY updated DESC",
          )
          .all();
    return rows
      .map((r) => JSON.parse(r.data))
      .filter(
        (n) =>
          (!tag || tags(n.body).includes(tag)) &&
          (!from ||
            Date.parse(n[dateField === "created" ? "created" : "updated"]) >=
              Date.parse(from)) &&
          (!to ||
            Date.parse(n[dateField === "created" ? "created" : "updated"]) <=
              Date.parse(to)),
      )
      .map((n) => n.id);
  }
  addAsset(data, name, mime) {
    if (!Buffer.isBuffer(data) || !data.length || data.length > 20_000_000)
      throw new StoreError("Attachments must be between 1 byte and 20 MB.");
    const extensions = {
      "image/png": ".png",
      "image/jpeg": ".jpg",
      "image/gif": ".gif",
      "image/webp": ".webp",
      "image/svg+xml": ".svg",
      "application/pdf": ".pdf",
      "text/plain": ".txt",
    };
    const id = randomUUID() + (extensions[mime] || ".bin");
    const safeName = String(name || "attachment")
      .replace(/[\x00-\x1f/\\]/g, "_")
      .slice(0, 200);
    writeFileSync(path.join(this.dir, "assets", id), data, { mode: 0o600 });
    this.db
      .prepare("INSERT INTO assets VALUES(?,?,?,?)")
      .run(
        id,
        safeName,
        String(mime || "application/octet-stream").slice(0, 100),
        data.length,
      );
    return { id, name: safeName, mime, url: "/api/assets/" + id };
  }
  getAsset(id) {
    const a = this.db.prepare("SELECT * FROM assets WHERE id=?").get(id);
    if (!a) throw new StoreError("Attachment not found.", 404);
    return { ...a, data: readFileSync(path.join(this.dir, "assets", a.id)) };
  }
  backupBytes() {
    const snapshot = {
      format: "thread-workspace",
      version: 1,
      created: now(),
      notes: [...this.listNotes(), ...this.listTrash()],
      versions: this.db
        .prepare("SELECT noteId,savedAt,data FROM versions")
        .all(),
      settings: this.settings(),
      notebooks: this.notebooks(),
      assets: this.db.prepare("SELECT * FROM assets").all(),
    };
    const files = { "workspace.json": strToU8(JSON.stringify(snapshot)) };
    for (const asset of snapshot.assets)
      files["assets/" + asset.id] = this.getAsset(asset.id).data;
    return Buffer.from(zipSync(files, { level: 3 }));
  }
  listBackups() {
    return readdirSync(path.join(this.dir, "backups"))
      .filter((n) => /^\d+-[a-z0-9-]+\.zip$/.test(n))
      .map((id) => ({
        id,
        size: statSync(path.join(this.dir, "backups", id)).size,
        created: new Date(Number(id.split("-")[0])).toISOString(),
      }))
      .sort((a, b) => b.created.localeCompare(a.created));
  }
  createBackup() {
    const id = Date.now() + "-" + randomUUID() + ".zip";
    writeFileSync(path.join(this.dir, "backups", id), this.backupBytes(), {
      mode: 0o600,
    });
    for (const old of this.listBackups().slice(24))
      unlinkSync(path.join(this.dir, "backups", old.id));
    return this.listBackups().find((b) => b.id === id);
  }
  restoreBackup(id) {
    if (!this.listBackups().some((b) => b.id === id))
      throw new StoreError("Backup not found.", 404);
    return this.restoreBytes(readFileSync(path.join(this.dir, "backups", id)));
  }
  restoreBytes(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length > 250000000)
      throw new StoreError("Backup is too large or invalid.");
    let files,
      total = 0;
    try {
      files = unzipSync(bytes, {
        filter: (entry) => {
          if (
            entry.name !== "workspace.json" &&
            !/^assets\/[a-zA-Z0-9_-][a-zA-Z0-9_.-]{0,199}$/.test(entry.name)
          )
            throw new StoreError("Backup archive path is invalid.");
          total += entry.originalSize;
          if (
            total > 500000000 ||
            entry.originalSize >
              (entry.name === "workspace.json" ? 250000000 : 20000000)
          )
            throw new StoreError(
              "Backup archive expands beyond its size limit.",
            );
          return true;
        },
      });
    } catch (e) {
      if (e instanceof StoreError) throw e;
      throw new StoreError("Invalid backup ZIP.");
    }
    let snapshot;
    try {
      snapshot = JSON.parse(strFromU8(files["workspace.json"]));
    } catch {
      throw new StoreError("Missing workspace data.");
    }
    const { notes, settings, notebooks, versions, assets } = validateSnapshot(
      snapshot,
      files,
    );
    const revisionBase = this.getMeta("revision") || 0;
    for (const n of notes)
      if (!Number.isSafeInteger(revisionBase + n.revision + 1))
        throw new StoreError("Invalid backup revision.");
    const staging = mkdtempSync(path.join(this.dir, ".restore-")),
      newAssets = path.join(staging, "assets"),
      oldAssets = path.join(staging, "previous-assets"),
      assetDir = path.join(this.dir, "assets");
    let movedOld = false,
      movedNew = false,
      committed = false,
      cleanupSafe = true;
    try {
      mkdirSync(newAssets, { mode: 0o700 });
      for (const a of assets)
        writeFileSync(path.join(newAssets, a.id), files["assets/" + a.id], {
          mode: 0o600,
          flag: "wx",
        });
      this.createBackup();
      this.tx(() => {
        this.db.exec(
          "DELETE FROM note_fts;DELETE FROM notes;DELETE FROM versions;DELETE FROM assets;",
        );
        for (const n of notes) {
          const saved = {
            ...n,
            revision: revisionBase + n.revision + 1,
            deletedAt: n.deletedAt || null,
          };
          this.db
            .prepare("INSERT INTO notes VALUES(?,?,?,?,?,?,?,?)")
            .run(
              saved.id,
              saved.title,
              saved.body,
              saved.created,
              saved.updated,
              saved.revision,
              saved.deletedAt,
              JSON.stringify(saved),
            );
        }
        for (const n of this.listNotes()) this.index(n);
        for (const v of versions)
          this.db
            .prepare("INSERT INTO versions(noteId,savedAt,data) VALUES(?,?,?)")
            .run(v.noteId, v.savedAt, v.data);
        this.setMeta("settings", settings);
        this.setMeta("notebooks", notebooks);
        this.setMeta("initialized", true);
        for (const a of assets)
          this.db
            .prepare("INSERT INTO assets VALUES(?,?,?,?)")
            .run(a.id, a.name, a.mime, a.size);
        this.bump();
        renameSync(assetDir, oldAssets);
        movedOld = true;
        cleanupSafe = false;
        renameSync(newAssets, assetDir);
        movedNew = true;
      });
      committed = true;
      cleanupSafe = true;
    } catch (e) {
      if (!committed && movedOld) {
        if (movedNew) renameSync(assetDir, newAssets);
        renameSync(oldAssets, assetDir);
        cleanupSafe = true;
      }
      throw e;
    } finally {
      if (cleanupSafe) rmSync(staging, { recursive: true, force: true });
    }
    const ids = new Set(notes.map((n) => n.id + ".md"));
    for (const file of readdirSync(path.join(this.dir, "notes")))
      if (file.endsWith(".md") && !ids.has(file))
        unlinkSync(path.join(this.dir, "notes", file));
    for (const n of [...this.listNotes(), ...this.listTrash()]) this.mirror(n);
    return this.workspace();
  }

  importNotes(records, mode = "merge") {
    if (
      !Array.isArray(records) ||
      records.length > 100000 ||
      !["merge", "replace", "update"].includes(mode)
    )
      throw new StoreError("Invalid note import.");
    const notes = records.map(validateNote);
    if (new Set(notes.map((n) => n.id)).size !== notes.length)
      throw new StoreError("Duplicate note IDs in import.");
    const existing = [...this.listNotes(), ...this.listTrash()],
      existingMap = new Map(existing.map((n) => [n.id, n]));
    const imported = notes.filter(
      (n) => mode !== "merge" || !existingMap.has(n.id),
    );
    const importedIds = new Set(imported.map((n) => n.id));
    const requestedIds = new Set(notes.map((n) => n.id));
    const finalNotes = [
      ...existing
        .filter((n) => !importedIds.has(n.id))
        .map((n) =>
          mode === "replace" && !requestedIds.has(n.id)
            ? { ...n, deletedAt: n.deletedAt || now() }
            : { ...n },
        ),
      ...imported,
    ];
    validateHierarchy(finalNotes, true);
    // Validate the actual resulting graph, never relationships belonging to skipped merge records.
    if (mode === "replace") this.createBackup();
    this.tx(() => {
      for (const input of finalNotes) {
        if (mode === "merge" && !importedIds.has(input.id)) continue;
        const current = existingMap.get(input.id);
        if (
          !importedIds.has(input.id) &&
          JSON.stringify(input) === JSON.stringify(current)
        )
          continue;
        const saved = {
          ...input,
          created:
            current?.created ||
            (validDate(input.created) ? input.created : now()),
          updated: now(),
          revision: (current?.revision || 0) + 1,
          deletedAt: input.deletedAt ? now() : null,
        };
        if (current)
          this.db
            .prepare("INSERT INTO versions(noteId,savedAt,data) VALUES(?,?,?)")
            .run(saved.id, now(), JSON.stringify(current));
        this.db
          .prepare(
            "INSERT INTO notes VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,body=excluded.body,updated=excluded.updated,revision=excluded.revision,deletedAt=excluded.deletedAt,data=excluded.data",
          )
          .run(
            saved.id,
            saved.title,
            saved.body,
            saved.created,
            saved.updated,
            saved.revision,
            saved.deletedAt,
            JSON.stringify(saved),
          );
      }
      this.db.exec("DELETE FROM note_fts");
      for (const n of this.listNotes()) this.index(n);
      this.setMeta("initialized", true);
      this.bump();
    });
    for (const n of [...this.listNotes(), ...this.listTrash()]) this.mirror(n);
    return this.workspace();
  }
}
