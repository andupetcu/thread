import { randomUUID, createHash } from "node:crypto";
import path from "node:path";
import { StoreError } from "./store.mjs";
import {
  parseDocument,
  patchFrontmatter,
  serializeDocument,
} from "../shared/okf/document.mjs";
import { normalizeBundlePath } from "../shared/okf/paths.mjs";
import { validateBundle } from "../shared/okf/validate.mjs";
import {
  generateIndexes,
  renameBundlePath,
} from "../shared/okf/maintenance.mjs";
const generateIndex = (entries, options = {}) =>
  generateIndexes(entries, options).get(options.path || "index.md") ||
  "# Index\n";
const stamp = () => new Date().toISOString();
const hash = (x) => createHash("sha256").update(x).digest("hex");
const protectedFields = ["verified", "verification", "review", "reviews"];
const patch = (source, metadata) => {
  try {
    return patchFrontmatter(
      parseDocument(source).hasFrontmatter ? source : "---\n{}\n---\n" + source,
      metadata,
    );
  } catch (e) {
    throw new StoreError(e.message);
  }
};
const content = (e) => e.content ?? e.source ?? "";
const cleanPath = (p) => {
  try {
    return normalizeBundlePath(p);
  } catch (e) {
    throw new StoreError(e.message);
  }
};
function validatePaths(paths) {
  const files = new Map();
  for (const original of paths) {
    const normalized = cleanPath(original).normalize("NFC").toLowerCase();
    if (files.has(normalized))
      throw new StoreError(
        "Bundle paths collide: " + files.get(normalized) + " and " + original,
      );
    files.set(normalized, original);
  }
  for (const [file, original] of files) {
    const parts = file.split("/");
    parts.pop();
    while (parts.length) {
      if (files.has(parts.join("/")))
        throw new StoreError("File and directory paths collide: " + original);
      parts.pop();
    }
  }
}
const entriesForFormat = (entries) =>
  entries.map((e) => ({
    ...e,
    content:
      e.kind === "asset" ? Buffer.from(e.data || "", "base64") : e.source,
  }));
