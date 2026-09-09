// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { it, expect, beforeEach, afterEach, vi } from "vitest";
import { useWorkspace } from "../src/storage/useWorkspace";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const original = { id: "n1", title: "Note", body: "Original", revision: 1 };
let current, root, container, requests;
beforeEach(async () => {
  vi.useFakeTimers();
  requests = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (url, options) =>
        new Promise((resolve, reject) =>
          requests.push({ url, options, resolve, reject }),
        ),
    ),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  function Harness() {
    current = useWorkspace({
      notes: [original],
      settings: {},
      notebooks: [],
      revision: "1",
    });
    return null;
  }
  await act(async () => root.render(React.createElement(Harness)));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function edit(body) {
  await act(async () =>
    current.setNotes((notes) =>
      notes.map((n) => (n.id === "n1" ? { ...n, body } : n)),
    ),
  );
}
async function flush() {
  let operation;
  await act(async () => {
    operation = current.flush().catch((error) => error);
  });
  return { operation };
}
async function reply(index, data, status = 200) {
  await act(async () => {
    requests[index].resolve({
      ok: status < 400,
      status,
      headers: new Headers({ "Content-Type": "application/json" }),
      json: async () => data,
    });
  });
}
async function poll() {
  await act(async () => {
    vi.advanceTimersByTime(3000);
  });
}
it("advances save revisions without overwriting a newer local draft", async () => {
  await edit("First");
  const { operation } = await flush();
  await edit("Second");
  await reply(0, { note: { ...original, body: "First", revision: 2 } });
  expect(current.notes[0].body).toBe("Second");
  expect(JSON.parse(requests[1].options.body).baseRevision).toBe(2);
  await reply(1, { note: { ...original, body: "Second", revision: 3 } });
  await operation;
  expect(current.notes[0].revision).toBe(3);
  expect(current.status).toBe("Saved to disk");
});
it("preserves the newest draft when an older request conflicts", async () => {
  await edit("First");
  const { operation } = await flush();
  await edit("Second");
  await reply(
    0,
    {
      error: "Conflict",
      current: { ...original, body: "Remote", revision: 8 },
    },
    409,
  );
  await operation;
  expect(current.notes[0].body).toBe("Second");
  expect(current.conflicts[0].local.body).toBe("Second");
  await act(async () => current.resolve("n1", "local"));
  expect(JSON.parse(requests[1].options.body)).toMatchObject({
    baseRevision: 8,
    note: { body: "Second" },
  });
  await reply(1, { note: { ...original, body: "Second", revision: 9 } });
  expect(current.conflicts).toHaveLength(0);
});
it("deletes a note created while its initial save is running using the acknowledged revision", async () => {
  await act(async () =>
    current.setNotes((notes) => [
      ...notes,
      { id: "new", title: "New", body: "Draft", revision: 0 },
    ]),
  );
  const { operation } = await flush();
  await act(async () =>
    current.setNotes((notes) => notes.filter((n) => n.id !== "new")),
  );
  await reply(0, {
    note: { id: "new", title: "New", body: "Draft", revision: 1 },
  });
  expect(requests[1].options.method).toBe("DELETE");
  expect(JSON.parse(requests[1].options.body).baseRevision).toBe(1);
  await reply(1, { ok: true });
  await operation;
  expect(current.notes.map((n) => n.id)).toEqual(["n1"]);
});
it("does not let polling overwrite a draft that appeared during the request", async () => {
  await poll();
  await edit("Unsaved");
  await reply(0, {
    notes: [{ ...original, body: "Old remote" }],
    settings: {},
    notebooks: [],
    revision: "2",
  });
  expect(current.notes[0].body).toBe("Unsaved");
});
it("does not let an old poll overwrite a newer completed save", async () => {
  await poll();
  await edit("New");
  const { operation } = await flush();
  await reply(1, { note: { ...original, body: "New", revision: 2 } });
  await operation;
  await reply(0, {
    notes: [original],
    settings: {},
    notebooks: [],
    revision: "1",
  });
  expect(current.notes[0].body).toBe("New");
  expect(current.notes[0].revision).toBe(2);
});
it("does not let reload overwrite edits made while its workspace request is pending", async () => {
  let operation;
  await act(async () => {
    operation = current.reload();
  });
  await edit("New draft");
  await reply(0, {
    notes: [original],
    settings: {},
    notebooks: [],
    revision: "1",
  });
  await operation;
  expect(current.notes[0].body).toBe("New draft");
});
it("ignores older polling responses arriving after a newer poll", async () => {
  await poll();
  await poll();
  await reply(1, {
    notes: [{ ...original, body: "Newest", revision: 3 }],
    settings: {},
    notebooks: [],
    revision: "3",
  });
  await reply(0, {
    notes: [{ ...original, body: "Old", revision: 2 }],
    settings: {},
    notebooks: [],
    revision: "2",
  });
  expect(current.notes[0].body).toBe("Newest");
});
it("drops a create followed by delete before its first request without issuing DELETE", async () => {
  await act(async () =>
    current.setNotes((notes) => [
      ...notes,
      { id: "new", title: "New", body: "Draft", revision: 0 },
    ]),
  );
  await act(async () =>
    current.setNotes((notes) => notes.filter((n) => n.id !== "new")),
  );
  const { operation } = await flush();
  await operation;
  expect(requests).toHaveLength(0);
  expect(current.status).toBe("Saved to disk");
});
it("does not silently discard deletion after an uncertain first-save network failure", async () => {
  await act(async () =>
    current.setNotes((notes) => [
      ...notes,
      { id: "new", title: "New", body: "Draft", revision: 0 },
    ]),
  );
  let { operation } = await flush();
  await act(async () => requests[0].reject(new Error("Connection lost")));
  await operation;
  await act(async () =>
    current.setNotes((notes) => notes.filter((n) => n.id !== "new")),
  );
  ({ operation } = await flush());
  expect(requests).toHaveLength(2);
  expect(requests[1].options.method).toBe("DELETE");
  await reply(
    1,
    {
      error: "Conflict",
      current: { id: "new", title: "New", body: "Draft", revision: 1 },
    },
    409,
  );
  await operation;
  expect(current.conflicts[0].local).toBeNull();
});
it("does not let an old poll overwrite newly saved settings", async () => {
  await poll();
  let operation;
  await act(async () => {
    operation = current.saveSettings({ theme: "light" });
  });
  await reply(1, { ok: true });
  await operation;
  await reply(0, {
    notes: [original],
    settings: { theme: "dark" },
    notebooks: [],
    revision: "1",
  });
  expect(current.settings.theme).toBe("light");
});
it("does not poll during metadata writes and preserves sequential settings writes", async () => {
  let first, second;
  await act(async () => {
    first = current.saveSettings({ theme: "light" });
    second = current.saveSettings({ theme: "dark" });
  });
  expect(requests).toHaveLength(1);
  await poll();
  expect(requests).toHaveLength(1);
  await reply(0, { ok: true });
  expect(requests).toHaveLength(2);
  expect(JSON.parse(requests[1].options.body).theme).toBe("dark");
  await reply(1, { ok: true });
  await first;
  await second;
  expect(current.settings.theme).toBe("dark");
});
it("retains failed metadata drafts until flush retries them successfully", async () => {
  let operation;
  await act(async () => {
    operation = current.saveSettings({ theme: "light" });
  });
  await reply(0, { error: "Disk unavailable" }, 500);
  await operation;
  await poll();
  expect(requests).toHaveLength(1);
  expect(current.settings.theme).toBe("light");
  ({ operation } = await flush());
  expect(requests).toHaveLength(2);
  expect(JSON.parse(requests[1].options.body)).toEqual({ theme: "light" });
  await reply(1, { ok: true });
  await operation;
  expect(current.status).toBe("Saved to disk");
});
it("retains failed settings fields when a later patch changes a different preference", async () => {
  let operation;
  await act(async () => {
    operation = current.saveSettings({ theme: "light" });
  });
  await reply(0, { error: "Unavailable" }, 500);
  await operation;
  await act(async () => {
    operation = current.saveSettings({ panes: 2 });
  });
  expect(JSON.parse(requests[1].options.body)).toEqual({
    theme: "light",
    panes: 2,
  });
  await reply(1, { ok: true });
  await operation;
});
it("keeps a failed note status when a later layout save succeeds", async () => {
  await edit("Unsaved note");
  let { operation } = await flush();
  await reply(0, { error: "Disk unavailable" }, 500);
  await operation;
  expect(current.status).toBe("Not saved — retry available");
  let settings;
  await act(async () => {
    settings = current.saveSettings({ layout: { panels: ["n1"] } });
  });
  expect(current.status).toBe("Not saved — retry available");
  await reply(1, { ok: true });
  await settings;
  expect(current.status).toBe("Not saved — retry available");
  expect(current.error).toBe("Disk unavailable");
  ({ operation } = await flush());
  await reply(2, { note: { ...original, body: "Unsaved note", revision: 2 } });
  await operation;
  expect(current.status).toBe("Saved to disk");
});
