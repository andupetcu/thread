import http from "node:http";
import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { WorkspaceStore, StoreError } from "./store.mjs";
const scrypt = promisify(scryptCallback),
  TTL = 12 * 60 * 60 * 1000;
export async function passwordRecord(password) {
  if (
    typeof password !== "string" ||
    password.length < 8 ||
    password.length > 256
  )
    throw new StoreError("Use a password of 8–256 characters.");
  const salt = randomBytes(24).toString("hex");
  const hash = (await scrypt(password, salt, 64)).toString("hex");
  return { salt, hash };
}
async function matches(password, record) {
  if (typeof password !== "string" || password.length > 256 || !record)
    return false;
  const hash = await scrypt(password, record.salt, 64);
  return timingSafeEqual(hash, Buffer.from(record.hash, "hex"));
}
const digest = (value) => createHash("sha256").update(value).digest("hex");
function cookie(req) {
  return (
    (req.headers.cookie || "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("thread_session="))
      ?.slice(15) || ""
  );
}
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
  const attempts = new Map();
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
      const token = cookie(req);
      const session =
        token &&
        store.db
          .prepare("SELECT expires FROM sessions WHERE hash=?")
          .get(digest(token));
      const authenticated = !!session && session.expires > Date.now();
      const setSession = () => {
        const value = randomBytes(32).toString("base64url");
        store.db
          .prepare("DELETE FROM sessions WHERE expires<?")
          .run(Date.now());
        store.db
          .prepare("INSERT INTO sessions VALUES(?,?)")
          .run(digest(value), Date.now() + TTL);
        res.setHeader(
          "Set-Cookie",
          `thread_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${TTL / 1000}`,
        );
      };
      if (route === "/auth/status" && method === "GET")
        return json(200, {
          configured: !!store.getMeta("password"),
          authenticated,
        });
      if (route === "/auth/setup" && method === "POST") {
        if (store.getMeta("password"))
          throw new StoreError(
            "A workspace password has already been set.",
            409,
          );
        const body = JSON.parse((await readBody(req, 2000)).toString());
        const record = await passwordRecord(body.password);
        if (store.getMeta("password"))
          throw new StoreError(
            "A workspace password has already been set.",
            409,
          );
        store.setMeta("password", record);
        setSession();
        return json(200, { ok: true });
      }
      if (route === "/auth/login" && method === "POST") {
        const key = req.socket.remoteAddress;
        const limit = attempts.get(key);
        if (limit && limit.until > Date.now() && limit.count >= 5)
          throw new StoreError(
            "Too many attempts. Try again in 15 minutes.",
            429,
          );
        const prior =
          limit && limit.until > Date.now()
            ? limit
            : { count: 0, until: Date.now() + 15 * 60 * 1000 };
        attempts.set(key, { ...prior, count: prior.count + 1 });
        const body = JSON.parse((await readBody(req, 2000)).toString());
        const record = store.getMeta("password");
        if (
          !(await matches(body.password, record)) ||
          record?.salt !== store.getMeta("password")?.salt
        ) {
          throw new StoreError("Incorrect workspace password.", 401);
        }
        attempts.delete(key);
        setSession();
        return json(200, { ok: true });
      }
      if (!authenticated)
        throw new StoreError("Unlock the workspace to continue.", 401);
      if (route === "/auth/logout" && method === "POST") {
        store.db
          .prepare("DELETE FROM sessions WHERE hash=?")
          .run(digest(token));
        res.setHeader(
          "Set-Cookie",
          "thread_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0",
        );
        return json(200, { ok: true });
      }
      if (route === "/auth/password" && method === "POST") {
        const body = JSON.parse((await readBody(req, 2000)).toString());
        const previous = store.getMeta("password");
        if (!(await matches(body.currentPassword, previous)))
          throw new StoreError("Current password is incorrect.", 403);
        const next = await passwordRecord(body.password);
        if (previous?.salt !== store.getMeta("password")?.salt)
          throw new StoreError(
            "Password changed in another session. Unlock again.",
            409,
          );
        store.setMeta("password", next);
        store.db.exec("DELETE FROM sessions");
        setSession();
        return json(200, { ok: true });
      }
      if (route === "/workspace" && method === "GET") {
        const revision = store.getMeta("revision");
        if (url.searchParams.get("since") === String(revision))
          return json(200, { unchanged: true, revision });
        return json(200, store.workspace());
      }
      if (route === "/workspace/initialize" && method === "POST") {
        if (store.getMeta("initialized")) return json(200, store.workspace());
        const body = JSON.parse((await readBody(req, 20_000_000)).toString());
        return json(200, store.importNotes(body.notes, "merge"));
      }
      if (route === "/settings" && method === "PUT") {
        return json(
          200,
          store.updateSettings(JSON.parse((await readBody(req)).toString())),
        );
      }
      if (route === "/notebooks" && method === "PUT") {
        return json(
          200,
          store.saveNotebooks(JSON.parse((await readBody(req)).toString())),
        );
      }
      if (route === "/search" && method === "GET")
        return json(200, {
          ids: store.search(Object.fromEntries(url.searchParams)),
        });
      if (route === "/trash" && method === "GET")
        return json(200, { notes: store.listTrash() });
      if (route === "/import" && method === "POST") {
        const body = JSON.parse((await readBody(req, 100_000_000)).toString());
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
            store.restoreBytes(await readBody(req, 250_000_000)),
          );
        const body = JSON.parse((await readBody(req)).toString());
        return json(200, store.restoreBackup(body.id));
      }
      if (route === "/assets" && method === "POST") {
        const file = await readBody(req, 20_000_000);
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
          const body = JSON.parse((await readBody(req)).toString());
          if (body.note?.id !== id) throw new StoreError("Note ID mismatch.");
          return json(200, store.saveNote(body.note, body.baseRevision));
        }
        if (!action && method === "DELETE") {
          const body = JSON.parse((await readBody(req)).toString());
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
