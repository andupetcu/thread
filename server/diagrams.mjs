import { randomUUID, createHash } from "node:crypto";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { parseDiagram } from "../src/diagram/model.js";
import { StoreError } from "./store.mjs";
const parser = unified().use(remarkParse);
const safe = /^[a-zA-Z0-9_-]{1,128}$/;
const fail = (message = "Invalid diagram input.", status = 400) => {
  throw new StoreError(message, status);
};
export function fields(input, allowed) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((k) => !allowed.includes(k))
  )
    fail();
}
const id = (value) => {
  if (typeof value !== "string" || !safe.test(value)) fail("Invalid ID.");
  return value;
};
const revision = (value) => {
  if (!Number.isSafeInteger(value) || value < 1)
    fail("A valid revision is required.");
  return value;
};
const ordinal = (value) => {
  if (!Number.isSafeInteger(value) || value < 0) fail("Invalid diagram index.");
  return value;
};
const diagram = (value) => {
  if (!value || (typeof value !== "object" && typeof value !== "string"))
    fail();
  try {
    return parseDiagram(value);
  } catch (e) {
    fail(e.message);
  }
};
const name = (value) => {
  if (typeof value !== "string" || !value.trim() || value.length > 200)
    fail("Template name is required (up to 200 characters).");
  return value.trim();
};
export function extractDiagrams(body) {
  const result = [];
  const visit = (node, blockId) => {
    let current = blockId;
    for (const child of node.children || []) {
      if (child.type === "html") {
        const match = child.value
          .trim()
          .match(/^<!-- thread:block id=([A-Za-z0-9_-]+) -->$/);
        if (match) current = match[1];
        else if (child.value.trim() === "<!-- thread:block -->")
          current = undefined;
      }
      if (child.type === "code" && child.lang === "thread-diagram") {
        const start = child.position.start.offset,
          end = child.position.end.offset;
        result.push({
          diagramIndex: result.length,
          ...(current ? { blockId: current } : {}),
          diagram: diagram(child.value),
          sourceHash: createHash("sha256")
            .update(body.slice(start, end))
            .digest("hex"),
          start,
          end,
          column: child.position.start.column,
        });
      }
      visit(child, current);
    }
  };
  visit(parser.parse(body));
  return result;
}
export class DiagramStore {
  constructor(store) {
    this.store = store;
    store.db.exec(
      "CREATE TABLE IF NOT EXISTS diagram_templates(id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS diagram_proposals(id TEXT PRIMARY KEY,data TEXT NOT NULL);",
    );
  }
  rows(table) {
    return this.store.db
      .prepare(`SELECT data FROM ${table}`)
      .all()
      .map((r) => JSON.parse(r.data));
  }
  put(table, value) {
    this.store.db
      .prepare(
        `INSERT INTO ${table}(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`,
      )
      .run(value.id, JSON.stringify(value));
  }
  list(noteId) {
    const note = this.store.getNote(id(noteId));
    if (!note || note.deletedAt) fail("Note not found.", 404);
    return {
      noteId,
      revision: note.revision,
      diagrams: extractDiagrams(note.body).map(
        ({ start, end, column, ...item }) => item,
      ),
    };
  }
  templates() {
    return this.rows("diagram_templates");
  }
  templateRevisionFloor(extra = []) {
    return Math.max(
      this.store.getMeta("diagramTemplateRevision") || 0,
      ...this.templates().map((t) => t.revision),
      ...extra,
    );
  }
  nextTemplateRevision(floor = this.templateRevisionFloor()) {
    const next = floor + 1;
    if (!Number.isSafeInteger(next)) fail("Template revision limit reached.");
    this.store.setMeta("diagramTemplateRevision", next);
    return next;
  }
  saveTemplate(input, templateId) {
    fields(
      input,
      templateId ? ["name", "diagram", "baseRevision"] : ["name", "diagram"],
    );
    return this.store.tx(() => {
      const current = templateId
        ? this.templates().find((t) => t.id === id(templateId))
        : null;
      if (templateId && !current) fail("Template not found.", 404);
      if (templateId && revision(input.baseRevision) !== current.revision)
        fail("Template revision conflict.", 409);
      if (templateId && input.name === undefined && input.diagram === undefined)
        fail();
      const saved = {
        id: current?.id || randomUUID(),
        name:
          input.name === undefined && current ? current.name : name(input.name),
        diagram:
          input.diagram === undefined && current
            ? current.diagram
            : diagram(input.diagram),
        revision: this.nextTemplateRevision(),
      };
      this.put("diagram_templates", saved);
      this.store.bump();
      return saved;
    });
  }
  proposals(noteId) {
    this.list(noteId);
    return this.rows("diagram_proposals").filter(
      (p) => p.noteId === noteId && p.status === "pending",
    );
  }
  propose(input, actor) {
    fields(input, [
      "noteId",
      "diagramIndex",
      "baseRevision",
      "diagram",
      "summary",
    ]);
    id(input.noteId);
    ordinal(input.diagramIndex);
    revision(input.baseRevision);
    if (
      typeof input.summary !== "string" ||
      !input.summary.trim() ||
      input.summary.length > 2000
    )
      fail("Summary is required (up to 2000 characters).");
    const value = diagram(input.diagram);
    return this.store.tx(() => {
      const current = this.list(input.noteId);
      if (current.revision !== input.baseRevision)
        fail("Note revision conflict.", 409);
      const source = current.diagrams[input.diagramIndex];
      if (!source) fail("Diagram not found.", 404);
      const proposal = {
        id: randomUUID(),
        noteId: input.noteId,
        diagramIndex: input.diagramIndex,
        baseRevision: input.baseRevision,
        sourceHash: source.sourceHash,
        ...(source.blockId ? { blockId: source.blockId } : {}),
        diagram: value,
        summary: input.summary.trim(),
        created: new Date().toISOString(),
        actor,
        status: "pending",
      };
      this.put("diagram_proposals", proposal);
      this.store.bump();
      return proposal;
    });
  }
  resolve(proposalId, action, input, actor) {
    if (actor?.kind !== "human") fail("Human review required.", 403);
    fields(input, action === "apply" ? ["expectedRevision"] : []);
    if (action === "apply") revision(input.expectedRevision);
    return this.store.tx(() => {
      const proposal = this.rows("diagram_proposals").find(
        (p) => p.id === id(proposalId),
      );
      if (!proposal) fail("Proposal not found.", 404);
      if (proposal.status !== "pending")
        fail("Proposal is no longer pending.", 409);
      let note;
      if (action === "apply") {
        const current = this.store.getNote(proposal.noteId);
        if (!current || current.deletedAt) fail("Note not found.", 404);
        if (
          current.revision !== proposal.baseRevision ||
          current.revision !== input.expectedRevision
        )
          fail("Note revision conflict. Request a fresh proposal.", 409);
        const source = extractDiagrams(current.body)[proposal.diagramIndex];
        if (
          !source ||
          source.sourceHash !== proposal.sourceHash ||
          source.blockId !== proposal.blockId
        )
          fail("Diagram source conflict.", 409);
        // Fence length exceeds any embedded backtick run. AST offsets preserve all unrelated source.
        const value = JSON.stringify(diagram(proposal.diagram), null, 2);
        const fence = "`".repeat(
          Math.max(
            3,
            ...Array.from(value.matchAll(/`+/g), (m) => m[0].length + 1),
          ),
        );
        const original = current.body.slice(source.start, source.end);
        const indent = current.body.slice(
          current.body.lastIndexOf("\n", source.start - 1) + 1,
          source.start,
        );
        // Nested list/blockquote fences require container-aware serialization; never corrupt those notes.
        if (source.column !== 1 || indent.trim() || /\n\s*>/.test(original))
          fail(
            "Move this diagram to a top-level block before applying a proposal.",
          );
        note = this.store.saveNote(
          {
            ...current,
            body:
              current.body.slice(0, source.start) +
              `${fence}thread-diagram\n${value}\n${fence}` +
              current.body.slice(source.end),
          },
          current.revision,
          { actor },
        );
      }
      const saved = {
        ...proposal,
        status: action === "apply" ? "applied" : "rejected",
      };
      this.put("diagram_proposals", saved);
      this.store.bump();
      return action === "apply" ? { note } : { proposal: saved };
    });
  }
  snapshot() {
    return {
      version: 1,
      templates: this.templates(),
      proposals: this.rows("diagram_proposals"),
    };
  }
  validateSnapshot(value, notes) {
    if (value === undefined) return;
    fields(value, ["version", "templates", "proposals"]);
    if (
      value.version !== 1 ||
      !Array.isArray(value.templates) ||
      !Array.isArray(value.proposals) ||
      value.templates.length > 10000 ||
      value.proposals.length > 100000
    )
      fail("Invalid diagram backup.");
    for (const [items, type] of [
      [value.templates, "template"],
      [value.proposals, "proposal"],
    ]) {
      const seen = new Set();
      for (const item of items) {
        if (!item || typeof item !== "object") fail();
        id(item.id);
        if (seen.has(item.id)) fail("Duplicate diagram backup ID.");
        seen.add(item.id);
        diagram(item.diagram);
        if (type === "template") {
          fields(item, ["id", "name", "diagram", "revision"]);
          name(item.name);
          revision(item.revision);
        } else {
          fields(item, [
            "id",
            "noteId",
            "diagramIndex",
            "baseRevision",
            "sourceHash",
            "blockId",
            "diagram",
            "summary",
            "created",
            "actor",
            "status",
          ]);
          id(item.noteId);
          ordinal(item.diagramIndex);
          revision(item.baseRevision);
          if (
            !notes.some((n) => n.id === item.noteId) ||
            !/^[a-f0-9]{64}$/.test(item.sourceHash) ||
            !["pending", "applied", "rejected", "stale"].includes(
              item.status,
            ) ||
            typeof item.summary !== "string" ||
            !item.summary.trim() ||
            item.summary.length > 2000 ||
            typeof item.created !== "string" ||
            !Number.isFinite(Date.parse(item.created))
          )
            fail("Invalid diagram proposal backup.");
          if (item.blockId !== undefined) id(item.blockId);
          fields(item.actor, ["kind", "id"]);
          if (item.actor.kind !== "agent") fail();
          id(item.actor.id);
        }
      }
    }
  }
  restoreSnapshot(value, revisionBase) {
    // This local high-water mark is deliberately not restored from a backup.
    // Capture even omitted templates before deletion, including pre-migration rows.
    let highWater = this.templateRevisionFloor([
      revisionBase,
      ...(value?.templates || []).map((t) => t.revision),
    ]);
    this.store.setMeta("diagramTemplateRevision", highWater);
    this.store.db.exec(
      "DELETE FROM diagram_templates;DELETE FROM diagram_proposals;",
    );
    for (const t of value?.templates || []) {
      highWater = this.nextTemplateRevision(highWater);
      this.put("diagram_templates", { ...t, revision: highWater });
    }
    for (const p of value?.proposals || [])
      this.put("diagram_proposals", {
        ...p,
        status: p.status === "pending" ? "stale" : p.status,
      });
  }
}
