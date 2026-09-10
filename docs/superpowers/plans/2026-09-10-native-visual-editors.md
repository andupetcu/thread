# Native visual editors implementation plan

Goal: directly replace custom React Flow diagrams and mind maps with locally served draw.io and Drawnix. User approves replacement; no migration or compatibility renderer. Existing note/notebook/OKF persistence, references, revisions, backups, and MCP editing stay intact.

Architecture: retain thread-diagram/thread-mindmap fenced blocks, replace their contents with native editor envelopes. All editor assets served locally; no hosted editor iframe. Inline saved previews and fullscreen editing. Keep Thread references as a stable list in the envelope, with optional native element IDs; UI supports reference selection/open/removal. Native content remains authoritative and survives losslessly. PNG preview data optional for unsaved/agent-created documents; don't fabricate previews.

## Global constraints and interfaces

- Diagram: `{version:3,engine:'drawio',xml:string,preview?:string,references:Reference[]}`. XML is uncompressed mxGraphModel/mxfile; native draw.io export. Preview raster PNG data URL only, bounded. No legacy nodes/edges conversion.
- Mind map: `{version:2,engine:'drawnix',elements:object[],viewport?:object,theme?:object,preview?:string,references:Reference[]}`. Native Plait elements preserve their fields, with bounded JSON depth/size/count. No old semantic-tree conversion.
- Reference: `{id:string,label:string,elementId?:string,link:{kind:'note'|'block'|'concept'|'bundle'|'url'|'asset',noteId?,blockId?,bundleId?,url?,name?}}`; validate existing safe local and URL rules; no executable schemes.
- `src/diagram/model.js`: `defaultDiagram()`, `parseDiagram(value)`, `diagramToPng(value)` returns saved preview or throws clear missing-preview message. `diagramToSvg(value)` may provide a safe placeholder/preview wrapper only; no custom shape rendering. Shared native parsing helpers belong src/visual/model.js.
- `src/mindmap/model.js`: `defaultMindMap()`, `parseMindMap(value)`, native preview helpers as needed by UI; no hand-built editor/tree layout retained.
- Block props remain `{value,onChange,readOnly,context,recoveryKey}`. onChange receives JSON.stringify(native envelope). Context currently includes notes,bundles,noteId,revision,onOpenNote,onOpenBundle,resolveAssetUrl,flush and OKF retainRecoveryOnSave.
- Recovery storage namespaces stay thread-diagram-draft:/thread-mindmap-draft: with {baseline,diagram} / {baseline,document}; baseline canonical JSON, success cleanup only after persisted save, OKF outer Save concept remains authoritative.
- User explicitly authorizes direct replacement without porting; legacy-specific tests removed/replaced with native behavioral coverage. No workspace data resets. No commit/push until asked.

## Tasks

- [x] Root: locally package pinned draw.io distribution, native iframe protocol editor, source/previews, save/recovery/conflicts, references, template/proposal UI, real browser tests. Own src/diagram UI files, scripts/drawio assets configuration, vite config and package scripts. Native models supplied by integration task.
- [x] Drawnix worker: implement native Drawnix editor/block, reference list and native selection association, explicit save/recovery/conflicts, native import/export and Markdown import, PNG preview; install dependencies coordinated with root; own src/mindmap UI/CSS, tests/mindmap.spec.js. Report actual package API and browser evidence. No other production changes.
- [x] Integration worker: native pure models/validation and references, metadata/backlinks, portable note/OKF exports of native XML/.drawnix plus saved PNG, server templates/proposal schemas and tests, recovery cleanup. Own src/visual/model.js, src/diagram/model.js, src/mindmap/model.js, src/model.js, src/export-markdown.js, src/okf/export-portable.js, src/diagram/portable.js, both recovery modules, server diagram modules and related unit tests. Remove retired geometry/editor-operation tests and unused custom model files only after checking references. Export all needed helper contracts to root/workers.
- [x] Root: integration review, replace obsolete UI/browser tests with native engine behaviors, independent review/fix findings, full unit/build/browser verification, desktop/mobile visual checks, docs, restart local app. Test workspaces are temporary; never mutation-test live workspace.

Ruling: architectural intent already approved in preceding proposal and explicit user replacement instruction; execute without another approval gate. Separate ownership allows parallel work under dispatching-parallel-agents skill; no workers spawn agents. Current feature branch keeps existing local app workflow; no extra worktree.

## Verification

Complete: 212 unit/integration tests in 34 files, 75 browser tests, production build, and zero-vulnerability npm audit. Native typing/save/recovery, reference navigation, OKF outer saves, shared templates/proposal review, imports/exports, mobile views, and ordinary note workflows verified. Independent review findings fixed and scoped re-review clean. Local server restarted; UI/auth/editor static routes respond successfully. Changes remain uncommitted on `codex/native-visual-editors`.
