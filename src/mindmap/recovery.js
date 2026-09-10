import { diagramFences } from "../diagram/note-diagrams.js";
import { diagramRecoveryId } from "../diagram/recovery.js";
import { parseMindMap } from "./model.js";

export function clearPersistedMindMapDrafts(noteId, body, storage) {
  const fences = diagramFences(body, "thread-mindmap");
  for (const fence of fences) {
    const key = `thread-mindmap-draft:${diagramRecoveryId(noteId, fence, fences)}`;
    try {
      const raw = storage.getItem(key);
      if (!raw || raw.length > 25000000) continue;
      const draft = JSON.parse(raw);
      if (
        JSON.stringify(parseMindMap(draft.document)) ===
        JSON.stringify(parseMindMap(fence.value))
      )
        storage.removeItem(key);
    } catch {
      /* Failed or mismatched recovery reads must never fail a disk save. */
    }
  }
}
