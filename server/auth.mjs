import {
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import { StoreError } from "./store.mjs";
const scrypt = promisify(scryptCallback);
const TTL = 12 * 60 * 60 * 1000;
export const digest = (value) =>
  createHash("sha256").update(value).digest("hex");
export async function passwordRecord(password) {
  if (
    typeof password !== "string" ||
    password.length < 8 ||
    password.length > 256
  )
    throw new StoreError("Use a password of 8–256 characters.");
  const salt = randomBytes(24).toString("hex");
  return { salt, hash: (await scrypt(password, salt, 64)).toString("hex") };
}
async function matches(password, record) {
  if (typeof password !== "string" || password.length > 256 || !record)
    return false;
  return timingSafeEqual(
    await scrypt(password, record.salt, 64),
    Buffer.from(record.hash, "hex"),
  );
}
function username(value = "admin") {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_.-]{1,40}$/.test(value.trim()))
    throw new StoreError(
      "Use 1–40 letters, numbers, dots, dashes or underscores for the username.",
    );
  return value.trim().toLowerCase();
}
function role(value) {
  if (!["admin", "user"].includes(value))
    throw new StoreError("Choose admin or user.");
  return value;
}
export const publicUser = (u) =>
  u
    ? { id: u.id, username: u.username, role: u.role, disabled: !!u.disabled }
    : null;
