// Native visual envelopes may include an 8 MB saved PNG alongside editable data.
// Leave room for prose and JSON/UTF-8 transport overhead; all sizes remain bounded.
export const MAX_DOCUMENT_CHARACTERS = 16_000_000;
export const MAX_JSON_REQUEST_BYTES = 64_000_000;
