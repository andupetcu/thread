import { it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "../server/http.mjs";
const running = [];
afterEach(async () => {
  for (const item of running) {
    await new Promise((r) => item.server.close(r));
    item.store.close();
    rmSync(item.dir, { recursive: true, force: true });
  }
  running.length = 0;
});
async function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "thread-auth-"));
  const app = createServer({ dir, staticDir: null });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + app.server.address().port;
  running.push({ ...app, dir });
  return {
    app,
    url,
    request: (route, body, cookie) =>
      fetch(url + "/api" + route, {
        method: body ? "POST" : "GET",
        headers: {
          "Content-Type": "application/json",
          "X-Thread-Request": "1",
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
  };
}
it("password setup protects workspace, login and logout use a server session", async () => {
  const f = await fixture();
  expect((await f.request("/workspace")).status).toBe(401);
  const setup = await f.request("/auth/setup", { password: "test-password" });
  expect(setup.status).toBe(200);
  const cookie = setup.headers.get("set-cookie").split(";")[0];
  expect(setup.headers.get("set-cookie")).toContain("HttpOnly");
  expect((await f.request("/workspace", null, cookie)).status).toBe(200);
  await f.request("/auth/logout", {}, cookie);
  expect((await f.request("/workspace", null, cookie)).status).toBe(401);
  expect(
    (await f.request("/auth/login", { password: "wrong-password" })).status,
  ).toBe(401);
  const login = await f.request("/auth/login", { password: "test-password" });
  expect(login.status).toBe(200);
  expect(JSON.stringify(f.app.store.db.prepare("SELECT password FROM users").all())).not.toContain(
    "test-password",
  );
});
it("rejects cross-origin mutations and protects assets before login", async () => {
  const f = await fixture();
  const r = await fetch(f.url + "/api/auth/setup", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://attacker.example",
      "X-Thread-Request": "1",
    },
    body: JSON.stringify({ password: "test-password" }),
  });
  expect(r.status).toBe(403);
  expect((await f.request("/assets/unknown")).status).toBe(401);
});
it("rate limits repeated wrong passwords", async () => {
  const f = await fixture();
  await f.request("/auth/setup", { password: "test-password" });
  let status;
  for (let i = 0; i < 7; i++)
    status = (await f.request("/auth/login", { password: "wrong-password" }))
      .status;
  expect(status).toBe(429);
});
it("reserves login attempts before concurrent password checks", async () => {
  const f = await fixture();
  await f.request("/auth/setup", { password: "test-password" });
  const responses = await Promise.all(
    Array.from({ length: 8 }, () =>
      f.request("/auth/login", { password: "wrong-password" }),
    ),
  );
  expect(responses.filter((r) => r.status === 401)).toHaveLength(5);
  expect(responses.filter((r) => r.status === 429)).toHaveLength(3);
  expect(
    (await f.request("/auth/login", { password: "wrong-password" })).status,
  ).toBe(429);
});
