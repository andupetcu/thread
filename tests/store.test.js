import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { afterEach, it, expect } from "vitest";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { WorkspaceStore } from "../server/store.mjs";
const cleanup = [];
afterEach(() => {
  for (const [s, d] of cleanup) {
    s.close();
    rmSync(d, { recursive: true, force: true });
  }
  cleanup.length = 0;
});
function store() {
  const dir = mkdtempSync(path.join(tmpdir(), "thread-store-"));
  const s = new WorkspaceStore(dir);
  cleanup.push([s, dir]);
  return s;
}
const note = {
  id: "first",
  title: "API design",
  body: "## Design\n\nOAuth tokens #api",
  created: "2026-09-09T10:00:00.000Z",
  updated: "2026-09-09T10:00:00.000Z",
};
it("persists notes and Markdown mirrors across reopen", () => {
  const s = store();
  const saved = s.saveNote(note, 0);
  expect(saved.revision).toBe(1);
  expect(existsSync(path.join(s.dir, "notes", "first.md"))).toBe(true);
  expect(readFileSync(path.join(s.dir, "notes", "first.md"), "utf8")).toContain(
    "OAuth",
  );
  const other = new WorkspaceStore(s.dir);
  expect(other.getNote("first").title).toBe(note.title);
  other.close();
});
it("rejects stale revisions without overwriting data", () => {
  const s = store();
  s.saveNote(note, 0);
  s.saveNote({ ...note, title: "Current" }, 1);
  expect(() => s.saveNote({ ...note, title: "Stale" }, 1)).toThrow(/conflict/i);
  expect(s.getNote("first").title).toBe("Current");
});
it("retains history and soft-deleted notes and can restore each", () => {
  const s = store();
  s.saveNote(note, 0);
  s.saveNote({ ...note, body: "Changed" }, 1);
  const version = s.history("first")[0];
  s.restoreVersion("first", version.id);
  expect(s.getNote("first").body).toBe(note.body);
  s.deleteNote("first", 3);
  expect(s.listNotes()).toHaveLength(0);
  expect(s.listTrash()).toHaveLength(1);
  s.restoreNote("first");
  expect(s.listNotes()).toHaveLength(1);
});
it("search indexes title body tags and date boundaries", () => {
  const s = store();
  s.saveNote(note, 0);
  expect(s.search({ q: "OAuth" })).toContain("first");
  expect(s.search({ tag: "api" })).toContain("first");
  expect(s.search({ from: "2099-01-01T00:00" })).toEqual([]);
});
it("backup restores edited records, metadata and assets", () => {
  const s = store();
  s.saveNote(note, 0);
  const asset = s.addAsset(Buffer.from("hello"), "notes.txt", "text/plain");
  s.updateSettings({ test: "old" });
  const backup = s.createBackup();
  s.saveNote({ ...note, title: "Changed" }, 1);
  s.updateSettings({ test: "new" });
  s.restoreBackup(backup.id);
  expect(s.getNote("first").title).toBe(note.title);
  expect(s.settings().test).toBe("old");
  expect(s.getAsset(asset.id).data.toString()).toBe("hello");
});

