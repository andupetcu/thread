# Durable workspace, visual diagrams, and product tools

## Authorized scope

Implement ALL eight recommendations from the previous response, plus one shared workspace password and a visual diagram block (no Mermaid). Existing note data must migrate without loss. Preserve all original editing/search/export/graph/1–3 pane features.

## Architecture and ownership

- Root: Node HTTP API + SQLite disk persistence; sessions/password authentication; revision-safe saves; Markdown mirrors; automatic/manual backups with attachments; proper restore, trash, history; import migration; app shell integration, tabs/pane resizing/layout restore; attachment/PDF/DOCX export; benchmark and final audit.
- Diagram module: React Flow visual diagram block; fullscreen shape/connector editor; diagrams stored as fenced `thread-diagram` JSON in Markdown; safe SVG preview/export, PNG conversion; undo/redo, label editing, shape palette/drag drop; integration adapter components.
- Editor module: rich text block editing preserving Markdown and / @ #, attachment paste/drop, syntax highlighting, drag-reorder; stable block IDs and block references/embeds/previews.
- Workspace tools module: relationship-driven graph with drag positions/tag connections/neighborhood filtering/persisted positions; configurable property table with saved views; aligned word-diff comparison with navigation.

Module agents own separate files and tests. Root alone edits src/main.jsx and storage/auth. Dependency installs are coordinated by root. Components retain CSS variables from current UI.

## API contracts

Same-origin `/api`, cookie sessions. GET /auth/status, POST /auth/setup|login|logout|password. GET /workspace -> {notes,settings,notebooks}; PUT /notes/:id accepts {note,baseRevision}, returns saved note or 409 {current}; DELETE soft-deletes; GET /trash; POST /notes/:id/restore; GET /notes/:id/history; POST /notes/:id/history/:version/restore. GET/PUT /settings. POST /assets raw bytes, X-Filename percent-encoded -> {url,name,mime}; GET /assets/:id. GET /search?q=&tag=&from=&to=&dateField= -> {ids}. Backups and import/restore gated by auth. Notes retain id,title,body,created,updated,pinned, plus revision, parentId,notebookId,properties {status,priority,owner,dueDate,...custom}. Block IDs embedded in Markdown comments. Schema migrations are explicit.

## Acceptance checklist

- [x] Password setup/login/logout/change, protected API/assets, rate limit, secure session handling, password reset CLI.
- [x] Disk persistence and Markdown mirrors, browser-data migration, revision conflicts surfaced without overwrite.
- [x] Automatic/manual backups, full backup restore, note versions/revert, persistent trash/restore, attachments in backups.
- [x] Rich formatted block editing, drag/drop blocks, pasted images/files, code highlighting, preserved source commands.
- [x] Stable block references, reference previews, live embedded blocks, section navigation and cycle protection.
- [x] Visual diagram block /Diagram, fullscreen visual editing, shapes/connectors/labels, drag/drop, undo/redo, save/reload, MD/PDF/DOCX output.
- [x] Notebooks/nested pages, document tabs, resizable panes and persisted layouts.
- [x] Status/priority/owner/due/custom fields and saved table filters/views.
- [x] Relationship graph layout, node drag, shared-tag edges, neighborhood filters and saved positions.
- [x] Word-level aligned diffs, synchronized scroll and next/previous change navigation for 2/3 notes.
- [x] Direct PDF download, styled DOCX with images, portable Markdown assets.
- [x] Indexed search, thousands-of-notes benchmark, simultaneous edits, keyboard/accessibility checks.
- [x] Regression suite, build, browser and export artifact checks; independent review; README startup/recovery instructions.

## Verification

Use isolated temporary data directory and test password setup via API for tests. Real workspace must never be reset by tests. Preserve legacy browser storage during migration. New local service runs behind Vite proxy in dev and serves dist in production. No default user password and no cloud service.

## Final verification — 2026-09-09

- `npm test`: 98 passing tests across 14 files.
- `npm run test:e2e`: 35 passing Chrome tests, including process restart, same-count workspace restore, mobile diagrams, and independent-session conflicts.
- `npm run build`: passed; editors and export libraries load separately. Vite reports the larger editor chunks as a size warning.
- Production smoke using an isolated temporary workspace: password setup, disk workspace, graph, and fullscreen diagram loaded from built assets.
- `npm run benchmark`: 5,000 notes; 715 results; median indexed query 1.74 ms and p95 1.91 ms on this machine.
- Independent module and integration reviews completed; stale-save/read races, concurrent login throttling, diagram draft retention, reference definition context, and tooltip pointer interference corrected.
- Local development service restarted on http://127.0.0.1:5173 with the current API. No password was chosen for the real workspace.

Known boundaries: password controls app access, not disk encryption; Markdown files are mirrors rather than externally synchronized inputs; PDFs contain rasterized pages; DOCX media/structure were verified but Word pagination varies. Cloud sync and simultaneous collaborative editing are outside this local-workspace implementation.
