# Diagram editor v2 implementation plan

**Goal:** Implement the approved diagram improvements: richer shapes/connectors, efficient editing and layout, groups/swimlanes, linked notes/OKF/files, reusable templates, consistent exports, draft recovery, navigation, and revision-safe MCP proposals with human visual review.

**Architecture:** Keep React Flow and fenced `thread-diagram` JSON. A pure versioned document/geometry layer is shared by the editor, SVG/PNG exports and server proposal validation. Existing notes/OKF save policies remain authoritative. Shared templates and agent proposals live in SQLite; unfinished browser drafts use a scoped recovery key.

**Spec:** The user approved all features in the preceding proposal. This document records that scope and interfaces for implementation.

**Constraints:** Read v1 diagrams without loss. No Mermaid, external execution, cloud storage, note deletion tools, fabricated reviews, or automatic application of agent proposals. Preserve ordinary notes, notebooks, OKF mappings, diagrams and attachments. No live database mutation tests. Work on `codex/diagram-editor-v2` in the current checkout, preserving the established local-app workflow; no commit/push without request.

## Shared document contract

`src/diagram/model.js` remains the public pure entry point. `parseDiagram(value)` accepts v1/missing version and v2, returning a normalized v2 `{version:2,nodes,edges}` document. Existing exports remain: `SHAPES`, `COLORS`, `NODE_WIDTH`, `NODE_HEIGHT`, `defaultDiagram()`, `templateDiagram(name)`, `diagramToSvg(value, options?)`, `diagramToPng(value, options?)`.

Node: `{id,type:'diagramShape',position:{x,y},width,height,parentId?,locked?,data:{shape,label,color,textColor?,fontSize?,fontWeight?,textAlign?,link?,image?}}`. Shapes: process, decision, database, text, terminator, ellipse, document, annotation, group, swimlane, image. Parent-relative positions; parent must be group/swimlane, no cycles. Links: `{kind:'note',noteId}`, `{kind:'block',noteId,blockId}`, `{kind:'concept',noteId,bundleId,path}`, `{kind:'url',url}`, `{kind:'asset',url,name}`. Image: `{url,alt}` using local authenticated asset URLs or relative paths in portable bundles. Link URL protocols restricted; no executable attributes. Default node geometry 180x90. Persist dimensions, locking and grouping; transient React Flow selection/measuring state is excluded.

Edges: `{id,source,target,sourceHandle,targetHandle,label,kind,color,width,dashed,startArrow,endArrow}`. Handles: `out-top/out-right/out-bottom/out-left`, `in-top/in-right/in-bottom/in-left`; v1 out/in migrate to bottom/top. Kinds: curve, straight, orthogonal. Arrows: none, arrow, diamond, circle. Defaults reproduce v1. Validate bounded input, IDs, coordinates, dimensions, sizes, handle names, links/assets and parent references. Keep 300 nodes/1,000 edges limits and clear errors.

Geometry helpers exported for live/editor renderer reuse: `absolutePosition(node,nodes)`, `nodeSize(node)`, `nodeShapeSvg(node)` (local-coordinate inner SVG string), `nodeLabelLines(node)` (array of fitted lines), `edgeGeometry(edge,nodes)` -> `{path,labelX,labelY,sourceX,sourceY,targetX,targetY}`. `diagramToSvg` includes all geometry and configurable background ('transparent' or hex); image data may be embedded through `options.assetData` URL->dataURL mapping. `diagramToPng` asynchronously resolves local images itself or via injected resolver, enforces raster bounds, supports scale/background; fails visibly on missing assets rather than silently dropping them. Portable SVG export uses async `diagramToPortableSvg(value,options?)` to embed local images.

Editor context passed through DiagramBlock: `{noteId,diagramIndex,blockId?,revision,notes,onOpenNote}`. DiagramBlock maintains existing value/onChange/readOnly props and optional `context`, `recoveryKey`. Root wires Render and ordinary Markdown mode callers. Missing context (test harness) allows basic editor operations, but note-specific proposal/link navigation requires context.