function editBackup(s, edit, extra = {}) {
  const files = unzipSync(s.backupBytes());
  const snapshot = JSON.parse(strFromU8(files["workspace.json"]));
  edit(snapshot);
  return Buffer.from(
    zipSync({
      ...files,
      ...extra,
      "workspace.json": strToU8(JSON.stringify(snapshot)),
    }),
  );
}
it("rejects unsafe attachment IDs and leaves the workspace intact", () => {
  const s = store();
  s.saveNote(note, 0);
  const before = s.workspace();
  for (const id of ["..", ".", "../workspace.sqlite", "nested/file", "a\\b"]) {
    const bytes = editBackup(
      s,
      (d) => {
        d.assets = [{ id, name: "bad", mime: "text/plain", size: 1 }];
      },
      { ["assets/" + id]: strToU8("x") },
    );
    expect(() => s.restoreBytes(bytes)).toThrow(/attachment|archive/i);
    expect(s.workspace()).toEqual(before);
  }
});
it("validates all backup metadata and history before making a safety backup or changing state", () => {
  const s = store();
  s.saveNote(note, 0);
  const before = s.workspace();
  const edits = [
    (d) => {
      d.settings = [];
    },
    (d) => {
      d.notebooks = [{ id: "x", name: 4 }];
    },
    (d) => {
      d.notes[0].revision = -2;
    },
    (d) => {
      d.notes[0].created = "yesterday";
    },
    (d) => {
      d.versions = [{ noteId: "first", savedAt: note.created, data: "{}" }];
    },
    (d) => {
      d.assets = [{ id: "good.txt", name: "x", mime: "text/plain", size: 99 }];
    },
  ];
  for (const edit of edits) {
    expect(() =>
      s.restoreBytes(editBackup(s, edit, { "assets/good.txt": strToU8("x") })),
    ).toThrow();
    expect(s.workspace()).toEqual(before);
    expect(s.listBackups()).toHaveLength(0);
  }
});
it("restores orphaned parents as root pages and rejects cycles without mutation", () => {
  const s = store();
  s.saveNote(note, 0);
  s.restoreBytes(
    editBackup(s, (d) => {
      d.notes[0].parentId = "missing";
    }),
  );
  expect(s.getNote("first").parentId).toBe(null);
  const before = s.workspace();
  expect(() =>
    s.restoreBytes(
      editBackup(s, (d) => {
        d.notes[0].parentId = "first";
      }),
    ),
  ).toThrow(/cycle|parent/i);
  expect(s.workspace()).toEqual(before);
});
it("merge imports never reparent a skipped existing note", () => {
  const s = store();
  s.saveNote(note, 0);
  s.saveNote({ ...note, id: "parent" }, 0);
  const before = s.getNote("first");
  s.importNotes(
    [
      { ...note, parentId: "parent" },
      { ...note, id: "new", parentId: "parent" },
    ],
    "merge",
  );
  expect(s.getNote("first")).toEqual(before);
  expect(s.getNote("new").parentId).toBe("parent");
});
it("invalid imported hierarchy cannot leave partially imported notes", () => {
  const s = store();
  s.saveNote(note, 0);
  const before = s.workspace();
  expect(() =>
    s.importNotes([
      { ...note, id: "a", parentId: "b" },
      { ...note, id: "b", parentId: "a" },
    ]),
  ).toThrow(/cycle/i);
  expect(s.workspace()).toEqual(before);
});
it("restores a trashed child when its parent has disappeared", () => {
  const s = store();
  s.saveNote({ ...note, id: "parent" }, 0);
  s.saveNote({ ...note, parentId: "parent" }, 0);
  s.deleteNote("first", 1);
  s.db.prepare("DELETE FROM notes WHERE id=?").run("parent");
  expect(s.restoreNote("first").parentId).toBe(null);
});
it("rolls back both database and swapped assets when commit fails", () => {
  const s = store();
  s.saveNote(note, 0);
  const a = s.addAsset(Buffer.from("original"), "file.txt", "text/plain");
  const bytes = s.backupBytes();
  s.saveNote({ ...note, title: "Current" }, 1);
  writeFileSync(path.join(s.dir, "assets", a.id), "modified");
  const before = s.workspace();
  s.db.exec(
    `CREATE TABLE restore_guard(noteId TEXT REFERENCES notes(id) DEFERRABLE INITIALLY DEFERRED);CREATE TRIGGER reject_restore AFTER INSERT ON assets BEGIN INSERT INTO restore_guard(noteId) VALUES('missing-note'); END;`,
  );
  expect(() => s.restoreBytes(bytes)).toThrow();
  expect(s.workspace()).toEqual(before);
  expect(s.getAsset(a.id).data.toString()).toBe("modified");
  expect(readdirSync(s.dir).filter((n) => n.startsWith(".restore-"))).toEqual(
    [],
  );
});
it("replace import preserves selected nested pages while trashing omitted parents", () => {
  const s = store();
  s.saveNote({ ...note, id: "parent" }, 0);
  s.saveNote({ ...note, id: "child", parentId: "parent" }, 0);
  s.importNotes([{ ...note, id: "child", parentId: "parent" }], "replace");
  expect(s.getNote("parent").deletedAt).toBeTruthy();
  expect(s.getNote("child").parentId).toBe(null);
});
it("version restore detaches a parent that is now missing or a descendant", () => {
  const s = store();
  s.saveNote({ ...note, id: "parent" }, 0);
  s.saveNote({ ...note, parentId: "parent" }, 0);
  s.saveNote({ ...note, parentId: null }, 1);
  const version = s.history("first")[0];
  s.saveNote({ ...note, id: "parent", parentId: "first" }, 1);
  expect(s.restoreVersion("first", version.id).parentId).toBe(null);
});
it("merge leaves existing orphaned hierarchy untouched", () => {
  const s = store();
  s.saveNote({ ...note, id: "parent" }, 0);
  s.saveNote({ ...note, parentId: "parent" }, 0);
  s.deleteNote("parent", 1);
  const before = s.getNote("first");
  s.importNotes(
    [
      { ...note, parentId: null },
      { ...note, id: "new" },
    ],
    "merge",
  );
  expect(s.getNote("first")).toEqual(before);
});

it("promotes child pages when a parent is deleted, preserving revision protection", () => {
  const s = store();
  const parent = s.saveNote(note, 0);
  const child = s.saveNote({ ...note, id: "child", parentId: parent.id }, 0);
  s.deleteNote(parent.id, parent.revision);
  const promoted = s.getNote("child");
  expect(promoted.parentId).toBe(null);
  expect(promoted.revision).toBe(child.revision + 1);
  expect(() =>
    s.saveNote({ ...child, body: "stale edit" }, child.revision),
  ).toThrow(/conflict/);
  expect(
    s.saveNote({ ...promoted, body: "new edit" }, promoted.revision).body,
  ).toBe("new edit");
});

it("rejects malformed persisted layout and table schemas before replacing settings", () => {
  const s = store();
  s.saveNote(note, 0);
  s.updateSettings({
    layout: {
      panels: ["first"],
      tabs: ["first"],
      widths: [1, 1, 1],
      view: "notes",
    },
  });
  expect(() => s.updateSettings({ layout: { panels: "broken" } })).toThrow(
    /settings/,
  );
  expect(() =>
    s.updateSettings({ tableViews: [{ id: "bad", filters: "broken" }] }),
  ).toThrow(/settings/);
  const files = unzipSync(s.backupBytes()),
    snapshot = JSON.parse(strFromU8(files["workspace.json"]));
  snapshot.settings.tableViews = "broken";
  files["workspace.json"] = strToU8(JSON.stringify(snapshot));
  expect(() => s.restoreBytes(zipSync(files))).toThrow(/settings/);
  expect(s.listNotes()).toHaveLength(1);
  expect(s.settings().layout.panels).toEqual(["first"]);
});
