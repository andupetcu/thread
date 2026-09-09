import http from "node:http";
import { handleOkf } from "./okf-http.mjs";
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { WorkspaceStore, StoreError } from "./store.mjs";
import { Accounts, publicUser } from "./auth.mjs";
export { passwordRecord } from "./auth.mjs";
async function readBody(req, limit = 5_000_000) {
  const buffers = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new StoreError("Request is too large.", 413);
    buffers.push(chunk);
  }
  return Buffer.concat(buffers);
}
export function createServer({ dir, staticDir = path.resolve("dist") } = {}) {
  const store = new WorkspaceStore(dir);
  const accounts = new Accounts(store);
  const server = http.createServer(async (req, res) => {
    const json = (status, data) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(data));
    };
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    try {
      const base = "http://" + req.headers.host;
      let url;
      try {
        url = new URL(req.url, base);
      } catch {
        throw new StoreError("Invalid request.", 400);
      }
      if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
        throw new StoreError(
          "This workspace only accepts local requests.",
          403,
        );
      if (!url.pathname.startsWith("/api/")) {
        if (!["GET", "HEAD"].includes(req.method) || !staticDir)
          throw new StoreError("Not found.", 404);
        const resolved = path.resolve(
          staticDir,
          "." + decodeURIComponent(url.pathname),
        );
        if (
          !resolved.startsWith(path.resolve(staticDir) + path.sep) &&
          resolved !== path.resolve(staticDir)
        )
          throw new StoreError("Not found.", 404);
        const file =
          existsSync(resolved) && statSync(resolved).isFile()
            ? resolved
            : path.join(staticDir, "index.html");
        if (!existsSync(file))
          throw new StoreError(
            "Run npm run build before starting production mode.",
            503,
          );
        const type =
          {
            ".html": "text/html",
            ".js": "text/javascript",
            ".css": "text/css",
            ".svg": "image/svg+xml",
            ".png": "image/png",
            ".woff2": "font/woff2",
          }[path.extname(file)] || "application/octet-stream";
        res.writeHead(200, { "Content-Type": type });
        return res.end(req.method === "HEAD" ? undefined : readFileSync(file));
      }
      const route = url.pathname.slice(4),
        method = req.method;
      if (req.headers["sec-fetch-site"] === "cross-site")
        throw new StoreError("Cross-site access is not allowed.", 403);
      if (!["GET", "HEAD"].includes(method)) {
        if (req.headers["x-thread-request"] !== "1")
          throw new StoreError("Missing workspace request header.", 403);
        if (req.headers.origin && new URL(req.headers.origin).host !== url.host)
          throw new StoreError("Cross-origin changes are not allowed.", 403);
      }
      const body = async () => JSON.parse((await readBody(req)).toString());
      if (route.startsWith("/agent/")) {
        const agentIdentity = accounts.agent(req);
        if (
          await handleOkf({
            route: route.slice(6),
            method,
            url,
            body: async () => {
              const input = await body();
              accounts.agent(req);
              return input;
            },
            json,
            res,
            store,
            actor: { kind: "agent", id: agentIdentity?.id || "mcp" },
          })
        )
          return;
        if (route === "/agent/notes" && method === "GET") {
          const offset = Math.max(
            0,
            Number(url.searchParams.get("offset")) || 0,
          );
          const limit = Math.min(
            100,
            Math.max(1, Number(url.searchParams.get("limit")) || 50),
          );
          const q = url.searchParams.get("q");
          const ids = q ? new Set(store.search({ q })) : null;
          const notes = store.listNotes().filter((n) => !ids || ids.has(n.id));
          return json(200, {
            notes: notes
              .slice(offset, offset + limit)
              .map(({ id, title, updated, notebookId, parentId }) => ({
                id,
                title,
                updated,
                notebookId,
                parentId,
              })),
            total: notes.length,
          });
        }
        if (route === "/agent/notes" && method === "POST") {
          const input = await body();
          if (
            !input ||
            Array.isArray(input) ||
            Object.keys(input).some((k) => !["title", "body"].includes(k))
          )
            throw new StoreError(
              "Only title and body are accepted when creating an agent note.",
            );
          accounts.agent(req);
          const note = store.saveNote(
            { id: randomUUID(), title: input.title, body: input.body },
            0,
          );
          return json(201, { note });
        }
        if (
          /^\/agent\/notes\/[a-zA-Z0-9_-]{1,128}$/.test(route) &&
          method === "PATCH"
        ) {
          const input = await body();
          if (
            !input ||
            typeof input !== "object" ||
            Array.isArray(input) ||
            Object.keys(input).some(
              (k) => !["title", "body", "baseRevision"].includes(k),
            ) ||
            !Number.isSafeInteger(input.baseRevision) ||
            input.baseRevision < 1 ||
            (input.title === undefined && input.body === undefined) ||
            (input.title !== undefined &&
              (typeof input.title !== "string" ||
                !input.title.trim() ||
                input.title.length > 500)) ||
            (input.body !== undefined &&
              (typeof input.body !== "string" || input.body.length > 2000000))
          )
            throw new StoreError(
              "Provide title and/or body with the baseRevision from read_note. No other fields may be changed.",
            );
          accounts.agent(req);
          const current = store.getNote(route.slice(13));
          if (!current || current.deletedAt)
            throw new StoreError("Note not found.", 404);
          const note = store.saveNote(
            {
              ...current,
              ...(input.title !== undefined ? { title: input.title } : {}),
              ...(input.body !== undefined ? { body: input.body } : {}),
            },
            input.baseRevision,
            { actor: { kind: "agent", id: agentIdentity?.id || "mcp" } },
          );
          return json(200, { note });
        }
        if (route.startsWith("/agent/notes/") && method === "GET") {
          const note = store.getNote(route.slice(13));
          if (!note || note.deletedAt)
            throw new StoreError("Note not found.", 404);
          return json(200, { note });
        }
        throw new StoreError("Not found.", 404);
      }
      const { token, user } = accounts.session(req);
      if (
        await accounts.handle({
          route,
          method,
          req,
          res,
          json,
          body: async () => {
            const data = JSON.parse((await readBody(req, 8000)).toString());
            if (
              user &&
              !["/auth/login", "/auth/setup"].includes(route) &&
              !accounts.session(req).user
            )
              throw new StoreError("Account changed. Unlock again.", 401);
            return data;
          },
          user,
          token,
        })
      )
        return;
      const readWorkspaceBody = async (limit) => {
        const bytes = await readBody(req, limit);
        if (!accounts.session(req).user)
          throw new StoreError("Account changed. Unlock again.", 401);
        return bytes;
      };
      const workspace = () => ({
        ...store.workspace(),
        user: publicUser(user),
      });
      if (
        user.role !== "admin" &&
        (method === "DELETE" ||
          ["/restore", "/import", "/backup", "/backups", "/trash"].includes(
            route,
          ) ||
          (route.startsWith("/notes/") && route.endsWith("/restore")))
      )
        throw new StoreError("Administrator access required.", 403);
      if (
        await handleOkf({
          route,
          method,
          url,
          body: async () =>
            JSON.parse((await readWorkspaceBody(100_000_000)).toString()),
          json,
          res,
          store,
          actor: {
            kind: "human",
            id: user.id,
            name: user.username || user.name,
          },
        })
      )
        return;
      if (route === "/workspace" && method === "GET") {
        const revision = store.getMeta("revision");
        if (url.searchParams.get("since") === String(revision))
          return json(200, { unchanged: true, revision });
        return json(200, workspace());
      }
      if (route === "/workspace/initialize" && method === "POST") {
        if (store.getMeta("initialized")) return json(200, workspace());
        accounts.requireAdmin(user);
        const body = JSON.parse(
          (await readWorkspaceBody(20_000_000)).toString(),
        );
        store.importNotes(body.notes, "merge");
        return json(200, workspace());
      }
      if (route === "/settings" && method === "PUT") {
        return json(
          200,
          store.updateSettings(
            JSON.parse((await readWorkspaceBody()).toString()),
          ),
        );
      }
      if (route === "/notebooks" && method === "PUT") {
        return json(
          200,
          store.saveNotebooks(
            JSON.parse((await readWorkspaceBody()).toString()),
          ),
        );
      }
      if (route === "/search" && method === "GET")
        return json(200, {
          ids: store.search(Object.fromEntries(url.searchParams)),
        });
      if (route === "/trash" && method === "GET")
        return json(200, { notes: store.listTrash() });
      if (route === "/import" && method === "POST") {
        const body = JSON.parse(
          (await readWorkspaceBody(100_000_000)).toString(),
        );
        return json(
          200,
          store.importNotes(
            body.notes,
            body.mode === "replace"
              ? "replace"
              : body.mode === "update"
                ? "update"
                : "merge",
          ),
        );
      }
      if (route === "/backup" && method === "GET") {
        const bytes = store.backupBytes();
        res.writeHead(200, {
          "Content-Type": "application/zip",
          "Content-Disposition": 'attachment; filename="thread-workspace.zip"',
          "Cache-Control": "no-store",
        });
        return res.end(bytes);
      }
      if (route === "/backups" && method === "GET")
        return json(200, { backups: store.listBackups() });
      if (route === "/backups" && method === "POST") {
        return json(200, store.createBackup());
      }
      if (route === "/restore" && method === "POST") {
        if (req.headers["content-type"]?.includes("application/zip"))
          return json(
            200,
            store.restoreBytes(await readWorkspaceBody(250_000_000)),
          );
        const body = JSON.parse((await readWorkspaceBody()).toString());
        return json(200, store.restoreBackup(body.id));
      }
      if (route === "/assets" && method === "POST") {
        const file = await readWorkspaceBody(20_000_000);
        return json(
          201,
          store.addAsset(
            file,
            decodeURIComponent(req.headers["x-filename"] || "attachment"),
            req.headers["content-type"]?.split(";")[0] ||
              "application/octet-stream",
          ),
        );
      }
      if (route.startsWith("/assets/") && method === "GET") {
        const a = store.getAsset(decodeURIComponent(route.slice(8)));
        res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
        res.writeHead(200, {
          "Content-Type": a.mime,
          "Content-Disposition": `${a.mime.startsWith("image/") ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(a.name)}`,
          "Cache-Control": "no-store",
        });
        return res.end(a.data);
      }
      const match = route.match(/^\/notes\/([a-zA-Z0-9_-]+)(?:\/(.*))?$/);
      if (match) {
        const [, id, action] = match;
        if (!action && method === "PUT") {
          const body = JSON.parse((await readWorkspaceBody()).toString());
          if (
            user.role !== "admin" &&
            (body.note?.deletedAt || store.getNote(id)?.deletedAt)
          )
            throw new StoreError("Administrator access required.", 403);
          if (body.note?.id !== id) throw new StoreError("Note ID mismatch.");
          return json(200, store.saveNote(body.note, body.baseRevision));
        }
        if (!action && method === "DELETE") {
          const body = JSON.parse((await readWorkspaceBody()).toString());
          return json(200, store.deleteNote(id, body.baseRevision));
        }
        if (action === "restore" && method === "POST")
          return json(200, store.restoreNote(id));
        if (action === "history" && method === "GET")
          return json(200, { versions: store.history(id) });
        const version = action?.match(/^history\/(\d+)\/restore$/);
        if (version && method === "POST")
          return json(200, store.restoreVersion(id, version[1]));
      }
      throw new StoreError("Not found.", 404);
    } catch (e) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (e instanceof SyntaxError)
        return json(400, { error: "Invalid JSON data." });
      const status = e.status || 500;
      if (status === 500)
        console.error("Workspace operation failed:", e.message);
      json(status, {
        error:
          status === 500
            ? "Workspace operation failed. Check the local server."
            : e.message,
        ...(e.current !== undefined ? { current: e.current } : {}),
      });
    }
  });
  return { server, store };
}