## Task 1 — Document, geometry, portable rendering (owner: model agent)

Files: `src/diagram/model.js`, optional pure helpers in that directory; `tests/diagram-v2.test.js`, existing `tests/diagram.test.js` compatibility adjustments only if required.

- [x] Write/run failing tests for v1 migration, v2 round-trip, dimensions/styles/handles/groups, parent/cycle/URL rejection and exact bounds.
- [x] Implement shared geometry and fit labels without silent five-line clipping; preserve full label text in document. Editor uses same computed lines/geometry.
- [x] Implement export appearance parity for all shapes, edge types/arrowheads, nested groups and image nodes. Safe text escaping; bounds include routes, arrows, labels. Test backward/upward connections and self-loops.
- [x] Add SVG/PNG background/resolution and local-image embedding; existing callers still work.
- [x] Built-in templates include flow, decision, data plus architecture, approval, knowledge, swimlane. Templates return fresh valid documents.
- [x] Run focused model/export tests and report evidence. No package edits without root coordination.

## Task 2 — Editor tools, layout, navigation and recovery (owner: editor agent)

Files: `src/diagram/DiagramBlock.jsx`, new `DiagramEditor.jsx`, `editor-operations.js`, editor-specific components/hooks, `diagram.css`; tests `diagram-editor-v2.test.js`, `diagram-editor-v2.spec.js`. Do not edit model.js, Render, server or package files.

- [x] Add pure tested operations: duplicate/copy/paste with new IDs and internal edges, batch style, align/distribute, group/ungroup, lock/unlock, auto-layout preserving pinned nodes. Use @dagrejs/dagre installed by root for top-down/left-right layout; groups must keep valid relative positions.
- [x] Resizable shapes, direct double-click label editing, fit-to-text, font/color controls, four-sided handles, reconnect, line/arrow styles; shared geometry from Task1 in live renderer.
- [x] Context menu, select-all, duplicate/copy/paste shortcuts, Ctrl/Cmd+S; group typing/resize/drag into sensible undo transactions. Preserve existing selector labels/tests where possible.
- [x] Grid snap, alignment guides, minimap, search, zoom to selection, viewport restoration, collapsible mobile palette/inspector.
- [x] Groups/frames and swimlanes, moving children together, lock background elements; support all new shape types.
- [x] Local image/file upload UI using existing uploadAsset; link picker for context.notes including ordinary and OKF notes, note/block/URL targets; clickable shapes in preview/editor. Reuse protected asset URLs.
- [x] Reusable templates: existing templates insert into nonempty canvas, explicit replacement with warning; save selected subgraph, load/list shared custom templates via Task3 APIs. Ensure IDs remapped on insert.
- [x] Scoped crash recovery storing {baseline,diagram,viewport}, restore/discard prompt, bounded storage/error handling; clear only after successful save/discard; recover conflict draft without silently replacing remote content.
- [x] Direct SVG/PNG/JSON exports and JSON import with validation/replace-or-insert review. Local assets retained in SVG/PNG via model helper; user background/scale options.
- [x] MCP proposal UI: list pending proposals for context.noteId, show proposed vs current diagram visually, explicitly apply via human endpoint with expectedRevision; preserve local drafts and reject stale operations. Context callbacks/root refresh update actual note. Agent proposals are not silently loaded or saved.
- [x] Real browser tests for save/reload, copy/group/resize/edge persistence, recovery, links/assets, templates, import/export. Coordinate browser port ownership with root.

## Task 3 — Shared templates and MCP proposals (owner: backend agent)

Files: `server/diagrams.mjs`, `server/diagram-http.mjs`, `server/diagram-mcp.mjs`, `server/http.mjs`, `server/mcp.mjs`, minimal store integration; tests `diagram-api.test.js`, `diagram-mcp.test.js`, existing MCP expected-tool lists.

