import { diagramFences } from "./note-diagrams.js";
import { parseDiagram } from "./model.js";

export function diagramRecoveryId(noteId, fence, fences) {
  const uniqueBlock =
    fence.blockId &&
    fences.filter((f) => f.blockId === fence.blockId).length === 1;
  return `${noteId}:${uniqueBlock ? fence.blockId : `diagram-${fence.diagramIndex}`}`;
}

// Only clear a draft that is now persisted byte-for-byte as a canonical diagram.
// A different pending draft (including one from another tab) remains recoverable.
export function clearPersistedDiagramDrafts(noteId, body, storage) {
  const fences = diagramFences(body);
  for (const fence of fences) {
    const key = `thread-diagram-draft:${diagramRecoveryId(noteId, fence, fences)}`;
    try {
      const raw = storage.getItem(key);
      if (!raw || raw.length > 25000000) continue;
      const draft = JSON.parse(raw);
      if (
        JSON.stringify(parseDiagram(draft.diagram)) ===
        JSON.stringify(parseDiagram(fence.value))
      )
        storage.removeItem(key);
    } catch {
      /* Unreadable storage or a malformed draft must not fail a disk save. */
    }
  }
}