export class Accounts {
  constructor(store) {
    this.store = store;
    this.db = store.db;
    this.attempts = new Map();
    store.tx(() => {
      this.db
        .exec(`CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, role TEXT NOT NULL CHECK(role IN ('admin','user')), password TEXT NOT NULL, disabled INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS mcp_keys(id TEXT PRIMARY KEY, name TEXT NOT NULL, hash TEXT NOT NULL UNIQUE, userId TEXT NOT NULL REFERENCES users(id), created TEXT NOT NULL);`);
      if (
        !this.db
          .prepare("PRAGMA table_info(sessions)")
          .all()
          .some((c) => c.name === "userId")
      )
        this.db.exec(
          "ALTER TABLE sessions ADD COLUMN userId TEXT REFERENCES users(id)",
        );
      const legacy = store.getMeta("password");
      if (legacy && !this.configured()) {
        const id = randomUUID();
        this.db
          .prepare("INSERT INTO users VALUES(?,?,?,?,0)")
          .run(id, "admin", "admin", JSON.stringify(legacy));
        this.db
          .prepare("UPDATE sessions SET userId=? WHERE userId IS NULL")
          .run(id);
      }
      this.db.exec("DELETE FROM meta WHERE key='password'");
    });
  }
  configured() {
    return !!this.db.prepare("SELECT 1 FROM users LIMIT 1").get();
  }
  get(id) {
    return this.db.prepare("SELECT * FROM users WHERE id=?").get(id);
  }
  byName(name) {
    return this.db
      .prepare("SELECT * FROM users WHERE username=?")
      .get(username(name));
  }
  session(req) {
    const token =
      (req.headers.cookie || "")
        .split(";")
        .map((s) => s.trim())
        .find((s) => s.startsWith("thread_session="))
        ?.slice(15) || "";
    const user = this.db
      .prepare(
        "SELECT u.* FROM users u JOIN sessions s ON s.userId=u.id WHERE s.hash=? AND s.expires>? AND u.disabled=0",
      )
      .get(digest(token), Date.now());
    return { token, user };
  }
  requireAdmin(user, req) {
    if (req && !this.session(req).user)
      throw new StoreError("Account changed. Unlock again.", 401);
    const current = user && this.get(user.id);
    if (!current || current.disabled || current.role !== "admin")
      throw new StoreError("Administrator access required.", 403);
  }
  setSession(res, user) {
    const value = randomBytes(32).toString("base64url");
    this.db.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now());
    this.db
      .prepare("INSERT INTO sessions(hash,expires,userId) VALUES(?,?,?)")
      .run(digest(value), Date.now() + TTL, user.id);
    res.setHeader(
      "Set-Cookie",
      `thread_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${TTL / 1000}`,
    );
  }
  revoke(id) {
    this.db.prepare("DELETE FROM sessions WHERE userId=?").run(id);
    this.db.prepare("DELETE FROM mcp_keys WHERE userId=?").run(id);
  }
  async create(body) {
    const name = username(body.username),
      r = role(body.role || "user"),
      password = await passwordRecord(body.password);
    return {
      id: randomUUID(),
      username: name,
      role: r,
      password: JSON.stringify(password),
      disabled: 0,
    };
  }
  insert(user) {
    if (this.byName(user.username))
      throw new StoreError("Username already exists.", 409);
    this.db
      .prepare("INSERT INTO users VALUES(?,?,?,?,0)")
      .run(user.id, user.username, user.role, user.password);
    this.store.bump();
    return user;
  }
  async handle({ route, method, req, res, json, body, user, token }) {
    if (route === "/auth/status" && method === "GET") {
      json(200, {
        configured: this.configured(),
        authenticated: !!user,
        user: publicUser(user),
      });
      return true;
    }
    if (route === "/auth/setup" && method === "POST") {
      if (this.configured())
        throw new StoreError("An administrator has already been set up.", 409);
      const next = await this.create({ ...(await body()), role: "admin" });
      if (this.configured())
        throw new StoreError("An administrator has already been set up.", 409);
      this.insert(next);
      this.setSession(res, next);
      json(200, { ok: true, user: publicUser(next) });
      return true;
    }
    if (route === "/auth/login" && method === "POST") {
      const key = req.socket.remoteAddress,
        now = Date.now(),
        prior = this.attempts.get(key);
      const limit =
        prior && prior.until > now
          ? prior
          : { count: 0, until: now + 15 * 60 * 1000 };
      if (limit.count >= 5)
        throw new StoreError(
          "Too many attempts. Try again in 15 minutes.",
          429,
        );
      this.attempts.set(key, { ...limit, count: limit.count + 1 });
      const input = await body(),
        found = this.byName(input.username);
      if (
        !found ||
        found.disabled ||
        !(await matches(input.password, JSON.parse(found.password))) ||
        this.get(found.id)?.password !== found.password ||
        this.get(found.id)?.disabled
      )
        throw new StoreError("Incorrect username or password.", 401);
      this.attempts.delete(key);
      this.setSession(res, found);
      json(200, { ok: true, user: publicUser(this.get(found.id)) });
      return true;
    }
    if (!user) throw new StoreError("Unlock the workspace to continue.", 401);
    if (route === "/auth/logout" && method === "POST") {
      this.db.prepare("DELETE FROM sessions WHERE hash=?").run(digest(token));
      res.setHeader(
        "Set-Cookie",
        "thread_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0",
      );
      json(200, { ok: true });
      return true;
    }
    if (route === "/auth/password" && method === "POST") {
      const input = await body();
      if (!(await matches(input.currentPassword, JSON.parse(user.password))))
        throw new StoreError("Current password is incorrect.", 403);
      const next = await passwordRecord(input.password);
      const current = this.get(user.id);
      if (
        !this.session(req).user ||
        current.disabled ||
        current.password !== user.password
      )
        throw new StoreError("Account changed. Unlock again.", 409);
      this.db
        .prepare("UPDATE users SET password=? WHERE id=?")
        .run(JSON.stringify(next), user.id);
      this.revoke(user.id);
      this.setSession(res, user);
      json(200, { ok: true });
      return true;
    }
    if (route === "/users" || route.startsWith("/users/")) {
      this.requireAdmin(user, req);
      if (route === "/users" && method === "GET") {
        json(200, {
          users: this.db
            .prepare("SELECT * FROM users ORDER BY username")
            .all()
            .map(publicUser),
        });
        return true;
      }
      if (route === "/users" && method === "POST") {
        const next = await this.create(await body());
        this.requireAdmin(user, req);
        this.insert(next);
        json(201, { user: publicUser(next) });
        return true;
      }
      if (route.startsWith("/users/") && method === "PATCH") {
        const id = route.slice(7),
          input = await body();
        const password =
          input.password === undefined
            ? undefined
            : JSON.stringify(await passwordRecord(input.password));
        this.requireAdmin(user, req);
        const current = this.get(id);
        if (!current) throw new StoreError("Account not found.", 404);
        if (input.disabled !== undefined && typeof input.disabled !== "boolean")
          throw new StoreError("Invalid account status.");
        const r = input.role === undefined ? current.role : role(input.role),
          disabled =
            input.disabled === undefined
              ? current.disabled
              : Number(input.disabled);
        if (
          current.role === "admin" &&
          !current.disabled &&
          (r !== "admin" || disabled) &&
          this.db
            .prepare(
              "SELECT count(*) n FROM users WHERE role='admin' AND disabled=0",
            )
            .get().n <= 1
        )
          throw new StoreError("Keep at least one active administrator.", 409);
        this.db
          .prepare("UPDATE users SET role=?, disabled=?, password=? WHERE id=?")
          .run(r, disabled, password ?? current.password, id);
        if (disabled || password || r !== current.role) this.revoke(id);
        this.store.bump();
        json(200, { user: publicUser(this.get(id)) });
        return true;
      }
    }
    if (route === "/mcp/keys" || route.startsWith("/mcp/keys/")) {
      this.requireAdmin(user, req);
      if (route === "/mcp/keys" && method === "GET") {
        json(200, {
          keys: this.db
            .prepare(
              "SELECT k.id,k.name,k.created,u.username FROM mcp_keys k JOIN users u ON u.id=k.userId ORDER BY k.created DESC",
            )
            .all(),
          script: pathToMcp(),
        });
        return true;
      }
      if (route === "/mcp/keys" && method === "POST") {
        const { name } = await body();
        if (typeof name !== "string" || !name.trim() || name.length > 100)
          throw new StoreError("Enter a key name of 1–100 characters.");
        this.requireAdmin(user, req);
        const secret = randomBytes(32).toString("base64url"),
          key = {
            id: randomUUID(),
            name: name.trim(),
            created: new Date().toISOString(),
          };
        this.db
          .prepare("INSERT INTO mcp_keys VALUES(?,?,?,?,?)")
          .run(key.id, key.name, digest(secret), user.id, key.created);
        json(201, { key, token: secret });
        return true;
      }
      if (route.startsWith("/mcp/keys/") && method === "DELETE") {
        this.db.prepare("DELETE FROM mcp_keys WHERE id=?").run(route.slice(10));
        json(200, { ok: true });
        return true;
      }
    }
    return false;
  }
  agent(req) {
    const token = req.headers.authorization?.match(
      /^Bearer ([A-Za-z0-9_-]{43})$/,
    )?.[1];
    const key =
      token &&
      this.db
        .prepare(
          "SELECT k.id, k.userId FROM mcp_keys k JOIN users u ON u.id=k.userId WHERE k.hash=? AND u.disabled=0 AND u.role='admin'",
        )
        .get(digest(token));
    if (!key) throw new StoreError("Invalid or revoked agent key.", 401);
    return key;
  }
}
import { fileURLToPath } from "node:url";
const pathToMcp = () => fileURLToPath(new URL("./mcp.mjs", import.meta.url));
