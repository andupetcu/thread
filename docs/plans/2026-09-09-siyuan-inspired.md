# SiYuan-inspired document workflow

Reference: https://github.com/siyuan-note/siyuan and its screenshots. Adapt interaction ideas using original implementation.

Design: preserve Thread's slate/indigo theme and developer typography. Introduce a quiet right dock for document navigation and reference excerpts; hover/focus block handles reveal actions without cluttering reading. Keep source editing and existing exports, search, graph, and comparison workflows.

Implementation:

- [x] Test Markdown block boundaries, lossless source edits, reordering, outline extraction, and code-fence safety.
- [x] Add block editing with immediate persistence, shared / @ # suggestions, move/duplicate/delete and structural undo.
- [x] Add outline and references dock with active-pane context, heading navigation, excerpts, and open-beside actions.
- [x] Add browser tests for interactions, persistence and existing exports; inspect screenshots at desktop/mobile sizes.
- [x] Document changes and review regressions.

Boundary: this pass adds block editing and contextual navigation. It does not introduce SiYuan's storage format, SQL embeds, sync service, or full block-reference/transclusion model.

Verification: 15 model tests and 14 browser workflows pass; production build passes. Desktop block/outline/reference screenshots and mobile layout inspected. Independent review findings were fixed with regressions for paragraph/list boundaries, stale completion, and unclosed code fences.
