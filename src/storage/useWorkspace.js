import { useState, useRef, useEffect } from "react";
import { api } from "./api";

// Each ID has one newest local draft and one acknowledged server revision.
// A save response advances the revision without replacing a newer local draft.
export function useWorkspace(initial) {
  const [snapshot, setSnapshot] = useState(initial);
  const [status, setStatus] = useState("Saved to disk");
  const [error, setError] = useState("");
  const [needsUnlock, setNeedsUnlock] = useState(false);
  const [conflicts, setConflicts] = useState([]);
  const state = useRef({
    notes: initial.notes,
    saved: new Map(initial.notes.map((n) => [n.id, n])),
    pending: new Map(),
    conflicts: new Map(),
    running: null,
    timer: null,
    revision: initial.revision,
    generation: 0,
    readSequence: 0,
    attempted: new Set(),
    metadataQueue: null,
    metadataPending: 0,
    metadataDrafts: new Map(),
  });
  const publish = () =>
    setSnapshot((s) => ({ ...s, notes: [...state.current.notes] }));
  function setNotes(change) {
    const s = state.current;
    s.generation++;
    const next = typeof change === "function" ? change(s.notes) : change;
    const previous = new Map(s.notes.map((n) => [n.id, n]));
    for (const n of next) if (n !== previous.get(n.id)) s.pending.set(n.id, n);
    for (const n of s.notes)
      if (!next.some((v) => v.id === n.id)) s.pending.set(n.id, null);
    s.notes = next;
    publish();
    setStatus("Saving…");
    clearTimeout(s.timer);
    s.timer = setTimeout(() => flush().catch(() => {}), 450);
  }
  async function flush() {
    const s = state.current;
    clearTimeout(s.timer);
    while (s.metadataQueue) await s.metadataQueue;
    for (const [path, body] of s.metadataDrafts)
      await writeMetadata(path, body);
    if (s.running) {
      await s.running;
      if (s.pending.size || s.metadataQueue || s.metadataDrafts.size)
        return flush();
      return;
    }
    s.running = (async () => {
      while (s.pending.size) {
        const entry = [...s.pending].find(([id]) => !s.conflicts.has(id));
        if (!entry)
          throw new Error("Resolve the conflicting edits before continuing.");
        const [id, draft] = entry;
        if (draft === null && !s.saved.has(id) && !s.attempted.has(id)) {
          s.pending.delete(id);
          continue;
        }
        const baseRevision = s.saved.get(id)?.revision || 0;
        try {
          s.attempted.add(id);
          const result = await api("/notes/" + id, {
            method: draft ? "PUT" : "DELETE",
            body: draft ? { note: draft, baseRevision } : { baseRevision },
          });
          const saved = result.note || result;
          if (draft) s.saved.set(id, saved);
          else s.saved.delete(id);
          s.attempted.delete(id);
          if (s.pending.get(id) === draft) {
            s.pending.delete(id);
            if (draft) s.notes = s.notes.map((n) => (n.id === id ? saved : n));
            publish();
          }
          setError(saved.warning || "");
        } catch (e) {
          if (e.status === 401) setNeedsUnlock(true);
          if (e.status === 409) {
            s.conflicts.set(id, {
              id,
              local: s.pending.get(id),
              current: e.current,
            });
            setConflicts([...s.conflicts.values()]);
          }
          setError(e.message);
          setStatus(
            e.status === 409
              ? "Edits need review"
              : "Not saved — retry available",
          );
          throw e;
        }
      }
      setStatus(s.metadataDrafts.size ? "Saving…" : "Saved to disk");
    })();
    try {
      await s.running;
    } finally {
      s.running = null;
    }
    if (s.metadataQueue || s.metadataDrafts.size) return flush();
  }
  function resolve(id, choice) {
    const s = state.current,
      conflict = s.conflicts.get(id);
    if (!conflict) return;
    s.generation++;
    const local = s.pending.get(id),
      current = conflict.current;
    if (current) s.saved.set(id, current);
    else s.saved.delete(id);
    if (choice === "saved" || choice === "copy") {
      s.pending.delete(id);
      s.notes = s.notes.filter((n) => n.id !== id);
      if (current && !current.deletedAt) s.notes.push(current);
      if (choice === "copy" && local) {
        const copy = {
          ...local,
          id: crypto.randomUUID(),
          title: local.title + " (local copy)",
          revision: 0,
        };
        s.notes.push(copy);
        s.pending.set(copy.id, copy);
      }
    }
    s.conflicts.delete(id);
    setConflicts([...s.conflicts.values()]);
    publish();
    flush().catch(() => {});
  }
  async function reload() {
    await flush();
    const s = state.current,
      generation = s.generation,
      sequence = ++s.readSequence;
    const data = await api("/workspace");
    if (
      s.generation !== generation ||
      s.readSequence !== sequence ||
      s.pending.size ||
      s.running ||
      s.metadataPending ||
      s.metadataDrafts.size
    )
      return;
    s.notes = data.notes;
    s.saved = new Map(data.notes.map((n) => [n.id, n]));
    s.revision = data.revision;
    setSnapshot(data);
  }
  async function writeMetadata(path, body) {
    const s = state.current;
    if (path === "/settings") body = { ...s.metadataDrafts.get(path), ...body };
    s.generation++;
    s.metadataPending++;
    s.metadataDrafts.set(path, body);
    setStatus((current) =>
      current === "Not saved — retry available" ||
      current === "Edits need review"
        ? current
        : "Saving…",
    );
    const operation = (s.metadataQueue || Promise.resolve())
      .catch(() => {})
      .then(() => api(path, { method: "PUT", body }));
    s.metadataQueue = operation;
    try {
      const result = await operation;
      if (s.metadataDrafts.get(path) === body) s.metadataDrafts.delete(path);
      if (!s.metadataDrafts.size && !s.pending.size && !s.running) {
        setStatus("Saved to disk");
        setError("");
      }
      return result;
    } catch (e) {
      if (e.status === 401) setNeedsUnlock(true);
      setError(e.message);
      setStatus("Not saved — retry available");
      throw e;
    } finally {
      s.generation++;
      s.metadataPending--;
      if (s.metadataQueue === operation) s.metadataQueue = null;
    }
  }
  async function settings(patch) {
    setSnapshot((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
    try {
      await writeMetadata("/settings", patch);
    } catch {
      /* Keep the visible draft and surface the save error. */
    }
  }
  async function notebooks(items) {
    setSnapshot((s) => ({ ...s, notebooks: items }));
    await writeMetadata("/notebooks", items);
  }
  useEffect(() => {
    let alive = true;
    const interval = setInterval(async () => {
      const s = state.current;
      if (
        s.running ||
        s.pending.size ||
        s.metadataPending ||
        s.metadataDrafts.size
      )
        return;
      const generation = s.generation,
        sequence = ++s.readSequence;
      try {
        const data = await api("/workspace?since=" + s.revision);
        if (
          !alive ||
          data.unchanged ||
          s.pending.size ||
          s.running ||
          s.metadataPending ||
          s.metadataDrafts.size ||
          s.generation !== generation ||
          s.readSequence !== sequence
        )
          return;
        s.revision = data.revision;
        s.notes = data.notes;
        s.saved = new Map(data.notes.map((n) => [n.id, n]));
        setSnapshot(data);
      } catch (e) {
        if (alive && e.status === 401) setNeedsUnlock(true);
        if (alive)
          setError(
            e.status === 401
              ? "Session expired. Your drafts remain here; unlock to retry saving."
              : e.message,
          );
      }
    }, 3000);
    const unload = (e) => {
      if (state.current.pending.size || state.current.metadataDrafts.size) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => {
      alive = false;
      clearInterval(interval);
      clearTimeout(state.current.timer);
      window.removeEventListener("beforeunload", unload);
    };
  }, []);
  return {
    ...snapshot,
    setNotes,
    status,
    error,
    setError,
    needsUnlock,
    setNeedsUnlock,
    setUser: (user) => setSnapshot((snapshot) => ({ ...snapshot, user })),
    conflicts,
    resolve,
    flush,
    reload,
    saveSettings: settings,
    saveNotebooks: notebooks,
  };
}