Human APIs:
- GET `/api/diagram-templates` -> `{templates:[{id,name,diagram,revision}]}`; POST `{name,diagram}` creates; PUT `/:id` `{name?,diagram?,baseRevision}` updates. No delete required. Shared normal-user/admin access.
- GET `/api/diagrams?noteId=...` -> `{noteId,revision,diagrams:[{diagramIndex,blockId?,diagram,sourceHash}]}` (read-only, stable for that revision).
- GET `/api/diagram-proposals?noteId=...` -> `{proposals:[{id,noteId,diagramIndex,baseRevision,diagram,summary,created,actor,status}]}` pending only by default.
- POST `/api/diagram-proposals/:id/apply` `{expectedRevision}` -> `{note}`; checks current note revision and original diagram identity/source, then updates ONLY that fenced block through store save policy in transaction. Preserve unrelated body/metadata/history. Proposal status changes atomically. Human only, never promotes OKF verification.
- POST `/api/diagram-proposals/:id/reject` -> `{proposal}` human only, changes proposal status only.

Agent routes prefixed `/api/agent`: GET `/diagrams?noteId`; POST `/diagram-proposals` `{noteId,diagramIndex,baseRevision,diagram,summary}` -> `{proposal}`. No direct apply/reject/template mutation. Strict input validation beyond MCP schemas, authenticate/recheck keys before writes. NoteIndex is safe only with exact baseRevision; parse fenced code via remark AST, never brittle regex replacement. For absent stable block markers retain source hash + index + revision; reads never modify notes.

MCP tools: `list_diagrams({noteId})`, `read_diagram({noteId,diagramIndex})`, `propose_diagram_update({noteId,diagramIndex,baseRevision,diagram,summary})`. Create/revise proposal only, no application until authenticated human review. Existing update_note permission remains unchanged (user already permits edits); new tools add a safe structured workflow, not a claim that raw note editing is impossible.

- [x] Write/run failing real API/MCP tests for proposal inertness, human application, conflicts, unrelated-body preservation, OKF metadata policy, user access, forged input, disabled key and backup restoration.
- [x] Add SQLite tables/migration without resets; include templates and proposals in validated atomic workspace backup/restore. Rebase or invalidate stale pending proposals honestly on restore; no dangling apply ability.
- [x] Implement APIs/MCP and run focused tests; report contracts and test evidence.

## Task 4 — Note/OKF integration and portable packages (owner: root)

Files: `src/Render.jsx`, `src/main.jsx` only direct diagram context caller if needed; `src/export-markdown.js`, `src/okf/export-portable.js`, docs; tests `diagram-integration.spec.js` and portable fixtures.

- [x] Pass note identity, diagram ordinal, block identity, note revision, note list and navigation to editor without stale-offset writes. Existing diagrams remain visible/editable in preview/Markdown/blocks/OKF.
- [x] Note and OKF portable export includes image/asset references inside diagram JSON (Markdown AST alone misses those). Rewrite packaged diagram asset addresses, retain editable JSON, embed images in readable preview, report unresolved note/OKF links.
- [x] Add integration browser checks for local image node, navigable linked note, agent proposal review/apply through the real API, reload/recovery and original Start here regression.
- [x] Update user guide/README with tools, shortcuts, persistence/portability, local drafts and proposal semantics.

## Task 5 — Independent review and final verification

- [x] Independent reviews of model/rendering, editor/concurrency and API/MCP; fix concrete findings and verify their regressions.
- [x] Run full unit suite, build, full browser suite on isolated test workspaces. Visual QA desktop/mobile/editor/export.
- [x] Check changed files for secrets/generated artifacts; restart local API after validated migrations. Report actual checks and limitations; leave changes on feature branch until user requests Git integration.

## Progress

Implementation and independent reviews complete. Final verification: 272 unit/integration tests, 83 browser tests, and production build passed. Desktop/mobile visual checks complete. Local app restarted successfully using its existing workspace. Changes remain uncommitted on `codex/diagram-editor-v2`. Recovery ledger: `.superpowers/sdd/2026-09-10-diagram-editor-v2/progress.md`.
