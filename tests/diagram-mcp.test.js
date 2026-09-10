import { it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "../server/http.mjs";
it("speaks diagram MCP over real stdio with inert proposals, strict schemas and revocation", async () => {
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
      "list_diagrams",
      "list_notes",
      "propose_diagram_update",
      "read_bundle_index",
      "read_concept",
      "read_diagram",
      "read_note",
      "search_notes",
      "update_concept",
      "update_note",
      "validate_bundle",
    ]);
    const original = {
      version: 1,
      nodes: [
        {
          id: "a",
          position: { x: 0, y: 0 },
          data: { shape: "process", label: "Original", color: "#ffffff" },
        },
      ],
      edges: [],
    };
    const note = app.store.saveNote(
      {
        id: "diagram-test",
        title: "Diagram",
        body: "```thread-diagram\n" + JSON.stringify(original) + "\n```",
      },
      0,
    );
    const listed = await client.callTool({
      name: "list_diagrams",
      arguments: { noteId: note.id },
    });
    expect(listed.isError).toBeFalsy();
    expect(JSON.parse(listed.content[0].text).diagrams).toHaveLength(1);
    const read = await client.callTool({
      name: "read_diagram",
      arguments: { noteId: note.id, diagramIndex: 0 },
    });
    expect(JSON.parse(read.content[0].text).revision).toBe(1);
    const proposed = structuredClone(original);
    proposed.nodes[0].data.label = "Proposed";
    const input = {
      noteId: note.id,
      diagramIndex: 0,
      baseRevision: 1,
      diagram: proposed,
      summary: "Change label",
    };
    const result = await client.callTool({
      name: "propose_diagram_update",
      arguments: input,
    });
    expect(result.isError).toBeFalsy();
    expect(app.store.getNote(note.id).body).toBe(note.body);
    expect(JSON.parse(result.content[0].text).proposal.status).toBe("pending");
    expect(
      (
        await client.callTool({
          name: "propose_diagram_update",
          arguments: { ...input, verified: true },
        })
      ).isError,
    ).toBe(true);
    expect(
      (
        await client.callTool({
          name: "read_diagram",
          arguments: { noteId: note.id, diagramIndex: 99 },
        })
      ).isError,
    ).toBe(true);
    app.store.saveNote({ ...note, title: "Changed" }, 1);
    expect(
      (
        await client.callTool({
          name: "propose_diagram_update",
          arguments: input,
        })
      ).isError,
    ).toBe(true);
    await fetch(url + "/api/mcp/keys/" + key.key.id, {
      method: "DELETE",
      headers,
      body: "{}",
    });
    expect(
      (
        await client.callTool({
          name: "list_diagrams",
          arguments: { noteId: note.id },
        })
      ).isError,
    ).toBe(true);
    expect(
      (
        await client.callTool({
          name: "propose_diagram_update",
          arguments: { ...input, baseRevision: 2 },
        })
      ).isError,
    ).toBe(true);
  } finally {
    await client.close();
    await new Promise((r) => app.server.close(r));
    app.store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
