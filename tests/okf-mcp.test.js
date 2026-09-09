import { it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "../server/http.mjs";

it("maintains OKF bundles through real MCP calls without deleting or forging human review", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "thread-okf-mcp-"));
  const app = createServer({ dir, staticDir: null });
  const client = new Client({ name: "okf-test", version: "1" });
  try {
    await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${app.server.address().port}`;
    const headers = {
      "Content-Type": "application/json",
      "X-Thread-Request": "1",
    };
    const setup = await fetch(url + "/api/auth/setup", {
      method: "POST",
      headers,
      body: JSON.stringify({ password: "okf-test-password" }),
    });
    headers.Cookie = setup.headers.get("set-cookie").split(";")[0];
    const key = await (
      await fetch(url + "/api/mcp/keys", {
        method: "POST",
        headers,
        body: JSON.stringify({ name: "Bundle assistant" }),
      })
    ).json();
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [path.resolve("server/mcp.mjs")],
        env: { THREAD_API_URL: url, THREAD_MCP_TOKEN: key.token },
        stderr: "pipe",
      }),
    );
    const call = async (name, args) => {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError, JSON.stringify(result.content)).toBeFalsy();
      return JSON.parse(result.content[0].text);
    };
    const { tools } = await client.listTools();
    expect(
      tools.some((tool) => /delete|execute|verify|review/.test(tool.name)),
    ).toBe(false);
    const { bundle } = await call("create_bundle", { name: "Agent handbook" });
    const list = await call("list_bundles", {});
    expect(list.bundles.some((item) => item.id === bundle.id)).toBe(true);
    const index = await call("read_bundle_index", { bundleId: bundle.id });
    expect(index.revision).toBe(bundle.revision);
    const created = await call("create_concept", {
      bundleId: bundle.id,
      path: "guides/setup.md",
      baseRevision: bundle.revision,
      body: "Set up the workspace.",
      metadata: { type: "Guide", title: "Setup", custom: { nullable: null } },
    });
    expect(created.entry.path).toBe("guides/setup.md");
    const entry = (
      await call("read_concept", {
        bundleId: bundle.id,
        path: "guides/setup.md",
      })
    ).entry;
    expect(entry.body).toContain("Set up the workspace.");
    expect(entry.metadata.custom.nullable).toBeNull();
    expect(entry.metadata.generated.by).not.toMatch(/^human:/);
    const concepts = await call("list_concepts", { bundleId: bundle.id });
    expect(concepts.entries.map((item) => item.path)).toEqual([
      "guides/setup.md",
    ]);
    const updated = await call("update_concept", {
      bundleId: bundle.id,
      path: entry.path,
      baseRevision: entry.revision,
      body: "Updated setup instructions.",
      metadata: { description: "Current setup" },
    });
    expect(updated.entry.metadata.custom.nullable).toBeNull();
    expect(updated.entry.body).toBe("Updated setup instructions.");
    const stale = await client.callTool({
      name: "update_concept",
      arguments: {
        bundleId: bundle.id,
        path: entry.path,
        baseRevision: entry.revision,
        body: "Stale edit",
      },
    });
    expect(stale.isError).toBe(true);
    expect(stale.content[0].text).toMatch(/conflict/i);
    const forged = await client.callTool({
      name: "update_concept",
      arguments: {
        bundleId: bundle.id,
        path: entry.path,
        baseRevision: updated.entry.revision,
        metadata: {
          verified: [{ by: "human:admin", at: new Date().toISOString() }],
        },
      },
    });
    expect(forged.isError).toBe(true);
    const invalid = await client.callTool({
      name: "create_concept",
      arguments: {
        bundleId: bundle.id,
        path: "../outside.md",
        baseRevision: updated.bundle.revision,
        body: "Escape",
        metadata: { type: "Guide" },
      },
    });
    expect(invalid.isError).toBe(true);
    const validation = await call("validate_bundle", { bundleId: bundle.id });
    expect(Array.isArray(validation.diagnostics)).toBe(true);
    const forbidden = await fetch(`${url}/api/agent/okf/bundles/${bundle.id}`, {
      method: "DELETE",
      headers: { ...headers, Cookie: "", Authorization: `Bearer ${key.token}` },
    });
    expect(forbidden.ok).toBe(false);
    expect(
      (await call("read_concept", { bundleId: bundle.id, path: entry.path }))
        .entry.body,
    ).toBe("Updated setup instructions.");
    await fetch(url + "/api/mcp/keys/" + key.key.id, {
      method: "DELETE",
      headers,
      body: "{}",
    });
    const revoked = await client.callTool({
      name: "list_bundles",
      arguments: {},
    });
    expect(revoked.isError).toBe(true);
  } finally {
    await client.close();
    await new Promise((resolve) => app.server.close(resolve));
    app.store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