export class OkfStore {
  constructor(store) {
    this.store = store;
    this.db = store.db;
    store.tx(() => {
      this.db.exec(
        `CREATE TABLE IF NOT EXISTS okf_bundles(id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS okf_entries(bundleId TEXT NOT NULL,path TEXT NOT NULL,noteId TEXT UNIQUE,data TEXT NOT NULL,PRIMARY KEY(bundleId,path));`,
      );
      if (store.getMeta("schemaVersion") < 2) store.setMeta("schemaVersion", 2);
    });
  }
  list() {
    return this.db
      .prepare("SELECT data FROM okf_bundles ORDER BY id")
      .all()
      .map((r) => JSON.parse(r.data));
  }
  byNote(id) {
    const r = this.db
      .prepare("SELECT data FROM okf_entries WHERE noteId=?")
      .get(id || "");
    return r ? JSON.parse(r.data) : null;
  }
  get(id, validate = true) {
    const b = this.list().find((b) => b.id === id);
    if (!b) throw new StoreError("Bundle not found.", 404);
    const entries = this.db
      .prepare("SELECT data FROM okf_entries WHERE bundleId=? ORDER BY path")
      .all(id)
      .map((r) => {
        const e = JSON.parse(r.data);
        if (e.noteId) {
          const n = this.store.getNote(e.noteId);
          const parsed = parseDocument(n.okf.source, { path: e.path });
          return {
            ...e,
            body: n.body,
            source: n.okf.source,
            metadata: parsed.metadata,
            typed: parsed.typed,
            revision: n.revision,
            changedSinceReview:
              !!e.reviewedHash && e.reviewedHash !== hash(n.okf.source),
            sourceChanged:
              !!e.sourceNoteId &&
              this.store.getNote(e.sourceNoteId)?.revision !==
                e.sourceNoteRevision,
          };
        }
        return {
          ...e,
          url: `/api/okf/bundles/${id}/files?path=${encodeURIComponent(e.path)}`,
        };
      });
    return {
      ...b,
      entries,
      ...(validate ? validateBundle(entriesForFormat(entries)) : {}),
    };
  }
  check(id, revision) {
    const b = this.get(id);
    if (!Number.isSafeInteger(revision) || b.revision !== revision)
      throw new StoreError(
        "Revision conflict: this bundle changed elsewhere.",
        409,
        { current: b },
      );
    return b;
  }
  record(b) {
    const { entries, diagnostics, concepts, indexes, reserved, ok, ...data } =
      b;
    this.db
      .prepare(
        "INSERT INTO okf_bundles VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(b.id, JSON.stringify(data));
  }
  entry(e) {
    validatePaths([
      ...this.db
        .prepare("SELECT path FROM okf_entries WHERE bundleId=? AND path<>?")
        .all(e.bundleId, e.path)
        .map((row) => row.path),
      e.path,
    ]);
    this.db
      .prepare(
        "INSERT INTO okf_entries VALUES(?,?,?,?) ON CONFLICT(bundleId,path) DO UPDATE SET noteId=excluded.noteId,data=excluded.data",
      )
      .run(e.bundleId, e.path, e.noteId || null, JSON.stringify(e));
  }
  writeRaw(id, p, source, extra = {}, notePatch = {}) {
    p = cleanPath(p);
    validatePaths([
      ...this.get(id, false)
        .entries.filter((e) => e.path !== p)
        .map((e) => e.path),
      p,
    ]);
    if (!p.toLowerCase().endsWith(".md"))
      throw new StoreError("Document paths must end in .md.");
    if (
      this.get(id, false).entries.some(
        (e) =>
          e.path !== p && e.path.toLocaleLowerCase() === p.toLocaleLowerCase(),
      )
    )
      throw new StoreError("Path collides with another bundle file.");
    if (typeof source !== "string" || source.length > 2_000_000)
      throw new StoreError("Invalid document source.");
    const existing = this.get(id, false).entries.find((e) => e.path === p);
    if (existing?.kind === "asset")
      throw new StoreError("Path belongs to an attachment.");
    if (
      existing?.source === source &&
      this.store.getNote(existing.noteId)?.okf?.path === p &&
      Object.keys(extra).length === 0
    )
      return this.store.getNote(existing.noteId);
    const parsed = parseDocument(source, { path: p });
    const n = existing ? this.store.getNote(existing.noteId) : null;
    const note = this.store.saveNote(
      {
        ...n,
        ...notePatch,
        id: n?.id || randomUUID(),
        title: String(
          parsed.metadata?.title ||
            parsed.body.match(/^#\s+(.+)$/m)?.[1] ||
            path.posix.basename(p, ".md"),
        ).slice(0, 500),
        body: parsed.body,
        okf: { bundleId: id, path: p, source },
      },
      n?.revision || 0,
      { okfInternal: true },
    );
    const e = {
      ...existing,
      ...extra,
      bundleId: id,
      path: p,
      kind: "document",
      noteId: note.id,
    };
    for (const k of [
      "source",
      "body",
      "metadata",
      "revision",
      "changedSinceReview",
      "sourceChanged",
    ])
      delete e[k];
    this.entry(e);
    return note;
  }
  finish(id, summary) {
    let b = this.get(id);
    if (b.entries.some((e) => e.path === "index.md" && e.managed)) {
      for (const [indexPath, source] of generateIndexes(
        entriesForFormat(b.entries),
        { version: "0.2" },
      )) {
        if (!b.entries.some((e) => e.path === indexPath))
          this.writeRaw(id, indexPath, source, { managed: true });
      }
      b = this.get(id);
    }
    for (const e of b.entries.filter(
      (e) => e.managed && path.posix.basename(e.path) === "index.md",
    )) {
      const source = generateIndex(entriesForFormat(b.entries), {
        path: e.path,
        version: "0.2",
      });
      if (source !== e.source)
        this.writeRaw(id, e.path, source, { managed: true });
    }
    if (summary) {
      const log = this.get(id).entries.find((e) => e.path === "log.md");
      if (!log || log.managed) {
        const header = `## ${stamp().slice(0, 10)}`;
        let source = log?.source || "# Change log\n";
        const at = source.indexOf(header);
        if (at >= 0)
          source =
            source.slice(0, at + header.length) +
            `\n\n- ${summary}` +
            source.slice(at + header.length);
        else
          source = source.replace(
            /^# Change log\n/,
            `# Change log\n\n${header}\n\n- ${summary}\n`,
          );
        this.writeRaw(id, "log.md", source, { managed: true });
      }
    }
    b = this.get(id);
    this.record({ ...b, revision: b.revision + 1, updated: stamp() });
    this.store.bump();
    return this.get(id);
  }
  copyPath(id, title) {
    const base =
      String(title)
        .normalize("NFC")
        .replace(/[\\/\x00-\x1f<>:"|?*]/g, "-")
        .trim()
        .slice(0, 100) || "concept";
    const paths = new Set(
      this.get(id, false).entries.map((e) => e.path.toLowerCase()),
    );
    let candidate = base + ".md",
      i = 2;
    while (paths.has(candidate.toLowerCase()))
      candidate = base + "-" + i++ + ".md";
    return candidate;
  }
  create(input = {}, actor = { kind: "human" }) {
    if (
      actor.kind === "agent" &&
      (!input || Object.keys(input).some((key) => key !== "name"))
    )
      throw new StoreError("Only name is accepted when agents create bundles.");
    if (
      typeof input.name !== "string" ||
      !input.name.trim() ||
      input.name.length > 120
    )
      throw new StoreError("A bundle name is required.");
    return this.store.tx(() => {
      const id = randomUUID();
      this.record({
        id,
        name: input.name.trim(),
        revision: 0,
        created: stamp(),
        updated: stamp(),
      });
      this.writeRaw(
        id,
        "index.md",
        '---\nokf_version: "0.2"\n---\n# ' + input.name + "\n",
        { managed: true },
      );
      for (const noteId of input.sourceNoteIds || []) {
        const n = this.store.getNote(noteId);
        if (!n || n.deletedAt)
          throw new StoreError("Source note not found.", 404);
        this.writeRaw(
          id,
          this.copyPath(id, n.title),
          serializeDocument({
            body: n.body,
            metadata: {
              title: n.title,
              type: "concept",
              status: "draft",
            },
          }),
          { sourceNoteId: n.id, sourceNoteRevision: n.revision },
        );
      }
      return this.finish(id, "Created bundle.");
    });
  }
  write(id, input, actor = { kind: "human" }, notePatch = {}) {
    const b = this.check(id, input.expectedRevision ?? input.baseRevision);
    const p = cleanPath(input.path);
    const e = b.entries.find((e) => e.path === p);
    if (input.createOnly && e)
      throw new StoreError("Path already exists.", 409);
    if (
      actor.kind === "agent" &&
      ["index.md", "log.md"].includes(path.posix.basename(p))
    )
      throw new StoreError("Agents cannot modify reserved files.", 403);
    if (e?.managed)
      throw new StoreError("Adopt the managed file before editing it.");
    let source =
      input.source ?? e?.source ?? "---\ntype: concept\nstatus: draft\n---\n";
    if (input.body !== undefined) {
      if (typeof input.body !== "string")
        throw new StoreError("Body must be text.");
      const parsed = parseDocument(source);
      source = source.slice(0, source.length - parsed.body.length) + input.body;
    }
    if (input.metadata !== undefined) {
      if (
        !input.metadata ||
        Array.isArray(input.metadata) ||
        typeof input.metadata !== "object"
      )
        throw new StoreError("Metadata must be an object.");
      source = patch(source, input.metadata);
    }
    const next = parseDocument(source);
    const before = e?.metadata || {};
    for (const f of protectedFields)
      if (JSON.stringify(next.metadata?.[f]) !== JSON.stringify(before[f]))
        throw new StoreError(
          "Verification can only be changed through authenticated review.",
        );
    if (
      (actor.kind === "agent" || actor.id) &&
      source !== e?.source &&
      parseDocument(source).metadata
    )
      source = patch(source, {
        generated: {
          by: actor.kind === "agent" ? "thread-mcp/1.0" : "human:" + actor.id,
          at: stamp(),
        },
      });
    return this.store.tx(() => {
      this.writeRaw(
        id,
        p,
        source,
        {
          lastActor: actor.kind || "human",
          agentKeyId: actor.kind === "agent" ? actor.id : undefined,
        },
        notePatch,
      );
      return this.finish(id, e ? null : `Created ${p}.`);
    });
  }
  saveLinkedNote(input, revision, actor = { kind: "human" }) {
    const e = this.byNote(input.id),
      n = this.store.getNote(input.id);
    if (n.revision !== Number(revision))
      throw new StoreError(
        "Revision conflict: this note changed elsewhere.",
        409,
        { current: n },
      );
    if (input.deletedAt)
      throw new StoreError("Bundle documents cannot be deleted through notes.");
    if (input.okf && JSON.stringify(input.okf) !== JSON.stringify(n.okf))
      throw new StoreError(
        "Protected bundle metadata cannot be changed through notes.",
      );
    if (
      (input.parentId || null) !== (n.parentId || null) ||
      (input.notebookId || null) !== (n.notebookId || null)
    )
      throw new StoreError("Bundle document location is managed by its path.");
    this.write(
      e.bundleId,
      {
        path: e.path,
        body: input.body,
        ...(input.title !== n.title
          ? { metadata: { title: input.title } }
          : {}),
        expectedRevision: this.get(e.bundleId).revision,
      },
      actor,
      input,
    );
    return this.store.getNote(input.id);
  }
  restoreDocumentVersion(noteId, previous) {
    const entry = this.byNote(noteId),
      current = this.get(entry.bundleId).entries.find(
        (e) => e.noteId === noteId,
      );
    let source = previous.okf?.source || previous.body;
    const metadata = parseDocument(source).metadata;
    if (metadata) {
      const fields = {};
      for (const f of protectedFields) fields[f] = current.metadata?.[f];
      source = patch(source, fields);
    } else if (
      protectedFields.some((f) => current.metadata?.[f] !== undefined)
    ) {
      throw new StoreError(
        "Repair this historical source before restoring reviewed metadata.",
      );
    }
    this.write(entry.bundleId, {
      path: entry.path,
      source,
      expectedRevision: this.get(entry.bundleId).revision,
    });
    return this.store.getNote(noteId);
  }
  adoptManual(id, input) {
    const b = this.check(id, input.expectedRevision),
      e = b.entries.find((e) => e.path === input.path);
    if (!e?.managed) throw new StoreError("Managed file not found.", 404);
    return this.store.tx(() => {
      this.entry({ ...e, managed: false });
      return this.finish(id, `Made ${e.path} manual.`);
    });
  }
  refreshPreview(id, input) {
    const b = this.get(id),
      e = b.entries.find((e) => e.path === input.path),
      n = e && this.store.getNote(e.sourceNoteId);
    if (!e || !n || n.deletedAt)
      throw new StoreError("Original source note not found.", 404);
    return {
      revision: b.revision,
      path: e.path,
      sourceNoteRevision: n.revision,
      body: n.body,
      currentBody: e.body,
    };
  }
  refresh(id, input) {
    this.check(id, input.expectedRevision);
    const preview = this.refreshPreview(id, input);
    if (preview.sourceNoteRevision !== input.sourceNoteRevision)
      throw new StoreError("Revision conflict: original note changed.", 409);
    return this.store.tx(() => {
      this.write(id, {
        path: input.path,
        body: preview.body,
        expectedRevision: input.expectedRevision,
      });
      const e = this.get(id).entries.find((e) => e.path === input.path);
      this.entry({ ...e, sourceNoteRevision: preview.sourceNoteRevision });
      return this.finish(id, `Refreshed ${input.path} from its source note.`);
    });
  }
  renamePreview(id, input) {
    const b = this.check(id, input.expectedRevision);
    try {
      return {
        ...renameBundlePath(entriesForFormat(b.entries), input.from, input.to),
        revision: b.revision,
      };
    } catch (e) {
      throw new StoreError(e.message);
    }
  }
  rename(id, input) {
    const b = this.check(id, input.expectedRevision),
      from = cleanPath(input.from),
      to = cleanPath(input.to);
    if (!b.entries.some((e) => e.path === from))
      throw new StoreError("Document not found.", 404);
    if (
      b.entries.some(
        (e) => e.path.toLocaleLowerCase() === to.toLocaleLowerCase(),
      )
    )
      throw new StoreError("Path already exists.");
    validatePaths(b.entries.map((e) => (e.path === from ? to : e.path)));
    const preview = renameBundlePath(entriesForFormat(b.entries), from, to);
    return this.store.tx(() => {
      this.check(id, input.expectedRevision);
      const original = b.entries.find((e) => e.path === from);
      this.db
        .prepare("DELETE FROM okf_entries WHERE bundleId=? AND path=?")
        .run(id, from);
      this.entry({ ...original, path: to });
      for (const e of preview.entries) {
        const source = content(e);
        const old = b.entries.find(
          (x) => x.path === (e.path === to ? from : e.path),
        );
        if (e.kind !== "asset" && (e.path === to || source !== old?.source))
          this.writeRaw(id, e.path, source);
      }
      return this.finish(id, `Moved ${from} to ${to}.`);
    });
  }
  review(id, input, actor) {
    if (actor?.kind !== "human" || !actor.id)
      throw new StoreError("Authenticated human review is required.", 403);
    const b = this.check(id, input.expectedRevision),
      e = b.entries.find((e) => e.path === input.path);
    if (!e?.noteId) throw new StoreError("Document not found.", 404);
    const event = { by: "human:" + actor.id, at: stamp() };
    const previous = e.metadata?.verified;
    const events =
      previous == null ? [] : Array.isArray(previous) ? previous : [previous];
    return this.store.tx(() => {
      this.check(id, input.expectedRevision);
      const source = patch(e.source, { verified: [...events, event] });
      this.writeRaw(id, e.path, source, {
        reviewedHash: hash(source),
        reviews: [...(e.reviews || []), { ...event, userId: actor.id }],
      });
      return this.finish(id, `Reviewed ${e.path}.`);
    });
  }
  indexPreview(id) {
    const b = this.get(id);
    return {
      revision: b.revision,
      source: generateIndex(entriesForFormat(b.entries), { version: "0.2" }),
    };
  }
  manageIndex(id, input) {
    this.check(id, input.expectedRevision);
    if (path.posix.basename(cleanPath(input.path || "index.md")) !== "index.md")
      throw new StoreError("Only index.md can be managed as an index.");
    return this.store.tx(() => {
      this.writeRaw(
        id,
        input.path || "index.md",
        this.indexPreview(id).source,
        { managed: true },
      );
      return this.finish(id, "Regenerated index.");
    });
  }
  snapshot() {
    return {
      bundles: this.list(),
      entries: this.db
        .prepare("SELECT data FROM okf_entries")
        .all()
        .map((r) => JSON.parse(r.data)),
    };
  }
  validateSnapshot(data, notes) {
    if (!data) {
      if (notes.some((n) => n.okf))
        throw new StoreError("Backup is missing bundle mappings.");
      return;
    }
    if (!Array.isArray(data.bundles) || !Array.isArray(data.entries))
      throw new StoreError("Invalid bundle backup.");
    const ids = new Set(data.bundles.map((b) => b.id)),
      keys = new Set(),
      noteIds = new Set();
    if (ids.size !== data.bundles.length || data.entries.length > 100000)
      throw new StoreError("Invalid bundle backup.");
    for (const b of data.bundles)
      validatePaths(
        data.entries.filter((e) => e.bundleId === b.id).map((e) => e.path),
      );
    for (const b of data.bundles)
      if (
        typeof b.id !== "string" ||
        typeof b.name !== "string" ||
        !Number.isSafeInteger(b.revision)
      )
        throw new StoreError("Invalid bundle backup.");
    for (const e of data.entries) {
      cleanPath(e.path);
      const key = e.bundleId + "/" + e.path;
      if (
        keys.has(key) ||
        !ids.has(e.bundleId) ||
        !["asset", "document"].includes(e.kind)
      )
        throw new StoreError("Invalid bundle mapping.");
      keys.add(key);
      if (e.kind === "document") {
        const n = notes.find((n) => n.id === e.noteId);
        if (
          noteIds.has(e.noteId) ||
          !n ||
          n.okf?.bundleId !== e.bundleId ||
          n.okf?.path !== e.path ||
          typeof n.okf?.source !== "string" ||
          parseDocument(n.okf.source).body !== n.body
        )
          throw new StoreError("Invalid bundle note.");
        noteIds.add(e.noteId);
      } else if (
        typeof e.data !== "string" ||
        Buffer.from(e.data, "base64").length > 20_000_000
      )
        throw new StoreError("Invalid bundle asset.");
    }
    if (notes.some((n) => n.okf && !noteIds.has(n.id)))
      throw new StoreError("Unmapped bundle note.");
  }
  restoreSnapshot(data, revision) {
    this.db.exec("DELETE FROM okf_entries;DELETE FROM okf_bundles;");
    for (const b of data?.bundles || [])
      this.record({ ...b, revision: b.revision + revision + 1 });
    for (const e of data?.entries || []) {
      const source = e.sourceNoteId && this.store.getNote(e.sourceNoteId);
      this.entry({
        ...e,
        ...(source && source.revision === e.sourceNoteRevision + revision + 1
          ? { sourceNoteRevision: source.revision }
          : {}),
      });
    }
  }
  async stage(input) {
    try {
      const { parseOkfArchive, inspectOkfFolder } =
        await import("./okf-archive.mjs");
      if (input.zip)
        return await parseOkfArchive(Buffer.from(input.zip, "base64"), {
          stripRoot: input.stripRoot,
        });
      if (!Array.isArray(input.files))
        throw new Error("Import files must be an array.");
      return inspectOkfFolder(
        input.files.map((e) => ({
          ...e,
          content:
            e.source !== undefined
              ? e.source
              : Buffer.from(e.data || "", "base64"),
        })),
        { stripRoot: input.stripRoot },
      );
    } catch (e) {
      if (e instanceof StoreError) throw e;
      throw new StoreError(e.message);
    }
  }
  async importPreview(id, input) {
    const b = this.get(id),
      stage = await this.stage(input);
    return {
      ...stage,
      revision: b.revision,
      entries: stage.entries.map((e) => {
        const old = b.entries.find((x) => x.path === e.path),
          bytes =
            typeof e.content === "string" ? Buffer.from(e.content) : e.content;
        return {
          ...e,
          content: undefined,
          source: typeof e.content === "string" ? e.content : undefined,
          data:
            typeof e.content === "string"
              ? undefined
              : Buffer.from(e.content).toString("base64"),
          action: !old
            ? "add"
            : hash(
                  old.kind === "asset"
                    ? Buffer.from(old.data, "base64")
                    : old.source,
                ) === hash(bytes)
              ? "unchanged"
              : old.baselineHash &&
                  old.baselineHash ===
                    hash(
                      old.kind === "asset"
                        ? Buffer.from(old.data, "base64")
                        : old.source,
                    )
                ? "update"
                : "conflict",
        };
      }),
    };
  }
  async import(id, input, actor) {
    if (actor?.kind === "agent")
      throw new StoreError("Agent import is not available.", 403);
    const stage = await this.stage(input);
    this.check(id, input.expectedRevision);
    return this.store.tx(() => {
      const currentBundle = this.check(id, input.expectedRevision);
      validatePaths([
        ...new Set([
          ...currentBundle.entries.map((e) => e.path),
          ...stage.entries.map((e) => cleanPath(e.path)),
        ]),
      ]);
      for (const e of stage.entries) {
        let p = cleanPath(e.path),
          old = this.get(id).entries.find((x) => x.path === p);
        const bytes =
          typeof e.content === "string"
            ? Buffer.from(e.content)
            : Buffer.from(e.content);
        const h = hash(bytes);
        if (old) {
          const current = hash(
            old.kind === "asset" ? Buffer.from(old.data, "base64") : old.source,
          );
          if (current === h) continue;
          const choice = input.choices?.[p];
          if (choice === "keep") continue;
          if (
            !old.managed &&
            old.baselineHash !== current &&
            choice !== "update" &&
            choice !== "copy"
          )
            throw new StoreError(
              "Import conflict requires keep, update or copy.",
              409,
            );
          if (choice === "copy") {
            const ext = path.posix.extname(p);
            p =
              p.slice(0, p.length - ext.length) +
              "-copy-" +
              randomUUID().slice(0, 8) +
              ext;
            old = null;
          }
        }
        if (e.kind === "document" || p.toLowerCase().endsWith(".md"))
          this.writeRaw(id, p, bytes.toString("utf8"), {
            managed: false,
            baselineHash: h,
            imported: true,
          });
        else {
          if (old?.noteId) throw new StoreError("Import kind conflict.");
          this.entry({
            bundleId: id,
            path: p,
            kind: "asset",
            assetId: old?.assetId || randomUUID(),
            data: bytes.toString("base64"),
            baselineHash: h,
            revision: (old?.revision || 0) + 1,
          });
        }
      }
      return this.finish(id, "Imported bundle files.");
    });
  }
  async export(id) {
    const { createOkfArchive } = await import("./okf-archive.mjs");
    return createOkfArchive(entriesForFormat(this.get(id).entries));
  }
}
