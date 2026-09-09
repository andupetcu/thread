import { it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "../server/http.mjs";
it("speaks MCP over stdio and exposes read/create/edit tools with enforced revocation", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "thread-mcp-")),
    app = createServer({ dir, staticDir: null });
  const client = new Client({ name: "thread-test", version: "1.0.0" });
  try {
    await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${app.server.address().port}`;
    const headers = {
      "Content-Type": "application/json",
      "X-Thread-Request": "1",
    };
    const setup = await fetch(url + "/api/auth/setup", {
      method: "POST",
      headers,
      body: JSON.stringify({ password: "test-password" }),
    });
    headers.Cookie = setup.headers.get("set-cookie").split(";")[0];
    const key = await (
      await fetch(url + "/api/mcp/keys", {
        method: "POST",
        headers,
        body: JSON.stringify({ name: "Test agent" }),
      })
    ).json();
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.resolve("server/mcp.mjs")],
      env: { THREAD_API_URL: url, THREAD_MCP_TOKEN: key.token },
      stderr: "pipe",
    });
    await client.connect(transport);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "create_bundle",
      "create_concept",
      "create_note",
      "list_bundles",
      "list_concepts",
      "list_notes",
      "read_bundle_index",
      "read_concept",
      "read_note",
      "search_notes",
      "update_concept",
      "update_note",
      "validate_bundle",
    ]);
    const created = await client.callTool({
      name: "create_note",
      arguments: {
        title: "Agent decision",
        body: "# Decision\nKeep notes safe",
      },
    });
    expect(created.isError).toBeFalsy();
    const note = JSON.parse(created.content[0].text).note;
    const read = await client.callTool({
      name: "read_note",
      arguments: { id: note.id },
    });
    expect(JSON.parse(read.content[0].text).note.body).toContain(
      "Keep notes safe",
    );
    const search = await client.callTool({
      name: "search_notes",
      arguments: { query: "decision" },
    });
    expect(JSON.parse(search.content[0].text).notes[0].id).toBe(note.id);
    const invalid = await client.callTool({
      name: "create_note",
      arguments: { id: note.id, title: "Overwrite", body: "" },
    });
    expect(invalid.isError).toBe(true);
    const edited = await client.callTool({
      name: "update_note",
      arguments: {
        id: note.id,
        baseRevision: note.revision,
        body: "Updated by agent",
      },
    });
    expect(edited.isError).toBeFalsy();
    const updated = JSON.parse(edited.content[0].text).note;
    expect(updated.body).toBe("Updated by agent");
    expect(updated.title).toBe(note.title);
    expect(updated.revision).toBe(note.revision + 1);
    expect(app.store.history(note.id).length).toBeGreaterThan(0);
    const stale = await client.callTool({
      name: "update_note",
      arguments: {
        id: note.id,
        baseRevision: note.revision,
        body: "Stale overwrite",
      },
    });
    expect(stale.isError).toBe(true);
    expect(stale.content[0].text).toMatch(/conflict/i);
    for (const payload of [
      { baseRevision: updated.revision, deletedAt: "today" },
      { baseRevision: updated.revision, body: "", parentId: "elsewhere" },
      { body: "Missing revision" },
    ]) {
      const forbidden = await fetch(url + "/api/agent/notes/" + note.id, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-Thread-Request": "1",
          Authorization: `Bearer ${key.token}`,
        },
        body: JSON.stringify(payload),
      });
      expect(forbidden.status).toBe(400);
    }
    expect(app.store.getNote(note.id).body).toBe("Updated by agent");
    const deleted = await fetch(url + "/api/agent/notes/" + note.id, {
      method: "DELETE",
      headers: {
        "X-Thread-Request": "1",
        Authorization: `Bearer ${key.token}`,
      },
    });
    expect(deleted.status).toBe(404);
    const trash = app.store.saveNote(
      { id: "trashed-test", title: "Trash", body: "Keep in trash" },
      0,
    );
    app.store.deleteNote(trash.id, trash.revision);
    const trashEdit = await client.callTool({
      name: "update_note",
      arguments: {
        id: trash.id,
        baseRevision: trash.revision + 1,
        body: "Resurrect",
      },
    });
    expect(trashEdit.isError).toBe(true);
    expect(app.store.getNote(trash.id).deletedAt).toBeTruthy();
    await fetch(url + "/api/mcp/keys/" + key.key.id, {
      method: "DELETE",
      headers,
      body: "{}",
    });
    const revoked = await client.callTool({
      name: "list_notes",
      arguments: {},
    });
    expect(revoked.isError).toBe(true);
    const revokedEdit = await client.callTool({
      name: "update_note",
      arguments: {
        id: note.id,
        baseRevision: updated.revision,
        title: "Revoked",
      },
    });
    expect(revokedEdit.isError).toBe(true);
    expect(app.store.listNotes()).toHaveLength(1);
  } finally {
    await client.close();
    await new Promise((r) => app.server.close(r));
    app.store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
